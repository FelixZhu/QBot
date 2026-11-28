import { createCardImportStore } from "./card-import/store.ts";
import { createLocalZipStore } from "./card-import/uploads.ts";
import { createCardImportWorker } from "./card-import/worker.ts";
import type { Config } from "./config.ts";
import { createObjectStore } from "./feed/objects.ts";
import { createFeedStore } from "./feed/store.ts";
import { createChatServer, listen, type ChatServerDeps } from "./http.ts";
import { SERVER_PERSONA } from "./runtime/persona.ts";
import type { ChatStore } from "./store.ts";

const CAPABILITY_PURGE_MS = 10 * 60_000;

export async function startChatServer(deps: ChatServerDeps): Promise<{ port: number; close: () => Promise<void> }> {
  await deps.store.ensureOwner(deps.config.ownerId);
  await deps.store.ensureAgent(deps.config.ownerId, SERVER_PERSONA, deps.config.model);
  await deps.store.failStaleRuns();
  const objects = deps.objects ?? createObjectStore({
    objectRoot: deps.config.objectRoot,
    oss: deps.config.oss,
    publicOss: deps.config.publicOss,
  });
  const zipStore = deps.zipStore ?? createLocalZipStore(deps.config.importDir);
  const cardImports = deps.cardImports ?? (deps.pool ? createCardImportStore(deps.pool) : undefined);
  const cardImportWorker = deps.cardImportWorker
    ?? (cardImports ? createCardImportWorker({ store: cardImports, zips: zipStore, objects }) : undefined);
  if (cardImportWorker) {
    await cardImportWorker.start();
  }
  const server = createChatServer({ ...deps, objects, zipStore, cardImports, cardImportWorker });
  const port = await listen(server, deps.config.host, deps.config.port);
  const purgeTimer = deps.pool
    ? setInterval(() => {
      void createFeedStore(deps.pool!).purgeExpiredCapabilities().catch(() => {});
    }, CAPABILITY_PURGE_MS)
    : null;
  purgeTimer?.unref();
  return {
    port,
    close: async () => {
      if (purgeTimer) clearInterval(purgeTimer);
      if (cardImportWorker) await cardImportWorker.stop();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          server.closeAllConnections?.();
          resolve();
        }, 5_000);
        timer.unref();
        server.close((error) => {
          clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        });
        server.closeIdleConnections?.();
      });
      await deps.runtime.close();
    },
  };
}

export type { Config, ChatStore };
