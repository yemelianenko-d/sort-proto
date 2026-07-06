import Phaser from 'phaser';
import { hasTexture } from '../core/assets/AssetLoader';

export interface DoodleRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DOODLE_KEYS = Array.from({ length: 20 }, (_, i) => `deco_doodle_${String(i + 1).padStart(2, '0')}`);

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
 */
export function scatterDoodles(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  w: number,
  h: number,
  exclude: DoodleRect[],
  seed: number,
  count = 6,
): void {
  container.removeAll(true);
  const keys = DOODLE_KEYS.filter((k) => hasTexture(scene, k));
  if (keys.length === 0) return;
  const rng = mulberry32(seed);
  const placed: DoodleRect[] = [];
  const pool = [...keys];

  for (let n = 0; n < count && pool.length > 0; n++) {
    const key = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    const frame = scene.textures.getFrame(key);
    const wide = frame.width / frame.height > 2;
    const targetW = wide ? 140 + rng() * 50 : 84 + rng() * 40;
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
