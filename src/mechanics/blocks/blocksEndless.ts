import type { BlocksLevelConfig } from './BlocksTypes';

/**
 * The Endless / Arcade mode config (Block-Blast fantasy): an empty 8×8 board,
 * NO goal target, honest weighted-random pieces (no solvability guarantee, so
 * the board can genuinely dead-end → real game over). The full shape catalog is
 * in play, weighted toward satisfying mid pieces with big/hard ones rarer; the
 * tension is survival + a high-score/combo chase, not a quota checklist.
 *
 * Built-in (not part of the campaign JSON): reached via `?mechanic=blocks&endless=1`.
 */
const EMPTY_BOARD = Array.from({ length: 8 }, () => '.'.repeat(8));

export const BLOCKS_ENDLESS_CONFIG: BlocksLevelConfig = {
  id: 'blocks_endless',
  rows: 8,
  cols: 8,
  board: EMPTY_BOARD,
  goal: { type: 'endless' },
  pieces: [
    // flexible core — the workhorses (square + short bars + small L)
    { shape: 'R2x2', weight: 14 },
    { shape: 'H2', weight: 7 },
    { shape: 'V2', weight: 7 },
    { shape: 'H3', weight: 11 },
    { shape: 'V3', weight: 11 },
    { shape: 'L2x2_NW', weight: 6 },
    { shape: 'L2x2_NE', weight: 6 },
    { shape: 'L2x2_SW', weight: 6 },
    { shape: 'L2x2_SE', weight: 6 },
    { shape: 'S1', weight: 3 },
    // normal — the satisfying 4–6 cell pieces (bars, rects, T)
    { shape: 'H4', weight: 9 },
    { shape: 'V4', weight: 9 },
    { shape: 'R2x3', weight: 7 },
    { shape: 'R3x2', weight: 7 },
    { shape: 'T4_DOWN', weight: 5 },
    { shape: 'T4_UP', weight: 5 },
    { shape: 'T4_LEFT', weight: 4 },
    { shape: 'T4_RIGHT', weight: 4 },
    // demanding — occasional pressure (5-bars, 3×3 square)
    { shape: 'H5', weight: 4 },
    { shape: 'V5', weight: 4 },
    { shape: 'R3x3', weight: 3 },
    // killer — rare spikes (the big corner L)
    { shape: 'L3x3_NE', weight: 2 },
    { shape: 'L3x3_SW', weight: 2 },
  ],
  par: 1, // unused in endless (no stars); kept for the shared config shape
  difficulty: 5,
  difficultyBand: 'NORMAL',
  archetype: 'Endless Arcade',
  batchPolicy: {
    // lively mix: mid pieces common, big/hard ones a real but rare threat
    tierMix: { flexible: 0.42, normal: 0.4, demanding: 0.15, killer: 0.03 },
    repeatCooldown: 1,
    maxSameFamilyPerBatch: 2,
    honest: true, // no solvability guarantee — you can lose
  },
  balanceVersion: 1,
};
