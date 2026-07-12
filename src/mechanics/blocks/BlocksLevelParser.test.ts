import { describe, it, expect } from 'vitest';
import { parseBlocksLevels } from './BlocksLevelParser';
import shippedLevels from '../../../public/levels/blocks_levels.json';

function file(levels: unknown[]): unknown {
  return { version: 1, mechanic: 'blocks', levels };
}

function level(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'blocks_001',
    rows: 8,
    cols: 8,
    board: Array(8).fill('........'),
    goal: { type: 'score', target: 100 },
    pieces: [{ shape: 'S1', weight: 1 }],
    par: 8,
    difficulty: 1,
    ...partial,
  };
}

describe('parseBlocksLevels', () => {
  it('accepts the shipped blocks_levels.json (40-level campaign, ~2:1 mode mix)', () => {
    const parsed = parseBlocksLevels(shippedLevels);
    expect(parsed).toHaveLength(40);
    expect(new Set(parsed.map((l) => l.goal.type))).toEqual(new Set(['collect', 'score']));
    const collect = parsed.filter((l) => l.goal.type === 'collect').length;
    expect(collect).toBe(27); // 27 COLLECT / 13 SCORE (score-forward opening: L1 is score)
    // every level carries a batchPolicy + difficulty band (v3 balance metadata)
    expect(parsed.every((l) => l.batchPolicy && l.difficultyBand)).toBe(true);
  });

  it('parses a valid file and applies rows/cols defaults', () => {
    const raw = level();
    delete raw.rows;
    delete raw.cols;
    const parsed = parseBlocksLevels(file([raw]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].rows).toBe(8);
    expect(parsed[0].cols).toBe(8);
    expect(parsed[0].goal).toEqual({ type: 'score', target: 100 });
  });

  it('rejects a wrong mechanic tag', () => {
    expect(() => parseBlocksLevels({ version: 1, mechanic: 'sorting', levels: [level()] })).toThrow(
      /expected mechanic "blocks"/,
    );
  });

  it('rejects duplicated level ids', () => {
    expect(() => parseBlocksLevels(file([level(), level()]))).toThrow(/duplicated id/);
  });

  it('rejects a board row of the wrong length', () => {
    const bad = level({ board: ['....', ...Array(7).fill('........')] });
    expect(() => parseBlocksLevels(file([bad]))).toThrow(/row 0 must be a string of length 8/);
  });

  it('rejects an invalid board character', () => {
    const bad = level({ board: ['...x....', ...Array(7).fill('........')] });
    expect(() => parseBlocksLevels(file([bad]))).toThrow(/must be "." or a digit/);
  });

  it('rejects an unknown piece shape and a non-positive weight', () => {
    expect(() => parseBlocksLevels(file([level({ pieces: [{ shape: 'nope', weight: 1 }] })]))).toThrow(
      /unknown shape "nope"/,
    );
    expect(() => parseBlocksLevels(file([level({ pieces: [{ shape: 'S1', weight: 0 }] })]))).toThrow(
      /"weight" must be a positive number/,
    );
  });

  it('accepts a collect goal with quotas', () => {
    const ok = level({ goal: { type: 'collect', quotas: [{ symbol: 0, count: 5 }, { symbol: 3, count: 2 }] } });
    const parsed = parseBlocksLevels(file([ok]));
    expect(parsed[0].goal).toEqual({
      type: 'collect',
      quotas: [{ symbol: 0, count: 5 }, { symbol: 3, count: 2 }],
    });
  });

  it('rejects a collect goal with empty/invalid quotas', () => {
    expect(() => parseBlocksLevels(file([level({ goal: { type: 'collect', quotas: [] } })]))).toThrow(
      /non-empty "quotas"/,
    );
    expect(() =>
      parseBlocksLevels(file([level({ goal: { type: 'collect', quotas: [{ symbol: 9, count: 1 }] } })])),
    ).toThrow(/"symbol" must be 0\.\.4/);
    expect(() =>
      parseBlocksLevels(file([level({ goal: { type: 'collect', quotas: [{ symbol: 0, count: 0 }] } })])),
    ).toThrow(/"count" must be a positive integer/);
  });

  it('accepts an endless goal', () => {
    const parsed = parseBlocksLevels(file([level({ goal: { type: 'endless' } })]));
    expect(parsed[0].goal).toEqual({ type: 'endless' });
  });

  it('rejects an unknown goal type', () => {
    expect(() => parseBlocksLevels(file([level({ goal: { type: 'clear' } })]))).toThrow(
      /goal "type" must be "score", "collect" or "endless"/,
    );
  });

  it('parses board specials and rejects ones on empty cells', () => {
    const ok = level({
      goal: { type: 'collect', quotas: [{ symbol: 2, count: 1 }] },
      board: ['3.......', ...Array(7).fill('........')],
      specials: [{ row: 0, col: 0, symbol: 2 }],
    });
    expect(parseBlocksLevels(file([ok]))[0].specials).toEqual([{ row: 0, col: 0, symbol: 2 }]);
    const bad = level({
      goal: { type: 'collect', quotas: [{ symbol: 2, count: 1 }] },
      specials: [{ row: 0, col: 0, symbol: 2 }],
    });
    expect(() => parseBlocksLevels(file([bad]))).toThrow(/sits on an empty board cell/);
  });

  it('rejects a board with a pre-completed row or column', () => {
    const fullRow = level({ board: ['00000000', ...Array(7).fill('........')] });
    expect(() => parseBlocksLevels(file([fullRow]))).toThrow(/row 0 starts fully filled/);
    const fullCol = level({ board: Array(8).fill('0.......') });
    expect(() => parseBlocksLevels(file([fullCol]))).toThrow(/column 0 starts fully filled/);
  });

  it('rejects a score goal without a positive target', () => {
    expect(() => parseBlocksLevels(file([level({ goal: { type: 'score', target: 0 } })]))).toThrow(
      /"target" must be a positive integer/,
    );
  });

  it('rejects a piece color outside the tile palette', () => {
    expect(() =>
      parseBlocksLevels(file([level({ pieces: [{ shape: 'S1', weight: 1, color: 8 }] })])),
    ).toThrow(/"color" must be an integer 0..7/);
  });

  /* ---------------- v3 balance policies ---------------- */

  it('parses valid v3 balance policies', () => {
    const ok = level({
      difficultyBand: 'NORMAL',
      archetype: 'Open Build',
      pieces: [{ shape: 'S1', weight: 2 }, { shape: 'H3', weight: 5 }],
      batchPolicy: {
        openingBatches: [['S1', 'H3', 'S1']],
        tierMix: { flexible: 0.4, normal: 0.4, demanding: 0.18, killer: 0.02 },
        batchClassWeights: { recovery: 0.18, normal: 0.67, pressure: 0.15 },
        candidateAttempts: 40,
        repeatCooldown: 2,
        solvabilityPolicy: { SOLVABLE_NOW: 0.55, SOLVABLE_AFTER_CLEAR: 0.4, DANGEROUS: 0.05, DEAD: 0 },
      },
    });
    const parsed = parseBlocksLevels(file([ok]));
    expect(parsed[0].difficultyBand).toBe('NORMAL');
    expect(parsed[0].batchPolicy?.tierMix?.demanding).toBe(0.18);
  });

  it('rejects a tierMix that does not sum to 1', () => {
    const bad = level({ batchPolicy: { tierMix: { flexible: 0.5, normal: 0.5, demanding: 0.5, killer: 0 } } });
    expect(() => parseBlocksLevels(file([bad]))).toThrow(/tierMix must sum to ~1/);
  });

  it('accepts an honest batchPolicy flag and rejects a non-boolean one', () => {
    const ok = level({ batchPolicy: { honest: true } });
    expect(parseBlocksLevels(file([ok]))[0].batchPolicy?.honest).toBe(true);
    const bad = level({ batchPolicy: { honest: 'yes' } });
    expect(() => parseBlocksLevels(file([bad]))).toThrow(/batchPolicy.honest must be a boolean/);
  });

  it('rejects a non-zero DEAD solvability share', () => {
    const bad = level({
      batchPolicy: { solvabilityPolicy: { SOLVABLE_NOW: 0.5, SOLVABLE_AFTER_CLEAR: 0.4, DANGEROUS: 0, DEAD: 0.1 } },
    });
    expect(() => parseBlocksLevels(file([bad]))).toThrow(/DEAD must be 0/);
  });

  it('rejects an opening batch shape that is not in the roster', () => {
    const bad = level({ pieces: [{ shape: 'S1', weight: 1 }], batchPolicy: { openingBatches: [['S1', 'H5', 'S1']] } });
    expect(() => parseBlocksLevels(file([bad]))).toThrow(/not in roster/);
  });

  it('rejects a targetPolicy on a score goal, and a perTarget symbol without a quota', () => {
    expect(() =>
      parseBlocksLevels(file([level({ targetPolicy: { perTarget: [{ symbol: 0, generatedBudget: 5 }] } })])),
    ).toThrow(/only valid on a collect goal/);
    const bad = level({
      goal: { type: 'collect', quotas: [{ symbol: 0, count: 3 }] },
      targetPolicy: { perTarget: [{ symbol: 2, generatedBudget: 5 }] },
    });
    expect(() => parseBlocksLevels(file([bad]))).toThrow(/must match a quota symbol/);
  });
});
