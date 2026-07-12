import { describe, it, expect } from 'vitest';
import { praiseForMove, PRAISE_RANK } from './blocksPraise';

describe('praiseForMove', () => {
  it('stays silent on ordinary moves', () => {
    expect(praiseForMove(0, false)).toBeNull();
    expect(praiseForMove(1, false)).toBeNull();
  });

  it('grades multi-line clears by line count', () => {
    expect(praiseForMove(2, false)).toBe('double');
    expect(praiseForMove(3, false)).toBe('triple');
    expect(praiseForMove(4, false)).toBe('quad');
    expect(praiseForMove(6, false)).toBe('quad');
  });

  it('all-clear beats any line count', () => {
    expect(praiseForMove(1, true)).toBe('allClear');
    expect(praiseForMove(4, true)).toBe('allClear');
  });

  it('an empty board without a clearing move is not an all-clear', () => {
    // guards the constructor/no-clear case: boardCleared only counts with lines
    expect(praiseForMove(0, true)).toBeNull();
  });

  it('ranks tiers by rarity for the scene loudness', () => {
    expect(PRAISE_RANK.allClear).toBeGreaterThan(PRAISE_RANK.quad);
    expect(PRAISE_RANK.quad).toBeGreaterThan(PRAISE_RANK.triple);
    expect(PRAISE_RANK.triple).toBeGreaterThan(PRAISE_RANK.double);
  });
});
