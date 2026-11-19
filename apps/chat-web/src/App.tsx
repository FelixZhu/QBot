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

type DemoId = "info" | "english" | "study";
type DemoLine = { role: "user" | "assistant"; text: string };
type Demo = {
  id: DemoId;
  name: string;
  preview: string;
  note: string;
  messages: DemoLine[];
  suggestions: string[];
};

/* Scripted demos. Not Qian's chats, not live bots, and not real news. */
const DEMOS: Demo[] = [
  {
    id: "info",
    name: "Info Bot",
    preview: "演示：虚构简报，不是实时新闻",
    note: "演示会话，没有接通 Info Bot。下面是虚构示例，不是新闻、引用、日期或价格。",
    messages: [
      { role: "user", text: "演示：给我看一条资讯简报" },
      { role: "assistant", text: "演示回复：这是虚构示例。\n\n1. 示例小镇把周末市集延长到傍晚。\n2. 示例图书馆增加了一个晚间阅览室。\n3. 示例出版社出了一本讲笔记方法的小书。\n\n没有来源，也没有价格。" },
    ],
    suggestions: ["演示：再给一条更短的简报", "演示：把第二条改成一句话"],
  },
  {
    id: "english",
    name: "English Bot",
    preview: "演示：工作邮件句子可以更自然",
    note: "演示会话，没有接通 English Bot。用来练习工作英语，不是你的真实邮件。",
    messages: [
      { role: "user", text: "演示：请改这句工作邮件：I am write to follow up the file." },
      { role: "assistant", text: "演示回复：这句可以更自然。\n\n改写：I am writing to follow up on the file.\n\n更礼貌：Could you let me know if you had a chance to review the file?" },
    ],
    suggestions: ["演示：Send me the file now 这样说礼貌吗", "演示：再给一个更正式的开头"],
  },
  {
    id: "study",
    name: "Study Bot",
    preview: "演示：用一句话说明 AI Agent",
    note: "演示会话，没有接通 Study Bot。只讲概念，不读取资料或私人记录。",
    messages: [
      { role: "user", text: "演示：用一句话说明 AI Agent" },
      { role: "assistant", text: "演示回复：AI Agent 是能按一个目标自己拆步骤、使用工具，并检查结果的程序。普通问答只回答一句，Agent 会继续把事情做完。" },
    ],
    suggestions: ["演示：Agent 和聊天机器人有什么差别", "演示：用生活例子说明工具调用"],
  },
];

function localReply(id: DemoId, text: string) {
  if (id === "info") {
    return text.includes("一句话")
      ? "演示回复：示例图书馆今晚多开一间阅览室。虚构示例，没有接通 Info Bot。"
      : "演示回复：再补一条虚构简报：示例小镇的周末市集增加了手作摊位。不是实时新闻，没有价格。";
  }
  if (id === "english") {
    return text.toLowerCase().includes("send me")
      ? "演示回复：Send me the file now 偏生硬。更礼貌：Could you send me the file when you have a moment?"
      : "演示回复：更正式的开头可以是：I hope you are well. I am writing to follow up on our last note.";
  }
  return text.includes("差别")
    ? "演示回复：聊天机器人停在一句回答。Agent 会自己选择下一步，并使用工具完成目标。这是概念示例。"
    : "演示回复：生活例子：你说“订一张去示例城的票”，Agent 会查时刻、比较方案，再把结果交给你确认。没有接通 Study Bot。";
}

function Home({
  threads,
  onOpen,
}: {
  threads: Record<DemoId, DemoLine[]>;
  onOpen: (id: DemoId) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const rows = DEMOS.filter((demo) => {
    const last = threads[demo.id][threads[demo.id].length - 1]?.text || demo.preview;
    return !q || demo.name.toLowerCase().includes(q) || last.toLowerCase().includes(q) || demo.preview.toLowerCase().includes(q);
  });
  return (
    <div className="qc">
      <header className="qc-homebar">
        <div>
          <h1>对话</h1>
          <p>演示</p>
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
        {rows.length ? rows.map((demo) => {
          const last = threads[demo.id][threads[demo.id].length - 1];
          return (
            <button type="button" key={demo.id} className="qc-conv" onClick={() => onOpen(demo.id)}>
              <span className="av"><BrandMark /></span>
              <span className="t">
                <span className="top">
                  <span className="n">{demo.name}</span>
                  <span className="qc-demo">演示</span>
                </span>
                <span className="m">{plain(last?.text || demo.preview)}</span>
              </span>
            </button>
          );
        }) : (
          <div className="qc-empty" role="status">
            <b>没有匹配的会话</b>
            <p>换个词，或清空搜索。</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DemoThread({
  demo,
  lines,
  onBack,
  onSend,
}: {
  demo: Demo;
  lines: DemoLine[];
  onBack: () => void;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const send = (value: string) => {
    const next = value.trim();
    if (!next) return;
    onSend(next);
    setText("");
  };
  return (
    <main className="qc">
      <header className="qc-topbar">
        <button type="button" className="qc-back" aria-label="返回会话列表" onClick={onBack}>
          <IconBack />
        </button>
        <span className="title">{demo.name}</span>
        <span className="qc-demo">演示</span>
      </header>
      <div className="qc-thread">
        <div className="qc-viewport">
          <div className="qc-msgs">
            <p className="qc-note">{demo.note}</p>
            {lines.map((line, i) => line.role === "user" ? (
              <div className="qc-row me" key={i}>
                <div className="qc-bubble">{line.text}</div>
              </div>
            ) : (
              <div className="qc-row bot" key={i}>
                <div className="qc-bot">
                  <BrandMark className="av" />
                  <div className="body">{line.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="qc-suggest">
          {demo.suggestions.map((item) => (
            <button type="button" key={item} onClick={() => send(item)}>{item}</button>
          ))}
        </div>
        <form className="qc-composer kb" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <textarea className="qc-field" rows={1} value={text} placeholder="发消息…"
            aria-label="发消息" onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="qc-send" aria-label="发送" disabled={!text.trim()}>
            <IconSend />
          </button>
        </form>
      </div>
    </main>
  );
}

/* ---------- root ---------- */
export function ChatApp() {
  const [screen, setScreen] = useState<"list" | DemoId>("list");
  const [threads, setThreads] = useState<Record<DemoId, DemoLine[]>>(() => ({
    info: DEMOS[0].messages,
    english: DEMOS[1].messages,
    study: DEMOS[2].messages,
  }));
  const open = DEMOS.find((demo) => demo.id === screen) || null;

  useLayoutEffect(() => {
    const root = document.getElementById("qbs");
    if (!root) return;
    root.classList.toggle("qbs-in-chat", screen !== "list");
    return () => root.classList.remove("qbs-in-chat");
  }, [screen]);

  useEffect(() => {
    window.qbotChat = {
      back: () => {
        if (screen !== "list") {
          setScreen("list");
          return true;
        }
        return false;
      },
    };
  }, [screen]);

  const send = (id: DemoId, text: string) => {
    setThreads((prev) => ({
      ...prev,
      [id]: [...prev[id], { role: "user", text }, { role: "assistant", text: localReply(id, text) }],
    }));
  };

  if (!open) return <Home threads={threads} onOpen={setScreen} />;
  return (
    <DemoThread
      demo={open}
      lines={threads[open.id]}
      onBack={() => setScreen("list")}
      onSend={(text) => send(open.id, text)}
    />
  );
}

declare global {
  interface Window {
    qbotChat?: { back(): boolean };
  }
}
