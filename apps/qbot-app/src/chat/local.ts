import { localReply, type DemoId } from "../demos.ts";
import { throwIfAborted, type ChatTransport } from "./transport.ts";

/** Local script only. Yields two deltas; nothing is sent to a model or network. */
export function createLocalTransport(id: DemoId): ChatTransport {
  return {
    label: "本地演示",
    reply(history, signal) {
      const last = [...history].reverse().find((turn) => turn.role === "user")?.text ?? "";
      const reply = localReply(id, last);
      const mid = Math.max(1, Math.ceil(reply.length / 2));
      return (async function* () {
        throwIfAborted(signal);
        yield reply.slice(0, mid);
        throwIfAborted(signal);
        yield reply.slice(mid);
      })();
    },
  };
}
