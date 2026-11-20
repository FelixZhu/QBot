import { createAssistantStream } from "assistant-stream";
import type { RemoteThreadListAdapter } from "@assistant-ui/react-native";
import type { ServerClient, ServerConversation } from "./serverClient.ts";

function meta(item: ServerConversation) {
  return {
    status: "regular" as const,
    remoteId: item.id,
    title: item.title || "新对话",
    lastMessageAt: new Date(item.updatedAt),
  };
}

/** Thread list against the existing conversation endpoints. Rename, archive, and delete are not on the server. */
export function createRemoteThreadListAdapter(client: ServerClient): RemoteThreadListAdapter {
  return {
    storeKey: client.origin,
    async list() {
      const conversations = await client.listConversations();
      return { threads: conversations.map(meta) };
    },
    async fetch(remoteId) {
      const conversations = await client.listConversations();
      const item = conversations.find((row) => row.id === remoteId);
      if (!item) throw new Error("没有这则会话");
      return meta(item);
    },
    async initialize() {
      const created = await client.createConversation();
      if (!created.id) throw new Error("服务器没有返回新会话");
      return { remoteId: created.id };
    },
    async rename() {
      throw new Error("服务器不能改标题");
    },
    async archive() {
      throw new Error("服务器不能归档");
    },
    async delete() {
      throw new Error("服务器不能删除");
    },
    async generateTitle(remoteId) {
      return createAssistantStream(async (controller) => {
        const conversations = await client.listConversations();
        const title = conversations.find((row) => row.id === remoteId)?.title || "新对话";
        controller.appendText(title);
      });
    },
  };
}
