// The Sledge Tusker (docs/design/dungeon-rework/gravewyrm_sanctum.md section
// 5.3): the Sledge Road's showpiece patrol, a shaggy mountain tusker as big as
// a house dragging a sledge of burning soul braziers up and down the haul road.
// Its kit, on top of its melee:
//
//   Tusk Sweep        every 12 s a 1.5 s bar, then its tusks sweep a frontal
//                     120 degree cone 10 yd past its body: 180 to 220 and an
//                     8 yd knockback. The cone stays where the bar was drawn.
//   Trample           every 16 s a 2 s bar paints a lane 30 yd long toward the
//                     farthest player (stopping short of a drop), then it
//                     charges down it: everyone in the lane when the bar ends
//                     takes 200 to 240 and a 1 s knockdown.
//   Spilled Braziers  it unhitches its sledge where it is pulled; at half health
//                     the sledge tips and three soulfire patches (4 yd) burn on
//                     the road where its braziers land, for 10 s, 36 to 44 a
//                     second to anyone inside.
//   Enrage            under a fifth of its health: 30 percent more damage.
//
// Killed with no one ever hit by its Trample, it grants the Cold Cargo deed
// (`dgn_sledge_tusker`) to the claim.
//
// On its death the first plate of ice falls from the Calving Face (story.ts
// reads the dead Tusker; the face is render only).
//
// Deterministic: no pick is rolled (the cone and the lane take everyone inside,
// the lane's victim is the farthest player with ties to the lower id, the
// patches stand on fixed spots behind it); the only rng draws are the damage
// rolls, in claim-player order. Every visible state rides existing entity
// fields (the cast bar, a locked facing, the enrage aura, the patch objects, a
// `nova` spellfx at the spill), so the online client mirrors it with no wire
// change.

import { GRAVEWYRM_SANCTUM_FIELD } from '../../content/gravewyrm_sanctum_layout';
import { authoredFieldHeight } from '../../instances/authored_field';
import { applyKnockback } from '../../knockback';
import { inLane } from '../../mob/trash_kit/lane';
import { inCone } from '../../mob/trash_kit/targets';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity, type TuskerFightState } from '../../types';
import {
  claimPlayers,
  clearCastIf,
  dropEncounterObject,
  grantClaimDeed,
  holdPlanted,
  mechanicDamage,
  spawnSanctumObject,
  startBar,
} from './claim';
import {
  SANCTUM_DEED_IDS,
  SANCTUM_SOULFIRE_PATCH,
  TUSKER_TUNING as T,
  TUSKER_ENRAGE,
  TUSKER_KNOCKDOWN,
  TUSKER_SPILL_LOG,
  TUSKER_SPILLED_BRAZIERS,
  TUSKER_TRAMPLE,
  TUSKER_TUSK_SWEEP,
} from './ids';

/** The Tusker's drawn body radius (its template bodyRadius): the sweep's
 *  reach is measured from its edge. */
const BODY = 3.5;
/** A step along the Trample lane that drops (or climbs) more than this is the
 *  edge of the road: the lane stops short of it. */
const LANE_EDGE = 1.5;

function freshState(timers = true): TuskerFightState {
  return {
    kind: 'tusker',
    sweepTimer: timers ? T.sweepFirst : 99,
    trampleTimer: timers ? T.trampleFirst : 99,
    sweepYaw: null,
    lane: null,
    charge: null,
    plantedAt: null,
    sledge: null,
    spilled: false,
    patches: [],
    enraged: false,
    trampleLanded: false,
    deedDone: false,
    casts: 0,
  };
}

/** The Tusker's fight state, started on its first engaged tick (a dev trigger
 *  starts it with its clocks parked, so only the triggered mechanic fires). */
export function tuskerState(tusker: Entity, timers = true): TuskerFightState {
  if (tusker.sanctumFight?.kind !== 'tusker') tusker.sanctumFight = freshState(timers);
  return tusker.sanctumFight;
}

/** How far the Trample lane runs from (x, z) along `yaw` before the road
 *  ends (a cliff or the crevasse), instance-local, at most `max` yards. */
export function trampleReach(x: number, z: number, yaw: number, max: number): number {
  const ax = Math.sin(yaw);
  const az = Math.cos(yaw);
  let prev = authoredFieldHeight(GRAVEWYRM_SANCTUM_FIELD, x, z);
  let len = 0;
  for (let d = 1; d <= max; d++) {
    const h = authoredFieldHeight(GRAVEWYRM_SANCTUM_FIELD, x + ax * d, z + az * d);
    if (Math.abs(h - prev) > LANE_EDGE) break;
    prev = h;
    len = d;
  }
  return len;
}

