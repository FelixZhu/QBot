import type { Config } from "./config.ts";
import { createChatServer, listen, type ChatServerDeps } from "./http.ts";
import { SERVER_PERSONA } from "./runtime/persona.ts";
import type { ChatStore } from "./store.ts";

export async function startChatServer(deps: ChatServerDeps): Promise<{ port: number; close: () => Promise<void> }> {
  await deps.store.ensureOwner(deps.config.ownerId);
  await deps.store.ensureAgent(deps.config.ownerId, SERVER_PERSONA, deps.config.model);
  await deps.store.failStaleRuns();
  const server = createChatServer(deps);
  const port = await listen(server, deps.config.host, deps.config.port);
  return {
    port,
    close: async () => {
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
