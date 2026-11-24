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

/** Thread list against the conversation endpoints. Archive is not on the server. */
export function createRemoteThreadListAdapter(client: ServerClient): RemoteThreadListAdapter {
  const fetchOne = async (remoteId: string): Promise<ServerConversation> => {
    if (client.getConversation) return client.getConversation(remoteId);
    const conversations = await client.listConversations();
    const item = conversations.find((row) => row.id === remoteId);
    if (!item) throw new Error("没有这则会话");
    return item;
  };
  return {
    storeKey: client.origin,
    async list() {
      const conversations = await client.listConversations();
      return { threads: conversations.map(meta) };
    },
    async fetch(remoteId) {
      return meta(await fetchOne(remoteId));
    },
    async initialize() {
      const created = await client.createConversation();
      if (!created.id) throw new Error("服务器没有返回新会话");
      return { remoteId: created.id };
    },
    async rename(remoteId, newTitle) {
      if (!client.renameConversation) throw new Error("服务器不能改标题");
      await client.renameConversation(remoteId, newTitle);
    },
    async archive() {
      throw new Error("服务器不能归档");
    },
    async delete(remoteId) {
      if (!client.deleteConversation) throw new Error("服务器不能删除");
      await client.deleteConversation(remoteId);
    },
    async generateTitle(remoteId) {
      return createAssistantStream(async (controller) => {
        const item = await fetchOne(remoteId).catch(() => null);
        const title = item?.title || "新对话";
        controller.appendText(title);
      });
    },
  };
}
