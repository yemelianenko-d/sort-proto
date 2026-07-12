/** Tile colors are 0..7 (same families as the sorting BLOCK_STYLES). */
export type TileColor = number;

/** Special-symbol id (0..4): compass, triangle, protractor, ruler, pencil.
 * A cell carrying one is a "special tile" collected when its line clears. */
export type SpecialSymbol = number;

export const SPECIAL_SYMBOL_COUNT = 5;

export interface GridPos {
  row: number;
  col: number;
}

export interface BlocksCell {
  color: TileColor;
  /** Part of the level's start layout. */
  initial: boolean;
  /** Special symbol carried by this cell (collect goal), if any. */
  special?: SpecialSymbol;
}

/** Win condition of a level. `score` (reach a target) and `collect` (quotas of
 * special symbols) are campaign goals. `endless` is the arcade mode: no target,
 * you never "win" — you chase a high score until no piece fits (game over). */
export type BlocksGoal =
  | { type: 'score'; target: number }
  | { type: 'collect'; quotas: { symbol: SpecialSymbol; count: number }[] }
  | { type: 'endless' };

export interface BlocksPoolEntry {
  /** Shape id from the PIECE_SHAPES catalog (see blocksPieces.ts). */
  shape: string;
  /** Relative spawn weight in the random tray refill. */
  weight: number;
  /** Fixed tile color; omitted = random color per spawn. */
  color?: TileColor;
}

/** A preset special tile sitting on the board from the start. */
export interface BoardSpecial {
  row: number;
  col: number;
  symbol: SpecialSymbol;
}

/* ---------------- balance policies (Balance Spec v3) ---------------- */

/** Difficulty band per the Level Design guide (§2, §9.5). */
export type DifficultyBand = 'TUTORIAL' | 'EASY' | 'NORMAL' | 'HARD' | 'PEAK';

/** Fractions per tier (should sum ≈ 1). */
export interface TierMix {
  flexible: number;
  normal: number;
  demanding: number;
  killer: number;
}

/** Fractions per batch class (should sum ≈ 1). */
export interface BatchClassWeights {
  recovery: number;
  normal: number;
  pressure: number;
}

/** Allowed share per solvability class; DEAD is always 0 in production. */
export interface SolvabilityPolicy {
  SOLVABLE_NOW: number;
  SOLVABLE_AFTER_CLEAR: number;
  DANGEROUS: number;
  DEAD: number;
}

/** How a level generates its batches (Balance Spec §4.1, §5). Optional — a
 * level without a batchPolicy uses the simple weighted draw. */
export interface BatchPolicy {
  /** Explicit first batches (shape-id triples) for a learnable opening. */
  openingBatches?: string[][];
  tierMix?: TierMix;
  batchClassWeights?: BatchClassWeights;
  candidateAttempts?: number;
  maxPressureStreak?: number;
  maxSameFamilyPerBatch?: number;
  repeatCooldown?: number;
  solvabilityPolicy?: SolvabilityPolicy;
  /** Endless/arcade: skip the solvability guarantee entirely — draw honest
   * weighted-random pieces so the board can genuinely dead-end (real game
   * over). Campaign levels leave this off and stay guaranteed-solvable. */
  honest?: boolean;
}

/** Per-target-type economy (Balance Spec §7.3). */
export interface TargetPolicyEntry {
  symbol: SpecialSymbol;
  presetCount?: number;
  generatedBudget: number;
  baseSpawnWeight?: number;
  pityLimitBatches?: number;
  minFutureSupplySafety?: number;
}

export interface TargetPolicy {
  targetBatchChance?: number;
  urgencyStrength?: number;
  maxTargetsPerPiece?: number;
  maxTargetsPerBatch?: number;
  perTarget: TargetPolicyEntry[];
}

/** Restart / opening-repeat policy for reproducibility (Balance Spec §8). */
export interface RestartPolicy {
  openingRepeatAttempts?: number;
  variationBuckets?: { attempts: [number, number]; bucket: string }[];
}

/** Optional per-level scoring override (else DEFAULT_SCORE_POLICY). */
export interface ScorePolicyConfig {
  placementPerTile?: number;
  clearBasePoints?: number;
  comboStep?: number;
  comboMax?: number;
}

