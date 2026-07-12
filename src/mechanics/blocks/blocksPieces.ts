/**
 * Shape Catalog v3 (Balance Spec §3). Orientation is a separate shape ID — the
 * player never rotates. 39 orientation-specific shapes with balance metadata so
 * the roster/weights/generator can reason about tier, family and spatial demand
 * instead of treating every shape as "just another piece".
 *
 * There is NO rotation at play time. Shapes are declared as string rows
 * ('1' = cell) for readability and normalized once into offsets. v4 adds the
 * S/Z skew tetrominoes (a core Block-Blast variety source) and promotes the
 * L-tetrominoes to a common tier — the reference deals corners/skews/Ts as
 * often as bars, so they must not sit in a rare tier.
 */

export type ShapeFamily =
  | 'SINGLE'
  | 'LINES_H'
  | 'LINES_V'
  | 'DIAGONAL'
  | 'RECT'
  | 'L_SMALL'
  | 'L_EXT'
  | 'L_LARGE'
  | 'T'
  | 'SKEW';

export type ShapeTier = 'FLEXIBLE' | 'NORMAL' | 'DEMANDING' | 'KILLER';

export interface ShapeDemands {
  channelH: number; // 0..1 needs a long horizontal channel
  channelV: number; // 0..1 needs a long vertical channel
  diagAsc: number; // 0..1 needs an ascending "/" diagonal slot
  diagDesc: number; // 0..1 needs a descending "\" diagonal slot
  largeZone: number; // 0..1 needs a large clean rectangle
  corner: number; // 0..1 needs a concave corner / pocket
}

export interface PieceGeometry {
  id: string;
  family: ShapeFamily;
  tier: ShapeTier;
  rows: number;
  cols: number;
  area: number;
  /** area / (rows * cols) — how "sparse" the shape is inside its bbox. */
  bboxDensity: number;
  /** Manual starting rating 1..10; calibrated later by the simulator. */
  difficultyScore: number;
  /** 0..1 — how easily the shape drops anywhere (recovery value). */
  flexibility: number;
  demands: ShapeDemands;
  /** Occupied cells as offsets from the piece's top-left corner. */
  cells: { r: number; c: number }[];
}

const NO_DEMAND: ShapeDemands = {
  channelH: 0,
  channelV: 0,
  diagAsc: 0,
  diagDesc: 0,
  largeZone: 0,
  corner: 0,
};

interface RawShape {
  id: string;
  family: ShapeFamily;
  tier: ShapeTier;
  rows: string[];
  difficulty: number;
  flexibility: number;
  demands?: Partial<ShapeDemands>;
}

