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
  it('stone moves only into an empty column and does not block the win', () => {
    const m = new SortingModel(cfg({ columns: [[SPECIAL.STONE], [0, 0], [0], []] }));
    expect(m.canDrop(0, 1)).toBe(false); // stone onto blocks
    expect(m.canDrop(2, 0)).toBe(false); // block onto stone
    expect(m.canDrop(0, 3)).toBe(true); // stone onto empty
    m.move(2, 1);
    expect(m.isWon()).toBe(false);
    m.commitClear(1);
    expect(m.isWon()).toBe(true); // only the stone remains
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
