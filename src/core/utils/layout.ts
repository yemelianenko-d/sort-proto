/** Pure layout math for placing N columns of blocks inside an available area. */

export interface ColumnLayout {
  /** Block size in px. */
  cell: number;
  /** Outer width/height of one column frame. */
  colWidth: number;
  colHeight: number;
  /** Per-column frame heights (mixed capacities); bottom-aligned in a row. */
  colHeights: number[];
  /** Top-left position of every column frame. */
  positions: { x: number; y: number }[];
  rows: number;
}

export interface LayoutParams {
  columnCount: number;
  cap: number; // default blocks per column
  caps?: number[]; // per-column capacities (mixed heights)
  availWidth: number;
  availHeight: number;
  gapX?: number;
  gapY?: number;
  padding?: number; // inner padding of a column frame
  minCell?: number;
  maxCell?: number;
}

/**
 * Splits columns into 1–3 rows and picks the biggest cell size that fits.
 * Deterministic and framework-agnostic so it is easy to unit-test.
 */
export function computeColumnLayout(p: LayoutParams): ColumnLayout {
  const gapX = p.gapX ?? 14;
  const gapY = p.gapY ?? 26;
  const pad = p.padding ?? 8;
  const minCell = p.minCell ?? 30;
  const maxCell = p.maxCell ?? 64;
  const blockGap = 5;
  const capOf = (i: number) => p.caps?.[i] ?? p.cap;
  const capMax = p.caps && p.caps.length > 0 ? Math.max(...p.caps) : p.cap;

  let best: ColumnLayout | null = null;

  for (let rows = 1; rows <= 3; rows++) {
    const perRow = Math.ceil(p.columnCount / rows);
    // cell from width constraint
    const cellW = (p.availWidth - gapX * (perRow - 1)) / perRow - pad * 2;
    // cell from height constraint
    const colInnerH = (p.availHeight - gapY * (rows - 1)) / rows - pad * 2;
    const cellH = (colInnerH - blockGap * (capMax - 1)) / capMax;
    const cell = Math.min(maxCell, Math.floor(Math.min(cellW, cellH)));
    if (cell < minCell && best) continue;

    const colWidth = cell + pad * 2;
    const colHeight = cell * capMax + blockGap * (capMax - 1) + pad * 2;
    const colHeights: number[] = [];
    for (let i = 0; i < p.columnCount; i++) {
      colHeights.push(cell * capOf(i) + blockGap * (capOf(i) - 1) + pad * 2);
    }
    const positions: { x: number; y: number }[] = [];
    for (let i = 0; i < p.columnCount; i++) {
      const row = Math.floor(i / perRow);
      const inRow = row === rows - 1 ? p.columnCount - perRow * (rows - 1) : perRow;
      const col = i - row * perRow;
      const rowWidth = inRow * colWidth + (inRow - 1) * gapX;
      const startX = (p.availWidth - rowWidth) / 2;
      const totalH = rows * colHeight + (rows - 1) * gapY;
      const startY = (p.availHeight - totalH) / 2;
      positions.push({
        x: startX + col * (colWidth + gapX),
        // shorter columns sit on the same baseline as tall ones
        y: startY + row * (colHeight + gapY) + (colHeight - colHeights[i]),
      });
    }
    const candidate: ColumnLayout = { cell, colWidth, colHeight, colHeights, positions, rows };
    if (!best || candidate.cell > best.cell) best = candidate;
  }

  // best is always set: rows=1 branch runs unconditionally on first pass
  return best as ColumnLayout;
}

export const BLOCK_GAP = 5;
