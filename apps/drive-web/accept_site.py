#!/usr/bin/env python3
"""Strict acceptance for a built site tree.

An ordinary build records differences and still exits 0. This check fails
when a path is missing, extra, or different. Source copies are compared to
this repo. Borrowed inputs are compared to their pins. The generated page
and chat bundle are not compared to the previous live bytes; check_generated
requires each whitelist path to be non-empty, produced by this build, and
usable.
"""
import hashlib, json, os, sys, urllib.request
from urllib.parse import quote

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ORIGIN = "https://felixzhu.github.io/QBot/"


def arg_value(flag):
    if flag not in sys.argv:
        return None
    i = sys.argv.index(flag)
    if i + 1 >= len(sys.argv):
        sys.exit("missing value for %s" % flag)
    return sys.argv[i + 1]


def read_url(url, attempts=4):
    """Borrow a public file. Retry only transient gateway failures."""
    import time
    import urllib.error
    last = None
    for i in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code not in (429, 500, 502, 503, 504) or i == attempts - 1:
                raise
            time.sleep(2 * (i + 1))
    raise last


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def files_in(root):
    found = {}
    for dirpath, _, names in os.walk(root):
        for name in names:
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, root).replace("\\", "/")
            found[rel] = path
    return found


def read_sums(path):
    rows = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        digest, rel = line.split(None, 1)
        rows.append((digest, rel))
    return rows


def version_of(root):
    path = os.path.join(root, "version.json")
    if not os.path.isfile(path):
        return None
    try:
        return json.loads(open(path, encoding="utf-8").read()).get("version")
    except (OSError, ValueError):
        return None


def normalize(rel, built, expected, built_ver, expected_ver):
    """Return bytes that must match, or None when the whitelist cannot apply."""
    if rel.endswith(".html"):
        out_b, out_e = built, expected
        for stamp in (built_ver, expected_ver):
            if stamp:
                token = stamp.encode("utf-8")
                out_b = out_b.replace(token, b"__VERSION__")
                out_e = out_e.replace(token, b"__VERSION__")
        return out_b, out_e
    if rel == "version.json":
        def one(raw, ver):
            if not ver:
                return raw
            needle = b'"version":"' + ver.encode("utf-8") + b'"'
            if raw.count(needle) != 1:
                return None
            return raw.replace(needle, b'"version":"__VERSION__"', 1)
        return one(built, built_ver), one(expected, expected_ver)
    return built, expected


SOURCE_COPIES = (
    "tokens.css", "layout.css", "components.css",
    "feed.js", "feed.css", "kb.js", "kb.css",
    "shell-media.js", "shell-theme.js",
)

# Produced by refresh_site from the current template and chat build.
# Not compared to the previously published site.
GENERATED_OUTPUTS = (
    "index.html",
    "version.json",
    "chat/chat.js",
    "chat/chat.css",
)


def accept_trees(built_root, expected_root, source_checked=()):
    """Problems are human-readable. Empty means the trees agree under the whitelist.

    source_checked paths are copied from this repo, so they are not required to
    match the previously published site. copies_match_source checks those.
    """
    problems = []
    source_checked = set(source_checked)
    built = files_in(built_root)
    expected = files_in(expected_root)
    built_ver = version_of(built_root)
    expected_ver = version_of(expected_root)
    generated = set(GENERATED_OUTPUTS)
    for rel in sorted(set(expected) - set(built)):
        if rel in generated:
            continue
        problems.append("missing %s" % rel)
    for rel in sorted(set(built) - set(expected)):
        if rel in generated:
            continue
        problems.append("extra %s" % rel)
    for rel in sorted(set(built) & set(expected)):
        if rel in source_checked or rel in generated:
            continue
        b = open(built[rel], "rb").read()
        e = open(expected[rel], "rb").read()
        nb, ne = normalize(rel, b, e, built_ver, expected_ver)
        if nb is None or ne is None:
            problems.append("unstampable %s" % rel)
        elif nb != ne:
            problems.append("differs %s" % rel)
    return problems


def copies_match_source(built_root, source_root, names=SOURCE_COPIES):
    problems = []
    for rel in names:
        built = os.path.join(built_root, rel)
        source = os.path.join(source_root, rel)
        if not os.path.isfile(built) or not os.path.isfile(source):
            problems.append("source copy missing %s" % rel)
        elif open(built, "rb").read() != open(source, "rb").read():
            problems.append("source copy differs %s" % rel)
    return problems


