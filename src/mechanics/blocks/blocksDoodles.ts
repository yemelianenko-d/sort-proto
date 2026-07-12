import Phaser from 'phaser';
import { COLORS, FONTS } from '../../app/gameConfig';
import { mulberry32 } from './blocksRandom';

/**
 * Blueprint margin doodles of the blocks mechanic (per the approved concept):
 * the notebook page is a geometry-lesson sheet — a compass, a protractor,
 * theorem triangles with formulas, a circle with its diameter, a wireframe
 * cube and tiny plus-sparkles. Drawn procedurally in the pale blueprint ink
 * so the mechanic needs no doodle textures of its own.
 */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const INK_ALPHA = 0.5;
const TEXT_ALPHA = 0.6;

interface DoodleCtx {
  scene: Phaser.Scene;
  container: Phaser.GameObjects.Container;
  g: Phaser.GameObjects.Graphics;
}

function text(ctx: DoodleCtx, x: number, y: number, str: string, size: number, angle = 0): void {
  ctx.container.add(
    ctx.scene.add
      .text(x, y, str, {
        fontFamily: FONTS.body,
        fontSize: `${size}px`,
        color: '#5b86c4',
        padding: { x: 3, y: 2 },
      })
      .setOrigin(0.5)
      .setAlpha(TEXT_ALPHA)
      .setAngle(angle),
  );
}

/** Drafting compass: hinge, two spread legs, needle and pencil tips. */
function compass(ctx: DoodleCtx, x: number, y: number, s: number): void {
  const g = ctx.g;
  g.lineStyle(2.2, COLORS.grid, INK_ALPHA);
  g.strokeCircle(x, y, 6 * s);
  g.lineBetween(x, y - 6 * s, x, y - 16 * s); // handle
  g.strokeCircle(x, y - 20 * s, 4.5 * s);
  const spread = 0.42;
  const len = 74 * s;
  const lx = x + Math.sin(-spread) * len;
  const ly = y + Math.cos(-spread) * len;
  const rx = x + Math.sin(spread) * len;
  const ry = y + Math.cos(spread) * len;
  // double-line legs read as flat compass arms
  g.lineBetween(x - 3 * s, y + 5 * s, lx, ly);
  g.lineBetween(x + 3 * s, y + 5 * s, rx, ry);
  g.lineBetween(x - 6 * s, y + 3 * s, lx - 3 * s, ly - 4 * s);
  g.lineBetween(x + 6 * s, y + 3 * s, rx + 3 * s, ry - 4 * s);
  g.lineBetween(lx, ly, lx + 3 * s, ly + 11 * s); // needle
  g.lineBetween(rx, ry, rx - 4 * s, ry + 11 * s); // pencil
  g.lineBetween(x - 14 * s, y + 24 * s, x + 12 * s, y + 19 * s); // cross screw
}

/** Circle with a horizontal diameter: A ── O ── B. */
function circleAB(ctx: DoodleCtx, x: number, y: number, s: number): void {
  const g = ctx.g;
  const r = 34 * s;
  g.lineStyle(1.6, COLORS.grid, INK_ALPHA);
  g.strokeCircle(x, y, r);
  g.lineBetween(x - r - 8 * s, y, x + r + 8 * s, y);
  g.fillStyle(COLORS.grid, INK_ALPHA);
  g.fillCircle(x - r, y, 2.4);
  g.fillCircle(x + r, y, 2.4);
  g.fillCircle(x, y, 2.4);
  g.lineBetween(x, y - r - 6 * s, x, y - r + 6 * s); // top tick
  text(ctx, x - r - 14 * s, y - 8, 'A', 13);
  text(ctx, x + r + 14 * s, y - 8, 'B', 13);
  text(ctx, x + 9 * s, y + 10 * s, 'O', 12);
}

