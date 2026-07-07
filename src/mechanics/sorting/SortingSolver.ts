import { SPECIAL } from './SortingTypes';
import type { ColorId } from './SortingTypes';

/**
 * DFS solver for the sorting mechanic. Understands the full rule set:
 * ink blots, key blocks, multi-key locks, taped columns, target columns
 * and the chained column. Used only at level-generation time (offline and
 * for endless levels) to guarantee solvability and to calibrate `par`.
 *
 * Move generation lives in ONE place (`legalMoves` + `applyMove`); the three
 * searches (`solve`, `solveBounded`, `solvePath`) all consume it, so the
 * rules can never drift between them. `legalMoves` emits non-empty
 * destinations before empty-column dumps — a move-ordering heuristic that
 * finds solutions faster and keeps `par` deterministic.
 */

/* ---------------- state ---------------- */

export interface SolverState {
  cols: ColorId[][];
  cap: number;
  locked: number; // -1 = none
  locks: number; // keys still needed for `locked`
  chainCol: number; // -1 = none
  chains: number[]; // remaining chains: -1 neutral, >=0 color-bound
  taped: Set<number>;
  targets: Map<number, number>; // empty column -> required first color
}

export interface SolverMove {
  from: number;
  to: number;
}

const isSpecial = (c: number): boolean => c === SPECIAL.INK || c === SPECIAL.KEY;

/** Size of the liftable top group (equal colors; ink and keys never lift). */
function topGroup(col: ColorId[]): number {
  if (col.length === 0) return 0;
  const top = col[col.length - 1];
  if (top === SPECIAL.INK) return 0;
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
        if (st.locked >= 0 && --st.locks <= 0) st.locked = -1;
        changed = true;
      } else if (i !== st.locked && i !== st.chainCol && isUniformFull(col, st.cap)) {
        const setColor = col[0];
        st.cols[i] = [];
        if (st.taped.has(i)) {
          st.taped = new Set(st.taped);
          st.taped.delete(i);
        }
        if (st.chainCol >= 0) {
          let ci = st.chains.indexOf(setColor);
          if (ci === -1) ci = st.chains.indexOf(-1);
          if (ci !== -1) {
            st.chains = st.chains.slice();
            st.chains.splice(ci, 1);
            if (st.chains.length === 0) st.chainCol = -1;
          }
        }
        changed = true;
      }
    }
  }
}

function stateKey(st: SolverState): string {
  return (
    st.cols
      .map((c, i) => `${st.taped.has(i) ? 't' : ''}${i === st.locked ? 'L' : ''}${i === st.chainCol ? 'S' : ''}:${c.join(',')}`)
      .sort()
      .join('|') + `#${st.locks}/${st.chains.join(',')}`
  );
}

/* ---------------- move generation (single source of truth) ---------------- */

export function cloneState(st: SolverState): SolverState {
  return {
    cols: st.cols.map((c) => c.slice()),
    cap: st.cap,
    locked: st.locked,
    locks: st.locks,
    chainCol: st.chainCol,
    chains: st.chains.slice(),
    taped: new Set(st.taped),
    targets: st.targets,
  };
}

/** Whether the top group of `i` may legally move onto column `j`. */
function canMove(st: SolverState, i: number, j: number): boolean {
  if (i === j || j === st.locked || j === st.chainCol || st.taped.has(j)) return false;
  const from = st.cols[i];
  const grp = topGroup(from);
  if (grp === 0) return false;
  const color = from[from.length - 1];
  const to = st.cols[j];
  if (to.length >= st.cap) return false;
  const toTop = to.length > 0 ? to[to.length - 1] : null;
  if (toTop !== null && toTop !== SPECIAL.INK && toTop !== color) return false;
  if (to.length === 0) {
    const want = st.targets.get(j);
    if (want !== undefined && want !== color) return false;
    if (grp === from.length) return false; // pointless full-group shuffle to empty
  }
  return true;
}

/** All legal moves, non-empty destinations first then empty-column dumps.
 * This ordering is load-bearing: the searches rely on it for speed and for
 * deterministic `par`. */
