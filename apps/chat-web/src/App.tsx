import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  QueueItemPrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useLocalRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type KeyboardEvent as RKeyboardEvent } from "react";
import { toModelAdapter, type ChatBackend } from "./backend";
import { MockBackend, type MockMode } from "./mock";
import { webSpeechVoice, type VoiceSession } from "./voice";
import { BrandMark, IconBack, IconKeyboard, IconMic, IconSend } from "./icons";

/* ---------- demo config (URL: ?mock=stream|whole&mockDelay=ms) ---------- */
const params = new URLSearchParams(location.search);
const MODE_KEY = "qc_mock_mode";
function initialMode(): MockMode {
  const q = params.get("mock");
  if (q === "stream" || q === "whole") return q;
  return localStorage.getItem(MODE_KEY) === "stream" ? "stream" : "whole";
}
const fixedDelay = params.get("mockDelay") ? Number(params.get("mockDelay")) : undefined;

/* ---------- small pieces ---------- */
const hhmm = (d?: Date) =>
  d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "";

function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<number>();
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setMsg(null), 1600);
  }, []);
  return { msg, show };
}

function Thinking() {
  const [long, setLong] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setLong(true), 15000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="qc-thinking" role="status" aria-live="polite">
      <span className="mark"><b /><i /></span>
      <span className="t">
        QBot 正在想
        {long && <span className="long">还在整理，大约 1 分钟</span>}
      </span>
    </div>
  );
}

function MarkdownText() {
  return <MarkdownTextPrimitive className="qc-md" remarkPlugins={[remarkGfm]} />;
}

function Time() {
  const createdAt = useAuiState((s) => s.message.createdAt);
  return <span>{hhmm(createdAt)}</span>;
}

function UserMessage() {
  // "已发送" under the newest user message while QBot is still working on it.
  const pending = useAuiState((s) => {
    const msgs = s.thread.messages;
    return s.thread.isRunning && msgs.length >= 2 && msgs[msgs.length - 2]?.id === s.message.id;
  });
  return (
    <MessagePrimitive.Root className="qc-row me">
      <div className="qc-bubble">
        <MessagePrimitive.Parts />
      </div>
      <div className="qc-ts r">{pending ? "已发送" : <Time />}</div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="qc-row bot">
      <div className="qc-bot">
        <BrandMark className="av" />
        <div className="body">
          <MessagePrimitive.Parts>
            {({ part }) => {
              if (part.type !== "text") return null;
              // Synthetic empty running part = no text yet: show the thinking state.
              if (part.status?.type === "running" && part.text === "") return <Thinking />;
              return <MarkdownText />;
            }}
          </MessagePrimitive.Parts>
        </div>
      </div>
      <div className="qc-ts"><Time /></div>
    </MessagePrimitive.Root>
  );
}

