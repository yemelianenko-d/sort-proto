import { describe, it, expect } from 'vitest';
import { LevelManager } from './LevelManager';

describe('LevelManager (endless)', () => {
  it('serves generated levels beyond the curated set and caches them', () => {
    const lm = new LevelManager(); // nothing loaded: everything is generated
    const a = lm.byIndex(12);
    const b = lm.byIndex(12);
    expect(a).not.toBeNull();
    expect(a).toBe(b); // cached instance
    expect(a!.id).toBe('level_013');
    expect(lm.indexOf('level_013')).toBe(12);
    expect(lm.byId('level_013')).toBe(a);
  });
});
