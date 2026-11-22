import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { memoryCatalog } from "../src/card-import/catalog.ts";
import { dryRunPackage } from "../src/card-import/validate.ts";
import { IDEMPOTENCY_KEY, OWNER_ID } from "./build-package.ts";

const FIXTURE_DIGEST = "82f187db3454e6f290c1d7653891cab11c436bbc3514fa44cd1b86e2c965c5c5";

describe("python packer cross-check", () => {
  it("accepts the reference fixture and recomputes the same contentDigest", async () => {
    const root = fileURLToPath(new URL("../../..", import.meta.url));
    const packer = join(root, "tools/card-package/qbot_card_pack.py");
    const fixture = join(root, "tools/card-package/fixture");
    const dir = mkdtempSync(join(tmpdir(), "qbot-card-"));
    const zipPath = join(dir, "fixture.zip");
    try {
      const output = execFileSync("python3", [packer, "build", fixture, "-o", zipPath], { encoding: "utf8" });
      const packed = JSON.parse(output) as { contentDigest: string };
      assert.equal(packed.contentDigest, FIXTURE_DIGEST);
      const result = await dryRunPackage({
        body: readFileSync(zipPath),
        idempotencyKey: IDEMPOTENCY_KEY,
        ownerId: OWNER_ID,
        catalog: memoryCatalog({ ownerId: OWNER_ID, slugs: ["example-bot"] }),
      });
      assert.deepEqual(result.errors, [], JSON.stringify(result.errors));
      assert.equal(result.state, "validated");
      assert.equal(result.contentDigest, FIXTURE_DIGEST);
      assert.equal(result.manifestDigest, "20eeee2d9d5b49433665e91a42d1ad6d11ef494ef3825acc4f4e3c30bc3f287a");
      assert.equal(result.sample, true);
      assert.equal(result.commitAllowed, false);
      assert.equal(result.publishAllowed, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
