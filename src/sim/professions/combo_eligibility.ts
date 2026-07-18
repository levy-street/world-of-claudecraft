import { craftCeiling } from './archetype';
import type { ProfessionRecipeRecord } from './types';
import type { CraftSkills } from './wheel';

export type ComboRequirement = NonNullable<ProfessionRecipeRecord['comboRequirement']>;

export interface ComboIdentity {
  activeArchetype: string | null;
  pairedMajor: string | null;
  hobbyCraft: string | null;
}

export type ComboEligibilityReason = 'not_attuned' | 'wrong_pair' | 'tier_unmet';

export interface ComboEligibilityResult {
  ok: boolean;
  reason: ComboEligibilityReason | null;
  craftA: string | null;
  craftB: string | null;
  minTier: number | null;
  unmetCrafts: string[];
}

function sameUnorderedPair(a: string, b: string, x: string, y: string): boolean {
  return (a === x && b === y) || (a === y && b === x);
}

/** The one combo gate used by authoritative crafting and UI projection. */
export function comboEligibility(
  requirement: ComboRequirement | undefined,
  skills: CraftSkills,
  identity: ComboIdentity,
): ComboEligibilityResult {
  if (!requirement) {
    return {
      ok: true,
      reason: null,
      craftA: null,
      craftB: null,
      minTier: null,
      unmetCrafts: [],
    };
  }

  const base = {
    craftA: requirement.craftA,
    craftB: requirement.craftB,
    minTier: requirement.minTier,
  };
  if (!identity.activeArchetype || !identity.pairedMajor) {
    return { ...base, ok: false, reason: 'not_attuned', unmetCrafts: [] };
  }
  if (
    !sameUnorderedPair(
      identity.activeArchetype,
      identity.pairedMajor,
      requirement.craftA,
      requirement.craftB,
    )
  ) {
    return { ...base, ok: false, reason: 'wrong_pair', unmetCrafts: [] };
  }

  const unmetCrafts = [requirement.craftA, requirement.craftB].filter(
    (craftId) =>
      craftCeiling(
        skills,
        identity.activeArchetype,
        identity.pairedMajor,
        craftId,
        identity.hobbyCraft,
      ) < requirement.minTier,
  );
  return unmetCrafts.length > 0
    ? { ...base, ok: false, reason: 'tier_unmet', unmetCrafts }
    : { ...base, ok: true, reason: null, unmetCrafts: [] };
}
