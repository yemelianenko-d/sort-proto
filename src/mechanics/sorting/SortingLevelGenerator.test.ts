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
    const base = generateSortingLevel(12); // 11-15: pure base curve
    expect(base.columns.flat().every((c) => c >= 0)).toBe(true);
    expect(base.tapedColumns).toBeUndefined();

    const stone = generateSortingLevel(16); // stone from 16
    expect(stone.columns.flat()).toContain(SPECIAL.STONE);

    const keyLevel = generateSortingLevel(22); // key block from 21
    expect(keyLevel.lockedColumn).toBe(true);
    expect(keyLevel.columns.flat()).toContain(SPECIAL.KEY);

    const taped = generateSortingLevel(31); // tape from 31
    expect(taped.tapedColumns?.length).toBeGreaterThan(0);
  });

  it('keeps the color arithmetic: every color has exactly cap copies', { timeout: 30000 }, () => {
    for (const index of [12, 16, 22, 31, 45, 70]) {
      const cfg = generateSortingLevel(index);
      const counts = new Map<number, number>();
      for (const c of cfg.columns.flat()) {
        if (c >= 0) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      for (const [, count] of counts) expect(count).toBe(cfg.cap);
    }
  });
});
