import { randomUUID } from "node:crypto";
import type pg from "pg";
import { HttpError } from "./errors.ts";
import { LIMITS } from "./limits.ts";
import type { HistoryTurn } from "./runtime/context.ts";
import { createPool, type Queryable } from "./db.ts";

export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "pending" | "failed" | "cancelled";
  createdAt: string;
};

export type AgentRecord = {
  id: string;
  model: string;
};

export type BegunTurn = {
  assistantId: string;
  runId: string;
  persona: string;
  model: string;
  dshSessionId: string | null;
  history: HistoryTurn[];
};

const AGENT_SLUG = "qbot";

type MessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: StoredMessage["status"];
  created_at: Date;
};

export type ChatStore = {
  health(): Promise<boolean>;
  ensureOwner(ownerId: string): Promise<void>;
  ensureAgent(ownerId: string, persona: string, model: string): Promise<AgentRecord>;
  getAgent(ownerId: string): Promise<AgentRecord>;
  failStaleRuns(): Promise<void>;
  listConversations(ownerId: string): Promise<Conversation[]>;
  createConversation(ownerId: string, title: string): Promise<Conversation>;
  listMessages(ownerId: string, conversationId: string, limit: number): Promise<StoredMessage[]>;
  beginTurn(ownerId: string, conversationId: string, text: string): Promise<BegunTurn>;
  finishTurn(ownerId: string, assistantId: string, runId: string, status: "complete" | "failed" | "cancelled", content: string): Promise<void>;
  setDshSession(ownerId: string, conversationId: string, sessionId: string): Promise<void>;
  createEnrollment(codeHash: Buffer, expiresAt: Date): Promise<void>;
  redeemEnrollment(codeHash: Buffer, deviceId: string, tokenHash: Buffer): Promise<boolean>;
  deviceActive(tokenHash: Buffer): Promise<boolean>;
  revokeDevice(deviceId: string): Promise<boolean>;
  listDevices(): Promise<{ id: string; createdAt: string; revoked: boolean }[]>;
};

