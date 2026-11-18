#!/usr/bin/env python3
"""Negative checks for strict site acceptance. No network and no product code."""
import os, shutil, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import accept_site


def write(root, rel, data):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "wb").write(data if isinstance(data, bytes) else data.encode("utf-8"))


def tree():
    root = tempfile.mkdtemp(prefix="qbot-accept-")
    write(root, "version.json", '{"version":"aaaaaaaaaaaa","generated":1794940523}')
    write(root, "index.html", "<html>__VERSION__ page aaaaaaaa</html>".replace("__VERSION__", "aaaaaaaaaaaa"))
    write(root, "feed.js", "feed-body")
    write(root, "index.json", '{"count":4}')
    return root


def check(name, problems, expect_fail):
    failed = bool(problems)
    if failed != expect_fail:
        sys.exit("%s: problems=%s expect_fail=%s" % (name, problems, expect_fail))
    print(("FAIL-AS-EXPECTED " if expect_fail else "PASS ") + name)


def main():
    base = tree()
    same = tree()
    try:
        check("identical", accept_site.accept_trees(same, base), False)

        stamped = tree()
        write(stamped, "version.json", '{"version":"bbbbbbbbbbbb","generated":1794940523}')
        html = open(os.path.join(base, "index.html"), "rb").read().replace(b"aaaaaaaaaaaa", b"bbbbbbbbbbbb")
        write(stamped, "index.html", html)
        check("version stamp only", accept_site.accept_trees(stamped, base), False)

        tampered = tree()
        write(tampered, "index.html", open(os.path.join(base, "index.html"), encoding="utf-8").read().replace("page", "PAGE"))
        check("html outside the stamp", accept_site.accept_trees(tampered, base), True)

        gen = tree()
        write(gen, "version.json", '{"version":"aaaaaaaaaaaa","generated":1}')
        check("generated field", accept_site.accept_trees(gen, base), True)

        feed = tree()
        write(feed, "feed.js", "feed-BODY")
        check("feed byte", accept_site.accept_trees(feed, base), True)

        missing = tree()
        os.remove(os.path.join(missing, "feed.js"))
        check("missing file", accept_site.accept_trees(missing, base), True)

        extra = tree()
        write(extra, "extra.txt", "nope")
        check("extra file", accept_site.accept_trees(extra, base), True)

        whole = tree()
        write(whole, "index.html", "<html>entirely different</html>")
        write(whole, "version.json", '{"version":"bbbbbbbbbbbb","generated":1794940523}')
        check("whole html is not exempt", accept_site.accept_trees(whole, base), True)
    finally:
        shutil.rmtree(base, ignore_errors=True)
        shutil.rmtree(same, ignore_errors=True)
    print("accept negatives passed")


if __name__ == "__main__":
    main()
