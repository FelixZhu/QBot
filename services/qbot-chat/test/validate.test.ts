import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryCatalog } from "../src/card-import/catalog.ts";
import { dryRunPackage } from "../src/card-import/validate.ts";
import { buildZip, IDEMPOTENCY_KEY, OWNER_ID, packageFiles } from "./build-package.ts";
import { tinyPng, writeZip } from "./zip-writer.ts";

const allowed = memoryCatalog({ ownerId: OWNER_ID, slugs: ["example-bot"] });

async function run(zip: Buffer, catalog = allowed, idempotencyKey: string | undefined = IDEMPOTENCY_KEY) {
  return dryRunPackage({ body: zip, idempotencyKey, ownerId: OWNER_ID, catalog });
}

function codes(errors: { code: string }[]): string[] {
  return errors.map((error) => error.code);
}

describe("card package dry-run", () => {
  it("accepts a package built in the test and keeps commit and publish closed", async () => {
    const result = await run(buildZip());
    assert.deepEqual(codes(result.errors), []);
    assert.equal(result.state, "validated");
    assert.equal(result.botSlug, "example-bot");
    assert.equal(result.cardKey, "example-card-key");
    assert.equal(result.contentVersion, 2);
    assert.equal(result.expectedPreviousVersion, 1);
    assert.match(result.contentDigest ?? "", /^[0-9a-f]{64}$/);
    assert.match(result.manifestDigest ?? "", /^[0-9a-f]{64}$/);
    assert.equal(result.sample, true);
    assert.equal(result.commitAllowed, false);
    assert.equal(result.publishAllowed, false);
    assert.equal(result.visibility, "hidden");
    assert.equal(result.notification, "not-authorized");
    assert.deepEqual(result.implemented, { dryRun: true, stage: false, commit: false, publish: false });
    assert.equal(result.versionCheck, "unavailable");
  });

  it("still passes when the quote is only contiguous after whitespace collapse", async () => {
    const html = `<!doctype html><html><body><p id="c1">测试结论\n一句话</p></body></html>`;
    const result = await run(buildZip({ html }));
    assert.equal(result.state, "validated");
  });

  it("rejects an unknown field", async () => {
    const result = await run(buildZip({ edit: (manifest) => { manifest.extra = true; } }));
    assert.equal(result.state, "rejected");
    assert.ok(codes(result.errors).includes("unknown_field"));
  });

  it("rejects exampleOnly, importable, and note on a real import", async () => {
    const result = await run(buildZip({
      edit: (manifest) => {
        manifest.exampleOnly = true;
        manifest.importable = false;
        manifest.note = "placeholder";
      },
    }));
    assert.equal(result.state, "rejected");
    assert.equal(codes(result.errors).filter((code) => code === "unknown_field").length, 3);
  });

  it("rejects protocolMinor other than 0", async () => {
    const result = await run(buildZip({ edit: (manifest) => { manifest.protocolMinor = 1; } }));
    assert.equal(result.state, "rejected");
    assert.ok(codes(result.errors).includes("protocol"));
  });

  it("rejects a timezone other than Asia/Shanghai and an hour outside 00-23", async () => {
    const timezone = await run(buildZip({ edit: (manifest) => { manifest.timezone = "UTC"; } }));
    assert.ok(codes(timezone.errors).includes("schema"));
    const quiet = await run(buildZip({
      edit: (manifest) => {
        (manifest.notification as { quietHours: { start: string } }).quietHours.start = "24:00";
      },
    }));
    assert.equal(quiet.state, "rejected");
    assert.ok(codes(quiet.errors).includes("schema"));
  });

  it("rejects a digest mismatch", async () => {
    const result = await run(buildZip({
      afterDigest: (manifest) => {
        const digest = manifest.contentDigest as { value: string };
        digest.value = digest.value.replace(/^./, digest.value.startsWith("a") ? "b" : "a");
      },
    }));
    assert.equal(result.state, "rejected");
    assert.ok(codes(result.errors).includes("digest"));
  });

  it("rejects a script tag, an iframe, and more than 2000 elements", async () => {
    const html = `<!doctype html><html><body><script>1</script><p id="c1">测试结论 一句话</p></body></html>`;
    const result = await run(buildZip({ html }));
    assert.equal(result.state, "rejected");
    assert.ok(result.errors.some((error) => error.code === "html" && error.message.includes("script")));
    const frame = await run(buildZip({
      html: `<!doctype html><html><body><iframe src="https://example.com/a"></iframe><p id="c1">测试结论 一句话</p></body></html>`,
    }));
    assert.ok(frame.errors.some((error) => error.message.includes("iframe")));
    const crowded = `<!doctype html><html><body><p id="c1">测试结论 一句话</p>${"<b></b>".repeat(2001)}</body></html>`;
    const limited = await run(buildZip({ html: crowded }));
    assert.ok(limited.errors.some((error) => error.message.includes("2000")));
  });

  it("rejects an on* attribute", async () => {
    const html = `<!doctype html><html><body><p id="c1" onclick="1">测试结论 一句话</p></body></html>`;
    const result = await run(buildZip({ html }));
    assert.equal(result.state, "rejected");
    assert.ok(result.errors.some((error) => error.code === "html" && error.message.includes("onclick")));
  });

  it("rejects an http link and a javascript url", async () => {
    const http = await run(buildZip({
      html: `<!doctype html><html><body><p id="c1">测试结论 一句话</p><a href="http://example.com/a">x</a></body></html>`,
    }));
    assert.ok(http.errors.some((error) => error.code === "html" && error.message.includes("https")));
    const scriptUrl = await run(buildZip({
      html: `<!doctype html><html><body><p id="c1">测试结论 一句话</p><a href="javascript:alert(1)">x</a></body></html>`,
    }));
    assert.ok(scriptUrl.errors.some((error) => error.code === "html" && error.message.includes("javascript")));
  });

  it("rejects meta refresh", async () => {
    const html = `<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://example.com/a"></head><body><p id="c1">测试结论 一句话</p></body></html>`;
    const result = await run(buildZip({ html }));
    assert.ok(result.errors.some((error) => error.message.includes("meta refresh")));
  });

  it("rejects a missing anchor, a duplicate id, an anchor in template, and a quote mismatch", async () => {
    const missing = await run(buildZip({
      html: `<!doctype html><html><body><p id="other">测试结论 一句话</p></body></html>`,
    }));
    assert.ok(missing.errors.some((error) => error.code === "anchor" && error.message.includes("恰好")));
    const duplicate = await run(buildZip({
      html: `<!doctype html><html><body><p id="c1">测试结论 一句话</p><b id="c1">测试结论 一句话</b></body></html>`,
    }));
    assert.ok(duplicate.errors.some((error) => error.code === "anchor" && error.message.includes("恰好")));
    const template = await run(buildZip({
      html: `<!doctype html><html><body><template><p id="c1">测试结论 一句话</p></template></body></html>`,
    }));
    assert.ok(template.errors.some((error) => error.code === "anchor" && error.message.includes("template")));
    const quote = await run(buildZip({
      html: `<!doctype html><html><body><p id="c1">另一句话</p></body></html>`,
    }));
    assert.ok(quote.errors.some((error) => error.code === "anchor" && error.message.includes("quote")));
    const text = await run(buildZip({
      edit: (manifest) => {
        const claim = (manifest.claims as { text: string }[])[0];
        if (claim) claim.text = "不是引用";
      },
    }));
    assert.ok(text.errors.some((error) => error.code === "anchor" && error.message.includes("text")));
  });

  it("rejects a file hash mismatch and an http source url", async () => {
    const files = await run(buildZip({
      corruptEntry: { name: "work/assets/page.css", bytes: Buffer.from("body{}", "utf8") },
    }));
    assert.equal(files.state, "rejected");
    assert.ok(codes(files.errors).includes("files"));
    const source = await run(buildZip({
      edit: (manifest) => {
        (manifest.sources as { url: string }[])[0]!.url = "http://example.com/a";
      },
    }));
    assert.ok(codes(source.errors).includes("source"));
  });

  it("rejects a compression ratio above 100:1 before trusting the entry", async () => {
    const bomb = writeZip([
      { name: "manifest.json", data: Buffer.from("{}", "utf8") },
      { name: "work/assets/bomb.txt", data: Buffer.alloc(512 * 1024), method: 8 },
    ]);
    const result = await run(bomb);
    assert.deepEqual(codes(result.errors), ["compression_ratio"]);
  });

  it("rejects a symlink and a path that escapes the package", async () => {
    const link = writeZip([
      { name: "manifest.json", data: Buffer.from("{}", "utf8") },
      { name: "work/assets/link", data: Buffer.from("cover-light.png"), externalAttributes: (0o120777) << 16 },
    ]);
    assert.deepEqual(codes((await run(link)).errors), ["symlink"]);
    const escape = writeZip([
      { name: "../secret", data: Buffer.from("no") },
    ]);
    assert.deepEqual(codes((await run(escape)).errors), ["path"]);
    const absolute = writeZip([
      { name: "/tmp/secret", data: Buffer.from("no") },
    ]);
    assert.deepEqual(codes((await run(absolute)).errors), ["path"]);
  });

  it("rejects an owner field", async () => {
    const result = await run(buildZip({ edit: (manifest) => { manifest.owner = "not-from-auth"; } }));
    assert.equal(result.state, "rejected");
    assert.ok(codes(result.errors).includes("owner"));
  });

  it("rejects a botRef the owner cannot use", async () => {
    const foreign = memoryCatalog({ ownerId: OWNER_ID, slugs: ["other-bot"] });
    const result = await run(buildZip(), foreign);
    assert.equal(result.state, "rejected");
    assert.ok(codes(result.errors).includes("bot_ref"));
    assert.equal(result.versionCheck, "unavailable");
  });

  it("keeps versionCheck unavailable because card_package_versions is not created", async () => {
    const result = await run(buildZip());
    assert.equal(result.state, "validated");
    assert.equal(result.expectedPreviousVersion, 1);
    assert.equal(result.versionCheck, "unavailable");
    assert.equal(codes(result.errors).includes("version"), false);
  });

  it("rejects a mismatched Idempotency-Key and keeps sample from opening commit", async () => {
    const key = await run(buildZip(), allowed, "different-key");
    assert.ok(codes(key.errors).includes("idempotency"));
    const real = await run(buildZip({ edit: (manifest) => { manifest.sample = false; } }));
    assert.equal(real.state, "validated");
    assert.equal(real.sample, false);
    assert.equal(real.commitAllowed, false);
    assert.equal(real.publishAllowed, false);
  });

  it("rejects a cover that is not a light/dark pair or a single cover.png", async () => {
    const files = packageFiles();
    files.delete("cover-dark.png");
    const result = await run(buildZip({ files }));
    assert.ok(codes(result.errors).includes("cover"));
    const single = packageFiles();
    const light = single.get("cover-light.png") ?? tinyPng([1, 2, 3]);
    single.delete("cover-light.png");
    single.delete("cover-dark.png");
    single.set("cover.png", light);
    const ok = await run(buildZip({ files: single }));
    assert.equal(ok.state, "validated");
  });

  it("does not fetch source urls", async () => {
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("dry-run must not fetch");
    }) as typeof fetch;
    try {
      const result = await run(buildZip());
      assert.equal(result.state, "validated");
      assert.equal(called, false);
    } finally {
      globalThis.fetch = original;
    }
  });
});
