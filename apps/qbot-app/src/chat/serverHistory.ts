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
    items.push({
      parentId,
      message: {
        id,
        role: message.role,
        createdAt: new Date(message.createdAt),
        content: [{ type: "text", text }],
        status: message.status === "complete"
          ? { type: "complete", reason: "stop" }
          : { type: "incomplete", reason: "error" },
        metadata: { custom: { serverStatus: message.status } },
      },
    });
    parentId = id;
  }
  return { headId: parentId, messages: items };
}
