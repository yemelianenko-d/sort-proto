import Phaser from 'phaser';
import { hasTexture } from '../core/assets/AssetLoader';

export interface DoodleRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** All delivered doodles. NOTE: `deco_doodle_11..20` are handwritten TEXT
 * puns (mostly sorting-flavoured: "Live long & sort", "Winter is sorting", …)
 * — authored when the game was sorting-only, so they are NOT theme-neutral.
 * Sorting still uses the whole set (its own flavour); other mechanics should
 * pass `NEUTRAL_DOODLE_KEYS` as `universalKeys` to avoid the cross-mechanic
 * text leak, and add their OWN themed doodles via `extraKeys`. */
const DOODLE_KEYS = Array.from({ length: 30 }, (_, i) => `deco_doodle_${String(i + 1).padStart(2, '0')}`);

/** Theme-neutral subset: pure drawings only (no handwritten text), safe on any
 * mechanic. Excludes the `deco_doodle_11..20` text puns. */
export const NEUTRAL_DOODLE_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].map(
  (n) => `deco_doodle_${String(n).padStart(2, '0')}`,
);

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function overlaps(r: DoodleRect, list: DoodleRect[], pad: number): boolean {
  return list.some(
    (o) => r.x < o.x + o.w + pad && r.x + r.w + pad > o.x && r.y < o.y + o.h + pad && r.y + r.h + pad > o.y,
  );
}

/**
 * Scatters faint hand-drawn doodles over the paper, avoiding the given
 * exclusion zones (UI and play areas). Deterministic per seed: the set is
 * stable within one scene visit, and fresh on the next one.
 *
 * `extraKeys` are mechanic-scoped doodles (e.g. sorting one-liners): pass
 * them only from that mechanic's scenes so they never leak elsewhere.
 * `universalKeys` overrides the base pool (default: all 30) — pass
 * `NEUTRAL_DOODLE_KEYS` from a non-sorting mechanic to keep sorting text out.
 */
export function scatterDoodles(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  w: number,
  h: number,
  exclude: DoodleRect[],
  seed: number,
  count = 8,
  extraKeys: string[] = [],
  universalKeys: readonly string[] = DOODLE_KEYS,
): void {
  container.removeAll(true);
  const keys = [...universalKeys, ...extraKeys].filter((k) => hasTexture(scene, k));
  if (keys.length === 0) return;
  const rng = mulberry32(seed);
  const placed: DoodleRect[] = [];
  const pool = [...keys];

  for (let n = 0; n < count && pool.length > 0; n++) {
    const key = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    const frame = scene.textures.getFrame(key);
    // wide notes are hand-written one-liners (aspect ~7): size them by a
    // readable text height, not a thin sliver. Compact doodles are little
    // drawn marks — a touch bigger too.
    const wide = frame.width / frame.height > 2;
    const targetW = wide ? 220 + rng() * 70 : 100 + rng() * 45;
    const scale = targetW / frame.width;
    const dw = frame.width * scale;
    const dh = frame.height * scale;
    if (dw > w - 24 || dh > h - 24) continue;

    for (let attempt = 0; attempt < 26; attempt++) {
      const x = 10 + rng() * (w - dw - 20);
      const y = 10 + rng() * (h - dh - 20);
      const rect = { x, y, w: dw, h: dh };
      if (overlaps(rect, exclude, 6) || overlaps(rect, placed, 20)) continue;
      placed.push(rect);
      container.add(
        scene.add
          .image(x + dw / 2, y + dh / 2, key)
          .setScale(scale)
          .setAlpha(0.24)
          .setAngle((rng() * 2 - 1) * 8),
      );
      break;
    }
  }
}
