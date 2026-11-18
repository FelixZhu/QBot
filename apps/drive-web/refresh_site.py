#!/usr/bin/env python3
"""Rebuild Qian's Drive (read-only page on GitHub Pages) from OSS bucket qian-grokbot.

Lists the bucket (read-only), keeps publicly readable objects only (skips
_site/, trash/, _test/, private/ and private-ACL objects), embeds the file list
into template.html, writes index.json (summaries/tags from the local OSS
index), and copies kb.js / kb.css plus PWA assets into the GitHub Pages repo
dir (default /workspace/qian-drive-repo). Writes nothing to OSS. Credentials
come from OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET and are never printed or
written anywhere.

Also builds the QBot chat tab (../chat-web, Vite) into chat/, and copies the shared
design CSS (tokens/layout/components.css), the feed module (feed.js, feed.css,
out/feed.json, out/media/), shell-media.js and shell-theme.js next to index.html when present.

Usage: python3 refresh_site.py [--push] [--repo DIR] [--no-chat-build]
                 [--manifest FILE --index FILE]
                 [--feed-out DIR] [--fonts DIR]
  --push           git commit + push the repo (only if something changed)
  --repo DIR       write the site somewhere else (e.g. a local preview dir)
  --no-chat-build  reuse the existing ../chat-web/dist instead of running npm run build
  --manifest FILE  use this manifest JSON instead of listing the OSS bucket
  --index FILE     use this index JSON instead of ~/.oss_index.json
                   Both are required together. They are copied byte for byte.
                   OSS credentials are not read on this path.
  --feed-out DIR   copy this feed directory instead of ./out
  --fonts DIR      copy *.woff2 from here into fonts/ (source tree still has none)
"""
import hashlib, json, os, shutil, subprocess, sys, time, mimetypes

ENDPOINT = os.environ.get("OSS_ENDPOINT", "https://oss-cn-beijing.aliyuncs.com")
BUCKET = os.environ.get("OSS_BUCKET", "qian-grokbot")
BASE = "https://%s.%s" % (BUCKET, ENDPOINT.split("://", 1)[1])
EXCLUDE = ("_site/", "trash/", "_test/", "private/")
HERE = os.path.dirname(os.path.abspath(__file__))
INDEX_FILE = os.path.expanduser("~/.oss_index.json")
GIT_ID = ["-c", "user.name=FelixZhu", "-c", "user.email=FelixZhu@users.noreply.github.com"]

KIND_LABEL = {
    "pdf": "PDF", "video": "视频", "audio": "音频", "image": "图片",
    "md": "MD", "doc": "文档", "sheet": "表格", "code": "代码", "file": "文件",
}


def bucket():
    import oss2
    kid, sec = os.environ.get("OSS_ACCESS_KEY_ID"), os.environ.get("OSS_ACCESS_KEY_SECRET")
    if not kid or not sec:
        sys.exit("missing OSS credentials in environment")
    return oss2.Bucket(oss2.Auth(kid, sec), ENDPOINT, BUCKET)


def file_kind(key, ct):
    ext = key.rsplit(".", 1)[-1].lower() if "." in key else ""
    if ext == "pdf" or ct == "application/pdf":
        return "pdf"
    if ext in ("mp4", "webm", "mov", "mkv") or ct.startswith("video/"):
        return "video"
    if ext in ("m4a", "mp3", "wav", "aac", "ogg", "flac") or ct.startswith("audio/"):
        return "audio"
    if ext in ("png", "jpg", "jpeg", "gif", "webp", "svg") or ct.startswith("image/"):
        return "image"
    if ext in ("md", "markdown"):
        return "md"
    if ext in ("doc", "docx"):
        return "doc"
    if ext in ("xls", "xlsx", "csv"):
        return "sheet"
    if ext in ("js", "ts", "py", "json", "html", "css", "go", "rs") or ct.startswith("text/"):
        return "code"
    return "file"


def load_local_index():
    try:
        data = json.loads(open(INDEX_FILE, encoding="utf-8").read())
        return data.get(BUCKET, {}).get("objects", {})
    except (OSError, ValueError):
        return {}


