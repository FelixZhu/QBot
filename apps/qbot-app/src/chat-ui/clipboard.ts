/** The native write method Expo exposes on the ExpoClipboard module. */
export type ClipboardNative = {
  setStringAsync?: (text: string, options?: object) => Promise<boolean>;
};

/** True only when this binary actually has a clipboard writer. A missing module is null. */
export function nativeClipboardReady(native: ClipboardNative | null | undefined): boolean {
  return typeof native?.setStringAsync === "function";
}

/** Success is the official boolean. False, or a rejected write, must not look copied. */
export async function acceptClipboardWrite(wrote: boolean): Promise<void> {
  if (wrote !== true) throw new Error("Clipboard did not accept the text");
}
