/** Real block colors are 0..N-1; negative ids are special blocks. */
export type ColorId = number;

/** Special block ids (negative to stay JSON-friendly in level files). */
export const SPECIAL = {
  /** Matches any color; clears as part of any set. */
  JOKER: -2,
  /** Moves only into an empty column; never clears. */
  STONE: -3,
  /** Consumed when revealed on top; unlocks the locked column. */
  KEY: -4,
} as const;

export function isSpecialColor(c: ColorId): boolean {
  return c === SPECIAL.JOKER || c === SPECIAL.STONE || c === SPECIAL.KEY;
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
  /** Columns where a revealed key block was consumed this move. */
  keysConsumed: number[];
  /** The formerly locked column, if a key block just opened it. */
  keyUnlocked: number | null;
  /** Column whose tape broke after being emptied this move. */
  tapeBroken: number | null;
}

export interface SortingLevelConfig {
  id: string;
  /** Default column capacity (used when `caps` is absent). */
  cap: number;
  par: number;
  difficulty: number;
  columns: ColorId[][];
  /** Per-column capacities (mixed heights); length === columns.length. */
  caps?: number[];
  hiddenBelowTop?: boolean;
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
  }): void;
  animateClear(columnIndex: number, onDone: () => void): void;
  shakeColumn(columnIndex: number): void;
  pulseColumn(columnIndex: number): void;
  clearPulse(): void;
}
