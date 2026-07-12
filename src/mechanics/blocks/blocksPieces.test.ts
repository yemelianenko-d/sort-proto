import { describe, it, expect } from 'vitest';
import { PIECE_SHAPES, SHAPE_IDS_BY_TIER, isPieceShape } from './blocksPieces';

describe('shape catalog v4', () => {
  it('holds exactly the 43 orientation-specific shapes', () => {
    expect(Object.keys(PIECE_SHAPES)).toHaveLength(43);
  });

  it('includes the S/Z skew tetrominoes and has no geometry duplicates', () => {
    ['SZ_S_H', 'SZ_Z_H', 'SZ_S_V', 'SZ_Z_V'].forEach((id) => expect(isPieceShape(id)).toBe(true));
    const keys = new Set(
      Object.values(PIECE_SHAPES).map((s) => s.cells.map((c) => `${c.r},${c.c}`).join('|')),
    );
    expect(keys.size).toBe(43); // every declared shape is geometrically distinct
  });

  it('computes rows/cols/area/bboxDensity from the cell map', () => {
    const h5 = PIECE_SHAPES.H5;
    expect(h5.rows).toBe(1);
    expect(h5.cols).toBe(5);
    expect(h5.area).toBe(5);
    expect(h5.bboxDensity).toBe(1);
    const d3 = PIECE_SHAPES.D3_ASC;
    expect(d3.area).toBe(3);
    expect(d3.bboxDensity).toBeCloseTo(3 / 9, 5); // sparse diagonal
  });

  it('buckets every shape into exactly one tier', () => {
    const total =
      SHAPE_IDS_BY_TIER.FLEXIBLE.length +
      SHAPE_IDS_BY_TIER.NORMAL.length +
      SHAPE_IDS_BY_TIER.DEMANDING.length +
      SHAPE_IDS_BY_TIER.KILLER.length;
    expect(total).toBe(43);
    expect(SHAPE_IDS_BY_TIER.KILLER).toEqual(['L3x3_SW', 'L3x3_SE', 'L3x3_NW', 'L3x3_NE']);
    // L / J tetrominoes are common now (NORMAL), not a rare tier
    expect(SHAPE_IDS_BY_TIER.NORMAL).toContain('L2x3_NW');
    expect(SHAPE_IDS_BY_TIER.NORMAL).toContain('SZ_S_H');
  });

  it('recognises valid ids and rejects unknown ones', () => {
    expect(isPieceShape('T4_DOWN')).toBe(true);
    expect(isPieceShape('dot')).toBe(false); // old id retired
  });
});
