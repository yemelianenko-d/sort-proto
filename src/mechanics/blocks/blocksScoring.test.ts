import { describe, it, expect } from 'vitest';
import { baseClearScore, comboMultiplier, scoreMove } from './blocksScoring';

describe('blocksScoring', () => {
  it('scores line clears triangularly (10 / 30 / 60 / 100 / 150)', () => {
    expect(baseClearScore(0)).toBe(0);
    expect(baseClearScore(1)).toBe(10);
    expect(baseClearScore(2)).toBe(30);
    expect(baseClearScore(3)).toBe(60);
    expect(baseClearScore(4)).toBe(100);
    expect(baseClearScore(5)).toBe(150);
  });

  it('multiplier equals the chain length (×2, ×3…), capped at ×8', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(1)).toBe(1);
    expect(comboMultiplier(2)).toBe(2);
    expect(comboMultiplier(3)).toBe(3);
    expect(comboMultiplier(7)).toBe(7);
    expect(comboMultiplier(8)).toBe(8);
    expect(comboMultiplier(12)).toBe(8); // capped
  });

  it('adds placement + clear and advances the chain on a clearing move', () => {
    // first clear: chain 0 -> 1, multiplier 1.0. placement = 3 tiles × 3 = 9
    expect(scoreMove(3, 1, 0)).toEqual({
      placement: 9,
      clear: 10,
      total: 19,
      comboChain: 1,
      multiplier: 1,
    });
  });

  it('applies the combo multiplier to the clear score only (spec example)', () => {
    // piece area 5, 2 lines, combo now 3: placement 5×3=15, base 30, ×3 = 90
    const r = scoreMove(5, 2, 2);
    expect(r.comboChain).toBe(3);
    expect(r.multiplier).toBe(3);
    expect(r.placement).toBe(15);
    expect(r.clear).toBe(90);
    expect(r.total).toBe(105);
  });

  it('resets the chain on a move that clears nothing', () => {
    const r = scoreMove(4, 0, 3);
    expect(r).toEqual({ placement: 12, clear: 0, total: 12, comboChain: 0, multiplier: 1 });
  });

  it('compounds a held chain (six chained singles = 210, not 60)', () => {
    let chain = 0;
    let total = 0;
    for (let i = 0; i < 6; i++) {
      const r = scoreMove(0, 1, chain);
      chain = r.comboChain;
      total += r.clear;
    }
    expect(total).toBe(10 + 20 + 30 + 40 + 50 + 60);
  });
});
