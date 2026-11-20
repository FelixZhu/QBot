import { useCallback, useEffect, useState } from "react";
import {
  clearConnection,
  enrollWithSetup,
  restoreConnection,
  type ConnectionView,
  type SecretStore,
  type SettingsStore,
} from "./serverSession.ts";

export function useServerConnection(deps: { secrets: SecretStore; settings: SettingsStore }) {
  const [view, setView] = useState<ConnectionView>({ phase: "unconfigured" });
  const reload = useCallback(async () => {
    const next = await restoreConnection(deps);
    setView(next);
  }, [deps.secrets, deps.settings]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const enroll = useCallback(async (setup: string) => {
    setView({ phase: "checking" });
    try {
      setView(await enrollWithSetup({ ...deps, setup }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法连接服务器";
      setView({ phase: "error", message });
      throw error;
    }
  }, [deps.secrets, deps.settings]);
  const clear = useCallback(async () => {
    await clearConnection(deps.secrets, deps.settings);
    setView({ phase: "unconfigured" });
  }, [deps.secrets, deps.settings]);
  return { view, enroll, clear, reload };
}
