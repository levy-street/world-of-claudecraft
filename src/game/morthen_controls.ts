// Client-side routing for the Graveyard Shift bar. While the player holds the
// Morthen identity, the slot keys reach here through the vehicle bar instead of
// the action bar: slot 0 toggles auto-attack the way the action bar's Attack slot
// does, slots 1 to 5 cast the kit by id through the normal cast path, so the sim
// keeps every check it already had (known list, range, cooldown, GCD).

import { MORTHEN_ATTACK_SLOT, morthenSlotAbility } from '../sim/graveyard_shift/kit';
import { hasMorthenIdentity } from '../sim/graveyard_shift/morthen_identity';
import type { IWorld } from '../world_api';

export type MorthenControlWorld = Pick<
  IWorld,
  'player' | 'entities' | 'castAbility' | 'startAutoAttack' | 'stopAutoAttack'
>;

export function morthenControlsActive(world: {
  player?: Pick<IWorld['player'], 'auras'>;
}): boolean {
  return hasMorthenIdentity(world.player);
}

export function morthenChooseSlot(world: MorthenControlWorld, slot: number): void {
  if (!morthenControlsActive(world)) return;
  if (slot === MORTHEN_ATTACK_SLOT) {
    if (world.player.autoAttack) world.stopAutoAttack();
    else world.startAutoAttack();
    return;
  }
  const def = morthenSlotAbility(slot);
  if (def) world.castAbility(def.id);
}
