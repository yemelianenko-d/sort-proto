import { SPECIAL } from './SortingTypes';
import type { ColorId, SortingLevelConfig } from './SortingTypes';

/**
 * Runtime endless level generator (levels beyond the curated JSON).
 *
 * Deterministic per index: the same level on every device. Every layout is
 * verified by a DFS solver that understands the full rule set — stones,
 * key blocks and taped columns — and `par` is calibrated from the found
 * solution.
 *
 * Invariant of the whole game (never violated by generated levels): every
 * color has exactly `cap` copies and every column has the same capacity, so
 * a collected set never orphans blocks and the player never has to guess.
 */

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ---------------- solver ---------------- */

interface SolverState {
  cols: ColorId[][];
  cap: number;
  locked: number; // -1 = none
  taped: Set<number>;
}

const isSpecial = (c: number): boolean => c === SPECIAL.STONE || c === SPECIAL.KEY;

/** Size of the liftable top group (equal colors; stone moves alone). */
function topGroup(col: ColorId[]): number {
  if (col.length === 0) return 0;
  const top = col[col.length - 1];
  if (top === SPECIAL.STONE) return 1;
  if (top === SPECIAL.KEY) return 0;
  let n = 0;
  for (let k = col.length - 1; k >= 0 && col[k] === top; k--) n++;
  return n;
}

function isUniformFull(col: ColorId[], cap: number): boolean {
  if (col.length !== cap || cap === 0) return false;
  const first = col[0];
  if (isSpecial(first)) return false;
  return col.every((c) => c === first);
}

/** Reveal-free settlement: consume keys, break tape, auto-clear full sets. */
function settle(st: SolverState, emptied: number | null): void {
  if (emptied !== null && st.taped.has(emptied) && st.cols[emptied].length === 0) {
    st.taped = new Set(st.taped);
    st.taped.delete(emptied);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < st.cols.length; i++) {
      const col = st.cols[i];
      const top = col[col.length - 1];
      if (top === SPECIAL.KEY) {
        st.cols[i] = col.slice(0, -1);
        if (st.locked >= 0) st.locked = -1;
        changed = true;
      } else if (isUniformFull(col, st.cap)) {
        st.cols[i] = [];
        if (st.taped.has(i)) {
          st.taped = new Set(st.taped);
          st.taped.delete(i);
        }
        changed = true;
      }
    }
  }
}

function stateKey(st: SolverState): string {
  return st.cols
    .map((c, i) => `${st.taped.has(i) ? 't' : ''}${i === st.locked ? 'L' : ''}:${c.join(',')}`)
    .sort()
    .join('|');
}

function solve(start: SolverState, nodeLimit = 50000): number {
  const seen = new Set<string>();
  let nodes = 0;

  function dfs(st: SolverState, depth: number): number {
    if (++nodes > nodeLimit) return -1;
    settle(st, null);
    if (st.cols.every((c) => c.every((b) => b === SPECIAL.STONE))) return depth;
    const key = stateKey(st);
    if (seen.has(key)) return -1;
    seen.add(key);

    // matching non-empty targets first, empty-column dumps last
    for (const wantEmpty of [false, true]) {
      for (let i = 0; i < st.cols.length; i++) {
        const from = st.cols[i];
        const grp = topGroup(from);
        if (grp === 0) continue;
        const color = from[from.length - 1];
        for (let j = 0; j < st.cols.length; j++) {
          if (i === j || j === st.locked || st.taped.has(j)) continue;
          const to = st.cols[j];
          if ((to.length === 0) !== wantEmpty) continue;
          if (to.length >= st.cap) continue;
          if (color === SPECIAL.STONE) {
            if (to.length !== 0) continue;
          } else if (to.length > 0 && to[to.length - 1] !== color) {
            continue;
          }
          if (to.length === 0 && grp === from.length && color !== SPECIAL.STONE) {
            continue; // pointless full-group shuffle to another empty
          }
          const n = Math.min(grp, st.cap - to.length);
          const next: SolverState = {
            cols: st.cols.map((c) => c.slice()),
            cap: st.cap,
            locked: st.locked,
            taped: st.taped,
          };
          next.cols[j] = next.cols[j].concat(next.cols[i].splice(next.cols[i].length - n, n));
          settle(next, i);
          const res = dfs(next, depth + 1);
          if (res >= 0) return res;
        }
      }
    }
    return -1;
  }
  return dfs(
    { cols: start.cols.map((c) => c.slice()), cap: start.cap, locked: start.locked, taped: new Set(start.taped) },
    0,
  );
}

/* ---------------- difficulty curve ---------------- */

interface LevelSpec {
  colors: number;
  cap: number;
  stones: number;
  keyInPile: boolean;
  locked: boolean;
  taped: number;
  hidden: boolean;
}

/**
 * Phased introduction of mechanics, then rotating combinations that ramp.
 * 11-15 pure base curve, stone from 16, key block from 21, tape from 31.
 */
