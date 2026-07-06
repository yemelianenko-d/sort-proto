import { logError } from '../utils/logger';

/**
 * Minimal typed pub/sub bus.
 *
 * Mechanics never talk to platform services directly — they emit events here,
 * and the app layer (GameController) forwards them to analytics/progress/etc.
 */
export type GameEventName =
  | 'app_started'
  | 'assets_loaded'
  | 'mechanic_loaded'
  | 'level_loaded'
  | 'level_started'
  | 'level_completed'
  | 'level_failed'
  | 'level_restarted'
  | 'level_quit'
  | 'move_made'
  | 'player_action_made'
  | 'undo_used'
  | 'restart_used'
  | 'booster_used'
  | 'hint_used'
  | 'reward_requested'
  | 'ad_requested'
  | 'error_occurred';

export type EventPayload = Record<string, unknown>;

type Handler = (payload: EventPayload) => void;

export class EventBus {
  private handlers = new Map<GameEventName, Set<Handler>>();

  on(event: GameEventName, handler: Handler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  off(event: GameEventName, handler: Handler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: GameEventName, payload: EventPayload = {}): void {
    this.handlers.get(event)?.forEach((h) => {
      try {
        h(payload);
      } catch (err) {
        // A broken listener must not break gameplay.
        logError(`[EventBus] handler error for "${event}"`, err);
      }
    });
  }
}

/** Single shared instance for the app. */
export const eventBus = new EventBus();