/** The living player standing farthest from the Tusker (ties to the lower id). */
function farthest(players: readonly Entity[], from: Entity): Entity | null {
  let best: Entity | null = null;
  let bestD = -1;
  for (const p of players) {
    if (p.dead) continue;
    const d = dist2d(p.pos, from.pos);
    if (d > bestD + 1e-9) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** Start a Tusk Sweep in front of it. Returns true when it started. */
export function startTuskSweep(tusker: Entity, st: TuskerFightState): boolean {
  if (tusker.castingAbility !== null || st.charge) return false;
  st.sweepYaw = tusker.facing;
  st.sweepTimer = T.sweepEvery;
  st.casts++;
  st.plantedAt = { ...tusker.pos };
  startBar(tusker, TUSKER_TUSK_SWEEP, T.sweepCast, null);
  return true;
}

/** Paint a Trample lane to the farthest player. Returns true when it started. */
export function startTrample(
  ctx: SimContext,
  inst: InstanceSlot,
  tusker: Entity,
  st: TuskerFightState,
): boolean {
  if (tusker.castingAbility !== null || st.charge) return false;
  const victim = farthest(claimPlayers(ctx, inst), tusker);
  if (!victim) return false;
  const o = ctx.instanceOriginOf(inst);
  const x = tusker.pos.x - o.x;
  const z = tusker.pos.z - o.z;
  const yaw = Math.atan2(victim.pos.x - tusker.pos.x, victim.pos.z - tusker.pos.z);
  st.lane = { x, z, yaw, length: trampleReach(x, z, yaw, T.trampleLength) };
  st.trampleTimer = T.trampleEvery;
  st.casts++;
  st.plantedAt = { ...tusker.pos };
  tusker.facing = yaw;
  startBar(tusker, TUSKER_TRAMPLE, T.trampleCast, victim.id);
  ctx.emit({
    type: 'spellfx',
    sourceId: tusker.id,
    targetId: victim.id,
    school: 'physical',
    fx: 'windup',
    ability: TUSKER_TRAMPLE,
  });
  return true;
}

/** The tusks land: everyone in the frontal cone is struck and thrown. Returns
 *  how many it struck. */
function landTuskSweep(
  ctx: SimContext,
  inst: InstanceSlot,
  tusker: Entity,
  st: TuskerFightState,
): number {
  const yaw = st.sweepYaw ?? tusker.facing;
  st.sweepYaw = null;
  ctx.emit({
    type: 'spellfx',
    sourceId: tusker.id,
    targetId: tusker.id,
    school: 'physical',
    fx: 'nova',
    ability: TUSKER_TUSK_SWEEP,
  });
  let n = 0;
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead || !inCone(tusker.pos, yaw, p.pos, T.sweepRange + BODY, T.sweepArcDeg)) continue;
    ctx.dealDamage(
      tusker,
      p,
      mechanicDamage(ctx, tusker, T.sweepMin, T.sweepMax),
      false,
      'physical',
      'Tusk Sweep',
      'hit',
      true,
    );
    if (!p.dead) applyKnockback(ctx, tusker, p, T.sweepKnockback);
    n++;
  }
  return n;
}

/** The bar ran out: everyone in the lane is run over, and the charge sets
 *  off down it. Returns how many it struck. */
function launchTrample(
  ctx: SimContext,
  inst: InstanceSlot,
  tusker: Entity,
  st: TuskerFightState,
): number {
  const lane = st.lane;
  st.lane = null;
  if (!lane) return 0;
  st.charge = { ...lane, t: 0, hit: [] };
  const o = ctx.instanceOriginOf(inst);
  ctx.emit({
    type: 'spellfx',
    sourceId: tusker.id,
    targetId: tusker.id,
    school: 'physical',
    fx: 'nova',
    ability: TUSKER_TRAMPLE,
  });
  let n = 0;
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead) continue;
    const px = p.pos.x - o.x;
    const pz = p.pos.z - o.z;
    if (!inLane(lane.x, lane.z, lane.yaw, lane.length + BODY, T.trampleHalfWidth, px, pz)) continue;
    ctx.dealDamage(
      tusker,
      p,
      mechanicDamage(ctx, tusker, T.trampleMin, T.trampleMax),
      false,
      'physical',
      'Trample',
      'hit',
      true,
    );
    st.trampleLanded = true;
    st.charge.hit.push(p.id);
    n++;
    if (p.dead) continue;
    ctx.applyAura(p, {
      id: TUSKER_KNOCKDOWN,
      name: 'Knocked Down',
      kind: 'stun',
      remaining: T.knockdown,
      duration: T.knockdown,
      value: 0,
      sourceId: tusker.id,
      school: 'physical',
    });
  }
  return n;
}

