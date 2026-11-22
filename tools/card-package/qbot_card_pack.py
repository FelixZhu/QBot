#!/usr/bin/env python3
"""QBot 卡片包 v1.0 打包/本地校验工具。

用法:
  python3 qbot_card_pack.py build <卡片目录> [-o out.zip]
  python3 qbot_card_pack.py check <card.zip>

<卡片目录> 里放 manifest.draft.json（不含 files/manifestDigest/contentDigest）、
封面 PNG（cover-light.png + cover-dark.png，或单张 cover.png）和 work/index.html、work/assets/。
本工具只做结构、摘要、锚点、HTML 白名单和限额检查，不证明内容真实。
"""
import hashlib, html.parser, io, json, mimetypes, os, re, sys, zipfile

LIMITS = dict(zip=8 << 20, total=32 << 20, file=8 << 20, count=32, ratio=100, path=128, elements=2000)
BANNED_TAGS = {"script", "iframe", "object", "embed", "form", "frame", "frameset", "base", "meta-refresh"}
CT = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
      ".svg": "image/svg+xml", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
      ".woff2": "font/woff2", ".json": "application/json"}
CONTENT_KEYS_EXCLUDED = "contentVersion expectedPreviousVersion protocolMajor protocolMinor cardKey botRef packageId sample authoringClaim idempotencyKey createdAt".split()

def jcs(obj):
    def chk(o):
        if isinstance(o, float):
            raise SystemExit("拒绝: manifest 里只允许整数，不允许小数（JCS 数字规范化不在本工具范围）")
        if isinstance(o, dict): [chk(v) for v in o.values()]
        if isinstance(o, list): [chk(v) for v in o]
    chk(obj)
    def key(k): return k.encode("utf-16-be")
    def ser(o):
        if isinstance(o, dict):
            return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + ser(o[k]) for k in sorted(o, key=key)) + "}"
        if isinstance(o, list): return "[" + ",".join(ser(v) for v in o) + "]"
        return json.dumps(o, ensure_ascii=False)
    return ser(obj).encode("utf-8")

def sha(b): return hashlib.sha256(b).hexdigest()

def content_digest(m):
    obj = {
        "title": m["card"]["title"],
        "claims": [{k: c[k] for k in ("id", "text", "sourceIds", "bodyAnchor")} for c in m["claims"]],
        "files": [{k: f[k] for k in ("path", "role", "sha256", "bytes", "contentType")} for f in m["files"]],
        "contentSafe": m["contentSafe"], "referenceCanvas": m["referenceCanvas"],
        "sources": [{"id": s["id"], "url": s["url"]} for s in m["sources"]],
    }
    return sha(jcs(obj))

def manifest_digest(m):
    return sha(jcs({k: v for k, v in m.items() if k != "manifestDigest"}))