/** Right triangle with the Pythagoras note. */
function pythagoras(ctx: DoodleCtx, x: number, y: number, s: number): void {
  const g = ctx.g;
  const b = 74 * s;
  const h = 60 * s;
  // right angle at bottom-left (x, y)
  g.lineStyle(1.6, COLORS.grid, INK_ALPHA);
  g.lineBetween(x, y, x, y - h);
  g.lineBetween(x, y, x + b, y);
  g.lineBetween(x, y - h, x + b, y);
  g.strokeRect(x + 1, y - 11 * s, 10 * s, 10 * s);
  text(ctx, x - 10 * s, y - h / 2, 'a', 13);
  text(ctx, x + b / 2, y + 11 * s, 'b', 13);
  text(ctx, x + b / 2 + 8 * s, y - h / 2 - 10 * s, 'c', 13);
  text(ctx, x + b / 2, y + 34 * s, 'a² + b² = c²', 14, -2);
}

/** Scalene triangle with an angle arc and the angle-sum formula. */
function triangleABC(ctx: DoodleCtx, x: number, y: number, s: number): void {
  const g = ctx.g;
  const ax = x;
  const ay = y;
  const bx = x + 26 * s;
  const by = y - 64 * s;
  const cx = x + 86 * s;
  const cy = y - 4 * s;
  g.lineStyle(1.6, COLORS.grid, INK_ALPHA);
  g.lineBetween(ax, ay, bx, by);
  g.lineBetween(bx, by, cx, cy);
  g.lineBetween(cx, cy, ax, ay);
  g.beginPath();
  g.arc(ax, ay, 16 * s, -1.2, -0.1);
  g.strokePath();
  text(ctx, ax - 9 * s, ay + 9 * s, 'A', 12);
  text(ctx, bx, by - 11 * s, 'B', 12);
  text(ctx, cx + 9 * s, cy + 9 * s, 'C', 12);
  text(ctx, ax + 24 * s, ay - 13 * s, 'α', 12);
  text(ctx, x + 44 * s, y + 22 * s, '∠A + ∠B + ∠C = 180°', 13, -2);
}

/** Protractor: two arcs, degree ticks, baseline with a centre mark. */
function protractor(ctx: DoodleCtx, x: number, y: number, s: number): void {
  const g = ctx.g;
  const r = 56 * s;
  const ri = 30 * s;
  g.lineStyle(1.6, COLORS.grid, INK_ALPHA);
  g.beginPath();
  g.arc(x, y, r, Math.PI, 0);
  g.strokePath();
  g.beginPath();
  g.arc(x, y, ri, Math.PI, 0);
  g.strokePath();
  g.lineBetween(x - r, y, x + r, y);
  g.lineBetween(x - 6 * s, y, x + 6 * s, y);
  g.lineBetween(x, y, x, y - 7 * s);
  g.lineStyle(1.1, COLORS.grid, INK_ALPHA);
  for (let deg = 15; deg < 180; deg += 15) {
    const rad = Math.PI + (deg / 180) * Math.PI;
    const c = Math.cos(rad);
    const sn = Math.sin(rad);
    g.lineBetween(x + c * r * 0.86, y + sn * r * 0.86, x + c * r * 0.97, y + sn * r * 0.97);
  }
  text(ctx, x - r + 12 * s, y - 8 * s, '0', 9);
  text(ctx, x, y - r + 11 * s, '90', 9);
  text(ctx, x + r - 14 * s, y - 8 * s, '180', 9);
}