/** Declarative catalog — one entry per orientation-specific shape id. */
const RAW: RawShape[] = [
  // --- SINGLE ---
  { id: 'S1', family: 'SINGLE', tier: 'FLEXIBLE', rows: ['1'], difficulty: 1, flexibility: 1 },

  // --- horizontal lines ---
  { id: 'H2', family: 'LINES_H', tier: 'FLEXIBLE', rows: ['11'], difficulty: 2, flexibility: 0.85, demands: { channelH: 0.3 } },
  { id: 'H3', family: 'LINES_H', tier: 'FLEXIBLE', rows: ['111'], difficulty: 2.5, flexibility: 0.72, demands: { channelH: 0.5 } },
  { id: 'H4', family: 'LINES_H', tier: 'NORMAL', rows: ['1111'], difficulty: 4, flexibility: 0.55, demands: { channelH: 0.78 } },
  { id: 'H5', family: 'LINES_H', tier: 'DEMANDING', rows: ['11111'], difficulty: 6, flexibility: 0.35, demands: { channelH: 1 } },

  // --- vertical lines ---
  { id: 'V2', family: 'LINES_V', tier: 'FLEXIBLE', rows: ['1', '1'], difficulty: 2, flexibility: 0.85, demands: { channelV: 0.3 } },
  { id: 'V3', family: 'LINES_V', tier: 'FLEXIBLE', rows: ['1', '1', '1'], difficulty: 2.5, flexibility: 0.72, demands: { channelV: 0.5 } },
  { id: 'V4', family: 'LINES_V', tier: 'NORMAL', rows: ['1', '1', '1', '1'], difficulty: 4, flexibility: 0.55, demands: { channelV: 0.78 } },
  { id: 'V5', family: 'LINES_V', tier: 'DEMANDING', rows: ['1', '1', '1', '1', '1'], difficulty: 6, flexibility: 0.35, demands: { channelV: 1 } },

  // --- diagonals (cells touch at corners; ASC = "/", DESC = "\") ---
  { id: 'D2_ASC', family: 'DIAGONAL', tier: 'FLEXIBLE', rows: ['01', '10'], difficulty: 3, flexibility: 0.6, demands: { diagAsc: 0.5 } },
  { id: 'D2_DESC', family: 'DIAGONAL', tier: 'FLEXIBLE', rows: ['10', '01'], difficulty: 3, flexibility: 0.6, demands: { diagDesc: 0.5 } },
  { id: 'D3_ASC', family: 'DIAGONAL', tier: 'NORMAL', rows: ['001', '010', '100'], difficulty: 4.5, flexibility: 0.42, demands: { diagAsc: 0.8 } },
  { id: 'D3_DESC', family: 'DIAGONAL', tier: 'NORMAL', rows: ['100', '010', '001'], difficulty: 4.5, flexibility: 0.42, demands: { diagDesc: 0.8 } },
  { id: 'D4_ASC', family: 'DIAGONAL', tier: 'DEMANDING', rows: ['0001', '0010', '0100', '1000'], difficulty: 6.5, flexibility: 0.3, demands: { diagAsc: 1 } },
  { id: 'D4_DESC', family: 'DIAGONAL', tier: 'DEMANDING', rows: ['1000', '0100', '0010', '0001'], difficulty: 6.5, flexibility: 0.3, demands: { diagDesc: 1 } },

  // --- rectangles ---
  { id: 'R2x2', family: 'RECT', tier: 'FLEXIBLE', rows: ['11', '11'], difficulty: 3, flexibility: 0.6 },
  { id: 'R2x3', family: 'RECT', tier: 'NORMAL', rows: ['111', '111'], difficulty: 4.5, flexibility: 0.4, demands: { largeZone: 0.5 } },
  { id: 'R3x2', family: 'RECT', tier: 'NORMAL', rows: ['11', '11', '11'], difficulty: 4.5, flexibility: 0.4, demands: { largeZone: 0.5 } },
  { id: 'R3x3', family: 'RECT', tier: 'DEMANDING', rows: ['111', '111', '111'], difficulty: 7, flexibility: 0.2, demands: { largeZone: 1 } },

  // --- small corners (2x2, 3 cells) ---
  { id: 'L2x2_NW', family: 'L_SMALL', tier: 'FLEXIBLE', rows: ['11', '10'], difficulty: 3, flexibility: 0.65, demands: { corner: 0.4 } },
  { id: 'L2x2_NE', family: 'L_SMALL', tier: 'FLEXIBLE', rows: ['11', '01'], difficulty: 3, flexibility: 0.65, demands: { corner: 0.4 } },
  { id: 'L2x2_SW', family: 'L_SMALL', tier: 'FLEXIBLE', rows: ['10', '11'], difficulty: 3, flexibility: 0.65, demands: { corner: 0.4 } },
  { id: 'L2x2_SE', family: 'L_SMALL', tier: 'FLEXIBLE', rows: ['01', '11'], difficulty: 3, flexibility: 0.65, demands: { corner: 0.4 } },

  // --- L / J tetrominoes (2x3 / 3x2, 4 cells) — standard, common (like BB) ---
  { id: 'L2x3_NW', family: 'L_EXT', tier: 'NORMAL', rows: ['111', '100'], difficulty: 4.5, flexibility: 0.5, demands: { corner: 0.55, channelH: 0.35 } },
  { id: 'L2x3_NE', family: 'L_EXT', tier: 'NORMAL', rows: ['111', '001'], difficulty: 4.5, flexibility: 0.5, demands: { corner: 0.55, channelH: 0.35 } },
  { id: 'L2x3_SW', family: 'L_EXT', tier: 'NORMAL', rows: ['100', '111'], difficulty: 4.5, flexibility: 0.5, demands: { corner: 0.55, channelH: 0.35 } },
  { id: 'L2x3_SE', family: 'L_EXT', tier: 'NORMAL', rows: ['001', '111'], difficulty: 4.5, flexibility: 0.5, demands: { corner: 0.55, channelH: 0.35 } },
  { id: 'L3x2_NW', family: 'L_EXT', tier: 'NORMAL', rows: ['11', '10', '10'], difficulty: 4.5, flexibility: 0.5, demands: { corner: 0.55, channelV: 0.35 } },
  { id: 'L3x2_NE', family: 'L_EXT', tier: 'NORMAL', rows: ['11', '01', '01'], difficulty: 4.5, flexibility: 0.5, demands: { corner: 0.55, channelV: 0.35 } },
  { id: 'L3x2_SW', family: 'L_EXT', tier: 'NORMAL', rows: ['10', '10', '11'], difficulty: 4.5, flexibility: 0.5, demands: { corner: 0.55, channelV: 0.35 } },
  { id: 'L3x2_SE', family: 'L_EXT', tier: 'NORMAL', rows: ['01', '01', '11'], difficulty: 4.5, flexibility: 0.5, demands: { corner: 0.55, channelV: 0.35 } },

  // --- S / Z skew tetrominoes (4 cells) — core BB variety, common ---
  { id: 'SZ_S_H', family: 'SKEW', tier: 'NORMAL', rows: ['011', '110'], difficulty: 5, flexibility: 0.42, demands: { corner: 0.5, diagAsc: 0.3 } },
  { id: 'SZ_Z_H', family: 'SKEW', tier: 'NORMAL', rows: ['110', '011'], difficulty: 5, flexibility: 0.42, demands: { corner: 0.5, diagDesc: 0.3 } },
  { id: 'SZ_S_V', family: 'SKEW', tier: 'NORMAL', rows: ['10', '11', '01'], difficulty: 5, flexibility: 0.42, demands: { corner: 0.5, diagDesc: 0.3 } },
  { id: 'SZ_Z_V', family: 'SKEW', tier: 'NORMAL', rows: ['01', '11', '10'], difficulty: 5, flexibility: 0.42, demands: { corner: 0.5, diagAsc: 0.3 } },

  // --- large corners (3x3, 5 cells) ---
  { id: 'L3x3_SW', family: 'L_LARGE', tier: 'KILLER', rows: ['100', '100', '111'], difficulty: 8, flexibility: 0.15, demands: { corner: 0.8, largeZone: 0.7 } },
  { id: 'L3x3_SE', family: 'L_LARGE', tier: 'KILLER', rows: ['001', '001', '111'], difficulty: 8, flexibility: 0.15, demands: { corner: 0.8, largeZone: 0.7 } },
  { id: 'L3x3_NW', family: 'L_LARGE', tier: 'KILLER', rows: ['111', '100', '100'], difficulty: 8, flexibility: 0.15, demands: { corner: 0.8, largeZone: 0.7 } },
  { id: 'L3x3_NE', family: 'L_LARGE', tier: 'KILLER', rows: ['111', '001', '001'], difficulty: 8, flexibility: 0.15, demands: { corner: 0.8, largeZone: 0.7 } },

  // --- T-shapes (4 cells) ---
  { id: 'T4_DOWN', family: 'T', tier: 'NORMAL', rows: ['111', '010'], difficulty: 5, flexibility: 0.4, demands: { corner: 0.5 } },
  { id: 'T4_UP', family: 'T', tier: 'NORMAL', rows: ['010', '111'], difficulty: 5, flexibility: 0.4, demands: { corner: 0.5 } },
  { id: 'T4_RIGHT', family: 'T', tier: 'NORMAL', rows: ['10', '11', '10'], difficulty: 5, flexibility: 0.4, demands: { corner: 0.5 } },
  { id: 'T4_LEFT', family: 'T', tier: 'NORMAL', rows: ['01', '11', '01'], difficulty: 5, flexibility: 0.4, demands: { corner: 0.5 } },
];

