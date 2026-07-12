/**
 * Blocks blueprint-decor pipeline: slices the four generated decor sheets
 * into game sprites. The baked "10" digits are cropped OUT — the game draws
 * the (correct) board size with its own handwriting font, so the art stays
 * valid for any future board size.
 *
 * Usage: node tools/art/prepare-blocks-decor.mjs <downloadsDir>
 * Sources are matched by name pattern (the four 23_47_05 exports).
 */
import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [srcDir] = process.argv.slice(2);
if (!srcDir) {
  console.error('usage: node tools/art/prepare-blocks-decor.mjs <srcDir>');
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

/** Crop by fractional rect -> targeted erases -> trim alpha -> downscale. */
async function slice(srcPath, outName, frac, maxSide, erase = []) {
  const img = await loadImage(srcPath);
  const full = createCanvas(img.width, img.height);
  const ctx = full.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  removeCheckerBackground(imageData.data, img.width, img.height);
  // decor sheets are pure line art: strip ALL remaining light neutral pixels
  // (checker remnants, soft shadows, white fills the edge flood can't reach)
  // and boost the alpha of thin hairlines so they survive the downscale
  const d = imageData.data;
  for (let i = 0; i < img.width * img.height; i++) {
    const a = d[i * 4 + 3];
    if (a === 0) continue;
    const mx = Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    const mn = Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    if (mn >= 195 && mx - mn <= 22) d[i * 4 + 3] = 0;
    else if (a < 220) d[i * 4 + 3] = Math.min(255, Math.round(a * 1.4));
  }
  ctx.putImageData(imageData, 0, 0);

  const cx = Math.round(frac.x0 * img.width);
  const cy = Math.round(frac.y0 * img.height);
  const cw = Math.round((frac.x1 - frac.x0) * img.width);
  const ch = Math.round((frac.y1 - frac.y0) * img.height);
  const crop = ctx.getImageData(cx, cy, cw, ch);
  // wipe leftover fragments of neighbouring sheet elements (crop fractions)
  for (const e of erase) {
    for (let y = Math.round(e.y0 * ch); y < e.y1 * ch; y++) {
      for (let x = Math.round(e.x0 * cw); x < e.x1 * cw; x++) {
        crop.data[(y * cw + x) * 4 + 3] = 0;
      }
    }
  }
  ctx.putImageData(crop, cx, cy);

  // alpha bbox inside the crop (+2px pad)
  let minX = cw, minY = ch, maxX = -1, maxY = -1;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (crop.data[(y * cw + x) * 4 + 3] > 30) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error(`${outName}: crop is empty`);
  minX = Math.max(0, minX - 2);
  minY = Math.max(0, minY - 2);
  maxX = Math.min(cw - 1, maxX + 2);
  maxY = Math.min(ch - 1, maxY + 2);
  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;

  const scale = Math.min(1, maxSide / Math.max(tw, th));
  const ow = Math.max(1, Math.round(tw * scale));
  const oh = Math.max(1, Math.round(th * scale));
  const out = createCanvas(ow, oh);
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(full, cx + minX, cy + minY, tw, th, 0, 0, ow, oh);
  const outDir = resolve(root, 'public/assets/mechanics/blocks');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, outName), out.toBuffer('image/png'));
  console.log(`${outName}: ${ow}x${oh} (from ${tw}x${th})`);
}

// the four exports, matched by their (N) suffix
const files = readdirSync(srcDir).filter((f) => f.includes('23_47_05'));
const bySuffix = (n) => {
  const f = files.find((name) => name.includes(`(${n})`));
  if (!f) throw new Error(`source (${n}) not found in ${srcDir}`);
  return resolve(srcDir, f);
};

// Crop rects come from an ink-cluster analysis of each sheet (connected
// components of saturated pixels) — do not eyeball them; rerun the analysis
// if the sheets are regenerated.
// (1) horizontal dimension sheet: the dashed line WITHOUT the "10" digit
// (digit cluster sits above the y-band), plus the datum circle (reused for
// both top corners; the right one is flipped in code)
await slice(bySuffix(1), 'dim_line_h.png', { x0: 0.122, y0: 0.415, x1: 0.891, y1: 0.512 }, 1024);
await slice(bySuffix(1), 'corner_datum.png', { x0: 0.088, y0: 0.39, x1: 0.128, y1: 0.64 }, 256);
// (2) vertical dimension sheet: the dashed line only; the "10" digit hugs
// the right crop edge, so a targeted wipe covers its antialiased fringe
await slice(bySuffix(2), 'dim_line_v.png', { x0: 0.545, y0: 0.13, x1: 0.652, y1: 0.86 }, 1024, [
  { x0: 0.85, y0: 0.42, x1: 1, y1: 0.52 },
]);
// (3) the 90° annotation (label baked by design); the sheet's spare arrow
// fragment inside the crop is wiped
await slice(bySuffix(3), 'corner_angle.png', { x0: 0.21, y0: 0.19, x1: 0.735, y1: 0.815 }, 512, [
  { x0: 0.75, y0: 0.3, x1: 0.86, y1: 0.82 }, // the sheet's spare arrow, full height
]);
// (4) the right-angle square with its centerline axis
await slice(bySuffix(4), 'corner_square.png', { x0: 0.455, y0: 0.34, x1: 0.925, y1: 0.805 }, 512);
