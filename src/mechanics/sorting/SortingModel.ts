import { SPECIAL } from './SortingTypes';
import type { BlockState, ColumnState, MoveResult, SortingLevelConfig } from './SortingTypes';

interface Snapshot {
  columns: ColumnState[];
  lockedColumn: number | null;
  taped: number[];
  moves: number;
}

/**
 * Pure gameplay state of the sorting mechanic. No rendering, no platform,
 * no events — fully deterministic and unit-testable.
 *
 * Rules:
 *  - tap lifts the top group of equal revealed blocks;
 *  - a group drops onto an empty column or a matching top;
 *  - an ink blot is dead space at the bottom of a column: it cannot be
 *    lifted or moved, never clears, and any color may be dropped onto it
 *    (the column just has fewer playable slots);
 *  - a key block, once revealed on top, is consumed and opens the lock;
 *  - a taped column is take-only until emptied once (then the tape breaks);
 *  - a full column of one color clears;
 *  - the level is won when only ink remains on the board.
 */
export class SortingModel {
  readonly cap: number;
  readonly levelId: string;
  readonly par: number;

  columns: ColumnState[];
  lockedColumn: number | null = null;
  moves = 0;

  private taped = new Set<number>();
  private history: Snapshot[] = [];
  /** Booster effects are permanent: undo reverts moves only. */
  private revealedByLens = new Set<number>();
  private keyUsed = false;

  constructor(config: SortingLevelConfig) {
    this.cap = config.cap;
    this.levelId = config.id;
    this.par = config.par;

    let nextId = 0;
    this.columns = config.columns.map((col) =>
      col.map((color, i): BlockState => {
        const isTop = i === col.length - 1;
        // ink is a visible property of the column, never a hidden block
        const hidden = config.hiddenBelowTop === true && !isTop && color !== SPECIAL.INK;
        return { id: nextId++, color, hidden };
      }),
    );
    (config.tapedColumns ?? []).forEach((i) => this.taped.add(i));
    if (config.lockedColumn) {
      this.columns.push([]);
      this.lockedColumn = this.columns.length - 1;
    }
  }

  /* ---------------- queries ---------------- */

  capacity(i: number): number {
    void i; // uniform: every column shares the level cap
    return this.cap;
  }

  isTaped(i: number): boolean {
    return this.taped.has(i);
  }

  /** True when `mover` may land on top of `resting`. */
  private matches(mover: number, resting: number): boolean {
    if (mover === SPECIAL.KEY || resting === SPECIAL.KEY) return false;
    if (resting === SPECIAL.INK) return true; // ink top is an open surface
    return mover === resting;
  }

  /** Color of the liftable top group. */
  private groupColor(i: number): number {
    const col = this.columns[i];
    return col[col.length - 1].color;
  }

  /** Size of the liftable group on top of column `i` (0 if hidden/empty). */
  topGroup(i: number): number {
    const col = this.columns[i];
    if (!col || col.length === 0) return 0;
    const top = col[col.length - 1];
    if (top.hidden) return 0;
    if (top.color === SPECIAL.INK) return 0; // ink is immovable
    if (top.color === SPECIAL.KEY) return 0; // keys consume themselves
    let n = 0;
    for (let k = col.length - 1; k >= 0; k--) {
      const b = col[k];
      if (b.hidden || b.color !== top.color) break;
      n++;
    }
    return n;
  }

  canDrop(from: number, to: number): boolean {
    if (from === to || to === this.lockedColumn) return false;
    if (this.taped.has(to)) return false;
    const src = this.columns[from];
    const dst = this.columns[to];
    if (!src || !dst) return false;
    const group = this.topGroup(from);
    if (group === 0 || dst.length >= this.capacity(to)) return false;
    const color = this.groupColor(from);
    if (dst.length === 0) return true;
    return this.matches(color, dst[dst.length - 1].color);
  }

  validTargets(from: number): number[] {
    const out: number[] = [];
    for (let j = 0; j < this.columns.length; j++) {
      if (this.canDrop(from, j)) out.push(j);
    }
    return out;
  }

  /** Won when nothing but ink remains. */
  isWon(): boolean {
    return this.columns.every((c) => c.every((b) => b.color === SPECIAL.INK));
  }

