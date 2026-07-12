/**
 * Builds public/levels/blocks_levels.json — the 40-level campaign. v8.
 * SOURCE OF TRUTH for the design rules: docs/BLOCKS_LEVEL_DESIGN.md.
 * Targets are calibrated with tools/blocks/calibrate.ts (CASUAL autoplayer,
 * per-band win rates) — re-run it after any pattern/band change.
 *
 * v8 = the "tension zone" model (measured against the reference, see
 * tools/blocks/diagnose.ts): why BB is interesting and empty boards are not.
 *
 *  1. THE PUZZLE IS BOARD DENSITY. Every level STARTS on an authored
 *     symmetric pattern (~25–44% fill, near-complete lines, never a full
 *     line): the very first move is already a puzzle, clears begin
 *     immediately, and the board lives in the 40–55% tension zone instead of
 *     "empty → sudden death".
 *  2. EACH POOL IS A MINI-PUZZLE. Generation favours SOLVABLE_AFTER_CLEAR:
 *     often the third piece only fits if you clear a line first. This is the
 *     core BB loop v7 accidentally disabled with SOLVABLE_NOW 0.82.
 *  3. GOALS ARE CASUAL-CALIBRATED. Dense boards are harder, so targets are
 *     LOW (the casual autoplayer wins at the band's intended rate). A short
 *     reachable sprint on a tense board, not a grind on an empty one.
 *  4. One wide master roster (all tetrominoes, no S1) everywhere; bigstart
 *     only on deliberate Big-Blocks moments (on OPEN patterns — big pieces on
 *     dense patterns are unfair).
 *
 * Run: node tools/blocks/build-campaign.mjs
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BALANCE_VERSION = 1;

/* ---------------- difficulty-band templates ----------------
 * solvabilityPolicy is the "mini-puzzle dial": the AFTER_CLEAR share rises
 * with difficulty — more pools that demand a clear before everything fits. */

const BANDS = {
  TUTORIAL: {
    tierMix: { flexible: 0.45, normal: 0.5, demanding: 0.05, killer: 0 },
    batchClassWeights: { recovery: 0.32, normal: 0.63, pressure: 0.05 },
    solvabilityPolicy: { SOLVABLE_NOW: 0.6, SOLVABLE_AFTER_CLEAR: 0.38, DANGEROUS: 0.02, DEAD: 0 },
    maxPressureStreak: 1,
  },
  EASY: {
    tierMix: { flexible: 0.4, normal: 0.5, demanding: 0.09, killer: 0.01 },
    batchClassWeights: { recovery: 0.28, normal: 0.65, pressure: 0.07 },
    solvabilityPolicy: { SOLVABLE_NOW: 0.45, SOLVABLE_AFTER_CLEAR: 0.5, DANGEROUS: 0.05, DEAD: 0 },
    maxPressureStreak: 1,
  },
  NORMAL: {
    tierMix: { flexible: 0.32, normal: 0.5, demanding: 0.15, killer: 0.03 },
    batchClassWeights: { recovery: 0.18, normal: 0.67, pressure: 0.15 },
    solvabilityPolicy: { SOLVABLE_NOW: 0.3, SOLVABLE_AFTER_CLEAR: 0.62, DANGEROUS: 0.08, DEAD: 0 },
    maxPressureStreak: 1,
  },
  HARD: {
    tierMix: { flexible: 0.22, normal: 0.48, demanding: 0.24, killer: 0.06 },
    batchClassWeights: { recovery: 0.15, normal: 0.55, pressure: 0.3 },
    solvabilityPolicy: { SOLVABLE_NOW: 0.22, SOLVABLE_AFTER_CLEAR: 0.66, DANGEROUS: 0.12, DEAD: 0 },
    maxPressureStreak: 1,
  },
  PEAK: {
    tierMix: { flexible: 0.15, normal: 0.45, demanding: 0.28, killer: 0.12 },
    batchClassWeights: { recovery: 0.15, normal: 0.5, pressure: 0.35 },
    solvabilityPolicy: { SOLVABLE_NOW: 0.18, SOLVABLE_AFTER_CLEAR: 0.68, DANGEROUS: 0.14, DEAD: 0 },
    maxPressureStreak: 1,
  },
};

