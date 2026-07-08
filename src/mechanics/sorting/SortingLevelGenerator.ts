import { SPECIAL } from './SortingTypes';
import type { ColorId, SortingLevelConfig } from './SortingTypes';
import {
  solveBest,
  solve,
  solvePath,
  legalMoves,
  applyMove,
  cloneState,
  type SolverState,
  type SolverMove,
} from './SortingSolver';

/**
 * Level generator v3 — implements Balance & Level Design Guideline V3
 * (mechanic-critical-path balance):
 *
 *  - difficulty is PRESSURE OVER TIME, not mechanic presence: accepted
 *    the generator scores each candidate layout for hardness (branching
 *    factor + tight-state runs + spare space) and keeps the hardest;
 *  - Sealed Columns always CONTAIN BLOCKS of the level pool (the vault):
 *    locked-forever ablation is unsolvable by construction (Necessity 4).
 *    Every seal is COLOUR-BOUND (neutral seals removed); the deadlock gate
 *    keeps a seal's colour out of its own sealed column; 1-2 seals per column;
 *  - locked (key) columns carry blocks on plan/master/peak slots too;
 *  - Target Columns come in 1..3 instances of DIFFERENT colors; every
 *    instance passes its own ablation (restriction-off and column-removed),
 *    plus an anti-auto-sort guard (not all target colors exposed on top);
 *  - Ink Blot is a first-class focus mechanic (bottom blots inside playing
 *    columns, 1-2 per column, 1-2 columns) with per-blot ablation;
 *  - curve "C" (braided + smooth): two independent schedules — stageFor gives
 *    the local wave texture under a progress ceiling (no early spikes), and
 *    MECH_INTRO debuts each mechanic early (blot L8 ... seal L32) at zero
 *    pressure; base difficulty rises with the LEVEL, not with the mechanic
 *    being introduced, so there is no per-intro sawtooth. Combinations layer
 *    in from ~L56 via curated CROSS_PAIRS. C5 only after level 92 (12 slots),
 *    8-type boards are rare late peaks (7 slots).
 *
 * Deterministic per index. Invariant: every color has exactly `cap` copies
 * (counting vault blocks) and all columns share one nominal capacity.
 */

/* ---------------- rng ---------------- */

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ---------------- slot map ---------------- */

export type Focus = 'none' | 'target' | 'tape' | 'chainC' | 'key' | 'multilock' | 'blot';
export type Stage = 'show' | 'use' | 'plan' | 'master' | 'relief' | 'peak' | 'build';

export interface SlotCard {
  level: number;
  focus: Focus;
  /** Second mechanic family for combination levels (gated separately). */
  second: Focus;
  stage: Stage;
  types: number;
  cap: number;
  /** Universal empty columns — the Buffer Units knob. */
  empties: 1 | 2 | 3;
  hidden: boolean;
  /** Target column instances (different colors each). */
  targetCount: 0 | 1 | 2 | 3;
  /** Columns carrying bottom ink blots and blots per such column. */
  blotCols: number;
  blotsPer: 1 | 2;
  /** Blocks sealed inside each sealed column (v3 canonical: >= 2). */
  chainLen: number;
  /** Number of separate sealed columns (0 none, 1, or 2 in hard stages). */
  sealColumns: number;
  /** Minimum necessity for the focus mechanic (0 disables the gate). */
  minNecessity: number;
}

/* ---------------- Curve C: braided mechanics + smooth climb ----------------
 * Two independent schedules replace the old per-mechanic macro bands:
 *  - stageFor(level): local wave texture with a PROGRESS CEILING, so early
 *    waves stay gentle and pressure only unlocks as the player climbs (no
 *    early spikes -> fixes "hard levels appear abruptly").
 *  - MECH_INTRO: each mechanic debuts early (first ~L8, all by ~L44) at zero
 *    pressure, then recurs; combinations layer in from ~L56. Base board
 *    difficulty rises with the LEVEL, not with which mechanic is introduced,
 *    removing the old sawtooth (easy reset on every new mechanic). */

/** First appearance of each mechanic - early and braided. */
const MECH_INTRO: readonly { at: number; focus: Focus }[] = [
  { at: 8, focus: 'blot' },
  { at: 14, focus: 'target' },
  { at: 20, focus: 'tape' },
  { at: 26, focus: 'key' },
  { at: 32, focus: 'chainC' },
  { at: 38, focus: 'multilock' },
];

/** Mechanics unlocked (already introduced) by a given level. */
function introducedBy(level: number): Focus[] {
  return MECH_INTRO.filter((m) => level >= m.at).map((m) => m.focus);
}

const STAGE_ORDER: Stage[] = ['show', 'build', 'use', 'relief', 'plan', 'master', 'peak'];