/* ---------- composer: text is always available; voice only when the browser can do it ---------- */
function Composer({ toast }: { toast: (m: string) => void }) {
  const aui = useAui();
  const voiceOk = webSpeechVoice.available();
  const [keyboard, setKeyboard] = useState(true);
  const [rec, setRec] = useState<null | { started: number; cancel: boolean }>(null);
  const [secs, setSecs] = useState(0);
  const session = useRef<VoiceSession | null>(null);
  const startY = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const text = useAuiState((s) => s.composer.text);

  // Queue behind a running reply instead of interrupting it.
  const send = useCallback(() => {
    const c = aui.composer();
    if (!c.getState().text.trim()) return;
    c.send({ steer: false });
  }, [aui]);

  useEffect(() => {
    if (!rec) return;
    const t = window.setInterval(() => setSecs(Math.floor((Date.now() - rec.started) / 1000)), 250);
    return () => window.clearInterval(t);
  }, [rec]);

  const onMicDown = (e: RPointerEvent<HTMLButtonElement>) => {
    if (!voiceOk) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    setSecs(0);
    setRec({ started: Date.now(), cancel: false });
    session.current = webSpeechVoice.start({
      onText: (t) => {
        aui.composer().setText(t);
        send();
      },
      onError: () => toast("这台设备暂时用不了语音，先打字"),
      onEnd: () => {
        session.current = null;
        setRec(null);
      },
    });
  };
  const onMicMove = (e: RPointerEvent<HTMLButtonElement>) => {
    if (!rec) return;
    const cancel = startY.current - e.clientY > 60;
    if (cancel !== rec.cancel) setRec({ ...rec, cancel });
  };
  const onMicUp = () => {
    if (!rec || !session.current) return;
    if (rec.cancel) session.current.cancel();
    else session.current.stop();
  };

  const onKey = (e: RKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const grow = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.setProperty("height", "auto", "important");
    el.style.setProperty("height", Math.min(el.scrollHeight, 140) + "px", "important");
  }, []);

  useEffect(() => {
    if (keyboard) {
      inputRef.current?.focus({ preventScroll: true });
      grow();
    }
  }, [keyboard, text, grow]);

  if (!voiceOk || keyboard) {
    return (
      <ComposerPrimitive.Root className="qc-composer kb" onSubmit={(e) => { e.preventDefault(); send(); }}>
        {voiceOk && (
          <button type="button" className="qc-side" aria-label="切换到语音" onClick={() => setKeyboard(false)}>
            <IconMic size={22} />
          </button>
        )}
        <ComposerPrimitive.Input ref={inputRef} className="qc-field" rows={1} submitMode="none"
          placeholder="发消息…" onKeyDown={onKey} onInput={grow} />
        <button type="button" className="qc-send" aria-label="发送" disabled={!text.trim()} onClick={send}>
          <IconSend />
        </button>
      </ComposerPrimitive.Root>
    );
  }
  return (
    <div className="qc-composer voice">
      {rec && (
        <div className={"qc-recbar" + (rec.cancel ? " cancel" : "")}>
          <span className="wave">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ animationDelay: `${(i % 6) * 90}ms` }} />)}</span>
          <span className="tm">{`0:${String(secs).padStart(2, "0")}`}</span>
          <span className="hint">{rec.cancel ? "松开取消" : "上滑取消"}</span>
        </div>
      )}
      <div className="qc-voice-row">
        <div className="qc-mic-wrap">
          <button type="button" className={"qc-mic" + (rec ? " rec" : "")} aria-label="按住说话"
            onPointerDown={onMicDown} onPointerMove={onMicMove} onPointerUp={onMicUp} onPointerCancel={onMicUp}>
            <IconMic size={28} />
          </button>
          <div className="qc-mic-hint">{rec ? "松开发送" : "按住说话 · 上滑取消"}</div>
        </div>
        <button type="button" className="qc-side aa" aria-label="切换到键盘" onClick={() => setKeyboard(true)}>
          <IconKeyboard />
        </button>
      </div>
    </div>
  );
}

function Queued() {
  return (
    <ComposerPrimitive.Queue>
      {() => (
        <div className="qc-row me queued">
          <div className="qc-bubble"><QueueItemPrimitive.Text /></div>
          <div className="qc-ts r">已发送 · 排队中</div>
        </div>
      )}
    </ComposerPrimitive.Queue>
  );
}

/* ---------- one local thread. Rows come only from messages that already exist. ---------- */
type Listed = { preview: string; time: string };

