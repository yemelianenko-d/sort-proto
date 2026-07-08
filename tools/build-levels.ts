/** Level baker v2: generates ALL 150 levels from the guideline slot map,
 * validates, writes JSON, and prints the balance report (necessity per
 * mechanic, distributions vs guideline targets, DI-ish curve stats). */
import { writeFileSync } from 'node:fs';
import {
  generateSortingLevelWithMeta,
  necessityFor,
  type LevelMeta,
} from '../src/mechanics/sorting/SortingLevelGenerator';
import { parseSortingLevels } from '../src/mechanics/sorting/SortingLevelParser';
import type { SortingLevelConfig } from '../src/mechanics/sorting/SortingTypes';

const TOTAL = 150;
const levels: SortingLevelConfig[] = [];
const metas: LevelMeta[] = [];

for (let i = 0; i < TOTAL; i++) {
  const t0 = Date.now();
  const { config, meta } = generateSortingLevelWithMeta(i, { selectHardest: true });
  levels.push(config);
  metas.push(meta);
  const nec = Object.entries(meta.necessity).map(([k, v]) => `${k}:${v}`).join(' ');
  const h = meta.hardness;
  const hard = h ? `h[br${h.avgBranch.toFixed(1)} t${h.tightStates} f${h.minFree}]` : '';
  const trap = meta.trap ? `sr${Math.round(meta.trap.safeRatio * 100)} ke${meta.trap.knifeEdge}` : '';
  const vault =
    (config.chainedColumnBlocks?.length ? `chv${config.chainedColumnBlocks.length}` : '') +
    (config.lockedColumnBlocks?.length ? `lkv${config.lockedColumnBlocks.length}` : '');
  const flags = [meta.relaxed ? 'RELAXED' : '', meta.attempts >= 320 ? 'FALLBACK' : ''].filter(Boolean).join(' ');
  console.log(
    `${config.id} ${meta.card.stage.padEnd(6)} ${(meta.card.focus + (meta.card.second !== 'none' ? '+' + meta.card.second : '')).padEnd(16)} t${meta.card.types} c${config.cap} bu${meta.card.empties} tgt${meta.card.targetCount} ${vault.padEnd(6)} opt=${String(meta.optimal).padStart(2)} par=${config.par} ${hard} ${trap} ${nec ? '[' + nec + '] ' : ''}${flags} (${Date.now() - t0}ms)`,
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

// Stage-aware gate: a mechanic fails only if it falls below the necessity its
// STAGE was designed to require (necessityFor). Intro ('build') and breather
// ('relief') stages target 0, so a gentle mechanic there is intended — not a
// failure. Previously this flagged any necessity <= 1 regardless of stage,
// producing false "FAILURES" on intro levels (e.g. 66/71 tape, 81 key).
console.log('\n=== necessity gates (per-stage target) ===');
let fails = 0;
metas.forEach((m, i) => {
  const target = necessityFor(m.card.stage);
  if (target === 0) return; // gentle stage — nothing to gate
  for (const [mech, n] of Object.entries(m.necessity)) {
    if ((n as number) < target) {
      fails++;
      console.log(`${levels[i].id} (${m.card.stage}): ${mech}:${n} < ${target} — below gate`);
    }
  }
});
console.log(fails === 0 ? 'all graded levels meet their stage necessity target' : `${fails} FAILURES`);

console.log('\n=== trap density per decade (avg safeRatio on trap-targeted slots) ===');
for (let d = 0; d < TOTAL; d += 10) {
  const ts = metas.slice(d, d + 10).filter((m) => m.trap);
  if (ts.length === 0) continue;
  const avgSr = ts.reduce((a, m) => a + (m.trap?.safeRatio ?? 1), 0) / ts.length;
  const knives = ts.reduce((a, m) => a + (m.trap?.knifeEdge ?? 0), 0);
  const worst = Math.max(...ts.map((m) => m.trap?.safeRatio ?? 0));
  console.log(
    `${String(d + 1).padStart(3)}-${String(d + 10).padStart(3)}: slots ${ts.length}  avg sr ${(avgSr * 100).toFixed(0)}%  worst ${(worst * 100).toFixed(0)}%  knife-edges ${knives}`,
  );
}

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
