import { describe, it, expect } from 'vitest';
import { computeColumnLayout } from './layout';

describe('computeColumnLayout', () => {
  it('returns a position for every column', () => {
    const l = computeColumnLayout({ columnCount: 6, cap: 3, availWidth: 400, availHeight: 600 });
    expect(l.positions).toHaveLength(6);
    expect(l.cell).toBeGreaterThan(0);
  });

  it('keeps every column frame inside the available area', () => {
    const availWidth = 380;
    const availHeight = 560;
    for (const columnCount of [3, 5, 8, 12]) {
      const l = computeColumnLayout({ columnCount, cap: 4, availWidth, availHeight });
      for (const p of l.positions) {
        expect(p.x).toBeGreaterThanOrEqual(-0.5);
        expect(p.y).toBeGreaterThanOrEqual(-0.5);
        expect(p.x + l.colWidth).toBeLessThanOrEqual(availWidth + 0.5);
        expect(p.y + l.colHeight).toBeLessThanOrEqual(availHeight + 0.5);
      }
    }
  });

  it('splits many columns into more rows on a narrow portrait screen', () => {
    const narrow = computeColumnLayout({
      columnCount: 9,
      cap: 3,
      availWidth: 320,
      availHeight: 640,
    });
    expect(narrow.rows).toBeGreaterThan(1);
  });

  it('respects the max cell size', () => {
    const l = computeColumnLayout({
      columnCount: 2,
      cap: 3,
      availWidth: 2000,
      availHeight: 2000,
      maxCell: 64,
    });
    expect(l.cell).toBeLessThanOrEqual(64);
  });
});