/** Local wave texture with a progress ceiling on pressure. */
function stageFor(level: number): Stage {
  const pos = ((level - 1) % 10) + 1; // 1..10 within a 10-level wave
  let s: Stage;
  if (pos === 1) s = 'build';
  else if (pos <= 3) s = 'use';
  else if (pos === 5) s = 'relief';
  else if (pos === 4 || pos === 6) s = 'plan';
  else if (pos === 7 || pos === 9) s = 'master';
  else s = 'peak'; // 8, 10
  // Pressure ceiling: unlocks gradually so the climb has no early spikes.
  let ceil: Stage = 'peak';
  if (level <= 12) ceil = 'use';
  else if (level <= 26) ceil = 'plan';
  else if (level <= 55) ceil = 'master';
  if (s !== 'relief' && STAGE_ORDER.indexOf(s) > STAGE_ORDER.indexOf(ceil)) s = ceil;
  // Strong finale: no breather in the last stretch.
  if (level >= 141 && (s === 'build' || s === 'use' || s === 'relief')) s = 'master';
  return s;
}


/** Designed minimum necessity per stage — the generator's own target and the
 * baker's necessity gate share this single source of truth. Intro ('build')
 * and breather ('relief') stages are gentle by design → 0. */
export function necessityFor(stage: Stage): number {
  if (stage === 'relief' || stage === 'build') return 0;
  if (stage === 'plan') return 2;
  if (stage === 'master' || stage === 'peak') return 3;
  return 2; // show / use
}

/** C5 slots: 12 late-game levels (>= 92), never two in a row. */
const C5_LEVELS = new Set([93, 97, 102, 106, 111, 117, 122, 127, 134, 138, 144, 149]);
/** 8-type board-load peaks (7 levels, late game only). */
const T8_LEVELS = new Set([126, 132, 137, 143, 146, 148, 150]);

const CROSS_PAIRS: [Focus, Focus][] = [
  ['target', 'chainC'],
  ['key', 'chainC'],
  ['tape', 'target'],
  ['multilock', 'blot'],
  ['blot', 'chainC'],
  ['tape', 'chainC'],
  ['key', 'blot'],
];

export function cardFor(level: number): SlotCard {
  return normalizeCard(rawCardFor(level));
}

function rawCardFor(level: number): SlotCard {
  const rng = mulberry32(level * 2654435761 + 17);
  const pick = <T>(arr: T[]): T => arr[(rng() * arr.length) | 0];

  let stage = stageFor(level);
  const introHere = MECH_INTRO.find((m) => m.at === level);
  if (introHere) stage = 'build'; // every mechanic debuts at zero pressure
  const relief = stage === 'relief';
  const unlocked = introducedBy(level);

  let focus: Focus = 'none';
  let second: Focus = 'none';
  if (!relief) {
    if (introHere) {
      focus = introHere.focus;
    } else if (unlocked.length > 0) {
      focus = pick(unlocked);
      // Combinations layer in as the player masters the growing set. Prefer a
      // curated cross-pair (sensible combos), else any other unlocked mechanic.
      const comboChance = level < 52 ? 0 : level < 90 ? 0.35 : level < 120 ? 0.55 : 0.7;
      if (unlocked.length >= 2 && rng() < comboChance) {
        const partners = CROSS_PAIRS.filter(
          ([a, b]) => (a === focus && unlocked.includes(b)) || (b === focus && unlocked.includes(a)),
        ).map(([a, b]) => (a === focus ? b : a));
        const poolC = partners.length > 0 ? partners : unlocked.filter((m) => m !== focus);
        second = pick(poolC);
      }
    }
  }

  // Base board difficulty rises with the level, independent of the mechanic
  // schedule - this keeps the curve smooth (no per-intro reset).
  let types: number;
  if (level <= 6) types = 3;
  else if (level <= 14) types = 4;
  else if (level <= 30) types = 5;
  else if (level <= 60) types = pick([5, 6]);
  else if (level <= 100) types = pick([6, 6, 7]);
  else types = pick([6, 7, 7]);
  if (T8_LEVELS.has(level)) types = 8;

  let cap = level <= 9 ? 3 : 4;
  if (C5_LEVELS.has(level)) cap = 5;

  const empties: 1 | 2 = stage === 'master' || stage === 'peak' ? 1 : 2;

  const card: SlotCard = {
    level,
    focus,
    second,
    stage,
    types,
    cap,
    empties,
    hidden: level >= 5,
    targetCount: 0,
    blotCols: 0,
    blotsPer: 1,
    chainLen: 0,
    sealColumns: 0,
    minNecessity: relief ? 0 : necessityFor(stage),
  };
  return fillMechanicKnobs(card, rng);
}

/** Sets the per-mechanic knobs (targets, blots, chain length, vault) that a
 * cross-pair card needs, based on which families it carries. */
function fillMechanicKnobs(card: SlotCard, rng: () => number): SlotCard {
  const c = { ...card };
  const has = (m: Focus): boolean => c.focus === m || c.second === m;
  if (has('target')) c.targetCount = c.stage === 'peak' ? (rng() < 0.5 ? 3 : 2) : 2;
  if (has('blot')) {
    c.blotCols = c.stage === 'peak' || c.stage === 'master' ? 2 : 1;
    c.blotsPer = rng() < 0.5 ? 2 : 1;
  }
  if (has('chainC')) {
    c.chainLen = c.stage === 'peak' ? 3 : rng() < 0.5 ? 3 : 2;
    // Phase 2: a second sealed column on the hardest boards (width permitting;
    // normalizeCard trims it back if the board would overflow)
    c.sealColumns = (c.stage === 'master' || c.stage === 'peak') && rng() < 0.5 ? 2 : 1;
  }
  return c;
}

