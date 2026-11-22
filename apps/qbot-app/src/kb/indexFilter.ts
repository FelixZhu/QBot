export type KbEntry = {
  name?: string;
  key?: string;
  tags?: string[];
};

/** Drop demo rows. Real library entries do not use the 示例 marker. */
export function filterKbFiles<T extends KbEntry>(files: T[]): T[] {
  return files.filter((item) => !isDemoEntry(item));
}

export function isDemoEntry(item: KbEntry): boolean {
  const tags = item.tags ?? [];
  if (tags.some((tag) => String(tag).includes("示例"))) return true;
  return `${item.name ?? ""} ${item.key ?? ""}`.includes("示例");
}
