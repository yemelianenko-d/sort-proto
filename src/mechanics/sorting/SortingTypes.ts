/** Real block colors are 0..N-1; negative ids are special blocks. */
export type ColorId = number;

/** Special block ids (negative to stay JSON-friendly in level files). */
export const SPECIAL = {
  /** Ink blot: dead bottom slot. Immovable, never clears, ignored by win. */
  INK: -3,
  /** Consumed when revealed on top; unlocks the locked column. */
  KEY: -4,
} as const;

export function isSpecialColor(c: ColorId): boolean {
  return c === SPECIAL.INK || c === SPECIAL.KEY;
}

export interface BlockState {
  /** Stable identity within a level (survives moves and undo). */
  id: number;
  color: ColorId;
  hidden: boolean;
}

export type ColumnState = BlockState[];

export interface MoveResult {
  from: number;
  to: number;
  count: number;
  revealed: number[];
  readyToClear: number | null;
  /** Columns where a key block was removed this move (consumed or dissolved
   * as dead weight after the last lock opened). */
  keysConsumed: number[];
  /** Key blocks dissolved as dead weight this move, with their original slot
   * and visibility (hidden ones flip face-up before dissolving). */
  keysDissolved: { col: number; slot: number; hidden: boolean }[];
  /** Columns whose consumed key actually removed a lock this move
   * (drives the key-flies-to-the-lock animation). */
  keysApplied: number[];
  /** The formerly locked column, if a key block just opened it. */
  keyUnlocked: number | null;
  /** The seal removed by the set completed this move (value: its colour id;
   * index: its position in the seal stack), or null. */
  chainRemoved: { value: number; index: number } | null;
  /** The sealed column, if the last seal removed this move opened it. */
  unchained: number | null;
  /** Column whose tape broke after being emptied this move. */
  tapeBroken: number | null;
}

export interface SortingLevelConfig {
  id: string;
  /** Column capacity, uniform for the whole level; every color has exactly
   * `cap` copies — the arithmetic contract the player relies on. */
  cap: number;
  par: number;
  difficulty: number;
  columns: ColorId[][];
  hiddenBelowTop?: boolean;
  /** Keys needed to open the locked column (default 1). */
  lockedColumnLocks?: number;
  /** Color blocks trapped inside the locked column (visible, untouchable
   * until unlocked). Only for key-in-pile locks: forcing a booster spend
   * would be pay-to-win, so booster-only locks stay an empty bonus. */
  lockedColumnBlocks?: number[];
  /** Extra sealed column. Each entry is one seal, a colour id: only that
   * colour's completed set removes it. The column opens when no seals remain.
   * (Neutral seals were removed — every seal is colour-bound.) */
  chains?: number[];
  /** Color blocks trapped inside the chained column (visible, untouchable
   * until every chain falls) — they make opening it genuinely necessary. */
  chainedColumnBlocks?: number[];
  /** Empty columns that accept only the given color as their FIRST block. */
  targetColumns?: { col: number; color: number }[];
  lockedColumn?: boolean;
  /** Columns sealed with tape: take-only until emptied once. */
  tapedColumns?: number[];
}

export interface SortingLevelsFile {
  version: number;
  mechanic: 'sorting';
  levels: SortingLevelConfig[];
}

export interface SortingViewContract {
  /** Pointer went down on a column (fires before tap/drag resolution). */
  onColumnPress: (index: number) => void;
  /** Released without dragging — a plain tap. */
  onColumnTap: (index: number) => void;
  /** Drag threshold exceeded; return false to refuse the drag. */
  onDragStart: (index: number) => boolean;
  /** Dragged group released over `target` column (or null = empty space). */
  onDrop: (index: number, target: number | null) => void;
  rebuild(opts?: {
    selected?: number;
    landedColumn?: number;
    landedCount?: number;
    revealed?: number[];
    /** Render the top group of this column invisible (it is being dragged). */
    hideTopGroup?: number;
    /** Keep the just-removed chain visually hanging until its break plays. */
    ghostChain?: { value: number; index: number };
  }): void;
  animateClear(columnIndex: number, onDone: () => void): void;
  /** A completed set stays in place (no-clear rule); mark it done. */
  markColumnDone(column: number): void;
  shakeColumn(columnIndex: number): void;
  /** Brief target-pattern brightening on a wrong-color attempt. */
  flashTargetHint(columnIndex: number): void;
  /** Brief tape wiggle when a drop into a taped column is rejected. */
  wiggleTape(columnIndex: number): void;
  /** Dead-weight keys dissolve: hidden ones flip face-up first, then fade. */
  animateKeyDissolve(entries: { col: number; slot: number; hidden: boolean }[]): void;
  /** A dug-out key flies to the locked column; the lock pops off. */
  animateKeyToLock(fromColumn: number, lockColumn: number): void;
  /** Booster sequence on stale view state: lock pops, the key block flips
   * face-up, breaks apart, and the blocks above fall down; then onDone. */
  animateKeyBreak(
    entries: { col: number; slot: number; hidden: boolean }[],
    lockColumn: number,
    onDone: () => void,
  ): void;
  /** A spark flies from the cleared set to the chained column and the ghost
   * chain snaps in two; call after a rebuild that rendered the ghost. */
  animateChainBreak(fromColumn: number, onDone: () => void): void;
  /** The emptied taped column: the tape peels off and flutters away. */
  animateTapePeel(columnIndex: number): void;
  /** Rejected action on the chained column: the chains rattle briefly. */
  rattleChains(columnIndex: number): void;
  pulseColumn(columnIndex: number): void;
  clearPulse(): void;
}
