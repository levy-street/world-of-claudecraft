// The Wind Bridge over the chasm (Jose's call of 2026-11-25): the Storm
// Cornice stands a chasm forward of the climb's landing
// (content/smith_heart_layout.ts CORNICE_LANDING, CORNICE_WEST_CUT), and a
// CURVED current of wind spans it (CORNICE_BRIDGE; its curve
// breath_bridge_path.ts), a swirling mouth at each end.
//
//   Up            while the guardian is not fighting: its object
//                 (BRIDGE_OBJECT) stands in the claim, so every client draws
//                 the current (render/smith_heart_fx/breath_bridge_fx.ts,
//                 formed over BRIDGE_TUNING.form seconds).
//   The ride      a body that steps into either mouth (alive, or a spirit on
//                 its corpse run; never a body not yet released) is lifted
//                 and carried along the curve to the far side in
//                 `rideSeconds`, then set down softly clear of the far mouth:
//                 carried (carried_body.ts) on a carrier object, held under
//                 the shipped Riding the Gale aura (a spirit rides without
//                 it), so no input, wind, throw or fall touches it and the
//                 online client draws the server's motion (one override edge
//                 for the whole ride). Its own start blends into the curve,
//                 its set-down out of it: never a blink.
//   The pull      the object goes (the look dissolves over `dissolve`); no
//                 mouth takes anyone; a body mid-ride turns for the nearer
//                 end and is set down there, never dropped. The chasm is the
//                 void's again (breath_void.ts).
//   Back          a wipe's reset or the kill: the object returns.
//
// Ticked every tick of the claim by breath.ts tickBreathGuardian, before the
// fight's own step. Zero rng: riders in entity-id order. Every visible state
// rides existing fields (the objects, the carried pose, the riding aura, the
// cues): no wire or IWorld change.

import { carryBody, setDownBody } from '../../carried_body';
import { CORNICE_BRIDGE } from '../../content/smith_heart_layout';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import {
  BRIDGE_CUES,
  BRIDGE_OBJECT,
  BRIDGE_RIDE_OBJECT,
  BRIDGE_TUNING as T,
} from './breath_bridge_ids';
import { bridgeRidePoint } from './breath_bridge_path';
import { ISLE_AURAS, ISLE_CUES, ISLE_NAMES } from './breath_isle_ids';
import { dropFightObject, spawnFightObject } from './fight_kit';

export { BRIDGE_OBJECT, BRIDGE_RIDE_OBJECT, BRIDGE_TUNING } from './breath_bridge_ids';

/** The claim's object of `template`, or null. */
function objectOf(ctx: SimContext, inst: InstanceSlot, template: string): Entity | null {
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    if (e?.templateId === template) return e;
  }
  return null;
}

/** Is the claim's bridge standing (its object up)? */
export function bridgeUp(ctx: SimContext, inst: InstanceSlot): boolean {
  return objectOf(ctx, inst, BRIDGE_OBJECT) !== null;
}

/** May `p` take the current now: alive or a spirit, and not carried? */
function mayRide(p: Entity): boolean {
  if (p.dead && !p.ghost) return false;
  return p.carriedBy === undefined;
}

/** Which mouth instance-local (x, z) stands in, if any. Pure. */
export function bridgeMouthAt(x: number, z: number): 'landing' | 'cornice' | null {
  const B = CORNICE_BRIDGE;
  if (Math.hypot(x - B.landing.x, z - B.landing.z) <= B.mouthR) return 'landing';
  if (Math.hypot(x - B.cornice.x, z - B.cornice.z) <= B.mouthR) return 'cornice';
  return null;
}

/** Lift `p` into the current from the mouth `from`. Exported for the tests. */
export function startBridgeRide(
  ctx: SimContext,
  inst: InstanceSlot,
  p: Entity,
  from: 'landing' | 'cornice',
): boolean {
  if (!mayRide(p)) return false;
  const B = CORNICE_BRIDGE;
  const o = ctx.instanceOriginOf(inst);
  const here = { x: p.pos.x - o.x, z: p.pos.z - o.z };
  const obj = spawnFightObject(ctx, inst, BRIDGE_RIDE_OBJECT, ISLE_NAMES.riding, here.x, here.z, 1);
  obj.pos = { ...p.pos };
  obj.prevPos = { ...p.pos };
  obj.breathBridgeRide = {
    playerId: p.id,
    s: from === 'landing' ? 0 : 1,
    dir: from === 'landing' ? 1 : -1,
    atLanding: from === 'landing' ? here : { ...B.landingDrop },
    atCornice: from === 'cornice' ? here : { ...B.corniceDrop },
    floorY: p.pos.y,
  };
  carryBody(p, obj.id);
  if (!p.ghost)
    ctx.applyAura(p, {
      id: ISLE_AURAS.riding,
      name: ISLE_NAMES.riding,
      kind: 'stun',
      remaining: T.rideSeconds + 1,
      duration: T.rideSeconds + 1,
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
    radius: B.mouthR,
    ability: BRIDGE_CUES.ride,
  });
  return true;
}

