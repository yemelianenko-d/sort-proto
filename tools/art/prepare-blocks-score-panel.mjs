/**
 * Score-panel pipeline: cleans the generated ruler-panel art into the game
 * sprite `blocks/score_panel`. Removes the baked checkerboard, ERASES the
 * baked start pin (the marker is drawn by the game — it moves) patching the
 * track line across the gap, trims and downscales. Then SCANS the sprite and
 * prints the layout fractions (bubble/target centres, track y and x-range)
 * that BlocksScene bakes as constants — do not eyeball them.
 *
 * Usage: node tools/art/prepare-blocks-score-panel.mjs <srcPng>
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [srcPath] = process.argv.slice(2);
if (!srcPath) {
  console.error('usage: node tools/art/prepare-blocks-score-panel.mjs <srcPng>');
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

const img = await loadImage(srcPath);
const W = img.width, H = img.height;
const full = createCanvas(W, H);
const ctx = full.getContext('2d');
ctx.drawImage(img, 0, 0);
const imageData = ctx.getImageData(0, 0, W, H);
removeCheckerBackground(imageData.data, W, H);
const d = imageData.data;

// the panel interior is CLOSED, so the edge flood can't reach its baked
// checker — strip all remaining light-neutral pixels globally (line art only)
for (let i = 0; i < W * H; i++) {
  const a = d[i * 4 + 3];
  if (a === 0) continue;
  const mx = Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  const mn = Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  if (mn >= 195 && mx - mn <= 22) d[i * 4 + 3] = 0;
  else if (a < 220) d[i * 4 + 3] = Math.min(255, Math.round(a * 1.4));
}

const at = (x, y) => {
  const i = (y * W + x) * 4;
  return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
};
const isBlue = (p) => p.a > 60 && p.b > 120 && p.b - p.r > 40 && p.b - p.g > 25;
const isOrange = (p) => p.a > 60 && p.r > 180 && p.g > 100 && p.g < 200 && p.b < 100;

/* ---- alpha bbox of the panel ---- */
let minX = W, minY = H, maxX = -1, maxY = -1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3] > 30) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
const bw = maxX - minX + 1, bh = maxY - minY + 1;

/* ---- locate the track: the y row with the longest horizontal blue run in
 * the middle band (between the squares) ---- */
let trackY = 0, best = 0, trackX0 = 0, trackX1 = 0;
for (let y = minY + Math.round(bh * 0.3); y < minY + Math.round(bh * 0.85); y++) {
  let run = 0, runStart = 0, bestRun = 0, bestStart = 0, bestEnd = 0;
  for (let x = minX; x <= maxX; x++) {
    if (isBlue(at(x, y))) {
      if (run === 0) runStart = x;
      run++;
      if (run > bestRun) { bestRun = run; bestStart = runStart; bestEnd = x; }
    } else if (run > 0 && !isBlue(at(Math.min(x + 3, maxX), y))) run = 0; // tolerate 3px nicks
  }
  if (bestRun > best) { best = bestRun; trackY = y; trackX0 = bestStart; trackX1 = bestEnd; }
}

/* ---- locate the pin head: it is the only element that rises ABOVE the
 * track stroke (the ruler ticks hang BELOW it), so count blue strictly
 * above the stroke top ---- */
const headBand = Math.round(bh * 0.16);
const strokeH = 14; // the track stroke is ~12px in the source
let pinX0 = -1, pinX1 = -1;
for (let x = trackX0; x < trackX0 + Math.round(bw * 0.3); x++) {
  let above = 0;
  for (let y = trackY - headBand; y < trackY - strokeH; y++) {
    if (isBlue(at(x, y))) above++;
  }
  if (above > 6) {
    if (pinX0 < 0) pinX0 = x;
    pinX1 = x; // union of ALL risers left of centre: start cap + pin head
  }
}

/* ---- erase the pin (head + stem), then patch the track line across.
 * The bottom stays clear of the panel frame (stem tip nearly touches it). ---- */
if (pinX0 >= 0) {
  const padX = Math.round(bw * 0.006);
  const y0 = trackY - Math.round(bh * 0.22);
  const y1 = maxY - Math.round(bh * 0.085);
  // sample the track stroke just right of the pin for the patch colour/height
  const sampleX = pinX1 + padX + Math.round(bw * 0.01);
  let strokeTop = trackY, strokeBot = trackY;
  for (let y = trackY; y > trackY - 12; y--) if (isBlue(at(sampleX, y))) strokeTop = y; else break;
  for (let y = trackY; y < trackY + 12; y++) if (isBlue(at(sampleX, y))) strokeBot = y; else break;
  const s = at(sampleX, trackY);
  for (let y = y0; y <= y1; y++) {
    for (let x = pinX0 - padX; x <= pinX1 + padX; x++) {
      d[(y * W + x) * 4 + 3] = 0;
    }
  }
  for (let y = strokeTop; y <= strokeBot; y++) {
    for (let x = pinX0 - padX; x <= pinX1 + padX; x++) {
      const i = (y * W + x) * 4;
      d[i] = s.r; d[i + 1] = s.g; d[i + 2] = s.b; d[i + 3] = 255;
    }
  }
  console.log(`pin erased: x ${pinX0}..${pinX1}, track stroke ${strokeTop}..${strokeBot}`);
} else {
  console.warn('pin not found — nothing erased');
}

