import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AssistantRuntimeProvider,
  useAui,
  useAuiState,
  useLocalRuntime,
  useRemoteThreadListRuntime,
  useRuntimeAdapters,
  type RemoteThreadListAdapter,
} from "@assistant-ui/react-native";
import { resource, useResource, withKey } from "@assistant-ui/tap";
import { configuredOrigin } from "./serverEndpoint.ts";
import { createServerClient, type ServerClient, type ServerSession } from "./serverClient.ts";
import { messageUrl } from "./serverClient.ts";
import { toRepository } from "./serverHistory.ts";
import { createServerChatTransport } from "./liveTransport.ts";
import { toModelAdapter } from "./transport.ts";
import { createRemoteThreadListAdapter } from "./remoteThreads.ts";
import { createCachedHistory } from "./threadHistory.ts";
import {
  LAST_THREAD_KEY,
  OPENING_LABEL,
  parseThreadCache,
  serializeThreadCache,
  threadStorageKey,
} from "./threadCache.ts";

const SyncContext = createContext<string | null>(null);

export function useSyncLine(): string | null {
  return useContext(SyncContext);
}

const HistoryResource = resource(function useBoundHistory(
  client: ServerClient,
  onSync: (label: string | null) => void,
) {
  const aui = useAui();
  return useMemo(() => createCachedHistory({
    getId: () => {
      try {
        return aui.threadListItem.getState().remoteId ?? null;
      } catch {
        return null;
      }
    },
    client,
    onSync,
    importNow: (id, messages) => {
      try {
        if (aui.threadListItem.getState().remoteId !== id) return;
        aui.thread().import(toRepository(messages));
      } catch {
        // The keyed thread is gone. The next mount loads its own cache.
      }
    },
    readCache: async (id) => parseThreadCache(await AsyncStorage.getItem(threadStorageKey(id)))?.messages ?? null,
    writeCache: async (id, messages) => {
      await AsyncStorage.setItem(threadStorageKey(id), serializeThreadCache({ conversationId: id, messages }));
      await AsyncStorage.setItem(LAST_THREAD_KEY, id);
    },
  }), [aui, client, onSync]);
});

function useThreadHistoryAdapters(client: ServerClient, onSync: (label: string | null) => void) {
  const remoteId = useAuiState((state) => state.optional.threadListItem?.remoteId) ?? "pending";
  // withKey drops the previous thread's history loader when the id changes,
  // so a switch cannot paint the conversation we just left.
  const history = useResource(withKey(remoteId, HistoryResource(client, onSync)));
  return { history };
}

function useThreadRuntime(origin: string, client: ServerClient) {
  const inherited = useRuntimeAdapters();
  const aui = useAui();
  const transport = useMemo(() => createServerChatTransport({
    url: () => {
      let id: string | null = null;
      try {
        id = aui.threadListItem.getState().remoteId ?? null;
      } catch {
        id = null;
      }
      if (!id) throw new Error("会话还没有建好");
      return messageUrl(origin, id);
    },
  }), [aui, origin]);
  const model = useMemo(() => toModelAdapter(transport), [transport]);
  const fallback = useResource(withKey("local", HistoryResource(client, () => {})));
  return useLocalRuntime(model, { adapters: { history: inherited?.history ?? fallback } });
}

function ReadyRuntime({
  origin,
  initialThreadId,
  children,
}: {
  origin: string;
  initialThreadId?: string;
  children: ReactNode;
}) {
  const client = useMemo(() => createServerClient({ origin }), [origin]);
  const [sync, setSync] = useState<string | null>(null);
  const onSync = useRef(setSync).current;
  const adapter = useMemo<RemoteThreadListAdapter>(() => ({
    ...createRemoteThreadListAdapter(client),
    unstable_useAdapters() {
      return useThreadHistoryAdapters(client, onSync);
    },
  }), [client, onSync]);
  const runtimeHook = useMemo(() => function useServerThread() {
    return useThreadRuntime(origin, client);
  }, [client, origin]);
  const runtime = useRemoteThreadListRuntime({
    adapter,
    runtimeHook,
    initialThreadId,
    onThreadIdChange: (id) => {
      if (id) void AsyncStorage.setItem(LAST_THREAD_KEY, id);
    },
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SyncContext.Provider value={sync}>{children}</SyncContext.Provider>
    </AssistantRuntimeProvider>
  );
}

export type ChatBoot = {
  phase: "checking" | "error" | "ready";
  message?: string;
  session: ServerSession | null;
  initialThreadId?: string;
};

export function useChatBoot(): ChatBoot {
  const origin = configuredOrigin();
  const [boot, setBoot] = useState<ChatBoot>({ phase: "checking", session: null });
  useEffect(() => {
    if (!origin) {
      setBoot({ phase: "error", message: "这一版没有带上服务器地址", session: null });
      return;
    }
    let cancel = false;
    const client = createServerClient({ origin });
    (async () => {
      const [last, sessionResult, listResult] = await Promise.all([
        AsyncStorage.getItem(LAST_THREAD_KEY),
        client.session().then((session) => session).catch(() => null),
        client.listConversations().then((rows) => rows).catch(() => null),
      ]);
      if (cancel) return;
      if (!sessionResult && !listResult && !last) {
        setBoot({ phase: "error", message: "无法连接服务器", session: null });
        return;
      }
      const listed = listResult ?? [];
      const initialThreadId = (last && listed.some((row) => row.id === last) ? last : listed[0]?.id) || undefined;
      setBoot({
        phase: "ready",
        session: sessionResult,
        initialThreadId,
      });
    })();
    return () => { cancel = true; };
  }, [origin]);
  return boot;
}

export function ChatRuntime({
  boot,
  children,
}: {
  boot: ChatBoot;
  children: ReactNode;
}) {
  const origin = configuredOrigin() ?? "";
  if (boot.phase !== "ready") {
    return <SyncContext.Provider value={boot.phase === "checking" ? OPENING_LABEL : null}>{children}</SyncContext.Provider>;
  }
  return (
    <ReadyRuntime origin={origin} initialThreadId={boot.initialThreadId}>
      {children}
    </ReadyRuntime>
  );
}
