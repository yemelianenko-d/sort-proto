import { describe, it, expect } from 'vitest';
import { BlocksModel } from './BlocksModel';
import { BLOCKS_ENDLESS_CONFIG } from './blocksEndless';
import { isPieceShape } from './blocksPieces';
import { mulberry32 } from './blocksRandom';

describe('BLOCKS_ENDLESS_CONFIG', () => {
  it('is a valid endless config with a known-shape honest roster', () => {
    expect(BLOCKS_ENDLESS_CONFIG.goal).toEqual({ type: 'endless' });
    expect(BLOCKS_ENDLESS_CONFIG.batchPolicy?.honest).toBe(true);
    expect(BLOCKS_ENDLESS_CONFIG.pieces.length).toBeGreaterThan(0);
    BLOCKS_ENDLESS_CONFIG.pieces.forEach((p) => {
      expect(isPieceShape(p.shape)).toBe(true);
      expect(p.weight).toBeGreaterThan(0);
    });
    // tierMix sums to ~1 (same invariant the parser enforces for JSON levels)
    const m = BLOCKS_ENDLESS_CONFIG.batchPolicy!.tierMix!;
    expect(m.flexible + m.normal + m.demanding + m.killer).toBeCloseTo(1, 5);
  });

  it('boots a playable model: full tray, not won, not failed', () => {
    const model = new BlocksModel(BLOCKS_ENDLESS_CONFIG, mulberry32(123));
    expect(model.tray.every((p) => p !== null)).toBe(true);
    expect(model.isWon()).toBe(false);
    expect(model.isFailed()).toBe(false);
    expect(model.goalProgress()).toEqual({ type: 'endless', score: 0 });
  });
});
