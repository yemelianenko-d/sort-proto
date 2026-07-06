import { describe, it, expect, beforeEach } from 'vitest';
import { SortingController, type SortingCallbacks } from './SortingController';
import { SortingModel } from './SortingModel';
import type { SortingLevelConfig, SortingViewContract } from './SortingTypes';
import { eventBus, type GameEventName } from '../../core/events/EventBus';

class StubView implements SortingViewContract {
  onColumnPress: (index: number) => void = () => {};
  onColumnTap: (index: number) => void = () => {};
  onDragStart: (index: number) => boolean = () => false;
  onDrop: (index: number, target: number | null) => void = () => {};
  /** Simulates a real pointer tap: press (pointerdown) + tap (pointerup). */
  userTap(index: number): void {
    this.onColumnPress(index);
    this.onColumnTap(index);
  }
  /** Simulates a full drag gesture. */
  userDrag(from: number, target: number | null): void {
    this.onColumnPress(from);
    if (this.onDragStart(from)) this.onDrop(from, target);
  }
  rebuilds = 0;
  shakes: number[] = [];
  clears: number[] = [];
  rebuild(): void {
    this.rebuilds += 1;
  }
  animateClear(columnIndex: number, onDone: () => void): void {
    this.clears.push(columnIndex);
    onDone(); // synchronous for tests
  }
  shakeColumn(columnIndex: number): void {
    this.shakes.push(columnIndex);
  }
  flashTargetHint(columnIndex: number): void {
    void columnIndex;
  }
  pulses: number[] = [];
  pulseColumn(columnIndex: number): void {
    this.pulses.push(columnIndex);
  }
  clearPulse(): void {
    this.pulses.length = 0;
  }
}

function makeModel(partial: Partial<SortingLevelConfig> = {}): SortingModel {
  return new SortingModel({
    id: 'ctrl-test',
    cap: 3,
    par: 6,
    difficulty: 1,
    columns: [
      [1, 0, 1],
      [0, 0, 1],
      [],
      [],
    ],
    ...partial,
  });
}

function setup(partial: Partial<SortingLevelConfig> = {}, keys = 1) {
  const model = makeModel(partial);
  const view = new StubView();
  const events: { won: boolean; deadlock: boolean } = { won: false, deadlock: false };
  const callbacks: SortingCallbacks = {
    onStateChanged: () => {},
    onWin: () => {
      events.won = true;
    },
    onDeadlock: () => {
      events.deadlock = true;
    },
  };
  const controller = new SortingController(model, view, callbacks, () => keys);
  return { model, view, controller, events };
}

function captureEvents(names: GameEventName[]): { name: GameEventName }[] {
  const captured: { name: GameEventName }[] = [];
  names.forEach((n) => eventBus.on(n, () => captured.push({ name: n })));
  return captured;
}

