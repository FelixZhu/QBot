export type ServerSession = {
  ownerId: string;
  agentId: string;
  model: string;
  upstream: "openrouter" | "fixture";
};

export type ServerMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "pending" | "failed" | "cancelled";
  createdAt: string;
};

export type ServerConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ServerClient = {
  origin: string;
  session(): Promise<ServerSession>;
  listConversations(): Promise<ServerConversation[]>;
  getConversation?(conversationId: string): Promise<ServerConversation>;
  createConversation(): Promise<ServerConversation>;
  renameConversation?(conversationId: string, title: string): Promise<ServerConversation>;
  deleteConversation?(conversationId: string): Promise<void>;
  listMessages(conversationId: string): Promise<ServerMessage[]>;
};

export function createServerClient(options: { origin: string; token?: string; fetchImpl?: typeof fetch }): ServerClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const call = async (path: string, init?: RequestInit): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchImpl(`${options.origin}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch {
      throw new Error("无法连接服务器");
    }
    const text = await response.text();
    if (!response.ok) throw new Error(redact(errorMessage(response.status, text), options.token ?? ""));
    try {
      return text ? JSON.parse(text) as unknown : {};
    } catch {
      throw new Error("服务器返回了无法识别的响应");
    }
  };
  return {
    origin: options.origin,
    async session() {
      const body = await call("/v1/session") as Partial<ServerSession>;
      if (body.upstream !== "openrouter" && body.upstream !== "fixture") throw new Error("服务器没有说明上游");
      if (typeof body.model !== "string" || !body.model) throw new Error("服务器没有说明模型");
      if (typeof body.agentId !== "string" || typeof body.ownerId !== "string") throw new Error("服务器没有说明会话所有者");
      return { ownerId: body.ownerId, agentId: body.agentId, model: body.model, upstream: body.upstream };
    },
    async listConversations() {
      const body = await call("/v1/conversations") as { conversations?: ServerConversation[] };
      return Array.isArray(body.conversations) ? body.conversations : [];
    },
    async getConversation(conversationId) {
      return await call(`/v1/conversations/${conversationId}`) as ServerConversation;
    },
    async createConversation() {
      return await call("/v1/conversations", { method: "POST", body: "{}" }) as ServerConversation;
    },
    async renameConversation(conversationId, title) {
      return await call(`/v1/conversations/${conversationId}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      }) as ServerConversation;
    },
    async deleteConversation(conversationId) {
      await call(`/v1/conversations/${conversationId}`, { method: "DELETE" });
    },
    async listMessages(conversationId) {
      const body = await call(`/v1/conversations/${conversationId}/messages`) as { messages?: ServerMessage[] };
      return Array.isArray(body.messages) ? body.messages : [];
    },
  };
}

export function messageUrl(origin: string, conversationId: string): string {
  return `${origin}/v1/conversations/${conversationId}/messages`;
}

function errorMessage(status: number, text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: string } };
    if (typeof body.error?.message === "string" && body.error.message) return body.error.message;
  } catch {
    // Fall through to the status.
  }
  return `服务器返回 HTTP ${status}`;
}

function redact(text: string, token: string): string {
  return (token ? text.split(token).join("[redacted]") : text).slice(0, 300);
}
