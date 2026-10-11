export const ITEM_BASE_COOLDOWNS: Readonly<Record<string, number>> = Object.freeze({
  allied_hearthstone: 900,
  rift_feather_glider: 120,
  clockwork_target_dummy: 300,
  dawn_battle_standard: 300,
  clockwork_shock_bomb: 60,
  potion_of_invisibility: 120,
  firebottle: 5,
});

export function getItemCooldownDuration(itemId: string): number {
  return ITEM_BASE_COOLDOWNS[itemId] ?? 0;
}
