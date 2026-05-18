import { strict as assert } from "node:assert";
import { before, beforeEach, describe, it } from "node:test";

import { MockAgent, setGlobalDispatcher } from "undici";

import {
  _clearRedirectCache,
  validateRedirect,
} from "../../lib/redirect.js";

/**
 * Set up an undici MockAgent for cross-host fetch tests. Each test that
 * needs network access reaches into `agent` to intercept the next request.
 */
let agent;
before(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});

beforeEach(() => {
  _clearRedirectCache();
});

describe("endpoint-auth/lib/redirect", () => {
  it("Allows same-host redirect URIs without fetching", async () => {
    // No mock intercept registered — would throw if fetch were attempted.
    assert.equal(
      await validateRedirect(
        "https://client.example:3000/cb",
        "https://client.example:3000/redirect",
      ),
      true,
    );
  });

  it("Rejects different ports as different hosts (no declared URIs)", async () => {
    agent
      .get("https://client.example:8080")
      .intercept({ path: "/redirect" })
      .reply(200, "<html></html>");

    assert.equal(
      await validateRedirect(
        "https://client.example:3000/cb",
        "https://client.example:8080/redirect",
      ),
      false,
    );
  });

  it("Rejects www vs apex hosts when no declared URIs", async () => {
    agent
      .get("https://www.client.example")
      .intercept({ path: "/redirect" })
      .reply(200, "<html></html>");

    assert.equal(
      await validateRedirect(
        "https://client.example/cb",
        "https://www.client.example/redirect",
      ),
      false,
    );
  });

  it("Allows cross-host redirect when declared via <link rel=redirect_uri>", async () => {
    agent
      .get("https://rmdes.github.io")
      .intercept({ path: "/plume/" })
      .reply(
        200,
        `<!doctype html><html><head>
          <link rel="redirect_uri" href="https://abcdef.chromiumapp.org/">
        </head></html>`,
      );

    assert.equal(
      await validateRedirect(
        "https://abcdef.chromiumapp.org/",
        "https://rmdes.github.io/plume/",
      ),
      true,
    );
  });

  it("Allows cross-host redirect when declared via Link HTTP header", async () => {
    agent
      .get("https://rmdes.github.io")
      .intercept({ path: "/plume/" })
      .reply(200, "<html></html>", {
        headers: {
          link: '<https://ext.example/cb>; rel="redirect_uri"',
        },
      });

    assert.equal(
      await validateRedirect(
        "https://ext.example/cb",
        "https://rmdes.github.io/plume/",
      ),
      true,
    );
  });

  it("Allows wildcard subdomain pattern matching one DNS label", async () => {
    agent
      .get("https://rmdes.github.io")
      .intercept({ path: "/plume/" })
      .reply(
        200,
        `<link rel="redirect_uri" href="https://*.chromiumapp.org/">`,
      );

    assert.equal(
      await validateRedirect(
        "https://abc.chromiumapp.org/",
        "https://rmdes.github.io/plume/",
      ),
      true,
    );
  });

  it("Rejects wildcard pattern when request has too many subdomain labels", async () => {
    agent
      .get("https://rmdes.github.io")
      .intercept({ path: "/plume/" })
      .reply(
        200,
        `<link rel="redirect_uri" href="https://*.chromiumapp.org/">`,
      );

    assert.equal(
      await validateRedirect(
        "https://a.b.chromiumapp.org/",
        "https://rmdes.github.io/plume/",
      ),
      false,
    );
  });

  it("Rejects wildcard pattern when request has the apex (no subdomain)", async () => {
    agent
      .get("https://rmdes.github.io")
      .intercept({ path: "/plume/" })
      .reply(
        200,
        `<link rel="redirect_uri" href="https://*.chromiumapp.org/">`,
      );

    assert.equal(
      await validateRedirect(
        "https://chromiumapp.org/",
        "https://rmdes.github.io/plume/",
      ),
      false,
    );
  });

  it("Rejects when declared URI path does not match", async () => {
    agent
      .get("https://rmdes.github.io")
      .intercept({ path: "/plume/" })
      .reply(
        200,
        `<link rel="redirect_uri" href="https://ext.example/cb">`,
      );

    assert.equal(
      await validateRedirect(
        "https://ext.example/different",
        "https://rmdes.github.io/plume/",
      ),
      false,
    );
  });

  it("Rejects when declared URI scheme does not match", async () => {
    agent
      .get("https://rmdes.github.io")
      .intercept({ path: "/plume/" })
      .reply(
        200,
        `<link rel="redirect_uri" href="http://ext.example/cb">`,
      );

    assert.equal(
      await validateRedirect(
        "https://ext.example/cb",
        "https://rmdes.github.io/plume/",
      ),
      false,
    );
  });

  it("Rejects cross-host when no declared redirect_uri tags or headers", async () => {
    agent
      .get("https://client.example")
      .intercept({ path: "/" })
      .reply(200, "<html><head><title>no links</title></head></html>");

    assert.equal(
      await validateRedirect(
        "https://other.example/cb",
        "https://client.example/",
      ),
      false,
    );
  });

  it("Returns false when client_id fetch fails (non-2xx)", async () => {
    agent
      .get("https://client.example")
      .intercept({ path: "/" })
      .reply(404, "");

    assert.equal(
      await validateRedirect(
        "https://other.example/cb",
        "https://client.example/",
      ),
      false,
    );
  });

  it("Returns false on invalid URLs without throwing", async () => {
    assert.equal(await validateRedirect("not a url", "https://x/"), false);
    assert.equal(
      await validateRedirect("https://x/", "also not a url"),
      false,
    );
  });

  it("Caches declared redirect URIs across calls", async () => {
    // Only register one intercept; second call should not re-fetch.
    agent
      .get("https://rmdes.github.io")
      .intercept({ path: "/plume/" })
      .reply(
        200,
        `<link rel="redirect_uri" href="https://ext.example/cb">`,
      )
      .times(1);

    assert.equal(
      await validateRedirect(
        "https://ext.example/cb",
        "https://rmdes.github.io/plume/",
      ),
      true,
    );

    // Second call hits cache; no fetch, no intercept needed.
    assert.equal(
      await validateRedirect(
        "https://ext.example/cb",
        "https://rmdes.github.io/plume/",
      ),
      true,
    );
  });
});
