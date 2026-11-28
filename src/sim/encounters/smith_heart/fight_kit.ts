// The plumbing the Smith's Heart's guardian fights share (the Guardian of the
// Breath's breath_scope.ts and the Guardian of the Quench's quench_scope.ts):
// who is alive, instance-local places, the quiet encounter markers on bodies,
// and the fight's own ground objects on the claim's roster. A leaf: no fight
// state, no rng.

import { createGroundObject } from '../../entity';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Aura, Entity } from '../../types';

/** A body that stands and fights (alive). */
export function living(e: Entity | null | undefined): e is Entity {
  return e !== null && e !== undefined && !e.dead && e.hp > 0;
}

/** Instance-local (x, z) of an entity. */
export function local(ctx: SimContext, inst: InstanceSlot, e: Entity): { x: number; z: number } {
  const o = ctx.instanceOriginOf(inst);
  return { x: e.pos.x - o.x, z: e.pos.z - o.z };
}

// ---- the fight's objects ----------------------------------------------------------------

/** One of the fight's objects at instance-local (x, z): on the claim's roster
 *  so a freed claim drops it with everything else. */
export function spawnFightObject(
  ctx: SimContext,
  inst: InstanceSlot,
  templateId: string,
  name: string,
  lx: number,
  lz: number,
  scale: number,
): Entity {
  const o = ctx.instanceOriginOf(inst);
  const obj = createGroundObject(ctx.nextId++, '', name, ctx.groundPos(o.x + lx, o.z + lz));
  obj.templateId = templateId;
  obj.dungeonId = inst.dungeonId;
  obj.objectItemId = null;
  obj.lootable = false;
  obj.scale = scale;
  ctx.addEntity(obj);
  inst.objectIds.push(obj.id);
  return obj;
}

/** Take one of the fight's objects out of the claim and the world. */
export function dropFightObject(ctx: SimContext, inst: InstanceSlot, id: number | null): void {
  if (id === null) return;
  const at = inst.objectIds.indexOf(id);
  if (at >= 0) inst.objectIds.splice(at, 1);
  if (ctx.entities.has(id)) ctx.dropEntity(id);
}

/** Move one of the fight's objects to instance-local (x, z). */
export function moveFightObject(
  ctx: SimContext,
  inst: InstanceSlot,
  e: Entity,
  lx: number,
  lz: number,
): void {
  const o = ctx.instanceOriginOf(inst);
  const p = ctx.groundPos(o.x + lx, o.z + lz);
  e.prevPos = { ...e.pos };
  e.pos = p;
  ctx.rebucket(e);
}

// ---- auras --------------------------------------------------------------------------------

/** An encounter marker on a player or the guardian: a quiet `internal_cd`
 *  (no stat, no speed: the fight reads it by id), never cleansed. Replaces
 *  any older one of the same id. */
export function putMarker(
  e: Entity,
  id: string,
  name: string,
  seconds: number,
  sourceId: number,
  extra: Partial<
    Pick<Aura, 'value' | 'value2' | 'value3' | 'stacks' | 'permanent' | 'school'>
  > = {},
): Aura {
  dropAura(e, id);
  const a: Aura = {
    id,
    name,
    kind: 'internal_cd',
    remaining: seconds,
    duration: seconds,
    value: 0,
    sourceId,
    school: 'nature',
    undispellable: true,
    ...extra,
  };
  e.auras.push(a);
  return a;
}

/** Drop an aura by id (no-op when absent). */
export function dropAura(e: Entity, id: string): void {
  if (e.auras.some((a) => a.id === id)) e.auras = e.auras.filter((a) => a.id !== id);
}

/** The aura of `id` on `e`, or undefined. */
export function auraOf(e: Entity, id: string): Aura | undefined {
  return e.auras.find((a) => a.id === id);
}
