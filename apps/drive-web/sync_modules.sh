#!/usr/bin/env bash
# Re-copy the other engineers' standalone modules into apps/drive-web (one command, idempotent).
#   kb:   kb.js / kb.css from branch kb-tab (default) or a worktree: KB_SRC=/workspace/kb-work/apps/drive-web
#   feed: feed.js / feed.css / out/feed.json / out/media from FEED_SRC (default /workspace/qbot-feed)
#   css:  tokens.css / layout.css / components.css from DESIGN_SRC (default /workspace/qbot-design)
# Only reads the sources; never writes to them.
set -euo pipefail
cd "$(dirname "$0")"
KB_REF="${KB_REF:-kb-tab}"
FEED_SRC="${FEED_SRC:-/workspace/qbot-feed}"
DESIGN_SRC="${DESIGN_SRC:-/workspace/qbot-design}"
if [ -n "${KB_SRC:-}" ]; then cp "$KB_SRC/kb.js" "$KB_SRC/kb.css" .
else for f in kb.js kb.css; do git show "$KB_REF:apps/drive-web/$f" > "$f"; done; fi
if [ -d "$FEED_SRC" ]; then
  cp "$FEED_SRC/feed.js" "$FEED_SRC/feed.css" .
  [ -f "$FEED_SRC/out/feed.json" ] && cp "$FEED_SRC/out/feed.json" feed.json
  [ -d "$FEED_SRC/out/media" ] && { rm -rf media; cp -r "$FEED_SRC/out/media" media; }
fi
[ "${SKIP_DESIGN:-}" = 1 ] || cp "$DESIGN_SRC/tokens.css" "$DESIGN_SRC/layout.css" "$DESIGN_SRC/components.css" .
git status --short -- .