def fetch_tree(dest, origin, pins):
    os.makedirs(dest, exist_ok=True)
    generated = set(GENERATED_OUTPUTS)
    for digest, rel in read_sums(pins):
        # Page and chat files are produced by this build. Do not borrow them.
        if rel in generated or rel.startswith("chat/"):
            continue
        path = os.path.join(dest, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        url = origin.rstrip("/") + "/" + quote(rel, safe="/")
        open(path, "wb").write(read_url(url))
        got = sha256(path)
        if got != digest:
            sys.exit("borrowed file hash mismatch %s" % rel)


def check_generated(built_root, chat_dist, template_path, feed_out):
    """Whitelist only. Empty, missing, or not produced by this build fails."""
    import refresh_site
    problems = []
    present = {}
    for rel in GENERATED_OUTPUTS:
        path = os.path.join(built_root, rel)
        if not os.path.isfile(path) or os.path.getsize(path) == 0:
            problems.append("generated missing or empty %s" % rel)
        else:
            present[rel] = open(path, "rb").read()
    for name in ("chat.js", "chat.css"):
        src = os.path.join(chat_dist, name)
        rel = "chat/" + name
        if not os.path.isfile(src) or os.path.getsize(src) == 0:
            problems.append("generated chat build missing %s" % name)
        elif rel in present and present[rel] != open(src, "rb").read():
            problems.append("generated not from this build %s" % rel)
    if "index.html" in present:
        html = present["index.html"].decode("utf-8")
        for needle in (
            'data-qbs-tab="chat"', 'data-qbs-tab="feed"', 'data-qbs-tab="kb"',
            "chat/chat.js", "chat/chat.css",
        ):
            if needle not in html:
                problems.append("generated index.html unusable, missing %s" % needle)
    if "chat/chat.js" in present and b"chat-root" not in present["chat/chat.js"]:
        problems.append("generated chat.js does not mount chat-root")
    if "chat/chat.css" in present and b"#chat-root" not in present["chat/chat.css"]:
        problems.append("generated chat.css has no chat-root rules")
    manifest_path = os.path.join(built_root, "manifest.json")
    if not os.path.isfile(manifest_path) or not os.path.isfile(template_path):
        problems.append("generated source inputs missing")
        return problems
    if set(GENERATED_OUTPUTS) - set(present):
        return problems
    manifest_text = open(manifest_path, encoding="utf-8").read()
    template = open(template_path, encoding="utf-8").read()
    html, vjson = refresh_site.render_page(template, manifest_text, chat_dist, feed_out)
    if present["index.html"].decode("utf-8") != html:
        problems.append("generated index.html is not this template build")
    if present["version.json"].decode("utf-8") != vjson:
        problems.append("generated version.json is not this build stamp")
    return problems


def copied_inputs(built_root, pins):
    """Pinned catalog bytes must be copied, not rewritten."""
    problems = []
    for digest, rel in read_sums(pins):
        if rel.startswith("chat/") or rel.startswith("fonts/"):
            continue
        path = os.path.join(built_root, rel)
        if not os.path.isfile(path):
            problems.append("built input missing %s" % rel)
        elif sha256(path) != digest:
            problems.append("built input changed %s" % rel)
    return problems


def main():
    built = arg_value("--built")
    expect = arg_value("--expect")
    if not built:
        sys.exit("pass --built DIR")
    if expect:
        problems = accept_trees(built, expect)
    else:
        origin = arg_value("--origin") or DEFAULT_ORIGIN
        pins = arg_value("--pins") or os.path.join(HERE, "pins", "live-qbot.sha256")
        import tempfile, shutil
        dest = tempfile.mkdtemp(prefix="qbot-expect-")
        try:
            fetch_tree(dest, origin, pins)
            problems = accept_trees(built, dest)
        finally:
            shutil.rmtree(dest, ignore_errors=True)
    problems += copied_inputs(built, os.path.join(HERE, "pins", "inputs.sha256"))
    problems += check_generated(
        built,
        os.path.join(os.path.dirname(HERE), "chat-web", "dist"),
        os.path.join(HERE, "template.html"),
        os.path.join(built, "out"),
    )
    if problems:
        print("strict acceptance failed:")
        print("\n".join(problems))
        sys.exit(1)
    print("strict acceptance passed")


if __name__ == "__main__":
    main()
