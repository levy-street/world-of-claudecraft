// The Gale Crossing (the owner's playtest of 2026-11-25): the Storm Cornice
// stands a chasm forward of the climb's head (smith_heart_layout.ts
// CORNICE_LANDING, CORNICE_WEST_CUT), so no stretch of its rim is walled or
// joined to the climb; the wind carries the raid over instead.
//
//   The pads      one on the landing's east edge, always up (out to the
//                 Cornice); one on the Cornice's west, up only while the
//                 guardian is not fighting (home to the landing), so the
//                 crossing is never a way out of the fight.
//   The ride      a body that steps onto a pad is taken up and carried on a
//                 FIXED arc (breath_isle_geometry.ts rideArc, the crossing's
//                 apex and seconds) and set down off the far pad: carried
//                 (carried_body.ts), stunned under the shipped Riding the
//                 Gale aura (a spirit rides it too, without the aura), so no
//                 input, wind, throw or fall touches it. Never a fall: the
//                 void's rules (breath_void.ts) pass over a carried body, and
//                 a ride cut short sets the body down where it meant to land.
//   Who           every living player and every spirit of the claim (a
//                 corpse run crosses it); never a dead body not yet released.
//
// Runs every tick of the claim, in the fight or out of it (breath.ts
// tickBreathGuardian calls it first). Zero rng: the riders are taken in
// entity-id order. Every visible state rides existing fields: the pad and
// carrier objects' templates, the carried pose, the riding aura, the shared
// ride cues (ISLE_CUES.rideUp, rideDown): no wire or IWorld change.

import { carryBody, setDownBody } from '../../carried_body';
import { CORNICE_CROSSING } from '../../content/smith_heart_layout';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import { CROSSING_OBJECTS as O, CROSSING_TUNING as T } from './breath_crossing_ids';
import { rideArc } from './breath_isle_geometry';
import { ISLE_AURAS, ISLE_CUES, ISLE_NAMES } from './breath_isle_ids';
import { dropFightObject, spawnFightObject } from './fight_kit';

/** The claim's object of `template`, or null. */
function objectOf(ctx: SimContext, inst: InstanceSlot, template: string): Entity | null {
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    if (e?.templateId === template) return e;
  }
  return null;
}

/** The claim's crossing pads as they should stand: the landing's always, the
 *  Cornice's home pad only while the guardian is not fighting. */
function keepPads(ctx: SimContext, inst: InstanceSlot, fighting: boolean): void {
  const C = CORNICE_CROSSING;
  if (!objectOf(ctx, inst, O.out))
    spawnFightObject(ctx, inst, O.out, ISLE_NAMES.pad, C.out.x, C.out.z, C.r);
  const home = objectOf(ctx, inst, O.home);
  if (fighting && home) dropFightObject(ctx, inst, home.id);
  else if (!fighting && !home)
    spawnFightObject(ctx, inst, O.home, ISLE_NAMES.pad, C.home.x, C.home.z, C.r);
}

/** May `p` take the crossing now: alive or a spirit, and not carried? */
function mayCross(p: Entity): boolean {
  if (p.dead && !p.ghost) return false;
  return p.carriedBy === undefined;
}

/** Carry `p` over the chasm, `dir` out (to the Cornice) or home (to the
 *  landing). Exported for the dev verb and the tests. */
