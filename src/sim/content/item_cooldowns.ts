import { GOURDLIGHT_TOYS } from './gourdlight_eve';

export const ITEM_BASE_COOLDOWNS: Readonly<Record<string, number>> = Object.freeze({
  allied_hearthstone: 900,
  rift_feather_glider: 120,
  clockwork_target_dummy: 300,
  dawn_battle_standard: 300,
  clockwork_shock_bomb: 60,
  potion_of_invisibility: 120,
  firebottle: 5,
  // Gourdlight Eve's toys (content/gourdlight_eve.ts GOURDLIGHT_TOYS: the sim sets the
  // same seconds on p.cooldowns under the item id)
  ...Object.fromEntries(GOURDLIGHT_TOYS.map((toy) => [toy.itemId, toy.cooldown])),
});

export function getItemCooldownDuration(itemId: string): number {
  return ITEM_BASE_COOLDOWNS[itemId] ?? 0;
}
