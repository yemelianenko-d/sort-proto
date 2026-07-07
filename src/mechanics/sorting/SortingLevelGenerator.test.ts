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
    const seventh = generateSortingLevel(6); // hidden from level 7
    expect(seventh.hiddenBelowTop).toBe(true);
  });

  it('assigns focus mechanics to the v3 roadmap decades', () => {
    // cardFor is cheap (no solve); verify the macro map from section 13
    expect(cardFor(33).focus).toBe('blot'); // 26-40 blot intro
    expect(cardFor(46).focus).toBe('target'); // 41-55 target intro
    expect(cardFor(68).focus).toBe('tape'); // 56-70 tape intro
    expect(cardFor(81).focus).toBe('key'); // 71-85 key intro
    expect(cardFor(93).focus).toBe('multilock'); // 86-100 multi-lock mastery
    expect(cardFor(106).focus).toBe('chainN'); // 101-115 neutral chain vaults
    expect(cardFor(122).focus).toBe('chainC'); // 116-130 colored/mixed chains
    // chain columns always carry blocks (v3 canonical)
    expect(cardFor(106).chainLen).toBeGreaterThanOrEqual(2);
    expect(cardFor(122).chainLen).toBeGreaterThanOrEqual(2);
  });

  it('introduces mechanics with the right structure', { timeout: 120000 }, () => {
    const target = generateSortingLevel(45); // Target: 41-55
    expect(target.targetColumns?.length).toBeGreaterThanOrEqual(1);
    expect(target.columns[target.targetColumns![0].col]).toHaveLength(0);

    const taped = generateSortingLevel(67); // Tape: 56-70
    expect(taped.tapedColumns?.length).toBeGreaterThan(0);

    const chained = generateSortingLevel(105); // Neutral Chain vault: 101-115
    expect(chained.chains).toContain(-1);
    // the chain column holds real blocks now, not empty bonus space
    expect(chained.chainedColumnBlocks?.length ?? 0).toBeGreaterThanOrEqual(2);

    const keyLevel = generateSortingLevel(80); // Key/Lock: 71-85
    expect(keyLevel.lockedColumn).toBe(true);
    expect(keyLevel.columns.flat()).toContain(SPECIAL.KEY);

    const colored = generateSortingLevel(121); // Colored Chain: 116-130
    expect(colored.chains?.some((c) => c >= 0)).toBe(true);

    const multi = generateSortingLevel(92); // Multi-Lock: 86-100
    expect(multi.lockedColumnLocks).toBe(2);
    expect(multi.columns.flat().filter((c) => c === SPECIAL.KEY)).toHaveLength(2);
  });

  it('keys are never on top of a pile and double keys sit in distinct columns', { timeout: 60000 }, () => {
    const multi = generateSortingLevel(92);
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
    for (const index of [3, 12, 45, 92, 105, 121]) {
      const cfg = generateSortingLevel(index);
      const counts = new Map<number, number>();
      // vault blocks (locked / chained columns) count toward the palette too
      const all = [
        ...cfg.columns.flat(),
        ...(cfg.lockedColumnBlocks ?? []),
        ...(cfg.chainedColumnBlocks ?? []),
      ];
      for (const c of all) {
        if (c >= 0) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      for (const [, count] of counts) expect(count).toBe(cfg.cap);
    }
  });

  it('slot cards respect the width cap and valid board ranges', () => {
    for (let level = 1; level <= 150; level++) {
      const card = cardFor(level);
      expect(card.types).toBeGreaterThanOrEqual(3);
      expect(card.types).toBeLessThanOrEqual(8);
      expect([3, 4, 5]).toContain(card.cap);
      expect(card.targetCount).toBeLessThanOrEqual(3);
      // board width stays within the mobile viewport budget (<= 11 columns);
      // vault blocks live inside the locked/chained columns, not extra ones
      const locks = card.focus === 'multilock' || card.second === 'multilock' ? 2
        : card.focus === 'key' || card.second === 'key' ? 1 : 0;
      const hasChain = card.chainLen > 0
        || ['chainN', 'chainC'].includes(card.focus)
        || ['chainN', 'chainC'].includes(card.second);
      const width = card.types
        + (locks > 0 ? 2 : 0)
        + (hasChain ? 1 : 0)
        + (card.blotCols > 0 ? 1 : 0)
        + card.empties
        + card.targetCount;
      expect(width).toBeLessThanOrEqual(11);
    }
  });
});
