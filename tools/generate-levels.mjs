/**
 * Level generator for the sorting mechanic.
 *
 * Usage: `npm run levels:generate` — writes public/levels/sorting_levels.json.
 * Every layout is verified by a DFS solver, so shipped levels are always
 * solvable. The solver's found solution length also calibrates `par`.
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/levels/sorting_levels.json');

/** Difficulty curve: colors / cap / empties / features. */
const CURVE = [
  { colors: 2, cap: 3, empty: 2 },
  { colors: 3, cap: 3, empty: 2 },
  { colors: 3, cap: 4, empty: 2 },
  { colors: 4, cap: 3, empty: 2, hiddenBelowTop: true },
  { colors: 4, cap: 4, empty: 2, hiddenBelowTop: true },
  { colors: 5, cap: 3, empty: 2, hiddenBelowTop: true },
  { colors: 5, cap: 4, empty: 2, hiddenBelowTop: true, lockedColumn: true },
  { colors: 6, cap: 3, empty: 2, hiddenBelowTop: true, lockedColumn: true },
  { colors: 6, cap: 4, empty: 2, hiddenBelowTop: true, lockedColumn: true },
  { colors: 7, cap: 4, empty: 2, hiddenBelowTop: true, lockedColumn: true },
];

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** DFS solver. Returns solution move count or -1. Locked column excluded. */
function solve(startCols, cap) {
  const seen = new Set();
  let nodes = 0;
  const LIMIT = 200000;

  const settle = (cols) =>
    cols.map((c) => (c.length === cap && c.every((v) => v === c[0]) ? [] : c));
  const key = (cols) => cols.map((c) => c.join(',')).sort().join('|');

  function dfs(cols, depth) {
    if (++nodes > LIMIT) return -1;
    cols = settle(cols);
    if (cols.every((c) => c.length === 0)) return depth;
    const k = key(cols);
    if (seen.has(k)) return -1;
    seen.add(k);

    for (let i = 0; i < cols.length; i++) {
      const from = cols[i];
      if (!from.length) continue;
      const top = from[from.length - 1];
      let grp = 0;
      for (let g = from.length - 1; g >= 0 && from[g] === top; g--) grp++;
      for (let j = 0; j < cols.length; j++) {
        if (i === j) continue;
        const to = cols[j];
        if (to.length >= cap) continue;
        if (to.length && to[to.length - 1] !== top) continue;
        if (!to.length && grp === from.length) continue; // pointless move
        const n = Math.min(grp, cap - to.length);
        const next = cols.map((c) => c.slice());
        next[j] = next[j].concat(next[i].splice(next[i].length - n, n));
        const res = dfs(next, depth + 1);
        if (res >= 0) return res;
      }
    }
    return -1;
  }
  return dfs(startCols.map((c) => c.slice()), 0);
}

function generateLevel(cfg, levelIndex) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const rng = mulberry32(levelIndex * 7919 + attempt * 104729 + 13);
    const pool = [];
    for (let c = 0; c < cfg.colors; c++) for (let k = 0; k < cfg.cap; k++) pool.push(c);
    shuffle(pool, rng);
    const cols = [];
    for (let c = 0; c < cfg.colors; c++) cols.push(pool.slice(c * cfg.cap, (c + 1) * cfg.cap));
    if (cols.some((col) => col.every((v) => v === col[0]))) continue; // pre-completed
    for (let e = 0; e < cfg.empty; e++) cols.push([]);
    const solution = solve(cols, cfg.cap);
    if (solution > 0) {
      return { columns: cols, solutionMoves: solution };
    }
  }
  throw new Error(`Could not generate a solvable layout for level ${levelIndex + 1}`);
}

const levels = CURVE.map((cfg, i) => {
  const { columns, solutionMoves } = generateLevel(cfg, i);
  // par: DFS solution is an upper bound of the optimum -> a fair 3★ budget.
  const par = Math.max(cfg.colors, Math.round(solutionMoves * 1.15));
  const id = `level_${String(i + 1).padStart(3, '0')}`;
  console.log(`${id}: colors=${cfg.colors} cap=${cfg.cap} solver=${solutionMoves} par=${par}`);
  return {
    id,
    cap: cfg.cap,
    par,
    difficulty: i + 1,
    columns,
    ...(cfg.hiddenBelowTop ? { hiddenBelowTop: true } : {}),
    ...(cfg.lockedColumn ? { lockedColumn: true } : {}),
  };
});

const file = { version: 1, mechanic: 'sorting', levels };
writeFileSync(OUT, JSON.stringify(file, null, 2) + '\n');
console.log(`\nWrote ${levels.length} levels -> ${OUT}`);