/** Board width guard (<= 11 columns) + safety downgrades. */
function normalizeCard(card: SlotCard): SlotCard {
  const c = { ...card };
  if (c.focus === 'target' || c.second === 'target') c.targetCount = Math.max(1, c.targetCount) as 1 | 2 | 3;
  // 3 targets need enough non-target branches (guideline 7.6)
  if (c.targetCount === 3 && c.types < 6) c.types = 6;
  // targets must not cover most of the palette (auto-sort risk)
  while (c.targetCount > 1 && c.types - c.targetCount < 3) c.targetCount = (c.targetCount - 1) as 1 | 2 | 3;
  // T8 boards: pure board load — keep the mechanic narrow
  if (T8_LEVELS.has(c.level)) {
    c.types = 8;
    if (c.focus === 'key' || c.focus === 'multilock') c.focus = 'chainC';
    if (c.second === 'key' || c.second === 'multilock') c.second = 'none';
    if (c.focus === 'chainC' && c.chainLen === 0) c.chainLen = 2;
    if (c.empties < 2) c.empties = 2;
  }
  // keep sealColumns consistent with the chainC family
  if (c.focus === 'chainC' || c.second === 'chainC') c.sealColumns = Math.max(1, c.sealColumns);
  else c.sealColumns = 0;
  // C5 + 8 types + combos is a forbidden stack (guideline 12.3)
  if (c.cap === 5 && c.types >= 8) c.types = 7;
  if (c.cap === 5 && c.second !== 'none' && c.empties < 2) c.empties = 2;
  const width = (): number => {
    const locks = c.focus === 'multilock' || c.second === 'multilock' ? 2
      : c.focus === 'key' || c.second === 'key' ? 1 : 0;
    // key slack + locked column; one column per sealed column; blots displace
    // pool blocks into ~one extra filled column; vault blocks free some room
    return (
      c.types +
      (locks > 0 ? 2 : 0) +
      c.sealColumns +
      (c.blotCols > 0 ? 1 : 0) +
      c.empties +
      c.targetCount
    );
  };
  while (width() > 11 && c.sealColumns > 1) c.sealColumns -= 1;
  while (width() > 11 && c.types > 4) c.types -= 1;
  while (width() > 11 && c.targetCount > 1) c.targetCount = (c.targetCount - 1) as 1 | 2 | 3;
  if (width() > 11 && c.blotCols > 0) c.blotCols = 0;
  // a blot family with zero blot columns cannot pass its gate
  if (c.blotCols === 0 && c.second === 'blot') c.second = 'none';
  if (c.blotCols === 0 && c.focus === 'blot') c.blotCols = 1;
  return c;
}

/* ---------------- layout building ---------------- */

interface BuildOut {
  cols: ColorId[][];
  taped: number[];
  targets: { col: number; color: number }[];
  /** Up to 2 sealed columns, each with its seal colours + vault blocks. */
  sealed: { chains: number[]; blocks: ColorId[] }[];
  locks: number;
  blotColIdx: number[];
}

function wantsMech(card: SlotCard, m: Focus): boolean {
  return card.focus === m || card.second === m;
}

/** Pulls `n` movable color blocks out of the pool, avoiding `forbidden`
 * colors; prefers >= 2 distinct colors when possible. */
function extractVault(
  pool: ColorId[],
  n: number,
  forbidden: Set<number>,
  rng: () => number,
): ColorId[] | null {
  const idx = pool
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c >= 0 && !forbidden.has(c));
  if (idx.length < n) return null;
  shuffle(idx, rng);
  const chosen = idx.slice(0, n);
  // try to guarantee two distinct colors inside (mastery guidance 10.2)
  if (n >= 2 && new Set(chosen.map((x) => x.c)).size === 1) {
    const alt = idx.slice(n).find((x) => x.c !== chosen[0].c);
    if (alt) chosen[n - 1] = alt;
  }
  chosen.sort((a, b) => b.i - a.i).forEach(({ i }) => pool.splice(i, 1));
  return chosen.map(({ c }) => c);
}

