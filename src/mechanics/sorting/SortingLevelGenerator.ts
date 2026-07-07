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
 *    layouts replay a solver path and must show the target pressure shape
 *    (min UniversalDestinationColumns / critical windows) for their band;
 *  - Chain Columns always CONTAIN BLOCKS of the level pool (the vault):
 *    locked-forever ablation is unsolvable by construction (Necessity 4);
 *    colored-chain deadlock gate: the required color never sits inside its
 *    own chain column;
 *  - locked (key) columns carry blocks on plan/master/peak slots too;
 *  - Target Columns come in 1..3 instances of DIFFERENT colors; every
 *    instance passes its own ablation (restriction-off and column-removed),
 *    plus an anti-auto-sort guard (not all target colors exposed on top);
 *  - Ink Blot is a first-class focus mechanic (bottom blots inside playing
 *    columns, 1-2 per column, 1-2 columns) with per-blot ablation;
 *  - macro map per section 13: 1-12 core, 13-25 planning, 26-40 blots,
 *    41-55 targets, 56-70 multi-target + tape intro, 71-85 tape mastery +
 *    key intro, 86-100 key/multi-lock mastery, 101-115 neutral chain vaults,
 *    116-130 colored/mixed chains, 131-142 cross-mechanic, 143-150 peaks;
 *  - wave rhythm per 13.2 (M M MH H relief M MH H MH peak), C5 only after
 *    level 92 (12 slots), 8-type boards are rare late peaks (7 slots).
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

export type Focus = 'none' | 'target' | 'tape' | 'chainN' | 'chainC' | 'key' | 'multilock' | 'blot';
export type Stage = 'show' | 'use' | 'plan' | 'master' | 'relief' | 'peak' | 'build';
/** Pressure gate kind derived from the stage (guideline 3.3 / 13.2). */
export type PressureGate = 'none' | 'tight' | 'window' | 'peak';

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
  /** Blocks sealed inside the chain column (v3 canonical: >= 2). */
  chainLen: number;
  /** Locked column carries blocks (key levels on plan/master/peak). */
  vaultLock: boolean;
  /** Minimum necessity for the focus mechanic (0 disables the gate). */
  minNecessity: number;
  pressure: PressureGate;
}

/** Wave role by position inside a 10-slot wave, per guideline 13.2:
 * M M MH H relief M MH H MH peak. */
function waveStage(pos10: number): Stage {
  switch (pos10) {
    case 1:
      return 'build';
    case 2:
      return 'use';
    case 3:
      return 'plan';
    case 4:
      return 'master';
    case 5:
      return 'relief';
    case 6:
      return 'use';
    case 7:
      return 'plan';
    case 8:
      return 'master';
    case 9:
      return 'plan';
    default:
      return 'peak';
  }
}

function pressureFor(stage: Stage): PressureGate {
  if (stage === 'master') return 'window';
  if (stage === 'peak') return 'peak';
  if (stage === 'plan') return 'tight';
  return 'none';
}

function necessityFor(stage: Stage): number {
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
  ['key', 'chainN'],
  ['tape', 'target'],
  ['multilock', 'blot'],
  ['chainN', 'target'],
  ['tape', 'chainC'],
  ['key', 'blot'],
];

export function cardFor(level: number): SlotCard {
  return normalizeCard(rawCardFor(level));
}

