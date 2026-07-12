/**
 * Diagnostic: why does the real game feel harsh when the survival sim said
 * early levels are easy? Plays each level with TWO players — an EXPERT
 * (hole-minimising) and a CASUAL (prefers clears, else a plausible-but-
 * imperfect spot) — and prints pieces-survived + the piece-size stream, so we
 * can see whether big pieces flood the board and whether clears are rare.
 *
 * Run: npx tsx tools/blocks/diagnose.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BlocksModel } from '../../src/mechanics/blocks/BlocksModel';
import { PIECE_SHAPES } from '../../src/mechanics/blocks/blocksPieces';
import { mulberry32 } from '../../src/mechanics/blocks/blocksRandom';
import { parseBlocksLevels } from '../../src/mechanics/blocks/BlocksLevelParser';

const levels = parseBlocksLevels(JSON.parse(readFileSync(resolve('public/levels/blocks_levels.json'), 'utf8')));
const R = 8, C = 8;

function boardQuality(occ: boolean[][], geo: { cells: { r: number; c: number }[] }, r0: number, c0: number, holeWeight: number) {
  const g = occ.map((row) => row.slice());
  for (const { r, c } of geo.cells) g[r0 + r][c0 + c] = true;
  const fr = [], fc = [];
  for (let r = 0; r < R; r++) if (g[r].every(Boolean)) fr.push(r);
  for (let c = 0; c < C; c++) if (g.every((row) => row[c])) fc.push(c);
  const clears = fr.length + fc.length;
  for (const r of fr) for (let c = 0; c < C; c++) g[r][c] = false;
  for (const c of fc) for (let r = 0; r < R; r++) g[r][c] = false;
  let holes = 0, filled = 0;
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
  return { score: clears * 60 - holes * holeWeight - aggH * 1.2 - bump * 0.6 - filled * 0.3, clears };
}

function play(levelIndex: number, seed: number, casual: boolean) {
  const rng = mulberry32(seed);
  const m = new BlocksModel(levels[levelIndex], mulberry32(seed ^ 0x9e3779b9));
  let pieces = 0, clears = 0, cells = 0;
  const sizes: number[] = [];
  for (let move = 0; move < 500; move++) {
    if (m.isWon() || m.isFailed()) break;
    const occ = m.grid.map((row) => row.map((c) => c !== null));
    const cand: { slot: number; r: number; c: number; q: number; clr: number }[] = [];
    for (let slot = 0; slot < m.tray.length; slot++) {
      const p = m.tray[slot];
      if (!p) continue;
      const geo = PIECE_SHAPES[p.shape];
      for (let r = 0; r + geo.rows <= R; r++) {
        for (let c = 0; c + geo.cols <= C; c++) {
          if (!m.canPlace(slot, r, c)) continue;
          const { score, clears: cl } = boardQuality(occ, geo, r, c, casual ? 4 : 12);
          cand.push({ slot, r, c, q: score, clr: cl });
        }
      }
    }
    if (cand.length === 0) break;
    cand.sort((a, b) => b.q - a.q);
    // casual: always take a clear if available, else pick randomly among the
    // top third of placements (imperfect but not silly). expert: take the best.
    let pick = cand[0];
    if (casual) {
      const clearing = cand.filter((x) => x.clr > 0);
      const pool = clearing.length ? clearing : cand.slice(0, Math.max(1, Math.ceil(cand.length / 3)));
      pick = pool[Math.floor(rng() * pool.length)];
    }
    const slotPiece = m.tray[pick.slot]!;
    sizes.push(PIECE_SHAPES[slotPiece.shape].cells.length);
    const res = m.place(pick.slot, pick.r, pick.c);
    pieces += 1;
    clears += res ? res.clearedRows.length + res.clearedCols.length : 0;
    cells = m.grid.reduce((n, row) => n + row.filter(Boolean).length, 0);
  }
  return { pieces, clears, endCells: cells, won: m.isWon(), avgSize: sizes.reduce((a, b) => a + b, 0) / (sizes.length || 1) };
}

const RUNS = 60;
const casualAgg = (i: number) => {
  let pcs = 0, clr = 0, won = 0;
  for (let s = 1; s <= RUNS; s++) { const r = play(i, s * 2654435761, true); pcs += r.pieces; clr += r.clears; won += r.won ? 1 : 0; }
  return { pcs: pcs / RUNS, clr: clr / RUNS, won: Math.round((won / RUNS) * 100) };
};

console.log('lvl band     mode           |  EXPERT pcs/clr won%  |  CASUAL pcs/clr won%  avgSize');
for (const i of [0, 1, 2, 3, 4, 5, 6, 8, 11, 16, 19]) {
  const l = levels[i];
  const agg = (casual: boolean) => {
    let pcs = 0, clr = 0, won = 0, sz = 0;
    for (let s = 1; s <= RUNS; s++) { const r = play(i, s * 2654435761, casual); pcs += r.pieces; clr += r.clears; won += r.won ? 1 : 0; sz += r.avgSize; }
    return { pcs: pcs / RUNS, clr: clr / RUNS, won: Math.round((won / RUNS) * 100), sz: sz / RUNS };
  };
  const e = agg(false), c = agg(true);
  const mode = l.goal.type === 'score' ? `score ${l.goal.target}` : 'collect ' + l.goal.quotas.map((q) => `${q.symbol}×${q.count}`).join(',');
  console.log(
    `${String(i + 1).padStart(2)}  ${(l.difficultyBand ?? '').padEnd(8)} ${mode.padEnd(14)} | ${e.pcs.toFixed(0).padStart(4)}/${e.clr.toFixed(0).padStart(3)} ${String(e.won).padStart(3)}%  | ${c.pcs.toFixed(0).padStart(4)}/${c.clr.toFixed(0).padStart(3)} ${String(c.won).padStart(3)}%  ${c.sz.toFixed(1)}`,
  );
}

/* --- EXPERIMENT: the "tension-zone" model. Measure AVG board fill% during
 * casual play (empty→dead is boring→sudden; a persistent ~40-55% is the BB
 * puzzle). Compare: current empty + SOLVABLE_NOW-heavy vs pre-filled +
 * AFTER_CLEAR-heavy (each pool needs a clear to fit = a mini-puzzle). --- */