/** Per-level tierMix for deliberate "big pieces" moments. */
const BIG_MIX = { flexible: 0.15, normal: 0.4, demanding: 0.35, killer: 0.1 };

const RESTART = {
  openingRepeatAttempts: 2,
  variationBuckets: [
    { attempts: [1, 2], bucket: 'A' },
    { attempts: [3, 4], bucket: 'B' },
    { attempts: [5, 999], bucket: 'C_ROTATING' },
  ],
};

/* ---------------- named roster presets ([shape, weight]) ---------------- */

const ROSTERS = {
  // THE backbone: every tetromino family + small corners + rectangles, NO S1.
  master: [
    ['H2', 5], ['V2', 5], ['H3', 7], ['V3', 7], ['R2x2', 9],
    ['L2x2_NW', 6], ['L2x2_NE', 6], ['L2x2_SW', 6], ['L2x2_SE', 6],
    ['H4', 6], ['V4', 6], ['R2x3', 6], ['R3x2', 6],
    ['T4_DOWN', 5], ['T4_UP', 5], ['T4_LEFT', 4], ['T4_RIGHT', 4],
    ['L2x3_NW', 4], ['L2x3_NE', 4], ['L2x3_SW', 4], ['L2x3_SE', 4],
    ['L3x2_NW', 4], ['L3x2_NE', 4], ['L3x2_SW', 4], ['L3x2_SE', 4],
    ['SZ_S_H', 4], ['SZ_Z_H', 4], ['SZ_S_V', 4], ['SZ_Z_V', 4],
    ['H5', 3], ['V5', 3], ['R3x3', 4], ['D3_ASC', 2], ['D3_DESC', 2],
    ['L3x3_NE', 2], ['L3x3_SW', 2],
  ],
  // "Big Blocks" hero roster — only on OPEN (bottom-heavy) patterns.
  bigstart: [['R3x3', 14], ['R2x3', 12], ['R3x2', 12], ['R2x2', 9], ['L3x3_NE', 5], ['L3x3_SW', 5], ['T4_DOWN', 4], ['T4_UP', 4], ['H3', 4], ['V3', 4]],
};

/* ---------------- authored board patterns ----------------
 * Symmetric, 25–44% fill, near-complete lines (rows of 6/8), NEVER a full
 * row/column. '#' = a colour block (deterministic random colour per level).
 * Density ladder: cradle 25% < checker2 25% < comb 28% < steps 28% <
 * frame 28% < walls 34% < diamond 37% < gate 44%. */

const PATTERNS = {
  cradle: [
    '........',
    '........',
    '........',
    '........',
    '........',
    '.##..##.',
    '###..###',
    '##.##.##',
  ],
  checker2: [
    '........',
    '.##..##.',
    '.##..##.',
    '........',
    '........',
    '.##..##.',
    '.##..##.',
    '........',
  ],
  comb: [
    '........',
    '........',
    '........',
    '#.#..#.#',
    '#.#..#.#',
    '#.#..#.#',
    '##.##.##',
    '........',
  ],
  steps: [
    '........',
    '........',
    '#......#',
    '##....##',
    '###..###',
    '##....##',
    '#......#',
    '........',
  ],
  frame: [
    '........',
    '.######.',
    '.#....#.',
    '.#....#.',
    '.#....#.',
    '.######.',
    '........',
    '........',
  ],
  walls: [
    '........',
    '#......#',
    '#......#',
    '##....##',
    '##....##',
    '#..##..#',
    '.######.',
    '........',
  ],
  diamond: [
    '........',
    '...##...',
    '..####..',
    '.######.',
    '.######.',
    '..####..',
    '...##...',
    '........',
  ],
  gate: [
    '........',
    '##....##',
    '##....##',
    '##....##',
    '##.##.##',
    '##.##.##',
    '.##..##.',
    '........',
  ],
};

