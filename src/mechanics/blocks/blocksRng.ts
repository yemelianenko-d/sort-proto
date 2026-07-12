/**
 * Deterministic seeding & restart buckets (Balance Spec v3 §8). Same
 * (levelId, balanceVersion, attemptBucket) → same seed → same board, which is
 * required for QA, replay and debugging. Separate streams (pieces / targets /
 * colors) decouple tuning: changing target tuning must not reshuffle the piece
 * sequence.
 */
import { mulberry32 } from './blocksRandom';
import type { RestartPolicy } from './BlocksTypes';

/** cyrb-style 32-bit string hash (deterministic, cross-platform). */
function hash32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

/** Named RNG stream selector. */
export type RngStream = 'pieces' | 'targets' | 'colors';

/**
 * Resolve the seed bucket for an attempt (1-based). A level's restartPolicy
 * may map attempt ranges to buckets; the default is: attempts 1–2 share
 * opening "A", 3–4 "B", 5+ rotate. A bucket tagged "ROTATING" varies per
 * attempt so late retries stop being an identical script.
 */
export function resolveBucket(attemptIndex: number, policy?: RestartPolicy): string {
  let bucket = 'A';
  const buckets = policy?.variationBuckets;
  if (buckets && buckets.length > 0) {
    bucket = 'C_ROTATING';
    for (const b of buckets) {
      if (attemptIndex >= b.attempts[0] && attemptIndex <= b.attempts[1]) {
        bucket = b.bucket;
        break;
      }
    }
  } else {
    if (attemptIndex <= 2) bucket = 'A';
    else if (attemptIndex <= 4) bucket = 'B';
    else bucket = 'C_ROTATING';
  }
  return bucket.includes('ROTATING') ? `${bucket}_${attemptIndex}` : bucket;
}

/** Master seed for a level attempt. */
export function levelSeed(levelId: string, balanceVersion: number, bucket: string): number {
  return hash32(`${levelId}|v${balanceVersion}|${bucket}`);
}

/** A sub-seed for a named stream, split off the master seed. */
export function splitSeed(seed: number, stream: RngStream): number {
  return hash32(`${seed}:${stream}`);
}

export interface BlocksRng {
  /** Piece / batch selection stream. */
  pieces: () => number;
  /** Target spawn / assignment stream. */
  targets: () => number;
  /** Tile colour stream. */
  colors: () => number;
}

/** Build the three decoupled RNG streams from a master seed. */
export function makeRng(seed: number): BlocksRng {
  return {
    pieces: mulberry32(splitSeed(seed, 'pieces')),
    targets: mulberry32(splitSeed(seed, 'targets')),
    colors: mulberry32(splitSeed(seed, 'colors')),
  };
}
