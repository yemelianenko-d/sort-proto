/**
 * Level pool analyzer — Phase 0 of the Balance & Level Design Guideline v2.
 *
 * Computes per-level metrics (board load, buffer units, mixing, access
 * depth), runs Mechanic Ablation Tests (locked-forever / open-from-start /
 * colored→neutral / tape→normal / target→normal), derives a Mechanic
 * Necessity score from the Meaningful Impact Gate thresholds, detects
 * structural duplicates via a canonical layout hash, and folds everything
 * into a pragmatic Difficulty Index (0-100).
 *
 * Run: npx tsx tools/analyze-levels.ts [--json out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { solveBest, type SolverState } from '../src/mechanics/sorting/SortingSolver';
import type { SortingLevelConfig } from '../src/mechanics/sorting/SortingTypes';

const SPECIAL_INK = -3;
const SPECIAL_KEY = -4;

/* ---------------- solver adapters ---------------- */

function stateFor(cfg: SortingLevelConfig, opts: {
  lockedForever?: boolean;
  openFromStart?: boolean;
  coloredToNeutral?: boolean;
  tapeToNormal?: boolean;
  targetToNormal?: boolean;
} = {}): SolverState {
  const cols = cfg.columns.map((c) => c.slice());
  let locked = -1;
  let chainCol = -1;
  let locks = 0;
  let chains = (cfg.chains ?? []).slice();
  if (opts.coloredToNeutral) chains = chains.map(() => -1);

  if (cfg.lockedColumn) {
    if (!opts.lockedForever) {
      cols.push([]);
      if (!opts.openFromStart) {
        locked = cols.length - 1;
        locks = cfg.lockedColumnLocks ?? 1;
      }
    }
    // lockedForever: the column simply never exists for the solver
  }
  if (chains.length > 0) {
    if (!opts.lockedForever) {
      cols.push([]);
      if (!opts.openFromStart) {
        chainCol = cols.length - 1;
      }
    }
  }
  const taped = opts.tapeToNormal ? new Set<number>() : new Set(cfg.tapedColumns ?? []);
  const targets = opts.targetToNormal
    ? new Map<number, number>()
    : new Map((cfg.targetColumns ?? []).map((t) => [t.col, t.color]));
  return {
    cols,
    cap: cfg.cap,
    locked,
    locks,
    chainCol,
    chains: opts.openFromStart ? [] : chains,
    taped,
    targets,
  };
}

/* ---------------- metrics ---------------- */

/** Effective starting Buffer Units per the guideline's table. */
function startingBU(cfg: SortingLevelConfig): number {
  let bu = 0;
  cfg.columns.forEach((col, i) => {
    const isTarget = (cfg.targetColumns ?? []).some((t) => t.col === i);
    if (col.length === 0) bu += isTarget ? 0.4 : 1.0;
  });
  // locked/chained/taped columns: 0 BU until earned; ink dead slots reduce
  // nothing here (they were never buffer)
  return bu;
}

/** 0 (fully grouped) .. 1 (fully scattered): 1 - same-type adjacency share. */
function mixingScore(cfg: SortingLevelConfig): number {
  let pairs = 0;
  let same = 0;
  for (const col of cfg.columns) {
    for (let i = 1; i < col.length; i++) {
      if (col[i] < 0 || col[i - 1] < 0) continue;
      pairs += 1;
      if (col[i] === col[i - 1]) same += 1;
    }
  }
  return pairs === 0 ? 0 : 1 - same / pairs;
}

function accessDepths(cfg: SortingLevelConfig): { avg: number; keyMax: number } {
  let sum = 0;
  let n = 0;
  let keyMax = 0;
  for (const col of cfg.columns) {
    for (let i = 0; i < col.length; i++) {
      const depth = col.length - 1 - i; // blocks on top of it
      if (col[i] >= 0) {
        sum += depth;
        n += 1;
      }
      if (col[i] === SPECIAL_KEY) keyMax = Math.max(keyMax, depth);
    }
  }
  return { avg: n ? sum / n : 0, keyMax };
}

