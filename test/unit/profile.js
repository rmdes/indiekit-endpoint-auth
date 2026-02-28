import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { getProfileInformation } from "../../lib/profile.js";

describe("endpoint-auth/lib/profile", () => {
  it("Returns undefined for non-existent URL", async () => {
    const result = await getProfileInformation("https://nonexistent.example");

    assert.equal(result, undefined);
  });
});
