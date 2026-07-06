import { SPECIAL } from './SortingTypes';
import type { ColorId, SortingLevelConfig } from './SortingTypes';
import { solveBest } from './SortingSolver';

/**
 * Level generator: deterministic per index, every layout is verified by the
 * solver (see SortingSolver.ts), `par` is calibrated from a refined solution.
 *
 * The difficulty curve is the declarative CURVE table below: each phase is a
 * contiguous range of levels with a note explaining its intent. Ranges are
 * written in 1-based level numbers to match the design docs; lookups convert
 * from the 0-based index.
 *
 * Invariant of the whole game (never violated by generated levels): every
 * color has exactly `cap` copies and every column shares one capacity, so a
 * collected set never orphans blocks and the player never has to guess.
 */

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

/* ---------------- level spec ---------------- */

interface LevelSpec {
  colors: number;
  cap: number;
  /** Ink blots: dead bottom slots in one dedicated column (0 = none). */
  ink: number;
  /** Locked column present. */
  locked: boolean;
  /** Keys needed to open it (1..2); with keyInPile they come from the pile. */
  locks: number;
  /** Key blocks buried in the pile (otherwise the lock is booster-only). */
  keyInPile: boolean;
  /** Empty columns that require a designated first color (0..2). */
  targets: number;
  /** Chains on the extra chained column: -1 neutral, >=0 color-bound. */
  chains: number[];
  /** Taped (take-only) columns. */
  taped: number;
  hidden: boolean;
}

function baseSpec(): LevelSpec {
  return {
    colors: 6,
    cap: 4,
    ink: 0,
    locked: false,
    locks: 1,
    keyInPile: false,
    targets: 0,
    chains: [],
    taped: 0,
    hidden: true,
  };
}

/* ---------------- difficulty curve ---------------- */

type Pick = <T>(arr: T[]) => T;

interface Phase {
  /** 1-based inclusive level range. */
  from: number;
  to: number;
  /** Design intent, kept next to the numbers it explains. */
  note: string;
  build: (spec: LevelSpec, level: number, rng: () => number, pick: Pick) => void;
}

/**
 * Levels 1-10 are curated (JSON): basics, hidden blocks from 4, the
 * booster-only lock from 7. Everything from 11 is generated per this table.
 *
 * Shape of the curve: one new mechanic per intro phase (so its tutorial
 * fires on a clean level), then rotation in three pressure tiers with a
 * breather before every new decade (level % 10 === 0).
 */
const CURVE: Phase[] = [
  {
    from: 11,
    to: 15,
    note: 'base ramp: more colors, denser boards, no new mechanics',
    build: (s, _level, rng, pick) => {
      s.colors = rng() < 0.4 ? 6 : 7;
      s.cap = pick([3, 4]);
      s.locked = rng() < 0.4; // the booster lock is known from 7-10
    },
  },
  {
    from: 16,
    to: 20,
    note: 'INK intro: one dead slot shrinks the working space',
    build: (s, _level, _rng, pick) => {
      s.colors = pick([6, 7]);
      s.ink = 1;
    },
  },
  {
    from: 21,
    to: 25,
    note: 'KEY BLOCK intro: dig the key out to open the lock',
    build: (s, _level, _rng, pick) => {
      s.colors = pick([6, 7]);
      s.locked = true;
      s.keyInPile = true;
    },
  },
  {
    from: 26,
    to: 30,
    note: 'ink + key combos ramping',
    build: (s, _level, rng, pick) => {
      s.colors = 7;
      s.ink = pick([1, 2]);
      s.locked = rng() < 0.6;
      s.keyInPile = s.locked;
    },
  },
  {
    from: 31,
    to: 35,
    note: 'TAPE intro: a take-only column until it empties',
    build: (s, _level, _rng, pick) => {
      s.colors = pick([6, 7]);
      s.taped = 1;
      s.ink = pick([0, 1]);
    },
  },
  {
    from: 36,
    to: 40,
    note: 'TARGET COLUMN intro: one empty accepts only its chalk color',
    build: (s, _level, _rng, pick) => {
      s.colors = pick([6, 7]);
      s.targets = 1;
    },
  },
  {
    from: 41,
    to: 45,
    note: 'CHAINS intro: neutral chain first, a colored one from 44',
    build: (s, level, rng, pick) => {
      s.colors = pick([6, 7]);
      s.chains = level <= 43 ? [-1] : [(rng() * s.colors) | 0];
    },
  },
  {
    from: 46,
    to: 50,
    note: 'DOUBLE LOCK intro: two keys buried in the pile',
    build: (s, _level, _rng, pick) => {
      s.colors = pick([6, 7]);
      s.locked = true;
      s.keyInPile = true;
      s.locks = 2;
    },
  },
  {
    from: 51,
    to: 80,
    note: 'tier 1 rotation: one anchor mechanic per level, light seasoning',
    build: (s, level, rng, pick) => {
      s.colors = pick([6, 6, 7]);
      s.cap = pick([3, 4, 4]);
      applyAnchor(s, anchorFor(level), rng, pick, false);
      // light seasoning: sometimes one extra soft constraint
      if (rng() < 0.3) seasonLight(s, rng, pick);
    },
  },
  {
    from: 81,
    to: 110,
    note: 'tier 2 rotation: pairs of mechanics, 7 colors dominant',
    build: (s, level, rng, pick) => {
      s.colors = pick([6, 7, 7]);
      s.cap = pick([3, 4, 4]);
      applyAnchor(s, anchorFor(level), rng, pick, false);
      if (rng() < 0.5) seasonLight(s, rng, pick);
    },
  },
  {
    from: 111,
    to: 150,
    note: 'tier 3 rotation: dense combos — 2 targets / 2 chains / double locks',
    build: (s, level, rng, pick) => {
      s.colors = 7;
      s.cap = 4;
      applyAnchor(s, anchorFor(level), rng, pick, true);
      if (rng() < 0.8) seasonLight(s, rng, pick);
    },
  },
];

