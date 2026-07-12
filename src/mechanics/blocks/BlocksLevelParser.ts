import { isPieceShape, PIECE_SHAPES } from './blocksPieces';
import { TILE_COLOR_COUNT } from './BlocksModel';
import {
  SPECIAL_SYMBOL_COUNT,
  type BlocksGoal,
  type BlocksLevelConfig,
  type BlocksPoolEntry,
  type BoardSpecial,
} from './BlocksTypes';

/**
 * Validates the external blocks level JSON before it reaches gameplay code.
 * Any structural problem throws an Error with an actionable message (surfaced
 * on the error screen instead of a silent crash) — mirrors the sorting parser.
 */
export function parseBlocksLevels(json: unknown): BlocksLevelConfig[] {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Blocks levels config: root must be an object.');
  }
  const file = json as Record<string, unknown>;
  if (file.mechanic !== 'blocks') {
    throw new Error(`Blocks levels config: expected mechanic "blocks", got "${String(file.mechanic)}".`);
  }
  if (!Array.isArray(file.levels) || file.levels.length === 0) {
    throw new Error('Blocks levels config: "levels" must be a non-empty array.');
  }
  const seenIds = new Set<string>();
  return file.levels.map((raw, i) => validateLevel(raw, i, seenIds));
}

function validateLevel(raw: unknown, index: number, seenIds: Set<string>): BlocksLevelConfig {
  const at = `Blocks level #${index + 1}`;
  if (typeof raw !== 'object' || raw === null) throw new Error(`${at}: must be an object.`);
  const lvl = raw as Record<string, unknown>;

  const id = lvl.id;
  if (typeof id !== 'string' || !id.trim()) throw new Error(`${at}: "id" must be a string.`);
  if (seenIds.has(id)) throw new Error(`${at}: duplicated id "${id}".`);
  seenIds.add(id);

  const rows = lvl.rows ?? 8;
  const cols = lvl.cols ?? 8;
  if (!Number.isInteger(rows) || (rows as number) < 5 || (rows as number) > 10) {
    throw new Error(`${at} (${id}): "rows" must be an integer in [5..10].`);
  }
  if (!Number.isInteger(cols) || (cols as number) < 5 || (cols as number) > 10) {
    throw new Error(`${at} (${id}): "cols" must be an integer in [5..10].`);
  }
  const rowsN = rows as number;
  const colsN = cols as number;

  const board = lvl.board;
  if (!Array.isArray(board) || board.length !== rowsN) {
    throw new Error(`${at} (${id}): "board" must be an array of ${rowsN} row strings.`);
  }
  board.forEach((row, r) => {
    if (typeof row !== 'string' || row.length !== colsN) {
      throw new Error(`${at} (${id}): board row ${r} must be a string of length ${colsN}.`);
    }
    for (const ch of row) {
      if (ch === '.') continue;
      const color = Number(ch);
      if (!/^[0-9]$/.test(ch) || color >= TILE_COLOR_COUNT) {
        throw new Error(
          `${at} (${id}): board row ${r}: cell "${ch}" must be "." or a digit 0..${TILE_COLOR_COUNT - 1}.`,
        );
      }
    }
  });

  // A row/column that starts complete would clear on the first move for free —
  // that is authoring noise, not a puzzle; reject it early.
  const boardRows = board as string[];
  boardRows.forEach((row, r) => {
    if (![...row].includes('.')) {
      throw new Error(`${at} (${id}): board row ${r} starts fully filled — it would clear immediately.`);
    }
  });
  for (let c = 0; c < colsN; c++) {
    if (boardRows.every((row) => row[c] !== '.')) {
      throw new Error(`${at} (${id}): board column ${c} starts fully filled — it would clear immediately.`);
    }
  }

  const goal = parseGoal(lvl.goal, at, id);
  const specials = parseSpecials(lvl.specials, at, id, rowsN, colsN);

  const pieces = lvl.pieces;
  if (!Array.isArray(pieces) || pieces.length === 0) {
    throw new Error(`${at} (${id}): "pieces" must be a non-empty array.`);
  }
  const pool: BlocksPoolEntry[] = pieces.map((p, pi) => {
    if (typeof p !== 'object' || p === null) throw new Error(`${at} (${id}): pieces[${pi}] must be an object.`);
    const entry = p as Record<string, unknown>;
    if (typeof entry.shape !== 'string' || !isPieceShape(entry.shape)) {
      throw new Error(`${at} (${id}): pieces[${pi}]: unknown shape "${String(entry.shape)}".`);
    }
    const geo = PIECE_SHAPES[entry.shape];
    if (geo.rows > rowsN || geo.cols > colsN) {
      throw new Error(`${at} (${id}): pieces[${pi}]: shape "${entry.shape}" does not fit the board.`);
    }
    if (typeof entry.weight !== 'number' || entry.weight <= 0) {
      throw new Error(`${at} (${id}): pieces[${pi}]: "weight" must be a positive number.`);
    }
    if (entry.color !== undefined) {
      if (!Number.isInteger(entry.color) || (entry.color as number) < 0 || (entry.color as number) >= TILE_COLOR_COUNT) {
        throw new Error(`${at} (${id}): pieces[${pi}]: "color" must be an integer 0..${TILE_COLOR_COUNT - 1}.`);
      }
      return { shape: entry.shape, weight: entry.weight, color: entry.color as number };
    }
    return { shape: entry.shape, weight: entry.weight };
  });

  const par = lvl.par;
  if (!Number.isInteger(par) || (par as number) < 1) {
    throw new Error(`${at} (${id}): "par" must be a positive integer.`);
  }
  const difficulty = lvl.difficulty ?? 1;
  if (!Number.isInteger(difficulty) || (difficulty as number) < 1) {
    throw new Error(`${at} (${id}): "difficulty" must be a positive integer.`);
  }

  // preset specials must land on cells declared in the board layout
  specials.forEach((s, si) => {
    if (board[s.row][s.col] === '.') {
      throw new Error(
        `${at} (${id}): specials[${si}] at (${s.row},${s.col}) sits on an empty board cell.`,
      );
    }
  });

  // optional v3 balance policies (additive; validated when present)
  const rosterIds = new Set(pool.map((p) => p.shape));
  const v3 = parseBalancePolicies(lvl, at, id, goal, rosterIds);

  return {
    id,
    rows: rowsN,
    cols: colsN,
    board: board as string[],
    goal,
    pieces: pool,
    specials: specials.length > 0 ? specials : undefined,
    par: par as number,
    difficulty: difficulty as number,
    ...v3,
  };
}

