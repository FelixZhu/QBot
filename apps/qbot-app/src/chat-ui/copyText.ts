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
  return cached;
}

export async function copyText(value: string): Promise<void> {
  if (!clipboardAvailable()) throw new Error("Clipboard is unavailable");
  if (!value) throw new Error("Nothing to copy");
  // Imported only after the native module is present. The package entry calls
  // requireNativeModule, which throws when this binary does not include it.
  const clipboard = await import("expo-clipboard");
  await acceptClipboardWrite(await clipboard.setStringAsync(value));
}
