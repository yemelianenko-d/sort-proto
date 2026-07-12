import { PIECE_SHAPES } from './blocksPieces';
import { BLOCKS_SETTINGS } from './blocksSettings';
import { scoreMove } from './blocksScoring';
import { generateBatch, occupancyOf } from './BlocksGenerator';
import { assignTargets, initEconomy, type TargetEconomyState } from './blocksTargets';
import {
  SPECIAL_SYMBOL_COUNT,
  type BlocksCell,
  type BlocksLevelConfig,
  type ClearedCell,
  type GoalProgress,
  type GridPos,
  type PlaceResult,
  type SpecialSymbol,
  type TileColor,
  type TrayPiece,
} from './BlocksTypes';

/** Colors a random-color spawn can take (matches the 8 tile textures). */
export const TILE_COLOR_COUNT = 8;

/**
 * Pure state logic of the blocks mechanic (no Phaser): an R×C grid, a tray of
 * randomly drawn pieces, full-row/column clears and a per-level goal (reach a
 * score, or collect quotas of special symbols). Special tiles are collected
 * when the line they sit on clears; a guaranteed tray injection keeps every
 * still-needed symbol reachable so a collect level can't dead-end.
 * Randomness is injected (`rng`) so tests are deterministic.
 */
export class BlocksModel {
  readonly rows: number;
  readonly cols: number;
  readonly grid: (BlocksCell | null)[][];
  readonly tray: (TrayPiece | null)[];

  score = 0;
  /** Pieces placed so far (the "moves" of this mechanic). */
  moves = 0;
  /** Consecutive clearing moves (Balance Spec v3 §9.4). A move with no clear
   * resets it; a new batch (refill) does NOT. */
  comboChain = 0;
  maxCombo = 0;

  /** Collected count per special symbol id (collect goal). */
  private readonly collected = new Array<number>(SPECIAL_SYMBOL_COUNT).fill(0);
  /** Persistent target-economy counters (only when the level has a targetPolicy). */
  private readonly targetEcon: TargetEconomyState | null;
  private won = false;
  private failed = false;

  constructor(
    private readonly config: BlocksLevelConfig,
    private readonly rng: () => number = Math.random,
  ) {
    this.rows = config.rows;
    this.cols = config.cols;
    this.grid = config.board.map((row) =>
      [...row].map((ch) => (ch === '.' ? null : { color: Number(ch), initial: true })),
    );
    // preset special tiles (collect goal): stamp the symbol onto existing or
    // fresh cells so they occupy the board and count when their line clears
    for (const s of config.specials ?? []) {
      const cell = this.grid[s.row][s.col];
      if (cell) cell.special = s.symbol;
      else this.grid[s.row][s.col] = { color: 0, initial: true, special: s.symbol };
    }
    this.targetEcon = config.targetPolicy ? initEconomy(config.targetPolicy) : null;
    this.tray = new Array<TrayPiece | null>(BLOCKS_SETTINGS.traySize).fill(null);
    this.refillTray();
    this.failed = !this.hasAnyMove(); // rare: a dealt tray with no fit anywhere
  }

  get levelId(): string {
    return this.config.id;
  }

  isWon(): boolean {
    return this.won;
  }

  isFailed(): boolean {
    return this.failed;
  }

  goalProgress(): GoalProgress {
    const goal = this.config.goal;
    if (goal.type === 'endless') return { type: 'endless', score: this.score };
    if (goal.type === 'score') {
      return { type: 'score', score: this.score, target: goal.target };
    }
    return {
      type: 'collect',
      quotas: goal.quotas.map((q) => ({
        symbol: q.symbol,
        collected: Math.min(this.collected[q.symbol], q.count),
        count: q.count,
      })),
    };
  }

  private goalMet(): boolean {
    const goal = this.config.goal;
    if (goal.type === 'endless') return false; // arcade: never auto-win — play until stuck
    if (goal.type === 'score') return this.score >= goal.target;
    return goal.quotas.every((q) => this.collected[q.symbol] >= q.count);
  }

  /* ---------------- placement rules ---------------- */

  canPlace(slot: number, row: number, col: number): boolean {
    const piece = this.tray[slot];
    if (!piece || this.won || this.failed) return false;
    const geo = PIECE_SHAPES[piece.shape];
    if (row < 0 || col < 0 || row + geo.rows > this.rows || col + geo.cols > this.cols) {
      return false;
    }
    return geo.cells.every(({ r, c }) => this.grid[row + r][col + c] === null);
  }

  hasAnyPlacement(slot: number): boolean {
    const piece = this.tray[slot];
    if (!piece) return false;
    const geo = PIECE_SHAPES[piece.shape];
    for (let row = 0; row + geo.rows <= this.rows; row++) {
      for (let col = 0; col + geo.cols <= this.cols; col++) {
        if (geo.cells.every(({ r, c }) => this.grid[row + r][col + c] === null)) return true;
      }
    }
    return false;
  }

  hasAnyMove(): boolean {
    return this.tray.some((_, slot) => this.hasAnyPlacement(slot));
  }