function avgFill(levelIndex: number, seed: number): number {
  const m = new BlocksModel(levels[levelIndex], mulberry32(seed ^ 0x9e3779b9));
  const rng = mulberry32(seed);
  let sum = 0, n = 0;
  for (let move = 0; move < 500; move++) {
    if (m.isWon() || m.isFailed()) break;
    const occ = m.grid.map((row) => row.map((c) => c !== null));
    const cand: { slot: number; r: number; c: number; q: number; clr: number }[] = [];
    for (let slot = 0; slot < m.tray.length; slot++) {
      const p = m.tray[slot];
      if (!p) continue;
      const geo = PIECE_SHAPES[p.shape];
      for (let r = 0; r + geo.rows <= R; r++) for (let c = 0; c + geo.cols <= C; c++) {
        if (!m.canPlace(slot, r, c)) continue;
        const { score, clears } = boardQuality(occ, geo, r, c, 4);
        cand.push({ slot, r, c, q: score, clr: clears });
      }
    }
    if (!cand.length) break;
    cand.sort((a, b) => b.q - a.q);
    const clearing = cand.filter((x) => x.clr > 0);
    const pool = clearing.length ? clearing : cand.slice(0, Math.max(1, Math.ceil(cand.length / 3)));
    const pick = pool[Math.floor(rng() * pool.length)];
    m.place(pick.slot, pick.r, pick.c);
    sum += m.grid.reduce((k, row) => k + row.filter(Boolean).length, 0) / 64;
    n++;
  }
  return n ? sum / n : 0;
}

console.log('\nEXPERIMENT — tension-zone model (L9 score, casual):');
const base = levels[8];
const RUNS2 = 60;
const report = (label: string) => {
  const a = casualAgg(8);
  let f = 0; for (let s = 1; s <= RUNS2; s++) f += avgFill(8, s * 2654435761); f /= RUNS2;
  console.log(`  ${label.padEnd(28)} ${a.pcs.toFixed(0)} pcs, ${a.clr.toFixed(1)} clears, ${a.won}% won, avgFill ${(f * 100).toFixed(0)}%`);
};
report('current (empty, NOW-heavy)');
// prototype: ~35% designed pre-fill (near-complete rows) + AFTER_CLEAR-heavy gen
const prefill = ['........', '........', '0.0..0.0', '110.0110', '0110110.', '110.0110', '.0110110', '........'];
levels[8] = {
  ...base, board: prefill,
  batchPolicy: { ...base.batchPolicy, solvabilityPolicy: { SOLVABLE_NOW: 0.25, SOLVABLE_AFTER_CLEAR: 0.68, DANGEROUS: 0.07, DEAD: 0 } },
} as typeof base;
report('prototype (fill + AFTER_CLEAR)');
levels[8] = base;
