import { SPECIAL } from './SortingTypes';
import type { BlockState, ColumnState, MoveResult, SortingLevelConfig } from './SortingTypes';

interface Snapshot {
  columns: ColumnState[];
  lockedColumn: number | null;
  locksRemaining: number;
  chainedColumn: number | null;
  chains: number[];
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
 *  - a locked column may need several keys (each key removes one lock);
 *    once every lock is off, key blocks still on the board are dead weight
 *    and dissolve immediately (booster keys included);
 *  - a chained column carries chains: a neutral chain falls to any
 *    completed set, a colored one only to a set of its color; the column
 *    opens when the last chain falls (in the resolve sequence, at set
 *    validation time);
 *  - a target column, while empty, accepts only its designated color as the
 *    first block; once occupied it behaves like a normal column;
 *  - a full column of one color is COMPLETED: it stays in place as a
 *    "done" column (untouchable, space removed from play), never clearing;
 *  - the level is won when every column is empty, ink-only, or done.
 */
export class SortingModel {
  readonly cap: number;
  readonly levelId: string;
  readonly par: number;

  columns: ColumnState[];
  lockedColumn: number | null = null;
  chainedColumn: number | null = null;
  moves = 0;

  private locksRemaining = 0;
  private initialLocks = 0;
  private chains: number[] = [];
  private targets = new Map<number, number>();
  private taped = new Set<number>();
  private history: Snapshot[] = [];
  /** Booster effects are permanent: undo reverts moves only. */
  private revealedByLens = new Set<number>();
  private boosterKeys = 0;

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
    (config.targetColumns ?? []).forEach(({ col, color }) => this.targets.set(col, color));
    if (config.lockedColumn) {
      // trapped blocks are always visible: the player must see the stakes
      this.columns.push(
        (config.lockedColumnBlocks ?? []).map((color) => ({ id: nextId++, color, hidden: false })),
      );
      this.lockedColumn = this.columns.length - 1;
      this.initialLocks = Math.max(1, config.lockedColumnLocks ?? 1);
      this.locksRemaining = this.initialLocks;
    }
    if ((config.chains ?? []).length > 0) {
      this.columns.push(
        (config.chainedColumnBlocks ?? []).map((color) => ({ id: nextId++, color, hidden: false })),
      );
      this.chainedColumn = this.columns.length - 1;
      this.chains = [...(config.chains as number[])];
    }
  }

  /* ---------------- new-mechanic queries ---------------- */

  /** Designated color of a target column, or null. */
  targetColor(i: number): number | null {
    return this.targets.has(i) ? (this.targets.get(i) as number) : null;
  }

  hasTargetColumns(): boolean {
    return this.targets.size > 0;
  }

  /** Locks still on the key-locked column (0 when open or absent). */
  get locksLeft(): number {
    return this.lockedColumn === null ? 0 : this.locksRemaining;
  }

  /** Chains still hanging on the chained column (-1 neutral, >=0 color). */
  chainsLeft(): number[] {
    return this.chainedColumn === null ? [] : [...this.chains];
  }

  /** True when a drop from `from` onto `to` fails only due to the target color rule. */
  isTargetMismatch(from: number, to: number): boolean {
    if (!this.targets.has(to) || this.columns[to].length > 0) return false;
    if (this.topGroup(from) === 0) return false;
    return this.groupColor(from) !== this.targets.get(to);
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
    if (from === to || to === this.lockedColumn || to === this.chainedColumn) return false;
    if (from === this.lockedColumn || from === this.chainedColumn) return false;
    if (this.isUniformFull(from)) return false; // completed columns are untouchable
    if (this.taped.has(to)) return false;
    const src = this.columns[from];
    const dst = this.columns[to];
    if (!src || !dst) return false;
    const group = this.topGroup(from);
    if (group === 0 || dst.length >= this.capacity(to)) return false;
    const color = this.groupColor(from);
    if (dst.length === 0) {
      // a target column, while empty, accepts only its designated color
      const want = this.targets.get(to);
      return want === undefined || want === color;
    }
    return this.matches(color, dst[dst.length - 1].color);
  }

  validTargets(from: number): number[] {
    const out: number[] = [];
    for (let j = 0; j < this.columns.length; j++) {
      if (this.canDrop(from, j)) out.push(j);
    }
    return out;
  }

