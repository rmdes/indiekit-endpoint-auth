import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";

import { validateRedirect } from "../../lib/redirect.js";

// Deliberately free of undici and `@indiekit-test/*`: the mock agent helpers
// live in the upstream monorepo and are unavailable here, and pinning undici's
// MockAgent behaviour proved brittle across versions. Stubbing `fetch` keeps
// these runnable from a clean checkout.
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * Serve a client_id page declaring the given redirect URIs
 * @param {string[]} declared - Declared redirect URIs
 * @param {object} [headers] - Response headers
 */
const servePage = (declared, headers = {}) => {
  const links = declared
    .map((uri) => `<link rel="redirect_uri" href="${uri}">`)
    .join("");
  globalThis.fetch = async () =>
    new Response(
      `<html><head>${links}</head><body><p>Client</p></body></html>`,
      { status: 200, headers },
    );
};

const CLIENT = "https://client.example/";

describe("endpoint-auth/lib/redirect", () => {
  it("Allows same-host redirect URIs without fetching", async () => {
    globalThis.fetch = async () => {
      throw new Error("should not fetch for a same-host redirect");
    };

    assert.equal(
      await validateRedirect("https://client.example/callback", CLIENT),
      true,
    );
  });

  it("Rejects a different host or port when nothing is declared", async () => {
    servePage([]);

    assert.equal(
      await validateRedirect("https://other.example/callback", CLIENT),
      false,
    );
    assert.equal(
      await validateRedirect("https://client.example:8080/", CLIENT),
      false,
    );
  });

  it("Allows a redirect URI declared in a <link> tag", async () => {
    servePage(["https://redirect.example/callback"]);

    assert.equal(
      await validateRedirect("https://redirect.example/callback", CLIENT),
      true,
    );
  });

  it("Allows a redirect URI declared in a Link header", async () => {
    globalThis.fetch = async () =>
      new Response("<html><head></head><body><p>Client</p></body></html>", {
        status: 200,
        headers: {
          link: '<https://redirect.example/callback>; rel="redirect_uri"',
        },
      });

    assert.equal(
      await validateRedirect("https://redirect.example/callback", CLIENT),
      true,
    );
  });

  it("Resolves a relative declared href against the client_id", async () => {
    servePage(["/callback"]);

    assert.equal(
      await validateRedirect("https://client.example/callback", CLIENT),
      true,
    );
  });

  it("Rejects a declared URI with a different path or scheme", async () => {
    servePage(["https://redirect.example/callback"]);

    assert.equal(
      await validateRedirect("https://redirect.example/elsewhere", CLIENT),
      false,
    );
    assert.equal(
      await validateRedirect("http://redirect.example/callback", CLIENT),
      false,
    );
  });

  it("Matches a declared pattern literally, never as a wildcard", async () => {
    // Wildcards in redirect URLs open up attack vectors, so a declared `*.` is
    // compared as text. See indieweb/indieauth#22 (comment 544204967)
    servePage(["https://*.extension.example/"]);

    for (const redirectUri of [
      "https://abc123.extension.example/",
      "https://extension.example/",
      "https://a.b.extension.example/",
    ]) {
      assert.equal(await validateRedirect(redirectUri, CLIENT), false);
    }
  });

  it("Rejects when the client_id cannot be fetched", async () => {
    globalThis.fetch = async () => new Response("", { status: 404 });
    assert.equal(
      await validateRedirect("https://redirect.example/callback", CLIENT),
      false,
    );

    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    assert.equal(
      await validateRedirect("https://redirect.example/callback", CLIENT),
      false,
    );
  });

  it("Returns false for invalid URLs without throwing", async () => {
    assert.equal(await validateRedirect("foo", CLIENT), false);
    assert.equal(await validateRedirect(CLIENT, "bar"), false);
  });

  it("Accepts Plume's browser extension callbacks", async () => {
    // Both are literal: Chrome derives its host from the extension id, Firefox
    // from sha1(browser_specific_settings.gecko.id). Guards this server against
    // regressing the flow its own browser extension depends on.
    const plume = "https://rmdes.github.io/plume/";
    const chrome = "https://hcphdjeoolimpjjekegpobkhoealiige.chromiumapp.org/";
    const firefox =
      "https://18c46e9c3ea19e2ce2f904ee4b4228ff5e5d9abb.extensions.allizom.org/";

    servePage([chrome, firefox]);

    assert.equal(await validateRedirect(chrome, plume), true);
    assert.equal(await validateRedirect(firefox, plume), true);
    assert.equal(
      await validateRedirect(
        "https://someone-elses-extension.chromiumapp.org/",
        plume,
      ),
      false,
    );
  });
});