export function legalMoves(st: SolverState): SolverMove[] {
  const out: SolverMove[] = [];
  for (const wantEmpty of [false, true]) {
    for (let i = 0; i < st.cols.length; i++) {
      if (i === st.locked || i === st.chainCol) continue; // closed: untouchable
      if (topGroup(st.cols[i]) === 0) continue;
      for (let j = 0; j < st.cols.length; j++) {
        if ((st.cols[j].length === 0) !== wantEmpty) continue;
        if (canMove(st, i, j)) out.push({ from: i, to: j });
      }
    }
  }
  return out;
}

/** Applies a move in place (top group, clipped to space) and settles. */
export function applyMove(st: SolverState, mv: SolverMove): void {
  const grp = topGroup(st.cols[mv.from]);
  const n = Math.min(grp, st.cap - st.cols[mv.to].length);
  st.cols[mv.to] = st.cols[mv.to].concat(st.cols[mv.from].splice(st.cols[mv.from].length - n, n));
  settle(st, mv.from);
}

const isSolved = (st: SolverState): boolean =>
  st.cols.every((c) => c.every((b) => b === SPECIAL.INK));

/* ---------------- searches ---------------- */

/** Depth of the first solution DFS finds (not necessarily shortest), or -1. */
export function solve(start: SolverState, nodeLimit = 50000): number {
  const seen = new Set<string>();
  let nodes = 0;

  function dfs(st: SolverState, depth: number): number {
    if (++nodes > nodeLimit) return -1;
    settle(st, null);
    if (isSolved(st)) return depth;
    const key = stateKey(st);
    if (seen.has(key)) return -1;
    seen.add(key);
    for (const mv of legalMoves(st)) {
      const next = cloneState(st);
      applyMove(next, mv);
      const res = dfs(next, depth + 1);
      if (res >= 0) return res;
    }
    return -1;
  }
  return dfs(cloneState(start), 0);
}

/** Like solve(), but rejects branches once `depth` exceeds `maxDepth`. */
export function solveBounded(start: SolverState, maxDepth: number, nodeLimit: number): number {
  if (maxDepth <= 0) return -1;
  const seen = new Map<string, number>();
  let nodes = 0;

  function dfs(st: SolverState, depth: number): number {
    if (++nodes > nodeLimit || depth > maxDepth) return -1;
    settle(st, null);
    if (isSolved(st)) return depth;
    const key = stateKey(st);
    const prev = seen.get(key);
    if (prev !== undefined && prev <= depth) return -1;
    seen.set(key, depth);
    for (const mv of legalMoves(st)) {
      const next = cloneState(st);
      applyMove(next, mv);
      const res = dfs(next, depth + 1);
      if (res >= 0) return res;
    }
    return -1;
  }
  return dfs(cloneState(start), 0);
}

/**
 * Finds a solution, then tries to shorten it with depth-bounded re-searches.
 * DFS returns *a* path, not the shortest; a couple of bounded rounds tighten
 * `par` without exploding build time.
 */
export function solveBest(start: SolverState, rounds = 2, nodeLimit = 50000): number {
  let best = solve(start, nodeLimit);
  if (best <= 0) return best;
  for (let r = 0; r < rounds; r++) {
    const better = solveBounded(start, best - 1, nodeLimit);
    if (better <= 0) break;
    best = better;
  }
  return best;
}

/** Like solve(), but returns the found move sequence (not necessarily the
 * shortest) for pressure-profile replay, or null. */
export function solvePath(start: SolverState, nodeLimit = 50000): SolverMove[] | null {
  const seen = new Set<string>();
  let nodes = 0;
  const path: SolverMove[] = [];

  function dfs(st: SolverState): boolean {
    if (++nodes > nodeLimit) return false;
    settle(st, null);
    if (isSolved(st)) return true;
    const key = stateKey(st);
    if (seen.has(key)) return false;
    seen.add(key);
    for (const mv of legalMoves(st)) {
      const next = cloneState(st);
      applyMove(next, mv);
      path.push(mv);
      if (dfs(next)) return true;
      path.pop();
    }
    return false;
  }
  return dfs(cloneState(start)) ? path : null;
}
