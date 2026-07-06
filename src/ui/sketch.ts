import Phaser from 'phaser';
import { COLORS, type PatternKind } from '../app/gameConfig';
import { hasTexture } from '../core/assets/AssetLoader';
import { ASSET_KEYS } from '../core/assets/assetManifest';

/**
 * Hand-drawn "notebook" rendering helpers built on Phaser Graphics.
 * All jitter is deterministic (seeded by coordinates) so redraws are stable.
 */

function jitter(seed: number, amp: number): number {
  const s = Math.sin(seed * 127.1) * 43758.5453;
  return ((s - Math.floor(s)) * 2 - 1) * amp;
}

/** Wobbly stroked rectangle that looks like it was drawn with a pen. */
export function strokeSketchRect(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  width = 2.5,
  amp = 1.4,
  dashedTop = false,
): void {
  g.lineStyle(width, color, 1);
  const step = 10;
  const edge = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    seed: number,
    dashed: boolean,
  ) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(2, Math.round(len / step));
    let px = x1;
    let py = y1;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const nx = x1 + (x2 - x1) * t + jitter(seed + i * 3.7, amp);
      const ny = y1 + (y2 - y1) * t + jitter(seed + i * 9.1, amp);
      if (!dashed || i % 2 === 0) g.lineBetween(px, py, nx, ny);
      px = nx;
      py = ny;
    }
  };
  edge(x, y, x + w, y, x + y, dashedTop); // top
  edge(x + w, y, x + w, y + h, x + w + y, false); // right
  edge(x + w, y + h, x, y + h, x + h, false); // bottom
  edge(x, y + h, x, y, y + h, false); // left
}

/** Colored-pencil hatch fill clipped to a rectangle. */
export function fillPattern(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  kind: PatternKind,
  color: number,
): void {
  const alpha = 0.55;
  g.lineStyle(2.4, color, alpha);
  const gap = 8;

  const diag = (dir: 1 | -1) => {
    // Family of lines py = dir*px + c clipped to the rect.
    const corners = [y - dir * x, y - dir * (x + w), y + h - dir * x, y + h - dir * (x + w)];
    const cMin = Math.min(...corners);
    const cMax = Math.max(...corners);
    for (let c = cMin + gap / 2; c < cMax; c += gap) {
      const pts: { px: number; py: number }[] = [];
      const push = (px: number, py: number) => {
        if (px >= x - 0.01 && px <= x + w + 0.01 && py >= y - 0.01 && py <= y + h + 0.01) {
          if (!pts.some((q) => Math.abs(q.px - px) < 0.01 && Math.abs(q.py - py) < 0.01)) {
            pts.push({ px, py });
          }
        }
      };
      push(x, dir * x + c);
      push(x + w, dir * (x + w) + c);
      push((y - c) / dir, y);
      push((y + h - c) / dir, y + h);
      if (pts.length >= 2) g.lineBetween(pts[0].px, pts[0].py, pts[1].px, pts[1].py);
    }
  };

  switch (kind) {
    case 'stripes':
      diag(1);
      break;
    case 'cross':
      diag(1);
      diag(-1);
      break;
    case 'hlines':
      for (let yy = y + gap / 2; yy < y + h; yy += gap) g.lineBetween(x, yy, x + w, yy);
      break;
    case 'vlines':
      for (let xx = x + gap / 2; xx < x + w; xx += gap) g.lineBetween(xx, y, xx, y + h);
      break;
    case 'dots':
      g.fillStyle(color, alpha);
      for (let yy = y + 4; yy < y + h - 2; yy += gap) {
        for (let xx = x + 4; xx < x + w - 2; xx += gap) {
          g.fillCircle(xx, yy, 2.2);
        }
      }
      break;
    case 'solid':
      g.fillStyle(color, 0.22);
      g.fillRect(x + 1, y + 1, w - 2, h - 2);
      break;
  }
}

/** Notebook grid background sized to the current viewport. */
export function drawPaper(g: Phaser.GameObjects.Graphics, width: number, height: number): void {
  g.clear();
  g.fillStyle(COLORS.paper, 1);
  g.fillRect(0, 0, width, height);
  g.lineStyle(1, COLORS.grid, 0.15);
  const cellSize = 24;
  for (let x = cellSize; x < width; x += cellSize) g.lineBetween(x, 0, x, height);
  for (let y = cellSize; y < height; y += cellSize) g.lineBetween(0, y, width, y);
}

/**
 * Margin decor: faint pencil doodles and handwritten notes on the paper
 * edges. Purely visual, non-interactive, kept away from the center band.
 */
