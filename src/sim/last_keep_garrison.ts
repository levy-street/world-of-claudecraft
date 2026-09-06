// The Last Keep garrison: the four townsfolk who bring the rebuilt castle's
// bailey to life (content/drakelands.ts DRAKELANDS_NPCS, the `dynamic: true`
// records: the waystone warden by the Wyrmgate arch, the sutler at the market
// row, the sergeant by the well, the chaplain at the chapel). They spawn from
// here, AFTER the rng-driven roster, on RESERVED ids in the singleton-NPC
// band (types.ts, the FURY precedent): the generic world-init loop allocates
// ids by iterating the merged NPC table, so a plain insertion there would
// shift the id of every camp mob and object created after it, which the
// parity goldens pin per frame. createNpc draws no rng, so this pass is
// determinism-neutral wherever the ctor calls it.
//
// Keyed on the world's own NPC table so a custom map without these records
// stands nobody up. `src/sim`-pure.

import { createNpc } from './entity';
import type { SimContext } from './sim_context';
import type { NpcDef } from './types';

export const LAST_KEEP_GARRISON_NPC_IDS = [
  'waystone_warden_ilse',
  'provisioner_dunmore',
  'sergeant_varga',
  'chaplain_ondrey',
] as const;
export type LastKeepGarrisonNpcId = (typeof LAST_KEEP_GARRISON_NPC_IDS)[number];

/** First reserved entity id; the four take consecutive slots from it. */
export const LAST_KEEP_GARRISON_ENTITY_ID_BASE = 1_000_000_010;

export function lastKeepGarrisonEntityId(npcId: LastKeepGarrisonNpcId): number {
  return LAST_KEEP_GARRISON_ENTITY_ID_BASE + LAST_KEEP_GARRISON_NPC_IDS.indexOf(npcId);
}

/** Stand the garrison up. Throws on a taken reserved id: two static services
 *  claiming one slot is a content bug, never something a player can cause. */
export function spawnLastKeepGarrison(
  ctx: Pick<SimContext, 'entities' | 'addEntity' | 'groundPos'>,
  npcs: Readonly<Record<string, NpcDef>>,
): void {
  for (const npcId of LAST_KEEP_GARRISON_NPC_IDS) {
    const def = npcs[npcId];
    if (!def) continue;
    const id = lastKeepGarrisonEntityId(npcId);
    if (ctx.entities.has(id)) throw new Error(`Duplicate static service entity id: ${id}`);
    ctx.addEntity(createNpc(id, def, ctx.groundPos(def.pos.x, def.pos.z)));
  }
}