  /** Won when every column is empty, ink-only, or a completed (done) column.
   * A still-closed locked/chained column holding blocks is not resolved. */
  isWon(): boolean {
    return this.columns.every((c, i) => {
      if (c.length === 0) return true;
      if (c.every((b) => b.color === SPECIAL.INK)) return true;
      if (i === this.lockedColumn || i === this.chainedColumn) return false;
      return this.isUniformFull(i);
    });
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
    let chainRemoved: { value: number; index: number } | null = null;
    let unchained: number | null = null;
    if (readyToClear !== null && this.chainedColumn !== null) {
      const setColor = this.columns[readyToClear][0].color;
      let idx = this.chains.indexOf(setColor); // colored chain matches first
      if (idx === -1) idx = this.chains.indexOf(-1); // else a neutral one falls
      if (idx !== -1) {
        chainRemoved = { value: this.chains[idx], index: idx };
        this.chains.splice(idx, 1);
        if (this.chains.length === 0) {
          unchained = this.chainedColumn;
          this.chainedColumn = null;
        }
      }
    }
    return { from, to, count, readyToClear, chainRemoved, unchained, ...settled };
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
    this.locksRemaining = snap.locksRemaining;
    this.chainedColumn = snap.chainedColumn;
    this.chains = [...snap.chains];
    this.taped = new Set(snap.taped);
    this.moves = snap.moves;
    this.reapplyBoosterEffects();
    return true;
  }

  /** Booster results survive undo: spent boosters must not be rolled back. */
  private reapplyBoosterEffects(): void {
    // booster keys are permanent: cap the restored lock count accordingly
    const cap = this.initialLocks - this.boosterKeys;
    if (this.lockedColumn !== null) {
      this.locksRemaining = Math.min(this.locksRemaining, Math.max(0, cap));
      if (this.locksRemaining <= 0) {
        this.lockedColumn = null;
        this.purgeKeyBlocks();
      }
    }
    if (this.revealedByLens.size > 0) {
      for (const col of this.columns) {
        for (const block of col) {
          if (this.revealedByLens.has(block.id)) block.hidden = false;
        }
      }
    }
  }

  /** Unlocks the locked column (key booster). Permanent: not undo-able. */
  /** Every lock is off: remaining key blocks are dead weight and dissolve. */
  private purgeKeyBlocks(): { col: number; slot: number; hidden: boolean }[] {
    const purged: { col: number; slot: number; hidden: boolean }[] = [];
    this.columns.forEach((col, ci) => {
      for (let k = col.length - 1; k >= 0; k--) {
        if (col[k].color === SPECIAL.KEY) {
          purged.push({ col: ci, slot: k, hidden: col[k].hidden });
          col.splice(k, 1);
        }
      }
    });
    return purged;
  }

  /** Booster key: removes one lock; returns the column, whether it opened,
   * and any key blocks dissolved as dead weight (for the view animation). */
  unlockColumn(): {
    column: number;
    opened: boolean;
    dissolved: { col: number; slot: number; hidden: boolean }[];
  } | null {
    if (this.lockedColumn === null) return null;
    this.boosterKeys += 1;
    this.locksRemaining -= 1;
    if (this.locksRemaining <= 0) {
      const column = this.lockedColumn;
      this.lockedColumn = null;
      const dissolved = this.purgeKeyBlocks();
      this.settle(null); // reveal tops uncovered by the purge
      return { column, opened: true, dissolved };
    }
    return { column: this.lockedColumn, opened: false, dissolved: [] };
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
    keysDissolved: { col: number; slot: number; hidden: boolean }[];
    keysApplied: number[];
    keyUnlocked: number | null;
    tapeBroken: number | null;
  } {
    const revealed: number[] = [];
    const keysConsumed: number[] = [];
    const keysDissolved: { col: number; slot: number; hidden: boolean }[] = [];
    const keysApplied: number[] = [];
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
            keysApplied.push(ci);
            this.locksRemaining -= 1;
            if (this.locksRemaining <= 0) {
              keyUnlocked = this.lockedColumn;
              this.lockedColumn = null;
              const purged = this.purgeKeyBlocks();
              keysDissolved.push(...purged);
              keysConsumed.push(...purged.map((p) => p.col));
            }
          }
          changed = true;
        }
      });
    }
    return { revealed, keysConsumed, keysDissolved, keysApplied, keyUnlocked, tapeBroken };
  }

  private pushSnapshot(): void {
    this.history.push({
      columns: this.columns.map((c) => c.map((b) => ({ ...b }))),
      lockedColumn: this.lockedColumn,
      locksRemaining: this.locksRemaining,
      chainedColumn: this.chainedColumn,
      chains: [...this.chains],
      taped: [...this.taped],
      moves: this.moves,
    });
  }
}
