/** Level baker v2: generates ALL 150 levels from the guideline slot map,
 * validates, writes JSON, and prints the balance report (necessity per
 * mechanic, distributions vs guideline targets, DI-ish curve stats). */
import { writeFileSync } from 'node:fs';
import { generateSortingLevelWithMeta, type LevelMeta } from '../src/mechanics/sorting/SortingLevelGenerator';
import { parseSortingLevels } from '../src/mechanics/sorting/SortingLevelParser';
import type { SortingLevelConfig } from '../src/mechanics/sorting/SortingTypes';

const TOTAL = 150;
const levels: SortingLevelConfig[] = [];
const metas: LevelMeta[] = [];

for (let i = 0; i < TOTAL; i++) {
  const t0 = Date.now();
  const { config, meta } = generateSortingLevelWithMeta(i);
  levels.push(config);
  metas.push(meta);
  const nec = Object.entries(meta.necessity).map(([k, v]) => `${k}:${v}`).join(' ');
  const p = meta.pressure;
  const vault =
    (config.chainedColumnBlocks?.length ? `chv${config.chainedColumnBlocks.length}` : '') +
    (config.lockedColumnBlocks?.length ? `lkv${config.lockedColumnBlocks.length}` : '');
  const flags = [meta.relaxed ? 'RELAXED' : '', meta.attempts >= 320 ? 'FALLBACK' : ''].filter(Boolean).join(' ');
  console.log(
    `${config.id} ${meta.card.stage.padEnd(6)} ${(meta.card.focus + (meta.card.second !== 'none' ? '+' + meta.card.second : '')).padEnd(16)} t${meta.card.types} c${config.cap} bu${meta.card.empties} tgt${meta.card.targetCount} ${vault.padEnd(6)} opt=${String(meta.optimal).padStart(2)} par=${config.par} p[udc${p.minUDC} w${p.windows} l${p.longest}] ${nec ? '[' + nec + '] ' : ''}${flags} (${Date.now() - t0}ms)`,
  );
}

const out = { version: 1, mechanic: 'sorting', levels };
parseSortingLevels(out); // full validation before writing
writeFileSync('public/levels/sorting_levels.json', JSON.stringify(out));
console.log(`\nwritten ${levels.length} levels`);

/* ---------------- balance report ---------------- */

console.log('\n=== distributions vs guideline targets ===');
const count = <T>(arr: T[]): Map<T, number> => {
  const m = new Map<T, number>();
  for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
};
const types = count(metas.map((m) => m.card.types));
const caps = count(levels.map((l) => l.cap));
const mechN = count(
  metas.map((m) => (m.card.focus !== 'none' ? 1 : 0) + (m.card.second !== 'none' ? 1 : 0)),
);
console.log(
  `types  3:${types.get(3) ?? 0}/6 4:${types.get(4) ?? 0}/26 5:${types.get(5) ?? 0}/44 6:${types.get(6) ?? 0}/43 7:${types.get(7) ?? 0}/24 8:${types.get(8) ?? 0}/7`,
);
console.log(`cap    3:${caps.get(3) ?? 0}/18 4:${caps.get(4) ?? 0}/120 5:${caps.get(5) ?? 0}/12`);
console.log(
  `mechs  0:${mechN.get(0) ?? 0}/40 1:${mechN.get(1) ?? 0}/70 2:${mechN.get(2) ?? 0}/40 (target/chain families count as one)`,
);

console.log('\n=== necessity gates ===');
let fails = 0;
metas.forEach((m, i) => {
  for (const [mech, n] of Object.entries(m.necessity)) {
    if ((n as number) <= 1) {
      fails++;
      console.log(`${levels[i].id}: ${mech}:${n} — below gate`);
    }
  }
});
console.log(fails === 0 ? 'all mechanic levels pass (necessity >= 2)' : `${fails} FAILURES`);

console.log('\n=== curve per decade (avg optimal / BU / relaxed count) ===');
for (let d = 0; d < TOTAL; d += 10) {
  const ms = metas.slice(d, d + 10);
  const avgOpt = ms.reduce((a, m) => a + m.optimal, 0) / ms.length;
  const avgBu = ms.reduce((a, m) => a + m.card.empties, 0) / ms.length;
  const relaxed = ms.filter((m) => m.relaxed).length;
  const mechs = ms
    .flatMap((m) => [m.card.focus, m.card.second])
    .filter((f) => f !== 'none');
  console.log(
    `${String(d + 1).padStart(3)}-${String(d + 10).padStart(3)}: opt ${avgOpt.toFixed(1).padStart(5)}  BU ${avgBu.toFixed(1)}  relaxed ${relaxed}  [${[...count(mechs).entries()].map(([k, v]) => `${k}:${v}`).join(' ')}]`,
  );
}
