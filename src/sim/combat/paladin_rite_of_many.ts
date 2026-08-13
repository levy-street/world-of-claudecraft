// Recall the Fallen scales with the healer who learned it: from level 16 a
// Sunmender's rite answers for the whole group instead of the one body it was
// begun over. Protection and Retribution keep the single-target rite forever.
//
// One button, not two: the cast, the target and the corpse walk are identical, so
// the spec upgrade shows up as "everyone stands" rather than a second
// resurrection icon appearing on the bar at 16.
//
// A pure predicate so a Vitest can pin the spec and level edges without standing
// up a party; the caller (combat/effect_dispatch.ts) picks the resurrection path.
export const RITE_OF_MANY_LEVEL = 16;
export const RITE_OF_MANY_ABILITY_ID = 'recall_the_fallen';

export function riteAnswersTheWholeGroup(
  abilityId: string,
  spec: string | null | undefined,
  level: number,
): boolean {
  return abilityId === RITE_OF_MANY_ABILITY_ID && spec === 'holy' && level >= RITE_OF_MANY_LEVEL;
}
