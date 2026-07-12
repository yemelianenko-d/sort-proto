/**
 * Balance calibrator. For each level, plays many survival-greedy runs to death
 * and records the score reached and specials collected. From those
 * distributions it recommends a SCORE target / COLLECT quota that yields the
 * band's intended greedy-autoplayer win rate (a skilled human beats that):
 *   TUTORIAL 88% · EASY 85% · NORMAL 72% · HARD 55% · PEAK 42%
 *
 * Run: npx tsx tools/blocks/calibrate.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BlocksModel } from '../../src/mechanics/blocks/BlocksModel';
import { PIECE_SHAPES } from '../../src/mechanics/blocks/blocksPieces';
import { mulberry32 } from '../../src/mechanics/blocks/blocksRandom';
import { parseBlocksLevels } from '../../src/mechanics/blocks/BlocksLevelParser';

const levels = parseBlocksLevels(JSON.parse(readFileSync(resolve('public/levels/blocks_levels.json'), 'utf8')));
const R = 8, C = 8;
// intended CASUAL win rates per band (a skilled player clears more)
const WIN: Record<string, number> = { TUTORIAL: 0.9, EASY: 0.8, NORMAL: 0.65, HARD: 0.5, PEAK: 0.4 };

function evalPlacement(occ: boolean[][], geo: { cells: { r: number; c: number }[] }, r0: number, c0: number): { score: number; clears: number } {
  const g = occ.map((row) => row.slice());
  for (const { r, c } of geo.cells) g[r0 + r][c0 + c] = true;
  const fullRows = [], fullCols = [];
  for (let r = 0; r < R; r++) if (g[r].every(Boolean)) fullRows.push(r);
  for (let c = 0; c < C; c++) if (g.every((row) => row[c])) fullCols.push(c);
  const clears = fullRows.length + fullCols.length;
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
  // CASUAL weights: holes barely punished (a casual player doesn't see them)
  return { score: clears * 60 - holes * 4 - heights.reduce((a, b) => a + b, 0) * 1.2 - bump * 0.6 - filled * 0.3, clears };
}

/** Play to death with a CASUAL player (takes a clear when it sees one, else a
 * plausible-but-imperfect spot); return score reached + specials collected. */
function runToDeath(levelIndex: number, seed: number): { score: number; collected: Record<number, number> } {
  const rng = mulberry32(seed);
  const m = new BlocksModel(levels[levelIndex], mulberry32(seed ^ 0x9e3779b9));
  const collected: Record<number, number> = {};
  for (let move = 0; move < 500; move++) {
    if (m.isFailed()) break;
    const occ = m.grid.map((row) => row.map((c) => c !== null));
    const cand: { slot: number; r: number; c: number; q: number; clr: number }[] = [];
    for (let slot = 0; slot < m.tray.length; slot++) {
      const piece = m.tray[slot];
      if (!piece) continue;
      const geo = PIECE_SHAPES[piece.shape];
      for (let r = 0; r + geo.rows <= R; r++) {
        for (let c = 0; c + geo.cols <= C; c++) {
          if (!m.canPlace(slot, r, c)) continue;
          const { score, clears } = evalPlacement(occ, geo, r, c);
          cand.push({ slot, r, c, q: score, clr: clears });
        }
      }
    }
    if (!cand.length) break;
    cand.sort((a, b) => b.q - a.q);
    const clearing = cand.filter((x) => x.clr > 0);
    const pool = clearing.length ? clearing : cand.slice(0, Math.max(1, Math.ceil(cand.length / 3)));
    const pick = pool[Math.floor(rng() * pool.length)];
    const res = m.place(pick.slot, pick.r, pick.c);
    for (const sym of res?.collected ?? []) collected[sym] = (collected[sym] ?? 0) + 1;
  }
  return { score: m.score, collected };
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

const RUNS = 80;
console.log('lvl band     mode         cur     recommend   (greedy win target)');
for (let i = 0; i < levels.length; i++) {
  const l = levels[i];
  const band = l.difficultyBand ?? 'NORMAL';
  const winTarget = WIN[band];
  const runs = Array.from({ length: RUNS }, (_, s) => runToDeath(i, (s + 1) * 2654435761));
  if (l.goal.type === 'score') {
    const scores = runs.map((r) => r.score).sort((a, b) => a - b);
    // target below which (1 - winTarget) of runs fall → winTarget of runs reach it
    const rec = percentile(scores, 1 - winTarget);
    const round = Math.max(80, Math.round(rec / 10) * 10);
    console.log(`${String(i + 1).padStart(2)}  ${band.padEnd(8)} score        ${String(l.goal.target).padStart(4)}    ${String(round).padStart(4)}   (p50=${percentile(scores, 0.5)})`);
  } else {
    // for each symbol, the count reached by winTarget of runs
    const parts = l.goal.quotas.map((q) => {
      const got = runs.map((r) => r.collected[q.symbol] ?? 0).sort((a, b) => a - b);
      const rec = Math.max(2, percentile(got, 1 - winTarget));
      return `${q.symbol}:${q.count}->${rec}`;
    });
    console.log(`${String(i + 1).padStart(2)}  ${band.padEnd(8)} collect      ${parts.join(' ')}`);
  }
}
