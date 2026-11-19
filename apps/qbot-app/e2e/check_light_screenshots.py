#!/usr/bin/env python3
"""Fail when a required screenshot is missing or a light-mode shot is black.

Maestro writes PNGs under the directory passed on the command line. Light
shots use the app's cream canvas, so a mean channel near zero means the
screen never drew. Dark-mode shots are only required to exist.
"""
import struct
import sys
import zlib
from pathlib import Path

REQUIRED = (
    "light-chat-home",
    "light-demo-thread",
    "light-feed-top",
    "light-feed-scrolled-down",
    "light-feed-scrolled-up",
    "light-feed-detail",
    "light-feed-video",
    "light-feed-game",
    "light-feed-restored",
    "light-feed-demo-info",
    "light-feed-demo-info-open",
    "light-feed-demo-info-account",
    "light-feed-demo-english",
    "light-feed-demo-english-open",
    "light-feed-demo-english-account",
    "light-feed-demo-study",
    "light-feed-demo-study-open",
    "light-feed-demo-study-account",
    "light-kb",
    "light-chat-return",
    "dark-chat-home",
)
# Cream canvas is about 237. The dark canvas is about 22. 80 separates them.
LIGHT_MIN_MEAN = 80


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def mean_luminance(path: Path) -> float:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"not a png: {path}")
    pos = 8
    width = height = color_type = None
    idat = []
    while pos + 8 <= len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        kind = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, depth, color_type, _comp, _filt, interlace = struct.unpack(">IIBBBBB", chunk)
            if depth != 8 or interlace != 0 or color_type not in (2, 6):
                raise SystemExit(f"unsupported png {path}: depth={depth} color={color_type} interlace={interlace}")
        elif kind == b"IDAT":
            idat.append(chunk)
        elif kind == b"IEND":
            break
    if width is None or height is None or color_type is None:
        raise SystemExit(f"png missing header: {path}")
    raw = zlib.decompress(b"".join(idat))
    channels = 4 if color_type == 6 else 3
    stride = width * channels
    step = 1 if width < 32 else 4
    total = 0.0
    count = 0
    i = 0
    prev = bytearray(stride)
    for y in range(height):
        filt = raw[i]
        i += 1
        row = bytearray(raw[i : i + stride])
        i += stride
        if filt == 1:
            for x in range(stride):
                left = row[x - channels] if x >= channels else 0
                row[x] = (row[x] + left) & 255
        elif filt == 2:
            for x in range(stride):
                row[x] = (row[x] + prev[x]) & 255
        elif filt == 3:
            for x in range(stride):
                left = row[x - channels] if x >= channels else 0
                row[x] = (row[x] + ((left + prev[x]) // 2)) & 255
        elif filt == 4:
            for x in range(stride):
                a = row[x - channels] if x >= channels else 0
                b = prev[x]
                c = prev[x - channels] if x >= channels else 0
                row[x] = (row[x] + _paeth(a, b, c)) & 255
        elif filt != 0:
            raise SystemExit(f"unsupported png filter {filt} in {path}")
        prev = row
        if y % step:
            continue
        for x in range(0, width, step):
            o = x * channels
            total += (row[o] + row[o + 1] + row[o + 2]) / 3
            count += 1
    if count == 0:
        raise SystemExit(f"empty png: {path}")
    return total / count


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: check_light_screenshots.py <artifact-dir>")
    root = Path(sys.argv[1])
    pngs = sorted(p for p in root.rglob("*.png") if p.is_file())
    if not pngs:
        raise SystemExit(f"no screenshots under {root}")
    by_stem = {p.stem: p for p in pngs}
    missing = [name for name in REQUIRED if name not in by_stem]
    if missing:
        print("found:", ", ".join(sorted(by_stem)))
        raise SystemExit("missing screenshots: " + ", ".join(missing))
    failed = False
    for name in REQUIRED:
        path = by_stem[name]
        mean = mean_luminance(path)
        print(f"{path}: mean={mean:.1f}")
        if name.startswith("light-feed"):
            # The six-lesson feed is dark on purpose, including in light mode.
            if mean < 8:
                print(f"FAIL {path} looks blank (mean {mean:.1f} < 8)")
                failed = True
        elif name.startswith("light-") and mean < LIGHT_MIN_MEAN:
            print(f"FAIL {path} looks black (mean {mean:.1f} < {LIGHT_MIN_MEAN})")
            failed = True
    if failed:
        raise SystemExit(1)
    print("light screenshots are not black")


if __name__ == "__main__":
    main()
