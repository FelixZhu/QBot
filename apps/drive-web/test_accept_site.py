#!/usr/bin/env python3
"""Negative checks for strict site acceptance. No network and no product code."""
import hashlib, os, shutil, sys, tempfile

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


def generated_pair():
    import refresh_site
    work = tempfile.mkdtemp(prefix="qbot-gen-")
    chat = os.path.join(work, "chat-dist")
    feed = os.path.join(work, "feed")
    os.makedirs(chat)
    os.makedirs(os.path.join(feed, "out"))
    write(chat, "chat.js", "document.getElementById('chat-root')")
    write(chat, "chat.css", "#chat-root{height:100%}")
    write(feed, "out/note.txt", "feed-bytes")
    template = (
        "<!doctype html><html><body>"
        '<button data-qbs-tab="chat"></button>'
        '<button data-qbs-tab="feed"></button>'
        '<button data-qbs-tab="kb"></button>'
        '<link rel="stylesheet" href="chat/chat.css?v=__VERSION__">'
        '<script type="module" src="chat/chat.js?v=__VERSION__"></script>'
        '<script id="manifest-data">__MANIFEST__</script>'
        "</body></html>"
    )
    template_path = os.path.join(work, "template.html")
    open(template_path, "w", encoding="utf-8").write(template)
    manifest = '{"generated":1794940523,"files":[]}'
    html, vjson = refresh_site.render_page(template, manifest, chat, feed)
    legal = os.path.join(work, "legal")
    old = os.path.join(work, "old")
    for root, page, ver, js, css in (
        (legal, html, vjson, open(os.path.join(chat, "chat.js"), "rb").read(), open(os.path.join(chat, "chat.css"), "rb").read()),
        (old, "<html>old</html>", '{"version":"bbbbbbbbbbbb","generated":1794940523}', b"old-chat-root", b"old"),
    ):
        write(root, "index.html", page)
        write(root, "version.json", ver)
        write(root, "manifest.json", manifest)
        write(root, "chat/chat.js", js)
        write(root, "chat/chat.css", css)
        write(root, "index.json", '{"count":4}')
    return legal, old, chat, feed, template_path, work


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
        check("generated html is not judged against the old site", accept_site.accept_trees(tampered, base), False)

        gen = tree()
        write(gen, "version.json", '{"version":"aaaaaaaaaaaa","generated":1}')
        check("generated version.json is not judged against the old site", accept_site.accept_trees(gen, base), False)

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
        check("generated page is not a live-byte failure", accept_site.accept_trees(whole, base), False)

        sourced = tree()
        write(sourced, "shell-media.js", "new-shell")
        write(base, "shell-media.js", "old-shell")
        check("source file is not judged against the old site", accept_site.accept_trees(sourced, base, ["shell-media.js"]), False)
        src = tree()
        write(src, "shell-media.js", "new-shell")
        check("source copy must match the repo file", accept_site.copies_match_source(sourced, src, ["shell-media.js"]), False)
        write(src, "shell-media.js", "tampered")
        check("tampered source copy", accept_site.copies_match_source(sourced, src, ["shell-media.js"]), True)

        legal, old, chat, feed, template_path, work = generated_pair()
        check("legal generated change passes the live compare", accept_site.accept_trees(legal, old), False)
        check("legal generated change passes the build check", accept_site.check_generated(
            legal, chat, template_path, feed), False)

        borrowed = tree()
        body = b'{"count":4}'
        write(borrowed, "index.json", body)
        pin = os.path.join(borrowed, "inputs.sha256")
        open(pin, "w", encoding="utf-8").write("%s  index.json\n" % hashlib.sha256(body).hexdigest())
        check("borrowed input matches its pin", accept_site.copied_inputs(borrowed, pin), False)
        write(borrowed, "index.json", b'{"count":9}')
        check("borrowed input tampering fails", accept_site.copied_inputs(borrowed, pin), True)

        write(legal, "chat/chat.js", b"")
        check("empty generated chat fails", accept_site.check_generated(legal, chat, template_path, feed), True)
        os.remove(os.path.join(legal, "chat/chat.css"))
        check("missing generated css fails", accept_site.check_generated(legal, chat, template_path, feed), True)
        write(legal, "chat/chat.js", b"document.getElementById('chat-root'); not-this-build")
        write(legal, "chat/chat.css", open(os.path.join(chat, "chat.css"), "rb").read())
        check("non-empty chat that is not this build fails", accept_site.check_generated(
            legal, chat, template_path, feed), True)
    finally:
        for path in (base, same, locals().get("sourced"), locals().get("src"), locals().get("borrowed"), locals().get("work")):
            if path:
                shutil.rmtree(path, ignore_errors=True)
    print("accept negatives passed")


if __name__ == "__main__":
    main()
