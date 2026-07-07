import { describe, it, expect } from 'vitest';
import { generateSortingLevel, cardFor } from './SortingLevelGenerator';
import { parseSortingLevels } from './SortingLevelParser';
import { SPECIAL } from './SortingTypes';

describe('generateSortingLevel (guideline slot map)', () => {
  it('is deterministic for the same index', { timeout: 30000 }, () => {
    const a = generateSortingLevel(22);
    const b = generateSortingLevel(22);
    expect(a).toEqual(b);
  });

  it('produces parser-valid configs across the curve', { timeout: 60000 }, () => {
    for (const index of [0, 7, 15, 22, 33, 43, 53, 73]) {
      const cfg = generateSortingLevel(index);
      expect(cfg.id).toBe(`level_${String(index + 1).padStart(3, '0')}`);
      const parsed = parseSortingLevels({ version: 1, mechanic: 'sorting', levels: [cfg] });
      expect(parsed).toHaveLength(1);
      expect(parsed[0].par).toBeGreaterThan(0);
    }
  });

  it('follows the macro roadmap: onboarding is tiny and clean', { timeout: 30000 }, () => {
    const first = generateSortingLevel(0); // level 1: 3 types, C3, no hidden
    expect(first.cap).toBe(3);
    expect(first.hiddenBelowTop).toBe(false);
    expect(first.columns.flat().every((c) => c >= 0)).toBe(true);
    const fifth = generateSortingLevel(4); // hidden from level 5
    expect(fifth.hiddenBelowTop).toBe(true);
  });

  it('introduces mechanics in the roadmap decades', { timeout: 120000 }, () => {
    const target = generateSortingLevel(22); // Target: 21-30
    expect(target.targetColumns?.length).toBe(1);
    expect(target.columns[target.targetColumns![0].col]).toHaveLength(0);

    const taped = generateSortingLevel(33); // Tape: 31-40
    expect(taped.tapedColumns?.length).toBeGreaterThan(0);

    const chained = generateSortingLevel(43); // Neutral Chain: 41-50
    expect(chained.chains).toEqual([-1]);

    const keyLevel = generateSortingLevel(53); // Key/Lock: 51-60
    expect(keyLevel.lockedColumn).toBe(true);
    expect(keyLevel.columns.flat()).toContain(SPECIAL.KEY);

    const colored = generateSortingLevel(73); // Colored Chain: 71-80
    expect(colored.chains?.some((c) => c >= 0)).toBe(true);

    const multi = generateSortingLevel(83); // Multi-Lock: 81-90
    expect(multi.lockedColumnLocks).toBe(2);
    expect(multi.columns.flat().filter((c) => c === SPECIAL.KEY)).toHaveLength(2);
  });

  it('keys are never on top of a pile and double keys sit in distinct columns', { timeout: 60000 }, () => {
    const multi = generateSortingLevel(83);
    const keyCols: number[] = [];
    multi.columns.forEach((col, ci) => {
      col.forEach((c, si) => {
        if (c === SPECIAL.KEY) {
          keyCols.push(ci);
          expect(si).toBeLessThan(col.length - 1); // buried, not on top
        }
      });
    });
    expect(new Set(keyCols).size).toBe(2);
  });

  it('ink occupies contiguous bottom slots when present', { timeout: 60000 }, () => {
    // ink is seasoning; scan a range and verify the invariant wherever it shows up
    for (const index of [65, 95, 115, 135, 147]) {
      const cfg = generateSortingLevel(index);
      for (const col of cfg.columns) {
        const n = col.filter((c) => c === SPECIAL.INK).length;
        for (let i = 0; i < n; i++) expect(col[i]).toBe(SPECIAL.INK);
        expect(n).toBeLessThan(cfg.cap);
      }
    }
  });

  it('keeps the color arithmetic: every color has exactly cap copies', { timeout: 60000 }, () => {
    for (const index of [3, 12, 22, 43, 73, 96]) {
      const cfg = generateSortingLevel(index);
      const counts = new Map<number, number>();
      for (const c of cfg.columns.flat()) {
        if (c >= 0) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      for (const [, count] of counts) expect(count).toBe(cfg.cap);
    }
  });

  it('slot cards respect the width cap and the pairs-need-buffer rule', () => {
    for (let level = 1; level <= 150; level++) {
      const card = cardFor(level);
      if (card.second !== 'none') expect(card.empties).toBeGreaterThanOrEqual(2);
      expect(card.types).toBeGreaterThanOrEqual(3);
      expect(card.types).toBeLessThanOrEqual(8);
      expect([3, 4, 5]).toContain(card.cap);
    }
  });
});
