import { describe, it, expect } from 'vitest';
import { ProgressManager } from './ProgressManager';
import type { StorageService } from '../../platform/PlatformService';
import { STORAGE_KEYS } from '../../app/gameConfig';

class FakeStorage implements StorageService {
  data = new Map<string, string>();
  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.data.set(key, value);
  }
  remove(key: string): void {
    this.data.delete(key);
  }
}

describe('ProgressManager', () => {
  it('tracks attempts, completion, best moves and stars', () => {
    const storage = new FakeStorage();
    const pm = new ProgressManager(storage);

    pm.onLevelStarted('level_001');
    pm.onLevelStarted('level_001');
    pm.onLevelCompleted('level_001', 12, 2, 60);
    pm.onLevelCompleted('level_001', 9, 3, 45); // better run

    expect(pm.isCompleted('level_001')).toBe(true);
    expect(pm.starsFor('level_001')).toBe(3);
    expect(pm.lastLevelId).toBe('level_001');
    expect(pm.totalStars()).toBe(3);
  });

  it('persists through the storage service and restores in a new instance', () => {
    const storage = new FakeStorage();
    const pm1 = new ProgressManager(storage);
    pm1.onLevelStarted('level_002');
    pm1.onLevelCompleted('level_002', 10, 2, 30);

    const pm2 = new ProgressManager(storage); // fresh instance, same storage
    expect(pm2.isCompleted('level_002')).toBe(true);
    expect(pm2.starsFor('level_002')).toBe(2);
  });

  it('survives corrupted saved data', () => {
    const storage = new FakeStorage();
    storage.set(STORAGE_KEYS.progress, '{not-json!!');
    const pm = new ProgressManager(storage);
    expect(pm.isCompleted('level_001')).toBe(false);
    expect(pm.totalStars()).toBe(0);
  });

  it('firstUncompletedIndex points to the next level to play', () => {
    const storage = new FakeStorage();
    const pm = new ProgressManager(storage);
    const ids = ['a', 'b', 'c'];
    expect(pm.firstUncompletedIndex(ids)).toBe(0);
    pm.onLevelCompleted('a', 5, 3, 10);
    expect(pm.firstUncompletedIndex(ids)).toBe(1);
    pm.onLevelCompleted('b', 5, 3, 10);
    pm.onLevelCompleted('c', 5, 3, 10);
    expect(pm.firstUncompletedIndex(ids)).toBe(ids.length - 1); // clamped
  });

  it('tracks one-time tutorial flags and keeps them after reload', () => {
    const storage = new FakeStorage();
    const pm1 = new ProgressManager(storage);
    expect(pm1.isTutorialSeen('howto')).toBe(false);
    pm1.markTutorialSeen('howto');
    const pm2 = new ProgressManager(storage);
    expect(pm2.isTutorialSeen('howto')).toBe(true);
    expect(pm2.isTutorialSeen('locked')).toBe(false);
  });

  it('accepts older saves without the seenTutorials field', () => {
    const storage = new FakeStorage();
    storage.set(
      STORAGE_KEYS.progress,
      JSON.stringify({ version: 1, lastLevelId: null, levels: {} }),
    );
    const pm = new ProgressManager(storage);
    expect(pm.isTutorialSeen('howto')).toBe(false);
    pm.markTutorialSeen('howto'); // must not crash
    expect(pm.isTutorialSeen('howto')).toBe(true);
  });

  it('clear() wipes progress and storage', () => {
    const storage = new FakeStorage();
    const pm = new ProgressManager(storage);
    pm.onLevelCompleted('level_001', 5, 3, 10);
    pm.clear();
    expect(pm.isCompleted('level_001')).toBe(false);
    expect(storage.get(STORAGE_KEYS.progress)).toBeNull();
  });
});