function normalize(raw: RawShape): PieceGeometry {
  const cells: { r: number; c: number }[] = [];
  raw.rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] === '1') cells.push({ r, c });
  });
  const rows = raw.rows.length;
  const cols = Math.max(...raw.rows.map((r) => r.length));
  const area = cells.length;
  return {
    id: raw.id,
    family: raw.family,
    tier: raw.tier,
    rows,
    cols,
    area,
    bboxDensity: area / (rows * cols),
    difficultyScore: raw.difficulty,
    flexibility: raw.flexibility,
    demands: { ...NO_DEMAND, ...raw.demands },
    cells,
  };
}

export const PIECE_SHAPES: Readonly<Record<string, PieceGeometry>> = Object.fromEntries(
  RAW.map((raw) => [raw.id, normalize(raw)]),
);

/** All shape ids of a given tier (for roster/weights authoring & the generator). */
export const SHAPE_IDS_BY_TIER: Readonly<Record<ShapeTier, string[]>> = (() => {
  const by: Record<ShapeTier, string[]> = { FLEXIBLE: [], NORMAL: [], DEMANDING: [], KILLER: [] };
  for (const s of Object.values(PIECE_SHAPES)) by[s.tier].push(s.id);
  return by;
})();

export function isPieceShape(id: string): boolean {
  return id in PIECE_SHAPES;
}
