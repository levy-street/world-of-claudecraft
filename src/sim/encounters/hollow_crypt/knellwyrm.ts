// The Knellwyrm: the Hollow Crypt's final encounter, summoned by Morthen's
// dying rite.
//
//   pyre    5 s   the ritual circle where he stood bursts into ghost fire (an
//                 encounter object the clients draw): the warning. The wyrm is
//                 already summoned, but still hidden, far out over the mist.
//   arrive  5 s   it flies in FROM THE SKY (never out of thin air in front of
//                 anyone), a long glide from the north-west that flares down
//                 into the pyre; untouchable on the way in.
//   touchdown     the blast in the pyre: anyone still standing in it is burned
//                 and thrown out. The pyre goes out.
//   settle  1.2 s it rises out of its landing crouch; then it fights.
//
// Its fight: the Ossuary Drake's kit (Barrowflame Breath down a cone, Tail Lash
// behind, Wing Gust around it, from its template) plus two mechanics of its
// own, driven here:
//   Pyre Strafe   it marks a lane of the ring through one player (hashed pick),
//                 takes wing to the lane's end, then flies the whole lane
//                 pouring fire: anyone in the lane as it passes is burned, and
//                 the lane is left BURNING for 10 s. Step out of the lane.
//   Dread Bellow  a 2 s roar: everyone close is thrown back and hurt, and its
//                 ribs lie bared for 8 s (it takes 25 percent more damage):
//                 the damage window. Do not stand with a burning lane behind.
//   Heroic        Burning Knell (knellwyrm_knell.ts): it takes flight over the
//                 ring, marks half of it and breathes its ghost fire over that
//                 half, three times, then lands.
//
// Deterministic: victims are hashed (kitHash), fixed DT countdowns; the only
// rng draws are damage rolls, in claim-player order. Every visible state rides
// entity fields (cast bars, heights, facing, auras, encounter objects), so the
// online client mirrors it with no wire or IWorld change.

import { MOBS } from '../../data';
import { createMob } from '../../entity';
import {
  applyDungeonMobTuning,
  mobLevelForDungeonDifficulty,
  mobTemplateForDungeonDifficulty,
} from '../../instances/difficulty';
import { applyKnockback } from '../../knockback';
import { climbArc, floorUnder, glideEase, placeFlier } from '../../mob/flight';
import { kitHash } from '../../mob/trash_kit/targets';
import { emitMobYell } from '../../mob/yells';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import {
  type CryptRiteState,
  DT,
  dist2d,
  type Entity,
  type KnellwyrmFightState,
} from '../../types';
import {
  claimPlayers,
  clearCastOf,
  dropEncounterObject,
  grantClaimDeed,
  mechanicDamage,
  spawnCryptObject,
  startCast,
} from './claim';
import {
  CRYPT_ENTOMBED,
  CRYPT_GRAVE_ASCENSION,
  inStrafeLane,
  KNELL_LANE_MARK_TEMPLATE,
  KNELL_LANE_TEMPLATE,
  KNELL_PYRE_TEMPLATE,
  KNELLWYRM_ARRIVE,
  KNELLWYRM_BARED_RIBS,
  KNELLWYRM_DREAD_BELLOW,
  KNELLWYRM_ID,
  KNELLWYRM_PYRE_STRAFE,
  KNELLWYRM_STRAFE_RUN,
  KNELLWYRM_TOUCHDOWN,
  KNELLWYRM_TUNING,
  MORTHEN_SPOT,
  strafeLane,
  wyrmArrivalPose,
} from './ids';
import { endKnell, tickKnell } from './knellwyrm_knell';
import { dropAura, holdForEntrance, markAura, releaseFromEntrance } from './morthen_rise';

const T = KNELLWYRM_TUNING;
export const KNELLWYRM_DEED = 'dgn_crypt_knellwyrm';

/** Morthen's dying words, and the wyrm's arrival (sim English, re-localized by
 *  the client's EXACT matcher: src/ui/sim_i18n.ts). */
export const MORTHEN_FINALE_YELL =
  'The rite outlives me! Knellwyrm, rise from the pyre and burn them!';
export const KNELLWYRM_ARRIVAL_LOG = 'The Knellwyrm descends on the Rite Ring!';

function local(ctx: SimContext, inst: InstanceSlot, e: Entity): { x: number; z: number } {
  const o = ctx.instanceOriginOf(inst);
  return { x: e.pos.x - o.x, z: e.pos.z - o.z };
}

// The flight itself is the shared encounter flight (mob/flight.ts).
const floorAt = floorUnder;
const setPos = placeFlier;

// ------------------------------------------------------------------ the summon