export function startCrossing(
  ctx: SimContext,
  inst: InstanceSlot,
  p: Entity,
  dir: 'out' | 'home',
): boolean {
  if (!mayCross(p)) return false;
  const C = CORNICE_CROSSING;
  const o = ctx.instanceOriginOf(inst);
  const end = dir === 'out' ? C.arrive : C.back;
  const from = { x: p.pos.x - o.x, y: p.pos.y, z: p.pos.z - o.z };
  const to = { x: end.x, y: ctx.groundPos(o.x + end.x, o.z + end.z).y, z: end.z };
  const obj = spawnFightObject(ctx, inst, O.ride, ISLE_NAMES.riding, from.x, from.z, 1);
  obj.pos = { ...p.pos };
  obj.prevPos = { ...p.pos };
  obj.breathCrossing = { playerId: p.id, dir, from, to, t: 0, total: T.seconds };
  carryBody(p, obj.id);
  if (!p.ghost)
    ctx.applyAura(p, {
      id: ISLE_AURAS.riding,
      name: ISLE_NAMES.riding,
      kind: 'stun',
      remaining: T.seconds + 1,
      duration: T.seconds + 1,
      value: 0,
      sourceId: 0,
      school: 'nature',
      unbreakableControl: true,
      undispellable: true,
    });
  ctx.emit({
    type: 'spellfxAt',
    x: p.pos.x,
    z: p.pos.z,
    school: 'nature',
    fx: 'burst',
    radius: C.r,
    ability: ISLE_CUES.rideUp,
  });
  return true;
}

/** Set the rider down at its ride's end, the carrier gone. */
function land(ctx: SimContext, inst: InstanceSlot, obj: Entity, p: Entity): void {
  const r = obj.breathCrossing;
  dropFightObject(ctx, inst, obj.id);
  if (!r) return;
  const o = ctx.instanceOriginOf(inst);
  const ground = ctx.groundPos(o.x + r.to.x, o.z + r.to.z);
  p.pos.x = ground.x;
  p.pos.z = ground.z;
  setDownBody(p, ground.y);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.auras = p.auras.filter((a) => a.id !== ISLE_AURAS.riding);
  ctx.emit({
    type: 'spellfxAt',
    x: ground.x,
    z: ground.z,
    school: 'nature',
    fx: 'burst',
    radius: 3,
    ability: ISLE_CUES.rideDown,
  });
}

/** One tick of the claim's crossing (in the fight or out of it). */
export function stepCrossing(ctx: SimContext, inst: InstanceSlot, fighting: boolean): void {
  keepPads(ctx, inst, fighting);
  const o = ctx.instanceOriginOf(inst);
  // The rides first (a body set down this tick is not taken up again).
  const riding = new Set<number>();
  for (const id of [...inst.objectIds]) {
    const obj = ctx.entities.get(id);
    const r = obj?.breathCrossing;
    if (!obj || !r || obj.templateId !== O.ride) continue;
    const p = ctx.entities.get(r.playerId);
    riding.add(r.playerId);
    if (!p || p.carriedBy !== obj.id) {
      // Let go some other way (a teleport, a log-out): the carrier goes.
      dropFightObject(ctx, inst, obj.id);
      if (p) p.auras = p.auras.filter((a) => a.id !== ISLE_AURAS.riding);
      continue;
    }
    r.t = Math.min(r.total, r.t + DT);
    const at = rideArc(r.from, r.to, r.t / r.total, T.apex);
    p.pos.x = o.x + at.x;
    p.pos.y = at.y;
    p.pos.z = o.z + at.z;
    obj.prevPos = { ...obj.pos };
    obj.pos = { ...p.pos };
    ctx.rebucket(p);
    ctx.rebucket(obj);
    if (r.t + 1e-9 >= r.total) land(ctx, inst, obj, p);
  }
  // The pads take whoever steps on, in id order.
  const C = CORNICE_CROSSING;
  const out = objectOf(ctx, inst, O.out);
  const home = fighting ? null : objectOf(ctx, inst, O.home);
  const riders: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (p && !riding.has(p.id) && mayCross(p)) riders.push(p);
  }
  riders.sort((a, b) => a.id - b.id);
  for (const p of riders) {
    const lx = p.pos.x - o.x;
    const lz = p.pos.z - o.z;
    const onPad = (pad: Entity | null, c: { x: number; z: number }) =>
      pad !== null && Math.hypot(lx - c.x, lz - c.z) <= C.r && Math.abs(p.pos.y - pad.pos.y) < 3;
    if (onPad(out, C.out)) startCrossing(ctx, inst, p, 'out');
    else if (onPad(home, C.home)) startCrossing(ctx, inst, p, 'home');
  }
}
