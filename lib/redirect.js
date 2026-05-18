/**
 * In-memory cache of declared redirect URIs per `client_id`.
 *
 * IndieAuth requires fetching the `client_id` URL to discover allowed
 * `redirect_uri` values declared via `<link rel="redirect_uri">` tags or
 * `Link` HTTP headers. To avoid refetching on every authorization request,
 * results are cached for `CACHE_TTL_MS`.
 */
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 5000;
const cache = new Map();

/**
 * Clear the in-memory declared redirect URI cache. Intended for tests.
 */
export const _clearRedirectCache = () => {
  cache.clear();
};

/**
 * Validate `redirect_uri` against the request's `client_id` URL.
 *
 * Implementation:
 *  - Same-host fast path: hosts equal → allow (no fetch).
 *  - Cross-host: fetch `client_id`, parse `<link rel="redirect_uri">` tags
 *    and `Link` HTTP headers with `rel="redirect_uri"`, match the request
 *    against declared URIs. Supports a single-label subdomain wildcard
 *    (e.g. `https://*.chromiumapp.org/`).
 *  - Cached per `client_id` with a 1 hour TTL.
 * @param {string} redirectUri - Redirect URL submitted in the auth request
 * @param {string} clientId - URL of client (RP) identifier
 * @returns {Promise<boolean>} `true` if the redirect URI is allowed
 * @see {@link https://indieauth.spec.indieweb.org/#redirect-url}
 */
export const validateRedirect = async (redirectUri, clientId) => {
  let redirectUrl;
  let clientUrl;
  try {
    redirectUrl = new URL(redirectUri);
    clientUrl = new URL(clientId);
  } catch {
    return false;
  }

  // Same-host fast path
  if (redirectUrl.host === clientUrl.host) {
    return true;
  }

  // Cross-host: fetch client_id and check declared redirect_uri entries
  const declared = await getDeclaredRedirectUris(clientId);
  return declared.some((pattern) => matchesPattern(redirectUri, pattern));
};

/**
 * Get the declared redirect URIs for a `client_id`, using the cache when fresh.
 * @param {string} clientId - URL of client (RP) identifier
 * @returns {Promise<string[]>} Declared redirect URI patterns
 */
async function getDeclaredRedirectUris(clientId) {
  const entry = cache.get(clientId);
  if (entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
    return entry.uris;
  }

  const uris = await fetchDeclaredRedirectUris(clientId);
  cache.set(clientId, { uris, fetchedAt: Date.now() });
  return uris;
}

/**
 * Fetch `client_id` and parse out declared redirect URIs from HTTP `Link`
 * headers and HTML `<link rel="redirect_uri">` tags.
 *
 * Failure modes (network error, non-2xx, parse error, timeout) all return
 * an empty list. Errors are intentionally swallowed: validation simply
 * fails closed when no declared URIs are discoverable.
 * @param {string} clientId - URL of client (RP) identifier
 * @returns {Promise<string[]>} Declared redirect URI patterns
 */
async function fetchDeclaredRedirectUris(clientId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(clientId, {
      headers: { Accept: "text/html" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      return [];
    }

    const fromHeader = parseLinkHeader(response.headers.get("Link"));
    const html = await response.text();
    const fromHtml = parseHtmlLinks(html);
    return [...fromHeader, ...fromHtml];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse an HTTP `Link` header value, returning hrefs whose `rel` includes
 * `redirect_uri`.
 * @param {string|null} header - Raw `Link` header value
 * @returns {string[]} Hrefs declared with `rel="redirect_uri"`
 */
function parseLinkHeader(header) {
  if (!header) {
    return [];
  }

  const out = [];
  // RFC 8288 link entries: <uri>; rel="..."; ...
  // Split on commas that precede a new `<` (avoids splitting commas inside params).
  const entries = header.split(/,(?=\s*<)/);
  for (const part of entries) {
    const match = part.match(/<([^>]+)>\s*;\s*(.+)/);
    if (!match) continue;
    const uri = match[1];
    const params = match[2];
    const relMatch = params.match(/rel\s*=\s*"?([^";]+)"?/i);
    if (!relMatch) continue;
    const rels = relMatch[1].split(/\s+/);
    if (rels.includes("redirect_uri")) {
      out.push(uri);
    }
  }
  return out;
}

/**
 * Parse `<link rel="redirect_uri" href="...">` (or `href` before `rel`)
 * from an HTML response body.
 * @param {string} html - HTML response body
 * @returns {string[]} Declared redirect URI patterns
 */
function parseHtmlLinks(html) {
  const out = [];

  // rel before href
  const re =
    /<link\b[^>]*\brel=["']redirect_uri["'][^>]*\bhref=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1]);
  }

  // href before rel
  const re2 =
    /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']redirect_uri["']/gi;
  while ((m = re2.exec(html)) !== null) {
    out.push(m[1]);
  }

  // De-duplicate while preserving order
  return [...new Set(out)];
}

/**
 * Match a request redirect URI against a declared pattern.
 *
 * Wildcard semantics: a pattern of `https://*.example.com/path` matches a
 * single DNS label in the leftmost position, so it matches
 * `https://abc.example.com/path` but not `https://a.b.example.com/path`.
 * The scheme, port and path must match exactly (path comparison is
 * trailing-slash insensitive).
 * @param {string} requestUri - The request's `redirect_uri`
 * @param {string} pattern - A declared redirect URI pattern
 * @returns {boolean} `true` if the request matches the pattern
 */
function matchesPattern(requestUri, pattern) {
  let req;
  let pat;
  try {
    req = new URL(requestUri);
    // Replace `*.` placeholder so the URL parser accepts the pattern.
    pat = new URL(pattern.replace(/\*\./, "wildcard-placeholder."));
  } catch {
    return false;
  }

  if (req.protocol !== pat.protocol) return false;
  if (req.port !== pat.port) return false;

  // Path match (normalize trailing slash on both sides)
  const normalizePath = (p) => (p.endsWith("/") ? p : p + "/");
  if (normalizePath(req.pathname) !== normalizePath(pat.pathname)) return false;

  // Host match: wildcard or exact
  if (pattern.includes("*.")) {
    // Extract bare host portion from pattern: "*.chromiumapp.org" → "chromiumapp.org"
    const bareDomain = pattern
      .replace(/^[a-z]+:\/\//i, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "")
      .replace(/^\*\./, "");
    const reqHostname = req.hostname;
    const reqHostParts = reqHostname.split(".");
    const bareDomainParts = bareDomain.split(".");
    // Wildcard matches exactly one extra DNS label on the left.
    if (reqHostParts.length !== bareDomainParts.length + 1) return false;
    return reqHostParts.slice(1).join(".") === bareDomain;
  }

  return req.host === pat.host;
}
