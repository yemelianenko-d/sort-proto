import { describe, it, expect } from 'vitest';
import { SortingModel } from './SortingModel';
import { SPECIAL } from './SortingTypes';
import type { SortingLevelConfig } from './SortingTypes';

const cfg = (over: Partial<SortingLevelConfig>): SortingLevelConfig => ({
  id: 'test',
  cap: 3,
  par: 5,
  difficulty: 1,
  columns: [],
  ...over,
});

describe('SortingModel specials', () => {
  it('ink is immovable dead space that does not block the win', () => {
    const m = new SortingModel(cfg({ columns: [[SPECIAL.INK], [0, 0], [0], []] }));
    expect(m.topGroup(0)).toBe(0); // ink can never be lifted
    expect(m.canDrop(0, 3)).toBe(false); // ...so it can never move anywhere
    expect(m.canDrop(2, 0)).toBe(true); // but any color may land on ink
    m.move(2, 1);
    expect(m.isWon()).toBe(false);
    m.commitClear(1);
    expect(m.isWon()).toBe(true); // only ink remains on the board
  });

  it('a column with ink can host blocks but never clears in place', () => {
    // cap 3, ink takes the bottom slot: only two playable slots remain
    const m = new SortingModel(
      cfg({ columns: [[SPECIAL.INK, 0, 0], [0], []] }),
    );
    expect(m.canDrop(1, 0)).toBe(false); // ink column is already at cap
    m.move(0, 2); // take the pair off the ink
    m.move(1, 2); // third one joins the pair
    expect(m.isWon()).toBe(false);
    m.commitClear(2);
    expect(m.isWon()).toBe(true);
  });

  it('a target column accepts only its color as the first block', () => {
    const m = new SortingModel(
      cfg({ columns: [[0, 0], [1, 1], [], []], targetColumns: [{ col: 2, color: 1 }] }),
    );
    expect(m.canDrop(0, 2)).toBe(false); // wrong color into the target
    expect(m.isTargetMismatch(0, 2)).toBe(true);
    expect(m.canDrop(1, 2)).toBe(true); // designated color is fine
    expect(m.canDrop(0, 3)).toBe(true); // plain empty takes anything
    m.move(1, 2);
    // occupied target behaves like a normal column: matching color lands
    expect(m.canDrop(0, 2)).toBe(false); // color 0 on color 1 top
    m.move(2, 3); // move the pair back off the target
    expect(m.canDrop(0, 2)).toBe(false); // emptied target: the chalk rule is back
    expect(m.isTargetMismatch(0, 2)).toBe(true);
    expect(m.canDrop(3, 2)).toBe(true); // the designated color may return
  });

  it('a neutral chain falls to any completed set; the column opens chain-free', () => {
    const m = new SortingModel(
      cfg({ cap: 2, columns: [[0], [0], [1, 1]], chains: [-1] }),
    );
    const chainCol = m.columns.length - 1;
    expect(m.chainedColumn).toBe(chainCol);
    expect(m.canDrop(0, chainCol)).toBe(false); // closed while chained
    const res = m.move(0, 1); // completes the 0-0 set
    expect(res?.readyToClear).toBe(1);
    expect(res?.chainRemoved).toEqual({ value: -1, index: 0 });
    expect(res?.unchained).toBe(chainCol); // unlock happens at validation
    expect(m.chainedColumn).toBeNull();
    m.commitClear(1);
    expect(m.canDrop(2, chainCol)).toBe(true); // and the column is usable
  });

  it('a colored chain falls only to a set of its color', () => {
    const m = new SortingModel(
      cfg({ cap: 2, columns: [[0], [0], [1], [1], []], chains: [1, -1] }),
    );
    const chainCol = m.columns.length - 1;
    let res = m.move(0, 1); // set of color 0: the colored chain 1 stays
    expect(res?.chainRemoved).toEqual({ value: -1, index: 1 }); // ...the neutral one falls instead
    expect(m.chainsLeft()).toEqual([1]);
    m.commitClear(1);
    res = m.move(2, 3); // set of color 1 takes its chain down
    expect(res?.chainRemoved).toEqual({ value: 1, index: 0 });
    expect(res?.unchained).toBe(chainCol);
    expect(m.chainedColumn).toBeNull();
  });

  it('a double lock needs two keys; booster and key blocks both count', () => {
    const m = new SortingModel(
      cfg({
        cap: 3,
        columns: [[SPECIAL.KEY, 0], [0], [0], []],
        lockedColumn: true,
        lockedColumnLocks: 2,
      }),
    );
    const lockCol = m.columns.length - 1;
    expect(m.locksLeft).toBe(2);
    const booster = m.unlockColumn(); // booster removes one lock
    expect(booster).toEqual({ column: lockCol, opened: false, dissolved: [] });
    expect(m.locksLeft).toBe(1);
    m.move(0, 1); // uncovers the key block -> consumed -> second lock opens
    expect(m.lockedColumn).toBeNull();
    expect(m.canDrop(2, lockCol)).toBe(true);
  });

  it('booster-opened lock dissolves the now-useless key block in the pile', () => {
    const m = new SortingModel(
      cfg({ cap: 3, columns: [[SPECIAL.KEY, 0], [0], [0], []], lockedColumn: true }),
    );
    expect(m.hasBlockOfColor(SPECIAL.KEY)).toBe(true);
    const res = m.unlockColumn(); // booster opens the only lock
    expect(res?.opened).toBe(true);
    expect(m.hasBlockOfColor(SPECIAL.KEY)).toBe(false); // dead weight is gone
    expect(m.columns[0].map((b) => b.color)).toEqual([0]); // block above settled down
  });

  it('opening the last of two locks dissolves the remaining key block', () => {
    const m = new SortingModel(
      cfg({
        cap: 3,
        columns: [[SPECIAL.KEY, 0], [SPECIAL.KEY, 1], [0, 1], [0, 1], []],
        lockedColumn: true,
        lockedColumnLocks: 2,
      }),
    );
    m.unlockColumn(); // booster: 2 -> 1
    m.move(0, 4); // uncover key A -> consumed -> last lock opens -> key B dissolves
    expect(m.lockedColumn).toBeNull();
    expect(m.hasBlockOfColor(SPECIAL.KEY)).toBe(false);
  });

  it('a hidden dissolved key is reported as hidden (flips face-up before fading)', () => {
    const m = new SortingModel(
      cfg({
        cap: 3,
        columns: [[SPECIAL.KEY, 0], [0], [0], []],
        lockedColumn: true,
        hiddenBelowTop: true,
      }),
    );
    expect(m.columns[0][0].hidden).toBe(true); // the buried key starts hidden
    const res = m.unlockColumn();
    expect(res?.opened).toBe(true);
    expect(res?.dissolved).toEqual([{ col: 0, slot: 0, hidden: true }]);
  });

  it('undo keeps booster-dissolved keys gone (booster effects are permanent)', () => {
    const m = new SortingModel(
      cfg({ cap: 3, columns: [[SPECIAL.KEY, 0], [0], [0], []], lockedColumn: true }),
    );
    m.move(1, 2); // any move to have history
    m.unlockColumn(); // opens the lock, dissolves the key
    m.undo(); // reverts the move...
    expect(m.lockedColumn).toBeNull(); // ...but the lock stays open
    expect(m.hasBlockOfColor(SPECIAL.KEY)).toBe(false); // and the key stays gone
  });

  it('undo restores block-key locks but keeps booster keys spent', () => {
    const m = new SortingModel(
      cfg({
        cap: 3,
        columns: [[SPECIAL.KEY, 0], [0], [0], []],
        lockedColumn: true,
        lockedColumnLocks: 2,
      }),
    );
    m.unlockColumn(); // booster: 2 -> 1
    m.move(0, 1); // key block: 1 -> 0, opened
    expect(m.lockedColumn).toBeNull();
    m.undo(); // move undone: the key block is back, its lock restored
    expect(m.locksLeft).toBe(1); // but the booster stays spent
    expect(m.lockedColumn).not.toBeNull();
  });

  it('ink stays visible even when hiddenBelowTop is on', () => {
    const m = new SortingModel(
      cfg({ columns: [[SPECIAL.INK, 0, 1], [1], []], hiddenBelowTop: true }),
    );
    expect(m.columns[0][0].hidden).toBe(false); // ink
    expect(m.columns[0][1].hidden).toBe(true); // color below top
  });

  it('a revealed key consumes itself and opens the locked column', () => {
    const m = new SortingModel(
      cfg({ columns: [[SPECIAL.KEY, 0], [0], []], lockedColumn: true }),
    );
    const lockIndex = m.lockedColumn;
    expect(lockIndex).not.toBeNull();
    const res = m.move(0, 1); // uncovers the key
    expect(res?.keyUnlocked).toBe(lockIndex);
    expect(m.lockedColumn).toBeNull();
    expect(m.columns[0]).toHaveLength(0); // key consumed
  });

  it('taped column is take-only until emptied, then the tape breaks', () => {
    const m = new SortingModel(
      cfg({ columns: [[1], [1, 1], []], tapedColumns: [0] }),
    );
    expect(m.canDrop(1, 0)).toBe(false); // cannot put under tape
    expect(m.canDrop(0, 1)).toBe(true); // can take from under tape
    const res = m.move(0, 1);
    expect(res?.tapeBroken).toBe(0);
    expect(m.isTaped(0)).toBe(false);
    expect(m.canDrop(1, 0)).toBe(true); // tape is gone
  });

  it('capacity is uniform across all columns, including the unlocked one', () => {
    const m = new SortingModel(
      cfg({ cap: 3, columns: [[0, 0], [0], []], lockedColumn: true }),
    );
    for (let i = 0; i < m.columns.length; i++) expect(m.capacity(i)).toBe(3);
    expect(m.canDrop(1, 0)).toBe(true); // room up to the shared cap
  });
});