  /**
   * Revive booster: wipe the board and deal a fresh tray, KEEPING the run's
   * score / collected counts / quota progress (the Block-Blast revive). The
   * combo chain breaks (fresh board). For a collect goal, the still-needed
   * budget is topped up so a revive can never strand an unreachable quota
   * (the cleared board dropped any uncollected preset specials).
   */
  revive(): void {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) this.grid[r][c] = null;
    }
    const goal = this.config.goal;
    if (goal.type === 'collect' && this.targetEcon) {
      for (const q of goal.quotas) {
        const remaining = Math.max(0, q.count - (this.collected[q.symbol] ?? 0));
        this.targetEcon.budgetLeft[q.symbol] = Math.max(this.targetEcon.budgetLeft[q.symbol] ?? 0, remaining);
        this.targetEcon.batchesSinceSeen[q.symbol] = 0;
      }
    }
    this.comboChain = 0;
    this.tray.fill(null);
    this.refillTray();
    this.won = this.goalMet();
    this.failed = !this.won && !this.hasAnyMove();
  }

  /** True when not a single cell is occupied (the "clean sheet" praise). */
  isBoardEmpty(): boolean {
    return this.grid.every((row) => row.every((cell) => cell === null));
  }

  /**
   * Pure query for the drag preview: which rows/cols WOULD complete if the
   * tray piece were placed at (row, col). Empty when the placement is invalid.
   * Does not mutate anything.
   */
  previewClears(slot: number, row: number, col: number): { rows: number[]; cols: number[] } {
    if (!this.canPlace(slot, row, col)) return { rows: [], cols: [] };
    const geo = PIECE_SHAPES[this.tray[slot]!.shape];
    const added = new Set<number>();
    geo.cells.forEach(({ r, c }) => added.add((row + r) * this.cols + (col + c)));
    const filled = (r: number, c: number) => this.grid[r][c] !== null || added.has(r * this.cols + c);
    const rows: number[] = [];
    const cols: number[] = [];
    for (let r = 0; r < this.rows; r++) {
      let full = true;
      for (let c = 0; c < this.cols; c++) if (!filled(r, c)) { full = false; break; }
      if (full) rows.push(r);
    }
    for (let c = 0; c < this.cols; c++) {
      let full = true;
      for (let r = 0; r < this.rows; r++) if (!filled(r, c)) { full = false; break; }
      if (full) cols.push(c);
    }
    return { rows, cols };
  }

  /* ---------------- the move ---------------- */

  place(slot: number, row: number, col: number): PlaceResult | null {
    if (!this.canPlace(slot, row, col)) return null;
    const piece = this.tray[slot]!;
    const geo = PIECE_SHAPES[piece.shape];

    const placed: GridPos[] = geo.cells.map(({ r, c }) => ({ row: row + r, col: col + c }));
    placed.forEach(({ row: r, col: c }, i) => {
      const special = piece.specials?.find((s) => s.cellIndex === i)?.symbol;
      this.grid[r][c] = { color: piece.color, initial: false, special };
    });
    this.tray[slot] = null;
    this.moves += 1;

    const { clearedRows, clearedCols, clearedCells } = this.collectClears();
    const collected: SpecialSymbol[] = [];
    clearedCells.forEach(({ row: r, col: c, special }) => {
      this.grid[r][c] = null;
      if (special !== undefined) {
        this.collected[special] += 1;
        collected.push(special);
      }
    });

    // deterministic triangular scoring + combo (Balance Spec v3 §9). The chain
    // advances/resets HERE (before refill), so a new batch never resets combo.
    const lines = clearedRows.length + clearedCols.length;
    const ms = scoreMove(placed.length, lines, this.comboChain);
    this.comboChain = ms.comboChain;
    this.maxCombo = Math.max(this.maxCombo, this.comboChain);
    this.score += ms.total;

    const refilled = this.tray.every((p) => p === null);
    if (refilled) this.refillTray();

    this.won = this.goalMet();
    this.failed = !this.won && !this.hasAnyMove();

    return {
      placed,
      color: piece.color,
      clearedRows,
      clearedCols,
      clearedCells,
      collected,
      gained: ms.total,
      comboChain: ms.comboChain,
      comboMultiplier: ms.multiplier,
      refilled,
      won: this.won,
      failed: this.failed,
    };
  }

  private collectClears(): {
    clearedRows: number[];
    clearedCols: number[];
    clearedCells: ClearedCell[];
  } {
    const clearedRows: number[] = [];
    const clearedCols: number[] = [];
    for (let r = 0; r < this.rows; r++) {
      if (this.grid[r].every((cell) => cell !== null)) clearedRows.push(r);
    }
    for (let c = 0; c < this.cols; c++) {
      if (this.grid.every((rowArr) => rowArr[c] !== null)) clearedCols.push(c);
    }
    const seen = new Set<number>();
    const clearedCells: ClearedCell[] = [];
    const push = (r: number, c: number) => {
      const key = r * this.cols + c;
      if (seen.has(key)) return;
      seen.add(key);
      const cell = this.grid[r][c]!;
      clearedCells.push({ row: r, col: c, color: cell.color, initial: cell.initial, special: cell.special });
    };
    clearedRows.forEach((r) => {
      for (let c = 0; c < this.cols; c++) push(r, c);
    });
    clearedCols.forEach((c) => {
      for (let r = 0; r < this.rows; r++) push(r, c);
    });
    return { clearedRows, clearedCols, clearedCells };
  }

  /* ---------------- tray ---------------- */

  /** Recently drawn shape ids (most recent last) — feeds the generator cooldown. */
  private readonly recentHistory: string[] = [];
  batchIndex = 0;

  private refillTray(): void {
    // Controlled batch generation when the level defines a batchPolicy
    // (Balance Spec §5); otherwise the simple weighted draw (backward compat).
    const shapes = this.config.batchPolicy
      ? generateBatch(
          occupancyOf(this.grid),
          this.config,
          this.rng,
          this.recentHistory,
          this.tray.length,
          this.batchIndex,
        ).shapes
      : Array.from({ length: this.tray.length }, () => this.drawShape());
    for (let slot = 0; slot < this.tray.length; slot++) {
      const shape = shapes[slot];
      this.tray[slot] = { shape, color: this.pickColor(shape) };
      this.recentHistory.push(shape);
    }
    if (this.recentHistory.length > 24) this.recentHistory.splice(0, this.recentHistory.length - 24);
    this.batchIndex += 1;
    this.assignBatchTargets();
  }

  /** Target assignment for the fresh tray (collect goal). Uses the full economy
   * (budget/urgency/pity/rescue) when the level defines a targetPolicy; else the
   * legacy guaranteed injection. */
  private assignBatchTargets(): void {
    const goal = this.config.goal;
    if (goal.type !== 'collect') return;
    const policy = this.config.targetPolicy;
    if (!policy || !this.targetEcon) {
      this.topUpSpecials();
      return;
    }
    for (let s = 0; s < SPECIAL_SYMBOL_COUNT; s++) this.targetEcon.collected[s] = this.collected[s];
    const onBoard: Record<number, number> = {};
    for (const q of goal.quotas) onBoard[q.symbol] = this.countBoardSpecials(q.symbol);
    const slots = this.tray.map((p, i) => ({
      slot: i,
      cellCount: p ? PIECE_SHAPES[p.shape].cells.length : 0,
      specialCount: p?.specials?.length ?? 0,
    }));
    const assignments = assignTargets({
      quotas: goal.quotas.map((q) => ({ symbol: q.symbol, required: q.count })),
      policy,
      slots,
      onBoard,
      state: this.targetEcon,
      rng: this.rng,
    });
    for (const a of assignments) {
      const piece = this.tray[a.slot];
      if (piece) piece.specials = [...(piece.specials ?? []), { cellIndex: a.cellIndex, symbol: a.symbol }];
    }
  }

  /** Simple weighted shape draw (fallback when no batchPolicy). */
  private drawShape(): string {
    const pool = this.config.pieces;
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let roll = this.rng() * total;
    let entry = pool[pool.length - 1];
    for (const p of pool) {
      roll -= p.weight;
      if (roll < 0) {
        entry = p;
        break;
      }
    }
    return entry.shape;
  }

  /** Colour for a drawn shape: the roster's fixed colour, else a random tile. */
  private pickColor(shape: string): TileColor {
    const entry = this.config.pieces.find((p) => p.shape === shape);
    return entry?.color ?? Math.floor(this.rng() * TILE_COLOR_COUNT);
  }

  /**
   * Guarantee reachability of every still-needed symbol: for each quota short
   * of completion where the board can't supply the rest and the tray has none,
   * inject one special onto a fresh tray piece. Keeps a collect level solvable.
   */
  private topUpSpecials(): void {
    const goal = this.config.goal;
    if (goal.type !== 'collect') return;
    for (const q of goal.quotas) {
      const remaining = q.count - this.collected[q.symbol];
      if (remaining <= 0) continue;
      const onBoard = this.countBoardSpecials(q.symbol);
      const inTray = this.countTraySpecials(q.symbol);
      if (inTray > 0 || onBoard >= remaining) continue;
      this.injectSpecial(q.symbol);
    }
  }

  private countBoardSpecials(symbol: SpecialSymbol): number {
    let n = 0;
    for (const row of this.grid) for (const cell of row) if (cell?.special === symbol) n += 1;
    return n;
  }

  private countTraySpecials(symbol: SpecialSymbol): number {
    return this.tray.reduce(
      (n, p) => n + (p?.specials?.filter((s) => s.symbol === symbol).length ?? 0),
      0,
    );
  }

  /** Attach `symbol` to a random cell of a random tray piece with no special. */
  private injectSpecial(symbol: SpecialSymbol): void {
    const free: number[] = [];
    this.tray.forEach((p, i) => {
      if (p && !p.specials?.length) free.push(i);
    });
    if (free.length === 0) return; // next refill will retry
    const slot = free[Math.floor(this.rng() * free.length)];
    const piece = this.tray[slot]!;
    const cellCount = PIECE_SHAPES[piece.shape].cells.length;
    const cellIndex = Math.floor(this.rng() * cellCount);
    piece.specials = [{ cellIndex, symbol }];
  }
}