function specFor(index: number, rng: () => number): LevelSpec {
  const pick = <T>(arr: T[]): T => arr[(rng() * arr.length) | 0];
  const spec: LevelSpec = {
    colors: 6,
    cap: 4,
    stones: 0,
    keyInPile: false,
    locked: false,
    taped: 0,
    hidden: true,
  };
  if (index < 15) {
    // 11-15: pure base ramp — more colors, denser boards, no new mechanics
    spec.colors = index < 12 ? 6 : 7;
    spec.cap = pick([3, 4]);
    spec.locked = rng() < 0.4; // lock is already known from levels 7-10
  } else if (index < 20) {
    // 16-20: stone intro
    spec.colors = pick([6, 7]);
    spec.stones = 1;
  } else if (index < 25) {
    // 21-25: key block + lock intro
    spec.colors = pick([6, 7]);
    spec.locked = true;
    spec.keyInPile = true;
  } else if (index < 30) {
    // 26-30: stone + key combinations ramping
    spec.colors = 7;
    spec.stones = pick([1, 2]);
    spec.locked = rng() < 0.6;
    spec.keyInPile = spec.locked;
  } else if (index < 35) {
    // 31-35: taped column intro
    spec.colors = pick([6, 7]);
    spec.taped = 1;
    spec.stones = pick([0, 1]);
  } else {
    // 36-100: rotating combinations, ramping up
    const hard = index >= 60;
    spec.colors = hard ? 7 : pick([6, 7]);
    spec.cap = hard ? 4 : pick([3, 4]);
    spec.stones = pick(hard ? [0, 1, 2] : [0, 1]);
    spec.locked = rng() < 0.45;
    spec.keyInPile = spec.locked && rng() < 0.7;
    spec.taped = rng() < (hard ? 0.4 : 0.25) ? 1 : 0;
    if (index % 10 === 9) {
      // breathers before each new decade
      spec.colors = Math.max(5, spec.colors - 1);
      spec.stones = 0;
      spec.taped = 0;
    }
  }
  // board width guard: colors + slack + empties(2+stones) + lock <= 11
  const width = () =>
    spec.colors + (spec.stones + (spec.keyInPile ? 1 : 0) > 0 ? 1 : 0) + 2 + spec.stones + (spec.locked ? 1 : 0);
  while (width() > 11) spec.colors -= 1;
  return spec;
}

/* ---------------- generation ---------------- */

/** Guaranteed-solvable trivial layout (emergency fallback). */
function fallbackColumns(colors: number, cap: number): ColorId[][] {
  const cols: ColorId[][] = [];
  for (let c = 0; c < colors; c++) cols.push(Array<ColorId>(cap).fill(c));
  const a = cols[0].pop() as ColorId;
  const b = cols[1].pop() as ColorId;
  cols[0].push(b);
  cols[1].push(a);
  cols.push([], []);
  return cols;
}

export function generateSortingLevel(index: number): SortingLevelConfig {
  const id = `level_${String(index + 1).padStart(3, '0')}`;

  for (let attempt = 0; attempt < 60; attempt++) {
    const rng = mulberry32(index * 7919 + attempt * 104729 + 13);
    const spec = specFor(index, rng);

    // every color has exactly `cap` copies — the core arithmetic invariant
    const pool: ColorId[] = [];
    for (let c = 0; c < spec.colors; c++) {
      for (let k = 0; k < spec.cap; k++) pool.push(c);
    }
    for (let s = 0; s < spec.stones; s++) pool.push(SPECIAL.STONE);
    if (spec.locked && spec.keyInPile) pool.push(SPECIAL.KEY);
    shuffle(pool, rng);

    // start layout: `colors` full columns + slack column for specials
    const specials = spec.stones + (spec.locked && spec.keyInPile ? 1 : 0);
    const filled = spec.colors + (specials > 0 ? 1 : 0);
    const cols: ColorId[][] = [];
    let p = 0;
    for (let i = 0; i < filled; i++) {
      const take = Math.min(spec.cap, pool.length - p);
      cols.push(pool.slice(p, p + take));
      p += take;
    }
    if (p < pool.length) continue; // did not fit; reshuffle
    for (let e = 0; e < 2 + spec.stones; e++) cols.push([]);

    // no column may start completed
    if (cols.some((c) => isUniformFull(c, spec.cap))) continue;
    // a key must not start on top of a pile (it would fire instantly)
    if (spec.keyInPile && cols.some((c) => c[c.length - 1] === SPECIAL.KEY)) continue;

    const taped: number[] = [];
    if (spec.taped > 0) {
      const ti = (rng() * filled) | 0;
      if (cols[ti].length > 1) taped.push(ti);
    }

    const solveCols = cols.map((c) => c.slice());
    if (spec.locked) solveCols.push([]);
    const solution = solve({
      cols: solveCols,
      cap: spec.cap,
      locked: spec.locked ? solveCols.length - 1 : -1,
      taped: new Set(taped),
    });
    if (solution > 0) {
      return {
        id,
        cap: spec.cap,
        par: Math.max(spec.colors + 1, Math.round(solution * 1.15)),
        difficulty: index + 1,
        columns: cols,
        hiddenBelowTop: spec.hidden,
        lockedColumn: spec.locked,
        tapedColumns: taped.length ? taped : undefined,
      };
    }
  }

  return {
    id,
    cap: 4,
    par: 8,
    difficulty: index + 1,
    columns: fallbackColumns(6, 4),
    hiddenBelowTop: false,
    lockedColumn: false,
  };
}
