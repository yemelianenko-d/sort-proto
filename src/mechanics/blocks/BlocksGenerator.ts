/**
 * Controlled batch generator (Balance Spec v3 §5). The tray of 3 is generated
 * as ONE design unit, never three independent random rolls. Pipeline:
 *   pressure → desired batch class → effective weights → N candidate batches →
 *   composition filter → depth-3 solvability → reject DEAD → candidate score →
 *   weighted pick (keeps variety) → fallback recovery batch if none.
 *
 * Pure & deterministic given the injected rng — unit-tested in isolation and
 * reused by the (future) simulator. Works on a boolean occupancy grid; tile
 * colours and target assignment are handled elsewhere.
 */
import { PIECE_SHAPES, type PieceGeometry, type ShapeTier } from './blocksPieces';
import type { BatchPolicy, BlocksLevelConfig, TierMix } from './BlocksTypes';

export type SolvabilityClass = 'SOLVABLE_NOW' | 'SOLVABLE_AFTER_CLEAR' | 'DANGEROUS' | 'DEAD';

export type Occupancy = boolean[][];

/** Snapshot the model grid as a plain occupancy grid (nulls = empty). */
export function occupancyOf(grid: readonly (unknown | null)[][]): Occupancy {
  return grid.map((row) => row.map((cell) => cell !== null));
}

function legalPlacements(board: Occupancy, geo: PieceGeometry): { row: number; col: number }[] {
  const rows = board.length;
  const cols = board[0].length;
  const out: { row: number; col: number }[] = [];
  for (let r = 0; r + geo.rows <= rows; r++) {
    for (let c = 0; c + geo.cols <= cols; c++) {
      if (geo.cells.every(({ r: dr, c: dc }) => !board[r + dr][c + dc])) out.push({ row: r, col: c });
    }
  }
  return out;
}

function hasAnyPlacement(board: Occupancy, geo: PieceGeometry): boolean {
  const rows = board.length;
  const cols = board[0].length;
  for (let r = 0; r + geo.rows <= rows; r++) {
    for (let c = 0; c + geo.cols <= cols; c++) {
      if (geo.cells.every(({ r: dr, c: dc }) => !board[r + dr][c + dc])) return true;
    }
  }
  return false;
}

/** Place a piece and apply full-line clears; returns a fresh occupancy grid. */
function applyPlacement(board: Occupancy, geo: PieceGeometry, row: number, col: number): Occupancy {
  const rows = board.length;
  const cols = board[0].length;
  const next = board.map((r) => r.slice());
  geo.cells.forEach(({ r, c }) => (next[row + r][col + c] = true));
  const fullRows: number[] = [];
  const fullCols: number[] = [];
  for (let r = 0; r < rows; r++) if (next[r].every(Boolean)) fullRows.push(r);
  for (let c = 0; c < cols; c++) if (next.every((rr) => rr[c])) fullCols.push(c);
  fullRows.forEach((r) => next[r].fill(false));
  fullCols.forEach((c) => next.forEach((rr) => (rr[c] = false)));
  return next;
}

export interface SolvabilityResult {
  klass: SolvabilityClass;
  /** Number of distinct first placements (legal moves) across the batch. */
  legalFirstMoves: number;
  /** Whether the completed proof search exhausted the node budget. */
  budgetExhausted: boolean;
}

/**
 * Depth-3 solvability of a 3-piece batch. Searches every use-order and every
 * legal placement (with clears) for a full sequence, under a node budget. If
 * the search COMPLETES without finding one → DEAD (safe to reject). If the
 * budget is hit first → we never claim DEAD (classified DANGEROUS) so a
 * possibly-solvable batch is never rejected.
 */
