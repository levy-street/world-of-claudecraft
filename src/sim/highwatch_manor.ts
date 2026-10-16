// The Highwatch manor's steward on the map (content/highwatch_manor.ts): raised at world init
// under his reserved id, only where the active world carries his record (the built-in world
// and its Studio map), and never twice.

import { HIGHWATCH_STEWARD_ENTITY_ID, HIGHWATCH_STEWARD_NPC_ID } from './content/highwatch_manor';
import { createNpc } from './entity';
import type { SimContext } from './sim_context';
import type { WorldContent } from './types';

export function spawnHighwatchSteward(ctx: SimContext, world: WorldContent): void {
  const def = world.npcs[HIGHWATCH_STEWARD_NPC_ID];
  if (!def?.dynamic) return;
  if (ctx.entities.has(HIGHWATCH_STEWARD_ENTITY_ID)) return;
  ctx.addEntity(createNpc(HIGHWATCH_STEWARD_ENTITY_ID, def, ctx.groundPos(def.pos.x, def.pos.z)));
}
