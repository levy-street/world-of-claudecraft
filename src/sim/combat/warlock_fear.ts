// Warlock Fear damage budgets. Kept separate from the generic fear-family
// chance model so Harrow and Dread Chorus are deterministic without changing
// Warrior, Priest, or NPC fears.

export const HARROW_DAMAGE_BUDGET_PCT = 0.1;
export const DREAD_CHORUS_DAMAGE_BUDGET_PCT = 0.08;

export function warlockFearBreakThreshold(
  abilityId: string,
  targetMaxHp: number,
): number | undefined {
  const pct =
    abilityId === 'fear'
      ? HARROW_DAMAGE_BUDGET_PCT
      : abilityId === 'howl_of_terror'
        ? DREAD_CHORUS_DAMAGE_BUDGET_PCT
        : undefined;
  if (pct === undefined) return undefined;
  return Math.max(1, Math.round(Math.max(0, targetMaxHp) * pct));
}
