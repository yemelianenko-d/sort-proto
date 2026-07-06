import { eventBus, type EventPayload, type GameEventName } from '../events/EventBus';
import type { PlatformService } from '../../platform/PlatformService';
import { APP_VERSION } from '../../app/gameConfig';
import { GAME_SETTINGS } from '../../config/gameSettings';
import { GameState } from './GameState';
import { LevelManager } from './LevelManager';
import { SettingsManager } from './SettingsManager';
import { ProgressManager } from './ProgressManager';

/**
 * App-level controller.
 *
 * Subscribes to gameplay events once (no per-scene subscriptions => no
 * duplicated listeners after restarts) and forwards them to analytics and
 * progress. Mechanics stay unaware of both.
 */
export class GameController {
  readonly state = new GameState();
  readonly levels = new LevelManager();
  readonly settings = new SettingsManager();
  readonly progress: ProgressManager;

  private static readonly FORWARDED: GameEventName[] = [
    'app_started',
    'assets_loaded',
    'mechanic_loaded',
    'level_loaded',
    'level_started',
    'level_completed',
    'level_failed',
    'level_restarted',
    'level_quit',
    'move_made',
    'player_action_made',
    'undo_used',
    'restart_used',
    'booster_used',
    'hint_used',
    'reward_requested',
    'ad_requested',
    'error_occurred',
  ];

  constructor(readonly platform: PlatformService) {
    this.progress = new ProgressManager(platform.storage);

    for (const name of GameController.FORWARDED) {
      eventBus.on(name, (payload) => this.handle(name, payload));
    }
  }

  private handle(name: GameEventName, payload: EventPayload): void {
    // 1) analytics (mock -> console) with a consistent base payload
    this.platform.analytics.track(name, {
      mechanic: this.state.currentMechanic,
      device_type: this.platform.device.isMobile() ? 'mobile' : 'desktop',
      app_version: APP_VERSION,
      ...payload,
    });

    // 2) haptic feedback (platform layer; mechanics stay browser-API-free)
    const h = GAME_SETTINGS.haptics;
    if (name === 'move_made') this.platform.haptics.vibrate(h.movePattern);
    if (name === 'level_completed') this.platform.haptics.vibrate([...h.clearPattern]);
    if (name === 'booster_used') this.platform.haptics.vibrate(h.boosterPattern);

    // 3) progress side-effects
    const levelId = typeof payload.level_id === 'string' ? payload.level_id : null;
    if (name === 'level_started' && levelId) {
      this.progress.onLevelStarted(levelId);
    }
    if (name === 'level_completed' && levelId) {
      this.progress.onLevelCompleted(
        levelId,
        typeof payload.moves_count === 'number' ? payload.moves_count : 0,
        typeof payload.stars === 'number' ? payload.stars : 1,
        typeof payload.duration_sec === 'number' ? payload.duration_sec : 0,
      );
    }
  }
}
