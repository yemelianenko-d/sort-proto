"""Imports individually AI-generated block images:
removes white/checkerboard backgrounds via corner flood fill, trims,
resizes to spec (128px) and saves under manifest keys.
Usage: python3 tools/art/cut_generated_blocks.py <mapping: name=path ...>
"""
import sys
from collections import deque
from PIL import Image, ImageDraw, ImageFilter, ImageOps
import numpy as np


def keep_largest_component(alpha_small):
    """Drops stray specks but keeps ALL significant regions (multi-stroke
    assets like sparkle accents are several separate marks)."""
    a = np.asarray(alpha_small) > 24
    h, w = a.shape
    labels = np.zeros((h, w), dtype=np.int32)
    best_label, best_size, cur = 0, 0, 0
    for sy in range(h):
        for sx in range(w):
            if a[sy, sx] and labels[sy, sx] == 0:
                cur += 1
                size = 0
                q = deque([(sy, sx)])
                labels[sy, sx] = cur
                while q:
                    y, x = q.popleft()
                    size += 1
                    for ny, nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
                        if 0 <= ny < h and 0 <= nx < w and a[ny, nx] and labels[ny, nx] == 0:
                            labels[ny, nx] = cur
                            q.append((ny, nx))
                if size > best_size:
                    best_size, best_label = size, cur
    sizes = {}
    for lab in range(1, cur + 1):
        sizes[lab] = int((labels == lab).sum())
    threshold = max(40, int(best_size * 0.08))
    keep = np.zeros_like(labels, dtype=bool)
    for lab, size in sizes.items():
        if size >= threshold:
            keep |= labels == lab
    out = np.asarray(alpha_small).copy()
    out[~keep] = 0
    return Image.fromarray(out)

OUT = "public/assets/images"
SENTINEL = (255, 0, 255)

