/**
 * Gameplay and tuning settings (config-driven, no magic numbers in code).
 * Balance-relevant values live here; per-level values live in the level JSON.
 */
export const GAME_SETTINGS = {
  boosters: {
    /** Keys available per session for the locked-column booster. */
    initialKeys: 3,
    /** Lens charges per session (reveals one hidden block). */
    initialLenses: 3,
    /** Undo charges per session (the back button is a booster too). */
    initialUndos: 3,
    /** Blocks "Revive" charges per session: on game over, clear the board and
     * continue the run (keeps score/collected). Cheat can top these up. */
    initialRevives: 5,
  },
  input: {
    /** Pointer travel (logical px) that turns a press into a drag. Sized for
     * touch: a finger "tap" rolls a few px, so a low threshold turned taps
     * into drags that released on the same column and silently deselected the
     * block. Drag is only a convenience (tap-to-pick + tap-to-place also
     * works), so bias toward keeping small movements as taps. */
    dragThresholdPx: 16,
  },
  hint: {
    /** Idle nudge for beginners: pulse a valid move source. Disabled — the
     * idle column pulse read as an unwanted "vibration". */
    enabled: false,
    /** Idle nudge for beginners: pulse a valid move source. */
    idleDelayMs: 4500,
    /** Nudge only on the first levels (0-based inclusive index). */
    maxLevelIndex: 1,
  },
  haptics: {
    movePattern: 8,
    clearPattern: [10, 40, 14],
    boosterPattern: 10,
  },
  scoring: {
    /** 2★ threshold = ceil(par * twoStarFactor); above it -> 1★. */
    twoStarFactor: 1.5,
  },
  loading: {
    /** Fonts are best-effort: cap waiting so slow CDNs never block launch. */
    fontTimeoutMs: 2500,
  },
  lobby: {
    /** Grid shows this many cells in total (scrollable). */
    totalCells: 150,
  },
  layoutSizes: {
    hudHeight: 92,
    boosterBarHeight: 84,
    // Landscape on phones is height-starved: slimmer top/bottom bars hand the
    // scarce vertical space back to the board so cells grow toward maxCell.
    hudHeightLandscape: 52,
    boosterBarHeightLandscape: 64,
  },
  targetColumn: {
    /** Chalk preview opacity inside an empty target column. */
    ghostAlpha: 0.24,
    /** Brief brightening when the wrong color is tapped into it. */
    flashAlpha: 0.45,
  },
  animation: {
    landDurationMs: 200,
    /** Landing squash-and-stretch (juice): impact scale + settle timing.
     * Paper cut-outs — keep it subtle, not cartoonish. */
    landSquashX: 1.12,
    landSquashY: 0.86,
    landSquashMs: 55,
    landSettleMs: 120,
    revealDurationMs: 260,
    pulseDurationMs: 450,
    clearBlockDurationMs: 320,
    clearBlockStaggerMs: 40,
    shakeDurationMs: 45,
    sparkDurationMs: 550,
    sparkCount: 8,
    /** Done-column ribbon unfurl (nine-slice height grows top->bottom). */
    ribbonUnrollMs: 420,
  },
} as const;