/** Morthen fell: the circle bursts into flame and the wyrm is summoned (hidden,
 *  far out over the mist). */
export function startFinale(
  ctx: SimContext,
  inst: InstanceSlot,
  morthen: Entity,
  st: CryptRiteState,
): Entity | null {
  const template = MOBS[KNELLWYRM_ID];
  if (!template || st.finale !== 'none') return null;
  st.finale = 'pyre';
  st.ft = 0;
  const pyre = spawnCryptObject(
    ctx,
    inst,
    KNELL_PYRE_TEMPLATE,
    'Wyrmcall Pyre',
    MORTHEN_SPOT.x,
    MORTHEN_SPOT.z,
    0,
    T.pyreRadius,
  );
  st.pyreObjectId = pyre.id;
  emitMobYell(ctx, morthen, MORTHEN_FINALE_YELL);
  const start = wyrmArrivalPose(0);
  const floor = floorAt(ctx, inst, MORTHEN_SPOT.x, MORTHEN_SPOT.z);
  const o = ctx.instanceOriginOf(inst);
  const wyrm = createMob(
    ctx.nextId++,
    mobTemplateForDungeonDifficulty(template, inst.dungeonId, inst.difficulty),
    mobLevelForDungeonDifficulty(inst.dungeonId, inst.difficulty, template.minLevel),
    { x: o.x + start.x, y: floor + start.up, z: o.z + start.z },
  );
  applyDungeonMobTuning(wyrm, inst.dungeonId, inst.difficulty);
  // Home is the pyre: an evade after a wipe walks it back to the ring, never
  // out over the mist it flew in from.
  wyrm.spawnPos = { x: o.x + MORTHEN_SPOT.x, y: floor, z: o.z + MORTHEN_SPOT.z };
  wyrm.facing = start.yaw;
  wyrm.prevFacing = start.yaw;
  wyrm.tappedById = morthen.tappedById;
  wyrm.prevPos = { ...wyrm.pos };
  holdForEntrance(wyrm);
  markAura(wyrm, CRYPT_ENTOMBED, 'Entombed');
  markAura(wyrm, CRYPT_GRAVE_ASCENSION, 'Grave Ascension');
  ctx.addEntity(wyrm);
  inst.mobIds.push(wyrm.id);
  st.wyrmId = wyrm.id;
  return wyrm;
}

/** The touchdown in the pyre: whoever still stands in it burns and is thrown out. */
function touchdown(ctx: SimContext, inst: InstanceSlot, wyrm: Entity, st: CryptRiteState): void {
  const floor = floorAt(ctx, inst, MORTHEN_SPOT.x, MORTHEN_SPOT.z);
  setPos(ctx, inst, wyrm, MORTHEN_SPOT.x, MORTHEN_SPOT.z, floor);
  clearCastOf(wyrm, KNELLWYRM_ARRIVE);
  ctx.emit({
    type: 'spellfx',
    sourceId: wyrm.id,
    targetId: wyrm.id,
    school: 'fire',
    fx: 'nova',
    ability: KNELLWYRM_TOUCHDOWN,
  });
  for (const p of claimPlayers(ctx, inst)) {
    if (dist2d(p.pos, wyrm.pos) > T.pyreRadius) continue;
    ctx.dealDamage(
      wyrm,
      p,
      mechanicDamage(ctx, wyrm, T.landingMin, T.landingMax),
      false,
      'fire',
      'Wyrmcall Pyre',
      'hit',
      true,
    );
    if (!p.dead) applyKnockback(ctx, wyrm, p, T.landingKnockback);
  }
  if (st.pyreObjectId !== null) dropEncounterObject(ctx, inst, st.pyreObjectId);
  st.pyreObjectId = null;
}

/** Hand the landed wyrm to the fight on the nearest player. */
function unleash(ctx: SimContext, inst: InstanceSlot, wyrm: Entity): void {
  releaseFromEntrance(wyrm);
  let best: Entity | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const p of claimPlayers(ctx, inst)) {
    const d = dist2d(p.pos, wyrm.pos);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  if (best) ctx.aggroMob(wyrm, best, false);
}

