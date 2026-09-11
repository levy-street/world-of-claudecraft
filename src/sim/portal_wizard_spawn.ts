// Spawners for Baldemar the Bald's selves. Split from portal_wizard.ts (pure
// data, imported by data.ts) because createNpc lives in entity.ts, which
// imports data.ts: the same cycle-avoiding split as deepglass/world.ts and
// deepglass/steward.ts.

import { createNpc } from './entity';
import {
  DEEPGLASS_PORTAL_WIZARD_ENTITY_ID,
  PORTAL_WIZARD_BASE_ENTITY_ID,
  PORTAL_WIZARD_STOPS,
} from './portal_wizard';
import type { SimContext } from './sim_context';
import type { NpcDef } from './types';

/**
 * Spawn every town self. Runs after the rng-drawing world roster, takes its
 * ground truth through the caller's findSafePos (Goldcrest's ground only
 * exists once the city map document is loaded, same as the steward).
 */
export function spawnTownPortalWizards(
  ctx: SimContext,
  npcs: Record<string, NpcDef>,
  findSafe: (x: number, z: number) => { x: number; z: number },
): void {
  PORTAL_WIZARD_STOPS.forEach((stop, i) => {
    const def = npcs[stop.npcId];
    if (!def) return;
    const id = PORTAL_WIZARD_BASE_ENTITY_ID + i;
    if (ctx.entities.has(id)) return;
    const safe = findSafe(def.pos.x, def.pos.z);
    ctx.addEntity(createNpc(id, def, ctx.groundPos(safe.x, safe.z)));
  });
}

/** Spawn the self waiting at the bell. Arena worlds only; no findSafePos, the
 *  terrace is authored dead flat (see deepglass/steward.ts on the marshal). */
export function spawnDeepglassPortalWizard(ctx: SimContext, def: NpcDef): void {
  if (ctx.entities.has(DEEPGLASS_PORTAL_WIZARD_ENTITY_ID)) return;
  const npc = createNpc(
    DEEPGLASS_PORTAL_WIZARD_ENTITY_ID,
    def,
    ctx.groundPos(def.pos.x, def.pos.z),
  );
  ctx.addEntity(npc);
}