describe('SortingController', () => {
  beforeEach(() => {
    // EventBus is a module singleton; tests only add fresh listeners.
  });

  it('select -> drop performs a move through taps', () => {
    const { model, view } = setup();
    view.userTap(0); // select
    view.userTap(2); // drop onto empty (fast path on press)
    expect(model.moves).toBe(1);
    expect(model.columns[2]).toHaveLength(1);
  });

  it('drag & drop performs a move; invalid drop deselects and shakes', () => {
    const { model, view } = setup();
    view.userDrag(0, 2); // valid: onto empty
    expect(model.moves).toBe(1);
    expect(model.columns[2]).toHaveLength(1);

    view.userDrag(2, 1); // invalid: "1" onto full column 1
    expect(model.moves).toBe(1); // no move happened
    expect(view.shakes).toContain(1);

    view.userDrag(2, null); // dropped on empty space -> just cancels
    expect(model.moves).toBe(1);
  });

  it('drag start is refused for locked and empty columns', () => {
    const { view, model } = setup({ lockedColumn: true });
    expect(view.onDragStart(model.lockedColumn as number)).toBe(false);
    expect(view.onDragStart(2)).toBe(false); // empty column
    expect(view.onDragStart(0)).toBe(true);
  });

  it('tapping the selected column deselects instead of moving', () => {
    const { model, view } = setup();
    view.userTap(0);
    view.userTap(0);
    expect(model.moves).toBe(0);
  });

  it('shakes on an invalid target and on a locked column', () => {
    const { view, model } = setup({ lockedColumn: true });
    const locked = model.lockedColumn as number;
    view.onColumnTap(locked);
    expect(view.shakes).toContain(locked);
  });

  it('drives clear through animateClear + commitClear and reports win', () => {
    const { model, view, events } = setup({ columns: [[0, 0], [0], []] });
    view.userTap(1);
    view.userTap(0); // third "0" -> uniform full
    expect(view.clears).toEqual([0]);
    expect(model.columns[0]).toHaveLength(0); // committed after animation
    expect(events.won).toBe(true);
  });

  it('reports a deadlock when no move is left', () => {
    // cap 2, one empty column; first move fills it and locks the board
    const { view, events } = setup({
      cap: 2,
      columns: [[0, 1], [1, 2], [2, 0], []],
    });
    view.userTap(0);
    view.userTap(3); // "1" -> empty
    // remaining valid moves exist (0<->2), so no deadlock yet
    expect(events.deadlock).toBe(false);
  });

  it('undo rolls back moves and emits undo_used', () => {
    const { model, view, controller } = setup();
    const captured = captureEvents(['undo_used']);
    view.userTap(0);
    view.userTap(2);
    expect(controller.undo()).toBe(true);
    expect(model.moves).toBe(0);
    expect(captured.some((e) => e.name === 'undo_used')).toBe(true);
  });

  it('useLens reveals one hidden block and is NOT undo-able (boosters are permanent)', () => {
    const { model, controller } = setup({ hiddenBelowTop: true });
    const captured = captureEvents(['booster_used', 'hint_used']);
    const hiddenBefore = model.columns.flat().filter((b) => b.hidden).length;
    expect(controller.useLens()).toBe(true);
    expect(model.columns.flat().filter((b) => b.hidden).length).toBe(hiddenBefore - 1);
    expect(captured.some((e) => e.name === 'booster_used')).toBe(true);
    // no move history was created by the booster
    expect(controller.undo()).toBe(false);
    expect(model.columns.flat().filter((b) => b.hidden).length).toBe(hiddenBefore - 1);
  });

  it('undo of a move keeps the lens reveal (only moves are reverted)', () => {
    const { model, view, controller } = setup({ hiddenBelowTop: true });
    view.userTap(0);
    view.userTap(2); // move creates a snapshot with everything still hidden below tops
    expect(controller.useLens()).toBe(true);
    const revealedNow = model.columns.flat().filter((b) => !b.hidden).length;
    view.userTap(1);
    view.userTap(3); // another move
    expect(controller.undo()).toBe(true); // reverts the second move only
    expect(model.columns.flat().filter((b) => !b.hidden).length).toBe(revealedNow);
  });

  it('useLens returns false when nothing is hidden', () => {
    const { controller } = setup(); // no hiddenBelowTop
    expect(controller.useLens()).toBe(false);
  });

  it('findAnyMove returns a valid pair for the beginner hint', () => {
    const { controller, model } = setup();
    const mv = controller.findAnyMove();
    expect(mv).not.toBeNull();
    expect(model.canDrop(mv!.from, mv!.to)).toBe(true);
  });

  it('useKey unlocks the column and emits booster_used', () => {
    const { model, controller } = setup({ lockedColumn: true });
    const captured = captureEvents(['booster_used']);
    expect(controller.useKey()).toBe(true);
    expect(model.lockedColumn).toBeNull();
    expect(captured.some((e) => e.name === 'booster_used')).toBe(true);
  });
});
