#!/usr/bin/env python3
"""Build-only entry for the tested public site.

Downloads the pinned public inputs, checks their SHA256, and runs
refresh_site.py without --push. Fonts, feed media, and the chat bundle are
not stored in this source tree. When apps/chat-web still matches
pins/chat-web.sha256, the published chat bundle is reused so the page
version stamp stays comparable to the tested candidate. A chat-source
change rebuilds the bundle and is recorded as a provenance difference,
not as a behavior result.

Does not enable GitHub Pages, publish, or read OSS credentials.
"""
import hashlib, json, os, shutil, subprocess, sys, tempfile, urllib.request
from urllib.parse import quote

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
PINS = os.path.join(HERE, "pins")
DEFAULT_ORIGIN = "https://felixzhu.github.io/qian-drive/"
CHAT_DIST = os.path.join(REPO, "apps", "chat-web", "dist")
FORBIDDEN_NAMES = ("synthetic-lesson", "harness-clip", "sample.mp4", "fixtures/")
SECRET_MARKERS = ("OSS_ACCESS_KEY_SECRET=", "AWS_SECRET_ACCESS_KEY=", "-----BEGIN PRIVATE KEY-----", "AKIA")


def arg_value(flag):
    if flag not in sys.argv:
        return None
    i = sys.argv.index(flag)
    if i + 1 >= len(sys.argv):
        sys.exit("missing value for %s" % flag)
    return sys.argv[i + 1]


