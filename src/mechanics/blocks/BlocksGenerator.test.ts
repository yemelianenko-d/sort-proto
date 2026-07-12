import { describe, it, expect } from 'vitest';
import {
  occupancyOf,
  evaluateSolvability,
  effectiveWeights,
  generateBatch,
  type Occupancy,
} from './BlocksGenerator';
import { PIECE_SHAPES } from './blocksPieces';
import { mulberry32 } from './blocksRandom';
import type { BlocksLevelConfig } from './BlocksTypes';

const geos = (...ids: string[]) => ids.map((i) => PIECE_SHAPES[i]);
const grid = (rows: string[]): Occupancy => rows.map((r) => [...r].map((ch) => ch !== '.'));

describe('BlocksGenerator — solvability', () => {
  it('classes an empty board with small pieces as SOLVABLE_NOW', () => {
    const board = grid(['....', '....', '....', '....']);
    const r = evaluateSolvability(board, geos('S1', 'S1', 'S1'));
    expect(r.klass).toBe('SOLVABLE_NOW');
  });

  it('detects a DEAD batch when no piece can be placed at all', () => {
    const board = grid(['##', '##']); // 2x2 fully occupied
    const r = evaluateSolvability(board, geos('S1', 'S1', 'S1'));
    expect(r.klass).toBe('DEAD');
    expect(r.budgetExhausted).toBe(false);
  });

  it('classes a batch that needs a clear to open space as SOLVABLE_AFTER_CLEAR', () => {
    // 2x2 board, top-left filled: R2x2 does not fit until a dot completes row 0
    const board = grid(['#.', '..']);
    const r = evaluateSolvability(board, geos('R2x2', 'S1', 'S1'));
    expect(r.klass).toBe('SOLVABLE_AFTER_CLEAR');
  });
});

describe('BlocksGenerator — weights', () => {
  it('applies tier multipliers and damps recently-seen shapes (cooldown)', () => {
    const mix = { flexible: 0.5, normal: 0.3, demanding: 0.15, killer: 0.05 };
    const roster = [{ shape: 'S1', weight: 10 }, { shape: 'H4', weight: 10 }];
    const w = effectiveWeights(roster, mix, ['S1'], 2);
    const s1 = w.find((x) => x.shape === 'S1')!;
    const h4 = w.find((x) => x.shape === 'H4')!;
    // S1: 10 × flexible(0.5) × cooldown(0.35); H4: 10 × normal(0.3) × 1
    expect(s1.weight).toBeCloseTo(10 * 0.5 * 0.35, 5);
    expect(h4.weight).toBeCloseTo(10 * 0.3, 5);
  });
});

describe('BlocksGenerator — generateBatch', () => {
  const config = (): BlocksLevelConfig => ({
    id: 'g',
    rows: 8,
    cols: 8,
    board: [],
    goal: { type: 'score', target: 500 },
    pieces: [
      { shape: 'S1', weight: 4 },
      { shape: 'H2', weight: 8 },
      { shape: 'V2', weight: 8 },
      { shape: 'H3', weight: 6 },
      { shape: 'R2x2', weight: 5 },
    ],
    par: 20,
    difficulty: 2,
    batchPolicy: {
      tierMix: { flexible: 0.5, normal: 0.35, demanding: 0.13, killer: 0.02 },
      candidateAttempts: 20,
      repeatCooldown: 2,
      solvabilityPolicy: { SOLVABLE_NOW: 0.5, SOLVABLE_AFTER_CLEAR: 0.4, DANGEROUS: 0.1, DEAD: 0 },
    },
  });

  it('is deterministic for the same seed and never returns DEAD', () => {
    const board = grid(Array(8).fill('........'));
    const a = generateBatch(board, config(), mulberry32(11), [], 3);
    const b = generateBatch(board, config(), mulberry32(11), [], 3);
    expect(a.shapes).toEqual(b.shapes);
    expect(a.shapes).toHaveLength(3);
    expect(a.klass).not.toBe('DEAD');
    a.shapes.forEach((s) => expect(PIECE_SHAPES[s]).toBeTruthy());
  });

  it('uses the documented fallback batch when every candidate is dead', () => {
    // fully-occupied board: no piece fits, every candidate is DEAD → fallback
    const board = grid(Array(8).fill('########'));
    const g = generateBatch(board, config(), mulberry32(3), [], 3);
    expect(g.shapes).toHaveLength(3);
    expect(g.klass).not.toBe('DEAD');
  });

  it('snapshots a model grid to a boolean occupancy grid', () => {
    expect(occupancyOf([[null, {}], [{}, null]])).toEqual([[false, true], [true, false]]);
  });

  it('serves the authored opening batches first, then generates', () => {
    const base = config();
    const cfg = {
      ...base,
      batchPolicy: { ...base.batchPolicy, openingBatches: [['R2x2', 'H3', 'S1'], ['H2', 'V2', 'S1']] },
    };
    const board = grid(Array(8).fill('........'));
    expect(generateBatch(board, cfg, mulberry32(1), [], 3, 0).shapes).toEqual(['R2x2', 'H3', 'S1']);
    expect(generateBatch(board, cfg, mulberry32(1), [], 3, 1).shapes).toEqual(['H2', 'V2', 'S1']);
    // past the authored openings the normal pipeline takes over
    const later = generateBatch(board, cfg, mulberry32(1), [], 3, 2);
    expect(later.shapes).toHaveLength(3);
    later.shapes.forEach((s) => expect(PIECE_SHAPES[s]).toBeTruthy());
  });

  it('honest mode ships a weighted-random batch with no solvability guarantee', () => {
    const base = config();
    const honestCfg = { ...base, batchPolicy: { ...base.batchPolicy, honest: true } };
    const board = grid(Array(8).fill('........'));
    const a = generateBatch(board, honestCfg, mulberry32(5), [], 3);
    const b = generateBatch(board, honestCfg, mulberry32(5), [], 3);
    expect(a.shapes).toHaveLength(3);
    expect(a.shapes).toEqual(b.shapes); // deterministic given the rng
    a.shapes.forEach((s) => expect(PIECE_SHAPES[s]).toBeTruthy());
    // even on a full board honest returns pieces (no fallback/rescue), no hang
    const full = grid(Array(8).fill('########'));
    expect(generateBatch(full, honestCfg, mulberry32(9), [], 3).shapes).toHaveLength(3);
  });
});
