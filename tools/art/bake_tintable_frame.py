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

# Opacity: only genuinely dark (ink) pixels survive. Luminance above CUTOFF
# (the paper wash inside the frame) maps to fully transparent, so the tint
# colors the frame strokes only — the column interior stays clean paper.
# BOOST compensates for the tint reading lighter than the original dark ink.
CUTOFF = 0.55
BOOST = 1.4


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
            factor = max(0.0, (CUTOFF - lum) / CUTOFF)
            alpha = min(255, int(round(a * factor * BOOST)))
            opx[x, y] = (255, 255, 255, alpha)
    # thicken: 1px max-filter dilation on alpha so the tinted stroke reads
    # as thick as the base frame's ink line (the luminance cutoff trims the
    # anti-aliased halo and would otherwise leave a thinner line)
    from PIL import ImageFilter

    alpha_band = out.split()[3].filter(ImageFilter.MaxFilter(3))
    out.putalpha(alpha_band)
    out.save(DST)
    print(f"baked {DST} ({w}x{h})")


if __name__ == "__main__":
    main()
