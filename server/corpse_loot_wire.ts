// The corpse-loot bits of an entity's dynamic wire record: everything the
// online corpse cue and picker (src/sim/corpse_loot_state.ts,
// src/game/corpse_loot_availability.ts) need to answer "what does this body
// offer ME" exactly as the offline Sim does. Each key rides only while set, so
// an ordinary entity serializes as before any of them existed, and the dynamic
// record is re-sent whole, so an absent key means unset. Written into
// dynamicFields (server/game.ts) in this key order; src/net/corpse_loot_wire.ts
// is the decode side. Keep the keys byte-identical on both sides.
//
// - `tap`: the tapper (loot owner) pid.
// - `hcb`: the corpse harvest claim (single-use, first-come): the online
//   picker must stop offering a corpse another player already harvested.
// - `ffa`: the loot owner-lock lapse: the online picker must offer a
//   stranger's aged-out corpse again for a deliberate manual loot, the same
//   reliability contract hcb gives harvest claims. Flips once per corpse, so
//   the per-entity dyn cache re-serializes exactly one changed record.
// - `cd`: the corpse decayed.
// - `bll`: a per-boss raid corpse's lock (src/sim/loot/boss_loot_lock.ts):
//   `{ id: lockId, f: freshIds }`. Viewer-independent on purpose (the dyn
//   cache serializes a record once for every viewer); each client answers its
//   OWN denial from it plus its mirrored lockouts (IWorld.corpseBossLootDenied).
//   Rides only on a lootable per-boss raid boss corpse, a handful per raid
//   claim, set once at the death and never mutated after, so it costs nothing
//   on any other entity and re-serializes nothing per tick.
import { lootHasGoneFfa } from '../src/sim/loot/loot_ffa';
import { corpseHasDecayed } from '../src/sim/respawn_policy';
import type { Entity } from '../src/sim/types';

/** Every key this emitter may write, in emit order, for the unit pin. */
export const CORPSE_LOOT_WIRE_KEYS = ['tap', 'hcb', 'ffa', 'cd', 'bll'] as const;

export function writeCorpseLootWire(e: Entity, out: Record<string, unknown>): void {
  if (e.tappedById !== null) out.tap = e.tappedById;
  if (e.harvestClaimedBy !== null) out.hcb = e.harvestClaimedBy;
  if (e.kind === 'mob' && e.lootable && lootHasGoneFfa(e.lootFfaTimer)) out.ffa = 1;
  if (e.kind === 'mob' && corpseHasDecayed(e.dead, e.corpseTimer)) out.cd = 1;
  if (e.bossLootLock && e.lootable) {
    out.bll = { id: e.bossLootLock.lockId, f: e.bossLootLock.freshIds };
  }
}
