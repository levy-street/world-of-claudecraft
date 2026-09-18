// Static ground-object construction for the Sim bootstrap. The coordinator owns
// the entity map and allocator; this module owns the validation and spawn loop so
// authored stable ids cannot silently perturb the legacy sequential roster.

import { DUNGEON_LIST, INSTANCE_SLOT_COUNT } from './data';
import { createGroundObject } from './entity';
import { freshInstanceSlot } from './instances/instance_slot';
import type { InstanceSlot } from './sim';
import type { Entity, GroundObjectDef, Vec3, WorldContent } from './types';
import { STABLE_GROUND_OBJECT_ENTITY_ID_MIN } from './types';

export interface GroundObjectSpawnDeps {
  readonly entities: ReadonlyMap<number, Entity>;
  allocateEntityId(): number;
  groundPos(x: number, z: number): Vec3;
  addEntity(entity: Entity): void;
}

export interface StaticObjectSpawnDeps extends GroundObjectSpawnDeps {
  readonly mailboxIds: number[];
  readonly instances: InstanceSlot[];
}

export function spawnGroundObjects(
  definitions: readonly GroundObjectDef[],
  deps: GroundObjectSpawnDeps,
): void {
  const stableIds = new Set<number>();
  for (const definition of definitions) {
    if (definition.entityIds && definition.entityIds.length !== definition.positions.length) {
      throw new Error(`Ground object ${definition.itemId} has mismatched stable entity ids`);
    }
    for (const entityId of definition.entityIds ?? []) {
      if (
        !Number.isSafeInteger(entityId) ||
        entityId < STABLE_GROUND_OBJECT_ENTITY_ID_MIN ||
        stableIds.has(entityId) ||
        deps.entities.has(entityId)
      ) {
        throw new Error(`Invalid or duplicate stable ground object entity id: ${entityId}`);
      }
      stableIds.add(entityId);
    }
  }

  for (const definition of definitions) {
    for (let index = 0; index < definition.positions.length; index++) {
      const position = definition.positions[index];
      const entityId = definition.entityIds?.[index] ?? deps.allocateEntityId();
      if (!Number.isSafeInteger(entityId) || entityId <= 0 || deps.entities.has(entityId)) {
        throw new Error(`Invalid or duplicate ground object entity id: ${entityId}`);
      }
      deps.addEntity(
        createGroundObject(
          entityId,
          definition.itemId,
          definition.name,
          deps.groundPos(position.x, position.z),
        ),
      );
    }
  }
}

export function spawnStaticWorldObjects(world: WorldContent, deps: StaticObjectSpawnDeps): void {
  spawnGroundObjects(world.groundObjects, deps);

  // Mailboxes are authored civic furniture, so they spawn at their exact spot
  // and never consume RNG or run through safe-position relocation.
  for (const definition of world.services?.mailboxes ?? []) {
    const mailbox = createGroundObject(
      deps.allocateEntityId(),
      '',
      'Mailbox',
      deps.groundPos(definition.x, definition.z),
    );
    mailbox.templateId = 'mailbox';
    mailbox.objectItemId = null;
    mailbox.lootable = true;
    if (definition.facing !== undefined) mailbox.facing = definition.facing;
    deps.addEntity(mailbox);
    deps.mailboxIds.push(mailbox.id);
  }

  for (const dungeon of DUNGEON_LIST) {
    if (dungeon.overworldDoor !== false) {
      const door = createGroundObject(
        deps.allocateEntityId(),
        '',
        dungeon.id === 'nythraxis_crypt' ? 'Abandoned Crypt' : dungeon.name,
        deps.groundPos(dungeon.doorPos.x, dungeon.doorPos.z),
      );
      door.templateId = 'dungeon_door';
      door.dungeonId = dungeon.id;
      door.objectItemId = null;
      door.lootable = true;
      deps.addEntity(door);
    }
    for (let slot = 0; slot < INSTANCE_SLOT_COUNT; slot++) {
      deps.instances.push(freshInstanceSlot(dungeon.id, slot));
    }
  }
}