export interface BlocksLevelConfig {
  id: string;
  rows: number;
  cols: number;
  /** Start layout, rows top→bottom: '.' = empty, '0'..'7' = color digit. */
  board: string[];
  goal: BlocksGoal;
  /** Piece roster + weights (spec's pieceRoster; `weight` == baseWeight). */
  pieces: BlocksPoolEntry[];
  /** Preset special tiles on the board (collect goal only). */
  specials?: BoardSpecial[];
  /** Pieces placed for the 3-star rating (same role as the sorting par). */
  par: number;
  difficulty: number;

  /* --- optional v3 balance metadata / policies (additive) --- */
  difficultyBand?: DifficultyBand;
  /** Free-form archetype tag (e.g. "Target Hunt", "Big Pieces Score"). */
  archetype?: string;
  batchPolicy?: BatchPolicy;
  targetPolicy?: TargetPolicy;
  restartPolicy?: RestartPolicy;
  scorePolicy?: ScorePolicyConfig;
  /** Balance revision — bumped on any live tuning change (Spec §8.3). */
  balanceVersion?: number;
}

export interface BlocksLevelsFile {
  version: number;
  mechanic: 'blocks';
  levels: BlocksLevelConfig[];
}

/** A piece waiting in one of the tray slots. */
export interface TrayPiece {
  shape: string;
  color: TileColor;
  /** Cells of the piece carrying special symbols (collect goal). A piece can
   * carry several — the reference's late-game target flow depends on it. */
  specials?: { cellIndex: number; symbol: SpecialSymbol }[];
}

export interface ClearedCell extends GridPos {
  color: TileColor;
  initial: boolean;
  special?: SpecialSymbol;
}

export interface PlaceResult {
  /** Cells the piece just occupied (before line clears). */
  placed: GridPos[];
  color: TileColor;
  clearedRows: number[];
  clearedCols: number[];
  /** Every cell removed by this move's line clears (cross cells deduped). */
  clearedCells: ClearedCell[];
  /** Special symbols collected by this move (one entry per collected tile). */
  collected: SpecialSymbol[];
  /** Score gained by this move (placement + combo-multiplied clear score). */
  gained: number;
  /** Combo chain after this move (0 if it cleared nothing). */
  comboChain: number;
  /** Combo multiplier applied to this move's clear score. */
  comboMultiplier: number;
  /** The tray ran empty and was refilled after this move. */
  refilled: boolean;
  won: boolean;
  /** No tray piece fits anywhere (checked only when not won). */
  failed: boolean;
}

/** HUD-friendly snapshot of the goal state. */
export type GoalProgress =
  | { type: 'score'; score: number; target: number }
  | { type: 'collect'; quotas: { symbol: SpecialSymbol; collected: number; count: number }[] }
  | { type: 'endless'; score: number };

/**
 * Render/animation surface of the mechanic. The controller depends on this
 * contract only; unit tests drive it with a StubView.
 */
export interface BlocksViewContract {
  /** Pointer went down on tray slot `slot`; return false to refuse the drag. */
  onPieceDragStart: (slot: number) => boolean;
  /**
   * Dragged piece released with its anchor (top-left piece cell) over `cell`,
   * or null when off the board. Return true when the drop was accepted —
   * a refused drop makes the view float the piece back to its tray slot.
   */
  onPieceDrop: (slot: number, cell: GridPos | null) => boolean;
  /** Redraw board + tray from the model state. */
  rebuild(opts?: {
    /** Cells that just received a piece (landing pop animation). */
    placedCells?: GridPos[];
    /** The tray was just refilled (new pieces pop in). */
    refilled?: boolean;
  }): void;
  /** Cleared cells fade out (they are already gone in the model). The
   * optional pieceColor drives the reference-style flash: a single line
   * flashes in the placed piece's colour, a multi-line region sweeps a
   * rainbow across its columns. */
  animateLineClear(cells: ClearedCell[], onDone: () => void, pieceColor?: TileColor): void;
  /** Rejected drop feedback: brief board nudge. */
  shakeBoard(): void;
  destroy(): void;
}
