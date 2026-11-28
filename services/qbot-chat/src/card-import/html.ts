import { parse, type DefaultTreeAdapterMap } from "parse5";
import { PACKAGE_LIMITS } from "./limits.ts";
import type { ImportError } from "./types.ts";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
type TextNode = DefaultTreeAdapterMap["textNode"];

const BANNED = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "form",
  "frame",
  "frameset",
  "base",
  "audio",
  "video",
  "foreignobject",
]);

const SELF_ONLY = new Set(["img", "link", "source", "video", "audio", "track", "image"]);
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "poster"]);

export type AnchorHit = {
  hidden: boolean;
  text: string;
};

export type HtmlReport = {
  errors: ImportError[];
  elements: number;
  ids: Map<string, AnchorHit[]>;
  httpsLinks: string[];
};

export function inspectHtml(html: string, declaredSources: ReadonlySet<string>): HtmlReport {
  const document = parse(html);
  const errors: ImportError[] = [];
  const ids = new Map<string, AnchorHit[]>();
  const httpsLinks: string[] = [];
  let elements = 0;

  const walk = (node: Node, place: Place): string => {
    if (node.nodeName === "#text") return (node as TextNode).value;
    if (node.nodeName === "#comment" || node.nodeName === "#documentType") return "";
    if (node.nodeName === "#document" || node.nodeName === "#document-fragment") {
      return childNodes(node).map((child) => walk(child, place)).join("");
    }
    const element = node as Element;
    elements += 1;
    const tag = element.nodeName.toLowerCase();
    if (BANNED.has(tag)) {
      errors.push({ code: "html", message: `禁止标签 <${tag}>`, path: "work/index.html" });
    }
    let id = "";
    for (const attr of element.attrs) {
      const name = attr.name.toLowerCase();
      const local = name.slice(name.lastIndexOf(":") + 1);
      const value = attr.value ?? "";
      if (local === "id" && !id) id = value;
      if (local.startsWith("on")) {
        errors.push({ code: "html", message: `禁止事件属性 ${attr.name}`, path: "work/index.html" });
      }
      if (/^\s*javascript:/i.test(value)) {
        errors.push({ code: "html", message: `禁止 javascript: 地址 (${attr.name})`, path: "work/index.html" });
      }
      if (URL_ATTRS.has(local)) {
        checkUrl(tag, value, declaredSources, errors, httpsLinks, "work/index.html");
      }
      if (local === "srcset") {
        for (const candidate of value.split(",")) {
          const urlPart = candidate.trim().split(/\s+/, 1)[0] ?? "";
          if (urlPart) checkUrl("img", urlPart, declaredSources, errors, httpsLinks, "work/index.html");
        }
      }
      if (tag === "meta" && local === "http-equiv" && value.trim().toLowerCase() === "refresh") {
        errors.push({ code: "html", message: "禁止 meta refresh", path: "work/index.html" });
      }
      if (local === "style") checkStyle(value, errors, "work/index.html");
    }
    const childPlace: Place = {
      inBody: place.inBody || tag === "body",
      inTemplate: place.inTemplate || tag === "template",
      inScript: place.inScript || tag === "script",
      inStyle: place.inStyle || tag === "style",
    };
    let text = "";
    for (const child of element.childNodes) text += walk(child, childPlace);
    const template = element as Element & { content?: Node };
    if (tag === "template" && template.content) {
      walk(template.content, { ...childPlace, inTemplate: true });
    }
    if (tag === "style") checkStyle(text, errors, "work/index.html");
    const hidden = !(place.inBody || tag === "body")
      || place.inTemplate
      || tag === "template"
      || place.inScript
      || tag === "script"
      || place.inStyle
      || tag === "style";
    if (id) {
      const visibleText = tag === "script" || tag === "style" || tag === "template" ? "" : text;
      const list = ids.get(id) ?? [];
      list.push({ hidden, text: visibleText });
      ids.set(id, list);
    }
    if (tag === "script" || tag === "style" || tag === "template") return "";
    return text;
  };

  walk(document as unknown as Node, { inBody: false, inTemplate: false, inScript: false, inStyle: false });
  if (elements > PACKAGE_LIMITS.elements) {
    errors.push({ code: "html", message: "HTML 元素超过 2000", path: "work/index.html" });
  }
  return { errors, elements, ids, httpsLinks };
}

