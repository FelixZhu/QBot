#!/usr/bin/env python3
"""Strict acceptance for a built site tree.

An ordinary build records differences and still exits 0. This check fails
when a path is missing, extra, or different. index.html may differ only by
the version stamp. version.json may differ only in its "version" field.
No file is skipped as a whole.
"""
import hashlib, json, os, sys, urllib.request
from urllib.parse import quote

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ORIGIN = "https://felixzhu.github.io/qian-drive/"


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


def accept_trees(built_root, expected_root):
    """Problems are human-readable. Empty means the trees agree under the whitelist."""
    problems = []
    built = files_in(built_root)
    expected = files_in(expected_root)
    built_ver = version_of(built_root)
    expected_ver = version_of(expected_root)
    for rel in sorted(set(expected) - set(built)):
        problems.append("missing %s" % rel)
    for rel in sorted(set(built) - set(expected)):
        problems.append("extra %s" % rel)
    for rel in sorted(set(built) & set(expected)):
        b = open(built[rel], "rb").read()
        e = open(expected[rel], "rb").read()
        nb, ne = normalize(rel, b, e, built_ver, expected_ver)
        if nb is None or ne is None:
            problems.append("unstampable %s" % rel)
        elif nb != ne:
            problems.append("differs %s" % rel)
    return problems


def fetch_tree(dest, origin, pins):
    os.makedirs(dest, exist_ok=True)
    for digest, rel in read_sums(pins):
        path = os.path.join(dest, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        url = origin.rstrip("/") + "/" + quote(rel, safe="/")
        open(path, "wb").write(read_url(url))
        got = sha256(path)
        if got != digest:
            sys.exit("borrowed file hash mismatch %s" % rel)


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
        pins = arg_value("--pins") or os.path.join(HERE, "pins", "live-20916f6.sha256")
        import tempfile, shutil
        dest = tempfile.mkdtemp(prefix="qbot-expect-")
        try:
            fetch_tree(dest, origin, pins)
            problems = accept_trees(built, dest)
        finally:
            shutil.rmtree(dest, ignore_errors=True)
    problems += copied_inputs(built, os.path.join(HERE, "pins", "inputs.sha256"))
    if problems:
        print("strict acceptance failed:")
        print("\n".join(problems))
        sys.exit(1)
    print("strict acceptance passed")


if __name__ == "__main__":
    main()
