import { describe, it, expect } from 'vitest';
import { generateSortingLevel } from './SortingLevelGenerator';
import { parseSortingLevels } from './SortingLevelParser';
import { SPECIAL } from './SortingTypes';

describe('generateSortingLevel', () => {
  it('is deterministic for the same index', { timeout: 20000 }, () => {
    const a = generateSortingLevel(16);
    const b = generateSortingLevel(16);
    expect(a).toEqual(b);
  });

  it('produces parser-valid configs across the curve', { timeout: 30000 }, () => {
    for (const index of [10, 16, 21, 26, 31, 45]) {
      const cfg = generateSortingLevel(index);
      expect(cfg.id).toBe(`level_${String(index + 1).padStart(3, '0')}`);
      const parsed = parseSortingLevels({ version: 1, mechanic: 'sorting', levels: [cfg] });
      expect(parsed).toHaveLength(1);
      expect(parsed[0].par).toBeGreaterThan(0);
    }
  });

  it('introduces mechanics in the designed phases', { timeout: 30000 }, () => {
    const joker = generateSortingLevel(16);
    expect(joker.columns.flat()).toContain(SPECIAL.JOKER);

    const stone = generateSortingLevel(21);
    expect(stone.columns.flat()).toContain(SPECIAL.STONE);

    const keyLevel = generateSortingLevel(26);
    expect(keyLevel.lockedColumn).toBe(true);
    expect(keyLevel.columns.flat()).toContain(SPECIAL.KEY);

    const taped = generateSortingLevel(31);
    expect(taped.tapedColumns?.length).toBeGreaterThan(0);
  });
});