const DIFFICULTY_BANDS = new Set(['TUTORIAL', 'EASY', 'NORMAL', 'HARD', 'PEAK']);

/**
 * Validates the optional Balance-Spec-v3 policy blocks. All are optional; a
 * level without them uses the simple weighted draw. Returns only the fields
 * that were present so defaults stay `undefined`.
 */
function parseBalancePolicies(
  lvl: Record<string, unknown>,
  at: string,
  id: string,
  goal: BlocksGoal,
  rosterIds: Set<string>,
): Partial<BlocksLevelConfig> {
  const out: Partial<BlocksLevelConfig> = {};
  const num = (v: unknown, name: string, lo = 0, hi = Number.POSITIVE_INFINITY) => {
    if (typeof v !== 'number' || v < lo || v > hi) {
      throw new Error(`${at} (${id}): ${name} must be a number in [${lo}..${hi}].`);
    }
    return v;
  };
  const sumsToOne = (parts: number[], name: string) => {
    const s = parts.reduce((a, b) => a + b, 0);
    if (Math.abs(s - 1) > 0.02) throw new Error(`${at} (${id}): ${name} must sum to ~1 (got ${s.toFixed(3)}).`);
  };

  if (lvl.difficultyBand !== undefined) {
    if (typeof lvl.difficultyBand !== 'string' || !DIFFICULTY_BANDS.has(lvl.difficultyBand)) {
      throw new Error(`${at} (${id}): "difficultyBand" must be one of TUTORIAL/EASY/NORMAL/HARD/PEAK.`);
    }
    out.difficultyBand = lvl.difficultyBand as BlocksLevelConfig['difficultyBand'];
  }
  if (lvl.archetype !== undefined) {
    if (typeof lvl.archetype !== 'string') throw new Error(`${at} (${id}): "archetype" must be a string.`);
    out.archetype = lvl.archetype;
  }
  if (lvl.balanceVersion !== undefined) out.balanceVersion = num(lvl.balanceVersion, '"balanceVersion"', 1);

  if (lvl.batchPolicy !== undefined) {
    const bp = lvl.batchPolicy as Record<string, unknown>;
    if (typeof bp !== 'object' || bp === null) throw new Error(`${at} (${id}): "batchPolicy" must be an object.`);
    if (bp.openingBatches !== undefined) {
      if (!Array.isArray(bp.openingBatches)) throw new Error(`${at} (${id}): openingBatches must be an array.`);
      bp.openingBatches.forEach((b, bi) => {
        if (!Array.isArray(b) || b.length !== 3) {
          throw new Error(`${at} (${id}): openingBatches[${bi}] must be 3 shape ids.`);
        }
        b.forEach((s) => {
          if (!isPieceShape(String(s))) throw new Error(`${at} (${id}): openingBatches[${bi}] unknown shape "${s}".`);
          if (!rosterIds.has(String(s))) throw new Error(`${at} (${id}): openingBatches[${bi}] shape "${s}" not in roster.`);
        });
      });
    }
    if (bp.tierMix !== undefined) {
      const t = bp.tierMix as Record<string, number>;
      ['flexible', 'normal', 'demanding', 'killer'].forEach((k) => num(t[k], `tierMix.${k}`));
      sumsToOne([t.flexible, t.normal, t.demanding, t.killer], 'tierMix');
    }
    if (bp.batchClassWeights !== undefined) {
      const w = bp.batchClassWeights as Record<string, number>;
      ['recovery', 'normal', 'pressure'].forEach((k) => num(w[k], `batchClassWeights.${k}`));
      sumsToOne([w.recovery, w.normal, w.pressure], 'batchClassWeights');
    }
    if (bp.solvabilityPolicy !== undefined) {
      const sp = bp.solvabilityPolicy as Record<string, number>;
      ['SOLVABLE_NOW', 'SOLVABLE_AFTER_CLEAR', 'DANGEROUS', 'DEAD'].forEach((k) => num(sp[k], `solvabilityPolicy.${k}`, 0, 1));
      if (sp.DEAD !== 0) throw new Error(`${at} (${id}): solvabilityPolicy.DEAD must be 0 in production.`);
    }
    ['candidateAttempts', 'maxPressureStreak', 'maxSameFamilyPerBatch', 'repeatCooldown'].forEach((k) => {
      if (bp[k] !== undefined) num(bp[k], `batchPolicy.${k}`, 0);
    });
    if (bp.honest !== undefined && typeof bp.honest !== 'boolean') {
      throw new Error(`${at} (${id}): batchPolicy.honest must be a boolean.`);
    }
    out.batchPolicy = bp as unknown as BlocksLevelConfig['batchPolicy'];
  }

  if (lvl.targetPolicy !== undefined) {
    if (goal.type !== 'collect') throw new Error(`${at} (${id}): "targetPolicy" is only valid on a collect goal.`);
    const tp = lvl.targetPolicy as Record<string, unknown>;
    if (!Array.isArray(tp.perTarget) || tp.perTarget.length === 0) {
      throw new Error(`${at} (${id}): targetPolicy.perTarget must be a non-empty array.`);
    }
    ['targetBatchChance', 'urgencyStrength', 'maxTargetsPerPiece', 'maxTargetsPerBatch'].forEach((k) => {
      if (tp[k] !== undefined) num(tp[k], `targetPolicy.${k}`, 0);
    });
    const quotaSymbols = new Set(goal.quotas.map((q) => q.symbol));
    (tp.perTarget as Record<string, unknown>[]).forEach((e, ei) => {
      if (!Number.isInteger(e.symbol) || !quotaSymbols.has(e.symbol as number)) {
        throw new Error(`${at} (${id}): targetPolicy.perTarget[${ei}].symbol must match a quota symbol.`);
      }
      num(e.generatedBudget, `perTarget[${ei}].generatedBudget`, 0);
      if (e.presetCount !== undefined) num(e.presetCount, `perTarget[${ei}].presetCount`, 0);
      if (e.pityLimitBatches !== undefined) num(e.pityLimitBatches, `perTarget[${ei}].pityLimitBatches`, 1);
    });
    out.targetPolicy = tp as unknown as BlocksLevelConfig['targetPolicy'];
  }

  if (lvl.restartPolicy !== undefined) out.restartPolicy = lvl.restartPolicy as BlocksLevelConfig['restartPolicy'];
  if (lvl.scorePolicy !== undefined && typeof lvl.scorePolicy === 'object') {
    out.scorePolicy = lvl.scorePolicy as BlocksLevelConfig['scorePolicy'];
  }
  return out;
}

