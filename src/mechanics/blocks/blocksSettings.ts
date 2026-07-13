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
    /** Cell size ceiling (logical px). High enough that on a large/desktop
     * panel the board+tray grow to FILL the available height (like sorting)
     * instead of sitting small with empty space below; on a phone the width
     * still binds first, so mobile sizing is unchanged. */
    maxCell: 74,
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
    boardTintAlpha: 0.4,
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
