import { describe, it, expect } from 'vitest';
import { BlocksModel } from './BlocksModel';
import { mulberry32 } from './blocksRandom';
import type { BlocksLevelConfig } from './BlocksTypes';

function config(partial: Partial<BlocksLevelConfig> = {}): BlocksLevelConfig {
  return {
    id: 'blocks_test',
    rows: 5,
    cols: 5,
    board: ['.....', '.....', '.....', '.....', '.....'],
    goal: { type: 'score', target: 1000 },
    pieces: [{ shape: 'S1', weight: 1 }],
    par: 10,
    difficulty: 1,
    ...partial,
  };
}

const rng = () => mulberry32(42);

describe('BlocksModel', () => {
  it('builds the grid from the board strings and deals a full tray', () => {
    const m = new BlocksModel(config({ board: ['01...', '.....', '.....', '.....', '....7'] }), rng());
    expect(m.grid[0][0]).toEqual({ color: 0, initial: true });
    expect(m.grid[0][1]).toEqual({ color: 1, initial: true });
    expect(m.grid[4][4]).toEqual({ color: 7, initial: true });
    expect(m.grid[1][1]).toBeNull();
    expect(m.tray.every((p) => p !== null)).toBe(true);
  });

  it('enforces bounds and collisions in canPlace', () => {
    const m = new BlocksModel(
      config({ board: ['0....', '.....', '.....', '.....', '.....'], pieces: [{ shape: 'R2x2', weight: 1 }] }),
      rng(),
    );
    expect(m.canPlace(0, 0, 0)).toBe(false); // collides with the initial block
    expect(m.canPlace(0, 0, 1)).toBe(true);
    expect(m.canPlace(0, 4, 0)).toBe(false); // 2x2 out of the bottom edge
    expect(m.canPlace(0, 0, 4)).toBe(false); // 2x2 out of the right edge
    expect(m.canPlace(0, -1, 0)).toBe(false);
  });

  it('places a piece, counts the move and empties the slot', () => {
    const m = new BlocksModel(config({ pieces: [{ shape: 'H3', weight: 1, color: 2 }] }), rng());
    const r = m.place(0, 1, 1);
    expect(r).not.toBeNull();
    expect(r!.placed).toEqual([
      { row: 1, col: 1 },
      { row: 1, col: 2 },
      { row: 1, col: 3 },
    ]);
    expect(m.grid[1][2]).toEqual({ color: 2, initial: false });
    expect(m.tray[0]).toBeNull();
    expect(m.moves).toBe(1);
    expect(r!.gained).toBe(3); // 3 cells, no lines
  });

  it('clears a full row and scores it quadratically', () => {
    const m = new BlocksModel(
      config({ board: ['0000.', '.....', '.....', '.....', '.....'], pieces: [{ shape: 'S1', weight: 1 }] }),
      rng(),
    );
    const r = m.place(0, 0, 4)!;
    expect(r.clearedRows).toEqual([0]);
    expect(r.clearedCols).toEqual([]);
    expect(r.clearedCells).toHaveLength(5);
    expect(r.gained).toBe(1 + 10); // 1 cell + 10 * 1²
    expect(m.grid[0].every((c) => c === null)).toBe(true);
  });

  it('dedupes the crossing cell when a row and a column clear together', () => {
    // column 0 filled except the top, row 0 filled except column 0:
    // dropping a dot at (0,0) completes both lines at once.
    const m = new BlocksModel(
      config({
        board: ['.1111', '1....', '1....', '1....', '1....'],
        pieces: [{ shape: 'S1', weight: 1 }],
      }),
      rng(),
    );
    const r = m.place(0, 0, 0)!;
    expect(r.clearedRows).toEqual([0]);
    expect(r.clearedCols).toEqual([0]);
    expect(r.clearedCells).toHaveLength(9); // 5 + 5 - shared corner
    expect(r.gained).toBe(1 + 30); // 1 cell + triangular L=2 (10·2·3/2), combo ×1.0
    expect(r.comboChain).toBe(1);
  });

  it('advances the combo chain across consecutive clearing moves and resets on a gap', () => {
    // three stacked near-complete rows; each dot completes one row in a row
    const m = new BlocksModel(
      config({
        board: ['0000.', '1111.', '2222.', '.....', '.....'],
        pieces: [{ shape: 'S1', weight: 1 }],
      }),
      rng(),
    );
    const a = m.place(0, 0, 4)!; // clears row 0 -> chain 1, ×1.0, clear 10
    expect(a.comboChain).toBe(1);
    expect(a.gained).toBe(1 + 10);
    const b = m.place(1, 1, 4)!; // clears row 1 -> chain 2, ×2 (combo = chain), clear 20
    expect(b.comboChain).toBe(2);
    expect(b.comboMultiplier).toBe(2);
    expect(b.gained).toBe(1 + 20);
    const c = m.place(2, 3, 0)!; // no clear -> chain resets to 0
    expect(c.comboChain).toBe(0);
    expect(m.maxCombo).toBe(2);
  });

  it('refills the tray only after all three pieces are placed', () => {
    const m = new BlocksModel(config(), rng());
    expect(m.place(0, 0, 0)!.refilled).toBe(false);
    expect(m.place(1, 0, 1)!.refilled).toBe(false);
    const r = m.place(2, 0, 2)!;
    expect(r.refilled).toBe(true);
    expect(m.tray.every((p) => p !== null)).toBe(true);
  });

  it('draws pieces deterministically with a seeded rng and respects weights', () => {
    const cfg = config({
      pieces: [
        { shape: 'S1', weight: 1 },
        { shape: 'H2', weight: 0.0001 },
      ],
    });
    const a = new BlocksModel(cfg, mulberry32(7));
    const b = new BlocksModel(cfg, mulberry32(7));
    expect(a.tray).toEqual(b.tray);
    expect(a.tray.filter((p) => p!.shape === 'S1').length).toBe(3);
  });

  it('wins the score goal the moment the target is reached', () => {
    const m = new BlocksModel(
      config({
        goal: { type: 'score', target: 11 },
        board: ['0000.', '.....', '.....', '.....', '.....'],
        pieces: [{ shape: 'S1', weight: 1 }],
      }),
      rng(),
    );
    const r = m.place(0, 0, 4)!; // 1 + 10 = 11
    expect(r.won).toBe(true);
  });

  /* ---------------- collect goal + special tiles ---------------- */

  it('stamps a preset board special onto its cell', () => {
    const m = new BlocksModel(
      config({
        goal: { type: 'collect', quotas: [{ symbol: 2, count: 1 }] },
        board: ['0....', '.....', '.....', '.....', '.....'],
        specials: [{ row: 0, col: 0, symbol: 2 }],
      }),
      rng(),
    );
    expect(m.grid[0][0]).toEqual({ color: 0, initial: true, special: 2 });
  });

  it('collects a board special when its line clears and wins on the quota', () => {
    const m = new BlocksModel(
      config({
        goal: { type: 'collect', quotas: [{ symbol: 2, count: 1 }] },
        board: ['0000.', '.....', '.....', '.....', '.....'],
        specials: [{ row: 0, col: 0, symbol: 2 }],
        pieces: [{ shape: 'S1', weight: 1 }],
      }),
      rng(),
    );
    expect(m.goalProgress()).toEqual({
      type: 'collect',
      quotas: [{ symbol: 2, collected: 0, count: 1 }],
    });
    const r = m.place(0, 0, 4)!; // completes row 0 -> clears the special
    expect(r.collected).toEqual([2]);
    expect(r.won).toBe(true);
    expect(m.goalProgress()).toEqual({
      type: 'collect',
      quotas: [{ symbol: 2, collected: 1, count: 1 }],
    });
  });

  it('does not win a collect goal from clearing plain (non-special) lines', () => {
    const m = new BlocksModel(
      config({
        goal: { type: 'collect', quotas: [{ symbol: 3, count: 1 }] },
        board: ['1111.', '.....', '.....', '.....', '.....'],
        pieces: [{ shape: 'S1', weight: 1 }],
      }),
      rng(),
    );
    // the only board line has no special; injected tray special is elsewhere
    const slotNoSpecial = m.tray.findIndex((p) => !p?.specials?.length);
    const r = m.place(slotNoSpecial, 0, 4)!;
    expect(r.collected).toEqual([]);
    expect(r.won).toBe(false);
  });

  it('guarantees a needed symbol appears in the tray when the board has none', () => {
    const m = new BlocksModel(
      config({
        goal: { type: 'collect', quotas: [{ symbol: 3, count: 2 }] },
        pieces: [{ shape: 'S1', weight: 1 }],
      }),
      rng(),
    );
    expect(m.tray.reduce((n, p) => n + (p?.specials?.filter((s) => s.symbol === 3).length ?? 0), 0)).toBe(1);
  });

  it('collects a special carried by a placed tray piece when its line clears', () => {
    const m = new BlocksModel(
      config({
        goal: { type: 'collect', quotas: [{ symbol: 3, count: 1 }] },
        pieces: [{ shape: 'H5', weight: 1 }], // spans the 5-wide board
      }),
      rng(),
    );
    const slot = m.tray.findIndex((p) => p?.specials?.some((s) => s.symbol === 3));
    expect(slot).toBeGreaterThanOrEqual(0);
    const r = m.place(slot, 0, 0)!; // fills row 0 -> clears -> collects the special
    expect(r.collected).toContain(3);
    expect(r.won).toBe(true);
  });

  it('needs every quota met before a multi-symbol collect goal is won', () => {
    const m = new BlocksModel(
      config({
        goal: { type: 'collect', quotas: [{ symbol: 0, count: 1 }, { symbol: 1, count: 1 }] },
        board: ['00...', '11...', '.....', '.....', '.....'],
        specials: [
          { row: 0, col: 0, symbol: 0 },
          { row: 1, col: 0, symbol: 1 },
        ],
        pieces: [{ shape: 'H3', weight: 1 }],
      }),
      rng(),
    );
    const s0 = m.tray.findIndex((p) => !p?.specials?.length);
    const r1 = m.place(s0, 0, 2)!; // completes row 0 -> collects symbol 0 only
    expect(r1.collected).toEqual([0]);
    expect(r1.won).toBe(false);
    const s1 = m.tray.findIndex((p, i) => i !== s0 && !p?.specials?.length);
    const r2 = m.place(s1, 1, 2)!; // completes row 1 -> collects symbol 1 -> win
    expect(r2.collected).toEqual([1]);
    expect(r2.won).toBe(true);
  });

  it('previews the lines that would clear for a hovered placement', () => {
    const m = new BlocksModel(
      config({ board: ['0000.', '.....', '.....', '.....', '.....'], pieces: [{ shape: 'S1', weight: 1 }] }),
      rng(),
    );
    // dropping the dot at (0,4) completes row 0
    expect(m.previewClears(0, 0, 4)).toEqual({ rows: [0], cols: [] });
    // dropping it elsewhere completes nothing
    expect(m.previewClears(0, 2, 2)).toEqual({ rows: [], cols: [] });
    // an invalid placement (onto an occupied cell) previews nothing
    expect(m.previewClears(0, 0, 0)).toEqual({ rows: [], cols: [] });
  });

  it('previews a row and column completing together', () => {
    const m = new BlocksModel(
      config({ board: ['.1111', '1....', '1....', '1....', '1....'], pieces: [{ shape: 'S1', weight: 1 }] }),
      rng(),
    );
    expect(m.previewClears(0, 0, 0)).toEqual({ rows: [0], cols: [0] });
  });

  /* ---------------- failure ---------------- */

  it('fails when no tray piece fits anywhere', () => {
    // one isolated hole per row/column — a horizontal 1x2 can never fit
    const m = new BlocksModel(
      config({
        board: ['.0000', '00.00', '0000.', '0.000', '000.0'],
        pieces: [{ shape: 'H2', weight: 1 }],
      }),
      rng(),
    );
    expect(m.isFailed()).toBe(true); // dealt tray of 1x2 pieces cannot fit
  });

  it('reports failure after a move that leaves no placement', () => {
    // The only horizontal pair of holes is (0,0)-(0,1); placing i2h there
    // completes no line (every row/column keeps a hole) and every remaining
    // hole is isolated — the next i2h cannot fit.
    const m = new BlocksModel(
      config({
        board: ['..0.0', '.0000', '00.00', '0000.', '0.000'],
        pieces: [{ shape: 'H2', weight: 1 }],
      }),
      rng(),
    );
    expect(m.isFailed()).toBe(false);
    const r = m.place(0, 0, 0)!;
    expect(r.clearedRows).toEqual([]);
    expect(r.failed).toBe(true);
    expect(m.isFailed()).toBe(true);
  });

  it('rejects placement on a won or failed level', () => {
    const m = new BlocksModel(
      config({
        goal: { type: 'score', target: 1 },
        pieces: [{ shape: 'S1', weight: 1 }],
      }),
      rng(),
    );
    expect(m.place(0, 0, 0)!.won).toBe(true);
    expect(m.canPlace(1, 2, 2)).toBe(false);
    expect(m.place(1, 2, 2)).toBeNull();
  });

  it('endless: never auto-wins and reports live score as endless progress', () => {
    const m = new BlocksModel(
      config({ goal: { type: 'endless' }, pieces: [{ shape: 'H3', weight: 1, color: 2 }] }),
      rng(),
    );
    const r = m.place(0, 1, 1)!;
    expect(r.won).toBe(false);
    expect(m.isWon()).toBe(false);
    expect(m.goalProgress()).toEqual({ type: 'endless', score: m.score });
    expect(m.score).toBeGreaterThan(0);
  });

  it('revive clears the board, keeps score/collected, un-fails, and refills', () => {
    const m = new BlocksModel(
      config({
        goal: { type: 'collect', quotas: [{ symbol: 3, count: 3 }] },
        board: ['..0.0', '.0000', '00.00', '0000.', '0.000'],
        pieces: [{ shape: 'H2', weight: 1 }],
      }),
      rng(),
    );
    m.place(0, 0, 0); // jams → failed
    expect(m.isFailed()).toBe(true);
    const scoreBefore = m.score;
    m.revive();
    expect(m.isFailed()).toBe(false);
    expect(m.isBoardEmpty()).toBe(true); // board wiped
    expect(m.score).toBe(scoreBefore); // score kept
    expect(m.tray.every((p) => p !== null)).toBe(true); // fresh tray dealt
  });

  it('endless: still ends (game over) when no tray piece fits', () => {
    const m = new BlocksModel(
      config({
        goal: { type: 'endless' },
        board: ['..0.0', '.0000', '00.00', '0000.', '0.000'],
        pieces: [{ shape: 'H2', weight: 1 }],
      }),
      rng(),
    );
    const r = m.place(0, 0, 0)!;
    expect(r.won).toBe(false);
    expect(r.failed).toBe(true);
    expect(m.isFailed()).toBe(true);
  });
});
