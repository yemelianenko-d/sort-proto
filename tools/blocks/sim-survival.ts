/**
 * Survival probe: plays each campaign level with a greedy autoplayer (place the
 * piece+cell that clears the most lines, tie-break by keeping the board open)
 * across many seeds, and reports how often the honest levels dead-end before
 * the goal. Sanity check for "levels 20–30 lose immediately" — not a balance
 * oracle, just a smoke test that a competent player can survive.
 *
 * Run: npx tsx tools/blocks/sim-survival.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BlocksModel } from '../../src/mechanics/blocks/BlocksModel';
import { PIECE_SHAPES } from '../../src/mechanics/blocks/blocksPieces';
import { mulberry32 } from '../../src/mechanics/blocks/blocksRandom';
import { parseBlocksLevels } from '../../src/mechanics/blocks/BlocksLevelParser';

const raw = JSON.parse(readFileSync(resolve('public/levels/blocks_levels.json'), 'utf8'));
const levels = parseBlocksLevels(raw);

const R = 8, C = 8;

/** Boolean occupancy snapshot of the model grid. */
function snapshot(m: BlocksModel): boolean[][] {
  return m.grid.map((row) => row.map((c) => c !== null));
}

/** Quality of a board after a hypothetical placement (higher = better).
 * Classic block-puzzle heuristic: reward clears, punish holes, height,
 * bumpiness and the emptiness left — a competent-player proxy. */
function evalPlacement(occ: boolean[][], geo: { rows: number; cols: number; cells: { r: number; c: number }[] }, r0: number, c0: number): number {
  const g = occ.map((row) => row.slice());
  for (const { r, c } of geo.cells) g[r0 + r][c0 + c] = true;
  // clear full lines
  let clears = 0;
  const fullRows = [], fullCols = [];
  for (let r = 0; r < R; r++) if (g[r].every(Boolean)) fullRows.push(r);
  for (let c = 0; c < C; c++) if (g.every((row) => row[c])) fullCols.push(c);
  clears = fullRows.length + fullCols.length;
  for (const r of fullRows) for (let c = 0; c < C; c++) g[r][c] = false;
  for (const c of fullCols) for (let r = 0; r < R; r++) g[r][c] = false;
  // metrics
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
  const aggH = heights.reduce((a, b) => a + b, 0);
  return clears * 60 - holes * 12 - aggH * 1.2 - bump * 0.6 - filled * 0.3;
}

/** Revive budget (matches the booster wallet); override with REVIVES=N. */
const REVIVES = Number(process.env.REVIVES ?? 5);

/** Play one attempt with a competent greedy autoplayer, using up to REVIVES
 * Revive charges (clear board, keep progress) on game over. */
function play(levelIndex: number, seed: number): 'won' | 'lost' | 'stall' {
  const m = new BlocksModel(levels[levelIndex], mulberry32(seed));
  let revives = REVIVES;
  for (let move = 0; move < 4000; move++) {
    if (m.isWon()) return 'won';
    if (m.isFailed()) {
      if (revives <= 0) return 'lost';
      revives -= 1;
      m.revive();
      continue;
    }
    const occ = snapshot(m);
    let best: { slot: number; r: number; c: number; score: number } | null = null;
    for (let slot = 0; slot < m.tray.length; slot++) {
      const piece = m.tray[slot];
      if (!piece) continue;
      const geo = PIECE_SHAPES[piece.shape];
      for (let r = 0; r + geo.rows <= R; r++) {
        for (let c = 0; c + geo.cols <= C; c++) {
          if (!m.canPlace(slot, r, c)) continue;
          const score = evalPlacement(occ, geo, r, c);
          if (!best || score > best.score) best = { slot, r, c, score };
        }
      }
    }
    if (!best) return 'lost';
    m.place(best.slot, best.r, best.c);
  }
  return 'stall';
}

const RUNS = 40;
console.log('lvl  band     mode                won%  lost%  (greedy autoplayer, 40 seeds)');
for (let i = 0; i < levels.length; i++) {
  const l = levels[i];
  let won = 0, lost = 0;
  for (let s = 1; s <= RUNS; s++) {
    const r = play(i, s * 2654435761);
    if (r === 'won') won += 1;
    else if (r === 'lost') lost += 1;
  }
  const mode = l.goal.type === 'score' ? `score ${l.goal.target}` : 'collect ' + l.goal.quotas.map((q) => `${q.symbol}×${q.count}`).join(',');
  const flag = lost / RUNS > 0.4 ? '  <-- harsh' : '';
  console.log(
    `${String(i + 1).padStart(2)}   ${(l.difficultyBand ?? '').padEnd(8)} ${mode.padEnd(20)} ${String(Math.round((won / RUNS) * 100)).padStart(4)}  ${String(Math.round((lost / RUNS) * 100)).padStart(4)}${flag}`,
  );
}