/* ---- erase the baked ruler ticks (they alias to mush at display size —
 * the game draws crisp procedural ticks instead). Ticks hang BELOW the
 * track stroke between the squares. ---- */
{
  const sampleX2 = trackX0 + Math.round(bw * 0.02);
  let strokeBot2 = trackY;
  for (let y = trackY; y < trackY + 14; y++) if (isBlue(at(sampleX2, y))) strokeBot2 = y; else break;
  const tickTop = strokeBot2 + 1;
  const tickBottom = Math.min(maxY - Math.round(bh * 0.085), tickTop + Math.round(bh * 0.28));
  for (let y = tickTop; y <= tickBottom; y++) {
    for (let x = trackX0; x <= trackX1 + Math.round(bw * 0.01); x++) {
      d[(y * W + x) * 4 + 3] = 0;
    }
  }
  console.log(`ticks erased: y ${tickTop}..${tickBottom}`);
}

/* ---- ERASE the two end squares entirely: the game draws its own circles
 * (the baked squares' hand-drawn fill was crooked, and the right one crowded
 * the last ruler tick). We keep only the frame + dashes + track. The measured
 * bboxes below tell the game where to place its circles. ---- */
function eraseRect(x0f, x1f, y0f, y1f) {
  const px0 = Math.round(minX + x0f * bw), px1 = Math.round(minX + x1f * bw);
  const py0 = Math.round(minY + y0f * bh), py1 = Math.round(minY + y1f * bh);
  for (let y = py0; y <= py1; y++) for (let x = px0; x <= px1; x++) d[(y * W + x) * 4 + 3] = 0;
}

/* ---- locate the two squares (bubble = blue cluster left of the track
 * start; target = orange cluster) via centroids ---- */
function bbox(test, x0, x1, y0 = minY, y1 = maxY) {
  let bx0 = x1, bx1 = x0, by0 = y1, by1 = y0, n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (test(at(x, y))) {
        n++;
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
    }
  }
  return n > 0 ? { x0: bx0, x1: bx1, y0: by0, y1: by1 } : null;
}
// exclude the panel frame from the bubble scan (borders are blue too)
const inset = Math.round(bh * 0.14);
const bubble = bbox(isBlue, minX + Math.round(bw * 0.015), trackX0 - Math.round(bw * 0.01), minY + inset, maxY - inset);
const target = bbox(isOrange, minX, maxX);

// Erase the BAKED TRACK LINE between the squares AND both end squares
// themselves (their corners peeked out from under the game's circles): the
// game draws its own circles + scale, aligned with margins.
if (bubble && target) {
  const y0 = Math.max(minY, trackY - 12), y1 = Math.min(maxY, trackY + 12);
  for (let y = y0; y <= y1; y++) {
    for (let x = bubble.x1 + 2; x <= target.x0 - 2; x++) d[(y * W + x) * 4 + 3] = 0;
  }
  const pad = 0.006;
  eraseRect((bubble.x0 - minX) / bw - pad, (bubble.x1 - minX) / bw + pad, (bubble.y0 - minY) / bh - 0.03, (bubble.y1 - minY) / bh + 0.03);
  eraseRect((target.x0 - minX) / bw - pad, (target.x1 - minX) / bw + pad, (target.y0 - minY) / bh - 0.03, (target.y1 - minY) / bh + 0.03);
}

/* ---- write the sprite ---- */
ctx.putImageData(imageData, 0, 0);
const MAXW = 1024;
const scale = Math.min(1, MAXW / bw);
const ow = Math.round(bw * scale), oh = Math.round(bh * scale);
const out = createCanvas(ow, oh);
const octx = out.getContext('2d');
octx.imageSmoothingEnabled = true;
octx.imageSmoothingQuality = 'high';
octx.drawImage(full, minX, minY, bw, bh, 0, 0, ow, oh);
const outDir = resolve(root, 'public/assets/mechanics/blocks');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'score_panel.png'), out.toBuffer('image/png'));
console.log(`score_panel.png: ${ow}x${oh} (from ${bw}x${bh})`);

/* ---- layout fractions for BlocksScene (relative to the sprite) ---- */
const fx = (x) => ((x - minX) / bw).toFixed(4);
const fy = (y) => ((y - minY) / bh).toFixed(4);
console.log('--- bake into BlocksScene SCORE_PANEL constants ---');
console.log(`aspect (h/w): ${(bh / bw).toFixed(4)}`);
if (bubble) console.log(`bubble bbox: x ${fx(bubble.x0)}..${fx(bubble.x1)}, y ${fy(bubble.y0)}..${fy(bubble.y1)}`);
if (target) console.log(`target bbox: x ${fx(target.x0)}..${fx(target.x1)}, y ${fy(target.y0)}..${fy(target.y1)}`);
console.log(`track y: ${fy(trackY)}, x ${fx(trackX0)} .. ${fx(trackX1)}`);
