// Pure Source Cave combat-roster selection. Every contributor stays visible in
// the generated cave, while a fixed tier budget keeps encounter attrition stable
// as the visible roster grows.
//
// Contribution rank alone decides who fills that budget, and which role they
// fill: the leaderboard's top ranks take the strongest roles down to the last
// tinkerer slot, and only the TAIL of the leaderboard overflows into guardian
// duty. Overflow guardians are the ones the encounter retires wave by wave
// (encounter.ts), so a selection that could cut a heavy contributor in favour of
// a one-PR newcomer would visibly erase the wrong people from the room. That is
// why nothing here draws rng: membership is a pure function of the roster, so
// the same contributor holds the same standing on every host, seed, and reboot.

import { devTierForMergedPrs } from '../dev_tier';
import type { SourceCaveCombatTier } from './types';

type SourceCaveBudgetTier = Exclude<SourceCaveCombatTier, 'unranked'>;

// Every cap is a whole number of waves at that tier's wave size (encounter.ts):
// 18 tinkerers chunk 10 + 8, and the 8 architects plus the non-boss worldwright
// chunk 3 + 3 + 3. A cap that leaves a remainder of one or two mobs buys a limp
// extra beat rather than a wave, so move a cap by a wave, never by a mob.
export const SOURCE_CAVE_COMBAT_TIER_CAPS = {
  tinkerer: 18,
  artificer: 8,
  runesmith: 6,
  architect: 8,
  worldwright: 1,
} as const satisfies Readonly<Record<SourceCaveBudgetTier, number>>;

export const SOURCE_CAVE_COMBATANT_CAP =
  1 + Object.values(SOURCE_CAVE_COMBAT_TIER_CAPS).reduce((sum, count) => sum + count, 0);

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

const STRONGEST_FIRST: readonly SourceCaveBudgetTier[] = [
  'worldwright',
  'architect',
  'runesmith',
  'artificer',
  'tinkerer',
];

/** Best contribution first; the login tiebreak keeps the order input-independent. */
function byRank(a: SourceCaveCombatCandidate, b: SourceCaveCombatCandidate): number {
  return a.rank - b.rank || (a.login < b.login ? -1 : a.login > b.login ? 1 : 0);
}

/**
 * Assign the fixed power roles while leaving every candidate visible. Once the
 * roster fills the budget, the best-ranked contributors take the 36 non-boss
 * roles strongest first and everyone below the cut becomes an overflow guardian.
 * Below the budget nobody is cut, and each contributor fights at the natural
 * tier their own merged-PR count earns, so a small roster is never promoted.
 */
export function sourceCaveCombatRoles(
  candidates: readonly SourceCaveCombatCandidate[],
): Map<string, SourceCaveCombatTier> {
  const selected = new Map<string, SourceCaveCombatTier>();
  const boss = candidates.filter((candidate) => candidate.boss).sort(byRank)[0];
  const nonBoss = candidates.filter((candidate) => !candidate.boss).sort(byRank);
  const fixedBudget = nonBoss.length >= SOURCE_CAVE_COMBATANT_CAP - 1;
  if (boss) {
    selected.set(boss.login, fixedBudget ? 'worldwright' : combatTierForMergedPrs(boss.mergedPrs));
  }
  if (!fixedBudget) {
    for (const candidate of nonBoss) {
      selected.set(candidate.login, combatTierForMergedPrs(candidate.mergedPrs));
    }
    return selected;
  }
  // Power roles follow rank, so promotions can never change total attrition:
  // wave shape, affixes, HP and damage stay exactly calibrated whatever the
  // displayed merged-PR counts do.
  const roles = STRONGEST_FIRST.flatMap((tier) =>
    Array.from({ length: SOURCE_CAVE_COMBAT_TIER_CAPS[tier] }, () => tier),
  );
  for (let i = 0; i < roles.length; i++) selected.set(nonBoss[i].login, roles[i]);
  return selected;
}

/** Compatibility helper for callers interested only in encounter membership. */
export function sourceCaveCombatantLogins(
  candidates: readonly SourceCaveCombatCandidate[],
): Set<string> {
  return new Set(sourceCaveCombatRoles(candidates).keys());
}
