import { describe, it, expect } from 'vitest';
import { resolveBucket, levelSeed, splitSeed, makeRng } from './blocksRng';

describe('blocksRng', () => {
  it('maps early attempts to a stable opening and rotates late ones (default policy)', () => {
    expect(resolveBucket(1)).toBe('A');
    expect(resolveBucket(2)).toBe('A'); // same opening -> learnable
    expect(resolveBucket(3)).toBe('B');
    expect(resolveBucket(4)).toBe('B');
    expect(resolveBucket(5)).toBe('C_ROTATING_5');
    expect(resolveBucket(6)).toBe('C_ROTATING_6'); // rotates
  });

  it('honours an explicit restart policy', () => {
    const policy = { variationBuckets: [{ attempts: [1, 3] as [number, number], bucket: 'A' }] };
    expect(resolveBucket(2, policy)).toBe('A');
    expect(resolveBucket(9, policy)).toBe('C_ROTATING_9'); // outside ranges -> rotating
  });

  it('derives the same seed for the same (level, version, bucket)', () => {
    expect(levelSeed('blocks_010', 1, 'A')).toBe(levelSeed('blocks_010', 1, 'A'));
    expect(levelSeed('blocks_010', 1, 'A')).not.toBe(levelSeed('blocks_010', 1, 'B'));
    expect(levelSeed('blocks_010', 1, 'A')).not.toBe(levelSeed('blocks_010', 2, 'A'));
  });

  it('splits decoupled streams that are individually deterministic but distinct', () => {
    const seed = levelSeed('lvl', 1, 'A');
    const a = makeRng(seed);
    const b = makeRng(seed);
    // same seed -> identical sequences per stream
    expect([a.pieces(), a.pieces(), a.pieces()]).toEqual([b.pieces(), b.pieces(), b.pieces()]);
    // streams are independent (targets tuning must not move pieces)
    expect(splitSeed(seed, 'pieces')).not.toBe(splitSeed(seed, 'targets'));
  });
});
