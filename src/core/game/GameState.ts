/**
 * Small global app state (current mechanic/level pointer).
 * Level data itself lives in LevelManager; per-mechanic runtime state lives
 * inside the mechanic's own model.
 */
export class GameState {
  currentMechanic = 'sorting' as const;
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
