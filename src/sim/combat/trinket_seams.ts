// The places the Sim coordinator consults a worn trinket, kept here so the
// coordinator carries one call each (src/sim/sim.ts is a monolith at its ceiling):
// which auras a player's own guards keep off them, which saved cooldowns a relog
// restores, and the dodge, parry or block a mob swing lands on a wearer.

import { isTrinketCooldownKey } from '../content/trinkets';
import { ABILITIES } from '../data';
import type { Aura, Entity } from '../types';
import { isUnstuckSystemCooldown } from '../unstuck_cooldown';
import { veilboundMarchBlocksAura } from './paladin_veilbound_march';
import { mooringBlocksAura } from './trinkets';

export { onTrinketAvoidance } from './trinkets';

/** Whether one of a player's own guards keeps this aura off them: the paladin's
 *  Veilbound March (roots and slows) or the Mooring Stone (every control). */
export function playerAuraGuarded(target: Entity, aura: Aura): boolean {
  return veilboundMarchBlocksAura(target, aura) || mooringBlocksAura(target, aura);
}

/** Whether a saved cooldown id is one a relog restores: an ability's, the unstuck
 *  system's, or a worn trinket's use. */
export function restorableCooldown(id: string): boolean {
  return isUnstuckSystemCooldown(id) || ABILITIES[id] !== undefined || isTrinketCooldownKey(id);
}