function textOf(message: ThreadMessageLike) {
  const content = message.content;
  if (typeof content === "string") return content;
  return content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function plain(text: string) {
  return text.replace(/[#>*_`|[\]()]/g, "").replace(/\s+/g, " ").trim();
}

function listTime(d?: Date) {
  if (!d || Number.isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return hhmm(d);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function listedFrom(messages: readonly ThreadMessageLike[]): Listed | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const preview = plain(textOf(messages[i]));
    if (!preview) continue;
    return { preview, time: listTime(messages[i].createdAt) };
  }
  return null;
}

function Home({ onOpen }: { onOpen: () => void }) {
  const messages = useAuiState((s) => s.thread.messages);
  const [query, setQuery] = useState("");
  const listed = listedFrom(messages);
  const q = query.trim().toLowerCase();
  const matched = !!listed && (!q || "qbot".includes(q) || listed.preview.toLowerCase().includes(q));
  return (
    <div className="qc">
      <header className="qc-homebar">
        <div>
          <h1>对话</h1>
          <p>QBot</p>
        </div>
      </header>
      <label className="qc-search">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
          <path d="m16 16 4 4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索对话"
          aria-label="搜索对话"
          enterKeyHint="search"
          autoComplete="off"
        />
      </label>
      <div className="qc-list" aria-label="会话列表">
        {matched && listed ? (
          <button type="button" className="qc-conv" onClick={onOpen}>
            <span className="av"><BrandMark /></span>
            <span className="t">
              <span className="top">
                <span className="n">QBot</span>
                {listed.time ? <span className="tm">{listed.time}</span> : null}
              </span>
              <span className="m">{listed.preview}</span>
            </span>
          </button>
        ) : q ? (
          <div className="qc-empty" role="status">
            <b>没有匹配的会话</b>
            <p>换个词，或清空搜索。</p>
          </div>
        ) : (
          <div className="qc-empty" role="status">
            <b>还没有会话</b>
            <p>这里只列出已经发生的对话。现在没有消息，也不会放上示例助手。</p>
            <button type="button" className="qc-open" onClick={onOpen}>打开 QBot</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadScreen({ onBack }: { onBack: () => void }) {
  const { msg, show } = useToast();
  const [scrolled, setScrolled] = useState(false);
  const count = useAuiState((s) => s.thread.messages.length);
  return (
    <main className="qc">
      <header className={"qc-topbar" + (scrolled ? " is-scrolled" : "")}>
        <button type="button" className="qc-back" aria-label="返回会话列表" onClick={onBack}>
          <IconBack />
        </button>
        <span className="title">QBot</span>
      </header>
      <ThreadPrimitive.Root className="qc-thread">
        <ThreadPrimitive.Viewport className="qc-viewport"
          onScroll={(e) => setScrolled((e.currentTarget as HTMLDivElement).scrollTop > 4)}>
          <div className="qc-msgs">
            <p className="qc-note">回复是本地模拟，没有接通外部助手。</p>
            {count === 0 && <p className="qc-emptyline">还没有消息。</p>}
            <ThreadPrimitive.Messages>
              {({ message }) => (message.role === "user" ? <UserMessage /> : <AssistantMessage />)}
            </ThreadPrimitive.Messages>
            <Queued />
          </div>
        </ThreadPrimitive.Viewport>
        <Composer toast={show} />
      </ThreadPrimitive.Root>
      {msg && <div className="qc-toast" role="status">{msg}</div>}
    </main>
  );
}

/* ---------- root ---------- */
export function ChatApp() {
  const backend = useMemo(() => new MockBackend(initialMode(), fixedDelay), []);
  const backendRef = useRef<ChatBackend>(backend);
  const adapter = useMemo(() => toModelAdapter(() => backendRef.current), []);
  const runtime = useLocalRuntime(adapter, { unstable_enableMessageQueue: true });
  const [screen, setScreen] = useState<"list" | "thread">("list");

  useLayoutEffect(() => {
    const root = document.getElementById("qbs");
    if (!root) return;
    root.classList.toggle("qbs-in-chat", screen === "thread");
    return () => root.classList.remove("qbs-in-chat");
  }, [screen]);

  useEffect(() => {
    window.qbotChat = {
      back: () => {
        if (screen === "thread") {
          setScreen("list");
          return true;
        }
        return false;
      },
    };
  }, [screen]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {screen === "list" ? <Home onOpen={() => setScreen("thread")} /> : <ThreadScreen onBack={() => setScreen("list")} />}
    </AssistantRuntimeProvider>
  );
}

declare global {
  interface Window {
    qbotChat?: { back(): boolean };
  }
}