/** One tick of the finale (after Morthen's fall). */
export function tickFinale(
  ctx: SimContext,
  inst: InstanceSlot,
  morthen: Entity,
  st: CryptRiteState,
): void {
  if (st.finale === 'none') {
    if (morthen.dead && st.phase === 'risen') startFinale(ctx, inst, morthen, st);
    return;
  }
  const wyrm = st.wyrmId !== null ? ctx.entities.get(st.wyrmId) : undefined;
  if (!wyrm) return;
  if (st.finale === 'slain') return;
  if (wyrm.dead) {
    if (wyrm.encounterHeld) releaseFromEntrance(wyrm);
    concludeKnellwyrm(ctx, inst, wyrm);
    st.finale = 'slain';
    return;
  }
  st.ft += DT;
  const floor = floorAt(ctx, inst, MORTHEN_SPOT.x, MORTHEN_SPOT.z);
  switch (st.finale) {
    case 'pyre': {
      holdForEntrance(wyrm);
      const at = wyrmArrivalPose(0);
      setPos(ctx, inst, wyrm, at.x, at.z, floor + at.up);
      if (st.ft >= T.pyreSeconds) {
        st.finale = 'arrive';
        st.ft = 0;
        dropAura(wyrm, CRYPT_ENTOMBED);
        startCast(wyrm, KNELLWYRM_ARRIVE, T.arriveSeconds, null, true);
        ctx.emit({ type: 'log', text: KNELLWYRM_ARRIVAL_LOG, color: '#b6ff8a', entityId: wyrm.id });
      }
      return;
    }
    case 'arrive': {
      holdForEntrance(wyrm);
      const k = Math.min(1, st.ft / T.arriveSeconds);
      const at = wyrmArrivalPose(k);
      setPos(ctx, inst, wyrm, at.x, at.z, floor + at.up);
      wyrm.facing = at.yaw;
      if (wyrm.castingAbility === KNELLWYRM_ARRIVE)
        wyrm.castRemaining = Math.max(0, T.arriveSeconds - st.ft);
      if (k >= 1) {
        touchdown(ctx, inst, wyrm, st);
        st.finale = 'settle';
        st.ft = 0;
      }
      return;
    }
    case 'settle':
      holdForEntrance(wyrm);
      if (st.ft >= T.settleSeconds) {
        st.finale = 'fight';
        st.ft = 0;
        unleash(ctx, inst, wyrm);
      }
      return;
    case 'fight':
      tickKnellwyrm(ctx, inst, wyrm);
      return;
  }
}

// -------------------------------------------------------------------- the fight

function freshFight(): KnellwyrmFightState {
  return {
    strafeTimer: T.strafeFirst,
    bellowTimer: T.bellowFirst,
    strafe: null,
    lanes: [],
    casts: 0,
    burned: false,
  };
}

/** In its fight: a tick between a dead victim and the next target never
 *  resets the fight (a strafe in flight finishes); an evade or leaving
 *  combat does. */
function engaged(wyrm: Entity): boolean {
  return !wyrm.dead && wyrm.inCombat && wyrm.aiState !== 'evade';
}

/** Mark a Pyre Strafe through one player (a hash over the living, by id). */
export function markPyreStrafe(
  ctx: SimContext,
  inst: InstanceSlot,
  wyrm: Entity,
  st: KnellwyrmFightState,
): boolean {
  const living = claimPlayers(ctx, inst).filter((p) => !p.dead);
  if (living.length === 0) return false;
  const victim = living[kitHash(wyrm.id, st.casts + 17) % living.length];
  st.casts++;
  const from = local(ctx, inst, wyrm);
  const to = local(ctx, inst, victim);
  const lane = strafeLane(from.x, from.z, to.x, to.z);
  // The lane shows at once (the telegraph), rim to rim.
  const mark = spawnCryptObject(
    ctx,
    inst,
    KNELL_LANE_MARK_TEMPLATE,
    'Pyre Strafe',
    lane.x,
    lane.z,
    lane.yaw,
    lane.length,
  );
  st.strafe = {
    ...lane,
    phase: 'mark',
    t: 0,
    fromX: from.x,
    fromZ: from.z,
    objectId: mark.id,
    hit: [],
  };
  startCast(wyrm, KNELLWYRM_PYRE_STRAFE, T.strafeMark, victim.id);
  return true;
}

/** Start Dread Bellow's bar. */
export function startDreadBellow(wyrm: Entity, st: KnellwyrmFightState): void {
  st.casts++;
  startCast(wyrm, KNELLWYRM_DREAD_BELLOW, T.bellowCast, null);
}

function stepLanes(
  ctx: SimContext,
  inst: InstanceSlot,
  wyrm: Entity,
  st: KnellwyrmFightState,
): void {
  if (st.lanes.length === 0) return;
  const players = claimPlayers(ctx, inst);
  for (const lane of st.lanes) {
    lane.remaining -= DT;
    lane.tick -= DT;
    if (lane.tick > 0) continue;
    lane.tick += 1;
    for (const p of players) {
      const at = local(ctx, inst, p);
      if (!inStrafeLane(lane, at.x, at.z)) continue;
      st.burned = true;
      ctx.dealDamage(
        wyrm,
        p,
        Math.max(1, Math.round(T.lanePerSecond * (wyrm.mechanicDamageMult ?? 1))),
        false,
        'fire',
        'Pyre Strafe',
        'hit',
        true,
      );
    }
  }
  for (const lane of st.lanes.filter((x) => x.remaining <= 0))
    dropEncounterObject(ctx, inst, lane.objectId);
  st.lanes = st.lanes.filter((x) => x.remaining > 0);
}

