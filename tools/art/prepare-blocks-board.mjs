/**
 * Blocks board-frame pipeline: takes the generated frame art (which bakes a
 * WRONG inner grid — the model can't count cells), removes the fake-alpha
 * checkerboard, trims the margins, ERASES everything inside the double
 * border (the game draws its own, correctly spaced cell lines) and
 * downsizes to the game texture.
 *
 * Usage: node tools/art/prepare-blocks-board.mjs <sourcePng>
 * Output: public/assets/mechanics/blocks/board_frame.png (1024²)
 * Prints the measured frame-band fraction to plug into BlocksView.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const OUT_SIZE = 1024;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [src] = process.argv.slice(2);
if (!src) {
  console.error('usage: node tools/art/prepare-blocks-board.mjs <sourcePng>');
  process.exit(1);
}

/** Same fake-transparency removal as prepare-blocks-tiles.mjs. */
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

function alphaBBox(data, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 40) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Geometry of the double border along one scanline, as distances from the
 * bbox edge: end of the outer ink run, start and end of the inner ink run.
 * Ink = colored (not white) opaque pixels, so the white gap fill between the
 * lines does not merge the runs. Medians over several scanlines skip the
 * baked tick marks.
 */
function frameRuns(data, w, box, y, fromLeft) {
  const ink = (x) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] <= 60) return false;
    const mx = Math.max(data[i], data[i + 1], data[i + 2]);
    const mn = Math.min(data[i], data[i + 1], data[i + 2]);
    return !(mx - mn <= 14 && mn >= 205); // white-ish = not ink
  };
  const limit = Math.floor((box.maxX - box.minX) * 0.2);
  let r1End = -1;
  let r2Start = -1;
  let r2End = -1;
  let inRun = false;
  let runs = 0;
  for (let d = 0; d <= limit; d++) {
    const x = fromLeft ? box.minX + d : box.maxX - d;
    if (ink(x)) {
      if (!inRun) {
        runs += 1;
        inRun = true;
        if (runs === 2) r2Start = d;
      }
      if (runs === 2) r2End = d;
    } else if (inRun) {
      inRun = false;
      if (runs === 1) r1End = d - 1;
      if (runs === 2) return { r1End, r2Start, r2End };
    }
  }
  return null; // scanline crossed a tick — caller drops it
}

const img = await loadImage(resolve(src));
const full = createCanvas(img.width, img.height);
const ctx = full.getContext('2d');
ctx.drawImage(img, 0, 0);
const imageData = ctx.getImageData(0, 0, img.width, img.height);
const { data } = imageData;
removeCheckerBackground(data, img.width, img.height);

const box = alphaBBox(data, img.width, img.height);
const bw = box.maxX - box.minX + 1;
const bh = box.maxY - box.minY + 1;

// median border geometry over 17 scanlines on both sides (ticks skipped)
const runs = [];
for (let k = 1; k <= 17; k++) {
  const y = box.minY + Math.floor((bh * k) / 18);
  for (const fromLeft of [true, false]) {
    const r = frameRuns(data, img.width, box, y, fromLeft);
    if (r && r.r2Start > 0) runs.push(r);
  }
}
if (runs.length < 5) throw new Error('could not detect the double border');
const median = (key) => {
  const v = runs.map((r) => r[key]).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
};
const r1End = median('r1End');
const r2Start = median('r2Start');
const r2End = median('r2End');

// Two erases, by distance-from-edge:
//  - the gap ring between the two lines (kills the white fill AND the baked
//    tick marks with their wrong 9-column spacing — the game draws its own);
//  - the whole interior past the inner line (the game draws its own grid).
const gapFrom = r1End + 2;
const gapTo = r2Start - 2;
const innerFrom = r2End + 3;
for (let y = box.minY; y <= box.maxY; y++) {
  for (let x = box.minX; x <= box.maxX; x++) {
    const d = Math.min(x - box.minX, box.maxX - x, y - box.minY, box.maxY - y);
    if ((d >= gapFrom && d <= gapTo) || d >= innerFrom) {
      data[(y * img.width + x) * 4 + 3] = 0;
    }
  }
}
const band = innerFrom;
ctx.putImageData(imageData, 0, 0);

const side = Math.max(bw, bh);
const out = createCanvas(OUT_SIZE, OUT_SIZE);
const octx = out.getContext('2d');
octx.imageSmoothingEnabled = true;
octx.imageSmoothingQuality = 'high';
octx.drawImage(full, box.minX, box.minY, side, side, 0, 0, OUT_SIZE, OUT_SIZE);
const outDir = resolve(root, 'public/assets/mechanics/blocks');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'board_frame.png'), out.toBuffer('image/png'));

const fraction = band / side;
console.log(`board_frame.png <- ${src}`);
console.log(`frame band: ${band}px of ${side}px -> inner fraction ${fraction.toFixed(4)}`);
console.log('use in BlocksView: FRAME_BAND_FRACTION =', fraction.toFixed(4));
