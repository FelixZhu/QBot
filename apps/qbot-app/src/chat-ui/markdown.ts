/**
 * The subset the thread renders: paragraphs, #–### headings, `-`/`*` and
 * `1.` lists, `**bold**`, `*em*`, `` `code` ``, `[label](http...)`, and
 * fenced code. An opening fence without a close stays a code block so a
 * stream does not flip that region back into a paragraph on each chunk.
 * Tables, images, and raw HTML are left as text.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "em"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

export type Block =
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "heading"; level: number; inlines: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "code"; language: string; code: string };

const HEADING = /^(#{1,3})[ \t]+(\S.*?)\s*$/;
const ORDERED = /^(\d+)[.)][ \t]+(\S.*?)\s*$/;
const BULLET = /^[-*][ \t]+(\S.*?)\s*$/;
const FENCE = /^```([A-Za-z0-9_+-]*)\s*$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: "paragraph", inlines: parseInlines(paragraph.join("\n")) });
    paragraph = [];
  };

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const language = fence[1] ?? "";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index] ?? "")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      const code = body.join("\n").replace(/\n$/, "");
      blocks.push({ type: "code", language, code });
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      index += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: "heading",
        level: heading[1]?.length ?? 1,
        inlines: parseInlines(heading[2] ?? ""),
      });
      index += 1;
      continue;
    }
    const ordered = ORDERED.exec(line);
    const bullet = BULLET.exec(line);
    if (ordered || bullet) {
      flushParagraph();
      const markedOrdered = ordered !== null;
      const items: Inline[][] = [];
      while (index < lines.length) {
        const current = lines[index] ?? "";
        const nextOrdered = ORDERED.exec(current);
        const nextBullet = BULLET.exec(current);
        if (markedOrdered && nextOrdered) items.push(parseInlines(nextOrdered[2] ?? ""));
        else if (!markedOrdered && nextBullet) items.push(parseInlines(nextBullet[1] ?? ""));
        else break;
        index += 1;
      }
      blocks.push({ type: "list", ordered: markedOrdered, items });
      continue;
    }
    paragraph.push(line);
    index += 1;
  }
  flushParagraph();
  return blocks;
}

export function parseInlines(input: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  let index = 0;
  const pushText = () => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last?.type === "text") last.text += text;
    else out.push({ type: "text", text });
    text = "";
  };
  while (index < input.length) {
    const mark = input.startsWith("**", index) ? "**" : input.startsWith("__", index) ? "__" : "";
    if (mark) {
      const end = input.indexOf(mark, index + 2);
      if (end > index + 2) {
        pushText();
        out.push({ type: "strong", text: input.slice(index + 2, end) });
        index = end + 2;
        continue;
      }
    }
    if (input[index] === "`") {
      const end = input.indexOf("`", index + 1);
      if (end > index + 1) {
        pushText();
        out.push({ type: "code", text: input.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }
    if (input[index] === "[") {
      const labelEnd = input.indexOf("]", index + 1);
      if (labelEnd > index && input[labelEnd + 1] === "(") {
        const hrefEnd = input.indexOf(")", labelEnd + 2);
        if (hrefEnd > labelEnd + 1) {
          pushText();
          out.push({
            type: "link",
            text: input.slice(index + 1, labelEnd),
            href: input.slice(labelEnd + 2, hrefEnd),
          });
          index = hrefEnd + 1;
          continue;
        }
      }
    }
    const emMark = input[index] === "*" || input[index] === "_" ? input[index] : "";
    if (emMark && input[index + 1] !== emMark && input[index + 1] !== " " && input[index + 1] !== undefined) {
      const end = input.indexOf(emMark, index + 1);
      if (end > index + 1 && input[end - 1] !== " ") {
        pushText();
        out.push({ type: "em", text: input.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }
    text += input[index];
    index += 1;
  }
  pushText();
  return out;
}

/** http(s) and mailto only. Anything else stays unlinked text. */
export function openableHref(value: string): string | null {
  const href = value.trim();
  if (!href) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") return null;
    return url.toString();
  } catch {
    return null;
  }
}
