import { describe, it, expect } from 'vitest';
import { parseSortingLevels } from './SortingLevelParser';

function validFile() {
  return {
    version: 1,
    mechanic: 'sorting',
    levels: [
      {
        id: 'level_001',
        cap: 3,
        par: 6,
        difficulty: 1,
        columns: [
          [1, 0, 1],
          [0, 0, 1],
          [],
          [],
        ],
      },
    ],
  };
}

describe('parseSortingLevels', () => {
  it('parses a valid config', () => {
    const levels = parseSortingLevels(validFile());
    expect(levels).toHaveLength(1);
    expect(levels[0].id).toBe('level_001');
    expect(levels[0].cap).toBe(3);
    expect(levels[0].difficulty).toBe(1);
    expect(levels[0].hiddenBelowTop).toBe(false);
  });

  it('defaults difficulty to 1 when omitted', () => {
    const file = validFile();
    delete (file.levels[0] as Record<string, unknown>).difficulty;
    expect(parseSortingLevels(file)[0].difficulty).toBe(1);
  });

  it('rejects a non-object root', () => {
    expect(() => parseSortingLevels(null)).toThrow(/root/);
  });

  it('rejects a wrong mechanic', () => {
    const file = { ...validFile(), mechanic: 'merge' };
    expect(() => parseSortingLevels(file)).toThrow(/mechanic/);
  });

  it('rejects an empty levels array', () => {
    expect(() => parseSortingLevels({ mechanic: 'sorting', levels: [] })).toThrow(/non-empty/);
  });

  it('rejects duplicated ids', () => {
    const file = validFile();
    file.levels.push(JSON.parse(JSON.stringify(file.levels[0])));
    expect(() => parseSortingLevels(file)).toThrow(/duplicated id/);
  });

  it('rejects cap out of range', () => {
    const file = validFile();
    file.levels[0].cap = 1;
    expect(() => parseSortingLevels(file)).toThrow(/cap/);
  });

  it('rejects a color whose count does not equal cap (unclearable)', () => {
    const file = validFile();
    file.levels[0].columns = [[1, 0, 1], [0, 0], [], []];
    expect(() => parseSortingLevels(file)).toThrow(/appears/);
  });

  it('rejects a column that starts already completed', () => {
    const file = validFile();
    file.levels[0].columns = [
      [0, 0, 0],
      [1, 1, 1],
      [],
    ];
    expect(() => parseSortingLevels(file)).toThrow(/already completed/);
  });

  it('rejects a level without an empty column', () => {
    const file = validFile();
    file.levels[0].columns = [
      [1, 0, 1],
      [0, 0, 1],
    ];
    expect(() => parseSortingLevels(file)).toThrow(/empty column/);
  });

  it('rejects an unknown color id', () => {
    const file = validFile();
    file.levels[0].columns = [
      [99, 0, 99],
      [0, 0, 99],
      [],
    ];
    expect(() => parseSortingLevels(file)).toThrow(/color id/);
  });

  it('rejects a column taller than cap', () => {
    const file = validFile();
    file.levels[0].columns = [[1, 0, 1, 0], [0, 0, 1], [], []];
    expect(() => parseSortingLevels(file)).toThrow(/cap is/);
  });
});
