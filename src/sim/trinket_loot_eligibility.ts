import { type TrinketUse, trinketSpec } from './content/trinkets';
import type { ItemDef, PlayerClass } from './types';

type LootRole = 'physical' | 'caster' | 'healer' | 'utility';

// Class loot suitability, not equip legality or the player's current specialization.
// Key every use kind so new effects require an explicit loot-policy decision.
const USE_ROLE: Record<TrinketUse['kind'], LootRole> = {
  retaliate: 'utility',
  anchor: 'utility',
  hourglass: 'healer',
  wellspring: 'healer',
  bleedEdge: 'physical',
  tallyStrike: 'physical',
  stormjar: 'caster',
  echo: 'caster',
  gamble: 'utility',
  blink: 'utility',
  sprint: 'utility',
  defiance: 'utility',
  brand: 'utility',
  temper: 'physical',
  kindlingOrb: 'caster',
  pierce: 'physical',
  lantern: 'healer',
  heartNova: 'utility',
};

/** Effects can carry a role even when the item's only stat is Spirit or Stamina. */
export function trinketLootFitsClass(cls: PlayerClass, item: ItemDef): boolean {
  if (item.slot !== 'trinket') return true;
  const spec = trinketSpec(item.heroicOf ?? item.id);
  if (!spec) return true;
  const role = USE_ROLE[spec.use.kind];
  if (role === 'physical') return cls !== 'mage' && cls !== 'priest' && cls !== 'warlock';
  if (role === 'caster' || role === 'healer') {
    if (cls === 'warrior' || cls === 'rogue' || cls === 'hunter') return false;
    // Mage's Chronomancy specialization heals; Warlock has no healer specialization.
    return role !== 'healer' || cls !== 'warlock';
  }
  return true;
}
