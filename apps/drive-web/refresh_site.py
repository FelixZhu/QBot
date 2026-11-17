#!/usr/bin/env python3
"""Rebuild Qian's Drive (read-only page on GitHub Pages) from OSS bucket qian-grokbot.

Lists the bucket (read-only), keeps publicly readable objects only (skips
_site/, trash/, _test/ and private-ACL objects), embeds the file list into
template.html, and writes index.html + manifest.json + PWA assets into the
GitHub Pages repo dir (default /workspace/qian-drive-repo). Writes nothing to
OSS. Credentials come from OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET and are
never printed or written anywhere.

Also builds the QBot chat tab (../chat-web, Vite) and copies its bundle to chat/,
plus the shared design CSS (tokens.css, components.css) next to index.html.

Usage: python3 refresh_site.py [--push] [--repo DIR] [--no-chat-build]
  --push           git commit + push the repo (only if something changed)
  --repo DIR       write the site somewhere else (e.g. a local preview dir)
  --no-chat-build  reuse the existing ../chat-web/dist instead of running npm run build
"""
import hashlib, json, os, shutil, subprocess, sys, time, mimetypes
import oss2

ENDPOINT = os.environ.get("OSS_ENDPOINT", "https://oss-cn-beijing.aliyuncs.com")
BUCKET = os.environ.get("OSS_BUCKET", "qian-grokbot")
BASE = "https://%s.%s" % (BUCKET, ENDPOINT.split("://", 1)[1])
EXCLUDE = ("_site/", "trash/", "_test/")
HERE = os.path.dirname(os.path.abspath(__file__))
_QBOT_WEB = "/workspace/qbot-push/apps/drive-web"
if os.path.isfile(os.path.join(_QBOT_WEB, "template.html")):
    HERE = _QBOT_WEB
GIT_ID = ["-c", "user.name=FelixZhu", "-c", "user.email=FelixZhu@users.noreply.github.com"]


def bucket():
    kid, sec = os.environ.get("OSS_ACCESS_KEY_ID"), os.environ.get("OSS_ACCESS_KEY_SECRET")
    if not kid or not sec:
        sys.exit("missing OSS credentials in environment")
    return oss2.Bucket(oss2.Auth(kid, sec), ENDPOINT, BUCKET)


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


SHARED_CSS = ("tokens.css", "components.css")


def copy_frontend(dest, chat):
    """Shared design CSS + chat bundle into the site dir (kept separate from the write loop)."""
    for name in SHARED_CSS:
        if os.path.isfile(os.path.join(HERE, name)):
            shutil.copy2(os.path.join(HERE, name), os.path.join(dest, name))
    if chat:
        shutil.rmtree(os.path.join(dest, "chat"), ignore_errors=True)
        shutil.copytree(chat, os.path.join(dest, "chat"))


def git(repo, *args):
    return subprocess.run(["git", *GIT_ID, *args], cwd=repo, check=True, capture_output=True, text=True).stdout


def main():
    repo = sys.argv[sys.argv.index("--repo") + 1] if "--repo" in sys.argv else "/workspace/qian-drive-repo"
    chat = build_chat()
    m, skipped = build_manifest(bucket())
    m["cors"] = check_cors(m["files"])
    mjson = json.dumps(m, ensure_ascii=False, separators=(",", ":"))
    tpl = open(os.path.join(HERE, "template.html"), encoding="utf-8").read()
    html = tpl.replace("__MANIFEST__", mjson.replace("</", r"<\/")).replace("__BASE__", BASE)
    h = hashlib.sha1(html.encode("utf-8"))
    for f in [os.path.join(HERE, n) for n in SHARED_CSS] + ([os.path.join(chat, n) for n in sorted(os.listdir(chat))] if chat else []):
        if os.path.isfile(f):  # page version must change when only CSS or the chat bundle changes
            h.update(open(f, "rb").read())
    ver = h.hexdigest()[:12]
    html = html.replace("__VERSION__", ver)
    vjson = json.dumps({"version": ver, "generated": m["generated"]}, separators=(",", ":"))
    for d in (repo, os.path.join(HERE, "dist")):
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "index.html"), "w", encoding="utf-8").write(html)
        open(os.path.join(d, "manifest.json"), "w", encoding="utf-8").write(mjson)
        open(os.path.join(d, "version.json"), "w", encoding="utf-8").write(vjson)
        shutil.copytree(os.path.join(HERE, "assets"), d, dirs_exist_ok=True)
        copy_frontend(d, chat)
        open(os.path.join(d, ".nojekyll"), "a").close()
    print("page version: %s" % ver)

    print("files listed: %d (%.1f MB); bucket CORS for Pages origin: %s" % (m["count"], m["total_size"] / 1048576, "yes (pdf.js inline)" if m["cors"] else "no (native-viewer fallback)"))
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
    print("page: https://felixzhu.github.io/qian-drive/")


if __name__ == "__main__":
    main()
