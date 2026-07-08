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
  },
  input: {
    /** Pointer travel (px) that turns a press into a drag. */
    dragThresholdPx: 8,
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
  },
  targetColumn: {
    /** Chalk preview opacity inside an empty target column. */
    ghostAlpha: 0.24,
    /** Brief brightening when the wrong color is tapped into it. */
    flashAlpha: 0.45,
  },
  animation: {
    landDurationMs: 200,
    revealDurationMs: 260,
    pulseDurationMs: 450,
    clearBlockDurationMs: 320,
    clearBlockStaggerMs: 40,
    shakeDurationMs: 45,
    sparkDurationMs: 550,
    sparkCount: 8,
  },
} as const;
