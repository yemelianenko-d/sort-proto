import { SPECIAL } from './SortingTypes';
import type { ColorId, SortingLevelConfig } from './SortingTypes';
import { solveBest, solve, type SolverState } from './SortingSolver';

/**
 * Level generator v2 — implements the Balance & Level Design Guideline:
 *
 *  - a SLOT MAP assigns every level a design card (focus mechanic, stage of
 *    the Show -> Use -> Plan -> Master -> Combine flow, block type count,
 *    capacity, universal Buffer Units, wave role within the decade);
 *  - Buffer Units are the primary difficulty knob (1..3 universal empties);
 *  - MECHANIC NECESSITY is enforced in the accept loop via ablation solves
 *    (locked-forever / column-removed / tape->normal), thresholds from the
 *    Meaningful Impact Gate: unsolvable=4, >=20% extra moves=3, >=8%=2;
 *  - macro roadmap: 1-10 onboarding, 11-20 planning, 21-30 Target,
 *    31-40 Tape, 41-50 Neutral Chain, 51-60 Key, 61-70 mastery + first
 *    pairs, 71-80 Colored Chain, 81-90 Multi-Lock, 91-110 advanced
 *    (first C5), 111-130 combinations, 131-150 expert mix;
 *  - ink is a board-pressure seasoning (dead slots), not a focus mechanic;
 *  - booster-only locks are not generated (bonus space taxes the wallet).
 *
 * Deterministic per index. The invariant never violated: every color has
 * exactly `cap` copies and all columns share one capacity.
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

export type Focus = 'none' | 'target' | 'tape' | 'chainN' | 'chainC' | 'key' | 'multilock';
export type Stage = 'show' | 'use' | 'plan' | 'master' | 'relief' | 'peak' | 'build';

export interface SlotCard {
  level: number;
  focus: Focus;
  /** Second mechanic for combination levels (each gated separately). */
  second: Focus;
  stage: Stage;
  types: number;
  cap: number;
  /** Universal empty columns — the Buffer Units knob. */
  empties: 1 | 2 | 3;
  hidden: boolean;
  /** Chance of adding 1-2 ink dead slots as board pressure. */
  inkChance: number;
  /** Minimum necessity for the focus mechanic (0 disables the gate). */
  minNecessity: number;
}

/** Wave role by position inside a decade (1..10), per the guideline. */
function waveStage(pos: number): Stage {
  if (pos === 1) return 'build'; // easy re-entry
  if (pos === 5 || pos === 10) return 'relief';
  if (pos === 9) return 'peak';
  if (pos === 8) return 'master';
  if (pos >= 6) return 'plan';
  return pos <= 2 ? 'show' : 'use';
}

/** Intro decade for a mechanic: Show(1-2) -> Use(3-4) -> relief(5) ->
 * Plan(6-7) -> Master(8) -> Peak(9) -> relief(10). */
function introCard(level: number, focus: Focus, typesByStage: Record<string, number>): SlotCard {
  const pos = ((level - 1) % 10) + 1;
  const stage = waveStage(pos);
  const isRelief = stage === 'relief';
  const types = typesByStage[stage] ?? typesByStage.use;
  const empties: 1 | 2 | 3 = stage === 'master' || stage === 'peak' ? 1 : 2;
  const minNecessity = isRelief ? 0 : stage === 'plan' || stage === 'master' || stage === 'peak' ? 3 : 2;
  return {
    level,
    focus: isRelief ? 'none' : focus,
    second: 'none',
    stage,
    types: isRelief ? Math.max(4, types - 1) : types,
    cap: 4,
    empties: isRelief ? 2 : empties,
    hidden: true,
    inkChance: stage === 'plan' || stage === 'peak' ? 0.2 : 0,
    minNecessity,
  };
}

const PAIRS: [Focus, Focus][] = [
  ['target', 'chainN'],
  ['tape', 'key'],
  ['chainN', 'chainC'],
  ['target', 'chainC'],
  ['key', 'chainN'],
  ['multilock', 'target'],
];

const SINGLES: Focus[] = ['target', 'tape', 'chainN', 'chainC', 'key', 'multilock'];

/** C5 slots: 12 late-game levels, never in long series (>= level 92). */
const C5_LEVELS = new Set([92, 97, 103, 108, 114, 119, 124, 129, 135, 141, 146, 149]);
/** 8-type board-load peaks (10 levels) — pure board-load: single mechanic,
 * 2 empties, no ink; never on a C5 or triple slot (dangerous combination). */
