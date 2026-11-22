import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_KEY_PREFIX, objectKey } from "./feed/objects.ts";
import { loadManifest, seedRoot } from "./seed-cards.ts";

/** Print the private-bucket keys and hashes. This process does not upload and does not change ACLs. */
export async function seedKeyLines(root = seedRoot()): Promise<string[]> {
  const manifest = await loadManifest(root);
  const lines: string[] = [];
  for (const card of manifest.cards) {
    for (const file of card.files) {
      const key = objectKey(DEFAULT_KEY_PREFIX, card.artifactId, card.version, file.path);
      if (!key) throw new Error("seed object key was rejected");
      lines.push(`${key} sha256=${file.sha256}`);
    }
  }
  return lines;
}

async function main(): Promise<void> {
  const lines = await seedKeyLines();
  for (const line of lines) console.log(line);
  console.log(`${lines.length} objects under ${DEFAULT_KEY_PREFIX}. Upload with the existing helper. This command does not contact the bucket.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "seed keys failed");
    process.exit(1);
  });
}