const ANCHORS = ['ink', 'key', 'tape', 'target', 'chains', 'lock2'] as const;
type Anchor = (typeof ANCHORS)[number];

/**
 * Balanced anchor per level: every decade gets its own seeded permutation of
 * the six anchors, walked by position — so each mechanic is guaranteed to
 * appear in every rotation decade (no random droughts or floods).
 */
function anchorFor(level: number): Anchor {
  const decade = Math.floor((level - 1) / 10);
  const rng = mulberry32(decade * 65537 + 7);
  const order = shuffle([...ANCHORS], rng);
  return order[(level - 1) % 10 % ANCHORS.length];
}

/** The anchor mechanic of a rotation level; `heavy` unlocks the x2 variants. */
function applyAnchor(
  s: LevelSpec,
  anchor: 'ink' | 'key' | 'tape' | 'target' | 'chains' | 'lock2',
  rng: () => number,
  pick: Pick,
  heavy: boolean,
): void {
  switch (anchor) {
    case 'ink':
      s.ink = heavy ? pick([1, 2]) : 1;
      break;
    case 'key':
      s.locked = true;
      s.keyInPile = true;
      break;
    case 'lock2':
      s.locked = true;
      s.keyInPile = true;
      s.locks = 2;
      break;
    case 'tape':
      s.taped = 1;
      break;
    case 'target':
      s.targets = heavy && rng() < 0.4 ? 2 : 1;
      break;
    case 'chains': {
      const colored = (): number => (rng() * s.colors) | 0;
      s.chains = heavy
        ? rng() < 0.5
          ? [colored(), -1]
          : [colored()]
        : rng() < 0.4
          ? [colored()]
          : [-1];
      break;
    }
  }
}

/** A soft extra constraint on top of the anchor (never a second heavy one).
 * Weighted: ink and tape are the usual spice; the booster-only lock is rare
 * so it never over-taxes the limited key wallet. */
function seasonLight(s: LevelSpec, rng: () => number, pick: Pick): void {
  const options: (() => void)[] = [];
  if (s.ink === 0) options.push(() => (s.ink = 1));
  if (s.taped === 0) options.push(() => (s.taped = 1));
  if (!s.locked && rng() < 0.25) options.push(() => (s.locked = true)); // booster-only lock, rare
  if (options.length > 0) pick(options)();
}

function specFor(index: number, rng: () => number): LevelSpec {
  const pick: Pick = (arr) => arr[(rng() * arr.length) | 0];
  const level = index + 1; // 1-based, as in the CURVE table
  const spec = baseSpec();

  const phase = CURVE.find((p) => level >= p.from && level <= p.to) ?? CURVE[CURVE.length - 1];
  phase.build(spec, level, rng, pick);

  // breather before every new decade: strip the extras, shrink the board
  if (level % 10 === 0 && level > 15) {
    spec.colors = Math.max(5, spec.colors - 1);
    spec.ink = 0;
    spec.taped = 0;
    spec.targets = 0;
    spec.chains = [];
    spec.locks = 1;
  }

  // consistency guards
  spec.ink = Math.min(spec.ink, spec.cap - 1);
  if (!spec.locked) {
    spec.locks = 1;
    spec.keyInPile = false;
  }
  // board width: colors + key slack + ink col + empties + locked col +
  // chained col <= 11 (see emptyCountFor for the empties rule)
  const width = () =>
    spec.colors +
    (spec.keyInPile ? 1 : 0) +
    (spec.ink > 0 ? 1 : 0) +
    emptyCountFor(spec) +
    (spec.locked ? 1 : 0) +
    (spec.chains.length > 0 ? 1 : 0);
  while (width() > 11) spec.colors -= 1;
  return spec;
}

