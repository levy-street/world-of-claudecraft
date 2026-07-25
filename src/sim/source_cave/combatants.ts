// Pure Source Cave combat-roster selection. Every contributor remains in the
// generated cave, while tier budgets keep encounter attrition stable as the
// visible roster grows. Selection uses isolated salted RNG streams, never the
// shared Sim RNG or the placement stream.

import { devTierForMergedPrs } from '../dev_tier';
import { Rng } from '../rng';
import type { SourceCaveCombatTier } from './types';

type SourceCaveBudgetTier = Exclude<SourceCaveCombatTier, 'unranked'>;

export const SOURCE_CAVE_COMBAT_TIER_CAPS = {
  tinkerer: 16,
  artificer: 8,
  runesmith: 6,
  architect: 5,
  worldwright: 1,
} as const satisfies Readonly<Record<SourceCaveBudgetTier, number>>;

export const SOURCE_CAVE_COMBATANT_CAP =
  1 + Object.values(SOURCE_CAVE_COMBAT_TIER_CAPS).reduce((sum, count) => sum + count, 0);

const TIER_SALTS = {
  tinkerer: 0x74696e6b,
  artificer: 0x61727469,
  runesmith: 0x72756e65,
  architect: 0x61726368,
  worldwright: 0x776f726c,
} as const satisfies Readonly<Record<SourceCaveBudgetTier, number>>;

export interface SourceCaveCombatCandidate {
  login: string;
  mergedPrs: number;
  rank: number;
  boss: boolean;
}

function combatTierForMergedPrs(mergedPrs: number): SourceCaveCombatTier {
  const tier = devTierForMergedPrs(mergedPrs)?.key;
  if (!tier) return 'unranked';
  if (tier === 'tinkerer') return 'tinkerer';
  if (tier === 'artificer') return 'artificer';
  if (tier === 'runesmith') return 'runesmith';
  if (tier === 'architect') return 'architect';
  return 'worldwright';
}

function shuffledTier(
  candidates: readonly SourceCaveCombatCandidate[],
  seed: number,
  tier: SourceCaveBudgetTier,
): SourceCaveCombatCandidate[] {
  const values = [...candidates].sort(
    (a, b) => a.rank - b.rank || (a.login < b.login ? -1 : a.login > b.login ? 1 : 0),
  );
  if (values.length <= SOURCE_CAVE_COMBAT_TIER_CAPS[tier]) return values;
  const rng = new Rng((seed ^ TIER_SALTS[tier]) >>> 0);
  for (let i = values.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

const STRONGEST_FIRST: readonly SourceCaveBudgetTier[] = [
  'worldwright',
  'architect',
  'runesmith',
  'artificer',
  'tinkerer',
];

/**
 * Assign fixed power roles while leaving every candidate visible. Candidates first
 * occupy their natural PR tier, then overflow backfills any empty roles. This keeps
 * the calibrated 36 non-boss roles full even if every contributor is promoted.
 */
export function sourceCaveCombatRoles(
  candidates: readonly SourceCaveCombatCandidate[],
  seed: number,
): Map<string, SourceCaveCombatTier> {
  const selected = new Map<string, SourceCaveCombatTier>();
  const groups: Record<SourceCaveBudgetTier, SourceCaveCombatCandidate[]> = {
    tinkerer: [],
    artificer: [],
    runesmith: [],
    architect: [],
    worldwright: [],
  };
  const boss = [...candidates]
    .filter((candidate) => candidate.boss)
    .sort((a, b) => a.rank - b.rank || (a.login < b.login ? -1 : a.login > b.login ? 1 : 0))[0];
  const nonBossCount = candidates.filter((candidate) => !candidate.boss).length;
  const fixedBudget = nonBossCount >= SOURCE_CAVE_COMBATANT_CAP - 1;
  if (boss) {
    selected.set(boss.login, fixedBudget ? 'worldwright' : combatTierForMergedPrs(boss.mergedPrs));
  }
  if (!fixedBudget) {
    for (const candidate of candidates) {
      if (!candidate.boss)
        selected.set(candidate.login, combatTierForMergedPrs(candidate.mergedPrs));
    }
    return selected;
  }
  for (const candidate of candidates) {
    if (candidate.boss) continue;
    const naturalTier = combatTierForMergedPrs(candidate.mergedPrs);
    groups[naturalTier === 'unranked' ? 'tinkerer' : naturalTier].push(candidate);
  }

  const overflow: SourceCaveCombatCandidate[] = [];
  const vacancies: SourceCaveBudgetTier[] = [];
  for (const tier of STRONGEST_FIRST) {
    const cap = SOURCE_CAVE_COMBAT_TIER_CAPS[tier];
    const ordered = shuffledTier(groups[tier], seed, tier);
    for (const candidate of ordered.slice(0, cap)) selected.set(candidate.login, tier);
    overflow.push(...ordered.slice(cap));
    for (let i = ordered.length; i < cap; i++) vacancies.push(tier);
  }

  overflow.sort((a, b) => a.rank - b.rank || (a.login < b.login ? -1 : a.login > b.login ? 1 : 0));
  const rng = new Rng((seed ^ 0x6261636b) >>> 0);
  for (let i = overflow.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [overflow[i], overflow[j]] = [overflow[j], overflow[i]];
  }
  for (let i = 0; i < Math.min(overflow.length, vacancies.length); i++) {
    selected.set(overflow[i].login, vacancies[i]);
  }

  // Power roles follow rank among selected identities. Membership may rotate with
  // the seed, while wave shape, affixes, HP and damage stay exactly calibrated.
  const selectedNonBoss = candidates
    .filter((candidate) => !candidate.boss && selected.has(candidate.login))
    .sort((a, b) => a.rank - b.rank || (a.login < b.login ? -1 : a.login > b.login ? 1 : 0));
  const roles = STRONGEST_FIRST.flatMap((tier) =>
    Array.from({ length: SOURCE_CAVE_COMBAT_TIER_CAPS[tier] }, () => tier),
  );
  for (let i = 0; i < selectedNonBoss.length; i++) {
    selected.set(selectedNonBoss[i].login, roles[i]);
  }
  return selected;
}

/** Compatibility helper for callers interested only in encounter membership. */
export function sourceCaveCombatantLogins(
  candidates: readonly SourceCaveCombatCandidate[],
  seed: number,
): Set<string> {
  return new Set(sourceCaveCombatRoles(candidates, seed).keys());
}