/** The strafe in flight. Returns true while it owns the wyrm. */
function stepStrafe(
  ctx: SimContext,
  inst: InstanceSlot,
  wyrm: Entity,
  st: KnellwyrmFightState,
): boolean {
  const s = st.strafe;
  if (!s) return false;
  s.t += DT;
  wyrm.swingTimer = Math.max(wyrm.swingTimer, 0.6);
  const endX = s.x + Math.sin(s.yaw) * s.length;
  const endZ = s.z + Math.cos(s.yaw) * s.length;
  if (s.phase === 'mark') {
    if (wyrm.castingAbility !== KNELLWYRM_PYRE_STRAFE) {
      // Broken off (it cannot be, but never strand a half-run strafe).
      dropEncounterObject(ctx, inst, s.objectId);
      st.strafe = null;
      return false;
    }
    wyrm.castRemaining = Math.max(0, T.strafeMark - s.t);
    // It takes wing and flies round to the lane's start, climbing.
    const k = Math.min(1, s.t / T.strafeMark);
    const ease = glideEase(k);
    const x = s.fromX + (s.x - s.fromX) * ease;
    const z = s.fromZ + (s.z - s.fromZ) * ease;
    const floor = floorAt(ctx, inst, x, z);
    setPos(ctx, inst, wyrm, x, z, floor + climbArc(k, T.strafeHeight));
    // It wheels round to face down the lane as it reaches the start.
    const toStart = Math.atan2(s.x - s.fromX, s.z - s.fromZ);
    wyrm.facing = k < 0.7 && (s.x !== s.fromX || s.z !== s.fromZ) ? toStart : s.yaw;
    if (k >= 1) {
      clearCastOf(wyrm, KNELLWYRM_PYRE_STRAFE);
      s.phase = 'run';
      s.t = 0;
      startCast(wyrm, KNELLWYRM_STRAFE_RUN, T.strafeFlight, null, true);
      ctx.emit({
        type: 'spellfx',
        sourceId: wyrm.id,
        targetId: wyrm.id,
        school: 'fire',
        fx: 'windup',
        ability: KNELLWYRM_STRAFE_RUN,
      });
    }
    return true;
  }
  // The run: rim to rim along the lane, fire poured down behind its jaws.
  const k = Math.min(1, s.t / T.strafeFlight);
  const along = s.length * k;
  const x = s.x + Math.sin(s.yaw) * along;
  const z = s.z + Math.cos(s.yaw) * along;
  const floor = floorAt(ctx, inst, x, z);
  const up = T.strafeHeight * (1 - 0.55 * Math.sin(Math.PI * k));
  setPos(ctx, inst, wyrm, x, z, floor + up);
  wyrm.facing = s.yaw;
  if (wyrm.castingAbility === KNELLWYRM_STRAFE_RUN)
    wyrm.castRemaining = Math.max(0, T.strafeFlight - s.t);
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead || s.hit.includes(p.id)) continue;
    const at = local(ctx, inst, p);
    const pAlong = (at.x - s.x) * Math.sin(s.yaw) + (at.z - s.z) * Math.cos(s.yaw);
    if (pAlong > along || !inStrafeLane(s, at.x, at.z)) continue;
    s.hit.push(p.id);
    st.burned = true;
    ctx.dealDamage(
      wyrm,
      p,
      mechanicDamage(ctx, wyrm, T.strafeMin, T.strafeMax),
      false,
      'fire',
      'Pyre Strafe',
      'hit',
      true,
    );
  }
  if (k < 1) return true;
  clearCastOf(wyrm, KNELLWYRM_STRAFE_RUN);
  setPos(ctx, inst, wyrm, endX, endZ, floorAt(ctx, inst, endX, endZ));
  // The marked lane catches: its object turns into the burning lane.
  const obj = ctx.entities.get(s.objectId);
  if (obj) obj.templateId = KNELL_LANE_TEMPLATE;
  st.lanes.push({
    x: s.x,
    z: s.z,
    yaw: s.yaw,
    length: s.length,
    remaining: T.laneSeconds,
    tick: 1,
    objectId: s.objectId,
  });
  st.strafe = null;
  return false;
}

