import { requireOptionalNativeModule } from "expo-modules-core";
import { acceptClipboardWrite, nativeClipboardReady, type ClipboardNative } from "./clipboard";

let cached: boolean | undefined;

/**
 * requireOptionalNativeModule returns null when ExpoClipboard is not in this
 * binary, instead of throwing. A lookup failure hides the custom copy controls.
 */
export function clipboardAvailable(): boolean {
  if (cached !== undefined) return cached;
  try {
    cached = nativeClipboardReady(requireOptionalNativeModule<ClipboardNative>("ExpoClipboard"));
  } catch {
    cached = false;
  }
  if (!cached) cached = browserCanCopy();
  return cached;
}

function browserCanCopy(): boolean {
  const nav = (globalThis as { navigator?: { clipboard?: { writeText?: unknown } } }).navigator;
  const doc = (globalThis as { document?: { execCommand?: unknown } }).document;
  return typeof nav?.clipboard?.writeText === "function" || typeof doc?.execCommand === "function";
}

export async function copyText(value: string): Promise<void> {
  if (!value) throw new Error("Nothing to copy");
  if (nativeClipboardReady(safeNative())) {
    // Imported only after the native module is present. The package entry calls
    // requireNativeModule, which throws when this binary does not include it.
    const clipboard = await import("expo-clipboard");
    await acceptClipboardWrite(await clipboard.setStringAsync(value));
    return;
  }
  await writeBrowserClipboard(value);
}

function safeNative(): ClipboardNative | null {
  try {
    return requireOptionalNativeModule<ClipboardNative>("ExpoClipboard");
  } catch {
    return null;
  }
}

async function writeBrowserClipboard(value: string): Promise<void> {
  const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (text: string) => Promise<void> } } }).navigator;
  const doc = (globalThis as {
    document?: {
      body?: { appendChild(node: unknown): void; removeChild(node: unknown): void };
      createElement(tag: string): { value: string; select(): void; focus(): void; setSelectionRange(start: number, end: number): void; style: { position: string } };
      execCommand(command: string): boolean;
    };
  }).document;
  if (typeof nav?.clipboard?.writeText === "function") {
    try {
      await Promise.race([
        nav.clipboard.writeText(value),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("slow")), 400)),
      ]);
      return;
    } catch {
      // Fall through. Some browsers leave the async clipboard pending.
    }
  }
  const body = doc?.body;
  if (!doc || !body || typeof doc.execCommand !== "function") throw new Error("Clipboard is unavailable");
  const area = doc.createElement("textarea");
  area.value = value;
  area.style.position = "fixed";
  body.appendChild(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, area.value.length);
  const wrote = doc.execCommand("copy");
  body.removeChild(area);
  if (!wrote) throw new Error("Clipboard did not accept the text");
}
