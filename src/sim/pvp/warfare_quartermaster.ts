// Warmarshal Draven Kole, the Highwatch Master of the Warfare Stores: the
// explicit world-init spawn for the WARFARE honor vendor.
//
// He is authored as an ordinary NpcDef in content/zone3.ts with `dynamic: true`,
// which makes the generic world-init NPC loop skip him. That loop allocates
// entity ids by walking the merged NPC table in insertion order, and zone 3's
// NPCs sit early in that table, so letting him through would shift the id of
// every NPC, camp mob and ground object created after him. The parity goldens
// pin `nextId` (and every player pid) per frame, so that shift alone would red
// all of them without a single behavioural change.
//
// Instead the Sim ctor calls the spawn below, after the rng-drawing camp loop,
// with a point resolved through the SAME rng-free findSafePos path the generic
// loop uses (pure geometry over groundHeight and resolvePosition). The result:
// neither the id counter nor the shared rng stream moves, which
// tests/warfare_vendor_npc.test.ts asserts directly against a world built
// without the def.
//
// The reserved id follows the two singletons that already exist:
// VALE_CUP_BRAM_ID is 1_000_000_000 and FURY_ENTITY_ID is 1_000_000_001, so
// this takes 1_000_000_002. STATIC_WORLD_SERVICE_ENTITY_ID_MIN (types.ts) is
// 2_000_000_001, so the singleton band still has room, and nextId grows by
// roughly one per mob respawn, so reaching 1e9 sequentially is unrealizable.

import { createNpc } from '../entity';
import type { SimContext } from '../sim_context';
import type { NpcDef } from '../types';

/** Content key of the Highwatch WARFARE quartermaster (content/zone3.ts). */
export const WARFARE_QUARTERMASTER_NPC_ID = 'warmarshal_draven_kole';

/** His RESERVED entity id, outside the sequential nextId allocation (see above). */
export const WARFARE_QUARTERMASTER_ENTITY_ID = 1_000_000_002;

/**
 * Spawn the Highwatch WARFARE quartermaster under his reserved id.
 *
 * The caller supplies the ACTIVE world's definition and a `safe` point already
 * resolved through `findSafePos`, so a custom map cannot leak the builtin
 * placement and he can never spawn inside water or a building. Idempotent: a
 * second call with the entity already present is a no-op.
 */
export function spawnWarfareQuartermaster(
  ctx: SimContext,
  def: NpcDef,
  safe: { x: number; z: number },
): void {
  if (ctx.entities.has(WARFARE_QUARTERMASTER_ENTITY_ID)) return;
  const npc = createNpc(WARFARE_QUARTERMASTER_ENTITY_ID, def, ctx.groundPos(safe.x, safe.z));
  ctx.addEntity(npc);
}
