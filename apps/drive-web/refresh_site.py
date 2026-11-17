#!/usr/bin/env python3
"""Rebuild Qian's Drive (read-only page on GitHub Pages) from OSS bucket qian-grokbot.

Lists the bucket (read-only), keeps publicly readable objects only (skips
_site/, trash/, _test/ and private-ACL objects), embeds the file list into
template.html, and writes index.html + manifest.json + PWA assets into the
GitHub Pages repo dir (default /workspace/qian-drive-repo). Writes nothing to
OSS. Credentials come from OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET and are
never printed or written anywhere.

Usage: python3 refresh_site.py [--push] [--repo DIR]
  --push   git commit + push the repo (only if something changed)
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


def git(repo, *args):
    return subprocess.run(["git", *GIT_ID, *args], cwd=repo, check=True, capture_output=True, text=True).stdout


def main():
    repo = sys.argv[sys.argv.index("--repo") + 1] if "--repo" in sys.argv else "/workspace/qian-drive-repo"
    m, skipped = build_manifest(bucket())
    m["cors"] = check_cors(m["files"])
    mjson = json.dumps(m, ensure_ascii=False, separators=(",", ":"))
    tpl = open(os.path.join(HERE, "template.html"), encoding="utf-8").read()
    html = tpl.replace("__MANIFEST__", mjson.replace("</", r"<\/")).replace("__BASE__", BASE)
    ver = hashlib.sha1(html.encode("utf-8")).hexdigest()[:12]
    html = html.replace("__VERSION__", ver)
    vjson = json.dumps({"version": ver, "generated": m["generated"]}, separators=(",", ":"))
    for d in (repo, os.path.join(HERE, "dist")):
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "index.html"), "w", encoding="utf-8").write(html)
        open(os.path.join(d, "manifest.json"), "w", encoding="utf-8").write(mjson)
        open(os.path.join(d, "version.json"), "w", encoding="utf-8").write(vjson)
        shutil.copytree(os.path.join(HERE, "assets"), d, dirs_exist_ok=True)
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
