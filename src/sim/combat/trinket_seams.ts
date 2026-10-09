// The places the Sim coordinator consults a worn trinket, kept here so the
// coordinator carries one call each (src/sim/sim.ts is a monolith at its ceiling):
// which auras a guard keeps off their target (a player's own guards, and an
// encounter's control rules on a mob), which saved cooldowns a relog
// restores, and the dodge, parry or block a mob swing lands on a wearer.

import { isTrinketCooldownKey } from '../content/trinkets';
import { ABILITIES } from '../data';
import { wildheartControlBlocks } from '../encounters/wildheart_basin/control_gate';
import type { Aura, Entity } from '../types';
import { isUnstuckSystemCooldown } from '../unstuck_cooldown';
import { veilboundMarchBlocksAura } from './paladin_veilbound_march';
import { mooringBlocksAura } from './trinkets';

export { onTrinketAvoidance } from './trinkets';

/** Whether a guard keeps this aura off its target: a player's own (the
 *  paladin's Veilbound March on roots and slows, the Mooring Stone on every
 *  control) or the Wildheart Basin's control rules on its jaguars (one of each
 *  control kind per window; half-length stuns on Zulgar's hunting avatar). */
export function auraGuarded(target: Entity, aura: Aura): boolean {
  return (
    veilboundMarchBlocksAura(target, aura) ||
    mooringBlocksAura(target, aura) ||
    wildheartControlBlocks(target, aura)
  );
}

/** Whether a saved cooldown id is one a relog restores: an ability's, the unstuck
 *  system's, or a worn trinket's use. */
export function restorableCooldown(id: string): boolean {
  return isUnstuckSystemCooldown(id) || ABILITIES[id] !== undefined || isTrinketCooldownKey(id);
}
