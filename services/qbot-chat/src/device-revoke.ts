import { assertNode24, loadConfig } from "./config.ts";
import { createPool } from "./db.ts";
import { createStore } from "./store.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Revoke one device by id. Does not print tokens. */
async function main(): Promise<void> {
  assertNode24();
  const id = process.argv[2] ?? "";
  const config = loadConfig(process.env);
  const pool = createPool(config.databaseUrl);
  try {
    const store = createStore(pool);
    if (!id) {
      const devices = await store.listDevices();
      for (const device of devices) process.stdout.write(`${device.id} ${device.revoked ? "revoked" : "active"}\n`);
      return;
    }
    if (!UUID.test(id)) throw new Error("需要设备 id");
    const revoked = await store.revokeDevice(id);
    process.stdout.write(revoked ? "revoked\n" : "not found\n");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "device-revoke failed");
  process.exit(1);
});
