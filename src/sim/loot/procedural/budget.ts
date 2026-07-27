import { PROCEDURAL_STAT_BUDGET_COST } from '../../content/procedural_loot/affixes';
import { PROCEDURAL_RARITIES } from '../../content/procedural_loot/rarity';
import type {
  AffixDefinition,
  AffixTier,
  NumericRoll,
  ProceduralItemBase,
} from '../../content/procedural_loot/types';
import type { ProceduralRarity, RolledAffix } from '../../procedural_item';

type ActiveRarity = Exclude<ProceduralRarity, 'mythic'>;

export class ProceduralBudgetAllocationError extends Error {
  override readonly name = 'ProceduralBudgetAllocationError';
}

interface AffixBudgetCandidate {
  tier: AffixTier;
  stat: string;
  value: number;
  budget: number;
}

interface AllocationState {
  selected: AffixBudgetCandidate[];
  individualError: number;
}

const CANDIDATE_CACHE = new WeakMap<
  AffixDefinition,
  Map<string, readonly AffixBudgetCandidate[]>
>();
export const PROCEDURAL_REACHABILITY_CACHE_LIMIT = 4096;
const REACHABILITY_CACHE = new Map<string, boolean>();

function cacheReachability(key: string, value: boolean): boolean {
  if (
    !REACHABILITY_CACHE.has(key) &&
    REACHABILITY_CACHE.size >= PROCEDURAL_REACHABILITY_CACHE_LIMIT
  )
    REACHABILITY_CACHE.clear();
  REACHABILITY_CACHE.set(key, value);
  return value;
}

export function calculateProceduralBudget(
  base: ProceduralItemBase,
  itemLevel: number,
  rarity: ActiveRarity,
): number {
  return Number(
    (itemLevel * PROCEDURAL_RARITIES[rarity].budgetMultiplier * base.slotMultiplier).toFixed(3),
  );
}

export function proceduralBudgetTolerance(canonicalBudget: number): number {
  return Math.max(1, canonicalBudget * 0.15);
}

export function minimumValueForRollFloor(range: NumericRoll, rollFloor: number): number {
  return range.min + (range.max - range.min) * rollFloor;
}

function quantize(value: number, step: number): number {
  const digits = step < 1 ? Math.ceil(-Math.log10(step)) : 0;
  return Number((Math.round(value / step) * step).toFixed(digits));
}

function quantizedFloorMinimum(range: NumericRoll, rollFloor: number): number {
  const step = range.step ?? 1;
  const minimum = minimumValueForRollFloor(range, rollFloor);
  const digits = step < 1 ? Math.ceil(-Math.log10(step)) : 0;
  return Number((Math.ceil((minimum - 1e-10) / step) * step).toFixed(digits));
}

function buildCandidatesForAffix(
  affix: AffixDefinition,
  itemLevel: number,
  rarity: ActiveRarity,
): AffixBudgetCandidate[] {
  const out: AffixBudgetCandidate[] = [];
  const rollFloor = PROCEDURAL_RARITIES[rarity].rollFloor;
  for (const tier of affix.tiers) {
    if (tier.minItemLevel > itemLevel) continue;
    const entries = Object.entries(tier.rolls);
    if (entries.length !== 1)
      throw new Error(`procedural budget allocator requires one stat for affix ${affix.id}`);
    const [stat, range] = entries[0];
    const budgetCost = PROCEDURAL_STAT_BUDGET_COST[stat];
    if (!(budgetCost > 0)) throw new Error(`affix ${affix.id} has no budget cost for ${stat}`);
    const step = range.step ?? 1;
    const first = quantizedFloorMinimum(range, rollFloor);
    for (let value = first; value <= range.max + 1e-10; value = quantize(value + step, step)) {
      out.push({
        tier,
        stat,
        value,
        budget: Number((value * budgetCost).toFixed(3)),
      });
    }
  }
  out.sort((a, b) => a.budget - b.budget || b.tier.tier - a.tier.tier || a.value - b.value);
  return out;
}

function candidatesForAffix(
  affix: AffixDefinition,
  itemLevel: number,
  rarity: ActiveRarity,
): readonly AffixBudgetCandidate[] {
  const key = `${itemLevel}:${rarity}`;
  let affixCache = CANDIDATE_CACHE.get(affix);
  if (!affixCache) {
    affixCache = new Map();
    CANDIDATE_CACHE.set(affix, affixCache);
  }
  const cached = affixCache.get(key);
  if (cached) return cached;
  const candidates = buildCandidatesForAffix(affix, itemLevel, rarity);
  affixCache.set(key, candidates);
  return candidates;
}

function budgetMillis(budget: number): number {
  return Math.round(budget * 1000);
}

function uniqueBudgetCandidates(
  candidates: readonly AffixBudgetCandidate[],
  tieRoll: number,
): AffixBudgetCandidate[] {
  const byBudget = new Map<number, AffixBudgetCandidate[]>();
  for (const candidate of candidates) {
    const key = budgetMillis(candidate.budget);
    const bucket = byBudget.get(key) ?? [];
    bucket.push(candidate);
    byBudget.set(key, bucket);
  }
  return [...byBudget.values()].map(
    (bucket) => bucket[Math.min(bucket.length - 1, Math.floor(tieRoll * bucket.length))],
  );
}