def read_sums(path):
    rows = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        digest, rel = line.split(None, 1)
        rows.append((digest, rel))
    return rows


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch_inputs(staging, origin, from_dir):
    inputs = read_sums(os.path.join(PINS, "inputs.sha256"))
    for digest, rel in inputs:
        dest = os.path.join(staging, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if from_dir:
            shutil.copy2(os.path.join(from_dir, rel), dest)
        else:
            url = origin.rstrip("/") + "/" + quote(rel, safe="/")
            with urllib.request.urlopen(url, timeout=60) as r:
                open(dest, "wb").write(r.read())
        got = sha256(dest)
        if got != digest:
            sys.exit("pin mismatch %s\n expected %s\n got      %s" % (rel, digest, got))
    return inputs


def chat_source_matches():
    expected = read_sums(os.path.join(PINS, "chat-web.sha256"))
    for digest, rel in expected:
        path = os.path.join(REPO, rel)
        if not os.path.isfile(path) or sha256(path) != digest:
            return False, rel
    return True, None


def source_commit():
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def scan_output(dest):
    problems = []
    for dirpath, _, files in os.walk(dest):
        for name in files:
            rel = os.path.relpath(os.path.join(dirpath, name), dest)
            low = rel.replace("\\", "/").lower()
            if any(tok in low for tok in FORBIDDEN_NAMES):
                problems.append("fixture path in output: " + rel)
            if name.endswith(".woff2") and rel not in (
                "fonts/msyh-subset.woff2", "fonts/msyhbd-subset.woff2"):
                problems.append("unexpected font: " + rel)
            if name.endswith((".html", ".js", ".css", ".json", ".md", ".txt")):
                data = open(os.path.join(dirpath, name), "rb").read()
                try:
                    text = data.decode("utf-8")
                except UnicodeDecodeError:
                    continue
                for marker in SECRET_MARKERS:
                    if marker in text:
                        problems.append("marker %s in %s" % (marker.split("=")[0], rel))
    return problems


def compare_live(dest):
    expected = {rel: digest for digest, rel in read_sums(os.path.join(PINS, "live-20916f6.sha256"))}
    same, different, extra = [], [], []
    seen = set()
    for dirpath, _, files in os.walk(dest):
        for name in files:
            rel = os.path.relpath(os.path.join(dirpath, name), dest).replace("\\", "/")
            seen.add(rel)
            got = sha256(os.path.join(dirpath, name))
            want = expected.get(rel)
            if want is None:
                extra.append(rel)
            elif want == got:
                same.append(rel)
            else:
                different.append({"path": rel, "expected": want, "actual": got})
    missing = sorted(set(expected) - seen)
    return same, different, extra, missing


def main():
    if "--push" in sys.argv:
        sys.exit("build_pinned.py does not publish")
    origin = arg_value("--origin") or DEFAULT_ORIGIN
    from_dir = arg_value("--from-dir")
    repo = arg_value("--repo") or os.path.join(HERE, "dist")
    staging = tempfile.mkdtemp(prefix="qbot-pins-")
    try:
        inputs = fetch_inputs(staging, origin, from_dir)
        matched, drifted = chat_source_matches()
        cmd = [
            sys.executable, os.path.join(HERE, "refresh_site.py"),
            "--repo", repo,
            "--manifest", os.path.join(staging, "manifest.json"),
            "--index", os.path.join(staging, "index.json"),
            "--feed-out", os.path.join(staging, "out"),
            "--fonts", os.path.join(staging, "fonts"),
        ]
        if matched:
            shutil.rmtree(CHAT_DIST, ignore_errors=True)
            os.makedirs(CHAT_DIST, exist_ok=True)
            for name in ("chat.js", "chat.css"):
                shutil.copy2(os.path.join(staging, "chat", name), os.path.join(CHAT_DIST, name))
            cmd.append("--no-chat-build")
            chat_mode = "pinned-public-bundle"
        else:
            chat_mode = "rebuilt"
        subprocess.run(cmd, check=True)
        problems = scan_output(repo)
        if problems:
            sys.exit("output scan failed:\n" + "\n".join(problems))
        same, different, extra, missing = compare_live(repo)
        version = json.loads(open(os.path.join(repo, "version.json"), encoding="utf-8").read())
        only_stamp = sorted(row["path"] for row in different) == ["index.html", "version.json"]
        stamp = {
            "built": version.get("version"),
            "live": "0cb21751c930",
            "generatedMatchesLive": version.get("generated") == 1794940523,
            "onlyIndexAndVersionDiffer": only_stamp,
            "note": "The version is a SHA1 prefix of the HTML preimage plus frontend bytes in refresh_site order. It is not proof of behavior.",
        }
        provenance = {
            "entry": "apps/drive-web/build_pinned.py",
            "sourceCommit": source_commit(),
            "testedCandidate": "156687b25701cdd45661e1f70a17b5c19786ae22",
            "liveCommit": "20916f6cd7913a058a30e893d5812932620ce92a",
            "liveVersion": "0cb21751c930",
            "inputOrigin": from_dir or origin,
            "inputCount": len(inputs),
            "chatMode": chat_mode,
            "chatSourceDrift": drifted,
            "pageVersion": version.get("version"),
            "generated": version.get("generated"),
            "byteIdentical": sorted(same),
            "byteDifferent": different,
            "extra": extra,
            "missing": missing,
            "versionStamp": stamp,
            "versionHashIsNotBehaviorProof": True,
            "published": False,
        }
        out_path = arg_value("--provenance") or (repo.rstrip("/") + ".provenance.json")
        json.dump(provenance, open(out_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        open(out_path, "a", encoding="utf-8").write("\n")
        print("page version: %s" % version.get("version"))
        print("chat: %s" % chat_mode)
        print("byte-identical: %d" % len(same))
        print("byte-different: %d" % len(different))
        for row in different:
            print(" DIFF %s" % row["path"])
        if extra or missing:
            print("extra", extra, "missing", missing)
        print("provenance:", out_path)
        if "--strict" in sys.argv:
            sys.path.insert(0, HERE)
            import accept_site
            expect = tempfile.mkdtemp(prefix="qbot-expect-")
            try:
                # The borrowed live tree is not an optional cache. --from-dir only
                # supplies build inputs; acceptance still reads the public site.
                accept_site.fetch_tree(expect, origin, os.path.join(PINS, "live-20916f6.sha256"))
                problems = accept_site.accept_trees(repo, expect)
                problems += accept_site.copied_inputs(repo, os.path.join(PINS, "inputs.sha256"))
            finally:
                shutil.rmtree(expect, ignore_errors=True)
            if problems:
                print("strict acceptance failed:")
                print("\n".join(problems))
                sys.exit(1)
            print("strict acceptance passed")
    finally:
        shutil.rmtree(staging, ignore_errors=True)


if __name__ == "__main__":
    main()
