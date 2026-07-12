/**
 * Small global app state (current mechanic/level pointer).
 * Level data itself lives in LevelManager; per-mechanic runtime state lives
 * inside the mechanic's own model.
 */
export class GameState {
  /** Mechanic id of the level being played (set by the launch points). */
  currentMechanic: string = 'sorting';
  currentLevelIndex = 0;
  levelStartedAt = 0;

  markLevelStarted(index: number): void {
    this.currentLevelIndex = index;
    this.levelStartedAt = Date.now();
  }

  levelDurationSec(): number {
    return Math.round((Date.now() - this.levelStartedAt) / 1000);
  }
}