  /** True when no move exists (key not counted; caller may offer the key). */
  hasAnyMove(): boolean {
    return this.findAnyMove() !== null;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  /* ---------------- commands ---------------- */

  /**
   * Executes a move. Clearing is split in two phases so the view can animate:
   * `move()` only reports `readyToClear`; call `commitClear()` after the
   * animation to actually empty the column.
   */
  move(from: number, to: number): MoveResult | null {
    if (!this.canDrop(from, to)) return null;
    this.pushSnapshot();

    const src = this.columns[from];
    const dst = this.columns[to];
    const count = Math.min(this.topGroup(from), this.capacity(to) - dst.length);
    dst.push(...src.splice(src.length - count, count));
    this.moves += 1;

    const settled = this.settle(from);
    const readyToClear = this.isUniformFull(to) ? to : null;
    return { from, to, count, readyToClear, ...settled };
  }

  /** Empties a previously reported uniform column; returns newly revealed columns. */
  commitClear(index: number): number[] {
    if (!this.isUniformFull(index)) return [];
    this.columns[index] = [];
    const settled = this.settle(null);
    return settled.revealed;
  }

  undo(): boolean {
    const snap = this.history.pop();
    if (!snap) return false;
    this.columns = snap.columns;
    this.lockedColumn = snap.lockedColumn;
    this.taped = new Set(snap.taped);
    this.moves = snap.moves;
    this.reapplyBoosterEffects();
    return true;
  }

  /** Booster results survive undo: spent boosters must not be rolled back. */
  private reapplyBoosterEffects(): void {
    if (this.keyUsed) this.lockedColumn = null;
    if (this.revealedByLens.size > 0) {
      for (const col of this.columns) {
        for (const block of col) {
          if (this.revealedByLens.has(block.id)) block.hidden = false;
        }
      }
    }
  }

  /** Unlocks the locked column (key booster). Permanent: not undo-able. */
  unlockColumn(): number | null {
    if (this.lockedColumn === null) return null;
    const index = this.lockedColumn;
    this.lockedColumn = null;
    this.keyUsed = true;
    return index;
  }

  hasHiddenBlocks(): boolean {
    return this.columns.some((col) => col.some((b) => b.hidden));
  }

  /** Content probes for tutorials. */
  hasBlockOfColor(color: number): boolean {
    return this.columns.some((col) => col.some((b) => b.color === color));
  }

  hasTapedColumns(): boolean {
    return this.taped.size > 0;
  }

  /**
   * Lens booster: reveals the topmost hidden block found (scanning columns
   * left to right). Permanent: the reveal survives undo. Returns the column.
   */
  useLens(): number | null {
    for (let ci = 0; ci < this.columns.length; ci++) {
      const col = this.columns[ci];
      for (let bi = col.length - 1; bi >= 0; bi--) {
        if (col[bi].hidden) {
          col[bi].hidden = false;
          this.revealedByLens.add(col[bi].id);
          this.settle(null); // a revealed key may trigger the lock
          return ci;
        }
      }
    }
    return null;
  }

  /** First valid move on the board (used by the beginner idle hint). */
  findAnyMove(): { from: number; to: number } | null {
    for (let i = 0; i < this.columns.length; i++) {
      if (this.topGroup(i) === 0) continue;
      for (let j = 0; j < this.columns.length; j++) {
        if (this.canDrop(i, j)) return { from: i, to: j };
      }
    }
    return null;
  }

  /* ---------------- internals ---------------- */

  private isUniformFull(index: number): boolean {
    const col = this.columns[index];
    if (col.length !== this.capacity(index) || col.length === 0) return false;
    if (col.some((b) => b.hidden)) return false;
    const first = col[0].color;
    if (first === SPECIAL.INK || first === SPECIAL.KEY) return false;
    return col.every((b) => b.color === first);
  }

  /**
   * Post-move settlement: reveals tops, consumes revealed keys (opening the
   * lock), breaks tape on the just-emptied column. Loops until stable.
   */
  private settle(emptiedFrom: number | null): {
    revealed: number[];
    keysConsumed: number[];
    keyUnlocked: number | null;
    tapeBroken: number | null;
  } {
    const revealed: number[] = [];
    const keysConsumed: number[] = [];
    let keyUnlocked: number | null = null;
    let tapeBroken: number | null = null;

    if (emptiedFrom !== null && this.taped.has(emptiedFrom) && this.columns[emptiedFrom].length === 0) {
      this.taped.delete(emptiedFrom);
      tapeBroken = emptiedFrom;
    }

    let changed = true;
    while (changed) {
      changed = false;
      this.columns.forEach((col, ci) => {
        const top = col[col.length - 1];
        if (!top) return;
        if (top.hidden) {
          top.hidden = false;
          revealed.push(ci);
          changed = true;
        }
        const current = col[col.length - 1];
        if (current && !current.hidden && current.color === SPECIAL.KEY) {
          col.pop();
          keysConsumed.push(ci);
          if (this.lockedColumn !== null) {
            keyUnlocked = this.lockedColumn;
            this.lockedColumn = null;
          }
          changed = true;
        }
      });
    }
    return { revealed, keysConsumed, keyUnlocked, tapeBroken };
  }

  private pushSnapshot(): void {
    this.history.push({
      columns: this.columns.map((c) => c.map((b) => ({ ...b }))),
      lockedColumn: this.lockedColumn,
      taped: [...this.taped],
      moves: this.moves,
    });
  }
}
