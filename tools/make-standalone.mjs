/** Injects the level config into the single-file build and strips
 *  PWA/network-only bits (manifest, SW file refs are harmless but useless
 *  on file://). Output: sort-proto-standalone.html */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(root, 'dist-standalone/index.html');
const levels = readFileSync(resolve(root, 'public/levels/sorting_levels.json'), 'utf8');

let html = readFileSync(htmlPath, 'utf8');
let inject = `<script>window.__SORTPROTO_LEVELS__ = ${levels};</script>`;

// Inline artist assets (if any): urls become base64 data URIs.
try {
  const manifestPath = resolve(root, 'public/assets/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const toDataUri = (url) => {
    const buf = readFileSync(resolve(root, 'public', url));
    return `data:image/png;base64,${buf.toString('base64')}`;
  };
  manifest.images = (manifest.images ?? []).map((img) => ({ ...img, url: toDataUri(img.url) }));
  manifest.atlases = []; // atlases need two files; add when fx pack arrives
  inject += `\n<script>window.__SORTPROTO_ASSETS__ = ${JSON.stringify(manifest)};</script>`;
  console.log(`inlined ${manifest.images.length} asset images`);
} catch {
  console.log('no asset manifest -> procedural art');
}

// inject before the first script so the game sees it at boot
html = html.replace(/<script/, `${inject}\n<script`);

const out = resolve(root, 'dist-standalone/sort-proto-standalone.html');
writeFileSync(out, html);
console.log('standalone ->', out, `${Math.round(html.length / 1024)} KB`);
