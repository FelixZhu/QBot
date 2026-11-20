import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { assertNode24, loadConfig } from "./config.ts";
import { createPool } from "./db.ts";
import { SERVER_PERSONA } from "./runtime/persona.ts";
import { createDshEngine, openaiBase } from "./runtime/dsh.ts";
import { startChatServer } from "./server.ts";
import { createStore } from "./store.ts";

export async function main(): Promise<void> {
  assertNode24();
  const config = loadConfig(process.env);
  const pool = createPool(config.databaseUrl);
  const dshHome = process.env.QBOT_DSH_HOME?.trim() || path.join(process.cwd(), "var", "dsh-home");
  mkdirSync(dshHome, { recursive: true });
  const runtime = createDshEngine({
    model: config.model,
    persona: SERVER_PERSONA,
    apiKey: config.openRouterApiKey,
    fixture: config.fixtureUpstream,
    openaiBaseUrl: openaiBase(config.fixtureUpstreamUrl, config.fixtureUpstream),
    dshHome,
  });
  const started = await startChatServer({ config, store: createStore(pool), runtime });
  console.log(`qbot-chat listening host=${config.host} port=${started.port} upstream=${runtime.id} model=${config.model} node=${process.versions.node}`);
  const shutdown = () => {
    void started.close().then(() => pool.end()).then(() => process.exit(0), () => process.exit(1));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "qbot-chat failed to start");
    process.exit(1);
  });
}
