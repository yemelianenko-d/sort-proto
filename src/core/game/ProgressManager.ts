import type { StorageService } from '../../platform/PlatformService';
import { STORAGE_KEYS } from '../../app/gameConfig';

export interface LevelStats {
  completed: boolean;
  attempts: number;
  bestMoves: number | null;
  bestStars: number;
  lastDurationSec: number | null;
}

export interface ProgressData {
  version: 1;
  lastLevelId: string | null;
  levels: Record<string, LevelStats>;
  /** One-time tutorial cards already shown to this player. */
  seenTutorials: Record<string, boolean>;
}

const EMPTY: ProgressData = { version: 1, lastLevelId: null, levels: {}, seenTutorials: {} };

/**
 * Local progress persisted through the platform StorageService.
 * The data shape is versioned and serializable so it can later be synced
 * to a backend/cloud save without migration pain.
 */
export class ProgressManager {
  private data: ProgressData;

  constructor(private storage: StorageService) {
    this.data = this.read();
  }

  private read(): ProgressData {
    const raw = this.storage.get(STORAGE_KEYS.progress);
    if (!raw) return structuredClone(EMPTY);
    try {
      const parsed = JSON.parse(raw) as ProgressData;
      if (parsed && parsed.version === 1 && typeof parsed.levels === 'object') {
        parsed.seenTutorials = parsed.seenTutorials ?? {}; // older saves
        return parsed;
      }
    } catch {
      /* corrupted save -> start fresh, do not crash */
    }
    return structuredClone(EMPTY);
  }

  private write(): void {
    this.storage.set(STORAGE_KEYS.progress, JSON.stringify(this.data));
  }

  private stats(levelId: string): LevelStats {
    let s = this.data.levels[levelId];
    if (!s) {
      s = { completed: false, attempts: 0, bestMoves: null, bestStars: 0, lastDurationSec: null };
      this.data.levels[levelId] = s;
    }
    return s;
  }

  onLevelStarted(levelId: string): void {
    this.stats(levelId).attempts += 1;
    this.data.lastLevelId = levelId;
    this.write();
  }

  onLevelCompleted(levelId: string, moves: number, stars: number, durationSec: number): void {
    const s = this.stats(levelId);
    s.completed = true;
    s.bestMoves = s.bestMoves === null ? moves : Math.min(s.bestMoves, moves);
    s.bestStars = Math.max(s.bestStars, stars);
    s.lastDurationSec = durationSec;
    this.write();
  }

  isCompleted(levelId: string): boolean {
    return this.data.levels[levelId]?.completed ?? false;
  }

  starsFor(levelId: string): number {
    return this.data.levels[levelId]?.bestStars ?? 0;
  }

  get lastLevelId(): string | null {
    return this.data.lastLevelId;
  }

  /** Index of the first not-yet-completed level given an ordered id list. */
  firstUncompletedIndex(orderedIds: readonly string[]): number {
    for (let i = 0; i < orderedIds.length; i++) {
      if (!this.isCompleted(orderedIds[i])) return i;
    }
    return Math.max(0, orderedIds.length - 1);
  }

  totalStars(): number {
    return Object.values(this.data.levels).reduce((sum, s) => sum + s.bestStars, 0);
  }

  isTutorialSeen(id: string): boolean {
    return this.data.seenTutorials[id] === true;
  }

  markTutorialSeen(id: string): void {
    this.data.seenTutorials[id] = true;
    this.write();
  }

  clear(): void {
    this.data = structuredClone(EMPTY);
    this.storage.remove(STORAGE_KEYS.progress);
  }
}
