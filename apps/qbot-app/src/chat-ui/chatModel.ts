/**
 * Chat-page decisions that do not touch the network.
 * A file can sit in the composer. It never becomes the text the server receives.
 */

export const COPY_MARK_MS = 2000;
export const COPY_TOAST = "已复制到剪贴板";
export const VOICE_UNAVAILABLE = "暂未接通";
export const ASSISTANT_DISCLAIMER = "回复由 AI 生成，可能有误";
export const CAMERA_UNAVAILABLE = "这个安装包没有相机权限，不能直接拍照。可以选照片或文件。";
export const FILES_LOCAL = "只在这台手机上，没有上传，模型读不了。移除后才能发送文字。";
export const FILES_SHEET = "选中后只留在本机，不会上传，模型也读不了。";
export const LIBRARY_ONLY = "知识库只列出公开文件，还不能附进这条对话。";
export const PICKER_UNAVAILABLE = "这台安装包打不开系统选择器。";
export const DRAFT_LIMIT = 4;

export type DraftAttachment = {
  id: string;
  name: string;
  size: number;
  mime: string;
  /** Small jpeg preview. Never sent as the user message. */
  preview: string | null;
};

export type PickedWire = {
  name: string;
  size: number;
  mime: string;
  preview: string | null;
};

const PREVIEW_PREFIX = "data:image/jpeg;base64,";
const PREVIEW_LIMIT = 100_000;

export function sanitizePicked(input: unknown): PickedWire[] {
  if (!Array.isArray(input)) return [];
  const out: PickedWire[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" && record.name.trim()
      ? record.name.trim().slice(0, 180)
      : "未命名";
    const size = typeof record.size === "number" && Number.isFinite(record.size) && record.size >= 0
      ? Math.min(Math.round(record.size), Number.MAX_SAFE_INTEGER)
      : 0;
    const mime = typeof record.mime === "string" && record.mime.trim()
      ? record.mime.trim().slice(0, 120)
      : "application/octet-stream";
    const preview = typeof record.preview === "string"
      && record.preview.startsWith(PREVIEW_PREFIX)
      && record.preview.length <= PREVIEW_LIMIT
      ? record.preview
      : null;
    out.push({ name, size, mime, preview });
    if (out.length === DRAFT_LIMIT) break;
  }
  return out;
}

export function parsePickerMessage(raw: string): PickedWire[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { type?: unknown; files?: unknown };
  if (record.type !== "picked") return null;
  return sanitizePicked(record.files);
}

export function addDrafts(
  current: readonly DraftAttachment[],
  incoming: readonly DraftAttachment[],
  limit = DRAFT_LIMIT,
): { next: DraftAttachment[]; dropped: number } {
  const next = [...current];
  let dropped = 0;
  for (const item of incoming) {
    if (next.length >= limit) {
      dropped += 1;
      continue;
    }
    next.push(item);
  }
  return { next, dropped };
}

