import { describe, it, expect } from 'vitest';
import { SortingModel } from './SortingModel';
import type { SortingLevelConfig } from './SortingTypes';

function config(partial: Partial<SortingLevelConfig> = {}): SortingLevelConfig {
  return {
    id: 'test',
    cap: 3,
    par: 6,
    difficulty: 1,
    columns: [
      [1, 0, 1],
      [0, 0, 1],
      [],
      [],
    ],
    ...partial,
  };
}

describe('SortingModel', () => {
  it('hides everything below the top when hiddenBelowTop is set', () => {
    const m = new SortingModel(config({ hiddenBelowTop: true }));
    expect(m.columns[0].map((b) => b.hidden)).toEqual([true, true, false]);
    expect(m.columns[2]).toHaveLength(0);
  });

  it('computes the liftable top group of equal revealed blocks', () => {
    const m = new SortingModel(config({ columns: [[0, 1, 1], [1, 0, 0], [], []] }));
    expect(m.topGroup(0)).toBe(2); // two "1" on top
    expect(m.topGroup(1)).toBe(2); // two "0" on top
    expect(m.topGroup(2)).toBe(0); // empty
  });

  it('does not lift a hidden top block', () => {
    const m = new SortingModel(config({ hiddenBelowTop: true }));
    m.columns[0][2].hidden = true; // force-hide the top
    expect(m.topGroup(0)).toBe(0);
  });

  it('enforces drop rules: empty or same color, capacity, locked column', () => {
    const m = new SortingModel(config({ lockedColumn: true }));
    const locked = m.lockedColumn as number;
    expect(m.canDrop(0, 2)).toBe(true); // onto empty
    expect(m.canDrop(0, 1)).toBe(false); // "1" onto "1", but the target is full
    expect(m.canDrop(1, 0)).toBe(false); // same color, but the target is full
    expect(m.canDrop(0, locked)).toBe(false); // locked target
    expect(m.canDrop(0, 0)).toBe(false); // onto itself
  });

  it('rejects a drop on a full column and on a color mismatch', () => {
    const m = new SortingModel(config({ columns: [[0, 0, 1], [1, 1], [0], [], []] }));
    expect(m.canDrop(2, 0)).toBe(false); // target is full
    expect(m.canDrop(0, 2)).toBe(false); // "1" onto "0" mismatch
    expect(m.canDrop(0, 1)).toBe(true); // "1" onto "1" with free space
  });

  it('moves a group, reveals the uncovered block and counts one move', () => {
    const m = new SortingModel(config({ hiddenBelowTop: true }));
    const r = m.move(0, 2);
    expect(r).not.toBeNull();
    expect(r!.count).toBe(1);
    expect(r!.revealed).toContain(0); // block under the moved one flips
    expect(m.moves).toBe(1);
    expect(m.columns[2]).toHaveLength(1);
  });

  it('moves the whole group onto an empty column, but caps by remaining space', () => {
    const whole = new SortingModel(config({ columns: [[0, 1, 1], [1, 0, 0], [], []] }));
    const rWhole = whole.move(0, 2); // group of two "1" onto empty
    expect(rWhole!.count).toBe(2);

    const capped = new SortingModel(config({ columns: [[0, 1, 1], [1, 1], [0], [0], []] }));
    const rCapped = capped.move(0, 1); // group of two "1", but only 1 slot free
    expect(rCapped!.count).toBe(1);
    expect(rCapped!.readyToClear).toBe(1); // [1,1,1] became uniform full
  });

  it('reports readyToClear and clears only after commitClear', () => {
    const m = new SortingModel(config({ columns: [[0, 0], [1, 1], [0], [1], []] }));
    const r = m.move(2, 0); // third "0" lands -> uniform full
    expect(r!.readyToClear).toBe(0);
    expect(m.columns[0]).toHaveLength(3); // not cleared yet
    m.commitClear(0);
    expect(m.columns[0]).toHaveLength(0);
  });

  it('wins when every column is empty', () => {
    const m = new SortingModel(config({ columns: [[0, 0], [0], []] }));
    m.move(1, 0);
    m.commitClear(0);
    expect(m.isWon()).toBe(true);
    expect(m.hasAnyMove()).toBe(false);
  });

  it('undo reverts moves, but the used key stays used', () => {
    const m = new SortingModel(config({ lockedColumn: true }));
    const before = JSON.stringify(m.columns);
    m.move(0, 2);
    m.unlockColumn(); // booster: permanent, no snapshot
    expect(m.lockedColumn).toBeNull();
    expect(m.undo()).toBe(true); // reverts the move
    expect(JSON.stringify(m.columns)).toBe(before);
    expect(m.lockedColumn).toBeNull(); // key effect survived the undo
    expect(m.moves).toBe(0);
    expect(m.canUndo).toBe(false);
  });

  it('detects a deadlock (no valid move on a full mismatched board)', () => {
    const m = new SortingModel(config({ cap: 2, columns: [[0, 1], [1, 2], [2, 0]] }));
    expect(m.hasAnyMove()).toBe(false);
    expect(m.isWon()).toBe(false);
  });

  it('returns null for an invalid move and does not change state', () => {
    const m = new SortingModel(config());
    const before = JSON.stringify(m.columns);
    expect(m.move(2, 3)).toBeNull(); // empty -> empty
    expect(m.move(0, 0)).toBeNull(); // onto itself
    expect(m.moves).toBe(0);
    expect(JSON.stringify(m.columns)).toBe(before);
  });
});