function buildLayout(card: SlotCard, rng: () => number): BuildOut | null {
  const cap = card.cap;
  const colors = card.types;
  const pool: ColorId[] = [];
  for (let c = 0; c < colors; c++) for (let k = 0; k < cap; k++) pool.push(c);

  const locks = wantsMech(card, 'multilock') ? 2 : wantsMech(card, 'key') ? 1 : 0;
  for (let k = 0; k < locks; k++) pool.push(SPECIAL.KEY);
  shuffle(pool, rng);

  // sealed columns (up to 2). Each holds a vault of blocks and carries one or
  // two colour-bound seals: a completed set of that colour removes it. Seal
  // colours are distinct across columns; the deadlock gate keeps a seal's
  // colour out of its own sealed column.
  const sealed: { chains: number[]; blocks: ColorId[] }[] = [];
  if (wantsMech(card, 'chainC')) {
    const nCols = Math.max(1, card.sealColumns || 1);
    const usedColors = new Set<number>();
    const len = Math.min(Math.max(2, card.chainLen || 2), cap - 1);
    for (let s = 0; s < nCols; s++) {
      const seals: number[] = [];
      let c0 = (rng() * colors) | 0;
      for (let t = 0; t < colors && usedColors.has(c0); t++) c0 = (c0 + 1) % colors;
      seals.push(c0);
      usedColors.add(c0);
      // a single sealed column may carry a SECOND seal on the hardest boards
      if (nCols === 1 && (card.stage === 'master' || card.stage === 'peak') && rng() < 0.4) {
        let c2 = (rng() * colors) | 0;
        if (c2 === seals[0]) c2 = (c2 + 1) % colors;
        seals.push(c2);
      }
      const blocks = extractVault(pool, len, new Set(seals), rng);
      if (!blocks) return null;
      sealed.push({ chains: seals, blocks });
    }
  }

  // locked columns are ALWAYS empty reward space (blocks live only inside
  // chain columns) — an access objective, not a sealed pool

  // blot columns: ink at the bottom of otherwise-normal playing columns
  const cols: ColorId[][] = [];
  const blotColIdx: number[] = [];
  for (let b = 0; b < card.blotCols; b++) {
    const blots = Math.min(card.blotsPer, cap - 2); // keep >= 2 movable slots
    const col: ColorId[] = Array(blots).fill(SPECIAL.INK);
    for (let s = 0; s < cap - blots && pool.length > 0; s++) {
      const idx = pool.findIndex((c) => c >= 0);
      if (idx < 0) break;
      col.push(pool.splice(idx, 1)[0]);
    }
    blotColIdx.push(cols.length);
    cols.push(col);
  }

  // remaining pool into full columns (last one may be partial)
  for (let p = 0; p < pool.length; p += cap) {
    cols.push(pool.slice(p, Math.min(p + cap, pool.length)));
  }

  // key placement rules: keys never on top; distinct columns; depth by stage
  if (locks > 0) {
    const keyPos: { col: number; depth: number }[] = [];
    cols.forEach((col, ci) =>
      col.forEach((c, si) => {
        if (c === SPECIAL.KEY) keyPos.push({ col: ci, depth: col.length - 1 - si });
      }),
    );
    if (keyPos.length !== locks) return null;
    if (keyPos.some((k) => k.depth === 0)) return null;
    if (locks === 2) {
      if (keyPos[0].col === keyPos[1].col) return null;
      if (!keyPos.some((k) => k.depth >= 2)) return null;
    }
    const wantDeep = card.stage === 'master' || card.stage === 'peak' || card.stage === 'plan';
    if (wantDeep && !keyPos.some((k) => k.depth >= 2)) return null;
    if (!wantDeep && keyPos.every((k) => k.depth > 2)) return null;
  }

  // taped column: pressure grows with distinct colors inside
  const taped: number[] = [];
  if (wantsMech(card, 'tape')) {
    const candidates = cols
      .map((col, i) => ({ i, distinct: new Set(col.filter((c) => c >= 0)).size, len: col.length }))
      .filter(
        (x) =>
          x.len > 1 && !cols[x.i].includes(SPECIAL.INK) && !cols[x.i].includes(SPECIAL.KEY),
      );
    const minDistinct = card.stage === 'show' || card.stage === 'use' || card.stage === 'build' ? 2 : 3;
    const good = candidates.filter((x) => x.distinct >= minDistinct);
    if (good.length === 0) return null;
    good.sort((a, b) => b.distinct - a.distinct || b.len - a.len || rng() - 0.5);
    taped.push(good[0].i);
  }

  // target columns (distinct colors) + universal empties
  const targets: { col: number; color: number }[] = [];
  if (card.targetCount > 0) {
    const palette = shuffle(Array.from({ length: colors }, (_, i) => i), rng);
    for (let t = 0; t < card.targetCount; t++) {
      cols.push([]);
      targets.push({ col: cols.length - 1, color: palette[t] });
    }
    // anti-auto-sort guard (D.4): with 2+ targets, not every target color
    // may be exposed as a top block from move one
    if (targets.length >= 2) {
      const tops = new Set(
        cols.map((col) => (col.length > 0 ? col[col.length - 1] : -99)).filter((c) => c >= 0),
      );
      if (targets.every((t) => tops.has(t.color))) return null;
    }
  }
  // targets are specialized buffers (an empty column that accepts one color);
  // if we ALSO hand out the full universal-empty count the board turns into a
  // field of empty columns (the "too many free columns" complaint). Budget
  // total spare space: each target substitutes for one universal empty. Floor
  // keeps a little maneuvering room; the relaxation ladder adds empties back
  // if a board turns out unsolvable.
  const universalEmpties = Math.max(card.targetCount > 0 ? 0 : 1, card.empties - card.targetCount);
  for (let e = 0; e < universalEmpties; e++) cols.push([]);

  // no column may start completed (vaults are shorter than cap by design)
  const startCompleted = cols.some((col) => {
    if (col.length !== cap) return false;
    const first = col[0];
    if (first < 0) return false;
    return col.every((c) => c === first);
  });
  if (startCompleted) return null;

  return { cols, taped, targets, sealed, locks, blotColIdx };
}

