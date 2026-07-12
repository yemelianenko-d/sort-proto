/**
 * Praise callouts (Block-Blast-style "Good! / Great! / Legendary!"): a pure
 * classifier of how good the last move was. The scene renders the text; the
 * tier ladder is rarity-ordered so the biggest moments get the loudest words.
 * Stacks with the combo badge (the reference shows both at once).
 */

export type PraiseTier = 'double' | 'triple' | 'quad' | 'allClear';

/** Visual loudness per tier (font size / accent), consumed by the scene. */
export const PRAISE_RANK: Record<PraiseTier, number> = {
  double: 1,
  triple: 2,
  quad: 3,
  allClear: 4,
};

/**
 * Classify a finished move. `lines` = rows+cols cleared by the move,
 * `boardCleared` = the board is completely empty after the clears.
 * Returns null for ordinary moves (0–1 lines, board not emptied).
 */
export function praiseForMove(lines: number, boardCleared: boolean): PraiseTier | null {
  if (boardCleared && lines > 0) return 'allClear'; // rarest, wins over line count
  if (lines >= 4) return 'quad';
  if (lines === 3) return 'triple';
  if (lines === 2) return 'double';
  return null;
}
