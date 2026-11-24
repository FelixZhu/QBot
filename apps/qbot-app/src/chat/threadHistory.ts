import type { ThreadHistoryAdapter } from "@assistant-ui/react-native";
import type { ServerClient, ServerMessage } from "./serverClient.ts";
import { toRepository } from "./serverHistory.ts";
import {
  OPENING_LABEL,
  STALE_LABEL,
  SYNCING_LABEL,
  messagesEqual,
  trimMessages,
} from "./threadCache.ts";

export function createCachedHistory(input: {
  getId: () => string | null;
  isBusy?: () => boolean;
  client: ServerClient;
  onSync: (label: string | null) => void;
  importNow: (id: string, messages: ServerMessage[]) => void;
  readCache: (id: string) => Promise<ServerMessage[] | null>;
  writeCache: (id: string, messages: ServerMessage[]) => Promise<void>;
}): ThreadHistoryAdapter {
  return {
    async load() {
      const id = input.getId();
      if (!id) return { headId: null, messages: [] };
      const cached = await input.readCache(id);
      const pull = input.client.listMessages(id).then(async (messages) => {
        const trimmed = trimMessages(messages);
        await input.writeCache(id, trimmed);
        return trimmed;
      });
      if (cached && cached.length) {
        input.onSync(SYNCING_LABEL);
        void pull.then((messages) => {
          if (input.getId() !== id) return;
          input.onSync(null);
          if (input.isBusy?.()) return;
          if (!messagesEqual(cached, messages)) input.importNow(id, messages);
        }).catch(() => {
          if (input.getId() === id) input.onSync(STALE_LABEL);
        });
        return toRepository(cached);
      }
      input.onSync(OPENING_LABEL);
      try {
        const messages = await pull;
        if (input.getId() === id) input.onSync(null);
        return toRepository(messages);
      } catch (error) {
        if (input.getId() === id) input.onSync(null);
        throw error;
      }
    },
    async append() {},
    async update() {},
  };
}