def remove_bg_floodfill(path, work=640):
    src = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    w0, h0 = src.size
    im = src.resize((work, int(h0 * work / w0)), Image.LANCZOS)
    w, h = im.size
    for corner in [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)]:
        try:
            ImageDraw.floodfill(im, corner, SENTINEL, thresh=150)
        except Exception:
            pass
    # bg mask = sentinel pixels
    mask = Image.new("L", (w, h), 0)
    px = im.load(); mp = mask.load()
    for y in range(h):
        for x in range(w):
            if px[x, y] == SENTINEL:
                mp[x, y] = 255
    # розширюємо фон на 2px усередину, щоб зняти світлий обідок
    mask = mask.filter(ImageFilter.MaxFilter(5))
    alpha_small = keep_largest_component(ImageOps.invert(mask))
    alpha = alpha_small.resize((w0, h0), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
    out = src.convert("RGBA")
    out.putalpha(alpha)
    bbox = alpha.point(lambda a: 255 if a > 24 else 0).getbbox()
    out = out.crop(bbox)
    return out

def remove_bg(path, work=640, preserve_center_hole=False, fill_holes=True):
    """Chooses the right background removal:
    - solid gray bg -> global chroma key (robust for dashed/thin outlines);
    - near-white bg -> flood fill from corners (legacy path)."""
    src = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    a = np.asarray(src, dtype=np.int16)
    h, w = a.shape[:2]
    corners = np.concatenate([
        a[:20, :20].reshape(-1, 3), a[:20, -20:].reshape(-1, 3),
        a[-20:, :20].reshape(-1, 3), a[-20:, -20:].reshape(-1, 3),
    ])
    bg = np.median(corners, axis=0)
    if bg.min() > 228:  # білий фон: chroma key з'їв би світлі нутрощі
        return remove_bg_floodfill(path, work)

    dist = np.sqrt(((a - bg) ** 2).sum(axis=2))
    fg = dist > 40

    # Enclosed background-coloured pockets inside a shape (e.g. gear body)
    # are NOT background: fill them with paper colour instead of cutting.
    edge_bg = np.zeros((h, w), dtype=bool)
    from collections import deque as _dq
    q = _dq()
    for x in range(w):
        for y in (0, h - 1):
            if not fg[y, x] and not edge_bg[y, x]:
                edge_bg[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not fg[y, x] and not edge_bg[y, x]:
                edge_bg[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and not fg[ny, nx] and not edge_bg[ny, nx]:
                edge_bg[ny, nx] = True
                q.append((ny, nx))
    holes = (~fg) & (~edge_bg) if fill_holes else np.zeros((h, w), dtype=bool)
    if preserve_center_hole and holes[h // 2, w // 2]:
        # відкриваємо дірку, що містить центр (наприклад, отвір шестерні)
        center = np.zeros((h, w), dtype=bool)
        q2 = _dq([(h // 2, w // 2)])
        center[h // 2, w // 2] = True
        while q2:
            y, x = q2.popleft()
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and holes[ny, nx] and not center[ny, nx]:
                    center[ny, nx] = True
                    q2.append((ny, nx))
        holes &= ~center
    if holes.any():
        a[holes] = (252, 249, 240)
        fg = fg | holes

    small_h = max(1, round(h * work / w))
    mask_small = Image.fromarray((fg * 255).astype("uint8")).resize((work, small_h), Image.NEAREST)
    keep_small = keep_largest_component(mask_small)
    keep = keep_small.resize((w, h), Image.NEAREST)
    fg = fg & (np.asarray(keep) > 128)
    alpha = Image.fromarray((fg * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.5))
    out = src.convert("RGBA")
    out.putalpha(alpha)
    bbox = alpha.point(lambda v: 255 if v > 24 else 0).getbbox()
    return out.crop(bbox)


def hollow_interior(im, erode=9):
    """Makes bright low-saturation interiors fully transparent so the game
    paper shows through (concept look for level cells)."""
    a = np.asarray(im).copy()
    r, g, b, al = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int), a[..., 3]
    sat = np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)
    interior = (al > 180) & (np.minimum(np.minimum(r, g), b) > 200) & (sat < 48)
    shrink = Image.fromarray((interior * 255).astype("uint8")).filter(ImageFilter.MinFilter(erode))
    interior = np.asarray(shrink) > 128
    a[..., 3] = np.where(interior, 0, a[..., 3])
    return Image.fromarray(a)


def save_block(name, path):
    im = remove_bg(path)
    side = max(im.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    canvas = canvas.resize((128, 128), Image.LANCZOS)
    canvas.save(f"{OUT}/{name}.png")
    print("ok", name, "from", path.split("/")[-1])

def hand_wobble(im, amp, wavelength, seed=7):
    """Hand-drawn tremor: smooth low-frequency displacement of rows/columns,
    so machine-straight generated lines look drawn by hand."""
    pad = int(amp) + 2
    padded = Image.new("RGBA", (im.width + pad * 2, im.height + pad * 2), (0, 0, 0, 0))
    padded.paste(im, (pad, pad))
    a = np.asarray(padded).copy()
    h, w = a.shape[:2]
    rng = np.random.default_rng(seed)

    def smooth(n, wl, amplitude):
        k = max(3, int(n / wl) + 2)
        pts = rng.uniform(-amplitude, amplitude, k)
        xs = np.linspace(0, n - 1, k)
        return np.rint(np.interp(np.arange(n), xs, pts)).astype(int)

    dx = smooth(h, wavelength, amp)   # горизонтальний зсув кожного рядка
    dy = smooth(w, wavelength, amp)   # вертикальний зсув кожної колонки
    for y in range(h):
        a[y] = np.roll(a[y], dx[y], axis=0)
    for x in range(w):
        a[:, x] = np.roll(a[:, x], dy[x], axis=0)
    out = Image.fromarray(a)
    bbox = out.split()[3].point(lambda v: 255 if v > 24 else 0).getbbox()
    return out.crop(bbox)


def shade_interior(im, alpha=168, tint=(252, 249, 240), texture_strength=0.5, texture_scale=1.0):
    """Paper-style interior: translucent cream fill; if a pencil texture tile
    (public/assets/images/tex_pencil.png) is present, it is tiled over the
    interior with a multiply blend. No programmatic hatch."""
    a = np.asarray(im).copy()
    r, g, b, al = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int), a[..., 3]
    sat = np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)
    interior = (al > 200) & (np.minimum(np.minimum(r, g), b) > 222) & (sat < 26)
    shrink = Image.fromarray((interior * 255).astype("uint8")).filter(ImageFilter.MinFilter(7))
    interior = np.asarray(shrink) > 128

    for c, t in enumerate(tint):
        a[..., c] = np.where(interior, (a[..., c] * 0.25 + t * 0.75).astype("uint8"), a[..., c])
    a[..., 3] = np.where(interior, alpha, a[..., 3])

    tex_path = f"{OUT}/tex_pencil.png"
    try:
        tex = Image.open(tex_path).convert("L")
        if texture_scale != 1.0:
            tex = tex.resize(
                (max(8, round(tex.width * texture_scale)), max(8, round(tex.height * texture_scale))),
                Image.LANCZOS,
            )
        h, w = interior.shape
        tiled = Image.new("L", (w, h))
        for ty in range(0, h, tex.height):
            for tx in range(0, w, tex.width):
                tiled.paste(tex, (tx, ty))
        t = np.asarray(tiled, dtype=np.float32) / 255.0
        k = texture_strength
        for c in range(3):
            mul = a[..., c].astype(np.float32) * (1 - k + k * t)
            a[..., c] = np.where(interior, np.clip(mul, 0, 255).astype("uint8"), a[..., c])
    except FileNotFoundError:
        pass  # текстури ще немає — лишаємо чисту кремову заливку

    return Image.fromarray(a)


def save_frame(name, path, width=96, shaded=False):
    """Portrait nine-slice frames: keep aspect, normalize width."""
    im = remove_bg(path)
    if im.width > im.height:  # джерело збережене лежачи — розвертаємо
        im = im.transpose(Image.ROTATE_90)
    if shaded:
        im = shade_interior(im)
    height = round(im.height * width / im.width)
    im = im.resize((width, height), Image.LANCZOS)
    im.save(f"{OUT}/{name}.png")
    print("ok", name, im.size, "from", path.split("/")[-1])


def save_hslice(name, path, height=64, interior_alpha=215):
    """Landscape nine-slice (buttons, panels): keep aspect, normalize height.
    Interiors get the paper treatment (no stark white on notebook paper)."""
    im = remove_bg(path)
    im = shade_interior(im, alpha=interior_alpha, tint=(250, 247, 238), texture_scale=im.height / height)
    width = round(im.width * height / im.height)
    im = im.resize((width, height), Image.LANCZOS)
    im.save(f"{OUT}/{name}.png")
    print("ok", name, im.size, "from", path.split("/")[-1])


def save_deco(name, path, max_side=256):
    """Decor pieces: plain cut, keep aspect, normalize the longest side."""
    im = remove_bg(path)
    k = max_side / max(im.size)
    im = im.resize((max(2, round(im.width * k)), max(2, round(im.height * k))), Image.LANCZOS)
    im.save(f"{OUT}/{name}.png")
    print("ok", name, im.size, "from", path.split("/")[-1])


def save_ink(name, path, max_side=300):
    """Ink doodles on white/checkerboard: alpha is derived from darkness +
    saturation, so only the pen strokes survive (interiors stay clear)."""
    src = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    a = np.asarray(src, dtype=np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    sat = (np.max(a, axis=2) - np.min(a, axis=2))
    alpha = np.clip((0.90 - lum) / 0.45, 0, 1)
    alpha = np.where((sat > 25) | (lum < 0.6), alpha, 0)  # вбиває шахівницю
    out = np.dstack([a, alpha * 255]).astype("uint8")
    im = Image.fromarray(out, "RGBA")
    bbox = im.split()[3].point(lambda v: 255 if v > 24 else 0).getbbox()
    if bbox:
        im = im.crop(bbox)
    k = max_side / max(im.size)
    if k < 1:
        im = im.resize((max(2, round(im.width * k)), max(2, round(im.height * k))), Image.LANCZOS)
    im.save(f"{OUT}/{name}.png")
    print("ok", name, im.size, "from", path.split("/")[-1])


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        name, path = arg.split("=", 1)
        if name.startswith("col_frame"):
            save_frame(name, path, shaded=(name == "col_frame"))
        elif name.startswith("ui_button"):
            save_hslice(name, path, height=64)
        elif name.startswith("deco_doodle"):
            save_ink(name, path)
        elif name.startswith("deco_"):
            save_deco(name, path)
        elif name == "ui_panel":
            save_hslice(name, path, height=192, interior_alpha=240)
        else:
            save_block(name, path)
