import { describe, it, expect } from 'vitest';
import { BlocksController, type BlocksCallbacks } from './BlocksController';
import { BlocksModel } from './BlocksModel';
import { mulberry32 } from './blocksRandom';
import type { BlocksLevelConfig, BlocksViewContract, ClearedCell, GridPos } from './BlocksTypes';

/** Minimal ViewContract stub: records calls, resolves animations instantly. */
class StubView implements BlocksViewContract {
  onPieceDragStart: (slot: number) => boolean = () => false;
  onPieceDrop: (slot: number, cell: GridPos | null) => boolean = () => false;
  rebuilds: { placedCells?: GridPos[]; refilled?: boolean }[] = [];
  clears: ClearedCell[][] = [];
  shakes = 0;

  rebuild(opts: { placedCells?: GridPos[]; refilled?: boolean } = {}): void {
    this.rebuilds.push(opts);
  }
  animateLineClear(cells: ClearedCell[], onDone: () => void): void {
    this.clears.push(cells);
    onDone();
  }
  shakeBoard(): void {
    this.shakes += 1;
  }
  destroy(): void {}
}

function config(partial: Partial<BlocksLevelConfig> = {}): BlocksLevelConfig {
  return {
    id: 'blocks_ctrl_test',
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

function setup(cfg: BlocksLevelConfig) {
  const model = new BlocksModel(cfg, mulberry32(1));
  const view = new StubView();
  const events: string[] = [];
  const praises: string[] = [];
  const callbacks: BlocksCallbacks = {
    onStateChanged: () => events.push('state'),
    onWin: () => events.push('win'),
    onFail: () => events.push('fail'),
    onPraise: (tier) => praises.push(tier),
  };
  const controller = new BlocksController(model, view, callbacks);
  return { model, view, events, praises, controller };
}

describe('BlocksController', () => {
  it('accepts a valid drop: places, rebuilds with the placed cells, refreshes HUD', () => {
    const { model, view, events } = setup(config());
    const ok = view.onPieceDrop(0, { row: 2, col: 2 });
    expect(ok).toBe(true);
    expect(model.moves).toBe(1);
    expect(view.rebuilds[0].placedCells).toEqual([{ row: 2, col: 2 }]);
    expect(events).toContain('state');
  });

  it('refuses a drop off the board and an occupied cell', () => {
    const { view, model } = setup(config({ board: ['0....', '.....', '.....', '.....', '.....'] }));
    expect(view.onPieceDrop(0, null)).toBe(false);
    expect(view.onPieceDrop(0, { row: 0, col: 0 })).toBe(false);
    expect(view.shakes).toBe(1); // only the on-board invalid drop shakes
    expect(model.moves).toBe(0);
  });

  it('plays the clear animation and reports the win after it finishes', () => {
    const { view, events } = setup(
      config({
        goal: { type: 'collect', quotas: [{ symbol: 0, count: 1 }] },
        board: ['0000.', '.....', '.....', '.....', '.....'],
        specials: [{ row: 0, col: 0, symbol: 0 }],
      }),
    );
    expect(view.onPieceDrop(0, { row: 0, col: 4 })).toBe(true);
    expect(view.clears).toHaveLength(1);
    expect(view.clears[0]).toHaveLength(5);
    expect(events[events.length - 1]).toBe('win');
  });

  it('reports failure when the move leaves no placement', () => {
    const { view, events } = setup(
      config({
        board: ['..0.0', '.0000', '00.00', '0000.', '0.000'],
        pieces: [{ shape: 'H2', weight: 1 }],
      }),
    );
    expect(view.onPieceDrop(0, { row: 0, col: 0 })).toBe(true);
    expect(events[events.length - 1]).toBe('fail');
  });

  it('allows picking only occupied slots on a live level', () => {
    const { view, model } = setup(config());
    expect(view.onPieceDragStart(0)).toBe(true);
    view.onPieceDrop(0, { row: 0, col: 0 });
    expect(model.tray[0]).toBeNull();
    expect(view.onPieceDragStart(0)).toBe(false); // emptied slot
  });

  it('emits praise on a multi-line clear, none on a single line', () => {
    // (0,0) completes row 0 AND column 0; (2,2) stays behind → 'double'
    const { view, praises } = setup(
      config({ board: ['.0000', '0....', '0.6..', '0....', '0....'] }),
    );
    expect(view.onPieceDrop(0, { row: 0, col: 0 })).toBe(true);
    expect(praises).toEqual(['double']);

    // (2,2) survives the row-0 clear, so this is a plain 1-line move — silent
    const single = setup(config({ board: ['0000.', '.....', '..6..', '.....', '.....'] }));
    expect(single.view.onPieceDrop(0, { row: 0, col: 4 })).toBe(true);
    expect(single.praises).toEqual([]);
  });

  it('emits the clean-sheet praise when the clears empty the board', () => {
    // every filled cell lies on row 0 / column 0 → the double clear wipes all
    const { view, praises } = setup(
      config({ board: ['.0000', '0....', '0....', '0....', '0....'] }),
    );
    expect(view.onPieceDrop(0, { row: 0, col: 0 })).toBe(true);
    expect(praises).toEqual(['allClear']);
  });

  it('refuses drags and drops once the level is won', () => {
    const { view } = setup(
      config({ goal: { type: 'score', target: 1 } }), // first dot wins
    );
    expect(view.onPieceDrop(0, { row: 0, col: 0 })).toBe(true);
    expect(view.onPieceDragStart(1)).toBe(false);
    expect(view.onPieceDrop(1, { row: 3, col: 3 })).toBe(false);
  });
});