/* ---------------- solver state assembly & ablation variants ---------------- */

interface StateOpts {
  /** Locked/chained columns never open (their blocks stay sealed). */
  forever?: boolean;
  /** Locked/chained columns open from move zero. */
  openFromStart?: boolean;
  /** Remove the target restriction of this column (stays an empty column). */
  freeTargetCol?: number;
  /** Remove this (empty target) column from the board entirely. */
  dropCol?: number;
  tapeOff?: boolean;
  /** Strip ink blots from this column. */
  stripBlotsCol?: number;
  /** Replace colored chain conditions with neutral ones. */
  neutralChains?: boolean;
}

function stateOf(b: BuildOut, cap: number, opts: StateOpts = {}): SolverState {
  let cols = b.cols.map((c) => c.slice());
  let targets = new Map(b.targets.map((t) => [t.col, t.color]));
  if (opts.freeTargetCol !== undefined) targets.delete(opts.freeTargetCol);
  if (opts.stripBlotsCol !== undefined) {
    cols[opts.stripBlotsCol] = cols[opts.stripBlotsCol].filter((c) => c !== SPECIAL.INK);
  }
  if (opts.dropCol !== undefined) {
    const dropped = opts.dropCol;
    cols = cols.filter((_, i) => i !== dropped);
    targets = new Map(
      [...targets.entries()]
        .filter(([col]) => col !== dropped)
        .map(([col, color]) => [col > dropped ? col - 1 : col, color]),
    );
  }
  let locked = -1;
  let locks = 0;
  if (b.locks > 0) {
    cols.push([]); // empty reward column
    locked = cols.length - 1;
    locks = b.locks;
    if (opts.forever) locks = 1_000_000;
    if (opts.openFromStart) {
      locked = -1;
      locks = 0;
    }
  }
  const chainCols: number[] = [];
  const chainSeals: number[][] = [];
  for (const s of b.sealed) {
    cols.push(s.blocks.slice()); // the vault column is pushed either way
    if (opts.openFromStart) continue; // present but open (a normal column)
    chainCols.push(cols.length - 1);
    let seals = opts.neutralChains ? s.chains.map(() => -1) : s.chains.slice();
    if (opts.forever) seals = [-2]; // sentinel: no set ever removes it
    chainSeals.push(seals);
  }
  return {
    cols,
    cap,
    locked,
    locks,
    chainCols,
    chainSeals,
    taped: new Set(opts.tapeOff ? [] : b.taped),
    targets,
  };
}

/* ---------------- necessity gates (ablation in the accept loop) ---------------- */

function necessityFromDelta(base: number, ablated: number): number {
  if (ablated <= 0) return 4;
  const delta = (ablated - base) / base;
  const abs = ablated - base; // short optima make ratios noisy
  if (delta >= 0.2 || abs >= 4) return 3;
  if (delta >= 0.08 || abs >= 2) return 2;
  if (delta > 0) return 1;
  return 0;
}

/** Necessity of one mechanic family on this layout. */
function mechanicNecessity(m: Focus, b: BuildOut, cap: number, base: number): number {
  switch (m) {
    case 'key':
    case 'multilock':
    case 'chainC': {
      // chain columns carry a vault (sealed blocks) -> forever-locked is
      // unsolvable by construction (necessity 4). Key/lock columns are empty
      // reward space, so their necessity is proven by ablation: if never
      // opening the column still lets the level finish easily, the key is
      // decorative and this layout is rejected (guideline 9.1).
      const forever = solve(stateOf(b, cap, { forever: true }), 30000);
      let nec = forever <= 0 ? 4 : necessityFromDelta(base, forever);
      if (m === 'chainC' && nec >= 2) {
        // the color condition must not be decorative (10.7): the neutral
        // variant should change the route at least a little
        const neutral = solve(stateOf(b, cap, { neutralChains: true }), 30000);
        if (neutral > 0 && Math.abs(neutral - base) === 0) nec = Math.min(nec, 2);
      }
      return nec;
    }
    case 'tape': {
      const normal = solve(stateOf(b, cap, { tapeOff: true }), 30000);
      if (normal <= 0) return 0;
      return necessityFromDelta(normal, base);
    }
    case 'target': {
      // per-instance gates (7.5): every instance must matter (>= 2), either
      // as a binding restriction or as needed storage; the family necessity
      // is its strongest instance (combination rule 12.1: each >= 2,
      // primary >= 3)
      if (b.targets.length === 0) return 0;
      let minInstance = 4;
      let maxInstance = 0;
      for (const t of b.targets) {
        const freed = solve(stateOf(b, cap, { freeTargetCol: t.col }), 30000);
        const restriction = freed > 0 ? necessityFromDelta(freed, base) : 0;
        const removed = solve(stateOf(b, cap, { dropCol: t.col }), 30000);
        const storage = necessityFromDelta(base, removed);
        const inst = Math.max(restriction, storage);
        minInstance = Math.min(minInstance, inst);
        maxInstance = Math.max(maxInstance, inst);
        if (minInstance === 0) break;
      }
      return minInstance < 2 ? Math.min(minInstance, 1) : maxInstance;
    }
    case 'blot': {
      // per-blot-column ablation (11.4): at least one blot column must
      // change the route when its blockers are stripped
      let best = 0;
      for (const ci of b.blotColIdx) {
        const stripped = solve(stateOf(b, cap, { stripBlotsCol: ci }), 30000);
        if (stripped <= 0) continue;
        best = Math.max(best, necessityFromDelta(stripped, base));
      }
      return best;
    }
    default:
      return 0;
  }
}


