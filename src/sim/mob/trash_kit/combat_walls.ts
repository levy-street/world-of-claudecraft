// The trash engine's temporary combat walls: an object a mechanic drops in
// the middle of a fight that blocks movement and line of sight for a while
// (the Ogre Sledge-Hauler's Ice Slab, TrashKitDef.toss.leavesWall). The wall
// is a ground object of the claim (Entity.kitObject kind 'wall') whose
// template id names its shape in instances/combat_wall_state.ts
// COMBAT_WALL_SHAPES; after every trash pass the claim's live walls are
// published to that per-slot collision view, which every interior collision
// reader composes (interior_collider_sets.ts), so a body slides along the
// wall and a spell, a bolt or a nova (kit_nova.ts) is stopped by it. When its
// time is up the wall shatters (a `nova` spellfx keyed on its template) and
// goes.
//
// Placement: at the spot the mechanic chose, turned to the yaw it gives. A
// body standing where the wall lands is pushed clear by the ordinary
// depenetration on its next move. Zero rng.

import { DUNGEONS, instanceOrigin } from '../../data';
import {
  type CombatWallPlacement,
  isCombatWallTemplate,
  setCombatWalls,
} from '../../instances/combat_wall_state';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import { dropKitObject, kitObjectsOf, spawnKitObject } from './kit_objects';

/** The spellfx ability id a wall's crash-down and its shatter carry (the
 *  renderer keys the look on the object's template id; this names the beat). */
export const COMBAT_WALL_RISE = 'trash_combat_wall_rise';
export const COMBAT_WALL_SHATTER = 'trash_combat_wall_shatter';

/** Drop a wall of `templateId` at (x, z), turned to `facing`, for `seconds`. */
export function spawnCombatWall(
  ctx: SimContext,
  inst: InstanceSlot,
  templateId: string,
  name: string,
  x: number,
  z: number,
  facing: number,
  seconds: number,
): Entity | null {
  if (!isCombatWallTemplate(templateId)) return null;
  const wall = spawnKitObject(ctx, inst, templateId, name, x, z, 1, facing, {
    kind: 'wall',
    remaining: seconds,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: wall.id,
    targetId: wall.id,
    school: 'frost',
    fx: 'nova',
    ability: COMBAT_WALL_RISE,
  });
  // It walls the very tick it lands (a sight check later this pass sees it).
  syncCombatWallCollision(ctx, inst, kitObjectsOf(ctx, inst, 'wall').length);
  return wall;
}

/** Count a wall down; returns true on the tick it shatters (and is gone). */
export function stepCombatWall(ctx: SimContext, inst: InstanceSlot, obj: Entity): boolean {
  const st = obj.kitObject;
  if (st?.kind !== 'wall') return false;
  st.remaining -= DT;
  if (st.remaining > 1e-9) return false;
  // A world-point burst: the wall is gone by the time the frame is routed,
  // so the event anchors where it stood (never on a dropped entity), and
  // carries its yaw and template for the renderer's shatter.
  ctx.emit({
    type: 'spellfxAt',
    x: obj.pos.x,
    z: obj.pos.z,
    school: 'frost',
    fx: 'burst',
    ability: COMBAT_WALL_SHATTER,
    radius: obj.scale,
  });
  dropKitObject(ctx, inst, obj.id);
  // The view drops it the same tick (no read later this pass sees a ghost).
  syncCombatWallCollision(ctx, inst, kitObjectsOf(ctx, inst, 'wall').length);
  return true;
}

/** The claim's live walls as the collision view takes them (object-roster
 *  order, instance-local). */
export function combatWallPlacements(
  ctx: SimContext,
  inst: InstanceSlot,
  ox: number,
  oz: number,
): CombatWallPlacement[] {
  const out: CombatWallPlacement[] = [];
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    if (!e || e.kitObject?.kind !== 'wall') continue;
    out.push({
      id: e.id,
      templateId: e.templateId,
      x: e.pos.x - ox,
      z: e.pos.z - oz,
      y: e.pos.y,
      rot: e.facing,
      scale: e.scale,
    });
  }
  return out;
}

// Publication bookkeeping (what THIS world wrote into the process-wide view,
// the dungeon gates' `writtenBy` shape; never gameplay state): the claims it
// published, and the claim (by its exit entity id) it last published EMPTY,
// so a quiet claim costs nothing until a wall stands again.
const walledBy = new WeakMap<InstanceSlot, true>();
const publishedEmpty = new WeakMap<InstanceSlot, number | null>();

/**
 * Publish one slot's live walls to the collision view. `walls` is how many
 * wall objects the claim holds (the driver's census of its objects). A claim
 * publishes on its first tick (empty or not), so whatever another world left
 * in the process-wide view for this slot is overwritten at once (the gate
 * view's rule), then again only while a wall stands or on the tick the last
 * one goes; a freed claim clears what this world published there (once). An
 * unchanged wall set is a signature compare (setCombatWalls).
 */
export function syncCombatWallCollision(ctx: SimContext, inst: InstanceSlot, walls: number): void {
  if (inst.partyKey === null) {
    if (!walledBy.has(inst)) return;
    const def = DUNGEONS[inst.dungeonId];
    if (def) {
      const o = instanceOrigin(def.index, inst.slot);
      setCombatWalls(o.x, o.z, []);
    }
    walledBy.delete(inst);
    publishedEmpty.delete(inst);
    return;
  }
  if (walls === 0 && publishedEmpty.get(inst) === inst.exitId) return;
  const def = DUNGEONS[inst.dungeonId];
  if (!def) return;
  const o = instanceOrigin(def.index, inst.slot);
  setCombatWalls(o.x, o.z, walls === 0 ? [] : combatWallPlacements(ctx, inst, o.x, o.z));
  walledBy.set(inst, true);
  if (walls === 0) publishedEmpty.set(inst, inst.exitId);
  else publishedEmpty.delete(inst);
}
