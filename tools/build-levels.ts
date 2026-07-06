/** Build-time level baker: curated 1-10 + generated 11-100 -> one JSON. */
import { readFileSync, writeFileSync } from 'node:fs';
import { generateSortingLevel } from '../src/mechanics/sorting/SortingLevelGenerator';
import { parseSortingLevels } from '../src/mechanics/sorting/SortingLevelParser';

const path = 'public/levels/sorting_levels.json';
const file = JSON.parse(readFileSync(path, 'utf8'));
const curated = file.levels.slice(0, 10);

const levels = [...curated];
for (let i = 10; i < 100; i++) {
  const t0 = Date.now();
  const cfg = generateSortingLevel(i);
  levels.push(cfg);
  const specials = cfg.columns.flat().filter((c: number) => c < 0).length;
  console.log(
    `${cfg.id} par=${cfg.par} cols=${cfg.columns.length} specials=${specials}` +
      `${cfg.lockedColumn ? ' lock' : ''}${cfg.tapedColumns?.length ? ' tape' : ''} (${Date.now() - t0}ms)`,
  );
}

const out = { version: 1, mechanic: 'sorting', levels };
parseSortingLevels(out); // full validation before writing
writeFileSync(path, JSON.stringify(out));
console.log(`written ${levels.length} levels`);
