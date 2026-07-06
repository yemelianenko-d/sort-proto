import { SPECIAL, isSpecialColor } from './SortingTypes';
import type { ColorId, SortingLevelConfig } from './SortingTypes';
import { BLOCK_STYLES } from '../../app/gameConfig';

/**
 * Validates the external level JSON before it ever reaches gameplay code.
 * Any structural problem throws an Error with a message a human can act on
 * (shown on the error screen instead of a silent crash).
 */
export function parseSortingLevels(json: unknown): SortingLevelConfig[] {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Levels config: root must be an object.');
  }
  const file = json as Record<string, unknown>;
  if (file.mechanic !== 'sorting') {
    throw new Error(`Levels config: expected mechanic "sorting", got "${String(file.mechanic)}".`);
  }
  if (!Array.isArray(file.levels) || file.levels.length === 0) {
    throw new Error('Levels config: "levels" must be a non-empty array.');
  }

  const seenIds = new Set<string>();
  return file.levels.map((raw, i) => validateLevel(raw, i, seenIds));
}

function validateLevel(raw: unknown, index: number, seenIds: Set<string>): SortingLevelConfig {
  const at = `Level #${index + 1}`;
  if (typeof raw !== 'object' || raw === null) throw new Error(`${at}: must be an object.`);
  const lvl = raw as Record<string, unknown>;

  const id = lvl.id;
  if (typeof id !== 'string' || !id.trim()) throw new Error(`${at}: "id" must be a string.`);
  if (seenIds.has(id)) throw new Error(`${at}: duplicated id "${id}".`);
  seenIds.add(id);

  const cap = lvl.cap;
  if (!Number.isInteger(cap) || (cap as number) < 2 || (cap as number) > 8) {
    throw new Error(`${at} (${id}): "cap" must be an integer in [2..8].`);
  }
  const capN = cap as number;

  const par = lvl.par;
  if (!Number.isInteger(par) || (par as number) < 1) {
    throw new Error(`${at} (${id}): "par" must be a positive integer.`);
  }

  const difficulty = lvl.difficulty ?? 1;
  if (!Number.isInteger(difficulty) || (difficulty as number) < 1) {
    throw new Error(`${at} (${id}): "difficulty" must be a positive integer.`);
  }

  const columns = lvl.columns;
  if (!Array.isArray(columns) || columns.length < 2 || columns.length > 12) {
    throw new Error(`${at} (${id}): "columns" must be an array of 2..12 columns.`);
  }

  const colorCounts = new Map<ColorId, number>();
  let keys = 0;
  let emptyCount = 0;

  columns.forEach((col, ci) => {
    if (!Array.isArray(col)) throw new Error(`${at} (${id}): column ${ci} must be an array.`);
    if (col.length > capN) {
      throw new Error(`${at} (${id}): column ${ci} has ${col.length} blocks, cap is ${capN}.`);
    }
    if (col.length === 0) emptyCount += 1;
    col.forEach((c, bi) => {
      const valid =
        Number.isInteger(c) && ((c >= 0 && c < BLOCK_STYLES.length) || isSpecialColor(c as number));
      if (!valid) {
        throw new Error(
          `${at} (${id}): column ${ci}, block ${bi}: color id must be 0..${BLOCK_STYLES.length - 1} or a special id.`,
        );
      }
      const color = c as number;
      if (color === SPECIAL.KEY) keys += 1;
      else if (color !== SPECIAL.INK) colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
    });
    // Ink is a dead BOTTOM slot: contiguous from index 0, never a full column.
    const inkCount = col.filter((c) => c === SPECIAL.INK).length;
    if (inkCount > 0) {
      for (let bi = 0; bi < inkCount; bi++) {
        if (col[bi] !== SPECIAL.INK) {
          throw new Error(
            `${at} (${id}): column ${ci}: ink blots must occupy contiguous bottom slots.`,
          );
        }
      }
      if (inkCount >= capN) {
        throw new Error(`${at} (${id}): column ${ci}: ink must leave at least one playable slot.`);
      }
    }
    // A level must not start with an already-completed column.
    if (
      col.length === capN &&
      col.length > 0 &&
      col.every((c) => c === col[0] && !isSpecialColor(c as number))
    ) {
      throw new Error(`${at} (${id}): column ${ci} starts already completed.`);
    }
  });

  if (emptyCount < 1) {
    throw new Error(`${at} (${id}): needs at least one empty column to be playable.`);
  }
  if (keys > 0 && lvl.lockedColumn !== true) {
    throw new Error(`${at} (${id}): key blocks require "lockedColumn": true.`);
  }

  // the arithmetic contract: every color has exactly `cap` copies, always
  for (const [color, count] of colorCounts) {
    if (count !== capN) {
      throw new Error(
        `${at} (${id}): color ${color} appears ${count} times, must be exactly cap=${capN}.`,
      );
    }
  }

  let taped: number[] | undefined;
  if (lvl.tapedColumns !== undefined) {
    if (!Array.isArray(lvl.tapedColumns)) {
      throw new Error(`${at} (${id}): "tapedColumns" must be an array of column indices.`);
    }
    const seen = new Set<number>();
    lvl.tapedColumns.forEach((ti) => {
      if (!Number.isInteger(ti) || (ti as number) < 0 || (ti as number) >= columns.length) {
        throw new Error(`${at} (${id}): taped column index ${String(ti)} is out of range.`);
      }
      if (seen.has(ti as number)) throw new Error(`${at} (${id}): duplicated taped column ${ti}.`);
      seen.add(ti as number);
      if ((columns[ti as number] as number[]).includes(SPECIAL.INK)) {
        throw new Error(
          `${at} (${id}): taped column ${ti} contains ink and could never un-tape.`,
        );
      }
    });
    taped = lvl.tapedColumns as number[];
  }

  return {
    id,
    cap: capN,
    par: par as number,
    difficulty: difficulty as number,
    columns: columns as ColorId[][],
    hiddenBelowTop: lvl.hiddenBelowTop === true,
    lockedColumn: lvl.lockedColumn === true,
    tapedColumns: taped,
  };
}