def build_manifest(b):
    bucket_acl = b.get_bucket_acl().acl
    files, skipped = [], []
    for o in oss2.ObjectIterator(b):
        k = o.key
        if k.endswith("/") or k.startswith(EXCLUDE):
            continue
        acl = b.get_object_acl(k).acl
        if (bucket_acl if acl == "default" else acl) not in ("public-read", "public-read-write"):
            skipped.append(k)
            continue
        ct = b.head_object(k).headers.get("Content-Type") or mimetypes.guess_type(k)[0] or "application/octet-stream"
        files.append({"key": k, "size": o.size, "mtime": o.last_modified, "type": ct})
    files.sort(key=lambda f: f["key"])
    return {"bucket": BUCKET, "base": BASE, "generated": int(time.time()),
            "count": len(files), "total_size": sum(f["size"] for f in files), "files": files}, skipped


def build_index(manifest):
    """Public-file catalog for the knowledge-base tab. Private-ACL / private/ keys
    are omitted so their names are not published on GitHub Pages. The schema still
    carries a `private` flag (title/type/date only, no summary) for later use."""
    local = load_local_index()
    out = []
    for f in manifest["files"]:
        k = f["key"]
        kind = file_kind(k, f.get("type") or "")
        ent = local.get(k) or {}
        name = k.rsplit("/", 1)[-1]
        directory = k.rsplit("/", 1)[0] if "/" in k else ""
        rec = {
            "key": k,
            "name": name,
            "type": f.get("type") or "application/octet-stream",
            "kind": kind,
            "doc_type": KIND_LABEL.get(kind, "文件"),
            "size": f["size"],
            "mtime": f["mtime"],
            "dir": directory,
            "summary": (ent.get("summary") or "").strip(),
            "tags": list(ent.get("tags") or []),
            "private": False,
        }
        out.append(rec)
    return {
        "bucket": manifest["bucket"],
        "base": manifest["base"],
        "generated": manifest["generated"],
        "count": len(out),
        "files": out,
    }


