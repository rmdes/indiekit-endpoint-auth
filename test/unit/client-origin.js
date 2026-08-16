import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";

import { getClientInformation } from "../../lib/client.js";

// Deliberately free of `@indiekit-test/*` helpers: those live in the upstream
// monorepo and are unavailable here, so the other unit tests in this package
// cannot run. Stubbing `fetch` keeps this one executable.
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * Record whether discovering a client fetches its `client_id`
 * @param {string} clientId - Client ID
 * @param {string} [body] - Response body to serve
 * @returns {Promise<{fetched: boolean, client: object}>} Result
 */
const discover = async (
  clientId,
  body = "<html><head></head><body><p>x</p></body></html>",
) => {
  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    return new Response(body, { status: 200 });
  };

  const client = await getClientInformation(clientId);
  return { fetched, client };
};

describe("endpoint-auth/lib/client fetchable origins", () => {
  it("Fetches clients identified by a domain name", async () => {
    for (const clientId of [
      "https://client.example/",
      "https://abc.de/",
      "http://client.example:3000/",
      "https://sub.domain.client.example/path",
    ]) {
      const { fetched } = await discover(clientId);
      assert.equal(fetched, true, `expected ${clientId} to be fetched`);
    }
  });

  it("Refuses every IP literal, not only internal ones", async () => {
    // A client identifier host name must be a domain name; IP addresses are
    // not permitted except loopback, which must not be fetched. So none of
    // these is a valid client_id and none is worth fetching.
    for (const clientId of [
      "https://8.8.8.8/",
      "https://1.1.1.1/",
      "https://[2606:4700::1111]/",
      "http://localhost:3000/",
      "http://127.0.0.1/",
      "http://[::1]/",
      "http://0.0.0.0/",
      "http://10.0.0.5/",
      "http://172.16.0.1/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[fd00::1]/",
    ]) {
      const { fetched } = await discover(clientId);
      assert.equal(fetched, false, `expected ${clientId} not to be fetched`);
    }
  });

  it("Refuses numeric host encodings of internal addresses", async () => {
    // Resolved by the system resolver, but not recognised by `net.isIP`
    for (const clientId of [
      "http://2130706433/",
      "http://0x7f000001/",
      "http://0177.0.0.1/",
    ]) {
      const { fetched } = await discover(clientId);
      assert.equal(fetched, false, `expected ${clientId} not to be fetched`);
    }
  });

  it("Refuses non-HTTP schemes", async () => {
    for (const clientId of ["file:///etc/passwd", "gopher://internal/"]) {
      const { fetched } = await discover(clientId);
      assert.equal(fetched, false, `expected ${clientId} not to be fetched`);
    }
  });

  it("Falls back to information derived from `client_id`", async () => {
    const { client } = await discover("http://169.254.169.254/");
    assert.equal(client.name, "169.254.169.254");
    assert.equal(client.id, "http://169.254.169.254/");
  });

  it("Returns fallback rather than throwing on unusable responses", async () => {
    // `mf2()` throws on an empty or non-HTML body; a client serving JSON or
    // nothing at all must not fail the whole authorization request
    for (const body of ['{"foo":"bar"}', "hello", ""]) {
      const { client } = await discover("https://client.example/", body);
      assert.equal(client.name, "client.example");
    }
  });

  it("Returns fallback when the client cannot be reached", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };

    const client = await getClientInformation("https://client.example/");
    assert.equal(client.name, "client.example");
  });
});
