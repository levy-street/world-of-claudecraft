// The online client's half of the trash engine's temporary combat walls
// (src/sim/mob/trash_kit/combat_walls.ts is the authority). Nothing new rides
// the wire: each wall is a ground-object entity whose template id names its
// shape (instances/combat_wall_state.ts COMBAT_WALL_SHAPES), mirrored like any
// other entity with its position, yaw and scale. From the wall entities it
// holds, the ClientWorld rebuilds the live walls of the slot its player
// stands in and publishes them to the shared collision view, so the local
// movement prediction walls where the server walls (and a wall that shattered
// leaves the view the snapshot it leaves the entity map). Run once per
// snapshot, from the entities of the previous one (a single snapshot of lag,
// the dungeon gates' contract).
//
// DOM-free and socket-free.

import { DUNGEONS, dungeonAt, instanceOrigin, instanceSlotForZ } from '../sim/data';
import {
  type CombatWallPlacement,
  isCombatWallTemplate,
  setCombatWalls,
} from '../sim/instances/combat_wall_state';
import type { Entity } from '../sim/types';

export interface CombatWallWireWorld {
  entities: ReadonlyMap<number, Entity>;
  readonly player: Entity | undefined;
}

/** The slot this client last published walls into (it clears it when the
 *  player leaves it). Client-side mirror bookkeeping only. */
let lastSlot: { x: number; z: number } | null = null;

/** Publish the mirrored walls of the slot the player stands in. */
export function syncClientCombatWalls(world: CombatWallWireWorld): void {
  const self = world.player;
  const dungeon = self ? dungeonAt(self.pos.x) : null;
  const def = dungeon ? DUNGEONS[dungeon.id] : undefined;
  if (!self || !def) {
    if (lastSlot) setCombatWalls(lastSlot.x, lastSlot.z, []);
    lastSlot = null;
    return;
  }
  const o = instanceOrigin(def.index, instanceSlotForZ(self.pos.z));
  if (lastSlot && (lastSlot.x !== o.x || lastSlot.z !== o.z))
    setCombatWalls(lastSlot.x, lastSlot.z, []);
  lastSlot = o;
  const walls: CombatWallPlacement[] = [];
  for (const e of world.entities.values()) {
    if (e.kind !== 'object' || !isCombatWallTemplate(e.templateId)) continue;
    // Only this slot's walls (a mirrored neighbour is never in interest, but
    // the slot test keeps the publish exact).
    if (instanceSlotForZ(e.pos.z) !== instanceSlotForZ(self.pos.z)) continue;
    walls.push({
      id: e.id,
      templateId: e.templateId,
      x: e.pos.x - o.x,
      z: e.pos.z - o.z,
      y: e.pos.y,
      rot: e.facing,
      scale: e.scale,
    });
  }
  // Entity-id order: the same placement list whatever the map's insertion.
  walls.sort((a, b) => a.id - b.id);
  setCombatWalls(o.x, o.z, walls);
}