const T8_LEVELS = new Set([69, 79, 89, 99, 109, 118, 126, 132, 137, 142]);

/** Board width guard (<= 11 columns) + the T8 pure-board-load policy. */
function normalizeCard(card: SlotCard): SlotCard {
  const c = { ...card };
  if (T8_LEVELS.has(c.level)) {
    // pure board-load peak: 8 types need a narrow mechanic (key/multilock
    // cost two extra columns and would push the board past the width cap)
    c.types = 8;
    c.second = 'none';
    if (c.focus === 'key' || c.focus === 'multilock') {
      c.focus = c.level % 2 === 0 ? 'chainN' : 'tape';
    }
    c.empties = c.empties < 2 ? 2 : c.empties;
    c.inkChance = 0;
    c.minNecessity = Math.min(c.minNecessity, 2);
  }
  // combination levels need breathing room: pairs never run on 1 BU
  // (the guideline's dangerous-combination rule)
  if (c.second !== 'none' && c.empties < 2) c.empties = 2;
  const width = (): number => {
    const locks = c.focus === 'multilock' || c.second === 'multilock' ? 2
      : c.focus === 'key' || c.second === 'key' ? 1 : 0;
    const hasChain = c.focus === 'chainN' || c.focus === 'chainC' || c.second === 'chainN' || c.second === 'chainC';
    const hasTarget = c.focus === 'target' || c.second === 'target';
    return (
      c.types +
      (locks > 0 ? 2 : 0) + // key slack column + the locked column itself
      (hasChain ? 1 : 0) +
      (c.inkChance > 0.5 ? 1 : 0) +
      c.empties +
      (hasTarget ? 1 : 0)
    );
  };
  while (width() > 11 && c.types > 4) c.types -= 1;
  if (width() > 11 && c.inkChance > 0) c.inkChance = 0;
  return c;
}

export function cardFor(level: number): SlotCard {
  return normalizeCard(rawCardFor(level));
}