function parseGoal(raw: unknown, at: string, id: string): BlocksGoal {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${at} (${id}): "goal" must be an object.`);
  }
  const goal = raw as Record<string, unknown>;
  if (goal.type === 'endless') {
    return { type: 'endless' };
  }
  if (goal.type === 'score') {
    if (!Number.isInteger(goal.target) || (goal.target as number) < 1) {
      throw new Error(`${at} (${id}): score goal "target" must be a positive integer.`);
    }
    return { type: 'score', target: goal.target as number };
  }
  if (goal.type === 'collect') {
    if (!Array.isArray(goal.quotas) || goal.quotas.length === 0) {
      throw new Error(`${at} (${id}): collect goal needs a non-empty "quotas" array.`);
    }
    const seen = new Set<number>();
    const quotas = goal.quotas.map((q, qi) => {
      if (typeof q !== 'object' || q === null) {
        throw new Error(`${at} (${id}): quotas[${qi}] must be an object.`);
      }
      const e = q as Record<string, unknown>;
      if (!Number.isInteger(e.symbol) || (e.symbol as number) < 0 || (e.symbol as number) >= SPECIAL_SYMBOL_COUNT) {
        throw new Error(`${at} (${id}): quotas[${qi}]: "symbol" must be 0..${SPECIAL_SYMBOL_COUNT - 1}.`);
      }
      if (seen.has(e.symbol as number)) {
        throw new Error(`${at} (${id}): quotas[${qi}]: symbol ${e.symbol} listed twice.`);
      }
      seen.add(e.symbol as number);
      if (!Number.isInteger(e.count) || (e.count as number) < 1) {
        throw new Error(`${at} (${id}): quotas[${qi}]: "count" must be a positive integer.`);
      }
      return { symbol: e.symbol as number, count: e.count as number };
    });
    return { type: 'collect', quotas };
  }
  throw new Error(`${at} (${id}): goal "type" must be "score", "collect" or "endless".`);
}

function parseSpecials(
  raw: unknown,
  at: string,
  id: string,
  rowsN: number,
  colsN: number,
): BoardSpecial[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${at} (${id}): "specials" must be an array.`);
  const seen = new Set<number>();
  return raw.map((s, si) => {
    if (typeof s !== 'object' || s === null) throw new Error(`${at} (${id}): specials[${si}] must be an object.`);
    const e = s as Record<string, unknown>;
    if (!Number.isInteger(e.row) || (e.row as number) < 0 || (e.row as number) >= rowsN) {
      throw new Error(`${at} (${id}): specials[${si}]: "row" out of range.`);
    }
    if (!Number.isInteger(e.col) || (e.col as number) < 0 || (e.col as number) >= colsN) {
      throw new Error(`${at} (${id}): specials[${si}]: "col" out of range.`);
    }
    const key = (e.row as number) * colsN + (e.col as number);
    if (seen.has(key)) throw new Error(`${at} (${id}): specials[${si}]: duplicate cell.`);
    seen.add(key);
    if (!Number.isInteger(e.symbol) || (e.symbol as number) < 0 || (e.symbol as number) >= SPECIAL_SYMBOL_COUNT) {
      throw new Error(`${at} (${id}): specials[${si}]: "symbol" must be 0..${SPECIAL_SYMBOL_COUNT - 1}.`);
    }
    return { row: e.row as number, col: e.col as number, symbol: e.symbol as number };
  });
}