/** Canonical hash: column order and color naming must not matter. */
function canonicalHash(cfg: SortingLevelConfig): string {
  // rename colors by first appearance over a canonical column ordering
  const colKeys = cfg.columns.map((c) => c.join(','));
  const order = colKeys
    .map((k, i) => ({ k, i }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .map((e) => e.i);
  const rename = new Map<number, number>();
  let next = 0;
  const canonCols = order.map((i) =>
    cfg.columns[i].map((c) => {
      if (c < 0) return c;
      if (!rename.has(c)) rename.set(c, next++);
      return rename.get(c) as number;
    }),
  );
  const meta = {
    cap: cfg.cap,
    cols: canonCols,
    locked: cfg.lockedColumn ? (cfg.lockedColumnLocks ?? 1) : 0,
    chains: (cfg.chains ?? []).map((c) => (c < 0 ? -1 : (rename.get(c) ?? 99))).sort(),
    taped: (cfg.tapedColumns ?? []).map((t) => order.indexOf(t)).sort(),
    targets: (cfg.targetColumns ?? [])
      .map((t) => ({ col: order.indexOf(t.col), color: rename.get(t.color) ?? 99 }))
      .sort((a, b) => a.col - b.col),
    hidden: cfg.hiddenBelowTop === true,
  };
  return createHash('sha1').update(JSON.stringify(meta)).digest('hex').slice(0, 12);
}

/* ---------------- necessity from the Meaningful Impact Gate ---------------- */

function necessityFromDelta(base: number, ablated: number): number {
  if (ablated <= 0) return 4; // unsolvable without the mechanic
  const delta = (ablated - base) / base;
  if (delta >= 0.2) return 3;
  if (delta >= 0.08) return 2;
  if (delta > 0.0) return 1;
  return 0;
}

interface MechReport {
  mechanic: string;
  necessity: number;
  detail: string;
}

function analyzeMechanics(cfg: SortingLevelConfig, base: number): MechReport[] {
  const out: MechReport[] = [];
  const solveVariant = (opts: Parameters<typeof stateFor>[1]) => solveBest(stateFor(cfg, opts), 1, 60000);

  const hasKeys = cfg.columns.flat().includes(SPECIAL_KEY);
  if (cfg.lockedColumn && hasKeys) {
    const forever = solveVariant({ lockedForever: true });
    const open = solveVariant({ openFromStart: true });
    const nec = necessityFromDelta(base, forever);
    const locks = cfg.lockedColumnLocks ?? 1;
    out.push({
      mechanic: locks > 1 ? 'multilock' : 'key',
      necessity: nec,
      detail: `forever=${forever} open=${open} base=${base}`,
    });
  } else if (cfg.lockedColumn) {
    out.push({ mechanic: 'lockB', necessity: 0, detail: 'booster-only bonus space (by design)' });
  }

  if ((cfg.chains ?? []).length > 0) {
    const forever = solveVariant({ lockedForever: true });
    const nec = necessityFromDelta(base, forever);
    const colored = (cfg.chains ?? []).some((c) => c >= 0);
    let detail = `forever=${forever} base=${base}`;
    let necessity = nec;
    if (colored) {
      const neutral = solveVariant({ coloredToNeutral: true });
      // colored condition adds value only if the neutral variant differs
      detail += ` neutralVariant=${neutral}`;
      if (neutral > 0 && Math.abs(neutral - base) / base < 0.05 && nec < 3) {
        necessity = Math.min(necessity, 1); // color constraint is decorative
        detail += ' (colored≈neutral)';
      }
    }
    out.push({ mechanic: colored ? 'chainC' : 'chainN', necessity, detail });
  }

  if ((cfg.tapedColumns ?? []).length > 0) {
    const normal = solveVariant({ tapeToNormal: true });
    // tape is a CONSTRAINT: removing it should make the level EASIER;
    // necessity = how much pressure the tape adds
    const delta = normal > 0 ? (base - normal) / Math.max(normal, 1) : 1;
    const necessity = delta >= 0.2 ? 3 : delta >= 0.08 ? 2 : delta > 0 ? 1 : 0;
    out.push({ mechanic: 'tape', necessity, detail: `normalVariant=${normal} base=${base}` });
  }

  if ((cfg.targetColumns ?? []).length > 0) {
    // consistent with the generator gate: the specialized buffer must be
    // needed — remove the target column entirely and re-solve
    const st = stateFor(cfg);
    const drop = (cfg.targetColumns as { col: number; color: number }[])[0].col;
    st.cols = st.cols.filter((_, i) => i !== drop);
    st.locked = st.locked > drop ? st.locked - 1 : st.locked;
    st.chainCol = st.chainCol > drop ? st.chainCol - 1 : st.chainCol;
    st.taped = new Set([...st.taped].map((t) => (t > drop ? t - 1 : t)));
    st.targets = new Map(
      [...st.targets.entries()].filter(([c]) => c !== drop).map(([c, v]) => [c > drop ? c - 1 : c, v]),
    );
    const without = solveBest(st, 1, 40000);
    out.push({ mechanic: 'target', necessity: necessityFromDelta(base, without), detail: `without=${without} base=${base}` });
  }

  const ink = cfg.columns.flat().filter((c) => c === SPECIAL_INK).length;
  if (ink > 0) {
    out.push({ mechanic: 'ink', necessity: 2, detail: `${ink} dead slots (board pressure, not a focus mechanic)` });
  }
  return out;
}

/* ---------------- difficulty index ---------------- */

function difficultyIndex(m: {
  types: number;
  totalBlocks: number;
  bu: number;
  mixing: number;
  avgDepth: number;
  keyDepth: number;
  optimal: number;
  mechs: MechReport[];
}): number {
  // component scores 0..5 per the guideline's weights (decision-risk axis is
  // approximated by access depth until the trap classifier exists)
  const board = Math.min(5, (m.types - 3) * 1.0 + m.totalBlocks / 16);
  const buffer = Math.min(5, Math.max(0, 5 - m.bu * 2)); // 2.5 BU -> 0, 0 BU -> 5
  const mixing = Math.min(5, m.mixing * 3.5 + m.avgDepth * 0.8);
  const dependency = Math.min(5, m.mechs.reduce((a, x) => a + x.necessity, 0) * 0.7 + m.keyDepth * 0.5);
  const mechanic = Math.min(5, m.mechs.reduce((a, x) => Math.max(a, x.necessity), 0) * 1.2);
  const raw =
    board * 0.1 + buffer * 0.25 + mixing * 0.2 + dependency * 0.2 + mechanic * 0.15 + Math.min(5, m.optimal / 12) * 0.1;
  return Math.round((raw / 5) * 100);
}

/* ---------------- main ---------------- */

const data = JSON.parse(readFileSync('public/levels/sorting_levels.json', 'utf8'));
const levels = data.levels as SortingLevelConfig[];
const rows: Record<string, unknown>[] = [];
const hashes = new Map<string, string>();
const dupes: string[] = [];

for (let i = 0; i < levels.length; i++) {
  const cfg = levels[i];
  const base = solveBest(stateFor(cfg), 2, 80000);
  const { avg, keyMax } = accessDepths(cfg);
  const mechs = analyzeMechanics(cfg, base);
  const flat = cfg.columns.flat();
  const types = new Set(flat.filter((c) => c >= 0)).size;
  const bu = startingBU(cfg);
  const mix = mixingScore(cfg);
  const hash = canonicalHash(cfg);
  if (hashes.has(hash)) dupes.push(`${cfg.id} == ${hashes.get(hash)}`);
  hashes.set(hash, cfg.id);

  const di = difficultyIndex({
    types,
    totalBlocks: flat.filter((c) => c >= 0).length,
    bu,
    mixing: mix,
    avgDepth: avg,
    keyDepth: keyMax,
    optimal: base,
    mechs,
  });

  rows.push({
    id: cfg.id,
    order: i + 1,
    types,
    cap: cfg.cap,
    cols: cfg.columns.length,
    bu,
    mixing: +mix.toFixed(2),
    avgDepth: +avg.toFixed(2),
    keyDepth: keyMax,
    optimal: base,
    par: cfg.par,
    di,
    mechanics: mechs.map((x) => `${x.mechanic}:${x.necessity}`).join(' '),
    mechDetails: mechs.map((x) => `${x.mechanic}[${x.detail}]`).join('; '),
  });
}

/* ---------------- report ---------------- */

const jsonOut = process.argv.includes('--json')
  ? process.argv[process.argv.indexOf('--json') + 1]
  : null;
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 2));

