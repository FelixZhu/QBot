import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { defaultSchemaPath, loadImportValidator, validateManifestSchema } from "../src/card-import/schema.ts";

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(serviceRoot, "../..");

test("runtime schema ships inside the service tree and matches the published contract", () => {
  const runtime = path.resolve(defaultSchemaPath());
  const relative = path.relative(serviceRoot, runtime);
  assert.equal(relative, path.join("docs", "card-package", "v1.schema.json"));
  assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative));

  const published = path.join(repoRoot, "docs", "card-package", "v1.schema.json");
  assert.equal(readFileSync(runtime).equals(readFileSync(published)), true);

  const validate = loadImportValidator();
  assert.equal(typeof validate, "function");
  const errors = validateManifestSchema({ protocol: "not-a-card-package" });
  assert.ok(errors.length > 0);
});
