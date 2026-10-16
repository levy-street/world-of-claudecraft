// The Sledge Road's ice outcrops (sledge_tusker.ts): five fangs of the Quench
// on the road's rim that a Trample can be baited into. Each is an encounter
// object of the claim whose template id carries its state:
//
//   whole    it stands; a Trample lane that touches it runs into it.
//   struck   the Tusker's tusks are buried in it (its cast bar counts the
//            seconds it holds the beast).
//   broken   a stump: the beast wrenched free and burst it. It takes no more
//            charges this pull.
//
// They are raised once per claim, while its Tusker lives, the first time a
// living player comes within `outcropWake` of one (the Gate Landing is close
// enough, and every yard of the road the Tusker walks is), so a group walking
// the road sees them before the pull and a run that never comes near mints
// nothing (never at the claim itself, and never off a pull from afar: a
// patrol that picks a target across the cirque is no reason to raise them). A pull that ends without a kill (an evade, a wipe) stands every
// one of them up again; once the Tusker is dead they stay as they fell.
//
// Deterministic and draw-free: they stand on fixed spots (ids.ts
// TUSKER_OUTCROPS), in that order, and are found again by scanning the
// claim's object roster for their templates, so nothing is kept on the fight
// state and a view that joins late reads the same road.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import { claimPlayers, spawnSanctumObject } from './claim';
import {
  isIceOutcrop,
  SANCTUM_ICE_OUTCROP,
  SANCTUM_ICE_OUTCROP_BROKEN,
  SANCTUM_ICE_OUTCROP_STRUCK,
  SANCTUM_OUTCROP_HELD,
  TUSKER_TUNING as T,
  TUSKER_OUTCROPS,
} from './ids';
import type { OutcropSpot } from './tusker_road';

/** The claim's outcrop objects, in roster (TUSKER_OUTCROPS) order. */
export function outcropObjects(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const out: Entity[] = [];
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    if (e && isIceOutcrop(e.templateId)) out.push(e);
  }
  return out;
}

/** Is a living player of the claim near enough the road to wake them? */
function roadWatched(ctx: SimContext, inst: InstanceSlot): boolean {
  const o = ctx.instanceOriginOf(inst);
  const r2 = T.outcropWake * T.outcropWake;
  for (const p of claimPlayers(ctx, inst))
    for (const spot of TUSKER_OUTCROPS) {
      const dx = p.pos.x - (o.x + spot.x);
      const dz = p.pos.z - (o.z + spot.z);
      if (dx * dx + dz * dz <= r2) return true;
    }
  return false;
}

/** Raise the five outcrops, whole, if this claim has none yet and a player
 *  is near the road. */
export function ensureOutcrops(ctx: SimContext, inst: InstanceSlot): void {
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    if (e && isIceOutcrop(e.templateId)) return;
  }
  if (!roadWatched(ctx, inst)) return;
  const o = ctx.instanceOriginOf(inst);
  for (const spot of TUSKER_OUTCROPS) {
    const obj = spawnSanctumObject(
      ctx,
      inst,
      SANCTUM_ICE_OUTCROP,
      'Ice Outcrop',
      o.x + spot.x,
      o.z + spot.z,
      T.outcropRadius,
    );
    // Scenery of the fight, never loot: the generic ground-object pass turns
    // a spent object lootable again once its respawn clock runs out, and a
    // lootable object is drawn as loot.
    obj.respawnTimer = Number.POSITIVE_INFINITY;
  }
}

/** The outcrops a lane can still run into (whole), instance-local. */
export function standingOutcrops(ctx: SimContext, inst: InstanceSlot): OutcropSpot[] {
  const o = ctx.instanceOriginOf(inst);
  const out: OutcropSpot[] = [];
  for (const e of outcropObjects(ctx, inst))
    if (e.templateId === SANCTUM_ICE_OUTCROP)
      out.push({ id: e.id, x: e.pos.x - o.x, z: e.pos.z - o.z });
  return out;
}

function stopClock(obj: Entity): void {
  if (obj.castingAbility === null) return;
  obj.castingAbility = null;
  obj.castRemaining = 0;
  obj.castTotal = 0;
  obj.castTargetId = null;
}

/** The tusks go in: the outcrop is struck, its bar the seconds it holds. */
export function strikeOutcrop(ctx: SimContext, outcropId: number, tuskerId: number): void {
  const obj = ctx.entities.get(outcropId);
  if (!obj || !isIceOutcrop(obj.templateId)) return;
  obj.templateId = SANCTUM_ICE_OUTCROP_STRUCK;
  holdOutcrop(obj, T.stuckSeconds, tuskerId);
}

/** Keep a struck outcrop's bar on the seconds the beast is still held. */
export function holdOutcrop(obj: Entity, left: number, tuskerId: number): void {
  obj.castingAbility = SANCTUM_OUTCROP_HELD;
  obj.castTotal = T.stuckSeconds;
  obj.castRemaining = Math.max(0, left);
  obj.castTargetId = tuskerId;
  obj.channeling = false;
}

/** The beast wrenches free (or falls with its tusks still in): the outcrop
 *  bursts and stays a stump. */
export function breakOutcrop(ctx: SimContext, outcropId: number): void {
  const obj = ctx.entities.get(outcropId);
  if (!obj || !isIceOutcrop(obj.templateId)) return;
  obj.templateId = SANCTUM_ICE_OUTCROP_BROKEN;
  stopClock(obj);
}

/** A pull that ended without a kill: every outcrop stands whole again. */
export function restoreOutcrops(ctx: SimContext, inst: InstanceSlot): void {
  for (const obj of outcropObjects(ctx, inst)) {
    if (obj.templateId !== SANCTUM_ICE_OUTCROP) obj.templateId = SANCTUM_ICE_OUTCROP;
    stopClock(obj);
  }
}

/** Outcrops still whole (the baits the pull has left). */
export function outcropsStanding(ctx: SimContext, inst: InstanceSlot): number {
  let n = 0;
  for (const e of outcropObjects(ctx, inst)) if (e.templateId === SANCTUM_ICE_OUTCROP) n++;
  return n;
}
