/**
 * Deterministic scoring + combo for the blocks mechanic (Balance Spec v3 §9).
 * Pure functions only — the model owns the combo chain state; this module owns
 * the formulas so they are unit-tested in isolation and reused by the (future)
 * simulator. Score is computed in BOTH goal modes for telemetry, but only a
 * SCORE level uses it as the win condition.
 *
 * Rules (v3 source of truth, changeable only via `balanceVersion`):
 *   placement = placedTiles × placementPerTile         (target tiles score 0)
 *   L         = rows + columns cleared by one placement
 *   baseClear = clearBasePoints × L × (L + 1) / 2       (triangular: 10/30/60/100/150)
 *   combo     = consecutive moves that cleared ≥1 line  (no clear resets; a new
 *               batch does NOT reset)
 *   multiplier= min(1 + comboStep × (chain − 1), comboMax)  — clear score only
 *   clear     = round_half_up(baseClear × multiplier)
 *   move      = placement + clear
 */

export interface ScorePolicy {
  placementPerTile: number;
  clearBasePoints: number;
  comboStep: number;
  comboMax: number;
}

/**
 * Combo = chain length (reference-calibrated): chain 1 → ×1, 2 → ×2, 3 → ×3…
 * capped at ×8. Six chained single-line clears = 10+20+…+60 = 210 vs 60
 * unchained — keeping the chain alive IS the score-mode strategy. Score
 * targets across the campaign are calibrated against this compounding.
 */
export const DEFAULT_SCORE_POLICY: ScorePolicy = {
  placementPerTile: 1,
  clearBasePoints: 10,
  comboStep: 1.0,
  comboMax: 8.0,
};

/** Triangular base clear score for `lines` cleared by one placement. */
export function baseClearScore(lines: number, policy: ScorePolicy = DEFAULT_SCORE_POLICY): number {
  return (policy.clearBasePoints * lines * (lines + 1)) / 2;
}

/** Combo multiplier for a chain length (chain 0/1 → ×1.0, capped at comboMax). */
export function comboMultiplier(chain: number, policy: ScorePolicy = DEFAULT_SCORE_POLICY): number {
  return Math.min(1 + policy.comboStep * Math.max(chain - 1, 0), policy.comboMax);
}

export interface MoveScore {
  /** Points from the placed tiles (area). */
  placement: number;
  /** Combo-multiplied clear score (HALF_UP), 0 when no line cleared. */
  clear: number;
  /** placement + clear. */
  total: number;
  /** Combo chain AFTER this move (reset to 0 if it cleared nothing). */
  comboChain: number;
  /** Multiplier applied to the clear score this move. */
  multiplier: number;
}

/**
 * Score one placement and advance the combo chain. `prevChain` is the chain
 * before this move; a move with no clear resets it to 0.
 */
export function scoreMove(
  placedTiles: number,
  lines: number,
  prevChain: number,
  policy: ScorePolicy = DEFAULT_SCORE_POLICY,
): MoveScore {
  const placement = placedTiles * policy.placementPerTile;
  const comboChain = lines > 0 ? prevChain + 1 : 0;
  const multiplier = comboMultiplier(comboChain, policy);
  const clear = lines > 0 ? Math.floor(baseClearScore(lines, policy) * multiplier + 0.5) : 0;
  return { placement, clear, total: placement + clear, comboChain, multiplier };
}
