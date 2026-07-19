// Pure decision core for the one-time Hunter utility-kit hotbar migration.
// Storage ownership and slot mutation stay with Hud; this module only identifies
// which known utility abilities may fill existing empty slots.

export const HUNTER_UTILITY_KIT = [
  'hunters_mark',
  'disengage',
  'aspect_of_the_cheetah',
  'aspect_of_the_turtle',
  'exhilaration',
  'feign_death',
  'freezing_trap',
] as const;

export function hunterUtilityMigrationIds(
  playerClass: string,
  form: string,
  knownAbilityIds: readonly string[],
  migrated: boolean,
): string[] {
  if (migrated || playerClass !== 'hunter' || form !== 'normal') return [];
  const known = new Set(knownAbilityIds);
  return HUNTER_UTILITY_KIT.filter((id) => known.has(id));
}
