import { assertNode24, loadConfig } from "./config.ts";
import { createPool } from "./db.ts";
import { assertPublicOrigin, issueSetupCode } from "./setup-code.ts";
import { createStore } from "./store.ts";

/** Print one setup code. The owner token stays in the environment file. */
async function main(): Promise<void> {
  assertNode24();
  const config = loadConfig(process.env);
  const origin = assertPublicOrigin(process.env.QBOT_PUBLIC_ORIGIN ?? "");
  const pool = createPool(config.databaseUrl);
  try {
    const setup = await issueSetupCode(createStore(pool), origin);
    process.stdout.write(`${setup}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "device-code failed");
  process.exit(1);
});
