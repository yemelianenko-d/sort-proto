/**
 * COLLECT target economy (Balance Spec v3 §7). Pure & deterministic given the
 * injected rng. After a batch's shapes are chosen, targets are assigned to the
 * fresh tray pieces under a controlled budget so the player never loses just
 * because a needed target failed to spawn:
 *   - deficit-driven urgency weighting (§7.4)
 *   - pity: a still-needed symbol unseen for pityLimit batches is forced (§7.5)
 *   - future-supply safety: if a symbol can no longer reach its quota, rescue it
 *   - source split via presetCount (board) + generatedBudget (pieces)
 */
import type { TargetPolicy, TargetPolicyEntry } from './BlocksTypes';

export interface TargetQuota {
  symbol: number;
  required: number;
}

/** Mutable economy counters (per symbol id), owned by the model. */
export interface TargetEconomyState {
  collected: Record<number, number>;
  /** Generated-on-piece budget remaining per symbol. */
  budgetLeft: Record<number, number>;
  /** Batches since a target of this symbol was last spawned/seen (pity). */
  batchesSinceSeen: Record<number, number>;
}

export interface TargetAssignment {
  slot: number;
  symbol: number;
  cellIndex: number;
}

export interface AssignInput {
  quotas: TargetQuota[];
  policy: TargetPolicy;
  /** Fresh tray: slot index, cell count, how many specials it already carries. */
  slots: { slot: number; cellCount: number; specialCount: number }[];
  /** Current board target counts per symbol (still collectible). */
  onBoard: Record<number, number>;
  state: TargetEconomyState;
  rng: () => number;
}

/** Build the initial economy state from the policy's generated budgets. */
export function initEconomy(policy: TargetPolicy): TargetEconomyState {
  const budgetLeft: Record<number, number> = {};
  const batchesSinceSeen: Record<number, number> = {};
  for (const e of policy.perTarget) {
    budgetLeft[e.symbol] = e.generatedBudget;
    batchesSinceSeen[e.symbol] = 0;
  }
  return { collected: {}, budgetLeft, batchesSinceSeen };
}

function entryOf(policy: TargetPolicy, symbol: number): TargetPolicyEntry | undefined {
  return policy.perTarget.find((e) => e.symbol === symbol);
}

/**
 * Decide the target assignments for a fresh batch and advance the economy
 * counters (mutates `input.state`). Returns the tiles to stamp.
 */
export function assignTargets(input: AssignInput): TargetAssignment[] {
  const { quotas, policy, slots, onBoard, state, rng } = input;
  const urgency = policy.urgencyStrength ?? 1;
  const chance = policy.targetBatchChance ?? 0.34;
  const maxPerBatch = policy.maxTargetsPerBatch ?? 1;

  const collected = (s: number) => state.collected[s] ?? 0;
  const remaining = (s: number) => Math.max(0, req(s) - collected(s));
  const req = (s: number) => quotas.find((q) => q.symbol === s)?.required ?? 0;

  const needed = quotas.map((q) => q.symbol).filter((s) => remaining(s) > 0);
  if (needed.length === 0) return [];

  // per-symbol: is a spawn forced? (pity reached, or future supply unsafe)
  const forced = new Set<number>();
  for (const s of needed) {
    const e = entryOf(policy, s);
    const budget = state.budgetLeft[s] ?? 0;
    const safety = e?.minFutureSupplySafety ?? 1;
    const futureMax = (onBoard[s] ?? 0) + budget; // still-collectible + can still spawn
    const pity = e?.pityLimitBatches ?? Infinity;
    if ((state.batchesSinceSeen[s] ?? 0) >= pity && budget > 0) forced.add(s);
    // rescue: without another spawn this symbol can't reach its quota
    if (futureMax < remaining(s) + Math.max(0, safety - 1) && budget > 0) forced.add(s);
  }

  const spawnThisBatch = forced.size > 0 || rng() < chance;
  if (!spawnThisBatch) {
    for (const s of needed) state.batchesSinceSeen[s] = (state.batchesSinceSeen[s] ?? 0) + 1;
    return [];
  }

  // order candidate symbols: forced first, then by deficit-driven urgency weight
  const weight = (s: number) => {
    const e = entryOf(policy, s);
    const base = e?.baseSpawnWeight ?? 1;
    const remainingRatio = req(s) > 0 ? remaining(s) / req(s) : 0;
    return base * (1 + urgency * remainingRatio);
  };
  const ordered = [...needed]
    .filter((s) => (state.budgetLeft[s] ?? 0) > 0)
    .sort((a, b) => {
      if (forced.has(a) !== forced.has(b)) return forced.has(a) ? -1 : 1;
      return weight(b) - weight(a);
    });

  // Multi-assignment (late-game marathon flow): a piece can carry up to
  // maxTargetsPerPiece specials (distinct cells), a batch up to maxTargetsPerBatch.
  // Symbols cycle in urgency order so one deficit never starves the others.
  const maxPerPiece = policy.maxTargetsPerPiece ?? 1;
  const assignments: TargetAssignment[] = [];
  const slotLoad = new Map(slots.map((s) => [s.slot, s.specialCount]));
  const usedCells = new Map(slots.map((s) => [s.slot, new Set<number>()]));
  const spawned = new Set<number>();
  const assignedOf = (sym: number) => assignments.filter((a) => a.symbol === sym).length;

  for (let round = 0; assignments.length < maxPerBatch && round < maxPerBatch; round++) {
    let placedThisRound = false;
    for (const symbol of ordered) {
      if (assignments.length >= maxPerBatch) break;
      if ((state.budgetLeft[symbol] ?? 0) <= 0) continue;
      if (assignedOf(symbol) >= remaining(symbol)) continue; // never over-supply a quota
      const free = slots.filter(
        (s) =>
          (slotLoad.get(s.slot) ?? 0) < maxPerPiece &&
          usedCells.get(s.slot)!.size + s.specialCount < s.cellCount,
      );
      if (free.length === 0) break;
      const slot = free[Math.floor(rng() * free.length)];
      const taken = usedCells.get(slot.slot)!;
      const freeCells = Array.from({ length: slot.cellCount }, (_, ci) => ci).filter((ci) => !taken.has(ci));
      const cellIndex = freeCells[Math.floor(rng() * freeCells.length)];
      assignments.push({ slot: slot.slot, symbol, cellIndex });
      taken.add(cellIndex);
      slotLoad.set(slot.slot, (slotLoad.get(slot.slot) ?? 0) + 1);
      state.budgetLeft[symbol] = (state.budgetLeft[symbol] ?? 0) - 1;
      spawned.add(symbol);
      placedThisRound = true;
    }
    if (!placedThisRound) break;
  }

  // advance pity counters: reset for spawned symbols, increment for the rest
  for (const s of needed) {
    state.batchesSinceSeen[s] = spawned.has(s) ? 0 : (state.batchesSinceSeen[s] ?? 0) + 1;
  }
  return assignments;
}