console.log('\n=== FAILED MECHANIC GATES (necessity 0-1 on a mechanic level) ===');
let fails = 0;
for (const r of rows) {
  const bad = String(r.mechanics)
    .split(' ')
    .filter((m) => m && !m.startsWith('ink') && !m.startsWith('lockB'))
    .filter((m) => Number(m.split(':')[1]) <= 1);
  if (bad.length) {
    fails++;
    console.log(`${r.id} (DI ${r.di}): ${bad.join(' ')}  |  ${r.mechDetails}`);
  }
}
console.log(`total: ${fails} levels fail the necessity gate`);

console.log('\n=== DISTRIBUTIONS vs guideline targets ===');
const typeCounts = new Map<number, number>();
const capCounts = new Map<number, number>();
const mechCounts = new Map<number, number>();
for (const r of rows) {
  typeCounts.set(r.types as number, (typeCounts.get(r.types as number) ?? 0) + 1);
  capCounts.set(r.cap as number, (capCounts.get(r.cap as number) ?? 0) + 1);
  const n = String(r.mechanics)
    .split(' ')
    .filter((m) => m && !m.startsWith('ink') && !m.startsWith('lockB')).length;
  mechCounts.set(n, (mechCounts.get(n) ?? 0) + 1);
}
console.log('types  actual vs target: 3:%d/5 4:%d/20 5:%d/45 6:%d/45 7:%d/25 8:%d/10',
  typeCounts.get(3) ?? 0, typeCounts.get(4) ?? 0, typeCounts.get(5) ?? 0,
  typeCounts.get(6) ?? 0, typeCounts.get(7) ?? 0, typeCounts.get(8) ?? 0);
console.log('cap    actual vs target: 3:%d/15 4:%d/123 5:%d/12',
  capCounts.get(3) ?? 0, capCounts.get(4) ?? 0, capCounts.get(5) ?? 0);
console.log('mechs  actual vs target: 0:%d/40 1:%d/65 2:%d/38 3:%d/7',
  mechCounts.get(0) ?? 0, mechCounts.get(1) ?? 0, mechCounts.get(2) ?? 0, mechCounts.get(3) ?? 0);

console.log('\n=== DI CURVE per decade (avg / min-max) ===');
for (let d = 0; d < rows.length; d += 10) {
  const slice = rows.slice(d, d + 10);
  const dis = slice.map((r) => r.di as number);
  const avgDi = dis.reduce((a, b) => a + b, 0) / dis.length;
  console.log(
    `${String(d + 1).padStart(3)}-${String(d + 10).padStart(3)}: DI ${avgDi.toFixed(0).padStart(3)} (${Math.min(...dis)}..${Math.max(...dis)})  BU ${(
      slice.reduce((a, r) => a + (r.bu as number), 0) / slice.length
    ).toFixed(1)}`,
  );
}

console.log('\n=== DUPLICATES ===');
console.log(dupes.length ? dupes.join('\n') : 'none');
