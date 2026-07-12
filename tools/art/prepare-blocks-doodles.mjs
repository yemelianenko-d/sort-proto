/**
 * Blocks doodle pipeline: trims the generated doodle sheets (geometry objects
 * + handwritten block one-liners) into `blocks/doodle_NN` textures. Fake
 * checkerboard transparency is stripped the same way as for the tiles.
 *
 * Usage: node tools/art/prepare-blocks-doodles.mjs <downloadsDir>
 * Batch 1 (23_56, 9 sheets) -> doodle_01..09, batch 2 (00_11, 7) -> 10..16.
 */
import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const MAX_SIDE = 500;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [srcDir] = process.argv.slice(2);
if (!srcDir) {
  console.error('usage: node tools/art/prepare-blocks-doodles.mjs <srcDir>');
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

async function processOne(srcPath, outIndex) {
  const img = await loadImage(srcPath);
  const full = createCanvas(img.width, img.height);
  const ctx = full.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  const { data } = imageData;
  removeCheckerBackground(data, img.width, img.height);
  // doodles are line art on nothing: strip stray light-neutral pixels too
  for (let i = 0; i < img.width * img.height; i++) {
    if (data[i * 4 + 3] === 0) continue;
    const mx = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    const mn = Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    if (mn >= 205 && mx - mn <= 18) data[i * 4 + 3] = 0;
  }
  ctx.putImageData(imageData, 0, 0);

  let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (data[(y * img.width + x) * 4 + 3] > 30) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error(`${srcPath}: empty after cleanup`);
  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  const scale = Math.min(1, MAX_SIDE / Math.max(tw, th));
  const out = createCanvas(Math.round(tw * scale), Math.round(th * scale));
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(full, minX, minY, tw, th, 0, 0, out.width, out.height);
  const name = `doodle_${String(outIndex).padStart(2, '0')}.png`;
  const outDir = resolve(root, 'public/assets/mechanics/blocks');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, name), out.toBuffer('image/png'));
  console.log(`${name}: ${out.width}x${out.height}`);
}

const files = readdirSync(srcDir);
const batch = (marker, count) => {
  const list = [];
  for (let n = 1; n <= count; n++) {
    const f = files.find((name) => name.includes(marker) && name.includes(`(${n})`));
    if (!f) throw new Error(`${marker} (${n}) not found`);
    list.push(resolve(srcDir, f));
  }
  return list;
};
const sources = [...batch('23_56', 9), ...batch('00_11', 7)];
for (let i = 0; i < sources.length; i++) await processOne(sources[i], i + 1);
