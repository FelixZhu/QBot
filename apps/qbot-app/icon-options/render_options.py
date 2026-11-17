#!/usr/bin/env python3
"""Render four original QBot icon concepts and a comparison sheet."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path("/workspace/qian-drive-app/icon-options")
OUT.mkdir(parents=True, exist_ok=True)

CREAM = (243, 239, 231)
INK = (28, 27, 25)
INK_DEEP = (22, 21, 19)
TERRACOTTA = (217, 119, 75)  # #D9774B
OFFWHITE = (247, 243, 235)
SHEET_BG = (232, 228, 220)
LABEL = (28, 27, 25)
MUTED = (90, 86, 78)

SIZE = 1024
SCALE = 4  # draw at 4096, downsample


def ss(n: int | float) -> int:
    return int(round(n * SCALE))


def canvas(bg, size=SIZE) -> Image.Image:
    if isinstance(bg, tuple) and len(bg) == 4:
        return Image.new("RGBA", (size * SCALE, size * SCALE), bg)
    if bg is None:
        return Image.new("RGBA", (size * SCALE, size * SCALE), (0, 0, 0, 0))
    return Image.new("RGB", (size * SCALE, size * SCALE), bg)


def down(im: Image.Image) -> Image.Image:
    return im.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    path = (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        if bold
        else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    )
    return ImageFont.truetype(path, size)


# ─────────────────────────────────────────────
# A — bot face: cream squircle head, capsule eyes, ink ground
# ─────────────────────────────────────────────
def option_a() -> Image.Image:
    im = canvas(INK_DEEP)
    d = ImageDraw.Draw(im)
    S = SIZE * SCALE

    # Slightly wide squircle head — reads as a face, not a wall plate
    head_w, head_h = ss(580), ss(528)
    left = (S - head_w) // 2
    top = (S - head_h) // 2 - ss(8)
    radius = int(min(head_w, head_h) * 0.32)
    d.rounded_rectangle([left, top, left + head_w, top + head_h], radius=radius, fill=CREAM)

    # Chunkier capsule eyes in the upper half
    eye_w = ss(132)
    eye_h = ss(68)
    gap = ss(70)
    pair_w = eye_w * 2 + gap
    eye_x0 = left + (head_w - pair_w) // 2
    eye_y = top + ss(188)
    r_eye = eye_h // 2
    for i in range(2):
        x = eye_x0 + i * (eye_w + gap)
        d.rounded_rectangle([x, eye_y, x + eye_w, eye_y + eye_h], radius=r_eye, fill=INK)
    return down(im)


# ─────────────────────────────────────────────
# B — bold filled geometric Q, spark/notch tail, cream on ink
# ─────────────────────────────────────────────
def star4(cx, cy, r_long, r_short, n=4, rot_deg=-20):
    """Four-pointed spark (diamond star), points in degrees from rot."""
    pts = []
    rot = math.radians(rot_deg)
    for i in range(n * 2):
        ang = rot + i * math.pi / n
        r = r_long if i % 2 == 0 else r_short
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    return pts


def option_b() -> Image.Image:
    im = canvas(INK_DEEP)
    d = ImageDraw.Draw(im)
    S = SIZE * SCALE

    # Bowl optically a little above center so the spur tail balances the mass
    cx, cy = S / 2, S / 2 - ss(22)
    r_out = ss(300)
    r_in = ss(162)

    d.ellipse([cx - r_out, cy - r_out, cx + r_out, cy + r_out], fill=CREAM)
    d.ellipse([cx - r_in, cy - r_in, cx + r_in, cy + r_in], fill=INK_DEEP)

    # Blunt typographic spur (flat chiseled end) — a letter Q, not a chat pointer
    ang = math.radians(42)
    ux, uy = math.cos(ang), math.sin(ang)
    vx, vy = -math.sin(ang), math.cos(ang)
    half_w = (r_out - r_in) * 0.40
    base_r = r_out - ss(20)
    end_r = r_out + ss(62)
    end_scale = 0.90  # short chiseled spur, not a handle

    def at(r, off):
        return (cx + r * ux + off * vx, cy + r * uy + off * vy)

    poly = [
        at(base_r, half_w),
        at(base_r, -half_w),
        at(end_r, -half_w * end_scale),
        at(end_r, half_w * end_scale),
    ]
    d.polygon([(int(round(x)), int(round(y))) for x, y in poly], fill=CREAM)
    return down(im)


# ─────────────────────────────────────────────
# C — soft ink pebble + terracotta accent dot on cream
# ─────────────────────────────────────────────
def option_c() -> Image.Image:
    im = canvas(CREAM)
    d = ImageDraw.Draw(im)
    S = SIZE * SCALE

    # Compact pebble + dot, group optically centered, safe inside a circle crop
    pw, ph = ss(456), ss(496)
    dr = ss(70)
    gap = ss(30)

    # Area-weighted center of mass ≈ canvas center
    pebble_area = pw * ph
    dot_area = math.pi * dr * dr
    # Tentative pebble origin; dot sits off the lower-right flank
    # We'll place pebble center, then put the dot, then shift both so COM is centered.

    # Relative to pebble top-left:
    #   pebble COM ≈ (pw/2, ph/2)
    #   dot COM    ≈ (pw + gap + dr, ph - ss(92))
    dot_rel_x = pw + gap + dr
    dot_rel_y = ph - ss(88)
    com_x = (pebble_area * (pw / 2) + dot_area * dot_rel_x) / (pebble_area + dot_area)
    com_y = (pebble_area * (ph / 2) + dot_area * dot_rel_y) / (pebble_area + dot_area)

    left = S / 2 - com_x
    top = S / 2 - com_y - ss(18)  # optical lift: dark mass sits slightly high
    rad = int(min(pw, ph) * 0.42)
    d.rounded_rectangle(
        [int(left), int(top), int(left + pw), int(top + ph)], radius=rad, fill=INK
    )
    cx = left + dot_rel_x
    cy = top + dot_rel_y
    d.ellipse([cx - dr, cy - dr, cx + dr, cy + dr], fill=TERRACOTTA)

    # Safety: dot must stay inside the inscribed circle with margin
    margin = (math.hypot(cx - S / 2, cy - S / 2) + dr) / (S / 2)
    if margin > 0.86:
        raise RuntimeError(f"option C dot too close to circle edge: {margin:.3f}")
    return down(im)


# ─────────────────────────────────────────────
# D — single calligraphic brush-stroke Q / loop on off-white
# ─────────────────────────────────────────────
def _cubic(p0, p1, p2, p3, t):
    u = 1 - t
    return (
        u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0],
        u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1],
    )


def _lerp_pt(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def stroke_path(d: ImageDraw.ImageDraw, curves, width_fn, color, nib_ratio=1.35, nib_angle=math.radians(38)):
    """Variable-width calligraphic stroke along cubic segments (arc-length sampled)."""
    raw = []
    for p0, p1, p2, p3 in curves:
        for i in range(80):
            raw.append(_cubic(p0, p1, p2, p3, i / 80))
        raw.append(_cubic(p0, p1, p2, p3, 1.0))

    # arc-length parameterization
    dist = [0.0]
    for i in range(1, len(raw)):
        dx = raw[i][0] - raw[i - 1][0]
        dy = raw[i][1] - raw[i - 1][1]
        dist.append(dist[-1] + math.hypot(dx, dy))
    total = dist[-1] or 1.0

    # resample every ~0.4 px at working resolution
    step = 0.4
    n = int(total / step)
    pts = []
    ts = []
    j = 0
    for i in range(n + 1):
        target = total * (i / n)
        while j < len(dist) - 2 and dist[j + 1] < target:
            j += 1
        span = dist[j + 1] - dist[j] or 1.0
        u = (target - dist[j]) / span
        pts.append(_lerp_pt(raw[j], raw[j + 1], u))
        ts.append(i / n)

    for (x, y), t in zip(pts, ts):
        w = width_fn(t)
        # slightly elliptical nib, fixed brush angle for a hand-drawn feel
        a = w / 2 * nib_ratio
        b = w / 2 / nib_ratio
        # rotated ellipse via a small polygon
        segs = 24
        poly = []
        ca, sa = math.cos(nib_angle), math.sin(nib_angle)
        for k in range(segs):
            ang = 2 * math.pi * k / segs
            px, py = a * math.cos(ang), b * math.sin(ang)
            poly.append((x + px * ca - py * sa, y + px * sa + py * ca))
        d.polygon([(int(round(px)), int(round(py))) for px, py in poly], fill=color)


def option_d() -> Image.Image:
    im = canvas(OFFWHITE)
    d = ImageDraw.Draw(im)
    S = SIZE * SCALE

    # Coordinate helper in a 0–1 box mapped into a padded square
    pad = ss(214)
    box = S - 2 * pad

    def P(x, y):
        # y grows down; design in a conventional 0–1 box
        return (pad + x * box, pad + y * box)

    # One continuous Q, starting at the tail tip and entering the bowl
    # clockwise, then almost closing with a small enso gap — no reversal,
    # so the tail is a natural brush attack rather than a hooked afterthought.
    curves = [
        # tail tip, up into the lower-right of the bowl
        (P(0.70, 0.99), P(0.78, 0.88), P(0.85, 0.72), P(0.85, 0.54)),
        # right side up to the top
        (P(0.85, 0.54), P(0.85, 0.32), P(0.70, 0.10), P(0.50, 0.10)),
        # top to left
        (P(0.50, 0.10), P(0.28, 0.10), P(0.13, 0.26), P(0.13, 0.50)),
        # left to bottom (fullest pressure)
        (P(0.13, 0.50), P(0.13, 0.74), P(0.30, 0.91), P(0.52, 0.91)),
        # bottom, lift well before the tail so the enso gap stays clean
        (P(0.52, 0.91), P(0.58, 0.91), P(0.63, 0.89), P(0.64, 0.85)),
    ]

    def width_fn(t: float) -> float:
        # confident tail tip, swell as it enters the bowl, full through the body,
        # a clearer taper at the brush lift so the terminal isn't a blob
        if t < 0.14:
            p = t / 0.14
            k = 0.20 + 0.64 * (p * p * (3 - 2 * p))
        elif t < 0.78:
            mid = (t - 0.14) / 0.64
            k = 0.82 + 0.18 * math.sin(math.pi * mid)
        else:
            p = (t - 0.78) / 0.22
            k = 0.88 - 0.50 * (p * p * (3 - 2 * p))
        return ss(96) * k

    stroke_path(d, curves, width_fn, INK, nib_ratio=1.26, nib_angle=math.radians(32))
    return down(im)


# ─────────────────────────────────────────────
# Comparison sheet
# ─────────────────────────────────────────────
def rounded_mask(size: int, radius: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def circle_mask(size: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse([0, 0, size - 1, size - 1], fill=255)
    return m


def soft_shadow(canvas_im, xy, wh, radius, blur=18, opacity=48):
    pad = blur * 3
    layer = Image.new("RGBA", (wh[0] + pad * 2, wh[1] + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(
        [pad, pad, pad + wh[0] - 1, pad + wh[1] - 1], radius=radius, fill=(0, 0, 0, opacity)
    )
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    canvas_im.paste(layer, (xy[0] - pad, xy[1] - pad), layer)


def comparison(icons: dict[str, Image.Image], captions: dict[str, str]) -> Image.Image:
    # Four columns: large squircle + circle below, big letter, caption
    W, H = 2400, 1280
    sheet = Image.new("RGB", (W, H), SHEET_BG)
    rgba = sheet.convert("RGBA")
    d = ImageDraw.Draw(rgba)

    title_f = font(54, True)
    sub_f = font(24, False)
    letter_f = font(56, True)
    cap_f = font(22, False)

    d.text((100, 64), "QBot", font=title_f, fill=LABEL)
    d.text((280, 82), "icon options  ·  four directions", font=sub_f, fill=MUTED)

    keys = ["A", "B", "C", "D"]
    col_w = 540
    left0 = 90
    sq = 400
    circ = 220
    top_sq = 220

    for i, k in enumerate(keys):
        cx0 = left0 + i * col_w
        icon = icons[k].convert("RGB")

        # Letter
        d.text((cx0, 168), k, font=letter_f, fill=LABEL)

        # Rounded square
        x, y = cx0, top_sq
        soft_shadow(rgba, (x, y), (sq, sq), radius=int(sq * 0.22), blur=22, opacity=42)
        tile = icon.resize((sq, sq), Image.Resampling.LANCZOS)
        mask = rounded_mask(sq, int(sq * 0.22))
        rgba.paste(tile, (x, y), mask)

        # Circle
        cx = cx0 + (sq - circ) // 2
        cy = top_sq + sq + 70
        soft_shadow(rgba, (cx, cy), (circ, circ), radius=circ // 2, blur=16, opacity=36)
        ctile = icon.resize((circ, circ), Image.Resampling.LANCZOS)
        rgba.paste(ctile, (cx, cy), circle_mask(circ))

        # Caption under circle
        cap = captions[k]
        bb = d.textbbox((0, 0), cap, font=cap_f)
        tw = bb[2] - bb[0]
        d.text((cx0 + (sq - tw) // 2, cy + circ + 28), cap, font=cap_f, fill=MUTED)

    return rgba.convert("RGB")


def main():
    icons = {
        "A": option_a(),
        "B": option_b(),
        "C": option_c(),
        "D": option_d(),
    }
    captions = {
        "A": "Bot face on ink",
        "B": "Bold typographic Q",
        "C": "Pebble and accent",
        "D": "Brush-stroke Q",
    }
    for k, im in icons.items():
        path = OUT / f"option-{k}.png"
        im.save(path, "PNG")
        print(f"wrote {path} {im.size} {im.mode}")

    sheet = comparison(icons, captions)
    path = OUT / "compare.png"
    sheet.save(path, "PNG")
    print(f"wrote {path} {sheet.size} {sheet.mode}")


if __name__ == "__main__":
    main()
