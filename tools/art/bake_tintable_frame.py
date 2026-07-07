"""Bake col_frame_tint.png — a white-on-alpha copy of col_frame.png.

Same approach as the deco_chain asset: every pixel becomes white and its
opacity encodes how "inky" the source pixel was (dark strokes -> strong,
paper wash -> faint). Runtime setTint() then paints the frame in the exact
block ink color, so target columns can wear the color of their designated
blocks without baking 8 separate textures.

Run from the repo root:  python3 tools/art/bake_tintable_frame.py
"""

from PIL import Image

SRC = "public/assets/images/col_frame.png"
DST = "public/assets/images/col_frame_tint.png"

# Opacity = alpha * (WASH_FLOOR + (1 - WASH_FLOOR) * (1 - luminance)) * BOOST.
# WASH_FLOOR keeps a subtle colored paper-wash inside the frame instead of
# dropping it to nothing; BOOST compensates for the tint reading lighter
# than the original dark-blue ink.
WASH_FLOOR = 0.14
BOOST = 1.2


def main() -> None:
    im = Image.open(SRC).convert("RGBA")
    px = im.load()
    w, h = im.size
    out = Image.new("RGBA", (w, h))
    opx = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                opx[x, y] = (255, 255, 255, 0)
                continue
            lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
            factor = WASH_FLOOR + (1.0 - WASH_FLOOR) * (1.0 - lum)
            alpha = min(255, int(round(a * factor * BOOST)))
            opx[x, y] = (255, 255, 255, alpha)
    out.save(DST)
    print(f"baked {DST} ({w}x{h})")


if __name__ == "__main__":
    main()