class Doc(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.errors, self.count, self.stack, self.ids = [], 0, [], {}
        self.in_body, self.hidden = False, 0
    def handle_starttag(self, tag, attrs):
        self.count += 1
        if tag in BANNED_TAGS: self.errors.append(f"禁止标签 <{tag}>")
        for k, v in attrs:
            if k.startswith("on"): self.errors.append(f"禁止事件属性 {k}")
            if v and re.match(r"\s*javascript:", v, re.I): self.errors.append(f"禁止 javascript: 地址 ({k})")
            if k in ("href", "src") and v and re.match(r"\s*(https?:)?//", v, re.I) and not v.strip().lower().startswith("https://"):
                self.errors.append(f"外链必须是 https: {v}")
            if tag == "meta" and k == "http-equiv" and v and v.lower() == "refresh": self.errors.append("禁止 meta refresh")
        if tag == "body": self.in_body = True
        if tag in ("style", "template", "head"): self.hidden += 1
        rec = {"tag": tag, "text": [], "hidden": self.hidden > 0 or not self.in_body}
        i = dict(attrs).get("id")
        if i: self.ids.setdefault(i, []).append(rec)
        if tag in ("br", "img", "hr", "meta", "link", "input", "source", "wbr", "area", "col"):
            return
        self.stack.append(rec)
    def handle_endtag(self, tag):
        if tag in ("style", "template", "head"): self.hidden = max(0, self.hidden - 1)
        while self.stack:
            r = self.stack.pop()
            if r["tag"] == tag: break
    def handle_data(self, data):
        for r in self.stack: r["text"].append(data)

def ws(s): return re.sub(r"\s+", " ", s).strip()

def validate(m, blobs):
    errs = []
    for k in ("protocol", "protocolMajor", "protocolMinor"):
        pass
    if m.get("protocol") != "qbot.card-package" or m.get("protocolMajor") != 1 or m.get("protocolMinor") != 0:
        errs.append("只接受 qbot.card-package 1.0")
    if m.get("timezone") != "Asia/Shanghai": errs.append("timezone 必须是 Asia/Shanghai")
    for k in ("exampleOnly", "importable", "note", "owner"):
        if k in m: errs.append(f"正式包不能带 {k}")
    if m.get("sample"): errs.append("提示: sample=true，只能 dry-run/stage，不能 commit/publish")
    paths = [f["path"] for f in m["files"]]
    if set(paths) != set(blobs): errs.append(f"files 与 ZIP 内容不一致: 多 {set(blobs)-set(paths)} 少 {set(paths)-set(blobs)}")
    covers = {p for p in paths if p in ("cover.png", "cover-light.png", "cover-dark.png")}
    if not ({"cover-light.png", "cover-dark.png"} <= covers or covers == {"cover.png"}):
        errs.append("封面必须是 cover-light.png+cover-dark.png 一对，或只有 cover.png")
    if "work/index.html" not in paths: errs.append("缺 work/index.html")
    for f in m["files"]:
        b = blobs.get(f["path"])
        if b is None: continue
        if sha(b) != f["sha256"] or len(b) != f["bytes"]: errs.append(f"hash/bytes 不符: {f['path']}")
        if len(f["path"]) > LIMITS["path"] or ".." in f["path"].split("/") or f["path"].startswith("/"): errs.append(f"路径非法: {f['path']}")
        if f["path"].startswith("cover") and b[:8] != b"\x89PNG\r\n\x1a\n": errs.append(f"封面不是 PNG: {f['path']}")
    if len(blobs) > LIMITS["count"]: errs.append("文件超过 32 个")
    if sum(map(len, blobs.values())) > LIMITS["total"]: errs.append("解压后超过 32MiB")
    html_b = blobs.get("work/index.html", b"")
    d = Doc(); d.feed(html_b.decode("utf-8", "strict")); d.close()
    errs += d.errors
    if d.count > LIMITS["elements"]: errs.append("HTML 元素超过 2000")
    src_ids = {s["id"] for s in m["sources"]}
    for s in m["sources"]:
        if not s["url"].startswith("https://"): errs.append(f"来源必须 https: {s['id']}")
    for c in m["claims"]:
        a = c["bodyAnchor"]
        if a["fragment"] != "#" + a["elementId"]: errs.append(f"{c['id']}: fragment 必须是 #elementId")
        if c["text"] != a["quote"]: errs.append(f"{c['id']}: text 必须等于 quote")
        if not set(c["sourceIds"]) <= src_ids: errs.append(f"{c['id']}: sourceIds 未在 sources 中")
        hits = d.ids.get(a["elementId"], [])
        if len(hits) != 1: errs.append(f"{c['id']}: id={a['elementId']} 必须恰好一个，实际 {len(hits)}")
        elif hits[0]["hidden"]: errs.append(f"{c['id']}: 锚点不在 body 可见正文")
        elif ws(a["quote"]) not in ws("".join(hits[0]["text"])): errs.append(f"{c['id']}: quote 不在该元素文本里")
    if m.get("contentDigest", {}).get("value") != content_digest(m): errs.append("contentDigest 不符")
    if m.get("manifestDigest", {}).get("value") != manifest_digest(m): errs.append("manifestDigest 不符")
    return errs

def build(src, out):
    draft = json.load(open(os.path.join(src, "manifest.draft.json"), encoding="utf-8"))
    blobs = {}
    for root, _, names in os.walk(src):
        for n in names:
            p = os.path.relpath(os.path.join(root, n), src).replace(os.sep, "/")
            if p in ("manifest.draft.json", "manifest.json") or n.startswith("."): continue
            blobs[p] = open(os.path.join(root, n), "rb").read()
    def role(p): return "cover" if p.startswith("cover") else ("page" if p == "work/index.html" else "asset")
    files = []
    for p in sorted(blobs):
        if role(p) == "asset" and not p.startswith("work/assets/"): raise SystemExit(f"拒绝: 资源只能放 work/assets/: {p}")
        ext = os.path.splitext(p)[1].lower()
        files.append({"path": p, "role": role(p), "sha256": sha(blobs[p]), "bytes": len(blobs[p]),
                      "contentType": CT.get(ext) or mimetypes.guess_type(p)[0] or "application/octet-stream"})
    m = dict(draft); m["files"] = files
    m.pop("manifestDigest", None)
    m["contentDigest"] = {"alg": "sha256-jcs", "value": content_digest(m)}
    m["manifestDigest"] = {"alg": "sha256-jcs", "value": manifest_digest(m)}
    errs = [e for e in validate(m, blobs) if not e.startswith("提示")]
    if errs: raise SystemExit("校验失败:\n- " + "\n- ".join(errs))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(m, ensure_ascii=False, indent=2))
        for p in sorted(blobs): z.writestr(p, blobs[p])
    if buf.tell() > LIMITS["zip"]: raise SystemExit("ZIP 超过 8MiB")
    open(out, "wb").write(buf.getvalue())
    print(json.dumps({"ok": True, "zip": out, "contentDigest": m["contentDigest"]["value"],
                      "manifestDigest": m["manifestDigest"]["value"], "files": len(files), "sample": m.get("sample")}, ensure_ascii=False))

def check(path):
    z = zipfile.ZipFile(path)
    if os.path.getsize(path) > LIMITS["zip"]: raise SystemExit("ZIP 超过 8MiB")
    blobs, total = {}, 0
    for i in z.infolist():
        if i.is_dir(): continue
        if i.file_size > LIMITS["file"] or (i.compress_size and i.file_size / i.compress_size > LIMITS["ratio"]):
            raise SystemExit(f"单文件过大或压缩比异常: {i.filename}")
        if (i.external_attr >> 16) & 0o170000 == 0o120000: raise SystemExit(f"禁止符号链接: {i.filename}")
        total += i.file_size
        blobs[i.filename] = z.read(i)
    m = json.loads(blobs.pop("manifest.json").decode("utf-8"))
    errs = validate(m, blobs)
    hard = [e for e in errs if not e.startswith("提示")]
    print(json.dumps({"ok": not hard, "errors": hard, "notes": [e for e in errs if e.startswith("提示")]}, ensure_ascii=False, indent=2))
    sys.exit(1 if hard else 0)

if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) >= 2 and a[0] == "build":
        out = a[a.index("-o") + 1] if "-o" in a else os.path.basename(os.path.normpath(a[1])) + ".zip"
        build(a[1], out)
    elif len(a) == 2 and a[0] == "check":
        check(a[1])
    else:
        print(__doc__); sys.exit(2)
