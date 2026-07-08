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

  it('introduces each mechanic on the Curve C schedule (forced first appearance)', () => {
    // cardFor is cheap (no solve); each mechanic debuts at its MECH_INTRO level.
    expect(cardFor(8).focus).toBe('blot');
    expect(cardFor(14).focus).toBe('target');
    expect(cardFor(20).focus).toBe('tape');
    expect(cardFor(26).focus).toBe('key');
    expect(cardFor(32).focus).toBe('chainC');
    expect(cardFor(38).focus).toBe('multilock');
    // sealed columns always carry blocks (the vault)
    expect(cardFor(32).chainLen).toBeGreaterThanOrEqual(2);
  });

  it('introduces mechanics with the right structure', { timeout: 120000 }, () => {
    // Use the deterministic intro levels (forced focus) — indices are 0-based
    // (level = index + 1), so target intro (level 14) is index 13, etc.
    const target = generateSortingLevel(13); // target intro (level 14)
    expect(target.targetColumns?.length).toBeGreaterThanOrEqual(1);
    expect(target.columns[target.targetColumns![0].col]).toHaveLength(0);

    const taped = generateSortingLevel(19); // tape intro (level 20)
    expect(taped.tapedColumns?.length).toBeGreaterThan(0);

    const sealed = generateSortingLevel(31); // coloured-seal intro (level 32)
    expect(sealed.chains?.every((c) => c >= 0)).toBe(true); // colour-bound only
    expect(sealed.chains?.length ?? 0).toBeGreaterThanOrEqual(1);
    // the sealed column holds real blocks (the vault), not empty bonus space
    expect(sealed.chainedColumnBlocks?.length ?? 0).toBeGreaterThanOrEqual(2);

    const keyLevel = generateSortingLevel(25); // key intro (level 26)
    expect(keyLevel.lockedColumn).toBe(true);
    expect(keyLevel.columns.flat()).toContain(SPECIAL.KEY);

    const multi = generateSortingLevel(37); // multi-lock intro (level 38)
    expect(multi.lockedColumnLocks).toBe(2);
    expect(multi.columns.flat().filter((c) => c === SPECIAL.KEY)).toHaveLength(2);
  });

  it('keys are never on top of a pile and double keys sit in distinct columns', { timeout: 60000 }, () => {
    const multi = generateSortingLevel(37); // multi-lock intro (level 38)
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
      const hasChain = card.chainLen > 0 || card.focus === 'chainC' || card.second === 'chainC';
      const width = card.types
        + (locks > 0 ? 2 : 0)
        + (hasChain ? 1 : 0)
        + (card.blotCols > 0 ? 1 : 0)
        + card.empties
        + card.targetCount;
      expect(width).toBeLessThanOrEqual(11);
    }
  });

  it('no level starts with a completed (done) column (no-clear rule)', { timeout: 90000 }, () => {
    // under the no-clear rule a full uniform column is already "done"; a level
    // must never start in that state (it would be a free win)
    for (const index of [3, 20, 33, 45, 67, 92, 104, 121, 137, 149]) {
      const cfg = generateSortingLevel(index);
      cfg.columns.forEach((col) => {
        if (col.length !== cfg.cap) return;
        const first = col[0];
        if (first < 0) return; // ink/key columns are fine
        const uniform = col.every((c) => c === first);
        expect(uniform).toBe(false);
      });
    }
  });

  it('budgets spare space: targets substitute for universal empties', { timeout: 90000 }, () => {
    // the "too many free columns" fix — target columns are the buffers, so a
    // level never stacks a full set of universal empties on top of them.
    // Spare = empty universal + empty target + near-empty columns stays small.
    for (const index of [40, 49, 55, 56, 62, 131, 141, 146]) {
      const cfg = generateSortingLevel(index);
      const targetCols = new Set((cfg.targetColumns ?? []).map((t) => t.col));
      let emptyUniversal = 0;
      let spare = 0;
      cfg.columns.forEach((col, i) => {
        const real = col.filter((c) => c >= 0 && c !== SPECIAL.KEY).length;
        if (col.length === 0) {
          spare += 1;
          if (!targetCols.has(i)) emptyUniversal += 1;
        } else if (real <= 1) {
          spare += 1;
        }
      });
      // with 2+ targets, universal empties collapse to none (targets are the room)
      if (targetCols.size >= 2) expect(emptyUniversal).toBe(0);
      expect(spare).toBeLessThanOrEqual(3);
    }
  });
});