/* ---------------- hardness (prototype: difficulty engine) ---------------- */

/** Universal free columns: empty, non-target, non-closed, non-taped. This is
 * the "spare space" the player actually has — the thing that stays too high
 * and even grows in our current levels. */
function freeUniversal(st: SolverState): number {
  let f = 0;
  for (let j = 0; j < st.cols.length; j++) {
    if (j === st.locked || st.chainCols.includes(j) || st.taped.has(j)) continue;
    if (st.cols[j].length === 0 && !st.targets.has(j)) f++;
  }
  return f;
}

export interface Hardness {
  score: number;
  avgBranch: number;
  tightStates: number;
  minFree: number;
  longestTight: number;
}

/** Scores how hard a layout plays by replaying a solution path: fewer legal
 * moves per state (less aimless shuffling), more consecutive tight states
 * (real critical windows), and less universal spare space all raise the
 * score. Path is the DFS solution; used consistently so comparisons are fair. */
function hardnessOf(start: SolverState, path: SolverMove[]): Hardness {
  if (path.length === 0) {
    return { score: 0, avgBranch: 99, tightStates: 0, minFree: 99, longestTight: 0 };
  }
  const st = cloneState(start);
  let sumBranch = 0;
  let tightStates = 0;
  let minFree = Infinity;
  let longestTight = 0;
  let run = 0;
  for (const mv of path) {
    const branch = legalMoves(st).length;
    const free = freeUniversal(st);
    sumBranch += branch;
    minFree = Math.min(minFree, free);
    const tight = free <= 1 && branch <= 6;
    if (tight) {
      run++;
      tightStates++;
      longestTight = Math.max(longestTight, run);
    } else {
      run = 0;
    }
    applyMove(st, mv);
  }
  const avgBranch = sumBranch / path.length;
  const minF = minFree === Infinity ? 0 : minFree;
  const startFree = freeUniversal(start);
  // higher = harder: reward tight windows and low spare space, penalize a
  // high average branching factor (lots of interchangeable options) and a
  // board that just starts loose (many empty columns on move one)
  const score =
    tightStates * 3 +
    longestTight * 2 +
    Math.max(0, 8 - avgBranch) * 1.5 +
    Math.max(0, 2 - minF) * 2 -
    Math.max(0, startFree - 1) * 2.5;
  return { score, avgBranch, tightStates, minFree: minF, longestTight };
}




/* ---------------- generation ---------------- */

export interface LevelMeta {
  card: SlotCard;
  optimal: number;
  necessity: Partial<Record<Focus, number>>;
  hardness?: Hardness;
  trap?: TrapStats;
  attempts: number;
  relaxed: boolean;
}

/** Trap-targeted selection (guideline: real difficulty is punished mistakes,
 * not busywork). On planning-heavy stages the generator aims the pick at a
 * trap-density goal: the fraction of legal moves that stay solvable
 * (safeRatio) should drop to ~0.5-0.6 on the hardest slots instead of the
 * 0.7-0.8 a purely structural pick tends to produce. */
function trapTargetFor(stage: Stage): number | null {
  // Nudged tighter for a touch more challenge on the graded stages (the pick
  // hunts denser boards); the curve shape is unchanged, only the trap density.
  if (stage === 'peak') return 0.56;
  if (stage === 'master') return 0.58;
  if (stage === 'plan') return 0.7;
  return null;
}

/** Guaranteed-solvable trivial layout (emergency fallback). */
function fallbackColumns(colors: number, cap: number): ColorId[][] {
  const cols: ColorId[][] = [];
  for (let c = 0; c < colors; c++) {
    const col = Array<ColorId>(cap - 1).fill(c);
    col.push((c + 1) % colors);
    cols.push(col);
  }
  cols.push([], []);
  return cols;
}

