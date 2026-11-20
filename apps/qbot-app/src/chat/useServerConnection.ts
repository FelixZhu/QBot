import { useCallback, useEffect, useState } from "react";
import { configuredOrigin } from "./serverEndpoint.ts";
import { openChat, type ConnectionView } from "./serverSession.ts";

const MISSING = "这一版没有带上服务器地址";

export function useServerConnection() {
  const [view, setView] = useState<ConnectionView>({ phase: "checking" });
  useEffect(() => {
    const origin = configuredOrigin();
    if (!origin) {
      setView({ phase: "error", message: MISSING });
      return;
    }
    let cancel = false;
    openChat({ origin }).then((next) => {
      if (!cancel) setView(next);
    }).catch((error: unknown) => {
      if (!cancel) setView({ phase: "error", message: error instanceof Error ? error.message : "无法连接服务器" });
    });
    return () => { cancel = true; };
  }, []);
  const startNewConversation = useCallback(async () => {
    if (view.phase !== "ready") throw new Error("还没有连上服务器");
    const created = await view.client.createConversation();
    if (!created.id) throw new Error("服务器没有返回新会话");
    setView({ ...view, conversationId: created.id });
  }, [view]);
  return { view, startNewConversation };
}
