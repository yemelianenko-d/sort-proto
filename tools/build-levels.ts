/** Build-time level baker: curated 1-10 + generated 11-150 -> one JSON,
 * with a per-decade mechanics distribution report for curve review. */
import { readFileSync, writeFileSync } from 'node:fs';
import { generateSortingLevel } from '../src/mechanics/sorting/SortingLevelGenerator';
import { parseSortingLevels } from '../src/mechanics/sorting/SortingLevelParser';
import type { SortingLevelConfig } from '../src/mechanics/sorting/SortingTypes';

const TOTAL = 150;
const path = 'public/levels/sorting_levels.json';
const file = JSON.parse(readFileSync(path, 'utf8'));
const curated = file.levels.slice(0, 10) as SortingLevelConfig[];

const levels: SortingLevelConfig[] = [...curated];
for (let i = 10; i < TOTAL; i++) {
  const t0 = Date.now();
  const cfg = generateSortingLevel(i);
  levels.push(cfg);
  const specials = cfg.columns.flat().filter((c) => c < 0).length;
  console.log(
    `${cfg.id} par=${cfg.par} cols=${cfg.columns.length} specials=${specials}` +
      `${cfg.lockedColumn ? ' lock' : ''}${cfg.tapedColumns?.length ? ' tape' : ''} (${Date.now() - t0}ms)`,
  );
}

const out = { version: 1, mechanic: 'sorting', levels };
parseSortingLevels(out); // full validation before writing
writeFileSync(path, JSON.stringify(out));
console.log(`written ${levels.length} levels`);

/* ---------------- curve review report ---------------- */

function mechanics(cfg: SortingLevelConfig): string[] {
  const flat = cfg.columns.flat();
  const parts: string[] = [];
  if (flat.includes(-3)) parts.push('ink');
  const keys = flat.filter((c) => c === -4).length;
  if (cfg.lockedColumn) parts.push(keys > 0 ? ((cfg.lockedColumnLocks ?? 1) > 1 ? 'lock2' : 'key') : 'lockB');
  if (cfg.tapedColumns?.length) parts.push('tape');
  if (cfg.targetColumns?.length) parts.push(cfg.targetColumns.length > 1 ? 'target2' : 'target');
  if (cfg.chains?.length) {
    parts.push(cfg.chains.some((c) => c >= 0) ? 'chainC' : 'chainN');
  }
  return parts;
}

console.log('\n=== distribution per decade ===');
for (let d = 0; d < TOTAL; d += 10) {
  const slice = levels.slice(d, d + 10);
  const counts = new Map<string, number>();
  let parSum = 0;
  for (const l of slice) {
    parSum += l.par;
    for (const mech of mechanics(l)) counts.set(mech, (counts.get(mech) ?? 0) + 1);
  }
  const desc = [...counts.entries()]
    .sort()
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  console.log(
    `${String(d + 1).padStart(3)}-${String(d + 10).padStart(3)}  avg par ${(parSum / slice.length).toFixed(1).padStart(5)}  ${desc || '(clean)'}`,
  );
}