function landBellow(ctx: SimContext, inst: InstanceSlot, wyrm: Entity): void {
  clearCastOf(wyrm, KNELLWYRM_DREAD_BELLOW);
  ctx.emit({
    type: 'spellfx',
    sourceId: wyrm.id,
    targetId: wyrm.id,
    school: 'shadow',
    fx: 'nova',
    ability: KNELLWYRM_DREAD_BELLOW,
  });
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead || dist2d(p.pos, wyrm.pos) > T.bellowRadius) continue;
    ctx.dealDamage(
      wyrm,
      p,
      mechanicDamage(ctx, wyrm, T.bellowMin, T.bellowMax),
      false,
      'shadow',
      'Dread Bellow',
      'hit',
      true,
    );
    if (!p.dead) applyKnockback(ctx, wyrm, p, T.bellowKnockback);
  }
  ctx.applyAura(wyrm, {
    id: KNELLWYRM_BARED_RIBS,
    name: 'Bared Ribs',
    kind: 'vulnerability',
    remaining: T.baredSeconds,
    duration: T.baredSeconds,
    value: T.baredVuln,
    sourceId: wyrm.id,
    school: 'physical',
  });
}

/** The fight ended without a kill (a wipe, an evade): the lanes go out. */
export function resetKnellwyrm(ctx: SimContext, inst: InstanceSlot, wyrm: Entity): void {
  const st = wyrm.knellwyrmFight;
  if (st) for (const lane of st.lanes) dropEncounterObject(ctx, inst, lane.objectId);
  if (st?.strafe) dropEncounterObject(ctx, inst, st.strafe.objectId);
  if (st?.knell) endKnell(ctx, inst, wyrm, st);
  for (const id of [KNELLWYRM_PYRE_STRAFE, KNELLWYRM_STRAFE_RUN, KNELLWYRM_DREAD_BELLOW])
    clearCastOf(wyrm, id);
  dropAura(wyrm, KNELLWYRM_BARED_RIBS);
  wyrm.knellwyrmFight = undefined;
  if (!wyrm.dead && wyrm.aiState !== 'evade') {
    // Grounded again wherever a run left it (the evade walks it home).
    const at = local(ctx, inst, wyrm);
    wyrm.pos.y = floorAt(ctx, inst, at.x, at.z);
  }
}

/** The wyrm was slain: the deed (nobody burned by a Pyre Strafe this fight),
 *  then the tidy-up. */
function concludeKnellwyrm(ctx: SimContext, inst: InstanceSlot, wyrm: Entity): void {
  const st = wyrm.knellwyrmFight;
  if (st) for (const lane of st.lanes) dropEncounterObject(ctx, inst, lane.objectId);
  if (st?.strafe) dropEncounterObject(ctx, inst, st.strafe.objectId);
  if (st?.knell) endKnell(ctx, inst, wyrm, st);
  wyrm.knellwyrmFight = undefined;
  if (st && !st.burned) grantClaimDeed(ctx, inst, KNELLWYRM_DEED);
}

/** One tick of the Knellwyrm's own mechanics (its drake kit runs on its own). */
export function tickKnellwyrm(ctx: SimContext, inst: InstanceSlot, wyrm: Entity): void {
  if (!engaged(wyrm)) {
    if (wyrm.knellwyrmFight) resetKnellwyrm(ctx, inst, wyrm);
    return;
  }
  if (!wyrm.knellwyrmFight) wyrm.knellwyrmFight = freshFight();
  const st = wyrm.knellwyrmFight;
  stepLanes(ctx, inst, wyrm, st);
  // Heroic: a Burning Knell in flight owns it (its other clocks wait).
  if (tickKnell(ctx, inst, wyrm, st)) return;
  if (stepStrafe(ctx, inst, wyrm, st)) return;
  if (wyrm.castingAbility === KNELLWYRM_DREAD_BELLOW) {
    wyrm.castRemaining = Math.max(0, wyrm.castRemaining - DT);
    wyrm.swingTimer = Math.max(wyrm.swingTimer, 0.6);
    if (wyrm.castRemaining <= 0) landBellow(ctx, inst, wyrm);
    return;
  }
  st.strafeTimer -= DT;
  st.bellowTimer -= DT;
  if (wyrm.castingAbility !== null || ctx.isStunned(wyrm)) return;
  if (st.strafeTimer <= 0) {
    st.strafeTimer = T.strafeEvery;
    if (markPyreStrafe(ctx, inst, wyrm, st)) return;
  }
  if (st.bellowTimer <= 0) {
    st.bellowTimer = T.bellowEvery;
    startDreadBellow(wyrm, st);
  }
}
