/**
 * Blocks mechanic tile pipeline: trims the transparent margins of the raw
 * artist PNGs, downsizes them to the game texture size and reports the
 * perceived tint of every tile (mid-tone average of the scribble pixels).
 *
 * Usage:
 *   node tools/art/prepare-blocks-tiles.mjs <srcDir> --report
 *     Only print each source's average colour (to decide the tile order).
 *   node tools/art/prepare-blocks-tiles.mjs <srcDir> --map 4,1,7,3,6,2,5,8
 *     Write public/assets/mechanics/blocks/tile_0..7.png where tile_N takes
 *     src_<map[N]>.png, and print the sampled BLOCK-tint palette.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const OUT_SIZE = 128; // matches the sorting block textures (block_N.png)
const PAD_FRACTION = 0.03; // breathing room kept around the trimmed art

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [srcDir, mode, mapArg] = process.argv.slice(2);
if (!srcDir) {
  console.error('usage: node tools/art/prepare-blocks-tiles.mjs <srcDir> [--report | --map 1,2,...]');
  process.exit(1);
}

/**
 * The raw exports have a fake-transparency checkerboard baked into the
 * pixels. Remove it by flood-filling from the image edges over "checker"
 * pixels (light, colour-neutral); the tile's darker gray border stops the
 * fill, so whites INSIDE the tile survive. Two erosion passes then eat the
 * light anti-aliasing halo left where checker met the border.
 */
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
  // halo erosion: light pixels touching the removed background fade out too
  for (let pass = 0; pass < 2; pass++) {
    const kill = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (data[i * 4 + 3] === 0) continue;
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        if (Math.min(r, g, b) < 190) continue;
        const nb = [i - 1, i + 1, i - w, i + w];
        if (nb.some((j) => data[j * 4 + 3] === 0)) kill.push(i);
      }
    }
    kill.forEach((i) => (data[i * 4 + 3] = 0));
  }
}

/** Alpha bounding box + square crop centred on the art. */
function trimBox(data, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('fully transparent image');
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const side = Math.max(bw, bh);
  const pad = Math.round(side * PAD_FRACTION);
  const size = side + pad * 2;
  return {
    x: minX - Math.round((size - bw) / 2),
    y: minY - Math.round((size - bh) / 2),
    size,
  };
}

/** Perceived tint: average of opaque, saturated pixels (skips the gray border). */
function sampleTint(data, w, h) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3];
    if (a < 200) continue;
    const pr = data[i * 4], pg = data[i * 4 + 1], pb = data[i * 4 + 2];
    const mx = Math.max(pr, pg, pb), mn = Math.min(pr, pg, pb);
    if (mx - mn < 30) continue; // gray outline / white paper
    r += pr; g += pg; b += pb; n += 1;
  }
  if (n === 0) return null;
  const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

async function processOne(srcIndex, outIndex) {
  const img = await loadImage(resolve(srcDir, `src_${srcIndex}.png`));
  const full = createCanvas(img.width, img.height);
  const fctx = full.getContext('2d');
  fctx.drawImage(img, 0, 0);
  const imageData = fctx.getImageData(0, 0, img.width, img.height);
  const { data } = imageData;
  removeCheckerBackground(data, img.width, img.height);
  fctx.putImageData(imageData, 0, 0);
  const box = trimBox(data, img.width, img.height);
  const tint = sampleTint(data, img.width, img.height);

  if (outIndex === null) {
    console.log(`src_${srcIndex}: tint ${tint}, art ${box.size}px of ${img.width}px`);
    return null;
  }
  const out = createCanvas(OUT_SIZE, OUT_SIZE);
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(full, box.x, box.y, box.size, box.size, 0, 0, OUT_SIZE, OUT_SIZE);
  const outDir = resolve(root, 'public/assets/mechanics/blocks');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, `tile_${outIndex}.png`), out.toBuffer('image/png'));
  console.log(`tile_${outIndex}.png <- src_${srcIndex} (tint ${tint})`);
  return tint;
}

if (mode === '--map') {
  const map = mapArg.split(',').map(Number);
  if (map.length !== 8) throw new Error('--map needs 8 comma-separated source indices');
  const tints = [];
  for (let i = 0; i < 8; i++) tints.push(await processOne(map[i], i));
  console.log('\nTILE_TINTS:', JSON.stringify(tints));
} else {
  for (let i = 1; i <= 8; i++) await processOne(i, null);
}