function rawCardFor(level: number): SlotCard {
  const rng = mulberry32(level * 2654435761 + 17);
  const pos = ((level - 1) % 10) + 1;
  const stage = waveStage(pos);
  const pick = <T>(arr: T[]): T => arr[(rng() * arr.length) | 0];

  // 1-10: onboarding — tiny boards, C3, no mechanics, hidden from 5
  if (level <= 10) {
    return {
      level,
      focus: 'none',
      second: 'none',
      stage: level <= 4 ? 'show' : 'use',
      types: level <= 4 ? 3 : 4,
      cap: 3,
      empties: 2,
      hidden: level >= 5,
      inkChance: 0,
      minNecessity: 0,
    };
  }
  // 11-20: core planning — buffer & mixing, no special mechanics
  if (level <= 20) {
    return {
      level,
      focus: 'none',
      second: 'none',
      stage,
      types: level <= 15 ? 4 : 5,
      cap: level <= 13 ? 3 : 4,
      empties: stage === 'master' || stage === 'peak' ? 1 : 2,
      hidden: true,
      inkChance: 0,
      minNecessity: 0,
    };
  }
  // mechanic introduction decades
  if (level <= 30) return introCard(level, 'target', { show: 4, use: 5, build: 5, plan: 5, master: 6, peak: 6, relief: 4 });
  if (level <= 40) return introCard(level, 'tape', { show: 5, use: 5, build: 5, plan: 6, master: 6, peak: 6, relief: 4 });
  if (level <= 50) return introCard(level, 'chainN', { show: 5, use: 5, build: 5, plan: 6, master: 6, peak: 6, relief: 4 });
  if (level <= 60) return introCard(level, 'key', { show: 5, use: 5, build: 5, plan: 6, master: 6, peak: 6, relief: 4 });

  // 61-70: single-mechanic mastery + first controlled pairs (positions 6-9)
  if (level <= 70) {
    const combo = pos >= 6 && pos !== 10;
    const [a, b] = pick(PAIRS.slice(0, 3));
    return {
      level,
      focus: stage === 'relief' ? 'none' : combo ? a : pick(['target', 'tape', 'chainN', 'key'] as Focus[]),
      second: combo ? b : 'none',
      stage,
      types: stage === 'relief' ? 5 : T8_LEVELS.has(level) ? 8 : pick([6, 7, 7]),
      cap: 4,
      empties: stage === 'peak' || stage === 'master' ? 1 : 2,
      hidden: true,
      inkChance: 0.2,
      minNecessity: stage === 'relief' ? 0 : 2,
    };
  }
  if (level <= 80) return introCard(level, 'chainC', { show: 5, use: 6, build: 6, plan: 6, master: 7, peak: T8_LEVELS.has(level) ? 8 : 7, relief: 5 });
  if (level <= 90) return introCard(level, 'multilock', { show: 6, use: 6, build: 6, plan: 7, master: 7, peak: T8_LEVELS.has(level) ? 8 : 7, relief: 5 });

  // 91-110: advanced singles + pairs, first C5
  if (level <= 110) {
    const combo = stage === 'plan' || stage === 'master';
    const [a, b] = pick(PAIRS);
    return {
      level,
      focus: stage === 'relief' ? 'none' : combo ? a : pick(SINGLES),
      second: combo ? b : 'none',
      stage,
      types: stage === 'relief' ? 5 : T8_LEVELS.has(level) ? 8 : pick([6, 7, 7]),
      cap: C5_LEVELS.has(level) ? 5 : 4,
      empties: stage === 'peak' ? 1 : 2,
      hidden: true,
      inkChance: 0.25,
      minNecessity: stage === 'relief' ? 0 : 2,
    };
  }
  // 111-130: combination mastery — pairs are the core
  if (level <= 130) {
    const [a, b] = pick(PAIRS);
    const solo = stage === 'relief' || stage === 'build';
    return {
      level,
      focus: stage === 'relief' ? 'none' : solo ? pick(SINGLES) : a,
      second: solo ? 'none' : b,
      stage,
      types: stage === 'relief' ? 5 : T8_LEVELS.has(level) ? 8 : (solo ? pick([6, 7, 7]) : pick([6, 7])),
      cap: C5_LEVELS.has(level) ? 5 : 4,
      empties: stage === 'peak' || stage === 'master' ? 1 : 2,
      hidden: true,
      inkChance: 0.25,
      minNecessity: stage === 'relief' ? 0 : 2,
    };
  }
  // 131-150: expert mix — pairs, rare triples (peaks only, <= 7 total)
  const triple = (pos === 9 || pos === 8) && [134, 138, 139, 143, 144, 148, 149].includes(level);
  const [a, b] = pick(PAIRS);
  return {
    level,
    focus: stage === 'relief' ? 'none' : a,
    second: stage === 'relief' ? 'none' : b,
    stage,
    types: stage === 'relief' ? 5 : T8_LEVELS.has(level) ? 8 : pick([6, 7, 7]),
    cap: C5_LEVELS.has(level) ? 5 : 4,
    empties: stage === 'peak' || stage === 'master' ? 1 : 2,
    hidden: true,
    inkChance: triple ? 0.9 : 0.25, // the third mechanic of a triple is ink pressure
    minNecessity: stage === 'relief' ? 0 : 2,
  };
}

/* ---------------- layout building ---------------- */

interface BuildOut {
  cols: ColorId[][];
  taped: number[];
  targets: { col: number; color: number }[];
  chains: number[];
  locked: boolean;
  locks: number;
}

function wantsMech(card: SlotCard, m: Focus): boolean {
  return card.focus === m || card.second === m;
}

