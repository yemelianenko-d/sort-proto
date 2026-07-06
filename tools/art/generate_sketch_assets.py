"""Programmatic 'pencil on notebook paper' asset generator.

Reproducible art pipeline: python3 tools/art/generate_sketch_assets.py
Outputs PNGs (real alpha, spec sizes) into public/assets/images/.
"""
import math
import random
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

OUT = "public/assets/images"
SS = 4  # supersampling factor

PALETTE = [
    ("block_0", (196, 69, 58),  "cross"),      # 1 хрестик, червоний
    ("block_1", (59, 111, 181), "dots"),       # 2 крапки, синій
    ("block_2", (74, 155, 87),  "diag"),       # 3 діагоналі, зелений
    ("block_3", (224, 138, 60), "circle"),     # 4 коло, помаранчевий
    ("block_4", (138, 99, 184), "vlines"),     # 5 вертикалі, фіолетовий
    ("block_5", (138, 98, 72),  "grid"),       # 6 сітка, коричневий
    ("block_6", (47, 163, 160), "star"),       # 7 зірка, бірюзовий
    ("block_7", (216, 96, 138), "waves"),      # 8 хвилі, рожевий
]
INK = (47, 66, 110)
PENCIL = (110, 116, 132)


def grain(layer: Image.Image, seed: int, strength=0.35) -> Image.Image:
    """Multiply alpha by soft noise -> crayon texture."""
    rnd = np.random.default_rng(seed)
    a = np.asarray(layer.split()[3], dtype=np.float32)
    noise = rnd.uniform(1.0 - strength, 1.0, size=a.shape).astype(np.float32)
    # slight blur so grain looks like paper tooth, not static
    n_img = Image.fromarray((noise * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(0.6 * SS))
    noise = np.asarray(n_img, dtype=np.float32) / 255.0
    a = np.clip(a * noise, 0, 255).astype("uint8")
    r, g, b, _ = layer.split()
    return Image.merge("RGBA", (r, g, b, Image.fromarray(a)))


def brush_polyline(draw, pts, color, width, alpha, jitter, rnd, passes=2):
    """Hand-drawn stroke: jittered dots along a path, two shaky passes."""
    for p in range(passes):
        pa = int(alpha * (1.0 if p == 0 else 0.45))
        off = rnd.uniform(-jitter, jitter)
        prev = None
        for i in range(len(pts)):
            x, y = pts[i]
            x += rnd.uniform(-jitter, jitter) + off * math.sin(i * 0.35)
            y += rnd.uniform(-jitter, jitter) + off * math.cos(i * 0.3)
            if prev is not None:
                steps = max(1, int(math.hypot(x - prev[0], y - prev[1]) / (width * 0.35)))
                for s in range(steps + 1):
                    t = s / max(steps, 1)
                    cx = prev[0] + (x - prev[0]) * t
                    cy = prev[1] + (y - prev[1]) * t
                    w = width * rnd.uniform(0.75, 1.15) / 2
                    draw.ellipse([cx - w, cy - w, cx + w, cy + w], fill=color + (pa,))
            prev = (x, y)


def rounded_rect_path(x0, y0, x1, y1, r, n=140):
    """Sample points along a rounded-rect perimeter."""
    pts = []
    def arc(cx, cy, a0, a1, steps):
        for i in range(steps + 1):
            a = a0 + (a1 - a0) * i / steps
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    seg = max(6, n // 8)
    arc(x1 - r, y0 + r, -math.pi / 2, 0, seg)             # top-right corner
    pts.append((x1, y1 - r)); arc(x1 - r, y1 - r, 0, math.pi / 2, seg)
    pts.append((x0 + r, y1)); arc(x0 + r, y1 - r, math.pi / 2, math.pi, seg)
    pts.append((x0, y0 + r)); arc(x0 + r, y0 + r, math.pi, math.pi * 1.5, seg)
    pts.append((x1 - r, y0))
    return pts


def make_block(name, color, pattern, seed, size=128):
    S = size * SS
    rnd = random.Random(seed)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(S * 0.06)
    r = int(S * 0.16)
    x0, y0, x1, y1 = pad, pad, S - pad, S - pad

    # interior: warm white with a faint colour tint (occludes paper grid)
    tint = tuple(int(250 - (250 - c) * 0.10) for c in color)
    d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=tint + (255,))

    # pattern layer, clipped to interior
    pat = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    pd = ImageDraw.Draw(pat)
    inset = pad + int(S * 0.10)
    lw = S * 0.028
    if pattern == "cross":
        m = S * 0.22
        brush_polyline(pd, [(m, m), (S - m, S - m)], color, S * 0.075, 235, S * 0.008, rnd)
        brush_polyline(pd, [(S - m, m), (m, S - m)], color, S * 0.075, 235, S * 0.008, rnd)
    elif pattern == "dots":
        step = S * 0.135
        y = inset
        row = 0
        while y < S - inset:
            x = inset + (step / 2 if row % 2 else 0)
            while x < S - inset:
                rr = S * 0.030 * rnd.uniform(0.8, 1.1)
                pd.ellipse([x - rr, y - rr, x + rr, y + rr], fill=color + (225,))
                x += step
            y += step
            row += 1
    elif pattern == "diag":
        step = S * 0.12
        c = -S
        while c < S:
            brush_polyline(pd, [(max(0, -c), max(0, c)), (min(S, S - c), min(S, S + c))],
                           color, lw, 210, S * 0.006, rnd, passes=1)
            c += step
    elif pattern == "circle":
        cx, cy, cr = S / 2, S / 2, S * 0.26
        pts = [(cx + cr * math.cos(a), cy + cr * math.sin(a)) for a in
               [i / 40 * 2 * math.pi for i in range(42)]]
        brush_polyline(pd, pts, color, S * 0.06, 235, S * 0.008, rnd)
    elif pattern == "vlines":
        x = inset
        while x < S - inset:
            brush_polyline(pd, [(x, inset), (x, S - inset)], color, lw, 210, S * 0.007, rnd, passes=1)
            x += S * 0.115
    elif pattern == "grid":
        p = inset
        while p < S - inset:
            brush_polyline(pd, [(p, inset), (p, S - inset)], color, lw * 0.9, 200, S * 0.006, rnd, passes=1)
            brush_polyline(pd, [(inset, p), (S - inset, p)], color, lw * 0.9, 200, S * 0.006, rnd, passes=1)
            p += S * 0.14
    elif pattern == "star":
        cx, cy, R, ri = S / 2, S / 2 + S * 0.01, S * 0.30, S * 0.135
        pts = []
        for i in range(11):
            rad = R if i % 2 == 0 else ri
            a = -math.pi / 2 + i * math.pi / 5
            pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
        brush_polyline(pd, pts, color, S * 0.05, 235, S * 0.008, rnd)
    elif pattern == "waves":
        y = inset + S * 0.06
        while y < S - inset:
            pts = [(inset + t * (S - 2 * inset) / 30,
                    y + math.sin(t / 30 * math.pi * 3) * S * 0.035) for t in range(31)]
            brush_polyline(pd, pts, color, S * 0.045, 225, S * 0.006, rnd, passes=1)
            y += S * 0.16
    elif pattern == "question":
        # hidden block: pencil hatch + question mark
        c = -S
        while c < S:
            brush_polyline(pd, [(max(0, -c), max(0, c)), (min(S, S - c), min(S, S + c))],
                           PENCIL, lw * 0.8, 120, S * 0.006, rnd, passes=1)
            c += S * 0.085
        # hand-drawn question mark: hook + stem + dot
        import math as _m
        cx, cy, qr = S * 0.5, S * 0.38, S * 0.14
        hook = [(cx + qr * _m.cos(a), cy + qr * _m.sin(a))
                for a in [_m.pi - i * (_m.pi * 1.35) / 22 for i in range(23)]]
        hook += [(cx + qr * 0.35, cy + qr * 1.4), (cx, cy + qr * 1.9)]
        brush_polyline(pd, hook, PENCIL, S * 0.055, 240, S * 0.008, rnd)
        dy = cy + qr * 2.75
        pd.ellipse([S * 0.5 - S * 0.035, dy - S * 0.035, S * 0.5 + S * 0.035, dy + S * 0.035],
                   fill=PENCIL + (240,))

    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([x0 + 2, y0 + 2, x1 - 2, y1 - 2], radius=r, fill=255)
    pat.putalpha(Image.composite(pat.split()[3], Image.new("L", (S, S), 0), mask))
    pat = grain(pat, seed + 1)
    img.alpha_composite(pat)

    # crayon border: double sketchy pass
    border = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(border)
    path = rounded_rect_path(x0, y0, x1, y1, r)
    brush_polyline(bd, path + path[:2], color, S * 0.045, 255, S * 0.010, rnd, passes=2)
    border = grain(border, seed + 2, 0.25)
    img.alpha_composite(border)

    img = img.resize((size, size), Image.LANCZOS)
    img.save(f"{OUT}/{name}.png")
    print("ok", name)


def make_frame(name, w, h, stroke, fill, dashed, seed):
    SW, SH = w * SS, h * SS
    rnd = random.Random(seed)
    img = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(SW * 0.05)
    r = int(SW * 0.14)
    d.rounded_rectangle([pad, pad, SW - pad, SH - pad], radius=r, fill=fill)

    # lightly pencil-shaded interior (як у гайді)
    shade = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    c = -SH
    while c < SW:
        brush_polyline(sd, [(max(0, -c), max(0, c)), (min(SW, SH - c) if SH - c < SW else SW,
                       min(SH, SW + c) if SW + c < SH else SH)],
                       stroke, SW * 0.012, 26, SW * 0.004, rnd, passes=1)
        c += SW * 0.16
    mask = Image.new("L", (SW, SH), 0)
    ImageDraw.Draw(mask).rounded_rectangle([pad + 2, pad + 2, SW - pad - 2, SH - pad - 2], radius=r, fill=255)
    shade.putalpha(Image.composite(shade.split()[3], Image.new("L", (SW, SH), 0), mask))
    img.alpha_composite(shade)

    border = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    bd = ImageDraw.Draw(border)
    path = rounded_rect_path(pad, pad, SW - pad, SH - pad, r, n=220)
    if dashed:
        for i in range(0, len(path) - 6, 9):
            brush_polyline(bd, path[i:i + 5], stroke, SW * 0.030, 255, SW * 0.006, rnd, passes=1)
    else:
        brush_polyline(bd, path + path[:2], stroke, SW * 0.030, 255, SW * 0.007, rnd, passes=2)
    border = grain(border, seed + 1, 0.22)
    img.alpha_composite(border)

    img = img.resize((w, h), Image.LANCZOS)
    img.save(f"{OUT}/{name}.png")
    print("ok", name)


if __name__ == "__main__":
    for i, (name, color, pattern) in enumerate(PALETTE):
        make_block(name, color, pattern, seed=100 + i)
    make_block("block_hidden", PENCIL, "question", seed=200)
    make_frame("col_frame", 96, 224, INK, (255, 255, 255, 170), False, 300)
    make_frame("col_frame_selected", 96, 224, (201, 106, 16), (255, 236, 205, 220), False, 301)
    make_frame("col_frame_target", 96, 224, (46, 122, 63), (222, 242, 226, 220), True, 302)
