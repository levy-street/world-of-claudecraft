// The Sledge Tusker (docs/design/dungeon-rework/gravewyrm_sanctum.md section
// 5.3): the Sledge Road's showpiece patrol, a shaggy mountain tusker as big as
// a house dragging a sledge of burning soul braziers up and down the haul road.
// Its kit, on top of its melee:
//
//   Tusk Sweep        every 12 s a 1.5 s bar, then its tusks sweep a frontal
//                     120 degree cone 10 yd past its body: 180 to 220 and an
//                     8 yd knockback. The cone stays where the bar was drawn.
//   Trample           every 16 s a 3 s bar paints a lane 30 yd long toward the
//                     farthest player (stopping short of a drop), then it
//                     charges down it: everyone in the lane when the bar ends
//                     takes 160 to 200 and a 1 s knockdown. The lane FOLLOWS
//                     its target through the bar, so the target can lead it
//                     into an outcrop, and locks for the bar's last 0.9 s so
//                     they can step out (the readability pass, 2026-10-15).
//   The bait          (the rework, 2026-10-14) five ice outcrops stand on the
//                     road's rim. A lane that touches one RUNS INTO it: it is
//                     painted only as far as the outcrop, nobody behind the
//                     outcrop is struck, and the charge ends with its
//                     tusks buried in the ice: Stuck in the Ice, 4 s held fast
//                     and taking 25 percent more damage. Then it wrenches free
//                     and the outcrop bursts: one bait an outcrop, five a pull
//                     (tusker_road.ts, tusker_outcrops.ts).
//   Soulfire Trail    its sledge stays HITCHED when it is pulled, so every
//                     charge drags the burning braziers down the lane: the
//                     lane it ran burns for 30 s, 36 to 44 a second to anyone
//                     standing in it (tusker_trail.ts). Two trails at most.
//   Spilled Braziers  at half health the traces snap and the sledge tips where
//                     it stands: three soulfire patches (4 yd) burn on the
//                     road where its braziers land, for 10 s, 36 to 44 a
//                     second to anyone inside. From then on it charges
//                     unladen: no more trails.
//   Enrage            under a fifth of its health: 30 percent more damage.
//
// Killed with no one ever hit by its Trample, it grants the Cold Cargo deed
// (`dgn_sledge_tusker`) to the claim: a baited Trample strikes nobody behind
// its outcrop, so baiting well is the natural way to earn it.
//
// On its death the first plate of ice falls from the Calving Face (story.ts
// reads the dead Tusker; the face is render only).
//
// Deterministic: no pick is rolled (the cone and the lane take everyone inside,
// the lane's victim is the farthest player with ties to the lower id, its aim
// is read off the two positions each tick until the lock, the
// outcrop a lane meets is the nearest along it, the patches stand on fixed
// spots behind it); the only rng draws are the damage rolls, in claim-player
// order. Every visible state rides existing entity fields (the cast bar, a
// locked facing, the stuck and enrage auras, the outcrop, trail and patch
// objects with their template ids and clocks, `nova` spellfx at the spill, the
// slam and the break), so the online client mirrors it with no wire change.

import { GRAVEWYRM_SANCTUM_FIELD } from '../../content/gravewyrm_sanctum_layout';
import { authoredFieldHeight } from '../../instances/authored_field';
import { applyKnockback } from '../../knockback';
import { inLane } from '../../mob/trash_kit/lane';
import { inCone } from '../../mob/trash_kit/targets';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity, type TuskerFightState, type TuskerLane } from '../../types';
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
  TUSKER_BREAKS_FREE,
  TUSKER_ENRAGE,
  TUSKER_KNOCKDOWN,
  TUSKER_SPILL_LOG,
  TUSKER_SPILLED_BRAZIERS,
  TUSKER_STUCK,
  TUSKER_STUCK_EXPOSED,
  TUSKER_STUCK_LOG,
  TUSKER_TRAMPLE,
  TUSKER_TUSK_SWEEP,
  TUSKER_TUSKS_STICK,
} from './ids';
import {
  breakOutcrop,
  ensureOutcrops,
  holdOutcrop,
  restoreOutcrops,
  standingOutcrops,
  strikeOutcrop,
} from './tusker_outcrops';
import {
  TUSKER_BODY as BODY,
  planTrampleLane,
  trampleAimLocked,
  trampleAimYaw,
} from './tusker_road';
import { clearTrails, layTrail, stepTrails } from './tusker_trail';

export { trampleReach } from './tusker_road';

