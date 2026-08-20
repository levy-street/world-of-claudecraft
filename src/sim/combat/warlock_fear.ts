// Warlock Fear damage budget. Kept separate from the generic fear-family
// chance model so Harrow and Dread Chorus are deterministic without changing
// Warrior, Priest, or NPC fears.

export const WARLOCK_FEAR_DAMAGE_BUDGET_PCT = 0.08;

export function warlockFearBreakThreshold(
  abilityId: string,
  targetMaxHp: number,
): number | undefined {
  if (abilityId !== 'fear' && abilityId !== 'howl_of_terror') return undefined;
  return Math.max(1, Math.round(Math.max(0, targetMaxHp) * WARLOCK_FEAR_DAMAGE_BUDGET_PCT));
}