export function generateSortingLevelWithMeta(
  index: number,
  opts: { selectHardest?: boolean } = {},
): {
  config: SortingLevelConfig;
  meta: LevelMeta;
} {
  const level = index + 1;
  const id = `level_${String(level).padStart(3, '0')}`;
  const baseCard = cardFor(level);

  // scarcity lever: when hunting for the hardest layout, try a tighter-buffer
  // variant of hard slots FIRST, so spare space stays scarce instead of the
  // board only opening up as sets clear. Solvable tight boards win; if none
  // solve, the ladder falls through to the normal buffer count.
  const hardStage = baseCard.stage === 'plan' || baseCard.stage === 'master' || baseCard.stage === 'peak';
  const tightRung: { card: SlotCard; relaxed: boolean }[] =
    opts.selectHardest && hardStage && baseCard.empties > 1
      ? [{ card: { ...baseCard, empties: (baseCard.empties - 1) as 1 | 2 | 3 }, relaxed: false }]
      : [];

  // relaxation ladder: [tight] -> strict card -> +1 empty
  // -> drop second mechanic -> downgrade multilock
  const ladder: { card: SlotCard; relaxed: boolean }[] = [
    ...tightRung,
    { card: baseCard, relaxed: false },
    {
      card: { ...baseCard, empties: Math.min(3, baseCard.empties + 1) as 1 | 2 | 3 },
      relaxed: true,
    },
    {
      card: {
        ...baseCard,
        second: 'none',
        targetCount: baseCard.focus === 'target' ? baseCard.targetCount : 0,
        empties: Math.min(3, baseCard.empties + 1) as 1 | 2 | 3,
      },
      relaxed: true,
    },
    {
      card: {
        ...baseCard,
        focus: baseCard.focus === 'multilock' ? 'key' : baseCard.focus,
        second: 'none',
        targetCount: baseCard.focus === 'target' ? baseCard.targetCount : 0,
        empties: Math.min(3, baseCard.empties + 1) as 1 | 2 | 3,
      },
      relaxed: true,
    },
  ];

  let attempts = 0;
  let best: { config: SortingLevelConfig; meta: LevelMeta; score: number } | null = null;
  type PassEntry = { config: SortingLevelConfig; meta: LevelMeta; h: Hardness; built: BuildOut };
  let passPool: PassEntry[] = [];
  for (const { card, relaxed } of ladder) {
    passPool = []; // candidates are chosen within a single (preferably strict) rung
    let passCount = 0;
    let trapHits = 0;
    // trap-targeted stages keep digging (up to 150 attempts) while no board
    // has hit the trap goal yet; everything else stays at the fast 90
    const rungTarget = trapTargetFor(card.stage);
    for (let a = 0; a < (rungTarget !== null && trapHits === 0 ? 150 : 90); a++) {
      attempts++;
      const rng = mulberry32(index * 7919 + attempts * 104729 + 29);
      const built = buildLayout(card, rng);
      if (!built) continue;

      const state = stateOf(built, card.cap);
      const budget = card.empties === 1 ? 140000 : 60000;
      const base = solveBest(state, 2, budget);
      if (base <= 0) continue;

      const necessity: Partial<Record<Focus, number>> = {};
      let pass = true;
      let margin = 0; // how far every mechanic clears its gate (>= 0 passes)
      for (const m of [card.focus, card.second]) {
        if (m === 'none') continue;
        let need = m === card.focus ? card.minNecessity : Math.min(card.minNecessity, 2);
        // C5 is intrinsically roomy: a target reaching necessity 3 is rare,
        // so demanding it forces a weak level. Require "no decorative
        // instance" (>= 2) there instead (guideline 7.5 / 12.1).
        if (m === 'target' && card.cap === 5) need = Math.min(need, 2);
        // empty reward columns (keys/locks carry no vault now) realistically
        // prove necessity 2, not 3; the per-lock demand is the buried-key
        // placement rules, not an inflated global score.
        if ((m === 'key' || m === 'multilock') && need > 2) need = 2;
        const n = mechanicNecessity(m, built, card.cap, base);
        necessity[m] = n;
        margin += n - need;
        if (n < need) pass = false;
      }

      const config: SortingLevelConfig = {
        id,
        cap: card.cap,
        par: Math.max(card.types + 1, Math.round(base * 1.15)),
        difficulty: level,
        columns: built.cols,
        hiddenBelowTop: card.hidden,
        lockedColumn: built.locks > 0,
        lockedColumnLocks: built.locks > 1 ? built.locks : undefined,
        sealedColumns: built.sealed.length > 0 ? built.sealed : undefined,
        targetColumns: built.targets.length > 0 ? built.targets : undefined,
        tapedColumns: built.taped.length > 0 ? built.taped : undefined,
      };
      const meta: LevelMeta = { card, optimal: base, necessity, attempts, relaxed };

      if (pass) {
        if (!opts.selectHardest) return { config, meta };
        // difficulty engine: score this passing layout and keep every passing
        // candidate of this rung; the final pick happens after the scan (by
        // hardness, and on trap-targeted stages also by trap density)
        const hp = solvePath(state, budget);
        const h = hp
          ? hardnessOf(state, hp)
          : { score: -1, avgBranch: 99, tightStates: 0, minFree: 99, longestTight: 0 };
        const target = trapTargetFor(card.stage);
        // trap probe: a cheap prefix-bounded estimate of how punishing the
        // board is; only measured on stages that have a trap goal
        const trap =
          target !== null ? trapStatsOf(stateOf(built, card.cap), 10, 40000, 10000) : undefined;
        passPool.push({ config, meta: { ...meta, hardness: h, trap }, h, built });
        if (trap && trap.safeRatio <= target!) trapHits++;
        // pool sizing: ~24 candidates is plenty when picking purely by
        // structure; on trap stages stop as soon as a few boards hit the
        // trap goal, and keep scanning while none has (deeper on the
        // hardest stages, where trap-dense boards are rarest)
        passCount++;
        if (target === null && passCount >= 24) break;
        const noHitCap = card.stage === 'plan' ? 40 : 60;
        if (target !== null && (trapHits >= 3 || passCount >= (trapHits > 0 ? 24 : noHitCap))) break;
        continue;
      }

      // no layout cleared the gate yet — remember the strongest real one so we
      // never fall back to a trivial board on a hard slot (score favors
      // mechanics closest to their gate, then longer solutions)
      const score = margin * 1000 + base;
      if (!best || score > best.score) best = { config, meta: { ...meta, relaxed: true }, score };
    }
    // a passing layout on this rung wins; only descend to relaxed rungs if
    // this rung produced no passing candidate at all
    if (opts.selectHardest && passPool.length > 0) {
      passPool.sort((x, y) => y.h.score - x.h.score);
      const target = trapTargetFor(card.stage);
      if (target === null) {
        // no trap goal on this stage: hardest by structural score, as before
        const w = passPool[0];
        return { config: w.config, meta: w.meta };
      }
      // trap-targeted selection (guideline: peak safeRatio 0.5-0.6): among
      // candidates that hit the goal prefer knife-edge decisions and
      // structure; when none does, the closest to the goal wins
      const onTarget = passPool.filter((e) => (e.meta.trap?.safeRatio ?? 1) <= target);
      const pick =
        onTarget.length > 0
          ? onTarget.reduce((a, b) =>
              (b.meta.trap?.knifeEdge ?? 0) * 3 + b.h.score >
              (a.meta.trap?.knifeEdge ?? 0) * 3 + a.h.score
                ? b
                : a,
            )
          : passPool.reduce((a, b) =>
              (b.meta.trap?.safeRatio ?? 1) < (a.meta.trap?.safeRatio ?? 1) ? b : a,
            );
      return { config: pick.config, meta: pick.meta };
    }
  }

  // best real candidate found (mechanic present, just short of the ideal
  // necessity) beats a trivial fallback
  if (best) return { config: best.config, meta: best.meta };

  // emergency fallback: trivial but valid
  return {
    config: {
      id,
      cap: 4,
      par: 8,
      difficulty: level,
      columns: fallbackColumns(Math.max(4, baseCard.types), 4),
      hiddenBelowTop: false,
      lockedColumn: false,
    },
    meta: {
      card: baseCard,
      optimal: 6,
      necessity: {},
      attempts,
      relaxed: true,
    },
  };
}