/** Wireframe cube with dashed hidden edges. */
function cube(ctx: DoodleCtx, x: number, y: number, s: number): void {
  const g = ctx.g;
  const cs = 52 * s;
  const off = 20 * s;
  g.lineStyle(1.6, COLORS.grid, INK_ALPHA);
  g.strokeRect(x, y, cs, cs);
  g.lineBetween(x, y, x + off, y - off);
  g.lineBetween(x + cs, y, x + cs + off, y - off);
  g.lineBetween(x + cs, y + cs, x + cs + off, y + cs - off);
  g.lineBetween(x + off, y - off, x + cs + off, y - off);
  g.lineBetween(x + cs + off, y - off, x + cs + off, y + cs - off);
  // hidden edges, dashed
  const dash = (x1: number, y1: number, x2: number, y2: number) => {
    for (let t = 0; t < 1; t += 0.25) {
      g.lineBetween(
        x1 + (x2 - x1) * t,
        y1 + (y2 - y1) * t,
        x1 + (x2 - x1) * (t + 0.13),
        y1 + (y2 - y1) * (t + 0.13),
      );
    }
  };
  g.lineStyle(1.1, COLORS.grid, INK_ALPHA * 0.8);
  dash(x, y + cs, x + off, y + cs - off);
  dash(x + off, y - off, x + off, y + cs - off);
  dash(x + off, y + cs - off, x + cs + off, y + cs - off);
}

/** Tiny plus-sparkle (a "+" with two diagonal dots). */
function plusMark(ctx: DoodleCtx, x: number, y: number, s: number): void {
  const g = ctx.g;
  g.lineStyle(1.4, COLORS.grid, INK_ALPHA);
  g.lineBetween(x - 5 * s, y, x + 5 * s, y);
  g.lineBetween(x, y - 5 * s, x, y + 5 * s);
  g.fillStyle(COLORS.grid, INK_ALPHA * 0.8);
  g.fillCircle(x + 8 * s, y - 8 * s, 1.4);
  g.fillCircle(x - 8 * s, y + 8 * s, 1.4);
}

interface Motif {
  /** Anchor as a screen fraction. */
  fx: number;
  fy: number;
  /** Approximate half-extent of the motif (collision bbox), in px at s=1. */
  half: number;
  draw: (ctx: DoodleCtx, x: number, y: number, s: number) => void;
}

const MOTIFS: Motif[] = [
  { fx: 0.1, fy: 0.15, half: 60, draw: compass },
  { fx: 0.88, fy: 0.22, half: 70, draw: pythagoras },
  { fx: 0.07, fy: 0.42, half: 55, draw: circleAB },
  { fx: 0.1, fy: 0.82, half: 70, draw: triangleABC },
  { fx: 0.79, fy: 0.55, half: 65, draw: protractor },
  { fx: 0.89, fy: 0.84, half: 60, draw: cube },
];

const PLUS_SPOTS: [number, number][] = [
  [0.27, 0.12],
  [0.94, 0.5],
  [0.04, 0.62],
  [0.45, 0.95],
  [0.75, 0.08],
];

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Draws the geometry-lesson margin decor, skipping anything that would touch
 * an exclusion zone (HUD, board + tray, popup areas). Jitter is deterministic
 * from `seed`, so resizes don't make the page "boil".
 */
export function drawBlueprintDoodles(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  w: number,
  h: number,
  exclude: Rect[],
  seed: number,
): void {
  container.removeAll(true);
  const g = scene.add.graphics();
  container.add(g);
  const ctx: DoodleCtx = { scene, container, g };
  const rng = mulberry32(seed);
  const s = Phaser.Math.Clamp(Math.min(w, h) / 760, 0.7, 1.15);

  for (const m of MOTIFS) {
    const x = m.fx * w + (rng() - 0.5) * 24;
    const y = m.fy * h + (rng() - 0.5) * 24;
    const half = m.half * s;
    const bbox: Rect = { x: x - half, y: y - half, w: half * 2, h: half * 2 };
    if (exclude.some((zone) => intersects(bbox, zone))) continue;
    if (bbox.x < 0 || bbox.y < 0 || bbox.x + bbox.w > w || bbox.y + bbox.h > h) continue;
    m.draw(ctx, x, y, s);
  }
  for (const [fx, fy] of PLUS_SPOTS) {
    const x = fx * w + (rng() - 0.5) * 30;
    const y = fy * h + (rng() - 0.5) * 30;
    const bbox: Rect = { x: x - 12, y: y - 12, w: 24, h: 24 };
    if (exclude.some((zone) => intersects(bbox, zone))) continue;
    plusMark(ctx, x, y, s);
  }
}
