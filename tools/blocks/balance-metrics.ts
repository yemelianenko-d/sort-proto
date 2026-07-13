/**
 * Balance metrics for the three requested feel-changes (developer feedback):
 *   #1 "rescue piece" feeling — how often a SINGLE tray piece can clear a line
 *      right now (high = the game always hands you an escape). Want LOWER.
 *   #2 big clears + board wipes — share of clears that remove 3+ lines, and
 *      how many full-board clears happen. Want HIGHER / > 0.
 *   #3 big pieces — average cells per drawn piece and the share of pieces with
 *      5+ cells (H5/V5/R2x3/R3x2/R3x3/L3x3). Want HIGHER.
 *
 * Plays the whole campaign with the CASUAL autoplayer (same heuristic as
 * calibrate.ts) across many seeds and aggregates. Run:
 *   npx tsx tools/blocks/balance-metrics.ts [REVIVES=5]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BlocksModel } from '../../src/mechanics/blocks/BlocksModel';
import { PIECE_SHAPES } from '../../src/mechanics/blocks/blocksPieces';
import { mulberry32 } from '../../src/mechanics/blocks/blocksRandom';
import { parseBlocksLevels } from '../../src/mechanics/blocks/BlocksLevelParser';

const levels = parseBlocksLevels(JSON.parse(readFileSync(resolve('public/levels/blocks_levels.json'), 'utf8')));
const R = 8, C = 8;
const REVIVES = Number(process.env.REVIVES ?? 5);

/** Does placing this geometry at (r0,c0) on `occ` clear at least one line? */
function placementClears(occ: boolean[][], geo: { rows: number; cols: number; cells: { r: number; c: number }[] }, r0: number, c0: number): number {
  const g = occ.map((row) => row.slice());
  for (const { r, c } of geo.cells) g[r0 + r][c0 + c] = true;
  let lines = 0;
  for (let r = 0; r < R; r++) if (g[r].every(Boolean)) lines++;
  for (let c = 0; c < C; c++) if (g.every((row) => row[c])) lines++;
  return lines;
}

/** CASUAL placement heuristic (matches calibrate.ts). */
function evalPlacement(occ: boolean[][], geo: { cells: { r: number; c: number }[] }, r0: number, c0: number): { q: number; clr: number } {
  const g = occ.map((row) => row.slice());
  for (const { r, c } of geo.cells) g[r0 + r][c0 + c] = true;
  const fullRows: number[] = [], fullCols: number[] = [];
  for (let r = 0; r < R; r++) if (g[r].every(Boolean)) fullRows.push(r);
  for (let c = 0; c < C; c++) if (g.every((row) => row[c])) fullCols.push(c);
  const clr = fullRows.length + fullCols.length;
  for (const r of fullRows) for (let c = 0; c < C; c++) g[r][c] = false;
  for (const c of fullCols) for (let r = 0; r < R; r++) g[r][c] = false;
  let filled = 0, holes = 0;
  const heights = new Array(C).fill(0);
  for (let c = 0; c < C; c++) {
    let seen = false;
    for (let r = 0; r < R; r++) {
      if (g[r][c]) { if (!seen) { seen = true; heights[c] = R - r; } filled++; }
      else if (seen) holes++;
    }
  }
  let bump = 0;
  for (let c = 0; c < C - 1; c++) bump += Math.abs(heights[c] - heights[c + 1]);
  return { q: clr * 60 - holes * 4 - heights.reduce((a, b) => a + b, 0) * 1.2 - bump * 0.6 - filled * 0.3, clr };
}

interface Acc {
  turns: number; rescueTurns: number; multiOppTurns: number; oppSum: number; // #1/#2 opportunity
  clears: number; clears3plus: number; boardWipes: number; // #2 realised
  pieces: number; bigPieces: number; cellSum: number; // #3
}
const acc: Acc = { turns: 0, rescueTurns: 0, multiOppTurns: 0, oppSum: 0, clears: 0, clears3plus: 0, boardWipes: 0, pieces: 0, bigPieces: 0, cellSum: 0 };