export function affixBudgetBounds(
  affix: AffixDefinition,
  itemLevel: number,
  rarity: ActiveRarity,
): { min: number; max: number } {
  const candidates = candidatesForAffix(affix, itemLevel, rarity);
  if (candidates.length === 0)
    throw new Error(`affix ${affix.id} has no budget candidate at item level ${itemLevel}`);
  return {
    min: candidates[0].budget,
    max: candidates[candidates.length - 1].budget,
  };
}

function reachabilityKey(
  affixes: readonly AffixDefinition[],
  itemLevel: number,
  rarity: ActiveRarity,
  canonicalBudget: number,
): string {
  return `${itemLevel}:${rarity}:${canonicalBudget.toFixed(3)}:${affixes
    .map((affix) => affix.id)
    .sort()
    .join(',')}`;
}

export function affixesCanReachBudget(
  affixes: readonly AffixDefinition[],
  itemLevel: number,
  rarity: ActiveRarity,
  canonicalBudget: number,
): boolean {
  const key = reachabilityKey(affixes, itemLevel, rarity, canonicalBudget);
  const cached = REACHABILITY_CACHE.get(key);
  if (cached !== undefined) return cached;
  const tolerance = proceduralBudgetTolerance(canonicalBudget);
  const lower = budgetMillis(canonicalBudget - tolerance);
  const upper = budgetMillis(canonicalBudget + tolerance);
  const mask = (1n << BigInt(upper + 1)) - 1n;
  let totals = 1n;
  for (const affix of affixes) {
    let next = 0n;
    const candidates = uniqueBudgetCandidates(candidatesForAffix(affix, itemLevel, rarity), 0);
    for (const candidate of candidates) next |= totals << BigInt(budgetMillis(candidate.budget));
    totals = next & mask;
    if (totals === 0n) return cacheReachability(key, false);
  }
  return cacheReachability(key, totals >> BigInt(lower) !== 0n);
}

function affixesCompatible(
  candidate: AffixDefinition,
  selected: readonly AffixDefinition[],
): boolean {
  if (selected.some((affix) => affix.family === candidate.family)) return false;
  const groups = new Set(selected.flatMap((affix) => affix.exclusiveGroups ?? []));
  return !candidate.exclusiveGroups?.some((group) => groups.has(group));
}

export function findProceduralBudgetFeasibleAffixSet(input: {
  pool: readonly AffixDefinition[];
  count: number;
  itemLevel: number;
  rarity: ActiveRarity;
  canonicalBudget: number;
}): AffixDefinition[] | undefined {
  function visit(start: number, selected: AffixDefinition[]): AffixDefinition[] | undefined {
    if (selected.length === input.count)
      return affixesCanReachBudget(selected, input.itemLevel, input.rarity, input.canonicalBudget)
        ? selected
        : undefined;
    for (let index = start; index < input.pool.length; index++) {
      const affix = input.pool[index];
      if (!affixesCompatible(affix, selected)) continue;
      const result = visit(index + 1, [...selected, affix]);
      if (result) return result;
    }
    return undefined;
  }

  return visit(0, []);
}

function closestCandidate(
  candidates: readonly AffixBudgetCandidate[],
  target: number,
  desired: number,
): AffixBudgetCandidate {
  let low = 0;
  let high = candidates.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candidates[middle].budget < target) low = middle + 1;
    else high = middle;
  }
  const nearby = [low - 1, low]
    .filter((index) => index >= 0 && index < candidates.length)
    .map((index) => candidates[index]);
  return nearby.sort(
    (a, b) =>
      Math.abs(a.budget - target) - Math.abs(b.budget - target) ||
      Math.abs(a.budget - desired) - Math.abs(b.budget - desired) ||
      b.tier.tier - a.tier.tier ||
      a.value - b.value,
  )[0];
}
function betterState(candidate: AllocationState, current: AllocationState | undefined): boolean {
  if (!current) return true;
  if (candidate.individualError < current.individualError - 1e-10) return true;
  if (candidate.individualError > current.individualError + 1e-10) return false;
  for (let index = 0; index < candidate.selected.length; index++) {
    const tierDifference = candidate.selected[index].tier.tier - current.selected[index].tier.tier;
    if (tierDifference !== 0) return tierDifference > 0;
    const valueDifference = candidate.selected[index].value - current.selected[index].value;
    if (valueDifference !== 0) return valueDifference < 0;
  }
  return false;
}

