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
}

const DEBUG_STORAGE_KEY = 'sortproto.debug';

export function readAppFlags(): AppFlags {
  const params = new URLSearchParams(window.location.search);
  let persisted = false;
  try {
    persisted = window.localStorage.getItem(DEBUG_STORAGE_KEY) === 'true';
  } catch {
    /* storage unavailable (private mode etc) */
  }
  return { debug: params.get('debug') === 'true' || persisted };
}

/** Cheat-mode toggle without URL access (5 taps on the lobby title). */
export function persistDebugFlag(value: boolean): void {
  try {
    window.localStorage.setItem(DEBUG_STORAGE_KEY, String(value));
  } catch {
    /* ignore */
  }
}

export const LEVELS_URL = 'levels/sorting_levels.json';
