import { pathToFileURL } from "node:url";

/** Kept so an old command cannot upload or change a bucket ACL. */
function main(): void {
  console.error("qbot-chat does not upload objects and does not change bucket ACLs. Run npm run seed-keys and use the existing OSS helper.");
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