export function allocateProceduralAffixes(input: {
  affixes: readonly AffixDefinition[];
  itemLevel: number;
  rarity: ActiveRarity;
  canonicalBudget: number;
  shareRolls: readonly number[];
  valueRolls: readonly number[];
}): RolledAffix[] {
  if (input.affixes.length === 0) return [];
  if (
    input.shareRolls.length !== input.affixes.length ||
    input.valueRolls.length !== input.affixes.length
  )
    throw new Error('procedural budget allocator roll count mismatch');

  const candidateSets = input.affixes.map((affix, index) =>
    uniqueBudgetCandidates(
      candidatesForAffix(affix, input.itemLevel, input.rarity),
      input.valueRolls[index],
    ),
  );
  if (candidateSets.some((candidates) => candidates.length === 0))
    throw new Error('procedural budget allocator has an empty affix candidate set');

  const quality =
    0.95 + (input.valueRolls.reduce((sum, roll) => sum + roll, 0) / input.valueRolls.length) * 0.1;
  const targetTotal = input.canonicalBudget * quality;
  const rawWeights = input.shareRolls.map(
    (roll, index) => (0.9 + roll * 0.2) * (0.9 + input.valueRolls[index] * 0.2),
  );
  const weightTotal = rawWeights.reduce((sum, weight) => sum + weight, 0);
  const desiredBudgets = rawWeights.map((weight) => (targetTotal * weight) / weightTotal);
  const tolerance = proceduralBudgetTolerance(input.canonicalBudget);
  const lower = budgetMillis(input.canonicalBudget - tolerance);
  const upper = budgetMillis(input.canonicalBudget + tolerance);

  const greedy: AffixBudgetCandidate[] = [];
  let greedyTotal = 0;
  for (let index = 0; index < candidateSets.length; index++) {
    const target =
      index === candidateSets.length - 1 ? targetTotal - greedyTotal : desiredBudgets[index];
    const candidate = closestCandidate(candidateSets[index], target, desiredBudgets[index]);
    greedy.push(candidate);
    greedyTotal += candidate.budget;
  }
  for (let pass = 0; pass < input.affixes.length * 2; pass++) {
    const before = Math.abs(greedyTotal - targetTotal);
    let best:
      | { index: number; candidate: AffixBudgetCandidate; total: number; error: number }
      | undefined;
    for (let index = 0; index < greedy.length; index++) {
      const residualTarget = targetTotal - (greedyTotal - greedy[index].budget);
      const candidate = closestCandidate(
        candidateSets[index],
        residualTarget,
        desiredBudgets[index],
      );
      const total = greedyTotal - greedy[index].budget + candidate.budget;
      const error = Math.abs(total - targetTotal);
      if (!best || error < best.error - 1e-10) best = { index, candidate, total, error };
    }
    if (!best || best.error >= before - 1e-10) break;
    greedy[best.index] = best.candidate;
    greedyTotal = best.total;
  }
  if (Math.abs(greedyTotal - input.canonicalBudget) <= tolerance + 1e-8) {
    return greedy.map((candidate, index) => {
      const affix = input.affixes[index];
      const range = candidate.tier.rolls[candidate.stat];
      return {
        affixId: affix.id,
        family: affix.family,
        position: affix.position,
        tier: candidate.tier.tier,
        revision: 1,
        budget: candidate.budget,
        values: { [candidate.stat]: candidate.value },
        ranges: { [candidate.stat]: { min: range.min, max: range.max } },
      };
    });
  }
  let states = new Map<number, AllocationState>([[0, { selected: [], individualError: 0 }]]);
  for (let index = 0; index < candidateSets.length; index++) {
    const next = new Map<number, AllocationState>();
    for (const [total, state] of states) {
      for (const candidate of candidateSets[index]) {
        const combined = total + budgetMillis(candidate.budget);
        if (combined > upper) continue;
        const proposed: AllocationState = {
          selected: [...state.selected, candidate],
          individualError:
            state.individualError + Math.abs(candidate.budget - desiredBudgets[index]),
        };
        if (betterState(proposed, next.get(combined))) next.set(combined, proposed);
      }
    }
    states = next;
  }

  let best: { total: number; state: AllocationState } | undefined;
  for (const [total, state] of states) {
    if (total < lower) continue;
    if (!best) {
      best = { total, state };
      continue;
    }
    const targetError = Math.abs(total / 1000 - targetTotal);
    const bestTargetError = Math.abs(best.total / 1000 - targetTotal);
    if (
      targetError < bestTargetError - 1e-10 ||
      (Math.abs(targetError - bestTargetError) <= 1e-10 && betterState(state, best.state))
    )
      best = { total, state };
  }
  if (!best) {
    throw new ProceduralBudgetAllocationError(
      `unattainable procedural budget ${input.canonicalBudget.toFixed(3)} ` +
        `for ${input.rarity} item level ${input.itemLevel}`,
    );
  }

  return best.state.selected.map((candidate, index) => {
    const affix = input.affixes[index];
    const range = candidate.tier.rolls[candidate.stat];
    return {
      affixId: affix.id,
      family: affix.family,
      position: affix.position,
      tier: candidate.tier.tier,
      revision: 1,
      budget: candidate.budget,
      values: { [candidate.stat]: candidate.value },
      ranges: { [candidate.stat]: { min: range.min, max: range.max } },
    };
  });
}