function buildLayout(card: SlotCard, rng: () => number): BuildOut | null {
  const cap = card.cap;
  const colors = card.types;
  const pool: ColorId[] = [];
  for (let c = 0; c < colors; c++) for (let k = 0; k < cap; k++) pool.push(c);

  const locked = wantsMech(card, 'key') || wantsMech(card, 'multilock');
  const locks = wantsMech(card, 'multilock') ? 2 : locked ? 1 : 0;
  for (let k = 0; k < locks; k++) pool.push(SPECIAL.KEY);
  shuffle(pool, rng);

  // ink seasoning: dead bottom slots in a dedicated column
  const inkCol: ColorId[] = [];
  if (rng() < card.inkChance) {
    const blots = 1 + ((rng() * 2) | 0);
    for (let s = 0; s < Math.min(blots, cap - 1); s++) inkCol.push(SPECIAL.INK);
    const park = Math.min(2, cap - inkCol.length, pool.length);
    for (let s = 0; s < park; s++) {
      const idx = pool.findIndex((c) => c >= 0);
      if (idx >= 0) inkCol.push(pool.splice(idx, 1)[0]);
    }
  }

  // filled columns (+1 slack column when keys are pooled)
  const filled = colors + (locks > 0 ? 1 : 0);
  const cols: ColorId[][] = [];
  let p = 0;
  for (let i = 0; i < filled; i++) {
    const take = Math.min(cap, pool.length - p);
    cols.push(pool.slice(p, p + take));
    p += take;
  }
  if (p < pool.length) return null;
  if (inkCol.length > 0) cols.push(inkCol);

  // key placement rules: keys in distinct columns; depth by stage
  if (locks > 0) {
    const keyPos: { col: number; depth: number }[] = [];
    cols.forEach((col, ci) =>
      col.forEach((c, si) => {
        if (c === SPECIAL.KEY) keyPos.push({ col: ci, depth: col.length - 1 - si });
      }),
    );
    if (keyPos.some((k) => k.depth === 0)) return null; // never on top
    if (locks === 2) {
      if (keyPos[0].col === keyPos[1].col) return null; // distinct branches
      if (!keyPos.some((k) => k.depth >= 2)) return null; // one strategic dig
    }
    const wantDeep = card.stage === 'master' || card.stage === 'peak' || card.stage === 'plan';
    if (wantDeep && !keyPos.some((k) => k.depth >= 2)) return null;
    if (!wantDeep && keyPos.every((k) => k.depth > 2)) return null; // show/use keep it readable
  }

  // taped column: pressure grows with distinct colors inside
  const taped: number[] = [];
  if (wantsMech(card, 'tape')) {
    const candidates = cols
      .map((col, i) => ({ i, distinct: new Set(col.filter((c) => c >= 0)).size, len: col.length }))
      .filter((x) => x.len > 1 && !cols[x.i].includes(SPECIAL.INK) && !cols[x.i].includes(SPECIAL.KEY));
    const minDistinct = card.stage === 'show' || card.stage === 'use' ? 2 : 3;
    const good = candidates.filter((x) => x.distinct >= minDistinct);
    if (good.length === 0) return null;
    taped.push(good[(rng() * good.length) | 0].i);
  }

  // empties + target columns
  const targets: { col: number; color: number }[] = [];
  const targetCount = wantsMech(card, 'target') ? 1 : 0;
  for (let e = 0; e < card.empties + targetCount; e++) {
    cols.push([]);
    if (targets.length < targetCount) {
      targets.push({ col: cols.length - 1, color: (rng() * colors) | 0 });
    }
  }

  // chains
  let chains: number[] = [];
  if (wantsMech(card, 'chainN')) chains.push(-1);
  if (wantsMech(card, 'chainC')) chains.push((rng() * colors) | 0);
  if (card.stage === 'master' && chains.length === 1 && chains[0] === -1 && rng() < 0.4) {
    chains = [-1, -1];
  }

  // no column may start completed
  const startCompleted = cols.some((col) => {
    if (col.length !== cap) return false;
    const first = col[0];
    if (first < 0) return false;
    return col.every((c) => c === first);
  });
  if (startCompleted) return null;

  return { cols, taped, targets, chains, locked: locks > 0, locks };
}

/* ---------------- necessity gates (ablation in the accept loop) ---------------- */

function stateOf(
  b: BuildOut,
  cap: number,
  opts: { dropExtra?: boolean; dropTargetCol?: number; tapeOff?: boolean } = {},
): SolverState {
  let cols = b.cols.map((c) => c.slice());
  let targets = new Map(b.targets.map((t) => [t.col, t.color]));
  if (opts.dropTargetCol !== undefined) {
    const dropped = opts.dropTargetCol;
    cols = cols.filter((_, i) => i !== dropped);
    targets = new Map(
      [...targets.entries()]
        .filter(([col]) => col !== dropped)
        .map(([col, color]) => [col > dropped ? col - 1 : col, color]),
    );
  }
  let locked = -1;
  let chainCol = -1;
  if (b.locked && !opts.dropExtra) {
    cols.push([]);
    locked = cols.length - 1;
  }
  if (b.chains.length > 0 && !opts.dropExtra) {
    cols.push([]);
    chainCol = cols.length - 1;
  }
  return {
    cols,
    cap,
    locked,
    locks: b.locks,
    chainCol,
    chains: b.chains.slice(),
    taped: new Set(opts.tapeOff ? [] : b.taped),
    targets,
  };
}

