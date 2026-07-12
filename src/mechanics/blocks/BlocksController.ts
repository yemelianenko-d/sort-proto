import { eventBus } from '../../core/events/EventBus';
import type { BlocksModel } from './BlocksModel';
import { praiseForMove, type PraiseTier } from './blocksPraise';
import type { BlocksViewContract, GridPos, PlaceResult } from './BlocksTypes';

export interface BlocksCallbacks {
  onStateChanged: () => void; // HUD refresh (goal, score, pieces)
  onWin: () => void;
  onFail: () => void; // no tray piece fits anywhere
  /** Specials just collected by a line clear (with their board cell), for the
   * "fly to the goal panel" juice. Optional (unit tests omit it). */
  onCollected?: (cells: { symbol: number; row: number; col: number }[]) => void;
  /** A clearing move extended the combo chain to ≥2 — flash combo feedback. */
  onCombo?: (chain: number, multiplier: number) => void;
  /** The move deserves a praise callout (multi-line clear / clean sheet). */
  onPraise?: (tier: PraiseTier) => void;
}

/**
 * Controller of the blocks mechanic: turns tray drags into model placements,
 * drives view feedback and emits gameplay events to the EventBus. Depends on
 * the view only through BlocksViewContract (unit-testable with a stub).
 */
export class BlocksController {
  private busy = false;

  constructor(
    private model: BlocksModel,
    private view: BlocksViewContract,
    private callbacks: BlocksCallbacks,
  ) {
    view.onPieceDragStart = (slot) => this.handleDragStart(slot);
    view.onPieceDrop = (slot, cell) => this.handleDrop(slot, cell);
  }

  get isBusy(): boolean {
    return this.busy;
  }

  private handleDragStart(slot: number): boolean {
    return (
      !this.busy && !this.model.isWon() && !this.model.isFailed() && this.model.tray[slot] !== null
    );
  }

  private handleDrop(slot: number, cell: GridPos | null): boolean {
    if (this.busy || cell === null) return false;
    const piece = this.model.tray[slot];
    const result = this.model.place(slot, cell.row, cell.col);
    if (!result) {
      this.view.shakeBoard();
      return false;
    }

    eventBus.emit('move_made', {
      level_id: this.model.levelId,
      shape: piece?.shape,
      cells: result.placed.length,
      lines_cleared: result.clearedRows.length + result.clearedCols.length,
      collected: result.collected.length,
      score: this.model.score,
      moves_count: this.model.moves,
      input_method: 'drag',
    });
    eventBus.emit('player_action_made', {
      level_id: this.model.levelId,
      action_type: 'place',
      actions_count: this.model.moves,
    });

    this.view.rebuild({ placedCells: result.placed, refilled: result.refilled });
    this.callbacks.onStateChanged();
    if (result.comboChain >= 2) this.callbacks.onCombo?.(result.comboChain, result.comboMultiplier);
    const lines = result.clearedRows.length + result.clearedCols.length;
    const praise = praiseForMove(lines, this.model.isBoardEmpty());
    if (praise) this.callbacks.onPraise?.(praise);

    if (result.clearedCells.length > 0) {
      // collected specials fly to the goal panel while the line fades
      if (result.collected.length > 0 && this.callbacks.onCollected) {
        const cells = result.clearedCells
          .filter((c) => c.special !== undefined)
          .map((c) => ({ symbol: c.special as number, row: c.row, col: c.col }));
        this.callbacks.onCollected(cells);
      }
      this.busy = true;
      this.view.animateLineClear(
        result.clearedCells,
        () => {
          this.busy = false;
          this.callbacks.onStateChanged();
          this.finish(result);
        },
        result.color,
      );
    } else {
      this.finish(result);
    }
    return true;
  }

  private finish(result: PlaceResult): void {
    if (result.won) {
      this.callbacks.onWin();
      return;
    }
    if (result.failed) {
      eventBus.emit('level_failed', {
        level_id: this.model.levelId,
        reason: 'no_fit',
        moves_count: this.model.moves,
      });
      this.callbacks.onFail();
    }
  }
}
