// A body going down with the Anvil's floor (docs/design/raid/smith_heart.md section
// 7.5, Jose's playtest of 1 Nov 2026: "que te puedas caer"). A fallen quarter opens from
// the wall in toward the ring, so what stands on it stands until its own stretch of
// floor has gone (hiddenCellGoes, the same timing the painter breaks the kit by), and a
// body may outrun the break to the ring. Past that there is nothing under it: it drops,
// keeping what way it had, its own locomotion stood down, and nothing can save it. It
// dies at the bottom whatever shields it, as in the Cornice's void (breath_void.ts), and
// its corpse is laid at the ring's edge, so no resurrection lands over the void.
//
// The floor's collision cannot truly open on either host, so the drop is a carried pose
// (carried_body.ts) with the body as its own carrier, so no object is needed to hold it
// and no client draws one. Its unbreakable stun stands the online client's prediction
// down, as for the Thunder's Cradle. A fight that ends mid-drop (a kill, a wipe, a reset)
// sets the body back on the ring alive: the floor it fell through is whole again.
//
// Zero rng; everything a client reads is the body's own position and its aura.

import { carryBody } from '../../carried_body';
import { HEART_ROOM } from '../../content/smith_heart_layout';
import { HEART_QUARTERS, heartQuarterAt } from '../../content/smith_heart_quarters';
import { DT, type Entity } from '../../types';
import { layOnFloor } from './breath_void';
import {
  FINAL_PHASE_AURAS as A,
  hiddenCellGoes,
  FINAL_PHASE_NAMES as N,
  FINAL_PHASES as P,
  FINAL_PHASE_CUES as Q,
} from './final_phase_ids';
import { at, cueAt, dropAura, type FinalScope, fromCentre, overTheVoid } from './final_scope';

/** The most way a body keeps from its last step (yards a second). */
const MAX_WAY = 7;
/** How much of its way a falling body keeps from tick to tick. */
const WAY_KEPT = 0.97;
/** A falling body's way stops this far short of the rim: the mountain is there. */
const RIM_MARGIN = 1;

/** Where a body at its place is laid back: the ring's edge on the same bearing. */
function ringBack(s: Pick<FinalScope, 'ctx' | 'inst'>, p: Entity): { x: number; z: number } {
  const o = s.ctx.instanceOriginOf(s.inst);
  const here = at(s, p);
  const dx = here.x - HEART_ROOM.x;
  const dz = here.z - HEART_ROOM.z;
  const d = Math.max(1e-6, Math.hypot(dx, dz));
  const r = Math.min(d, HEART_QUARTERS.ringR - 1.5);
  return { x: o.x + HEART_ROOM.x + (dx / d) * r, z: o.z + HEART_ROOM.z + (dz / d) * r };
}

/** The drop no longer holds this body. */
function letGo(p: Entity): void {
  if (p.carriedBy === p.id) p.carriedBy = undefined;
  dropAura(p, A.plunge);
}

/** A body is finished by the fall: dead whatever shields it, its corpse at the ring's
 *  edge; a real game master is set back on the ring instead. */
export function finishFall(s: FinalScope, p: Entity, name: string, from: Entity | null): void {
  letGo(p);
  const back = ringBack(s, p);
  if (p.gm || (p.profilerInvulnerable && s.ctx.devCommands)) {
    layOnFloor(s.ctx, p, back.x, back.z);
    return;
  }
  s.ctx.dealDamage(from, p, p.hp + p.maxHp * 10, false, 'physical', name, 'hit', true);
  if (!p.dead) s.ctx.handleDeath(p, from, name);
  layOnFloor(s.ctx, p, back.x, back.z);
}

/** The floor has gone from under this body. */
function beginPlunge(s: FinalScope, p: Entity): void {
  const h = s.st.phase.hidden;
  if (!h) return;
  let vx = (p.pos.x - p.prevPos.x) / DT;
  let vz = (p.pos.z - p.prevPos.z) / DT;
  const speed = Math.hypot(vx, vz);
  if (speed > MAX_WAY) {
    vx *= MAX_WAY / speed;
    vz *= MAX_WAY / speed;
  }
  carryBody(p, p.id);
  p.onGround = false;
  p.jumping = false;
  s.ctx.applyAura(p, {
    id: A.plunge,
    name: N.falling,
    kind: 'stun',
    remaining: P.plungeSeconds + 0.5,
    duration: P.plungeSeconds + 0.5,
    value: 0,
    sourceId: s.boss.id,
    school: 'physical',
    unbreakableControl: true,
    undispellable: true,
  });
  h.plunges.push({ playerId: p.id, clock: 0, fromY: p.pos.y, vx, vz });
  const here = at(s, p);
  cueAt(s, Q.bodyFall, here.x, here.z, 3, 'physical');
}

/** Every living body whose floor has gone starts to fall. */
export function stepFalls(s: FinalScope): void {
  const h = s.st.phase.hidden;
  if (!h) return;
  for (const p of s.players) {
    if (p.dead || p.ghost || p.carriedBy !== undefined) continue;
    const here = at(s, p);
    if (!overTheVoid(s, here)) continue;
    const zone = heartQuarterAt(here.x, here.z);
    if (zone === 'ring') continue;
    const since = h.clock - (h.fellAt[zone] ?? 0);
    if (since >= hiddenCellGoes(fromCentre(here)) - 1e-9) beginPlunge(s, p);
  }
}

/** Every falling body one tick further down; at the bottom, its end. */
export function stepPlunges(s: FinalScope): void {
  const h = s.st.phase.hidden;
  if (!h || h.plunges.length === 0) return;
  const o = s.ctx.instanceOriginOf(s.inst);
  const edge = HEART_QUARTERS.rimR - RIM_MARGIN;
  const still = [];
  for (const fall of h.plunges) {
    const p = s.ctx.entities.get(fall.playerId);
    if (!p) continue;
    if (p.carriedBy !== p.id) {
      dropAura(p, A.plunge);
      continue;
    }
    if (p.dead) {
      // Something else finished it on the way down.
      letGo(p);
      const back = ringBack(s, p);
      layOnFloor(s.ctx, p, back.x, back.z);
      continue;
    }
    fall.clock += DT;
    fall.vx *= WAY_KEPT;
    fall.vz *= WAY_KEPT;
    const nx = p.pos.x + fall.vx * DT;
    const nz = p.pos.z + fall.vz * DT;
    if (Math.hypot(nx - o.x - HEART_ROOM.x, nz - o.z - HEART_ROOM.z) < edge) {
      p.pos.x = nx;
      p.pos.z = nz;
    }
    p.pos.y = fall.fromY - 0.5 * P.plungeGravity * fall.clock * fall.clock;
    s.ctx.rebucket(p);
    if (fall.clock >= P.plungeSeconds - 1e-9) finishFall(s, p, N.falling, null);
    else still.push(fall);
  }
  h.plunges = still;
}

/** The fight is over, whichever way: a body on its way down is back on the ring, alive.
 *  The floor is whole again and nothing is left to fall into. */
export function clearPlunges(s: Pick<FinalScope, 'ctx' | 'inst' | 'st'>): void {
  const h = s.st.phase.hidden;
  if (!h || h.plunges.length === 0) return;
  for (const fall of h.plunges) {
    const p = s.ctx.entities.get(fall.playerId);
    if (!p) continue;
    const held = p.carriedBy === p.id;
    letGo(p);
    if (!held) continue;
    const back = ringBack(s, p);
    layOnFloor(s.ctx, p, back.x, back.z);
  }
  h.plunges = [];
}
