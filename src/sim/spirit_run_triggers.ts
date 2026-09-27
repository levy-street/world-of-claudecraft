// The trigger set a released spirit can walk into during its corpse run. A
// ghost does not fight, cast, or regen, but it CAN cross every world seam a
// living player can: a dungeon or raid door (to re-enter its instance and
// resurrect at the entrance), a rift portal, and a paired overworld passage
// (portals.ts). The passage matters because release picks the nearest
// graveyard by distance: a death on the Thornpeak side of the Hollow's zone
// line rises at Eldershine Rest across a sealed border, and the Duskfall
// passage is the spirit's only way back to its corpse.
//
// Same order as the living branch of the player tick (door, rift, portal), so
// a ghost standing on two overlapping triggers resolves the way a live player
// would. Draws ZERO rng. `src/sim`-pure (src/sim/CLAUDE.md).

import { updateDoorTriggers } from './instances/dungeons';
import { updatePortalTriggers } from './portals';
import { updateRiftTriggers } from './rift/runs';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

export function updateSpiritRunTriggers(ctx: SimContext, p: Entity): void {
  updateDoorTriggers(ctx, p);
  updateRiftTriggers(ctx, p);
  updatePortalTriggers(ctx, p);
}