/* ---------------- generation ---------------- */

function emptyCountFor(spec: LevelSpec): number {
  return 2 + (spec.targets >= 2 ? 1 : 0);
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

export function generateSortingLevel(index: number): SortingLevelConfig {
  const id = `level_${String(index + 1).padStart(3, '0')}`;

  for (let attempt = 0; attempt < 60; attempt++) {
    const rng = mulberry32(index * 7919 + attempt * 104729 + 13);
    const spec = specFor(index, rng);

    // every color has exactly `cap` copies — the core arithmetic invariant
    const pool: ColorId[] = [];
    for (let c = 0; c < spec.colors; c++) {
      for (let k = 0; k < spec.cap; k++) pool.push(c);
    }
    if (spec.locked && spec.keyInPile) {
      for (let k = 0; k < spec.locks; k++) pool.push(SPECIAL.KEY);
    }
    shuffle(pool, rng);

    // ink column: dead bottom slots + a couple of color blocks parked on top
    const inkCol: ColorId[] = [];
    if (spec.ink > 0) {
      for (let s = 0; s < spec.ink; s++) inkCol.push(SPECIAL.INK);
      const park = Math.min(2, spec.cap - spec.ink, pool.length);
      for (let s = 0; s < park; s++) inkCol.push(pool.pop() as ColorId);
    }

    // start layout: `colors` full columns (+ slack column when keys are pooled)
    const filled = spec.colors + (spec.locked && spec.keyInPile ? 1 : 0);
    const cols: ColorId[][] = [];
    let p = 0;
    for (let i = 0; i < filled; i++) {
      const take = Math.min(spec.cap, pool.length - p);
      cols.push(pool.slice(p, p + take));
      p += take;
    }
    if (p < pool.length) continue; // did not fit; reshuffle
    if (spec.ink > 0) cols.push(inkCol);

    // Empties rule: an openable extra column (key lock / chains) replaces
    // one universal empty — its space must be genuinely needed, not a bonus.
    const emptyCount = emptyCountFor(spec);
    const targetCols: { col: number; color: number }[] = [];
    for (let e = 0; e < emptyCount; e++) {
      cols.push([]);
      if (targetCols.length < spec.targets) {
        targetCols.push({ col: cols.length - 1, color: (rng() * spec.colors) | 0 });
      }
    }
    if (targetCols.length === 2 && targetCols[0].color === targetCols[1].color) {
      targetCols[1].color = (targetCols[1].color + 1) % spec.colors;
    }

    // no column may start completed
    if (cols.some((c) => isStartCompleted(c, spec.cap))) continue;
    // a key must not start on top of a pile (it would fire instantly)
    if (spec.keyInPile && cols.some((c) => c[c.length - 1] === SPECIAL.KEY)) continue;

    const taped: number[] = [];
    if (spec.taped > 0) {
      const ti = (rng() * spec.colors) | 0; // only plain color columns
      if (cols[ti].length > 1 && !cols[ti].includes(SPECIAL.INK)) taped.push(ti);
    }

    const solveCols = cols.map((c) => c.slice());
    let lockedIdx = -1;
    let chainIdx = -1;
    if (spec.locked) {
      solveCols.push([]);
      lockedIdx = solveCols.length - 1;
    }
    if (spec.chains.length > 0) {
      solveCols.push([]);
      chainIdx = solveCols.length - 1;
    }
    const targetsMap = new Map(targetCols.map((t) => [t.col, t.color]));
    const solution = solveBest({
      cols: solveCols,
      cap: spec.cap,
      locked: lockedIdx,
      locks: spec.locks,
      chainCol: chainIdx,
      chains: spec.chains.slice(),
      taped: new Set(taped),
      targets: targetsMap,
    });
    if (solution > 0) {
      return {
        id,
        cap: spec.cap,
        par: Math.max(spec.colors + 1, Math.round(solution * 1.15)),
        difficulty: index + 1,
        columns: cols,
        hiddenBelowTop: spec.hidden,
        lockedColumn: spec.locked,
        lockedColumnLocks: spec.locked && spec.locks > 1 ? spec.locks : undefined,
        chains: spec.chains.length > 0 ? spec.chains : undefined,
        targetColumns: targetCols.length ? targetCols : undefined,
        tapedColumns: taped.length ? taped : undefined,
      };
    }
  }

  return {
    id,
    cap: 4,
    par: 8,
    difficulty: index + 1,
    columns: fallbackColumns(6, 4),
    hiddenBelowTop: false,
    lockedColumn: false,
  };
}

/** A column that would clear on the very first frame is a broken start. */
function isStartCompleted(col: ColorId[], cap: number): boolean {
  if (col.length !== cap || cap === 0) return false;
  const first = col[0];
  if (first === SPECIAL.INK || first === SPECIAL.KEY) return false;
  return col.every((c) => c === first);
}