def check_cors(files, origin="https://felixzhu.github.io"):
    """True if the bucket answers cross-origin GETs from the Pages origin (needed by pdf.js)."""
    import urllib.request, urllib.parse
    if not files:
        return False
    u = BASE + "/" + urllib.parse.quote(files[0]["key"])
    req = urllib.request.Request(u, headers={"Origin": origin, "Range": "bytes=0-0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            acao = r.headers.get("Access-Control-Allow-Origin")
    except Exception:
        return False
    return acao in ("*", origin)


def build_chat():
    """Build ../chat-web and return its dist dir, or None if the app is absent."""
    app = os.path.join(os.path.dirname(HERE), "chat-web")
    if not os.path.isfile(os.path.join(app, "package.json")):
        return None
    if "--no-chat-build" not in sys.argv:
        if not os.path.isdir(os.path.join(app, "node_modules")):
            subprocess.run(["npm", "ci"], cwd=app, check=True)
        subprocess.run(["npm", "run", "build"], cwd=app, check=True, stdout=subprocess.DEVNULL)
    dist = os.path.join(app, "dist")
    if not os.path.isfile(os.path.join(dist, "chat.js")):
        sys.exit("chat-web build output missing: %s/chat.js" % dist)
    return dist


SHARED_FILES = ("tokens.css", "layout.css", "components.css", "feed.js", "feed.css", "shell-media.js", "shell-theme.js")


def frontend_files(chat, feed_out=None):
    """Every extra file that ends up in the site; also feeds the page version hash."""
    if feed_out is None:
        feed_out = os.path.join(HERE, "out")
    out = [os.path.join(HERE, n) for n in SHARED_FILES if os.path.isfile(os.path.join(HERE, n))]
    if os.path.isdir(feed_out):
        out += sorted(os.path.join(r, f) for r, _, fs in os.walk(feed_out) for f in fs)
    if chat:
        out += [os.path.join(chat, n) for n in sorted(os.listdir(chat))]
    return out


def copy_frontend(dest, chat, feed_out=None):
    """Shared design CSS, feed module (+ media/) and chat bundle into the site dir."""
    if feed_out is None:
        feed_out = os.path.join(HERE, "out")
    for name in SHARED_FILES:
        if os.path.isfile(os.path.join(HERE, name)):
            shutil.copy2(os.path.join(HERE, name), os.path.join(dest, name))
    # Feed data: feed.js falls back to out/feed.json (+ out/media/) when OSS has none.
    shutil.rmtree(os.path.join(dest, "out"), ignore_errors=True)
    if os.path.isdir(feed_out):
        shutil.copytree(feed_out, os.path.join(dest, "out"))
    if chat:
        shutil.rmtree(os.path.join(dest, "chat"), ignore_errors=True)
        shutil.copytree(chat, os.path.join(dest, "chat"))


def copy_fonts(dest, fonts):
    """Copy pinned woff2 files into the site. Does nothing when fonts is omitted."""
    if not fonts:
        return
    os.makedirs(os.path.join(dest, "fonts"), exist_ok=True)
    for name in sorted(os.listdir(fonts)):
        src = os.path.join(fonts, name)
        if os.path.isfile(src) and name.endswith(".woff2"):
            shutil.copy2(src, os.path.join(dest, "fonts", name))


def git(repo, *args):
    return subprocess.run(["git", *GIT_ID, *args], cwd=repo, check=True, capture_output=True, text=True).stdout


def write_tree(dest, html, mjson, vjson, idxjson, chat=None, feed_out=None, fonts=None):
    os.makedirs(dest, exist_ok=True)
    open(os.path.join(dest, "index.html"), "w", encoding="utf-8").write(html)
    open(os.path.join(dest, "manifest.json"), "w", encoding="utf-8").write(mjson)
    open(os.path.join(dest, "version.json"), "w", encoding="utf-8").write(vjson)
    open(os.path.join(dest, "index.json"), "w", encoding="utf-8").write(idxjson)
    assets = os.path.join(HERE, "assets")
    if os.path.isdir(assets):
        shutil.copytree(assets, dest, dirs_exist_ok=True)
    open(os.path.join(dest, ".nojekyll"), "a").close()
    for name in ("kb.js", "kb.css"):
        src = os.path.join(HERE, name)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(dest, name))
    copy_frontend(dest, chat, feed_out)
    copy_fonts(dest, fonts)


def arg_value(flag):
    if flag not in sys.argv:
        return None
    i = sys.argv.index(flag)
    if i + 1 >= len(sys.argv):
        sys.exit("missing value for %s" % flag)
    return sys.argv[i + 1]


def main():
    repo = arg_value("--repo") or "/workspace/qian-drive-repo"
    manifest_path = arg_value("--manifest")
    index_path = arg_value("--index")
    feed_out = arg_value("--feed-out")
    fonts = arg_value("--fonts")
    if bool(manifest_path) != bool(index_path):
        sys.exit("pass both --manifest and --index, or neither")
    chat = build_chat()
    skipped = []
    if manifest_path:
        mjson = open(manifest_path, encoding="utf-8").read()
        idxjson = open(index_path, encoding="utf-8").read()
        m = json.loads(mjson)
        index = json.loads(idxjson)
    else:
        m, skipped = build_manifest(bucket())
        m["cors"] = check_cors(m["files"])
        index = build_index(m)
        mjson = json.dumps(m, ensure_ascii=False, separators=(",", ":"))
        idxjson = json.dumps(index, ensure_ascii=False, separators=(",", ":"))
    tpl = open(os.path.join(HERE, "template.html"), encoding="utf-8").read()
    html = tpl.replace("__MANIFEST__", mjson.replace("</", r"<\/")).replace("__BASE__", BASE)
    h = hashlib.sha1(html.encode("utf-8"))
    for f in frontend_files(chat, feed_out):  # page version must change when only CSS/modules change
        h.update(open(f, "rb").read())
    ver = h.hexdigest()[:12]
    html = html.replace("__VERSION__", ver)
    vjson = json.dumps({"version": ver, "generated": m["generated"]}, separators=(",", ":"))
    write_tree(repo, html, mjson, vjson, idxjson, chat, feed_out, fonts)
    write_tree(os.path.join(HERE, "dist"), html, mjson, vjson, idxjson, chat, feed_out, fonts)
    print("page version: %s" % ver)
    print("files listed: %d (%.1f MB); index.json: %d; bucket CORS for Pages origin: %s" % (
        m["count"], m["total_size"] / 1048576, index["count"],
        "yes (pdf.js inline)" if m["cors"] else "no (native-viewer fallback)"))
    if skipped:
        print("skipped (not public): %s" % ", ".join(skipped))
    if "--push" in sys.argv:
        git(repo, "add", "-A")
        if git(repo, "status", "--porcelain").strip():
            git(repo, "commit", "-m", "Refresh drive page (%d files)" % m["count"])
            git(repo, "push", "origin", "HEAD")
            print("pushed:", git(repo, "rev-parse", "--short", "HEAD").strip())
        else:
            print("no changes to push")
    print("page: https://felixzhu.github.io/QBot/")


if __name__ == "__main__":
    main()