export function drawMarginDecor(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  width: number,
  height: number,
  notes: readonly string[],
): void {
  layer.removeAll(true);

  const g = scene.add.graphics();
  g.lineStyle(1.6, COLORS.pencil, 0.3);

  // spiral (top-left)
  const sx = width * 0.055;
  const sy = height * 0.09;
  for (let r = 2; r <= 12; r += 2.5) {
    g.beginPath();
    g.arc(sx, sy, r, (r * 1.6) % (Math.PI * 2), (r * 1.6 + 4.6) % (Math.PI * 2));
    g.strokePath();
  }

  // star (top-right)
  const stx = width * 0.94;
  const sty = height * 0.085;
  const star: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? 12 : 5;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    star.push([stx + Math.cos(a) * rad, sty + Math.sin(a) * rad]);
  }
  for (let i = 0; i < star.length; i++) {
    const [x1, y1] = star[i];
    const [x2, y2] = star[(i + 1) % star.length];
    g.lineBetween(x1, y1, x2, y2);
  }

  // wireframe cube (bottom-left)
  const cx = width * 0.06;
  const cy = height * 0.9;
  const cs = 11;
  const off = 5;
  g.strokeRect(cx - cs / 2, cy - cs / 2, cs, cs);
  g.strokeRect(cx - cs / 2 + off, cy - cs / 2 - off, cs, cs);
  g.lineBetween(cx - cs / 2, cy - cs / 2, cx - cs / 2 + off, cy - cs / 2 - off);
  g.lineBetween(cx + cs / 2, cy - cs / 2, cx + cs / 2 + off, cy - cs / 2 - off);
  g.lineBetween(cx - cs / 2, cy + cs / 2, cx - cs / 2 + off, cy + cs / 2 - off);
  g.lineBetween(cx + cs / 2, cy + cs / 2, cx + cs / 2 + off, cy + cs / 2 - off);

  // tic-tac-toe (bottom-right)
  const tx = width * 0.93;
  const ty = height * 0.9;
  const t = 8;
  g.lineBetween(tx - t / 2, ty - t * 1.5, tx - t / 2, ty + t * 1.5);
  g.lineBetween(tx + t / 2, ty - t * 1.5, tx + t / 2, ty + t * 1.5);
  g.lineBetween(tx - t * 1.5, ty - t / 2, tx + t * 1.5, ty - t / 2);
  g.lineBetween(tx - t * 1.5, ty + t / 2, tx + t * 1.5, ty + t / 2);
  g.lineBetween(tx - t * 1.3, ty - t * 1.3, tx - t * 0.7, ty - t * 0.7); // X
  g.lineBetween(tx - t * 0.7, ty - t * 1.3, tx - t * 1.3, ty - t * 0.7);
  g.strokeCircle(tx, ty, t * 0.32); // O

  // squiggle arrow (mid-left)
  const ax = width * 0.03;
  const ay = height * 0.5;
  g.beginPath();
  g.moveTo(ax, ay + 10);
  g.lineTo(ax + 6, ay - 2);
  g.lineTo(ax + 12, ay + 6);
  g.lineTo(ax + 18, ay - 8);
  g.strokePath();
  g.lineBetween(ax + 18, ay - 8, ax + 12, ay - 7);
  g.lineBetween(ax + 18, ay - 8, ax + 17, ay - 2);

  layer.add(g);

  // handwritten notes at the edges
  const spots: { x: number; y: number; angle: number }[] = [
    { x: width * 0.18, y: height * 0.035, angle: -6 },
    { x: width * 0.8, y: height * 0.04, angle: 5 },
    { x: width * 0.17, y: height * 0.965, angle: 4 },
    { x: width * 0.8, y: height * 0.96, angle: -5 },
    { x: width * 0.055, y: height * 0.32, angle: -90 },
    { x: width * 0.95, y: height * 0.62, angle: 90 },
  ];
  notes.slice(0, spots.length).forEach((note, i) => {
    const spot = spots[i];
    layer.add(
      scene.add
        .text(spot.x, spot.y, note, {
          fontFamily: 'Caveat, cursive',
          fontSize: '16px',
          color: '#606678',
        })
        .setOrigin(0.5)
        .setAngle(spot.angle)
        .setAlpha(0.55),
    );
  });
}

/**
 * Scene background: artist tile (bg_paper, seamless) when delivered,
 * procedural notebook grid otherwise. Call resize() on scale changes.
 */
export class PaperBackground {
  private tile: Phaser.GameObjects.TileSprite | null = null;
  private gfx: Phaser.GameObjects.Graphics | null = null;

  constructor(scene: Phaser.Scene, depth = -10) {
    if (hasTexture(scene, ASSET_KEYS.background)) {
      this.tile = scene.add
        .tileSprite(0, 0, scene.scale.width, scene.scale.height, ASSET_KEYS.background)
        .setOrigin(0)
        .setTileScale(0.5) // assets are delivered @2x per the asset spec
        .setDepth(depth);
    } else {
      this.gfx = scene.add.graphics().setDepth(depth);
    }
  }

  resize(width: number, height: number): void {
    if (this.tile) this.tile.setSize(width, height);
    if (this.gfx) drawPaper(this.gfx, width, height);
  }
}
