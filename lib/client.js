import net from "node:net";

import { mf2 } from "microformats-parser";

const FETCH_TIMEOUT = 5000;

/**
 * Check whether a URL may be fetched when discovering client information
 *
 * Only public HTTP(S) origins qualify. Loopback, link-local (including the
 * cloud metadata address), private and unspecified addresses are refused, as
 * are numeric host encodings that resolve to them.
 * @param {URL} url - URL to check
 * @returns {boolean} URL is safe to fetch
 */
const isFetchableOrigin = (url) => {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return false;
  }

  const hostname = url.hostname.replace(/^\[|]$/g, "").toLowerCase();

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return false;
  }

  // Decimal, hexadecimal and octal encodings of an address (`2130706433`,
  // `0x7f000001`, `0177.0.0.1`) are resolved by the system resolver but are
  // not recognised by `net.isIP`, so refuse anything numeric it can’t parse
  if (
    /^\d+$/.test(hostname) ||
    /^0x[\da-f]+$/.test(hostname) ||
    (/^[\d.]+$/.test(hostname) && net.isIP(hostname) === 0)
  ) {
    return false;
  }

  switch (net.isIP(hostname)) {
    case 4: {
      const [a, b] = hostname.split(".").map(Number);
      return !(
        a === 0 || // Unspecified
        a === 10 || // Private
        a === 127 || // Loopback
        (a === 100 && b >= 64 && b <= 127) || // Carrier-grade NAT
        (a === 169 && b === 254) || // Link-local, incl. cloud metadata
        (a === 172 && b >= 16 && b <= 31) || // Private
        (a === 192 && b === 168) // Private
      );
    }

    case 6: {
      return !(
        hostname === "::" || // Unspecified
        hostname === "::1" || // Loopback
        /^f[cd]/.test(hostname) || // Unique local
        /^fe[89ab]/.test(hostname) || // Link-local
        hostname.startsWith("::ffff:") // IPv4-mapped
      );
    }

    default: {
      // ponytail: a hostname is trusted as public without resolving it, so a
      // DNS name pointing at an internal address still passes. Closing that
      // needs resolution plus connecting to the resolved address (a custom
      // undici dispatcher), which is a larger change than this hardening.
      return true;
    }
  }
};

/**
 * Get client information from application Microformat
 * @param {string} body - Response body
 * @param {object} client - Fallback client information
 * @returns {object} Client information
 * @deprecated since 11 July 2024
 * @see {@link https://indieauth.spec.indieweb.org/20220212/#application-information}
 */
export const getApplicationInformation = (body, client) => {
  const { items } = mf2(body, { baseUrl: client.url });
  for (const item of items) {
    const { properties, type } = item;

    if (/^h-(?:x-)?app$/.test(type[0])) {
      // If no URL property, use baseUrl
      if (!properties.url) {
        properties.url = [client.url];
      }

      // Check that URL property matches `client_id`. Note that this isn’t for
      // authentication, but to ensure only relevant client metadata is returned
      if (!properties.url?.includes(client.url)) {
        continue;
      }

      const keys = ["logo", "name", "url"];
      for (const key of keys) {
        if (properties[key] && properties[key][0]) {
          /** @type {object|string} Image or string */
          const property = properties[key][0];
          client[key] = property.value || property;
        }
      }
    }
  }

  return client;
};

/**
 * Get client information from client metadata
 * @param {string} body - Response body
 * @param {object} client - Fallback client information
 * @returns {object} Client information
 * @see {@link https://indieauth.spec.indieweb.org/#client-metadata}
 */
export const getClientMetadata = (body, client) => {
  const json = JSON.parse(body);

  // Client metadata MUST include `client_id`
  if (!Object.hasOwn(json, "client_id")) {
    throw new Error("Client metadata JSON not valid");
  }

  return {
    ...client,
    logo: json.logo_uri,
    name: json.client_name || client.name,
    url: json.client_uri || client.url,
  };
};

/**
 * Get client information
 * @param {string} clientId - Client ID
 * @returns {Promise<object>} Information about the client
 * @see {@link https://indieauth.spec.indieweb.org/#client-information-discovery}
 */
export const getClientInformation = async (clientId) => {
  let clientUrl;
  try {
    clientUrl = new URL(clientId);
  } catch {
    return { id: clientId, name: clientId, url: clientId };
  }

  const client = {
    id: clientId,
    name: clientUrl.host,
    url: clientUrl.href,
  };

  // `client_id` is supplied by whoever begins the authorization request, and
  // this function fetches it, so it decides where the server sends a request.
  // Restrict that to public HTTP(S) origins: anything else is either
  // unreachable from here or somewhere the server should not be reaching.
  if (!isFetchableOrigin(clientUrl)) {
    return client;
  }

  let clientResponse;
  try {
    clientResponse = await fetch(clientId, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
  } catch {
    // Unreachable, refused, TLS failure or timed out
    return client;
  }

  if (!clientResponse.ok) {
    // Use information derived from clientId
    return client;
  }

  const body = await clientResponse.text();

  try {
    // Use information from client JSON metadata
    return getClientMetadata(body, client);
  } catch {
    try {
      // Use information from client HTML microformats (deprecated)
      return getApplicationInformation(body, client);
    } catch {
      // Body is neither client metadata nor parseable HTML. `mf2()` throws on
      // an empty or non-HTML body, which would otherwise fail the whole
      // authorization request over a client that simply serves JSON.
      return client;
    }
  }
};
