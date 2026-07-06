import { SPECIAL } from './SortingTypes';
import type { ColorId, SortingLevelConfig } from './SortingTypes';

/**
 * Runtime endless level generator (levels beyond the curated JSON).
 *
 * Deterministic per index: the same level on every device. Every layout is
 * verified by a DFS solver that understands the full rule set — jokers,
 * stones, key blocks, taped columns and mixed capacities — and `par` is
 * calibrated from the found solution.
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
  caps: number[];
  locked: number; // -1 = none
  taped: Set<number>;
}

const matches = (a: number, b: number): boolean => {
  if (a === SPECIAL.STONE || b === SPECIAL.STONE) return false;
  if (a === SPECIAL.KEY || b === SPECIAL.KEY) return false;
  return a === b || a === SPECIAL.JOKER || b === SPECIAL.JOKER;
};

function topGroup(col: ColorId[]): number {
  if (col.length === 0) return 0;
  const top = col[col.length - 1];
  if (top === SPECIAL.STONE) return 1;
  if (top === SPECIAL.KEY) return 0;
  let n = 0;
  let anchor: number = SPECIAL.JOKER;
  for (let k = col.length - 1; k >= 0; k--) {
    const c = col[k];
    if (c === SPECIAL.STONE || c === SPECIAL.KEY) break;
    if (c !== SPECIAL.JOKER) {
      if (anchor !== SPECIAL.JOKER && c !== anchor) break;
      anchor = c;
    }
    n++;
  }
  return n;
}

function groupColor(col: ColorId[]): number {
  for (let k = col.length - 1, n = topGroup(col); n > 0; k--, n--) {
    if (col[k] !== SPECIAL.JOKER) return col[k];
  }
  return SPECIAL.JOKER;
}

function isUniformFull(col: ColorId[], cap: number): boolean {
  if (col.length !== cap || cap === 0) return false;
  let color: number = SPECIAL.JOKER;
  for (const c of col) {
    if (c === SPECIAL.STONE || c === SPECIAL.KEY) return false;
    if (c !== SPECIAL.JOKER) {
      if (color !== SPECIAL.JOKER && c !== color) return false;
      color = c;
    }
  }
  return true;
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
      } else if (isUniformFull(col, st.caps[i])) {
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
    .map(
      (c, i) =>
        `${st.caps[i]}${st.taped.has(i) ? 't' : ''}${i === st.locked ? 'L' : ''}:${c.join(',')}`,
    )
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
        const color = groupColor(from);
        for (let j = 0; j < st.cols.length; j++) {
          if (i === j || j === st.locked || st.taped.has(j)) continue;
          const to = st.cols[j];
          if ((to.length === 0) !== wantEmpty) continue;
          if (to.length >= st.caps[j]) continue;
          if (color === SPECIAL.STONE) {
            if (to.length !== 0) continue;
          } else if (to.length > 0 && !matches(color, to[to.length - 1])) {
            continue;
          }
          if (to.length === 0 && grp === from.length && color !== SPECIAL.STONE && st.caps[i] >= st.caps[j]) {
            continue; // pointless full-group shuffle to an equal/smaller empty
          }
          const n = Math.min(grp, st.caps[j] - to.length);
          const next: SolverState = {
            cols: st.cols.map((c) => c.slice()),
            caps: st.caps,
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
    { cols: start.cols.map((c) => c.slice()), caps: start.caps, locked: start.locked, taped: new Set(start.taped) },
    0,
  );
}

/* ---------------- difficulty curve ---------------- */

interface LevelSpec {
  colors: number;
  mixedCaps: boolean;
  jokers: number;
  stones: number;
  keyInPile: boolean;
  locked: boolean;
  taped: number;
  hidden: boolean;
}

