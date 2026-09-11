// Eastbrook Vale's Realm Builder monument, as a static world service.
//
// A singleton recognised by templateId rather than through a def list, so it
// needs no content table of its own. Two properties are worth stating, because
// both are easy to break and neither shows up in a screenshot:
//
// SELF-GATING. The monument only spawns into a world whose props still carry
// its record. custom_world_props.ts strips the authored-town records from a
// custom world, and a click target standing where no statue was drawn is worse
// than no target at all.
//
// NO ALLOCATOR, NO RNG. The reserved high-range entity id consumes neither
// nextId nor a draw, so every later entity id and every deterministic roll is
// untouched by adding it. This is the same rule the noticeboard follows; a
// static service that took an id from the sequence would move every parity
// golden in the suite.

import { TH_MONUMENT } from './deepglass/citadel';
import { EASTBROOK_LAYOUT } from './eastbrook_layout';
import { createGroundObject } from './entity';
import type { Entity, Vec3, ZonePropsDef } from './types';

/** The slice of the sim this spawn needs: no more of it is in scope here. */
export interface RealmBuilderMonumentSpawnHost {
  readonly entities: ReadonlyMap<number, Entity>;
  groundPos(x: number, z: number): Vec3;
  addEntity(entity: Entity): void;
}

/**
 * Spawn the monument's inspect entity, if this world is one that drew it.
 *
 * Throws on a duplicate reserved id: that means two static services claimed the
 * same slot, which is a content bug rather than anything a player can cause.
 */
export function spawnRealmBuilderMonument(
  host: RealmBuilderMonumentSpawnHost,
  props: Pick<ZonePropsDef, 'wells'>,
): void {
  const def = EASTBROOK_LAYOUT.civic.monument;
  if (!props.wells.some((well) => well.id === def.id)) return;
  spawnRealmBuilderMonumentAt(host, {
    entityId: def.entityId,
    name: def.name,
    x: def.position.x,
    z: def.position.z,
    rotation: def.rotation,
  });
}

/** One monument's inspect entity at an authored seat. Eastbrook's civic square
 *  and Tidehold's Fountain Plaza (the Deepglass world) both go through here, so
 *  every monument in every world is the same object with the same card. */
export function spawnRealmBuilderMonumentAt(
  host: RealmBuilderMonumentSpawnHost,
  seat: { entityId: number; name: string; x: number; z: number; rotation: number },
): void {
  if (host.entities.has(seat.entityId)) {
    throw new Error(`Duplicate static service entity id: ${seat.entityId}`);
  }
  const monument = createGroundObject(seat.entityId, '', seat.name, host.groundPos(seat.x, seat.z));
  monument.templateId = EASTBROOK_LAYOUT.civic.monument.templateId;
  monument.objectItemId = null;
  monument.lootable = true;
  monument.facing = seat.rotation;
  monument.prevFacing = seat.rotation;
  host.addEntity(monument);
}

/** Tidehold's monument, in the Deepglass world only (its placement is the
 *  city's; see deepglass/citadel.ts TH_MONUMENT). */
export function spawnTideholdRealmBuilderMonument(
  host: RealmBuilderMonumentSpawnHost,
  presentationMode: string | undefined,
): void {
  if (presentationMode !== 'deepglass') return;
  spawnRealmBuilderMonumentAt(host, {
    entityId: TH_MONUMENT.entityId,
    name: EASTBROOK_LAYOUT.civic.monument.name,
    x: TH_MONUMENT.x,
    z: TH_MONUMENT.z,
    rotation: TH_MONUMENT.rotY,
  });
}