/** Set the rider down at its ride's end, the carrier gone. */
function land(ctx: SimContext, inst: InstanceSlot, obj: Entity, p: Entity): void {
  const r = obj.breathBridgeRide;
  dropFightObject(ctx, inst, obj.id);
  if (!r) return;
  const o = ctx.instanceOriginOf(inst);
  const end = r.s <= 0 ? r.atLanding : r.atCornice;
  const ground = ctx.groundPos(o.x + end.x, o.z + end.z);
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

/**
 * One tick of the claim's bridge. `fighting`: the guardian is in its fight
 * (the current is gone; riders turn for the nearer end).
 */
export function stepBridge(ctx: SimContext, inst: InstanceSlot, fighting: boolean): void {
  const up = objectOf(ctx, inst, BRIDGE_OBJECT);
  if (fighting && up) dropFightObject(ctx, inst, up.id);
  else if (!fighting && !up) {
    const B = CORNICE_BRIDGE;
    spawnFightObject(
      ctx,
      inst,
      BRIDGE_OBJECT,
      '',
      (B.landing.x + B.cornice.x) / 2,
      (B.landing.z + B.cornice.z) / 2,
      1,
    );
  }
  const o = ctx.instanceOriginOf(inst);
  // The rides first (a body set down this tick is not taken up again).
  const riding = new Set<number>();
  for (const id of [...inst.objectIds]) {
    const obj = ctx.entities.get(id);
    const r = obj?.breathBridgeRide;
    if (!obj || !r || obj.templateId !== BRIDGE_RIDE_OBJECT) continue;
    const p = ctx.entities.get(r.playerId);
    riding.add(r.playerId);
    if (!p || p.carriedBy !== obj.id) {
      // Let go some other way (a teleport, a log-out): the carrier goes.
      dropFightObject(ctx, inst, obj.id);
      if (p) p.auras = p.auras.filter((a) => a.id !== ISLE_AURAS.riding);
      continue;
    }
    // The pull: turn for the nearer end (never dropped over the void), set
    // down clear of its mouth (the end only blends in over the last fifth
    // of the curve, so the change never jumps).
    if (fighting) {
      r.dir = r.s < 0.5 ? -1 : 1;
      // Only while that end does not yet blend in (else it would jump).
      if (r.dir < 0 && r.s > 0.3) r.atLanding = { ...CORNICE_BRIDGE.landingDrop };
      else if (r.dir > 0 && r.s < 0.7) r.atCornice = { ...CORNICE_BRIDGE.corniceDrop };
    }
    r.s = Math.max(0, Math.min(1, r.s + (r.dir * DT) / T.rideSeconds));
    const at = bridgeRidePoint(r.s, r.floorY, r.atLanding, r.atCornice);
    p.pos.x = o.x + at.x;
    p.pos.y = at.y;
    p.pos.z = o.z + at.z;
    obj.prevPos = { ...obj.pos };
    obj.pos = { ...p.pos };
    ctx.rebucket(p);
    ctx.rebucket(obj);
    if ((r.dir > 0 && r.s >= 1) || (r.dir < 0 && r.s <= 0)) land(ctx, inst, obj, p);
  }
  if (fighting) return;
  // The mouths take whoever steps in, in id order.
  const riders: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (p && !riding.has(p.id) && mayRide(p)) riders.push(p);
  }
  riders.sort((a, b) => a.id - b.id);
  for (const p of riders) {
    const mouth = bridgeMouthAt(p.pos.x - o.x, p.pos.z - o.z);
    // In a mouth and at its floor (never a body falling past it below).
    if (!mouth || p.pos.y < ctx.groundPos(p.pos.x, p.pos.z).y - 3) continue;
    startBridgeRide(ctx, inst, p, mouth);
  }
}