export function removeDraft(current: readonly DraftAttachment[], id: string): DraftAttachment[] {
  return current.filter((item) => item.id !== id);
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  const mb = size / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

export function extensionLabel(name: string, mime: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  const clean = ext.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase();
  if (clean) return clean;
  if (mime.startsWith("image/")) return "IMG";
  return "FILE";
}

export type SendDecision =
  | { kind: "empty" }
  | { kind: "held" }
  | { kind: "text"; text: string };

/** Files never leave the phone. A draft with files does not send, so it cannot fail as if it were sent. */
export function decideSend(text: string, fileCount: number): SendDecision {
  if (fileCount > 0) return { kind: "held" };
  const trimmed = text.trim();
  if (!trimmed) return { kind: "empty" };
  return { kind: "text", text: trimmed };
}

export type ComposerAction = "voice" | "send" | "stop" | "held";

export type ComposerChrome = {
  expanded: boolean;
  placeholder: string;
  action: ComposerAction;
};

export function composerChrome(input: {
  focused: boolean;
  text: string;
  attachments: number;
  running: boolean;
  queued: number;
}): ComposerChrome {
  const draft = input.text.trim().length > 0 || input.attachments > 0;
  const expanded = input.focused || draft;
  if (!expanded && input.running && input.queued === 0) {
    return { expanded: false, placeholder: "发送中…", action: "stop" };
  }
  if (!expanded) {
    return { expanded: false, placeholder: "回复，或按住说话", action: "voice" };
  }
  if (input.attachments > 0) {
    return { expanded: true, placeholder: "回复 Qbot", action: "held" };
  }
  if (input.text.trim()) {
    return { expanded: true, placeholder: "回复 Qbot", action: "send" };
  }
  if (input.running) {
    return { expanded: true, placeholder: "回复 Qbot", action: "stop" };
  }
  return { expanded: true, placeholder: "回复 Qbot", action: "voice" };
}

/** Voice is not connected. Holding the composer must not produce a transcript. */
export function holdToTalk(): { accepted: false; notice: string } {
  return { accepted: false, notice: VOICE_UNAVAILABLE };
}

export type SourcePart = { type?: string; title?: string; url?: string };

/** Real source parts only. An empty list stays hidden instead of a made-up count. */
export function sourceCaption(parts: readonly SourcePart[]): string | null {
  const count = parts.filter((part) => part.type === "source" && (part.title || part.url)).length;
  if (count === 0) return null;
  return `${count} 个来源`;
}

export type LoosePart = { type?: string; text?: string };
export type LooseMessage = {
  id?: string;
  role?: string;
  content?: readonly LoosePart[];
  parts?: readonly LoosePart[];
};

export function partsText(parts: readonly LoosePart[] | undefined): string {
  if (!parts) return "";
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
}

export function messageText(message: LooseMessage): string {
  return partsText(message.parts) || partsText(message.content);
}

export function previousUserText(messages: readonly LooseMessage[], messageId: string): string | null {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index <= 0) return null;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const message = messages[cursor];
    if (message?.role !== "user") continue;
    const text = messageText(message);
    if (text) return text;
  }
  return null;
}

export type QueuedMessage = { id: string; text: string };

export type Outbox = {
  items: QueuedMessage[];
  /** The queued id that should be sent once the in-flight run settles. */
  flushId: string | null;
  /** Stop was pressed. A later settle must not send the queue by itself. */
  hold: boolean;
};

export type OutboxEvent =
  | { type: "submit"; id: string; text: string; running: boolean }
  | { type: "send-now"; id: string; running: boolean }
  | { type: "drop"; id: string }
  | { type: "stop" }
  | { type: "settled" };

export type OutboxEffect = { type: "send"; text: string } | { type: "cancel" };

export function emptyOutbox(): Outbox {
  return { items: [], flushId: null, hold: false };
}

function without(items: readonly QueuedMessage[], id: string): QueuedMessage[] {
  return items.filter((item) => item.id !== id);
}

/**
 * While a reply is running, a new message waits. Stop keeps it.
 * Send-now cancels the current reply once, then sends that waiting text once.
 */
export function reduceOutbox(state: Outbox, event: OutboxEvent): { state: Outbox; effects: OutboxEffect[] } {
  if (event.type === "submit") {
    const text = event.text.trim();
    if (!text) return { state, effects: [] };
    if (event.running) {
      return { state: { ...state, items: [...state.items, { id: event.id, text }] }, effects: [] };
    }
    return { state, effects: [{ type: "send", text }] };
  }
  if (event.type === "drop") {
    const items = without(state.items, event.id);
    return {
      state: {
        items,
        flushId: state.flushId === event.id ? null : state.flushId,
        hold: items.length === 0 ? false : state.hold,
      },
      effects: [],
    };
  }
  if (event.type === "stop") {
    return { state: { ...state, flushId: null, hold: true }, effects: [{ type: "cancel" }] };
  }
  if (event.type === "send-now") {
    const item = state.items.find((entry) => entry.id === event.id);
    if (!item) return { state, effects: [] };
    if (!event.running) {
      return {
        state: { ...state, items: without(state.items, item.id), flushId: null, hold: state.hold && state.items.length > 1 },
        effects: [{ type: "send", text: item.text }],
      };
    }
    return { state: { ...state, flushId: item.id, hold: false }, effects: [{ type: "cancel" }] };
  }
  if (state.flushId) {
    const item = state.items.find((entry) => entry.id === state.flushId);
    if (!item) return { state: { ...state, flushId: null }, effects: [] };
    return {
      state: { items: without(state.items, item.id), flushId: null, hold: false },
      effects: [{ type: "send", text: item.text }],
    };
  }
  if (state.hold || state.items.length === 0) return { state, effects: [] };
  const [next, ...rest] = state.items;
  if (!next) return { state, effects: [] };
  return { state: { ...state, items: rest }, effects: [{ type: "send", text: next.text }] };
}
