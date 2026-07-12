/** Injects the level config into the single-file build and strips
 *  PWA/network-only bits (manifest, SW file refs are harmless but useless
 *  on file://). Output: sort-proto-standalone.html */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(root, 'dist-standalone/index.html');
const levels = readFileSync(resolve(root, 'public/levels/sorting_levels.json'), 'utf8');
const blocksLevels = readFileSync(resolve(root, 'public/levels/blocks_levels.json'), 'utf8');

let html = readFileSync(htmlPath, 'utf8');
let inject = `<script>window.__SORTPROTO_LEVELS__ = ${levels};</script>`;
inject += `\n<script>window.__SORTPROTO_BLOCKS_LEVELS__ = ${blocksLevels};</script>`;

// Inline artist assets (if any): urls become base64 data URIs.
// Buckets (shared design system + per-mechanic) are merged into the single
// manifest the standalone runtime expects in window.__SORTPROTO_ASSETS__.
const MANIFESTS = [
  'public/assets/shared/manifest.json',
  'public/assets/mechanics/sorting/manifest.json',
  'public/assets/mechanics/blocks/manifest.json',
];
try {
  const toDataUri = (url) => {
    // manifests may cache-bust urls with ?v=N — strip the query for the file read
    const buf = readFileSync(resolve(root, 'public', url.split('?')[0]));
    return `data:image/png;base64,${buf.toString('base64')}`;
  };
  const merged = { version: 1, images: [], atlases: [], nineslice: {}, animations: [] };
  for (const path of MANIFESTS) {
    const part = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
    merged.images.push(...(part.images ?? []).map((img) => ({ ...img, url: toDataUri(img.url) })));
    Object.assign(merged.nineslice, part.nineslice ?? {});
    merged.animations.push(...(part.animations ?? []));
    // atlases need two files; add when fx pack arrives
  }
  inject += `\n<script>window.__SORTPROTO_ASSETS__ = ${JSON.stringify(merged)};</script>`;
  console.log(`inlined ${merged.images.length} asset images`);
} catch (err) {
  console.log('no asset manifest -> procedural art', err?.message ?? '');
}

// inject before the first script so the game sees it at boot
html = html.replace(/<script/, `${inject}\n<script`);

const out = resolve(root, 'dist-standalone/sort-proto-standalone.html');
writeFileSync(out, html);
console.log('standalone ->', out, `${Math.round(html.length / 1024)} KB`);
