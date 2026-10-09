// The trash engine's encounter objects (Entity.kitObject): the hazard pools
// (kit_hazard.ts), the temporary combat walls (combat_walls.ts) and the
// walkers (kit_walker.ts) are ground objects of the claim the client mirrors
// like any other, their template id carrying their look, `scale` their size
// and `facing` their yaw. This leaf spawns and drops them and runs the one
// per-tick pass over a claim's live engine objects (after its mobs, from
// driver.ts), in object-roster order.
//
// Zero rng here; the only draws are a hazard's or a walker's damage rolls,
// made by their own modules in roster order.

import { createGroundObject } from '../../entity';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity, KitObjectState } from '../../types';

/** Spawn one engine object of `templateId` on the floor at (x, z). */
export function spawnKitObject(
  ctx: SimContext,
  inst: InstanceSlot,
  templateId: string,
  name: string,
  x: number,
  z: number,
  scale: number,
  facing: number,
  state: KitObjectState,
): Entity {
  const obj = createGroundObject(ctx.nextId++, '', name, ctx.groundPos(x, z));
  obj.templateId = templateId;
  obj.dungeonId = inst.dungeonId;
  obj.objectItemId = null;
  obj.lootable = false;
  obj.facing = facing;
  obj.prevFacing = facing;
  obj.scale = scale;
  obj.kitObject = state;
  ctx.addEntity(obj);
  inst.objectIds.push(obj.id);
  return obj;
}

/** Take an engine object out of the claim and the world. */
export function dropKitObject(ctx: SimContext, inst: InstanceSlot, id: number): void {
  const at = inst.objectIds.indexOf(id);
  if (at >= 0) inst.objectIds.splice(at, 1);
  if (ctx.entities.has(id)) ctx.dropEntity(id);
}

/** The claim's live engine objects of one kind, in object-roster order. */
export function kitObjectsOf<K extends KitObjectState['kind']>(
  ctx: SimContext,
  inst: InstanceSlot,
  kind: K,
): Entity[] {
  const out: Entity[] = [];
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    if (e?.kitObject?.kind === kind) out.push(e);
  }
  return out;
}

/** The claim's live engine object ids in object-roster order, or null when
 *  it holds none (one walk of the object roster a tick, no allocation then):
 *  the driver's early out, and its snapshot for the pass (a pool may lift
 *  mid-pass). */
export function kitObjectIds(ctx: SimContext, inst: InstanceSlot): number[] | null {
  let ids: number[] | null = null;
  for (const id of inst.objectIds) {
    if (!ctx.entities.get(id)?.kitObject) continue;
    ids ??= [];
    ids.push(id);
  }
  return ids;
}
