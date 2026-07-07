import { eventBus } from '../../core/events/EventBus';
import type { SortingModel } from './SortingModel';
import type { SortingViewContract } from './SortingTypes';

export interface SortingCallbacks {
  onStateChanged: () => void; // HUD refresh (moves, undo availability)
  onWin: () => void;
  onDeadlock: (canOfferKey: boolean) => void;
  /** Any tap on the board (used by the scene to cancel the idle hint). */
  onPlayerInteracted?: () => void;
}

/**
 * Controller of the sorting mechanic: turns column taps into model commands,
 * drives view feedback and emits gameplay events to the EventBus.
 * It knows nothing about scenes, analytics or storage, and depends on the
 * view only through SortingViewContract (unit-testable with a stub).
 */
export class SortingController {
  private selected = -1;
  private busy = false;

  private movedOnPress = false;

  constructor(
    private model: SortingModel,
    private view: SortingViewContract,
    private callbacks: SortingCallbacks,
    private keysAvailable: () => number,
  ) {
    view.onColumnPress = (i) => this.onPress(i);
    view.onColumnTap = (i) => this.onTap(i);
    view.onDragStart = (i) => this.onDragStart(i);
    view.onDrop = (i, target) => this.onDrop(i, target);
  }

  get selectedColumn(): number {
    return this.selected;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /* ---------------- input ---------------- */

  /** Fast path: pressing a valid target moves immediately (snappy taps). */
  private onPress(index: number): void {
    this.callbacks.onPlayerInteracted?.();
    this.movedOnPress = false;
    if (this.busy) return;
    if (
      this.selected >= 0 &&
      this.selected !== index &&
      this.model.canDrop(this.selected, index)
    ) {
      this.performMove(this.selected, index, 'tap');
      this.movedOnPress = true;
    }
  }

  private onDragStart(index: number): boolean {
    if (this.busy) return false;
    if (index === this.model.lockedColumn || index === this.model.chainedColumn) {
      this.view.shakeColumn(index);
      if (index === this.model.chainedColumn) this.view.rattleChains(index);
      return false;
    }
    if (this.model.isComplete(index)) return false; // done columns are inert
    if (this.model.topGroup(index) === 0) return false;
    this.selected = index;
    this.view.rebuild({ selected: index, hideTopGroup: index });
    return true;
  }

  private onDrop(index: number, target: number | null): void {
    if (this.busy) return;
    if (target !== null && this.model.canDrop(index, target)) {
      this.performMove(index, target, 'drag');
      return;
    }
    this.selected = -1;
    this.view.rebuild();
    if (target !== null && target !== index) this.rejectDrop(index, target);
  }

  /** Impossible action: react (shake + specific hint), clear the selection —
   * the next tap starts a fresh choice instead of silently reselecting. */
  private rejectDrop(from: number, to: number): void {
    this.view.shakeColumn(to);
    if (this.model.isTargetMismatch(from, to)) this.view.flashTargetHint(to);
    if (this.model.isTaped(to)) this.view.wiggleTape(to);
    if (to === this.model.chainedColumn) this.view.rattleChains(to);
  }

  private onTap(index: number): void {
    if (this.busy || this.movedOnPress) return;

    if (index === this.model.lockedColumn || index === this.model.chainedColumn) {
      this.view.shakeColumn(index);
      if (index === this.model.chainedColumn) this.view.rattleChains(index);
      if (this.selected !== -1) this.select(-1);
      return;
    }

    const canPick = this.model.topGroup(index) > 0 && !this.model.isComplete(index);

    if (this.selected === -1) {
      if (canPick) this.select(index);
      else if (this.model.columns[index].length > 0 && !this.model.isComplete(index)) {
        this.view.shakeColumn(index); // occupied but unliftable — nudge; done columns stay inert
      }
      return;
    }

    if (this.selected === index) {
      this.select(-1);
      return;
    }

    if (this.model.canDrop(this.selected, index)) {
      this.performMove(this.selected, index, 'tap');
    } else {
      const from = this.selected;
      this.select(-1); // reaction first; the NEXT tap picks the next action
      this.rejectDrop(from, index);
    }
  }

  private select(index: number): void {
    this.selected = index;
    this.view.rebuild({ selected: index });
  }

  /* ---------------- commands ---------------- */

  private performMove(from: number, to: number, inputMethod: 'tap' | 'drag'): void {
    const result = this.model.move(from, to);
    if (!result) return;
    this.selected = -1;

    eventBus.emit('move_made', {
      level_id: this.model.levelId,
      from,
      to,
      blocks_moved: result.count,
      moves_count: this.model.moves,
      input_method: inputMethod,
    });
    eventBus.emit('player_action_made', {
      level_id: this.model.levelId,
      action_type: 'move',
      actions_count: this.model.moves,
    });

    const ghostChain = result.chainRemoved ?? undefined;
    this.view.rebuild({
      landedColumn: to,
      landedCount: result.count,
      revealed: result.revealed,
      ghostChain,
    });
    if (result.keysDissolved.length > 0) this.view.animateKeyDissolve(result.keysDissolved);
    if (result.tapeBroken !== null) this.view.animateTapePeel(result.tapeBroken);
    else if (this.model.isTaped(from)) this.view.animateFlapOpen(from);
    if (result.keysApplied.length > 0) {
      const lockCol = result.keyUnlocked ?? this.model.lockedColumn;
      if (lockCol !== null) {
        result.keysApplied.forEach((c) => this.view.animateKeyToLock(c, lockCol));
      }
    }
    this.callbacks.onStateChanged();

    if (result.readyToClear !== null) {
      const column = result.readyToClear;
      // no-clear rule: the completed set STAYS in place as a "done" column
      // (space removed from play) instead of clearing to empty.
      this.view.markColumnDone(column);
      if (ghostChain) {
        this.busy = true;
        this.view.animateChainBreak(column, () => {
          this.busy = false;
          this.view.rebuild();
          this.callbacks.onStateChanged();
          this.afterChange();
        });
      } else {
        this.afterChange();
      }
    } else {
      this.afterChange();
    }
  }

  private afterChange(): void {
    if (this.model.isWon()) {
      this.callbacks.onWin();
      return;
    }
    if (!this.model.hasAnyMove()) {
      const canOfferKey = this.model.lockedColumn !== null && this.keysAvailable() > 0;
      eventBus.emit('level_failed', {
        level_id: this.model.levelId,
        reason: 'deadlock',
        moves_count: this.model.moves,
      });
      this.callbacks.onDeadlock(canOfferKey);
    }
  }

  undo(): boolean {
    if (this.busy) return false;
    const ok = this.model.undo();
    if (ok) {
      this.selected = -1;
      eventBus.emit('undo_used', { level_id: this.model.levelId });
      eventBus.emit('player_action_made', {
        level_id: this.model.levelId,
        action_type: 'undo',
        actions_count: this.model.moves,
      });
      this.view.rebuild();
      this.callbacks.onStateChanged();
    }
    return ok;
  }

  /** Lens booster: reveal one hidden block. */
  useLens(): boolean {
    if (this.busy) return false;
    const column = this.model.useLens();
    if (column === null) return false;
    this.selected = -1;
    eventBus.emit('booster_used', { level_id: this.model.levelId, booster: 'lens' });
    eventBus.emit('hint_used', { level_id: this.model.levelId, hint: 'lens' });
    eventBus.emit('player_action_made', {
      level_id: this.model.levelId,
      action_type: 'booster_lens',
      actions_count: this.model.moves,
    });
    this.view.rebuild({ revealed: [column] });
    this.callbacks.onStateChanged();
    return true;
  }

  /** First valid move, for the beginner idle hint. */
  findAnyMove(): { from: number; to: number } | null {
    return this.model.findAnyMove();
  }

  useKey(): boolean {
    if (this.busy) return false;
    const res = this.model.unlockColumn();
    if (res === null) return false;
    this.selected = -1;
    eventBus.emit('booster_used', { level_id: this.model.levelId, booster: 'key' });
    eventBus.emit('player_action_made', {
      level_id: this.model.levelId,
      action_type: 'booster_key',
      actions_count: this.model.moves,
    });
    if (res.dissolved.length > 0) {
      // staged: lock pops -> key flips face-up -> breaks -> blocks fall
      this.busy = true;
      this.view.animateKeyBreak(res.dissolved, res.column, () => {
        this.busy = false;
        this.view.rebuild();
        this.callbacks.onStateChanged();
      });
    } else {
      this.view.rebuild({ landedColumn: res.column, landedCount: 0 });
      this.callbacks.onStateChanged();
    }
    return true;
  }
}
