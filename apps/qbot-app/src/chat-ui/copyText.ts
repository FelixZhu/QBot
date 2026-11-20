/**
 * Writes to the system clipboard. The native module ships in a new binary;
 * a press on an older install rejects and the caller keeps text selection.
 */
export async function copyText(value: string): Promise<void> {
  if (!value) throw new Error("Nothing to copy");
  const clipboard = await import("expo-clipboard");
  const wrote = await clipboard.setStringAsync(value);
  if (!wrote) throw new Error("Clipboard did not accept the text");
}
