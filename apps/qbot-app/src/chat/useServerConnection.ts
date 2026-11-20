import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { configuredOrigin } from "./serverEndpoint.ts";
import { createServerClient, type ServerMessage, type ServerSession } from "./serverClient.ts";
import { openChat, type ConnectionView, type ReadyConnection } from "./serverSession.ts";
import {
  OPENING_LABEL,
  STALE_LABEL,
  SYNCING_LABEL,
  THREAD_CACHE_KEY,
  nextThread,
  parseThreadCache,
  serializeThreadCache,
  trimMessages,
  type ThreadCache,
} from "./threadCache.ts";

const MISSING = "这一版没有带上服务器地址";
const jsStart = Date.now();

export type ThreadView = ConnectionView & {
  messages: ServerMessage[];
  /** Bumps only when the visible messages should be replaced in the mounted runtime. */
  revision: number;
  sync: "syncing" | "idle" | "stale";
};

const EMPTY_SESSION: ServerSession = {
  ownerId: "",
  agentId: "",
  model: "",
  upstream: "openrouter",
};

function cachedReady(origin: string, cache: ThreadCache, sync: ThreadView["sync"]): ThreadView {
  return {
    phase: "ready",
    origin,
    token: "",
    session: EMPTY_SESSION,
    conversationId: cache.conversationId,
    client: createServerClient({ origin }),
    messages: cache.messages,
    revision: 1,
    sync,
  };
}

async function remember(cache: ThreadCache): Promise<void> {
  await AsyncStorage.setItem(THREAD_CACHE_KEY, serializeThreadCache(cache));
}

export function syncLabel(view: ThreadView): string | null {
  if (view.phase === "checking") return OPENING_LABEL;
  if (view.phase !== "ready") return null;
  if (view.sync === "syncing") return SYNCING_LABEL;
  if (view.sync === "stale") return STALE_LABEL;
  return null;
}

export function useServerConnection() {
  const [view, setView] = useState<ThreadView>({
    phase: "checking",
    messages: [],
    revision: 0,
    sync: "idle",
  });
  useEffect(() => {
    const origin = configuredOrigin();
    if (!origin) {
      setView({ phase: "error", message: MISSING, messages: [], revision: 0, sync: "idle" });
      return;
    }
    let cancel = false;
    (async () => {
      const cache = parseThreadCache(await AsyncStorage.getItem(THREAD_CACHE_KEY));
      if (cancel) return;
      if (cache) {
        console.log(`QBOT_TIMING cache ${Date.now() - jsStart}`);
        setView(cachedReady(origin, cache, "syncing"));
      }
      try {
        const ready = await openChat({ origin, preferredId: cache?.conversationId });
        const messages = trimMessages(await ready.client.listMessages(ready.conversationId));
        await remember({ conversationId: ready.conversationId, messages });
        if (cancel) return;
        if (!cache) console.log(`QBOT_TIMING network ${Date.now() - jsStart}`);
        setView((current) => {
          const sameThread = current.phase === "ready" && current.conversationId === ready.conversationId;
          const thread = nextThread(
            { messages: sameThread ? current.messages : [], revision: sameThread ? current.revision : 0 },
            messages,
          );
          return { ...ready, ...thread };
        });
      } catch (error) {
        if (cancel) return;
        const message = error instanceof Error ? error.message : "无法连接服务器";
        setView((current) => {
          if (current.phase === "ready" && current.messages.length) return { ...current, sync: "stale" };
          return { phase: "error", message, messages: [], revision: 0, sync: "idle" };
        });
      }
    })();
    return () => { cancel = true; };
  }, []);
  const startNewConversation = useCallback(async () => {
    if (view.phase !== "ready") throw new Error("还没有连上服务器");
    const created = await view.client.createConversation();
    if (!created.id) throw new Error("服务器没有返回新会话");
    const next: ThreadView = {
      ...view,
      conversationId: created.id,
      messages: [],
      sync: "idle",
      revision: view.revision + 1,
    };
    setView(next);
    await AsyncStorage.removeItem(THREAD_CACHE_KEY);
  }, [view]);
  return { view, startNewConversation };
}

export type { ReadyConnection };
