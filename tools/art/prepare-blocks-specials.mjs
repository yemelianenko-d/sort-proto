/**
 * Blocks special-tile pipeline. Processes two asset families for the
 * "collect" goal mode:
 *   - combined special tiles (wooden base + geometry symbol) -> blocks/special_N
 *     (square 128², same footprint as the colour tiles);
 *   - standalone symbols (transparent glyph) -> blocks/symbol_N (aspect kept,
 *     used in the HUD goal chips).
 * Fake-checkerboard transparency is stripped the same way as for the tiles.
 *
 * Usage: node tools/art/prepare-blocks-specials.mjs <downloadsDir>
 * The 5 symbols (id order): 0 compass, 1 triangle, 2 protractor, 3 ruler,
 * 4 pencil. Source files are matched by the maps below.
 */
import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const TILE_SIZE = 128;
const SYMBOL_MAX = 112;
/** Symbol footprint on the wooden special tile (fraction of the tile). Bigger
 * than the baked art (was ~0.5) — developer asked to enlarge the items. */
const TILE_SYMBOL_FRAC = 0.74;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [srcDir] = process.argv.slice(2);
if (!srcDir) {
  console.error('usage: node tools/art/prepare-blocks-specials.mjs <srcDir>');
  process.exit(1);
}

function removeCheckerBackground(data, w, h) {
  const isChecker = (i) => {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx - mn <= 14 && mn >= 205;
  };
  const queue = [];
  const seen = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) queue.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) queue.push(y * w, y * w + w - 1);
  while (queue.length > 0) {
    const i = queue.pop();
    if (seen[i] || !isChecker(i)) continue;
    seen[i] = 1;
    data[i * 4 + 3] = 0;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) queue.push(i - 1);
    if (x < w - 1) queue.push(i + 1);
    if (y > 0) queue.push(i - w);
    if (y < h - 1) queue.push(i + w);
  }
}

function trimBox(data, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('empty image');
  return { minX, minY, maxX, maxY };
}

async function loadClean(srcPath) {
  const img = await loadImage(srcPath);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  removeCheckerBackground(imageData.data, img.width, img.height);
  ctx.putImageData(imageData, 0, 0);
  return { canvas: c, ctx, imageData, data: imageData.data, w: img.width, h: img.height };
}

/** Load the new outline symbol, strip light interiors, return its canvas+bbox. */
async function loadSymbol(symbolSrc) {
  const { canvas, ctx, imageData, data, w, h } = await loadClean(symbolSrc);
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] === 0) continue;
    const mx = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    const mn = Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    if (mn >= 198 && mx - mn <= 22) data[i * 4 + 3] = 0;
  }
  ctx.putImageData(imageData, 0, 0);
  return { canvas, box: trimBox(data, w, h) };
}

/**
 * Special tile = the ORIGINAL hand-drawn wooden tile (keep the developer's
 * base: sketchy border + hatched cream fill) with its BAKED symbol painted
 * over in the sampled cream, then the NEW outline symbol overlaid LARGER.
 * We only touch the centre — the border/frame the developer likes is untouched.
 */
async function processTile(baseSrc, symbolSrc, outName) {
  const base = await loadClean(baseSrc);
  const bx = trimBox(base.data, base.w, base.h);
  const bcx = (bx.minX + bx.maxX) / 2, bcy = (bx.minY + bx.maxY) / 2;
  const bwd = bx.maxX - bx.minX + 1, bht = bx.maxY - bx.minY + 1;

  // sample the cream fill: average of low-saturation pixels in the interior
  let cr = 0, cg = 0, cb = 0, cn = 0;
  const inset = 0.22;
  for (let y = Math.round(bx.minY + inset * bht); y < bx.maxY - inset * bht; y++) {
    for (let x = Math.round(bx.minX + inset * bwd); x < bx.maxX - inset * bwd; x++) {
      const i = (y * base.w + x) * 4;
      if (base.data[i + 3] < 200) continue;
      const mx = Math.max(base.data[i], base.data[i + 1], base.data[i + 2]);
      const mn = Math.min(base.data[i], base.data[i + 1], base.data[i + 2]);
      if (mx - mn <= 26 && mn >= 210) { cr += base.data[i]; cg += base.data[i + 1]; cb += base.data[i + 2]; cn++; }
    }
  }
  const cream = cn > 0 ? [Math.round(cr / cn), Math.round(cg / cn), Math.round(cb / cn)] : [244, 233, 210];
  // paint over the baked symbol EVERYWHERE inside the brown border ring
  // (inset 13% keeps the ring): saturated ink AND dark pixels both go — the
  // old glyphs' antialiased tails left stray dashes otherwise
  const wipe = 0.13;
  for (let y = Math.round(bx.minY + wipe * bht); y < bx.maxY - wipe * bht; y++) {
    for (let x = Math.round(bx.minX + wipe * bwd); x < bx.maxX - wipe * bwd; x++) {
      const i = (y * base.w + x) * 4;
      if (base.data[i + 3] < 40) continue;
      const mx = Math.max(base.data[i], base.data[i + 1], base.data[i + 2]);
      const mn = Math.min(base.data[i], base.data[i + 1], base.data[i + 2]);
      if (mx - mn > 32 || mx < 150) { base.data[i] = cream[0]; base.data[i + 1] = cream[1]; base.data[i + 2] = cream[2]; base.data[i + 3] = 255; }
    }
  }
  base.ctx.putImageData(base.imageData, 0, 0);

  // draw base square (centred, padded) then the new symbol on top
  const out = createCanvas(TILE_SIZE, TILE_SIZE);
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  const side = Math.round(Math.max(bwd, bht) * 1.04);
  octx.drawImage(base.canvas, bcx - side / 2, bcy - side / 2, side, side, 0, 0, TILE_SIZE, TILE_SIZE);

  const sym = await loadSymbol(symbolSrc);
  const sw = sym.box.maxX - sym.box.minX + 1, sh = sym.box.maxY - sym.box.minY + 1;
  const targetPx = TILE_SIZE * TILE_SYMBOL_FRAC;
  const scale = targetPx / Math.max(sw, sh);
  const dw = sw * scale, dh = sh * scale;
  octx.drawImage(sym.canvas, sym.box.minX, sym.box.minY, sw, sh, (TILE_SIZE - dw) / 2, (TILE_SIZE - dh) / 2, dw, dh);
  save(out, outName);
}