/** The charge in flight: run the Tusker down its lane. */
function stepCharge(
  ctx: SimContext,
  inst: InstanceSlot,
  tusker: Entity,
  st: TuskerFightState,
): void {
  const c = st.charge;
  if (!c) return;
  c.t += DT;
  const k = Math.min(1, c.t / T.trampleRun);
  const o = ctx.instanceOriginOf(inst);
  const at = ctx.groundPos(
    o.x + c.x + Math.sin(c.yaw) * c.length * k,
    o.z + c.z + Math.cos(c.yaw) * c.length * k,
  );
  holdPlanted(ctx, tusker, at);
  tusker.facing = c.yaw;
  tusker.swingTimer = Math.max(tusker.swingTimer, 0.6);
  if (k >= 1) st.charge = null;
}

/** Spilled Braziers: the sledge tips (once per pull) and three soulfire patches
 *  burn on the road behind it. */
export function spillBraziers(
  ctx: SimContext,
  inst: InstanceSlot,
  tusker: Entity,
  st: TuskerFightState,
): void {
  st.spilled = true;
  ctx.emit({
    type: 'spellfx',
    sourceId: tusker.id,
    targetId: tusker.id,
    school: 'shadow',
    fx: 'nova',
    ability: TUSKER_SPILLED_BRAZIERS,
  });
  ctx.emit({ type: 'log', text: TUSKER_SPILL_LOG, color: '#b58cff', entityId: tusker.id });
  const o = ctx.instanceOriginOf(inst);
  // The sledge waits where it was unhitched, in the frame the Tusker stood in.
  const at = st.sledge ?? { x: tusker.pos.x, z: tusker.pos.z, yaw: tusker.facing };
  const f = at.yaw;
  // Its forward is (sin f, cos f); its left a quarter turn anticlockwise.
  const fx = Math.sin(f);
  const fz = Math.cos(f);
  const lx = at.x - o.x;
  const lz = at.z - o.z;
  const home = authoredFieldHeight(GRAVEWYRM_SANCTUM_FIELD, lx, lz);
  for (const spot of T.patchSpots) {
    const dx = fx * spot.fwd + fz * spot.left;
    const dz = fz * spot.fwd - fx * spot.left;
    // A spot off the road's edge burns at half the distance instead.
    let x = lx + dx;
    let z = lz + dz;
    if (Math.abs(authoredFieldHeight(GRAVEWYRM_SANCTUM_FIELD, x, z) - home) > 3) {
      x = lx + dx / 2;
      z = lz + dz / 2;
    }
    const obj = spawnSanctumObject(
      ctx,
      inst,
      SANCTUM_SOULFIRE_PATCH,
      'Spilled Braziers',
      o.x + x,
      o.z + z,
      T.patchRadius,
    );
    st.patches.push({
      objectId: obj.id,
      x: o.x + x,
      z: o.z + z,
      remaining: T.patchSeconds,
      tick: T.patchTick,
    });
  }
}

/** The burning patches: count down, scorch whoever stands in one each second,
 *  and go out. Exported for the paused tick (a lost target never freezes them). */
export function stepPatches(
  ctx: SimContext,
  inst: InstanceSlot,
  tusker: Entity,
  st: TuskerFightState,
): void {
  if (st.patches.length === 0) return;
  const players = claimPlayers(ctx, inst);
  for (const patch of st.patches) {
    patch.remaining -= DT;
    patch.tick -= DT;
    if (patch.tick > 1e-9) continue;
    patch.tick += T.patchTick;
    for (const p of players) {
      if (p.dead || Math.hypot(p.pos.x - patch.x, p.pos.z - patch.z) > T.patchRadius) continue;
      ctx.dealDamage(
        tusker,
        p,
        mechanicDamage(ctx, tusker, T.patchMin, T.patchMax),
        false,
        'shadow',
        'Spilled Braziers',
        'hit',
        true,
      );
    }
  }
  const out = st.patches.filter((p) => p.remaining <= 1e-9);
  for (const p of out) dropEncounterObject(ctx, inst, p.objectId);
  if (out.length > 0) st.patches = st.patches.filter((p) => p.remaining > 1e-9);
}