export function inspectCss(css: string, filePath: string): ImportError[] {
  const errors: ImportError[] = [];
  checkStyle(css, errors, filePath);
  return errors;
}

export function inspectSvg(svg: string, filePath: string): ImportError[] {
  const errors: ImportError[] = [];
  const doc = parse(svg);
  const walk = (node: Node): void => {
    if (node.nodeName === "#text" || node.nodeName === "#comment" || node.nodeName === "#documentType") return;
    if (node.nodeName === "#document" || node.nodeName === "#document-fragment") {
      for (const child of childNodes(node)) walk(child);
      return;
    }
    const element = node as Element;
    const tag = element.nodeName.toLowerCase();
    if (BANNED.has(tag)) {
      errors.push({ code: "asset", message: `SVG 禁止标签 <${tag}>`, path: filePath });
    }
    for (const attr of element.attrs) {
      const local = attr.name.toLowerCase().slice(attr.name.lastIndexOf(":") + 1);
      const value = attr.value ?? "";
      if (local.startsWith("on")) {
        errors.push({ code: "asset", message: `SVG 禁止事件属性 ${attr.name}`, path: filePath });
      }
      if (/^\s*javascript:/i.test(value)) {
        errors.push({ code: "asset", message: `SVG 禁止 javascript: 地址`, path: filePath });
      }
      if (local === "href" || local === "src") {
        const kind = classifyUrl(value);
        if (kind !== "empty" && kind !== "relative" && kind !== "fragment") {
          errors.push({ code: "asset", message: `SVG 只能引用包内相对路径`, path: filePath });
        }
      }
      if (local === "style") checkStyle(value, errors, filePath);
    }
    if (tag === "style") {
      const text = element.childNodes.map((c) => (c.nodeName === "#text" ? (c as TextNode).value : "")).join("");
      checkStyle(text, errors, filePath);
    }
    for (const child of element.childNodes) walk(child);
  };
  walk(doc as unknown as Node);
  return errors;
}

type Place = {
  inBody: boolean;
  inTemplate: boolean;
  inScript: boolean;
  inStyle: boolean;
};

function childNodes(node: Node): Node[] {
  if ("childNodes" in node && Array.isArray(node.childNodes)) return node.childNodes as Node[];
  return [];
}

function checkUrl(
  tag: string,
  value: string,
  declaredSources: ReadonlySet<string>,
  errors: ImportError[],
  httpsLinks: string[],
  filePath: string,
): void {
  const kind = classifyUrl(value);
  if (kind === "empty" || kind === "relative" || kind === "fragment") return;
  if (kind !== "https") {
    errors.push({ code: "html", message: `外链必须是 https: ${clip(value)}`, path: filePath });
    return;
  }
  if (SELF_ONLY.has(tag)) {
    errors.push({ code: "html", message: "样式和图片只能引用包内相对路径", path: filePath });
    return;
  }
  const normalized = value.trim();
  httpsLinks.push(normalized);
  if (!declaredSources.has(normalized)) {
    errors.push({ code: "html", message: `外链必须事先在 sources 里声明: ${clip(normalized)}`, path: filePath });
  }
}

function checkStyle(value: string, errors: ImportError[], filePath: string): void {
  if (/javascript\s*:/i.test(value) || /expression\s*\(/i.test(value)) {
    errors.push({ code: "html", message: "禁止样式里的脚本地址", path: filePath });
  }
  if (/@import/i.test(value)) {
    errors.push({ code: "html", message: "禁止样式 @import", path: filePath });
  }
  const pattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  for (const match of value.matchAll(pattern)) {
    const target = match[2] ?? "";
    const kind = classifyUrl(target);
    if (kind !== "empty" && kind !== "relative" && kind !== "fragment") {
      errors.push({ code: "html", message: "样式和图片只能引用包内相对路径", path: filePath });
    }
  }
}

function classifyUrl(value: string): "empty" | "fragment" | "relative" | "https" | "bad" {
  const trimmed = value.trim();
  if (!trimmed) return "empty";
  if (trimmed.startsWith("#")) return "fragment";
  if (/^\s*javascript:/i.test(trimmed) || trimmed.startsWith("//")) return "bad";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "https:" || url.username || url.password) return "bad";
      return "https";
    } catch {
      return "bad";
    }
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("\\") || trimmed.split("/").some((part) => part === "..")) return "bad";
  return "relative";
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clip(value: string): string {
  return value.length > 120 ? `${value.slice(0, 120)}…` : value;
}