export function createStore(pool: pg.Pool): ChatStore {
  return {
    async health() {
      await pool.query("SELECT 1");
      return true;
    },
    async ensureOwner(ownerId) {
      await pool.query("INSERT INTO owners (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [ownerId]);
    },
    async ensureAgent(ownerId, persona, model) {
      const result = await pool.query<{ id: string; model: string }>(
        `INSERT INTO agents (id, owner_id, slug, persona, model)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (owner_id, slug) DO UPDATE SET persona = EXCLUDED.persona, model = EXCLUDED.model
         RETURNING id, model`,
        [randomUUID(), ownerId, AGENT_SLUG, persona, model],
      );
      const row = result.rows[0];
      if (!row) throw new HttpError(500, "persist", "数据库没有完成写入");
      return row;
    },
    async getAgent(ownerId) {
      const result = await pool.query<{ id: string; model: string }>(
        "SELECT id, model FROM agents WHERE owner_id = $1 AND slug = $2",
        [ownerId, AGENT_SLUG],
      );
      const row = result.rows[0];
      if (!row) throw new HttpError(500, "persist", "数据库没有完成写入");
      return row;
    },
    async failStaleRuns() {
      await pool.query("UPDATE messages SET status = 'failed' WHERE status = 'pending'");
      await pool.query("UPDATE runs SET status = 'failed', finished_at = now() WHERE status = 'running'");
    },
    async listConversations(ownerId) {
      const result = await pool.query<{ id: string; title: string; created_at: Date; updated_at: Date }>(
        `SELECT id, title, created_at, updated_at
         FROM conversations
         WHERE owner_id = $1
         ORDER BY updated_at DESC, id DESC
         LIMIT $2`,
        [ownerId, LIMITS.conversations],
      );
      return result.rows.map(toConversation);
    },
    async createConversation(ownerId, title) {
      const count = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM conversations WHERE owner_id = $1", [ownerId]);
      if ((count.rows[0]?.n ?? 0) >= LIMITS.conversations) {
        throw new HttpError(409, "limit", "会话数量已达上限");
      }
      const result = await pool.query<{ id: string; title: string; created_at: Date; updated_at: Date }>(
        `INSERT INTO conversations (id, owner_id, agent_id, title)
         SELECT $1, a.owner_id, a.id, $3
         FROM agents a
         WHERE a.owner_id = $2 AND a.slug = $4
         RETURNING id, title, created_at, updated_at`,
        [randomUUID(), ownerId, title, AGENT_SLUG],
      );
      const row = result.rows[0];
      if (!row) throw new HttpError(500, "persist", "数据库没有完成写入");
      return toConversation(row);
    },
    async listMessages(ownerId, conversationId, limit) {
      const owned = await pool.query("SELECT 1 FROM conversations WHERE id = $1 AND owner_id = $2", [conversationId, ownerId]);
      if (owned.rowCount !== 1) throw new HttpError(404, "not_found", "没有这则会话");
      const result = await pool.query<MessageRow>(
        `SELECT id, role, content, status, created_at
         FROM messages
         WHERE conversation_id = $1 AND owner_id = $2
         ORDER BY seq DESC
         LIMIT $3`,
        [conversationId, ownerId, limit],
      );
      return result.rows.reverse().map(toMessage);
    },
    async beginTurn(ownerId, conversationId, text) {
      return transaction(pool, async (query) => {
        const convo = await query<{ title: string; persona: string; model: string; dsh_session_id: string | null }>(
          `SELECT c.title, c.dsh_session_id, a.persona, a.model
           FROM conversations c
           JOIN agents a ON a.id = c.agent_id AND a.owner_id = c.owner_id
           WHERE c.id = $1 AND c.owner_id = $2
           FOR UPDATE OF c`,
          [conversationId, ownerId],
        );
        if (convo.rowCount !== 1) throw new HttpError(404, "not_found", "没有这则会话");
        const pending = await query("SELECT 1 FROM messages WHERE conversation_id = $1 AND status = 'pending' LIMIT 1", [conversationId]);
        if ((pending.rowCount ?? 0) > 0) throw new HttpError(409, "busy", "上一条还在生成");
        const count = await query<{ n: number }>("SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1", [conversationId]);
        if ((count.rows[0]?.n ?? 0) >= LIMITS.messagesPerConversation) {
          throw new HttpError(409, "limit", "这则会话的消息已达上限");
        }
        const runId = randomUUID();
        const runInsert = await query(
          `INSERT INTO runs (id, owner_id, agent_id, conversation_id, kind, status)
           SELECT $1::uuid, c.owner_id, c.agent_id, c.id, 'interactive', 'running'
           FROM conversations c
           WHERE c.id = $2::uuid AND c.owner_id = $3::uuid`,
          [runId, conversationId, ownerId],
        );
        if (runInsert.rowCount !== 1) throw new HttpError(500, "persist", "数据库没有完成写入");
        const userInsert = await query(
          `INSERT INTO messages (id, conversation_id, owner_id, run_id, role, content, status)
           SELECT $1::uuid, c.id, c.owner_id, $2::uuid, 'user', $3, 'complete'
           FROM conversations c
           WHERE c.id = $4::uuid AND c.owner_id = $5::uuid`,
          [randomUUID(), runId, text, conversationId, ownerId],
        );
        if (userInsert.rowCount !== 1) throw new HttpError(500, "persist", "数据库没有完成写入");
        const assistantId = randomUUID();
        const assistantInsert = await query(
          `INSERT INTO messages (id, conversation_id, owner_id, run_id, role, content, status)
           SELECT $1::uuid, c.id, c.owner_id, $2::uuid, 'assistant', '', 'pending'
           FROM conversations c
           WHERE c.id = $3::uuid AND c.owner_id = $4::uuid`,
          [assistantId, runId, conversationId, ownerId],
        );
        if (assistantInsert.rowCount !== 1) throw new HttpError(500, "persist", "数据库没有完成写入");
        const currentTitle = convo.rows[0]?.title ?? "新对话";
        const title = currentTitle === "新对话" ? clipTitle(text) : currentTitle;
        await query("UPDATE conversations SET title = $2, updated_at = now() WHERE id = $1", [conversationId, title]);
        const history = await query<{ role: "user" | "assistant"; content: string }>(
          `SELECT role, content
           FROM messages
           WHERE conversation_id = $1 AND owner_id = $2 AND status = 'complete' AND role IN ('user', 'assistant')
           ORDER BY seq DESC
           LIMIT $3`,
          [conversationId, ownerId, LIMITS.contextMessages],
        );
        const agent = convo.rows[0];
        if (!agent) throw new HttpError(500, "persist", "数据库没有完成写入");
        return {
          assistantId,
          runId,
          persona: agent.persona,
          model: agent.model,
          dshSessionId: agent.dsh_session_id,
          history: history.rows.reverse().filter((row) => row.content.length > 0),
        };
      });
    },
    async finishTurn(ownerId, assistantId, runId, status, content) {
      await transaction(pool, async (query) => {
        const message = await query(
          `UPDATE messages
           SET content = $3, status = $4
           WHERE id = $1 AND owner_id = $2 AND status = 'pending'`,
          [assistantId, ownerId, content, status],
        );
        if (message.rowCount !== 1) throw new HttpError(500, "persist", "回复没有写入数据库");
        const run = await query(
          `UPDATE runs
           SET status = $3, finished_at = now()
           WHERE id = $1 AND owner_id = $2 AND status = 'running'`,
          [runId, ownerId, status],
        );
        if (run.rowCount !== 1) throw new HttpError(500, "persist", "回复没有写入数据库");
      });
    },
    async setDshSession(ownerId, conversationId, sessionId) {
      const result = await pool.query(
        `UPDATE conversations
         SET dsh_session_id = $3
         WHERE id = $1 AND owner_id = $2 AND (dsh_session_id IS NULL OR dsh_session_id = $3)`,
        [conversationId, ownerId, sessionId],
      );
      if (result.rowCount !== 1) throw new HttpError(500, "persist", "数据库没有完成写入");
    },
    async createEnrollment(codeHash, expiresAt) {
      await pool.query(
        "INSERT INTO enrollment_codes (id, code_hash, expires_at) VALUES ($1, $2, $3)",
        [randomUUID(), codeHash, expiresAt],
      );
    },
    async redeemEnrollment(codeHash, deviceId, tokenHash) {
      return transaction(pool, async (query) => {
        const updated = await query(
          `UPDATE enrollment_codes
           SET used_at = now()
           WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
           RETURNING id`,
          [codeHash],
        );
        if (updated.rowCount !== 1) return false;
        await query(
          "INSERT INTO devices (id, token_hash) VALUES ($1, $2)",
          [deviceId, tokenHash],
        );
        return true;
      });
    },
    async deviceActive(tokenHash) {
      const result = await pool.query(
        "SELECT 1 FROM devices WHERE token_hash = $1 AND revoked_at IS NULL",
        [tokenHash],
      );
      return (result.rowCount ?? 0) === 1;
    },
    async revokeDevice(deviceId) {
      const result = await pool.query(
        "UPDATE devices SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL",
        [deviceId],
      );
      return (result.rowCount ?? 0) === 1;
    },
    async listDevices() {
      const result = await pool.query<{ id: string; created_at: Date; revoked_at: Date | null }>(
        "SELECT id, created_at, revoked_at FROM devices ORDER BY created_at DESC LIMIT 20",
      );
      return result.rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at.toISOString(),
        revoked: row.revoked_at != null,
      }));
    },
  };
}

export async function transaction<T>(pool: pg.Pool, run: (query: Queryable["query"]) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const result = await run((sql, params) => client.query(sql, params));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

export function clipTitle(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const clipped = [...flat].slice(0, 40).join("");
  return clipped || "新对话";
}

function toConversation(row: { id: string; title: string; created_at: Date; updated_at: Date }): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

export { createPool };