function tallyTray(m: BlocksModel): void {
  for (const p of m.tray) {
    if (!p) continue;
    const n = PIECE_SHAPES[p.shape].cells.length;
    acc.pieces += 1; acc.cellSum += n; if (n >= 5) acc.bigPieces += 1;
  }
}

function play(levelIndex: number, seed: number): void {
  const rng = mulberry32(seed);
  const m = new BlocksModel(levels[levelIndex], mulberry32(seed ^ 0x9e3779b9));
  let revives = REVIVES;
  let seenTray = -1;
  for (let move = 0; move < 600; move++) {
    if (m.isWon()) break;
    if (m.isFailed()) { if (revives-- <= 0) break; m.revive(); seenTray = -1; continue; }
    // count each freshly dealt tray once for the big-piece metric
    if (m.moves !== seenTray) { tallyTray(m); seenTray = m.moves; }

    const occ = m.grid.map((row) => row.map((c) => c !== null));
    // #1: can any single tray piece clear a line on the CURRENT board?
    let rescue = false;
    const cand: { slot: number; r: number; c: number; q: number; clr: number }[] = [];
    for (let slot = 0; slot < m.tray.length; slot++) {
      const piece = m.tray[slot];
      if (!piece) continue;
      const geo = PIECE_SHAPES[piece.shape];
      for (let r = 0; r + geo.rows <= R; r++) {
        for (let c = 0; c + geo.cols <= C; c++) {
          if (!m.canPlace(slot, r, c)) continue;
          if (placementClears(occ, geo, r, c) > 0) rescue = true;
          const { q, clr } = evalPlacement(occ, geo, r, c);
          cand.push({ slot, r, c, q, clr });
        }
      }
    }
    if (!cand.length) break;
    acc.turns += 1; if (rescue) acc.rescueTurns += 1;
    // opportunity: the most lines any single placement could clear this turn
    const maxOpp = cand.reduce((m, x) => Math.max(m, x.clr), 0);
    acc.oppSum += maxOpp; if (maxOpp >= 2) acc.multiOppTurns += 1;

    cand.sort((a, b) => b.q - a.q);
    const clearing = cand.filter((x) => x.clr > 0);
    const pool = clearing.length ? clearing : cand.slice(0, Math.max(1, Math.ceil(cand.length / 3)));
    const pick = pool[Math.floor(rng() * pool.length)];
    const res = m.place(pick.slot, pick.r, pick.c);
    const lines = (res?.clearedRows.length ?? 0) + (res?.clearedCols.length ?? 0);
    if (lines > 0) { acc.clears += 1; if (lines >= 3) acc.clears3plus += 1; }
    if (m.isBoardEmpty()) acc.boardWipes += 1;
  }
}

const RUNS = 30;
for (let i = 0; i < levels.length; i++) for (let s = 1; s <= RUNS; s++) play(i, (s + i * 131) * 2654435761);

const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : '0.0') + '%';
console.log(`campaign metrics (casual autoplayer, ${RUNS} seeds × ${levels.length} levels, REVIVES=${REVIVES})`);
console.log(`#1 rescue availability : ${pct(acc.rescueTurns, acc.turns)}  (turns where ≥1 tray piece can clear NOW — want LOWER)`);
console.log(`#2 multi-clear OPP     : ${pct(acc.multiOppTurns, acc.turns)}  (turns where a single placement COULD clear 2+ — design potential)`);
console.log(`#2 clears that are 3+  : ${pct(acc.clears3plus, acc.clears)}  (${acc.clears3plus}/${acc.clears} clear events, greedy player — want HIGHER)`);
console.log(`#2 full-board wipes    : ${acc.boardWipes}  (want > 0)`);
console.log(`#3 big-piece share 5+  : ${pct(acc.bigPieces, acc.pieces)}  (avg cells/piece ${(acc.cellSum / acc.pieces).toFixed(2)} — want HIGHER)`);
