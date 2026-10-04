// Client-side controls for the Graveyard Shift. While the player holds the
// Morthen identity, the normal action bar and the pad's cross hotbar SHOW his
// kit in place of the saved layout, like a classic possess bar: slot 0 stays the
// Attack toggle and slots 1 to 3 cast the kit through the normal cast path, so
// every surface (desktop rows, the touch ring and radial, the cross hotbar)
// reaches it and the sim keeps every check it already had. Neither layout is
// ever written: both readers freeze their writers while an override is active.

import { MORTHEN_KIT } from '../sim/graveyard_shift/kit';
import { hasMorthenIdentity } from '../sim/graveyard_shift/morthen_identity';
import type { ActionBarOverride } from '../ui/hud/action_bar/action_bar_override_core';
import type { IWorld } from '../world_api';
import {
  CROSS_HOTBAR_ATTACK_ID,
  type CrossHotbarAction,
  type CrossHotbarLayout,
  seedCrossHotbarLayout,
} from './cross_hotbar';

type IdentityHolder = Pick<IWorld['player'], 'auras'> | undefined;

export function morthenControlsActive(world: { player?: IdentityHolder }): boolean {
  return hasMorthenIdentity(world.player);
}

const KIT_ACTIONS: readonly CrossHotbarAction[] = MORTHEN_KIT.map((def) => ({
  type: 'ability',
  id: def.id,
}));

// Built once: the readers ask every frame and compare by reference.
const ACTION_BAR_OVERRIDE: ActionBarOverride = {
  slots: KIT_ACTIONS.map((action) => (action ? { type: 'ability', id: action.id } : null)),
};
const CROSS_HOTBAR_OVERRIDE: CrossHotbarLayout = seedCrossHotbarLayout([
  { type: 'ability', id: CROSS_HOTBAR_ATTACK_ID },
  ...KIT_ACTIONS,
]);

/** The kit the action bar shows while Morthen, or null. */
export function morthenActionBarOverride(player: IdentityHolder): ActionBarOverride | null {
  return hasMorthenIdentity(player) ? ACTION_BAR_OVERRIDE : null;
}

/** The kit the cross hotbar shows and casts while Morthen, or null. */
export function morthenCrossHotbarOverride(player: IdentityHolder): CrossHotbarLayout | null {
  return hasMorthenIdentity(player) ? CROSS_HOTBAR_OVERRIDE : null;
}