/** Phased introduction of mechanics, then rotating combinations that ramp. */
function specFor(index: number, rng: () => number): LevelSpec {
  const pick = (arr: number[]) => arr[(rng() * arr.length) | 0];
  const spec: LevelSpec = {
    colors: 6,
    mixedCaps: true,
    jokers: 0,
    stones: 0,
    keyInPile: false,
    locked: false,
    taped: 0,
    hidden: true,
  };
  if (index < 15) {
    // 11-15: mixed capacities intro
    spec.colors = pick([5, 6]);
  } else if (index < 20) {
    // 16-20: joker intro
    spec.jokers = 1;
  } else if (index < 25) {
    // 21-25: stone intro
    spec.stones = 1;
    spec.jokers = pick([0, 1]);
  } else if (index < 30) {
    // 26-30: key block + lock intro
    spec.locked = true;
    spec.keyInPile = true;
    spec.jokers = pick([0, 1]);
  } else if (index < 35) {
    // 31-35: taped column intro
    spec.taped = 1;
    spec.jokers = pick([0, 1]);
  } else {
    // 36-100: rotating combinations, ramping up
    const hard = index >= 60;
    spec.colors = hard ? 7 : pick([6, 7]);
    spec.jokers = pick(hard ? [0, 1] : [0, 1, 2]);
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
  // board width guard: colors + empties(2+stones) + locked column <= 10
  while (spec.colors + 2 + spec.stones + (spec.locked ? 1 : 0) > 10) spec.colors -= 1;
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

    // per-color home capacities
    const homeCaps: number[] = [];
    for (let c = 0; c < spec.colors; c++) {
      homeCaps.push(spec.mixedCaps ? (rng() < 0.5 ? 3 : 4) : 4);
    }
    // jokers substitute individual color blocks
    const counts = homeCaps.slice();
    for (let j = 0; j < spec.jokers; j++) {
      const c = (rng() * spec.colors) | 0;
      if (counts[c] > 2) counts[c] -= 1;
    }
    const pool: ColorId[] = [];
    counts.forEach((n, c) => {
      for (let k = 0; k < n; k++) pool.push(c);
    });
    for (let j = 0; j < spec.jokers; j++) pool.push(SPECIAL.JOKER);
    for (let s = 0; s < spec.stones; s++) pool.push(SPECIAL.STONE);
    if (spec.locked && spec.keyInPile) pool.push(SPECIAL.KEY);
    shuffle(pool, rng);

    // start layout: color columns (+ one slack column when specials overflow)
    const caps = homeCaps.slice();
    const overflow = pool.length - caps.reduce((a, b) => a + b, 0);
    if (overflow > 0) caps.push(Math.max(3, Math.min(4, overflow + 1)));
    const filled = caps.length;
    for (let e = 0; e < 2 + spec.stones; e++) caps.push(3);

    const cols: ColorId[][] = caps.map(() => []);
    let p = 0;
    for (let i = 0; i < filled && p < pool.length; i++) {
      while (cols[i].length < caps[i] && p < pool.length) cols[i].push(pool[p++]);
    }
    if (p < pool.length) continue; // did not fit; reshuffle

    // no column may start completed
    if (cols.some((c, i) => isUniformFull(c, caps[i]))) continue;
    // a key must not start on top of a pile (it would fire instantly)
    if (spec.keyInPile && cols.some((c) => c[c.length - 1] === SPECIAL.KEY)) continue;

    const taped: number[] = [];
    if (spec.taped > 0) {
      const ti = (rng() * filled) | 0;
      if (cols[ti].length > 1) taped.push(ti);
    }

    const solveCaps = spec.locked ? caps.concat([4]) : caps;
    const solveCols = spec.locked ? cols.map((c) => c.slice()).concat([[]]) : cols.map((c) => c.slice());
    const solution = solve({
      cols: solveCols,
      caps: solveCaps,
      locked: spec.locked ? solveCaps.length - 1 : -1,
      taped: new Set(taped),
    });
    if (solution > 0) {
      return {
        id,
        cap: 4,
        par: Math.max(spec.colors + 1, Math.round(solution * 1.15)),
        difficulty: index + 1,
        columns: cols,
        caps,
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
