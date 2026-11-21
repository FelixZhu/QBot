import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { authorizeOss, normalizePrefix, objectKey, parseOssEndpoint } from "./feed/objects.ts";
import { loadManifest, seedRoot } from "./seed-cards.ts";

/** Upload the seed bundles into the private bucket. Does not delete objects or change ACLs of anything else. */
export async function uploadSeed(options: {
  bucket: string;
  endpointHost: string;
  accessKeyId: string;
  accessKeySecret: string;
  keyPrefix: string;
  root?: string;
  fetchImpl?: typeof fetch;
}): Promise<number> {
  const manifest = await loadManifest(options.root ?? seedRoot());
  const fetchImpl = options.fetchImpl ?? fetch;
  let count = 0;
  for (const card of manifest.cards) {
    for (const file of card.files) {
      const key = objectKey(options.keyPrefix, card.artifactId, file.path);
      if (!key) throw new Error("seed object key was rejected");
      const bytes = await readFile(path.join(options.root ?? seedRoot(), "bundles", card.dir, file.path));
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (sha256 !== file.sha256) throw new Error("seed file changed before upload");
      const signed = authorizeOss({
        method: "PUT",
        bucket: options.bucket,
        key,
        endpointHost: options.endpointHost,
        accessKeyId: options.accessKeyId,
        accessKeySecret: options.accessKeySecret,
        date: new Date().toUTCString(),
        contentType: file.contentType,
        aclPrivate: true,
      });
      const put = await fetchImpl(signed.url, {
        method: "PUT",
        headers: { ...signed.headers, "Content-Length": String(bytes.length) },
        body: bytes,
        redirect: "manual",
      });
      if (put.status !== 200) {
        await put.arrayBuffer().catch(() => {});
        throw new Error(`upload failed status=${put.status}`);
      }
      const check = authorizeOss({
        method: "GET",
        bucket: options.bucket,
        key,
        endpointHost: options.endpointHost,
        accessKeyId: options.accessKeyId,
        accessKeySecret: options.accessKeySecret,
        date: new Date().toUTCString(),
      });
      const got = await fetchImpl(check.url, { headers: check.headers, redirect: "manual" });
      const body = Buffer.from(await got.arrayBuffer());
      if (got.status !== 200 || createHash("sha256").update(body).digest("hex") !== sha256) {
        throw new Error(`upload verify failed status=${got.status}`);
      }
      count += 1;
      console.log(`${card.artifactId} ${file.path} sha256=${sha256} bytes=${bytes.length}`);
    }
  }
  return count;
}

function ossFromEnv(env: NodeJS.ProcessEnv) {
  if ((env.QBOT_OBJECT_ROOT ?? "").trim()) throw new Error("Unset QBOT_OBJECT_ROOT before uploading");
  const accessKeyId = (env.QBOT_OSS_ACCESS_KEY_ID ?? "").trim();
  const accessKeySecret = (env.QBOT_OSS_ACCESS_KEY_SECRET ?? "").trim();
  const bucket = (env.QBOT_OSS_BUCKET ?? "").trim();
  const endpoint = (env.QBOT_OSS_ENDPOINT ?? "").trim();
  if (!accessKeyId || !accessKeySecret || !bucket || !endpoint) throw new Error("OSS settings are incomplete");
  return {
    bucket,
    endpointHost: parseOssEndpoint(endpoint),
    accessKeyId,
    accessKeySecret,
    keyPrefix: normalizePrefix((env.QBOT_OSS_KEY_PREFIX ?? "").trim() || "qbot-cards/"),
  };
}

async function main(): Promise<void> {
  if (process.env.QBOT_SEED_CONFIRM !== "cards") throw new Error("Set QBOT_SEED_CONFIRM=cards to upload the two bundles");
  const count = await uploadSeed(ossFromEnv(process.env));
  console.log(`uploaded ${count} objects`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "upload failed");
    process.exit(1);
  });
}