/** Symbol glyph, aspect kept, downscaled so its longest side = SYMBOL_MAX.
 * Enclosed light fills (e.g. the pencil body) are stripped so the glyph reads
 * as a hollow outline — the edge flood can't reach interiors, so we clear ALL
 * light-neutral pixels; the saturated coloured strokes survive. */
async function processSymbol(srcPath, outName) {
  const { canvas, ctx, imageData, data, w, h } = await loadClean(srcPath);
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] === 0) continue;
    const mx = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    const mn = Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    if (mn >= 198 && mx - mn <= 22) data[i * 4 + 3] = 0; // light-neutral -> clear
  }
  ctx.putImageData(imageData, 0, 0);
  const b = trimBox(data, w, h);
  const bw = b.maxX - b.minX + 1;
  const bh = b.maxY - b.minY + 1;
  const scale = Math.min(1, SYMBOL_MAX / Math.max(bw, bh));
  const ow = Math.round(bw * scale);
  const oh = Math.round(bh * scale);
  const out = createCanvas(ow, oh);
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(canvas, b.minX, b.minY, bw, bh, 0, 0, ow, oh);
  save(out, outName);
}

function save(canvas, outName) {
  const outDir = resolve(root, 'public/assets/mechanics/blocks');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, outName), canvas.toBuffer('image/png'));
  console.log(`${outName}: ${canvas.width}x${canvas.height}`);
}

const files = readdirSync(srcDir);
const find = (marker, n) => {
  const f = files.find((name) => name.includes(marker) && name.includes(`(${n})`));
  if (!f) throw new Error(`${marker} (${n}) not found in ${srcDir}`);
  return resolve(srcDir, f);
};

// New clean outline symbols (id order): 0 compass, 1 triangle, 2 protractor,
// 3 ruler, 4 pencil — used for the HUD chip (symbol_N) AND overlaid on the tile.
const SYMBOL_SRC = [
  find('02_27_17', 1), // compass (blue)
  find('02_27_17', 2), // triangle (orange)
  find('02_27_17', 3), // protractor (red)
  find('02_27_18', 4), // ruler (green)
  find('02_27_18', 5), // pencil (purple)
];
// Original hand-drawn wooden tiles (the base we keep) — same id order.
const TILE_SRC = [
  find('01_20_00', 1),
  find('01_20_00', 2),
  find('01_20_00', 3),
  find('01_20_01', 4),
  find('01_20_01', 5),
];
// EXPERIMENT: richer FILLED symbols for the board tiles (developer upload).
// If they don't fit, delete these and pass SYMBOL_SRC to processTile instead.
const TILE_SYMBOL_SRC = [
  find('19_19_43', 1), // compass
  find('19_19_43', 2), // triangle
  find('19_19_43', 3), // protractor
  find('19_19_43', 4), // ruler
  find('19_19_43', 5), // pencil
];

for (let i = 0; i < 5; i++) await processSymbol(SYMBOL_SRC[i], `symbol_${i}.png`);
for (let i = 0; i < 5; i++) await processTile(TILE_SRC[i], TILE_SYMBOL_SRC[i], `special_${i}.png`);