export function evaluateSolvability(
  board: Occupancy,
  pieces: PieceGeometry[],
  nodeBudget = 40000,
): SolvabilityResult {
  let nodes = 0;
  let exhausted = false;
  let solvable = false;

  const dfs = (b: Occupancy, remaining: PieceGeometry[]): boolean => {
    if (remaining.length === 0) return true;
    for (let i = 0; i < remaining.length; i++) {
      const geo = remaining[i];
      const rest = remaining.slice(0, i).concat(remaining.slice(i + 1));
      const spots = legalPlacements(b, geo);
      for (const spot of spots) {
        if (++nodes > nodeBudget) {
          exhausted = true;
          return false;
        }
        if (dfs(applyPlacement(b, geo, spot.row, spot.col), rest)) return true;
      }
    }
    return false;
  };

  solvable = dfs(board, pieces);
  const legalFirstMoves = pieces.reduce((n, g) => n + legalPlacements(board, g).length, 0);

  let klass: SolvabilityClass;
  if (solvable) {
    // NOW when all three fit the initial board independently; otherwise a clear
    // is needed to open space for at least one piece (AFTER_CLEAR).
    klass = pieces.every((g) => hasAnyPlacement(board, g)) ? 'SOLVABLE_NOW' : 'SOLVABLE_AFTER_CLEAR';
    if (legalFirstMoves <= pieces.length) klass = 'DANGEROUS'; // very tight corridor
  } else {
    klass = exhausted ? 'DANGEROUS' : 'DEAD';
  }
  return { klass, legalFirstMoves, budgetExhausted: exhausted };
}

/* ---------------- weighting & rolling ---------------- */

const DEFAULT_TIER_MIX: TierMix = { flexible: 0.4, normal: 0.4, demanding: 0.18, killer: 0.02 };

function tierMultiplier(tier: ShapeTier, mix: TierMix): number {
  switch (tier) {
    case 'FLEXIBLE':
      return mix.flexible;
    case 'NORMAL':
      return mix.normal;
    case 'DEMANDING':
      return mix.demanding;
    case 'KILLER':
      return mix.killer;
  }
}

export interface RosterEntry {
  shape: string;
  weight: number;
  color?: number;
}

/**
 * Effective per-shape weights: baseWeight × tierMultiplier × cooldown penalty.
 * `recent` is the list of recently drawn shape ids (most recent last); a shape
 * seen within `repeatCooldown` draws is damped so families don't clump.
 */
export function effectiveWeights(
  roster: RosterEntry[],
  mix: TierMix,
  recent: string[],
  repeatCooldown: number,
): { shape: string; weight: number }[] {
  const window = recent.slice(-repeatCooldown);
  return roster.map((e) => {
    const geo = PIECE_SHAPES[e.shape];
    const tierMul = geo ? tierMultiplier(geo.tier, mix) : 1;
    const cooldownMul = window.includes(e.shape) ? 0.35 : 1;
    return { shape: e.shape, weight: Math.max(0, e.weight) * tierMul * cooldownMul };
  });
}

function weightedPick<T extends { weight: number }>(items: T[], roll: number): T {
  const total = items.reduce((s, it) => s + it.weight, 0);
  if (total <= 0) return items[items.length - 1];
  let r = roll * total;
  for (const it of items) {
    r -= it.weight;
    if (r < 0) return it;
  }
  return items[items.length - 1];
}

/* ---------------- candidate scoring ---------------- */

function familyDiversity(pieces: PieceGeometry[]): number {
  return new Set(pieces.map((p) => p.family)).size; // 1..3
}

function candidateScore(pieces: PieceGeometry[], sol: SolvabilityResult): number {
  let score = 0;
  score += familyDiversity(pieces) * 2; // reward variety
  score += Math.min(sol.legalFirstMoves, 12) * 0.3; // reward breathing room
  // a mix of orientations reads better than three identical lines
  const orient = new Set(pieces.map((p) => `${p.rows}x${p.cols}`)).size;
  score += orient * 1.5;
  if (sol.klass === 'SOLVABLE_AFTER_CLEAR') score += 1.5; // the desired puzzle class
  if (sol.klass === 'DANGEROUS') score -= 1;
  return score;
}

/* ---------------- the pipeline ---------------- */

export interface GeneratedBatch {
  shapes: string[];
  klass: SolvabilityClass;
}

/**
 * Generate one batch of `traySize` shapes for the current board. Uses the
 * level's batchPolicy (tierMix, cooldown, candidateAttempts, solvabilityPolicy)
 * and the injected rng (a `() => number` in [0,1)). Never returns a DEAD batch:
 * falls back to the most flexible legal shapes if every candidate is dead.
 */