function freshState(timers = true): TuskerFightState {
  return {
    kind: 'tusker',
    sweepTimer: timers ? T.sweepFirst : 99,
    trampleTimer: timers ? T.trampleFirst : 99,
    sweepYaw: null,
    lane: null,
    charge: null,
    stuck: null,
    baits: 0,
    trails: [],
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
  if (tusker.castingAbility !== null || st.charge || st.stuck) return false;
  st.sweepYaw = tusker.facing;
  st.sweepTimer = T.sweepEvery;
  st.casts++;
  st.plantedAt = { ...tusker.pos };
  startBar(tusker, TUSKER_TUSK_SWEEP, T.sweepCast, null);
  return true;
}

/** Paint a Trample lane to the farthest player (it runs into the first ice
 *  outcrop it touches; it follows them until the lock, aimTrample). Returns
 *  true when it started. */
export function startTrample(
  ctx: SimContext,
  inst: InstanceSlot,
  tusker: Entity,
  st: TuskerFightState,
): boolean {
  if (tusker.castingAbility !== null || st.charge || st.stuck) return false;
  const victim = farthest(claimPlayers(ctx, inst), tusker);
  if (!victim) return false;
  const o = ctx.instanceOriginOf(inst);
  const x = tusker.pos.x - o.x;
  const z = tusker.pos.z - o.z;
  const yaw = Math.atan2(victim.pos.x - tusker.pos.x, victim.pos.z - tusker.pos.z);
  st.lane = planTrampleLane(x, z, yaw, standingOutcrops(ctx, inst));
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

/** The Trample's aim while its bar runs: until the lock the lane turns to
 *  follow its target (the bar's cast target) wherever they walk, re-planned
 *  from the beast's planted spot against the outcrops standing now; from the
 *  lock on (and for a bar with no target, the dev bait) it holds still. A
 *  target that dies or leaves leaves the lane where it last pointed. No rng:
 *  the yaw is read off the two positions. */
export function aimTrample(
  ctx: SimContext,
  inst: InstanceSlot,
  tusker: Entity,
  st: TuskerFightState,
): void {
  const lane = st.lane;
  if (!lane || tusker.castTargetId === null || trampleAimLocked(tusker.castRemaining)) return;
  // Only a living player still in this claim (one who ported out keeps the
  // lane where it last pointed).
  const id = tusker.castTargetId;
  const target = claimPlayers(ctx, inst).find((p) => p.id === id);
  if (!target || target.dead) return;
  const o = ctx.instanceOriginOf(inst);
  const yaw = trampleAimYaw(lane.x, lane.z, target.pos.x - o.x, target.pos.z - o.z, lane.yaw);
  if (yaw === lane.yaw) return;
  st.lane = planTrampleLane(lane.x, lane.z, yaw, standingOutcrops(ctx, inst));
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
  // The hitched sledge is dragged down the lane and spills along it; once it
  // has tipped the beast charges unladen.
  if (!st.spilled) layTrail(ctx, inst, st, lane);
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
    if (!inLane(lane.x, lane.z, lane.yaw, lane.reach, T.trampleHalfWidth, px, pz)) continue;
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
  if (k < 1) return;
  st.charge = null;
  if (c.outcropId !== null) stickInOutcrop(ctx, tusker, st, c);
}

/** The charge ended in an outcrop: its tusks are buried in the ice. Stuck in
 *  the Ice holds it there (its own stun, so its control immunity lets it in)
 *  and opens the damage window for the same seconds. */
export function stickInOutcrop(
  ctx: SimContext,
  tusker: Entity,
  st: TuskerFightState,
  lane: TuskerLane,
): void {
  if (lane.outcropId === null) return;
  st.baits++;
  st.stuck = {
    left: T.stuckSeconds,
    outcropId: lane.outcropId,
    x: tusker.pos.x,
    y: tusker.pos.y,
    z: tusker.pos.z,
    yaw: lane.yaw,
  };
  strikeOutcrop(ctx, lane.outcropId, tusker.id);
  ctx.applyAura(tusker, {
    id: TUSKER_STUCK,
    name: 'Stuck in the Ice',
    kind: 'stun',
    remaining: T.stuckSeconds,
    duration: T.stuckSeconds,
    value: 0,
    sourceId: tusker.id,
    school: 'frost',
    unbreakableControl: true,
  });
  ctx.applyAura(tusker, {
    id: TUSKER_STUCK_EXPOSED,
    name: 'Stuck in the Ice',
    kind: 'vulnerability',
    remaining: T.stuckSeconds,
    duration: T.stuckSeconds,
    value: T.stuckVuln,
    sourceId: tusker.id,
    school: 'frost',
    undispellable: true,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: tusker.id,
    targetId: lane.outcropId,
    school: 'frost',
    fx: 'nova',
    ability: TUSKER_TUSKS_STICK,
  });
  ctx.emit({ type: 'log', text: TUSKER_STUCK_LOG, color: '#9fd8ff', entityId: tusker.id });
}

function dropStuckAuras(tusker: Entity): void {
  if (tusker.auras.some((a) => a.id === TUSKER_STUCK || a.id === TUSKER_STUCK_EXPOSED))
    tusker.auras = tusker.auras.filter(
      (a) => a.id !== TUSKER_STUCK && a.id !== TUSKER_STUCK_EXPOSED,
    );
}

/** It wrenches its tusks free: the outcrop bursts, the window closes, and it
 *  takes a breath before its next strike. */
function breakFree(ctx: SimContext, tusker: Entity, st: TuskerFightState): void {
  const stuck = st.stuck;
  if (!stuck) return;
  st.stuck = null;
  breakOutcrop(ctx, stuck.outcropId);
  dropStuckAuras(tusker);
  st.sweepTimer = Math.max(st.sweepTimer, T.stuckRecover);
  st.trampleTimer = Math.max(st.trampleTimer, T.stuckRecover);
  ctx.emit({
    type: 'spellfx',
    sourceId: tusker.id,
    targetId: stuck.outcropId,
    school: 'frost',
    fx: 'nova',
    ability: TUSKER_BREAKS_FREE,
  });
}

/** Stuck in the Ice: held where its tusks went in, swinging at nobody, until
 *  the seconds run out. */
function stepStuck(ctx: SimContext, tusker: Entity, st: TuskerFightState): void {
  const stuck = st.stuck;
  if (!stuck) return;
  holdPlanted(ctx, tusker, stuck);
  tusker.facing = stuck.yaw;
  tusker.swingTimer = Math.max(tusker.swingTimer, 0.6);
  stuck.left -= DT;
  if (stuck.left <= 1e-9) {
    breakFree(ctx, tusker, st);
    return;
  }
  const outcrop = ctx.entities.get(stuck.outcropId);
  if (outcrop) holdOutcrop(outcrop, stuck.left, tusker.id);
}

/** Spilled Braziers: the traces snap and the sledge tips (once per pull) where
 *  it stands behind the beast; three soulfire patches burn on the road. */
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
  // The sledge hangs behind the beast until this moment: it tips in the frame
  // the Tusker stands in now (stuck in an outcrop, along the lane it ran).
  const at = { x: tusker.pos.x, z: tusker.pos.z, yaw: st.stuck ? st.stuck.yaw : tusker.facing };
  st.sledge = at;
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

/** The pull ended (an evade or a wipe): drop the bar, the patches, the trails
 *  and the state, and stand every outcrop up again. */
function endTuskerFight(ctx: SimContext, inst: InstanceSlot, tusker: Entity): void {
  clearCastIf(tusker, TUSKER_TUSK_SWEEP, TUSKER_TRAMPLE);
  const st = tusker.sanctumFight;
  if (st?.kind === 'tusker') {
    for (const p of st.patches) dropEncounterObject(ctx, inst, p.objectId);
    clearTrails(ctx, inst, st);
  }
  if (tusker.auras.some((a) => a.id === TUSKER_ENRAGE))
    tusker.auras = tusker.auras.filter((a) => a.id !== TUSKER_ENRAGE);
  dropStuckAuras(tusker);
  restoreOutcrops(ctx, inst);
  tusker.sanctumFight = undefined;
}

/** The fire on the road (the spilled patches and the trails): both burn out
 *  on their own clocks. Exported for the paused tick (a lost target never
 *  freezes them). */
export function stepRoadFire(
  ctx: SimContext,
  inst: InstanceSlot,
  tusker: Entity,
  st: TuskerFightState,
): void {
  stepPatches(ctx, inst, tusker, st);
  stepTrails(ctx, inst, tusker, st);
}

/** A fight held on a lost target (index.ts `paused`): its fires still burn
 *  out and a stuck beast still wrenches free on time. */
export function tickTuskerPaused(
  ctx: SimContext,
  inst: InstanceSlot,
  tusker: Entity,
  st: TuskerFightState,
): void {
  stepRoadFire(ctx, inst, tusker, st);
  if (st.stuck) stepStuck(ctx, tusker, st);
}

/** `/dev sanctum trigger bait | stick | trail | burst`: aim a Trample at the
 *  nearest standing outcrop in reach (`bait`: the bar and the charge;
 *  `stick`: its tusks go in now), lay a soulfire trail down its facing
 *  (`trail`), or burst the standing outcrop nearest it (`burst`: a spent
 *  bait, its floor circle dark). Returns the log line. */
export function tuskerBaitDevTrigger(
  ctx: SimContext,
  inst: InstanceSlot,
  tusker: Entity,
  st: TuskerFightState,
  what: 'bait' | 'stick' | 'trail' | 'burst',
): string {
  if (st.stuck) return 'The Tusker is already stuck in the ice.';
  const o = ctx.instanceOriginOf(inst);
  const x = tusker.pos.x - o.x;
  const z = tusker.pos.z - o.z;
  if (what === 'burst') {
    let near: { id: number; d: number } | null = null;
    for (const spot of standingOutcrops(ctx, inst)) {
      const d = Math.hypot(spot.x - x, spot.z - z);
      if (!near || d < near.d) near = { id: spot.id, d };
    }
    if (!near) return 'No ice outcrop is left standing (trigger outcrops stands them up).';
    breakOutcrop(ctx, near.id);
    return 'The nearest ice outcrop bursts: one bait fewer.';
  }
  if (what === 'trail') {
    const lane = planTrampleLane(x, z, tusker.facing, []);
    return layTrail(ctx, inst, st, lane)
      ? `A soulfire trail burns ${Math.round(lane.length)} yd down its facing.`
      : 'No room for a trail here.';
  }
  const standing = standingOutcrops(ctx, inst);
  // The nearest outcrop a lane from here really runs into.
  let lane: TuskerLane | null = null;
  for (const spot of [...standing].sort(
    (a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z),
  )) {
    const plan = planTrampleLane(x, z, Math.atan2(spot.x - x, spot.z - z), standing);
    if (plan.outcropId === null) continue;
    lane = plan;
    break;
  }
  if (!lane)
    return standing.length === 0
      ? 'No ice outcrop is left standing (trigger outcrops stands them up).'
      : 'No ice outcrop in reach: bring the Tusker within 30 yd of one, with a run-up.';
  tusker.facing = lane.yaw;
  if (what === 'stick') {
    const at = ctx.groundPos(
      o.x + lane.x + Math.sin(lane.yaw) * lane.length,
      o.z + lane.z + Math.cos(lane.yaw) * lane.length,
    );
    holdPlanted(ctx, tusker, at);
    tusker.prevPos = { ...tusker.pos };
    stickInOutcrop(ctx, tusker, st, lane);
    return 'Its tusks are buried in the ice: Stuck in the Ice.';
  }
  st.lane = lane;
  st.trampleTimer = T.trampleEvery;
  st.casts++;
  st.plantedAt = { ...tusker.pos };
  startBar(tusker, TUSKER_TRAMPLE, T.trampleCast, null);
  ctx.emit({
    type: 'spellfx',
    sourceId: tusker.id,
    targetId: tusker.id,
    school: 'physical',
    fx: 'windup',
    ability: TUSKER_TRAMPLE,
  });
  return 'Trample, aimed into the ice outcrop.';
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
    // The braziers and the trails burn out on the road after it falls.
    if (!st0) return;
    // Cold Cargo: it fell without its Trample ever landing on anyone.
    if (!st0.deedDone) {
      st0.deedDone = true;
      if (!st0.trampleLanded) grantClaimDeed(ctx, inst, SANCTUM_DEED_IDS.sledgeTusker);
    }
    clearCastIf(tusker, TUSKER_TUSK_SWEEP, TUSKER_TRAMPLE);
    // It fell with its tusks still in the ice: the outcrop bursts under it.
    if (st0.stuck) {
      breakOutcrop(ctx, st0.stuck.outcropId);
      st0.stuck = null;
    }
    stepRoadFire(ctx, inst, tusker, st0);
    if (st0.patches.length === 0 && st0.trails.length === 0) tusker.sanctumFight = undefined;
    return;
  }
  // The outcrops stand on the road before the pull, for the claim's life,
  // from the first time a player comes near it.
  ensureOutcrops(ctx, inst);
  if (!engaged) {
    if (st0) endTuskerFight(ctx, inst, tusker);
    return;
  }
  const st = tuskerState(tusker);
  stepRoadFire(ctx, inst, tusker, st);
  // Both clocks run through the other strike's bar.
  st.sweepTimer -= DT;
  st.trampleTimer -= DT;
  const share = tusker.maxHp > 0 ? tusker.hp / tusker.maxHp : 1;
  if (!st.spilled && share <= T.spillAtHpPct) spillBraziers(ctx, inst, tusker, st);
  if (!st.enraged && share <= T.enrageAtHpPct) enrageTusker(ctx, tusker, st);
  if (st.stuck) {
    stepStuck(ctx, tusker, st);
    return;
  }
  if (st.charge) {
    stepCharge(ctx, inst, tusker, st);
    return;
  }
  const bar = tusker.castingAbility;
  if (bar === TUSKER_TUSK_SWEEP || bar === TUSKER_TRAMPLE) {
    if (st.plantedAt) holdPlanted(ctx, tusker, st.plantedAt);
    if (bar === TUSKER_TUSK_SWEEP && st.sweepYaw !== null) tusker.facing = st.sweepYaw;
    if (bar === TUSKER_TRAMPLE) aimTrample(ctx, inst, tusker, st);
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
