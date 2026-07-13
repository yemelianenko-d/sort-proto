/**
 * Tuning of the blocks mechanic (mechanic-owned: shared GAME_SETTINGS stays
 * untouched per the additive-only rule; animation timings reused from the
 * shared config where the motions match).
 */
export const BLOCKS_SETTINGS = {
  traySize: 3,
  // Scoring/combo formulas live in blocksScoring.ts (Balance Spec v3 §9),
  // deterministic and unit-tested; the model owns the combo chain state.
  layout: {
    /** Cell size ceiling (logical px). */
    maxCell: 46,
    /** Vertical band reserved ABOVE the board (portrait) for the button row +
     * score/goal panel, so on tall/narrow phones the panel never rides up into
     * the top buttons. Mechanic-owned — the shared hudHeight (92) is untouched. */
    hudBand: 176,
    /** Horizontal room reserved on EACH side of the board for the blueprint
     * decor (dimension lines, datum circles, angle notes) so it never spills off
     * a narrow screen. The board shrinks to fit within w - 2*decorMargin. */
    decorMargin: 32,
    /** How far the decor sits OUTSIDE the board edge (was a hardcoded 26). Lower
     * = decor hugs the board tighter. */
    decorGap: 16,
    /** Paper-toned wash under the board: 0 = fully transparent (notebook grid
     * shows through), 1 = solid. Light wash keeps the field mostly transparent
     * while just muting the background cells so they don't fight the board's
     * own grid. */
    boardWashAlpha: 0.28,
    /** EXPERIMENT: darkening tint painted over the board area (under the grid
     * and tiles) so the playfield reads darker and the colour tiles pop. Set
     * boardTintAlpha to 0 to disable. Tune both freely — pure visual. */
    boardTint: 0x8c8060,
    boardTintAlpha: 0,
    /** Tray strip height in cells (pieces render at trayScale inside). */
    trayHeightCells: 3.6,
    /** Tray preview tile scale relative to the board cell. Smaller than a
     * board tile so the tray reads as "previews"; a picked-up piece grows to
     * full board-tile size. All tray tiles share ONE size per refill (the
     * largest that fits every current piece, capped here) so they never look
     * mismatched. */
    trayScale: 0.75,
    /** Dragged piece rides this many cells above the finger on TOUCH devices
     * (Block-Blast feel: the finger never covers the piece). With a mouse
     * the piece stays under the cursor. */
    dragLiftCells: 1.4,
  },
  animation: {
    /** Rejected piece floats back to its tray slot. */
    returnMs: 220,
    /** Ghost preview alpha on valid placement cells. */
    ghostAlpha: 0.32,
  },
} as const;

/**
 * Which tile-art set is active. Both sets ship and load; flip this in code (on
 * request) to switch the whole board+tray between them. 'new' = the current
 * sketch tiles (tile_N), 'legacy' = the pre-swap tiles (tile_legacy_N).
 */
export type BlocksTileSet = 'new' | 'legacy';
// `as` keeps the union type so the set can be flipped without tsc flagging the
// comparisons below as "no overlap".
export const BLOCKS_TILE_SET = 'new' as BlocksTileSet;

/** Texture key for a colour under the ACTIVE set (used by BlocksView). */
export const blocksTileKey = (color: number): string =>
  BLOCKS_TILE_SET === 'legacy' ? `blocks/tile_legacy_${color}` : `blocks/tile_${color}`;

/** New sketch set — sampled from tile_0..7 by prepare-blocks-tiles.mjs. */
const TILE_TINTS_NEW: readonly number[] = [
  0x97bcf8, 0x83dbd0, 0xfcb979, 0xf9a1bd, 0xbae081, 0xbf9ade, 0xd1a989, 0xfde688,
];
/** Legacy set — the original shared BLOCK_TINTS the pre-swap tiles matched. */
const TILE_TINTS_LEGACY: readonly number[] = [
  0xfb8f85, 0x709cf5, 0x9de27d, 0xfcbf83, 0xd890db, 0xbbbfc5, 0x69d5c8, 0xf57895,
];

/**
 * Per-colour tint (index = TileColor 0..7) for the ACTIVE set — line-clear
 * flashes, ghost previews, win confetti and the celebration burst. Follows
 * BLOCKS_TILE_SET so highlights always match the tiles on screen. MECHANIC-
 * OWNED: never touches the shared BLOCK_TINTS (which the sorting mechanic uses).
 * Re-run prepare-blocks-tiles.mjs and paste TILE_TINTS after any tile-art change.
 */
export const BLOCKS_TILE_TINTS: readonly number[] =
  BLOCKS_TILE_SET === 'legacy' ? TILE_TINTS_LEGACY : TILE_TINTS_NEW;
