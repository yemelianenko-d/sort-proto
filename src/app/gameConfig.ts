/** App-wide constants and the sketch-style visual palette. */
import { version as APP_VERSION } from '../../package.json';

export { APP_VERSION };

export const STORAGE_KEYS = {
  progress: 'sortproto.progress.v1',
  settings: 'sortproto.settings.v1',
} as const;

export const COLORS = {
  paper: 0xfdfcf6,
  paperCss: '#fdfcf6',
  grid: 0x588cc8,
  ink: 0x2b3a67,
  inkCss: '#2b3a67',
  pencil: 0x606678,
  pencilCss: '#606678',
  accentWarm: 0xd97b1f,
  accentGreen: 0x2e7a3f,
  danger: 0xc8452c,
  noteYellow: 0xfff3b0,
} as const;

export type PatternKind = 'stripes' | 'dots' | 'cross' | 'hlines' | 'vlines' | 'solid';

export interface BlockStyle {
  ink: number; // stroke + glyph color
  pattern: PatternKind;
  glyph: string;
}

/** Colour is always doubled by a pattern + glyph (colour-blind friendly). */
export const BLOCK_STYLES: BlockStyle[] = [
  { ink: 0xb23317, pattern: 'stripes', glyph: '✕' },
  { ink: 0x1d5da8, pattern: 'dots', glyph: '○' },
  { ink: 0x2b7a3c, pattern: 'cross', glyph: '△' },
  { ink: 0xc26205, pattern: 'hlines', glyph: '☆' },
  { ink: 0x6836b0, pattern: 'vlines', glyph: '♡' },
  { ink: 0xa51f5e, pattern: 'stripes', glyph: '◇' },
  { ink: 0x0e8578, pattern: 'dots', glyph: '✱' },
  { ink: 0x4a4a4a, pattern: 'solid', glyph: '◻' },
];

/** Perceived block colors sampled from the art textures (block_N.png) —
 * the art palette differs from BLOCK_STYLES.ink (stroke constants), and the
 * player's eye compares against the art. Use these wherever UI must match a
 * block color (chains, target arrows). Regenerate after art changes:
 * `node tools/art/sample-block-tints.mjs`. */
export const BLOCK_TINTS: number[] = [
  0xf07f7b, 0x5685f9, 0x3bb04e, 0xf8b575, 0x9b62cb, 0x9a6e4c, 0x3cb6ba, 0xee6396,
];

export const FONTS = {
  display: 'Caveat, cursive',
  body: 'Neucha, cursive',
} as const;

export const SCENE_KEYS = {
  preload: 'PreloadScene',
  lobby: 'LobbyScene',
  sorting: 'SortingScene',
  error: 'ErrorScene',
} as const;

export interface AppFlags {
  debug: boolean;
  /** Dev shortcut `?level=N` (1-based): boot straight into that level instead
   * of the lobby. null when absent or malformed. Bounds-checked at use site. */
  level: number | null;
}

export function readAppFlags(): AppFlags {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('level');
  const n = raw !== null && /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
  return { debug: params.get('debug') === 'true', level: n >= 1 ? n : null };
}

export const LEVELS_URL = 'levels/sorting_levels.json';
