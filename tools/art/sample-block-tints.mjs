/** Samples the perceived color of each block texture (strongly saturated
 * pixels only) and prints the BLOCK_TINTS table for src/app/gameConfig.ts.
 * Run after any block art change: node tools/art/sample-block-tints.mjs */
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';

const tints = [];
for (let i = 0; i < 8; i++) {
  const png = PNG.sync.read(readFileSync(`public/assets/images/block_${i}.png`));
  let r = 0, g = 0, b = 0, n = 0, rl = 0, gl = 0, bl = 0, nl = 0;
  for (let p = 0; p < png.data.length; p += 4) {
    const [R, G, B, A] = [png.data[p], png.data[p + 1], png.data[p + 2], png.data[p + 3]];
    if (A < 200) continue;
    const sat = Math.max(R, G, B) - Math.min(R, G, B);
    if (sat > 60) { r += R; g += G; b += B; n++; }
    else if (sat > 25) { rl += R; gl += G; bl += B; nl++; }
  }
  if (n < 100 && nl > 0) { r = rl; g = gl; b = bl; n = nl; }
  tints.push(((r / n) << 16) | ((g / n) << 8) | (b / n | 0));
}
console.log('export const BLOCK_TINTS: number[] = [');
console.log('  ' + tints.map((t) => '0x' + (t >>> 0).toString(16).padStart(6, '0')).join(', ') + ',');
console.log('];');