function rawCardFor(level: number): SlotCard {
  const rng = mulberry32(level * 2654435761 + 17);
  const pick = <T>(arr: T[]): T => arr[(rng() * arr.length) | 0];

  const base: SlotCard = {
    level,
    focus: 'none',
    second: 'none',
    stage: 'use',
    types: 4,
    cap: 4,
    empties: 2,
    hidden: true,
    targetCount: 0,
    blotCols: 0,
    blotsPer: 1,
    chainLen: 0,
    vaultLock: false,
    minNecessity: 0,
    pressure: 'none',
  };

  const rangeStage = (start: number): Stage => waveStage(((level - start) % 10) + 1);

  // 1-12: core onboarding — tiny boards, high clarity, no mechanics
  if (level <= 12) {
    return {
      ...base,
      stage: level <= 4 ? 'show' : 'use',
      types: level <= 6 ? 3 : 4,
      cap: level <= 9 ? 3 : 4,
      hidden: level >= 7,
      empties: 2,
    };
  }
  // 13-25: core planning — first pressure windows, no special mechanics
  if (level <= 25) {
    const stage = rangeStage(13);
    return {
      ...base,
      stage,
      types: stage === 'relief' ? 4 : level <= 19 ? 4 : 5,
      cap: level <= 16 ? 3 : 4,
      empties: stage === 'master' || stage === 'peak' ? 1 : 2,
      pressure: stage === 'master' || stage === 'peak' ? 'tight' : 'none',
    };
  }
  // 26-40: topology / partial buffers — Ink Blot intro
  if (level <= 40) {
    const stage = rangeStage(26);
    const relief = stage === 'relief';
    const deep = stage === 'plan' || stage === 'master' || stage === 'peak';
    return {
      ...base,
      focus: relief ? 'none' : 'blot',
      stage,
      types: relief ? 4 : level <= 30 ? 4 : deep ? pick([5, 6]) : 5,
      empties: stage === 'master' || stage === 'peak' ? 1 : 2,
      blotCols: relief ? 0 : deep ? 2 : 1,
      blotsPer: relief ? 1 : stage === 'show' || stage === 'build' ? 1 : pick([1, 2]),
      minNecessity: relief ? 0 : necessityFor(stage),
      pressure: pressureFor(stage),
    };
  }
  // 41-55: specialized storage — Target intro, then first 2 different targets
  if (level <= 55) {
    const stage = rangeStage(41);
    const relief = stage === 'relief';
    const two = level >= 48 && !relief;
    return {
      ...base,
      focus: relief ? 'none' : 'target',
      stage,
      types: relief ? 4 : two ? pick([5, 6]) : 5,
      empties: stage === 'master' || stage === 'peak' ? 1 : 2,
      targetCount: relief ? 0 : two ? 2 : 1,
      minNecessity: relief ? 0 : necessityFor(stage),
      pressure: pressureFor(stage),
    };
  }
  // 56-70: multi-target mastery + delayed buffer (Tape intro)
  if (level <= 70) {
    const stage = rangeStage(56);
    const relief = stage === 'relief';
    const tapePart = level >= 64;
    if (relief) return { ...base, stage, types: 5, empties: 2 };
    if (!tapePart) {
      const three = (stage === 'plan' || stage === 'master' || stage === 'peak') && rng() < 0.6;
      return {
        ...base,
        focus: 'target',
        stage,
        types: three ? pick([6, 6, 7]) : pick([5, 6]),
        empties: stage === 'master' || stage === 'peak' ? 1 : 2,
        targetCount: three ? 3 : 2,
        minNecessity: necessityFor(stage),
        pressure: pressureFor(stage),
      };
    }
    const withTarget = stage === 'master' || stage === 'peak';
    return {
      ...base,
      focus: 'tape',
      second: withTarget ? 'target' : 'none',
      stage,
      types: pick([5, 6]),
      empties: stage === 'master' || stage === 'peak' ? 1 : 2,
      targetCount: withTarget ? 1 : 0,
      minNecessity: necessityFor(stage),
      pressure: pressureFor(stage),
    };
  }
  // 71-85: tape mastery / access objectives (Key intro from 78)
  if (level <= 85) {
    const stage = rangeStage(71);
    const relief = stage === 'relief';
    if (relief) return { ...base, stage, types: 5, empties: 2 };
    const keyPart = level >= 78;
    if (!keyPart) {
      const withBlot = (stage === 'plan' || stage === 'master') && rng() < 0.5;
      return {
        ...base,
        focus: 'tape',
        second: withBlot ? 'blot' : 'none',
        stage,
        types: pick([5, 6, 6]),
        empties: stage === 'master' || stage === 'peak' ? 1 : 2,
        blotCols: withBlot ? 1 : 0,
        blotsPer: 1,
        minNecessity: necessityFor(stage),
        pressure: pressureFor(stage),
      };
    }
    return {
      ...base,
      focus: 'key',
      stage,
      types: pick([5, 6, 6]),
      empties: stage === 'master' || stage === 'peak' ? 1 : 2,
      vaultLock: stage === 'plan' || stage === 'master' || stage === 'peak',
      minNecessity: necessityFor(stage),
      pressure: pressureFor(stage),
    };
  }
  // 86-100: key branches — Key mastery, Multi-Lock, selective target combos
  if (level <= 100) {
    const stage = rangeStage(86);
    const relief = stage === 'relief';
    if (relief) return { ...base, stage, types: 5, empties: 2 };
    const multi = stage === 'master' || stage === 'peak';
    const withTarget = stage === 'plan' && rng() < 0.5;
    return {
      ...base,
      focus: multi ? 'multilock' : 'key',
      second: withTarget ? 'target' : 'none',
      stage,
      types: T8_LEVELS.has(level) ? 8 : pick([6, 6, 7]),
      cap: C5_LEVELS.has(level) ? 5 : 4,
      empties: stage === 'peak' || stage === 'master' ? 1 : 2,
      targetCount: withTarget ? 1 : 0,
      vaultLock: true,
      minNecessity: necessityFor(stage),
      pressure: pressureFor(stage),
    };
  }
  // 101-115: delayed block pool — Neutral Chain Columns with blocks inside
  if (level <= 115) {
    const stage = rangeStage(101);
    const relief = stage === 'relief';
    if (relief) return { ...base, stage, types: 5, empties: 2 };
    const deep = stage === 'plan' || stage === 'master' || stage === 'peak';
    const withTarget = level >= 110 && stage === 'plan';
    return {
      ...base,
      focus: 'chainN',
      second: withTarget ? 'target' : 'none',
      stage,
      types: T8_LEVELS.has(level) ? 8 : deep ? pick([6, 7]) : pick([5, 6]),
      cap: C5_LEVELS.has(level) ? 5 : 4,
      empties: stage === 'master' || stage === 'peak' ? 1 : 2,
      chainLen: deep ? 3 : 2,
      targetCount: withTarget ? 1 : 0,
      minNecessity: necessityFor(stage),
      pressure: pressureFor(stage),
    };
  }
  // 116-130: mandatory set order — colored / mixed chains, multi-target combos
  if (level <= 130) {
    const stage = rangeStage(116);
    const relief = stage === 'relief';
    if (relief) return { ...base, stage, types: 5, empties: 2 };
    const mixed = stage === 'master' || stage === 'peak';
    const withTargets = stage === 'plan' && rng() < 0.5;
    return {
      ...base,
      focus: 'chainC',
      second: withTargets ? 'target' : 'none',
      stage,
      types: T8_LEVELS.has(level) ? 8 : pick([6, 6, 7]),
      cap: C5_LEVELS.has(level) ? 5 : 4,
      empties: stage === 'master' || stage === 'peak' ? 1 : 2,
      chainLen: mixed ? 3 : 2,
      targetCount: withTargets ? 2 : 0,
      minNecessity: necessityFor(stage),
      pressure: pressureFor(stage),
    };
  }
  // 131-142: cross-mechanic mastery — two families
  if (level <= 142) {
    const stage = rangeStage(131);
    const relief = stage === 'relief';
    if (relief) return { ...base, stage, types: 5, empties: 2 };
    const [a, b] = pick(CROSS_PAIRS);
    const card: SlotCard = {
      ...base,
      focus: a,
      second: b,
      stage,
      types: T8_LEVELS.has(level) ? 8 : pick([6, 6, 7]),
      cap: C5_LEVELS.has(level) ? 5 : 4,
      empties: stage === 'master' || stage === 'peak' ? 1 : 2,
      minNecessity: necessityFor(stage),
      pressure: pressureFor(stage),
    };
    return fillMechanicKnobs(card, rng);
  }
  // 143-150: expert peaks
  const peakStages: Stage[] = ['plan', 'master', 'peak', 'relief', 'plan', 'master', 'peak', 'peak'];
  const stage = peakStages[level - 143];
  if (stage === 'relief') return { ...base, stage, types: 5, empties: 2 };
  const [a, b] = pick(CROSS_PAIRS);
  const card: SlotCard = {
    ...base,
    focus: a,
    second: b,
    stage,
    types: T8_LEVELS.has(level) ? 8 : pick([7, 7, 8]),
    cap: C5_LEVELS.has(level) ? 5 : 4,
    empties: stage === 'peak' || stage === 'master' ? 1 : 2,
    minNecessity: necessityFor(stage),
    pressure: pressureFor(stage),
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
  if (has('chainN') || has('chainC')) c.chainLen = c.stage === 'peak' ? 3 : rng() < 0.5 ? 3 : 2;
  if (has('key') || has('multilock')) c.vaultLock = true;
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
    if (c.focus === 'key' || c.focus === 'multilock') c.focus = 'chainN';
    if (c.second === 'key' || c.second === 'multilock') c.second = 'none';
    if (c.focus === 'chainN' && c.chainLen === 0) c.chainLen = 2;
    if (c.empties < 2) c.empties = 2;
    // pure board-load: duration is the axis, a critical-window demand on a
    // narrow 8-type board mostly produces rejects
    if (c.pressure === 'window' || c.pressure === 'peak') c.pressure = 'tight';
  }
  // C5 + 8 types + combos is a forbidden stack (guideline 12.3)
  if (c.cap === 5 && c.types >= 8) c.types = 7;
  if (c.cap === 5 && c.pressure === 'window') c.pressure = 'tight';
  if (c.cap === 5 && c.second !== 'none' && c.empties < 2) c.empties = 2;
  const width = (): number => {
    const locks = c.focus === 'multilock' || c.second === 'multilock' ? 2
      : c.focus === 'key' || c.second === 'key' ? 1 : 0;
    const hasChain = c.chainLen > 0 || c.focus === 'chainN' || c.focus === 'chainC' || c.second === 'chainN' || c.second === 'chainC';
    // key slack + locked column; chain column; blots displace pool blocks
    // into roughly one extra filled column; vault blocks free some room back
    return (
      c.types +
      (locks > 0 ? 2 : 0) +
      (hasChain ? 1 : 0) +
      (c.blotCols > 0 ? 1 : 0) +
      c.empties +
      c.targetCount
    );
  };
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
  chains: number[];
  chainBlocks: ColorId[] | null;
  lockBlocks: ColorId[] | null;
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

  // chains + the chain vault (v3 canonical: the chain column holds blocks)
  let chains: number[] = [];
  if (wantsMech(card, 'chainN')) chains.push(-1);
  if (wantsMech(card, 'chainC')) chains.push((rng() * colors) | 0);
  if (card.stage === 'master' && chains.length === 1 && chains[0] === -1 && rng() < 0.4) {
    chains = [-1, -1];
  }
  let chainBlocks: ColorId[] | null = null;
  if (chains.length > 0) {
    const len = Math.min(Math.max(2, card.chainLen || 2), cap - 1);
    // deadlock gate: colored-chain colors never sit inside their own column
    const forbidden = new Set(chains.filter((c) => c >= 0));
    chainBlocks = extractVault(pool, len, forbidden, rng);
    if (!chainBlocks) return null;
  }

  // locked vault: blocks behind the key lock (plan/master/peak key levels)
  let lockBlocks: ColorId[] | null = null;
  if (locks > 0 && card.vaultLock) {
    // keep colored-chain colors out of the locked vault too: the chain
    // condition should be completable without waiting for a second mechanic
    const forbidden = new Set(chains.filter((c) => c >= 0));
    lockBlocks = extractVault(pool, Math.min(2 + ((rng() * 2) | 0), cap - 1), forbidden, rng);
    if (!lockBlocks) return null;
  }

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
  for (let e = 0; e < card.empties; e++) cols.push([]);

  // no column may start completed (vaults are shorter than cap by design)
  const startCompleted = cols.some((col) => {
    if (col.length !== cap) return false;
    const first = col[0];
    if (first < 0) return false;
    return col.every((c) => c === first);
  });
  if (startCompleted) return null;

  return { cols, taped, targets, chains, chainBlocks, lockBlocks, locks, blotColIdx };
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
    cols.push((b.lockBlocks ?? []).slice());
    locked = cols.length - 1;
    locks = b.locks;
    if (opts.forever) locks = 1_000_000;
    if (opts.openFromStart) {
      locked = -1;
      locks = 0;
    }
  }
  let chainCol = -1;
  let chains: number[] = [];
  if (b.chains.length > 0) {
    cols.push((b.chainBlocks ?? []).slice());
    chainCol = cols.length - 1;
    chains = opts.neutralChains ? b.chains.map(() => -1) : b.chains.slice();
    if (opts.forever) chains = [-2]; // sentinel no set ever removes
    if (opts.openFromStart) {
      chainCol = -1;
      chains = [];
    }
  }
  return {
    cols,
    cap,
    locked,
    locks,
    chainCol,
    chains,
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
    case 'chainN':
    case 'chainC': {
      const vaulted = m.startsWith('chain') ? (b.chainBlocks?.length ?? 0) > 0 : (b.lockBlocks?.length ?? 0) > 0;
      let nec: number;
      if (vaulted) {
        // canonical v3: sealed blocks make the forever variant unsolvable
        const forever = solve(stateOf(b, cap, { forever: true }), 20000);
        nec = forever <= 0 ? 4 : necessityFromDelta(base, forever);
      } else {
        const forever = solve(stateOf(b, cap, { forever: true }), 30000);
        nec = necessityFromDelta(base, forever);
      }
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

/* ---------------- pressure profile (guideline 3) ---------------- */

export interface PressureStats {
  minUDC: number;
  windows: number;
  longest: number;
}

/** UniversalDestinationColumns: normal columns able to accept at least one
 * currently exposed movable block (target-restricted empties are
 * specialized, not universal). */
function udcOf(st: SolverState): number {
  const exposed = new Set<number>();
  for (let i = 0; i < st.cols.length; i++) {
    if (i === st.locked || i === st.chainCol) continue;
    const col = st.cols[i];
    const top = col[col.length - 1];
    if (top === undefined || top === SPECIAL.INK || top === SPECIAL.KEY) continue;
    exposed.add(top);
  }
  if (exposed.size === 0) return 0;
  let udc = 0;
  for (let j = 0; j < st.cols.length; j++) {
    if (j === st.locked || j === st.chainCol || st.taped.has(j)) continue;
    const to = st.cols[j];
    if (to.length >= st.cap) continue;
    if (to.length === 0) {
      if (!st.targets.has(j)) udc++;
      continue;
    }
    const top = to[to.length - 1];
    if (top === SPECIAL.INK || exposed.has(top)) udc++;
  }
  return udc;
}

/** Replays a solver path and derives the pressure shape. A state is "tight"
 * when UDC <= 1 and few safe alternatives remain; a Critical Window is a run
 * of >= 2 consecutive tight states (guideline 3.3, approximated with legal
 * move count standing in for SafeMoveCount). */
function pressureStats(start: SolverState, path: SolverMove[]): PressureStats {
  const st = cloneState(start);
  let minUDC = Infinity;
  let windows = 0;
  let longest = 0;
  let run = 0;
  const trace: number[] = [];
  for (const mv of path) {
    const udc = udcOf(st);
    const valid = legalMoves(st).length;
    trace.push(udc);
    minUDC = Math.min(minUDC, udc);
    // tightness is universal-space scarcity; the legal-move bound is only a
    // light sanity cap (raw legal count is a poor proxy for SafeMoveCount)
    const tight = udc <= 1 && valid <= 8;
    if (tight) {
      run++;
      longest = Math.max(longest, run);
      if (run === 2) windows++;
    } else {
      run = 0;
    }
    applyMove(st, mv);
  }
  (globalThis as { __udcTrace?: (t: number[]) => void }).__udcTrace?.(trace);
  return { minUDC: minUDC === Infinity ? 0 : minUDC, windows, longest };
}

function passesPressure(gate: PressureGate, p: PressureStats): boolean {
  switch (gate) {
    case 'none':
      return true;
    case 'tight':
      return p.minUDC <= 1;
    case 'window':
      return p.windows >= 1;
    case 'peak':
      return p.windows >= 2 || p.longest >= 3;
  }
}

/* ---------------- generation ---------------- */

export interface LevelMeta {
  card: SlotCard;
  optimal: number;
  necessity: Partial<Record<Focus, number>>;
  pressure: PressureStats;
  attempts: number;
  relaxed: boolean;
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

export function generateSortingLevelWithMeta(index: number): {
  config: SortingLevelConfig;
  meta: LevelMeta;
} {
  const level = index + 1;
  const id = `level_${String(level).padStart(3, '0')}`;
  const baseCard = cardFor(level);

  // relaxation ladder: strict card -> +1 empty (pressure gate off) ->
  // drop second mechanic -> downgrade multilock
  const ladder: { card: SlotCard; relaxed: boolean }[] = [
    { card: baseCard, relaxed: false },
    {
      card: { ...baseCard, empties: Math.min(3, baseCard.empties + 1) as 1 | 2 | 3, pressure: 'none' },
      relaxed: true,
    },
    {
      card: {
        ...baseCard,
        second: 'none',
        targetCount: baseCard.focus === 'target' ? baseCard.targetCount : 0,
        empties: Math.min(3, baseCard.empties + 1) as 1 | 2 | 3,
        pressure: 'none',
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
        pressure: 'none',
      },
      relaxed: true,
    },
  ];

  let attempts = 0;
  const dbg = (r: string): void => { (globalThis as { __genDbg?: (r: string) => void }).__genDbg?.(r); };
  for (const { card, relaxed } of ladder) {
    for (let a = 0; a < 90; a++) {
      attempts++;
      const rng = mulberry32(index * 7919 + attempts * 104729 + 29);
      const built = buildLayout(card, rng);
      if (!built) { dbg('layout'); continue; }

      const state = stateOf(built, card.cap);
      const budget = card.empties === 1 ? 140000 : 60000;
      const base = solveBest(state, 2, budget);
      if (base <= 0) { dbg('solve'); continue; }

      // pressure gate first: the level must feel like its band, not just
      // contain its mechanics (and one solvePath is cheaper than ablations)
      let pressure: PressureStats = { minUDC: 0, windows: 0, longest: 0 };
      let pressurePassed = false;
      if (card.pressure !== 'none') {
        const path = solvePath(state, budget);
        if (!path) { dbg('path'); continue; }
        pressure = pressureStats(state, path);
        if (!passesPressure(card.pressure, pressure)) { dbg('pressure u' + pressure.minUDC + ' w' + pressure.windows); continue; }
        pressurePassed = card.pressure === 'window' || card.pressure === 'peak';
      }

      const necessity: Partial<Record<Focus, number>> = {};
      let pass = true;
      for (const m of [card.focus, card.second]) {
        if (m === 'none') continue;
        let need = m === card.focus ? card.minNecessity : Math.min(card.minNecessity, 2);
        // a proven critical window already carries the band; the target
        // family then needs "no decorative instance" (>= 2), not >= 3
        if (m === 'target' && pressurePassed) need = Math.min(need, 2);
        const n = mechanicNecessity(m, built, card.cap, base);
        necessity[m] = n;
        if (n < need) {
          pass = false;
          dbg('necessity:' + m + '=' + n);
          break;
        }
      }
      if (!pass) continue;

      const config: SortingLevelConfig = {
        id,
        cap: card.cap,
        par: Math.max(card.types + 1, Math.round(base * 1.15)),
        difficulty: level,
        columns: built.cols,
        hiddenBelowTop: card.hidden,
        lockedColumn: built.locks > 0,
        lockedColumnLocks: built.locks > 1 ? built.locks : undefined,
        lockedColumnBlocks: built.lockBlocks ?? undefined,
        chains: built.chains.length > 0 ? built.chains : undefined,
        chainedColumnBlocks: built.chainBlocks ?? undefined,
        targetColumns: built.targets.length > 0 ? built.targets : undefined,
        tapedColumns: built.taped.length > 0 ? built.taped : undefined,
      };
      return {
        config,
        meta: { card, optimal: base, necessity, pressure, attempts, relaxed },
      };
    }
  }

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
      pressure: { minUDC: 0, windows: 0, longest: 0 },
      attempts,
      relaxed: true,
    },
  };
}

export function generateSortingLevel(index: number): SortingLevelConfig {
  return generateSortingLevelWithMeta(index).config;
}