export function generateBatch(
  board: Occupancy,
  config: BlocksLevelConfig,
  rngPieces: () => number,
  recent: string[],
  traySize: number,
  batchIndex = 0,
): GeneratedBatch {
  const policy: BatchPolicy = config.batchPolicy ?? {};

  // Authored opening (learnable first moves, guide: the first batch must
  // never be awkward): the level script fully dictates the first N batches.
  const opening = policy.openingBatches?.[batchIndex];
  if (opening) {
    return { shapes: opening.slice(0, traySize), klass: 'SOLVABLE_NOW' };
  }
  const mix = policy.tierMix ?? DEFAULT_TIER_MIX;
  const cooldown = policy.repeatCooldown ?? 2;
  const attempts = policy.candidateAttempts ?? 30;
  const solvPolicy = policy.solvabilityPolicy;
  const roster = config.pieces;

  const weights = effectiveWeights(roster, mix, recent, cooldown);

  const rollBatch = (): string[] => {
    const shapes: string[] = [];
    const fam: Record<string, number> = {};
    const maxSameFamily = policy.maxSameFamilyPerBatch ?? 3;
    for (let i = 0; i < traySize; i++) {
      // re-roll a few times to respect the same-family cap without infinite loop
      let pick = weightedPick(weights, rngPieces());
      for (let t = 0; t < 4; t++) {
        const f = PIECE_SHAPES[pick.shape]?.family ?? 'X';
        if ((fam[f] ?? 0) < maxSameFamily) break;
        pick = weightedPick(weights, rngPieces());
      }
      const f2 = PIECE_SHAPES[pick.shape]?.family ?? 'X';
      fam[f2] = (fam[f2] ?? 0) + 1;
      shapes.push(pick.shape);
    }
    return shapes;
  };

  // Endless/arcade: no solvability guarantee. Draw one honest weighted-random
  // batch (tierMix + family cap still shape variety) and ship it — the board is
  // allowed to dead-end, which is exactly what makes the survival loop tense.
  if (policy.honest) {
    return { shapes: rollBatch(), klass: 'SOLVABLE_NOW' };
  }

  interface Cand {
    shapes: string[];
    sol: SolvabilityResult;
    score: number;
  }
  const candidates: Cand[] = [];
  for (let i = 0; i < attempts; i++) {
    const shapes = rollBatch();
    const geos = shapes.map((s) => PIECE_SHAPES[s]);
    if (geos.some((g) => !g)) continue;
    const sol = evaluateSolvability(board, geos);
    if (sol.klass === 'DEAD') continue; // never ship a dead batch
    if (solvPolicy && solvPolicy[sol.klass] <= 0) continue; // class disallowed by level
    candidates.push({ shapes, sol, score: candidateScore(geos, sol) });
  }

  if (candidates.length === 0) {
    return { shapes: fallbackRecovery(board, roster, traySize), klass: 'SOLVABLE_NOW' };
  }

  // weight the pick by candidateScore × the class share the level wants, so we
  // keep variety instead of always taking the single best candidate.
  const picks = candidates.map((c) => ({
    ...c,
    weight: Math.max(0.001, c.score) * (solvPolicy ? Math.max(0.001, solvPolicy[c.sol.klass]) : 1),
  }));
  const chosen = weightedPick(picks, rngPieces());
  return { shapes: chosen.shapes, klass: chosen.sol.klass };
}

/** Most flexible shapes that fit the board right now (documented fallback). */
function fallbackRecovery(board: Occupancy, roster: RosterEntry[], traySize: number): string[] {
  const fitting = roster
    .map((e) => e.shape)
    .filter((s) => PIECE_SHAPES[s] && hasAnyPlacement(board, PIECE_SHAPES[s]))
    .sort((a, b) => PIECE_SHAPES[b].flexibility - PIECE_SHAPES[a].flexibility);
  const base = fitting.length > 0 ? fitting : ['S1'];
  const out: string[] = [];
  for (let i = 0; i < traySize; i++) out.push(base[i % base.length]);
  return out;
}

export const _internals = { legalPlacements, applyPlacement, hasAnyPlacement };
