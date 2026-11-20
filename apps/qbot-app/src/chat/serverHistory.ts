import type { ExportedMessageRepository, ExportedMessageRepositoryItem, ThreadHistoryAdapter } from "@assistant-ui/react-native";
import type { ServerMessage } from "./serverClient.ts";

/** Read-only view of server messages. The server is the copy that survives a restart. */
export function createServerHistory(load: () => Promise<ServerMessage[]>): ThreadHistoryAdapter {
  return {
    load: async () => toRepository(await load()),
    append: async () => {},
    update: async () => {},
  };
}

export function toRepository(messages: readonly ServerMessage[]): ExportedMessageRepository {
  const items: ExportedMessageRepositoryItem[] = [];
  let parentId: string | null = null;
  for (const message of messages) {
    const id = message.id;
    const text = message.content || (message.status === "complete" ? "" : "服务器没有完成这条回复。");
    const createdAt = new Date(message.createdAt);
    const metadata = { custom: { serverStatus: message.status } };
    const content = [{ type: "text" as const, text }];
    const item: ExportedMessageRepositoryItem = message.role === "user"
      ? {
        parentId,
        message: {
          id,
          role: "user",
          createdAt,
          content,
          attachments: [],
          metadata: { custom: metadata.custom },
        },
      }
      : {
        parentId,
        message: {
          id,
          role: "assistant",
          createdAt,
          content,
          status: message.status === "complete"
            ? { type: "complete", reason: "stop" }
            : { type: "incomplete", reason: "error" },
          metadata: {
            unstable_state: null,
            unstable_annotations: [],
            unstable_data: [],
            steps: [],
            custom: metadata.custom,
          },
        },
      };
    items.push(item);
    parentId = id;
  }
  return { headId: parentId, messages: items };
}