/** Enrage under a fifth of its health: a damage-done aura for the pull. */
export function enrageTusker(ctx: SimContext, tusker: Entity, st: TuskerFightState): void {
  st.enraged = true;
  ctx.applyAura(tusker, {
    id: TUSKER_ENRAGE,
    name: 'Enrage',
    kind: 'buff_dmg_done',
    remaining: 3600,
    duration: 3600,
    permanent: true,
    value: T.enrageDamage,
    sourceId: tusker.id,
    school: 'physical',
    undispellable: true,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: tusker.id,
    targetId: tusker.id,
    school: 'physical',
    fx: 'nova',
    ability: TUSKER_ENRAGE,
  });
}

/** The pull ended (an evade or a wipe): drop the bar, the patches and the state. */
function endTuskerFight(ctx: SimContext, inst: InstanceSlot, tusker: Entity): void {
  clearCastIf(tusker, TUSKER_TUSK_SWEEP, TUSKER_TRAMPLE);
  const st = tusker.sanctumFight;
  if (st?.kind === 'tusker') for (const p of st.patches) dropEncounterObject(ctx, inst, p.objectId);
  if (tusker.auras.some((a) => a.id === TUSKER_ENRAGE))
    tusker.auras = tusker.auras.filter((a) => a.id !== TUSKER_ENRAGE);
  tusker.sanctumFight = undefined;
}

/** One tick of the Sledge Tusker's kit (after the mob AI). */
export function tickTusker(
  ctx: SimContext,
  inst: InstanceSlot,
  tusker: Entity,
  engaged: boolean,
): void {
  const st0 = tusker.sanctumFight?.kind === 'tusker' ? tusker.sanctumFight : null;
  if (tusker.dead) {
    // The braziers burn out on the road after it falls.
    if (!st0) return;
    // Cold Cargo: it fell without its Trample ever landing on anyone.
    if (!st0.deedDone) {
      st0.deedDone = true;
      if (!st0.trampleLanded) grantClaimDeed(ctx, inst, SANCTUM_DEED_IDS.sledgeTusker);
    }
    clearCastIf(tusker, TUSKER_TUSK_SWEEP, TUSKER_TRAMPLE);
    stepPatches(ctx, inst, tusker, st0);
    if (st0.patches.length === 0) tusker.sanctumFight = undefined;
    return;
  }
  if (!engaged) {
    if (st0) endTuskerFight(ctx, inst, tusker);
    return;
  }
  const st = tuskerState(tusker);
  // The pull: it unhitches its sledge where it stands (the Unhitch clip).
  // The heading it hauled on is the one the tick began with (prevFacing): the
  // mob AI has already turned it toward its target by now.
  st.sledge ??= { x: tusker.pos.x, z: tusker.pos.z, yaw: tusker.prevFacing };
  stepPatches(ctx, inst, tusker, st);
  // Both clocks run through the other strike's bar.
  st.sweepTimer -= DT;
  st.trampleTimer -= DT;
  const share = tusker.maxHp > 0 ? tusker.hp / tusker.maxHp : 1;
  if (!st.spilled && share <= T.spillAtHpPct) spillBraziers(ctx, inst, tusker, st);
  if (!st.enraged && share <= T.enrageAtHpPct) enrageTusker(ctx, tusker, st);
  if (st.charge) {
    stepCharge(ctx, inst, tusker, st);
    return;
  }
  const bar = tusker.castingAbility;
  if (bar === TUSKER_TUSK_SWEEP || bar === TUSKER_TRAMPLE) {
    if (st.plantedAt) holdPlanted(ctx, tusker, st.plantedAt);
    if (bar === TUSKER_TUSK_SWEEP && st.sweepYaw !== null) tusker.facing = st.sweepYaw;
    if (bar === TUSKER_TRAMPLE && st.lane) tusker.facing = st.lane.yaw;
    tusker.swingTimer = Math.max(tusker.swingTimer, 0.6);
    tusker.castRemaining = Math.max(0, tusker.castRemaining - DT);
    if (tusker.castRemaining > 0) return;
    clearCastIf(tusker, bar);
    st.plantedAt = null;
    if (bar === TUSKER_TUSK_SWEEP) landTuskSweep(ctx, inst, tusker, st);
    else launchTrample(ctx, inst, tusker, st);
    return;
  }
  if (bar !== null || ctx.isStunned(tusker)) return;
  st.plantedAt = null;
  // One strike at a time: the Trample first when both are due.
  if (st.trampleTimer <= 0) startTrample(ctx, inst, tusker, st);
  else if (st.sweepTimer <= 0) startTuskSweep(tusker, st);
}