/** Deterministic PRNG (same algorithm the runtime uses). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Instantiate a pattern: every '#' gets a deterministic random colour. */
function patternBoard(name, seed) {
  const rows = PATTERNS[name];
  if (!rows) throw new Error(`unknown pattern "${name}"`);
  const rng = mulberry32(seed);
  return rows.map((row) => row.replace(/#/g, () => String(Math.floor(rng() * 8))));
}

function setCell(board, r, c, ch) {
  board[r] = board[r].slice(0, c) + ch + board[r].slice(c + 1);
}

/* ---------------- level factory ---------------- */

function roster(name) {
  return ROSTERS[name].map(([shape, weight]) => ({ shape, weight }));
}

function batchPolicy(band, tierMixOverride, opening) {
  const b = BANDS[band];
  return {
    ...(opening ? { openingBatches: opening } : {}),
    tierMix: tierMixOverride ?? b.tierMix,
    batchClassWeights: b.batchClassWeights,
    candidateAttempts: band === 'HARD' || band === 'PEAK' ? 50 : 36,
    maxPressureStreak: b.maxPressureStreak,
    maxSameFamilyPerBatch: 2,
    repeatCooldown: 2,
    solvabilityPolicy: b.solvabilityPolicy,
  };
}

function seedOf(id) {
  return parseInt(id.slice(-3), 10) * 7919 + 13;
}

/**
 * COLLECT level. pattern: PATTERNS key. quotas: {symbol:required}.
 * presets: {symbol:[[r,c],...]} — placed ON the pattern (an empty coord gets
 * a colour block first, so specials always sit on real tiles).
 * opts: { tierMix, opening }.
 */
function collect(id, band, archetype, rosterName, pattern, quotas, presets, targetTuning, par, opts = {}) {
  const board = patternBoard(pattern, seedOf(id));
  const rng = mulberry32(seedOf(id) ^ 0x51ed);
  const specials = [];
  for (const [symbol, coords] of Object.entries(presets)) {
    for (const [r, c] of coords) {
      if (board[r][c] === '.') setCell(board, r, c, String(Math.floor(rng() * 8)));
      specials.push({ row: r, col: c, symbol: Number(symbol) });
    }
  }
  const perTarget = Object.entries(quotas).map(([symbol, required]) => {
    const s = Number(symbol);
    const presetCount = (presets[symbol] ?? []).length;
    const supply = targetTuning.supply?.[symbol] ?? Math.ceil(required * targetTuning.supplyMul);
    return {
      symbol: s,
      presetCount,
      generatedBudget: Math.max(0, supply - presetCount),
      baseSpawnWeight: 1,
      pityLimitBatches: targetTuning.pity ?? 3,
      minFutureSupplySafety: 1,
    };
  });
  return {
    id,
    difficultyBand: band,
    archetype,
    goalType: 'collect',
    board,
    goal: { type: 'collect', quotas: Object.entries(quotas).map(([symbol, count]) => ({ symbol: Number(symbol), count })) },
    specials,
    pieces: roster(rosterName),
    batchPolicy: batchPolicy(band, opts.tierMix, opts.opening),
    targetPolicy: {
      targetBatchChance: targetTuning.chance ?? 0.75,
      urgencyStrength: 1.2,
      maxTargetsPerPiece: targetTuning.maxPerPiece ?? 2,
      maxTargetsPerBatch: targetTuning.maxPerBatch ?? 2,
      perTarget,
    },
    restartPolicy: RESTART,
    par,
    difficulty: bandDifficulty(band),
    balanceVersion: BALANCE_VERSION,
  };
}

/** SCORE level on a pattern. opts as in collect(). */
function score(id, band, archetype, rosterName, pattern, scoreGoal, par, opts = {}) {
  return {
    id,
    difficultyBand: band,
    archetype,
    goalType: 'score',
    board: patternBoard(pattern, seedOf(id)),
    goal: { type: 'score', target: scoreGoal },
    pieces: roster(rosterName),
    batchPolicy: batchPolicy(band, opts.tierMix, opts.opening),
    restartPolicy: RESTART,
    scorePolicy: { placementPerTile: 1, clearBasePoints: 10, comboStep: 1.0, comboMax: 8.0 },
    par,
    difficulty: bandDifficulty(band),
    balanceVersion: BALANCE_VERSION,
  };
}

function bandDifficulty(band) {
  return { TUTORIAL: 1, EASY: 2, NORMAL: 4, HARD: 6, PEAK: 8 }[band];
}

const t = (supplyMul, extra = {}) => ({ supplyMul, ...extra }); // target tuning shorthand

/* ---------------- the 40-level campaign (v8) ---------------- */

const LEVELS = [
  /* -- 1–2 : SCORE ONBOARDING on gentle patterns + authored first batches -- */
  score('blocks_001', 'TUTORIAL', 'Open Build', 'master', 'cradle', 80, 12, {
    opening: [['R2x2', 'H3', 'L2x2_SE'], ['R2x3', 'V3', 'T4_DOWN']],
  }),
  score('blocks_002', 'EASY', 'Open Build', 'master', 'checker2', 90, 14, {
    opening: [['R2x3', 'L3x2_NW', 'R2x2']],
  }),

  /* -- 3–5 : SYMBOL CASCADE (one type, +1, +1) on puzzle starts -- */
  collect('blocks_003', 'EASY', 'Target Intro', 'master', 'cradle', { 0: 4 }, { 0: [[6, 1], [6, 6], [5, 2], [5, 5]] }, t(1.9, { chance: 0.85 }), 12, {
    opening: [['R2x2', 'L2x3_SE', 'H3']],
  }),
  collect('blocks_004', 'EASY', 'Cascade +1', 'master', 'checker2', { 0: 3, 1: 3 }, { 0: [[1, 2], [6, 5]], 1: [[2, 5], [5, 2]] }, t(1.7, { chance: 0.8 }), 14),
  collect('blocks_005', 'EASY', 'Cascade +2', 'master', 'diamond', { 0: 3, 1: 3, 2: 3 }, { 0: [[3, 2], [4, 5]], 1: [[2, 3], [5, 4]], 2: [[3, 5], [4, 2]] }, t(1.7, { chance: 0.8 }), 16),

  /* -- 6 : BIG BLOCKS wow-break (open bottom-heavy pattern) -- */
  score('blocks_006', 'EASY', 'Big Blocks', 'bigstart', 'cradle', 90, 14, { tierMix: BIG_MIX }),

  /* -- 7–15 : PRACTICE + intros of symbols 3 and 4 -- */
  collect('blocks_007', 'NORMAL', 'Target Intro', 'master', 'steps', { 3: 4 }, { 3: [[4, 1], [4, 6]] }, t(1.6, { chance: 0.8 }), 14),
  collect('blocks_008', 'NORMAL', 'Cascade +1', 'master', 'steps', { 3: 3, 4: 3 }, { 3: [[3, 1], [4, 2]], 4: [[3, 6], [4, 5]] }, t(1.6, { chance: 0.8 }), 14),
  score('blocks_009', 'NORMAL', 'Combo', 'master', 'frame', 90, 16),
  collect('blocks_010', 'NORMAL', 'Locked Targets', 'master', 'frame', { 2: 3 }, { 2: [[1, 2], [1, 5], [5, 2], [5, 5], [3, 1]] }, t(1.5, { chance: 0.75 }), 14),
  collect('blocks_011', 'NORMAL', 'Multi-Target', 'master', 'comb', { 0: 3, 3: 3 }, { 0: [[6, 1], [3, 0]], 3: [[6, 6], [3, 7]] }, t(1.5, { chance: 0.8 }), 14),
  score('blocks_012', 'NORMAL', 'Multi-Clear', 'master', 'comb', 110, 18),
  collect('blocks_013', 'NORMAL', 'Centre Dig', 'master', 'diamond', { 1: 4, 4: 4 }, { 1: [[3, 3], [4, 4]], 4: [[3, 4], [4, 3]] }, t(1.5, { chance: 0.8 }), 16),
  collect('blocks_014', 'EASY', 'Big Blocks Break', 'bigstart', 'cradle', { 0: 3, 2: 3 }, { 0: [[5, 1], [6, 2]], 2: [[5, 6], [6, 5]] }, t(1.7, { chance: 0.85 }), 12, { tierMix: BIG_MIX }),
  score('blocks_015', 'NORMAL', 'Multi-Clear', 'master', 'steps', 140, 18),

  /* -- 16–22 : EXPAND (3-type goals, HARD debut) -- */
  collect('blocks_016', 'NORMAL', 'Multi-Target', 'master', 'walls', { 0: 2, 1: 2, 3: 2 }, { 0: [[6, 2]], 1: [[6, 5]], 3: [[3, 1]] }, t(1.5, { chance: 0.8 }), 16),
  collect('blocks_017', 'HARD', 'Locked Targets', 'master', 'gate', { 2: 6 }, { 2: [[1, 1], [1, 6], [4, 3], [4, 4], [5, 1], [5, 6]] }, t(1.4, { chance: 0.75 }), 18),
  score('blocks_018', 'HARD', 'Survival Score', 'master', 'gate', 110, 20),
  collect('blocks_019', 'HARD', 'Comb Dig', 'master', 'comb', { 1: 4, 4: 3 }, { 1: [[3, 0], [4, 2]], 4: [[3, 7], [4, 5]] }, t(1.4, { chance: 0.75 }), 18),
  collect('blocks_020', 'HARD', 'Multi-Target', 'master', 'gate', { 0: 3, 1: 3, 4: 2 }, { 0: [[1, 1], [6, 2]], 1: [[1, 6]], 4: [[6, 5]] }, t(1.4, { chance: 0.75, maxPerBatch: 3 }), 18),
  collect('blocks_021', 'NORMAL', 'Diamond Dig', 'master', 'diamond', { 0: 5 }, { 0: [[2, 3], [3, 2], [4, 5]] }, t(1.5, { chance: 0.8 }), 16),
  score('blocks_022', 'NORMAL', 'Combo', 'master', 'walls', 100, 20),

  /* -- 23–30 : DEEPEN (denser patterns, HARD) -- */
  collect('blocks_023', 'NORMAL', 'Multi-Target', 'master', 'frame', { 0: 3, 3: 3 }, { 0: [[1, 1], [5, 6]], 3: [[1, 6], [5, 1]] }, t(1.45, { chance: 0.8 }), 16),
  collect('blocks_024', 'HARD', 'Gate Dig', 'master', 'gate', { 2: 5 }, { 2: [[1, 1], [4, 3], [6, 5]] }, t(1.4, { chance: 0.75 }), 18),
  collect('blocks_025', 'HARD', 'Mixed Source', 'master', 'walls', { 0: 4, 4: 4 }, { 0: [[3, 0], [5, 3]], 4: [[3, 7], [5, 4]] }, t(1.4, { chance: 0.75, maxPerBatch: 3 }), 20),
  collect('blocks_026', 'HARD', 'Comb Dig', 'master', 'comb', { 1: 6 }, { 1: [[3, 2], [4, 5], [6, 3], [6, 4]] }, t(1.4, { chance: 0.75 }), 20),
  score('blocks_027', 'HARD', 'Pressure Score', 'master', 'gate', 110, 22),
  collect('blocks_028', 'HARD', 'Multi-Target', 'master', 'diamond', { 0: 3, 2: 3, 3: 3 }, { 0: [[1, 3], [6, 4]], 2: [[3, 1], [4, 6]], 3: [[2, 2], [5, 5]] }, t(1.4, { chance: 0.75, maxPerBatch: 3 }), 20),
  collect('blocks_029', 'HARD', 'Big Pieces / Target', 'bigstart', 'cradle', { 2: 4 }, { 2: [[5, 1], [6, 0], [6, 7]] }, t(1.4, { chance: 0.8 }), 18, { tierMix: BIG_MIX }),
  collect('blocks_030', 'HARD', 'Walls Dig', 'master', 'walls', { 1: 4, 3: 3 }, { 1: [[1, 0], [6, 2]], 3: [[1, 7], [6, 5]] }, t(1.4, { chance: 0.75, maxPerBatch: 3 }), 22),

  /* -- 31–33 : SCORE CLUSTER (three in a row, reference rhythm) -- */
  score('blocks_031', 'NORMAL', 'Multi-Clear', 'master', 'steps', 140, 22),
  score('blocks_032', 'HARD', 'Combo', 'master', 'diamond', 150, 24),
  score('blocks_033', 'HARD', 'Pressure Score', 'master', 'walls', 120, 24),

  /* -- 34–40 : MARATHONS (multi-special flow on dense patterns) -- */
  collect('blocks_034', 'HARD', 'Marathon', 'master', 'walls', { 0: 4, 1: 4, 3: 4 },
    { 0: [[1, 0], [3, 0]], 1: [[1, 7], [3, 7]], 3: [[6, 3], [6, 4]] },
    t(1.4, { chance: 0.8, maxPerBatch: 3 }), 30),
  collect('blocks_035', 'HARD', 'Marathon / Big Pieces', 'bigstart', 'cradle', { 2: 3, 4: 3 },
    { 2: [[6, 1], [5, 2]], 4: [[6, 6], [5, 5]] },
    t(1.4, { chance: 0.8, maxPerBatch: 3 }), 30, { tierMix: BIG_MIX }),
  collect('blocks_036', 'HARD', 'Marathon', 'master', 'frame', { 0: 3, 2: 3, 3: 3, 4: 3 },
    { 0: [[1, 2]], 2: [[1, 5]], 3: [[5, 2]], 4: [[5, 5]] },
    t(1.4, { chance: 0.85, maxPerBatch: 3 }), 34),
  score('blocks_037', 'HARD', 'Pressure Score', 'master', 'checker2', 100, 26),
  collect('blocks_038', 'PEAK', 'Marathon / Diamond', 'master', 'diamond', { 0: 3, 1: 3, 4: 3 },
    { 0: [[2, 2]], 1: [[2, 5]], 4: [[5, 3]] },
    t(1.35, { chance: 0.85, maxPerBatch: 3 }), 32),
  collect('blocks_039', 'PEAK', 'Marathon / Big Pieces', 'bigstart', 'cradle', { 1: 3, 2: 3, 3: 3, 4: 3 },
    { 1: [[6, 0]], 2: [[6, 2]], 3: [[6, 5]], 4: [[6, 7]] },
    t(1.35, { chance: 0.85, maxPerBatch: 3 }), 36, { tierMix: BIG_MIX }),
  collect('blocks_040', 'PEAK', 'Final Marathon', 'master', 'gate', { 0: 3, 1: 3, 2: 3, 3: 3, 4: 3 },
    { 0: [[1, 0]], 1: [[1, 7]], 2: [[4, 3]], 3: [[4, 4]], 4: [[6, 1]] },
    t(1.3, { chance: 0.9, maxPerBatch: 3 }), 40),
];

/* ---------------- bake + invariants ---------------- */

const file = { version: 1, mechanic: 'blocks', balanceVersion: BALANCE_VERSION, levels: LEVELS };

for (const l of LEVELS) {
  for (const row of l.board) {
    if (!row.includes('.')) throw new Error(`${l.id}: a board row starts fully filled`);
  }
  for (let c = 0; c < 8; c++) {
    if (l.board.every((row) => row[c] !== '.')) throw new Error(`${l.id}: board column ${c} starts fully filled`);
  }
  if (l.pieces.some((p) => p.shape === 'S1')) throw new Error(`${l.id}: S1 must not be rostered`);
  if (l.goalType === 'collect') {
    for (const q of l.goal.quotas) {
      const pt = l.targetPolicy.perTarget.find((e) => e.symbol === q.symbol);
      const supply = (pt?.presetCount ?? 0) + (pt?.generatedBudget ?? 0);
      if (supply < q.count) throw new Error(`${l.id}: symbol ${q.symbol} supply ${supply} < quota ${q.count}`);
    }
  }
}

const out = resolve(root, 'public/levels/blocks_levels.json');
writeFileSync(out, JSON.stringify(file, null, 2) + '\n');
const modes = LEVELS.reduce((m, l) => ((m[l.goalType] = (m[l.goalType] ?? 0) + 1), m), {});
const fills = LEVELS.map((l) => l.board.join('').replace(/\./g, '').length);
console.log(`wrote ${LEVELS.length} levels -> ${out}`);
console.log(`mode mix: COLLECT ${modes.collect} / SCORE ${modes.score}`);
console.log(`score ladder: ${LEVELS.filter((l) => l.goalType === 'score').map((l) => l.goal.target).join(' → ')}`);
console.log(`board fill: min ${Math.min(...fills)} max ${Math.max(...fills)} avg ${(fills.reduce((a, b) => a + b, 0) / fills.length).toFixed(0)} cells`);