export function generateSortingLevel(index: number): SortingLevelConfig {
  return generateSortingLevelWithMeta(index).config;
}

/* ---------------- experimental: trap-density analysis ---------------- */

export interface TrapStats {
  safeRatio: number; // fraction of legal moves that keep the puzzle solvable
  knifeEdge: number; // states with >=3 legal moves but <=1 safe move
  decisions: number; // states with >=3 legal moves
}

/** Measures how punishing a layout is along a solution prefix: at each state,
 * how many legal moves stay solvable. Low safeRatio / high knifeEdge = the
 * player must plan ahead or deadlock. Prefix-bounded to stay affordable. */
export function trapStatsOf(
  start: SolverState,
  prefix = 16,
  pathBudget = 120000,
  moveBudget = 40000,
): TrapStats {
  const path = solvePath(start, pathBudget);
  if (!path) return { safeRatio: 1, knifeEdge: 0, decisions: 0 };
  const st = cloneState(start);
  let sumLegal = 0;
  let sumSafe = 0;
  let decisions = 0;
  let knifeEdge = 0;
  const steps = Math.min(prefix, path.length);
  for (let i = 0; i < steps; i++) {
    const legal = legalMoves(st);
    if (legal.length > 0) {
      let safe = 0;
      for (const m of legal) {
        const nx = cloneState(st);
        applyMove(nx, m);
        if (solve(nx, moveBudget) >= 0) safe++;
      }
      sumLegal += legal.length;
      sumSafe += safe;
      if (legal.length >= 3) {
        decisions++;
        if (safe <= 1) knifeEdge++;
      }
    }
    applyMove(st, path[i]);
  }
  return { safeRatio: sumLegal ? sumSafe / sumLegal : 1, knifeEdge, decisions };
}

