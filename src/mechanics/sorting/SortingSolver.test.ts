import { describe, it, expect } from 'vitest';
import {
  legalMoves,
  applyMove,
  cloneState,
  solve,
  solveBest,
  solvePath,
  type SolverState,
} from './SortingSolver';
import { SPECIAL } from './SortingTypes';

/** Minimal state builder with sane defaults (no specials unless asked). */
function state(cols: number[][], over: Partial<SolverState> = {}): SolverState {
  return {
    cols: cols.map((c) => c.slice()),
    cap: over.cap ?? 4,
    locked: over.locked ?? -1,
    locks: over.locks ?? 0,
    chainCol: over.chainCol ?? -1,
    chains: over.chains ?? [],
    taped: over.taped ?? new Set<number>(),
    targets: over.targets ?? new Map<number, number>(),
  };
}

describe('legalMoves (single source of truth)', () => {
  it('never sources from or targets a locked or chained column', () => {
    const st = state([[0], [1], [], []], { locked: 2, chainCol: 3 });
    for (const mv of legalMoves(st)) {
      expect(mv.from).not.toBe(2);
      expect(mv.from).not.toBe(3);
      expect(mv.to).not.toBe(2);
      expect(mv.to).not.toBe(3);
    }
  });

  it('never targets a taped column and never lifts ink or keys', () => {
    const st = state([[SPECIAL.INK, 0], [1], []], { taped: new Set([2]) });
    // column 0 top is 0 (movable), column with only ink on top cannot source
    const inkTop = state([[0, SPECIAL.INK], [1], []]);
    expect(legalMoves(inkTop).some((m) => m.from === 0)).toBe(false);
    expect(legalMoves(st).some((m) => m.to === 2)).toBe(false);
  });

  it('respects capacity and color matching', () => {
    const st = state([[0], [1, 1, 1, 1]], { cap: 4 });
    // cannot move onto the full column, and 0 cannot land on a 1-topped pile
    expect(legalMoves(st).some((m) => m.to === 1)).toBe(false);
  });

  it('honors a target column restriction on its first block', () => {
    // col 1 top is color 1 over a filler, so moving it is not a pruned
    // full-group-to-empty shuffle
    const st = state([[0], [3, 1], []], { targets: new Map([[2, 1]]) });
    // empty target col 2 only accepts color 1, so 0 cannot open it
    expect(legalMoves(st).some((m) => m.from === 0 && m.to === 2)).toBe(false);
    expect(legalMoves(st).some((m) => m.from === 1 && m.to === 2)).toBe(true);
  });

  it('orders non-empty destinations before empty-column dumps', () => {
    const st = state([[0], [0], []]);
    const moves = legalMoves(st);
    const firstEmpty = moves.findIndex((m) => st.cols[m.to].length === 0);
    const lastNonEmpty = moves.map((m) => st.cols[m.to].length > 0).lastIndexOf(true);
    if (firstEmpty >= 0 && lastNonEmpty >= 0) expect(lastNonEmpty).toBeLessThan(firstEmpty);
  });

  it('prunes the pointless full-group shuffle onto another empty column', () => {
    const st = state([[0, 0], [], []]);
    // moving the whole [0,0] group to an empty column achieves nothing
    expect(legalMoves(st).every((m) => !(m.from === 0 && st.cols[m.to].length === 0))).toBe(true);
  });
});

describe('applyMove settlement', () => {
  it('consumes a key off the top and removes one lock', () => {
    const st = state([[0, SPECIAL.KEY], [1], []], { locked: 2, locks: 1 });
    // a settle happens on move; move 1 onto 0? key is on top of col 0 so it
    // auto-consumes during settle even before an explicit move
    const s2 = cloneState(st);
    applyMove(s2, { from: 1, to: 2 }); // any move triggers settle
    expect(s2.locked).toBe(-1);
    expect(s2.locks).toBeLessThanOrEqual(0);
    expect(s2.cols[0]).toEqual([0]);
  });

  it('auto-clears a completed uniform set', () => {
    const st = state([[0, 0, 0], [0], []], { cap: 4 });
    const s2 = cloneState(st);
    applyMove(s2, { from: 1, to: 0 }); // completes [0,0,0,0] -> clears
    expect(s2.cols[0]).toEqual([]);
  });

  it('removes a matching colored chain when its set completes', () => {
    const st = state([[2, 2, 2], [2], [3, 3, 3, 3].slice(0, 0)], {
      cap: 4,
      chainCol: 2,
      chains: [2],
    });
    const s2 = cloneState(st);
    applyMove(s2, { from: 1, to: 0 }); // completes the color-2 set
    expect(s2.chains).not.toContain(2);
    expect(s2.chainCol).toBe(-1);
  });
});

describe('searches agree and produce valid solutions', () => {
  it('solve and solveBest both solve a trivial two-move board', () => {
    const st = state([[0, 0, 0], [0], []], { cap: 4 });
    expect(solve(st)).toBeGreaterThan(0);
    expect(solveBest(st)).toBeGreaterThan(0);
  });

  it('solvePath returns a sequence that actually wins', () => {
    // cap 2 with two copies of each color so sets can actually complete
    const st = state([[0, 1], [1, 0], []], { cap: 2 });
    const path = solvePath(st);
    expect(path).not.toBeNull();
    const replay = cloneState(st);
    for (const mv of path!) applyMove(replay, mv);
    expect(replay.cols.every((c) => c.every((b) => b === SPECIAL.INK))).toBe(true);
  });

  it('reports unsolvable when a required block is sealed forever', () => {
    // color 1 needs 4 copies but one is locked inside the chained column
    // which never opens (a sentinel chain no set can satisfy)
    const st = state([[1, 1, 1], [0, 0, 0, 0].slice(0, 3), []], {
      cap: 4,
      chainCol: 2,
      chains: [-2], // no completed set removes it -> locked forever
    });
    st.cols[2] = [1]; // the 4th "1" is trapped
    expect(solve(st, 20000)).toBeLessThanOrEqual(0);
  });
});