function necessityFromDelta(base: number, ablated: number): number {
  if (ablated <= 0) return 4;
  const delta = (ablated - base) / base;
  if (delta >= 0.2) return 3;
  if (delta >= 0.08) return 2;
  if (delta > 0) return 1;
  return 0;
}

/** Necessity of one mechanic on this layout (>= card.minNecessity to pass). */
function mechanicNecessity(m: Focus, b: BuildOut, cap: number, base: number): number {
  switch (m) {
    case 'key':
    case 'multilock':
    case 'chainN':
    case 'chainC': {
      // the extra column never opens: how much does the level tighten?
      const forever = solve(stateOf(b, cap, { dropExtra: true }), 30000);
      let nec = necessityFromDelta(base, forever);
      if (m === 'chainC' && nec >= 2) {
        // the color condition must not be decorative: the neutral variant
        // should change the route length at least a little (soft gate)
        const neutral = solve({ ...stateOf(b, cap), chains: b.chains.map(() => -1) }, 30000);
        if (neutral > 0 && Math.abs(neutral - base) === 0) nec = Math.min(nec, 2);
      }
      return nec;
    }
    case 'tape': {
      // constraint mechanic: removing the tape must make the level easier
      const normal = solve(stateOf(b, cap, { tapeOff: true }), 30000);
      if (normal <= 0) return 0;
      const delta = (base - normal) / normal;
      return delta >= 0.2 ? 3 : delta >= 0.08 ? 2 : delta > 0 ? 1 : 0;
    }
    case 'target': {
      // the specialized buffer must be needed: remove the column entirely
      const without = solve(stateOf(b, cap, { dropTargetCol: b.targets[0]?.col }), 30000);
      return necessityFromDelta(base, without);
    }
    default:
      return 0;
  }
}

/* ---------------- generation ---------------- */

export interface LevelMeta {
  card: SlotCard;
  optimal: number;
  necessity: Partial<Record<Focus, number>>;
  attempts: number;
  relaxed: boolean;
}

/** Guaranteed-solvable trivial layout (emergency fallback): a cyclic
 * shift — every column holds cap-1 of its color plus one neighbor block,
 * so no column starts completed and the fix is one obvious move each. */
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

  // relaxation ladder: strict card -> +1 empty -> drop the second mechanic
  const ladder: { card: SlotCard; relaxed: boolean }[] = [
    { card: baseCard, relaxed: false },
    { card: { ...baseCard, empties: Math.min(3, baseCard.empties + 1) as 1 | 2 | 3 }, relaxed: true },
    {
      card: { ...baseCard, second: 'none', empties: Math.min(3, baseCard.empties + 1) as 1 | 2 | 3 },
      relaxed: true,
    },
    {
      card: {
        ...baseCard,
        focus: baseCard.focus === 'multilock' ? 'key' : baseCard.focus,
        second: 'none',
        empties: Math.min(3, baseCard.empties + 1) as 1 | 2 | 3,
      },
      relaxed: true,
    },
  ];

  let attempts = 0;
  for (const { card, relaxed } of ladder) {
    for (let a = 0; a < 60; a++) {
      attempts++;
      const rng = mulberry32(index * 7919 + attempts * 104729 + 29);
      const built = buildLayout(card, rng);
      if (!built) continue;

      const base = solveBest(stateOf(built, card.cap), 2, card.empties === 1 ? 140000 : 60000);
      if (base <= 0) continue;

      const necessity: Partial<Record<Focus, number>> = {};
      let pass = true;
      for (const m of [card.focus, card.second]) {
        if (m === 'none') continue;
        const need = m === card.focus ? card.minNecessity : Math.min(card.minNecessity, 2);
        const n = mechanicNecessity(m, built, card.cap, base);
        necessity[m] = n;
        if (n < need) {
          pass = false;
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
        lockedColumn: built.locked,
        lockedColumnLocks: built.locks > 1 ? built.locks : undefined,
        chains: built.chains.length > 0 ? built.chains : undefined,
        targetColumns: built.targets.length > 0 ? built.targets : undefined,
        tapedColumns: built.taped.length > 0 ? built.taped : undefined,
      };
      return { config, meta: { card, optimal: base, necessity, attempts, relaxed } };
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
    meta: { card: baseCard, optimal: 6, necessity: {}, attempts, relaxed: true },
  };
}

export function generateSortingLevel(index: number): SortingLevelConfig {
  return generateSortingLevelWithMeta(index).config;
}
