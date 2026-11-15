---
name: Xiaohongshu download
description: >-
  Use when the user pastes a Xiaohongshu / RedNote / xhslink link and wants to
  download or save the video, images, or note media.
---
# Xiaohongshu / RedNote download

Download media from Xiaohongshu (小红书) / RedNote share links for **personal offline use only**. Prefer local open-source tools over random watermark websites.

## Legal / safety
- Personal collection/learning only. Do not reupload or commercialize without the author's permission.
- Prefer `/workspace/tools/XHS-Downloader` (JoeanAmier) over shady parse sites.
- Never paste cookies into chat. If a cookie is needed, store it only under `/workspace/xhs/` with restricted permissions.
- No bulk profile scraping unless the user explicitly asks; warn about ToS / account risk first.

## Tool preference
1. **Primary extract:** JoeanAmier/XHS-Downloader at `/workspace/tools/XHS-Downloader` (`uv run main.py api` → POST `/xhs/detail`).
2. **Primary download:** curl the CDN URL after rewriting `http://` → `https://`, with `Referer: https://www.xiaohongshu.com/`.
3. **Video fallback:** `yt-dlp` with `--impersonate chrome` on a full explore URL that includes `xsec_token` (still rewrite CDN to https if it times out).
4. **Manual:** official App “保存到相册”, or browser DevTools Network → `mp4`.

## Critical: CDN on this box
XHS-Downloader often returns `http://sns-*.xhscdn.com/...`. On this machine, **HTTP to those hosts hangs (0 bytes)** because DNS may resolve via fake-ip; **HTTPS works**. Always:
```bash
# rewrite scheme
cdn_https="${cdn_url/http:\/\//https:\/\/}"
curl -L --fail --connect-timeout 15 --max-time 600 \
  -H 'Referer: https://www.xiaohongshu.com/' \
  -A 'Mozilla/5.0' \
  -o "/workspace/xhs/<note_id>/video.mp4" \
  "$cdn_https"
```
Do not wait on plain HTTP CDN URLs.

## Pipeline
1. Extract the URL from the paste (`xiaohongshu.com`, `rednote.com`, `xhslink.com`, `xhslink.cn`).
2. Resolve short links; keep `xsec_token` when present.
3. Call XHS-Downloader detail API (`download:false` is fine) → note id, title, author, type, download URL list.
4. Save into `/workspace/xhs/<note_id>/`, write `info.json`.
5. For each media URL: force https, curl with Referer, verify non-zero size.
6. Tell the user the file paths, type, size, and any quality caveats.
7. On failure: distinguish short-link / captcha / private / missing cookie / HTTP-CDN hang; retry https first.

## Install / run (box)
```bash
cd /workspace/tools/XHS-Downloader
uv sync --no-dev
uv run main.py api   # local API on :5556
```

Output layout:
```
/workspace/xhs/<note_id>/
  video.mp4 | 01.webp ...
  info.json
```
