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
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type KeyboardEvent as RKeyboardEvent } from "react";
import { toModelAdapter, type ChatBackend } from "./backend";
import { MockBackend, type MockMode } from "./mock";
import { webSpeechVoice, type VoiceSession } from "./voice";
import { BrandMark, IconEdit, IconKeyboard, IconMenu, IconMic, IconMore, IconPlus, IconSend } from "./icons";

/* ---------- demo config (URL: ?mock=stream|whole&mockDelay=ms) ---------- */
const params = new URLSearchParams(location.search);
const MODE_KEY = "qc_mock_mode";
function initialMode(): MockMode {
  const q = params.get("mock");
  if (q === "stream" || q === "whole") return q;
  return localStorage.getItem(MODE_KEY) === "stream" ? "stream" : "whole";
}
const fixedDelay = params.get("mockDelay") ? Number(params.get("mockDelay")) : undefined;

/* ---------- sample conversation shown on first open ---------- */
function at(h: number, m: number) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}
const SAMPLE: ThreadMessageLike[] = [
  { role: "user", content: "帮我看下下周什么时候要续护照", createdAt: at(8, 10) },
  {
    role: "assistant",
    createdAt: at(8, 10),
    content:
      "**护照 2026-12-24 到期**，还有 37 天。续签要准备：\n\n1. 旧护照原件\n2. 身份证正反面\n3. 近 6 个月的白底证件照\n\n来源：`知识库 · 护照扫描件` 第 2 页。",
  },
  { role: "user", content: "好的，周五下午提醒我约一下", createdAt: at(8, 12) },
  {
    role: "assistant",
    createdAt: at(8, 12),
    content: "记下了：**周五 11-20 14:00** 提醒你预约续签，到时候会在「主动服务」里出现一张卡。",
  },
];

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

/* ---------- composer: voice first, keyboard second ---------- */
function Composer({ toast }: { toast: (m: string) => void }) {
  const aui = useAui();
  const [keyboard, setKeyboard] = useState(false);
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
    // Voice-first: after a typed message, fall back to the big mic. Typing only via the Aa button.
    setKeyboard(false);
  }, [aui]);

  useEffect(() => {
    if (!rec) return;
    const t = window.setInterval(() => setSecs(Math.floor((Date.now() - rec.started) / 1000)), 250);
    return () => window.clearInterval(t);
  }, [rec]);

  const onMicDown = (e: RPointerEvent<HTMLButtonElement>) => {
    if (!webSpeechVoice.available()) {
      toast("语音输入即将上线，先点 Aa 打字");
      return;
    }
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

  useEffect(() => {
    if (keyboard) inputRef.current?.focus();
  }, [keyboard]);

  if (keyboard) {
    return (
      <ComposerPrimitive.Root className="qc-composer kb" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <button type="button" className="qc-side" aria-label="切换到语音" onClick={() => setKeyboard(false)}>
          <IconMic size={22} />
        </button>
        <ComposerPrimitive.Input ref={inputRef} className="qc-field" rows={1} submitMode="none"
          placeholder="给 QBot 发消息" onKeyDown={onKey} />
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
        <button type="button" className="qc-side" aria-label="附件" onClick={() => toast("附件即将上线")}>
          <IconPlus />
        </button>
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


/* ---------- conversation list (pane on unfolded, drawer on folded) ---------- */
const CONVERSATIONS = [
  { id: "qbot", name: "QBot", last: "周五 14:00 提醒你预约续签", time: "08:12" },
  { id: "study", name: "AI Infra 学习", last: "第 3/30 天：KV Cache", time: "昨天" },
  { id: "trip", name: "出差 · 上海", last: "下周三 08:30 虹桥落地", time: "周日" },
];

function ConversationList({ onPick, toast }: { onPick: () => void; toast: (m: string) => void }) {
  return (
    <div className="qc-list">
      <div className="qc-list-head">
        <span className="title">对话</span>
        <button type="button" className="qc-iconbtn" aria-label="新对话" onClick={() => toast("Demo 里只有一个会话")}>
          <IconEdit />
        </button>
      </div>
      {CONVERSATIONS.map((c, i) => (
        <button type="button" key={c.id} className={"qc-conv" + (i === 0 ? " on" : "")}
          onClick={() => (i === 0 ? onPick() : toast("Demo 里只有一个会话"))}>
          <span className="av">{i === 0 ? <BrandMark /> : c.name.slice(0, 1)}</span>
          <span className="t"><span className="n">{c.name}</span><span className="m">{c.last}</span></span>
          <span className="tm">{c.time}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- root ---------- */
export function ChatApp() {
  const [mode, setMode] = useState<MockMode>(initialMode);
  const backend = useMemo(() => new MockBackend(initialMode(), fixedDelay), []);
  backend.mode = mode;
  const backendRef = useRef<ChatBackend>(backend);
  const adapter = useMemo(() => toModelAdapter(() => backendRef.current), []);
  const runtime = useLocalRuntime(adapter, { initialMessages: SAMPLE, unstable_enableMessageQueue: true });
  const { msg, show } = useToast();
  const [drawer, setDrawer] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    window.qbotChat = {
      back: () => {
        if (drawer) {
          setDrawer(false);
          return true;
        }
        return false;
      },
    };
  }, [drawer]);

  const toggleMode = () => {
    const next: MockMode = mode === "whole" ? "stream" : "whole";
    localStorage.setItem(MODE_KEY, next);
    setMode(next);
    show(next === "stream" ? "已切换：流式回复（模拟）" : "已切换：整段回复（模拟 webhook）");
  };

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className={"qc" + (drawer ? " is-drawer" : "")}>
        <aside className="qc-pane">
          <ConversationList onPick={() => setDrawer(false)} toast={show} />
        </aside>
        <div className="qc-scrim" onClick={() => setDrawer(false)} />
        <main className="qc-main">
          <header className={"qc-topbar" + (scrolled ? " is-scrolled" : "")}>
            <button type="button" className="qc-iconbtn only-folded" aria-label="会话列表" onClick={() => setDrawer(true)}>
              <IconMenu />
            </button>
            <span className="title">QBot</span>
            <button type="button" className="qc-iconbtn" aria-label="切换模拟回复方式" title={backend.label} onClick={toggleMode}>
              <IconMore />
            </button>
          </header>
          <ThreadPrimitive.Root className="qc-thread">
            <ThreadPrimitive.Viewport className="qc-viewport"
              onScroll={(e) => setScrolled((e.currentTarget as HTMLDivElement).scrollTop > 4)}>
              <div className="qc-msgs">
                <div className="qc-day">今天 08:10 · 演示数据，回复为模拟</div>
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
      </div>
    </AssistantRuntimeProvider>
  );
}

declare global {
  interface Window {
    qbotChat?: { back(): boolean };
  }
}
