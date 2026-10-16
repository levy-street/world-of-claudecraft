// The Great Saurian (docs/design/dungeon-rework/wildheart_basin.md section
// 4.3): the River Ford's showpiece patrol, a long-necked war-beast as big as a
// house carrying the Sunbone's bamboo-and-bone howdah. Its kit, on top of its
// melee:
//
//   Tail Swipe          every 12 s a 1 s bar, then its tail sweeps a rear 120
//                       degree cone 12 yd deep: 180 to 220 and an 8 yd
//                       knockback. The cone stays where the bar was drawn.
//   Earthshaking Stomp  every 16 s a 2 s bar (the floor ring is the warning),
//                       then 12 yd round it: 160 to 200 and a 1 s knockdown.
//   Sap Totems          (the rework, 2026-10-14) its rider fights from the
//                       howdah from the pull: every 10 s he throws a Sunbone
//                       Sap Totem onto the ford, 14 yd off, and each totem
//                       mends the Saurian (0.8 percent every 2 s after a 4 s
//                       arming bar) until the group breaks it; a broken
//                       totem's backlash deals the Saurian the totem's own
//                       health (saurian_totems.ts).
//   Howdah Rider        once, at half health: the howdah breaks and a Howdah
//                       Hexcaller leaps down, landing 1.8 s later behind its
//                       right flank (the model's HowdahBreak clip throws its
//                       own rider on the same beat); its interruptible
//                       Ancestral Sap (the trash kit's mend) is channelled on
//                       the Saurian. On the ground he throws no more totems;
//                       the ones standing mend on until they are broken.
//   Heroic: the drum    a second rider beats a drum from the howdah: while it
//                       beats the Stomp's clock runs twice as fast. A broken
//                       totem silences it for 6 s; it goes down with the
//                       howdah (saurian_drum.ts).
//   Enrage              under a fifth of its health: 30 percent more damage,
//                       its swings and both strikes.
//
// The deed (Toppled Titan): the Saurian and its Howdah Hexcaller fall within
// 20 s of each other; the state outlives the Saurian until that settles. Once
// the pull is over a rider that is not fighting is dropped (index.ts), so it
// never idles in the ford.
//
// Deterministic: no pick is rolled (the cones and rings take everyone inside,
// the rider lands on a fixed spot behind its right flank, a totem lands on a
// hashed spot round it); the only rng draws are the damage rolls, in
// claim-player order, as before. Every visible state rides existing entity
// fields (the cast bar, facing, the enrage, fed and drum auras, the rider's
// and the totems' own bodies and bars, `nova` spellfx at the break, the throw,
// each mending, each backlash and each drum beat), so the online client
// mirrors it with no wire change.

import { applyKnockback } from '../../knockback';
import { spawnKitAdd } from '../../mob/trash_kit/spawn';
import { inCone } from '../../mob/trash_kit/targets';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity, type SaurianFightState } from '../../types';
import { claimPlayers, clearCastIf, grantClaimDeed, mechanicDamage, startBar } from './claim';
import {
  HOWDAH_HEXCALLER_ID,
  SAURIAN_DEED,
  SAURIAN_DEED_WINDOW,
  SAURIAN_ENRAGE,
  SAURIAN_HOWDAH_BREAK,
  SAURIAN_HOWDAH_LOG,
  SAURIAN_KNOCKDOWN,
  SAURIAN_RIDER_LANDS,
  SAURIAN_STOMP,
  SAURIAN_TAIL_SWIPE,
  SAURIAN_TUNING as T,
} from './ids';
import {
  drumAboard,
  drumBeating,
  silenceDrum,
  startDrum,
  stepDrum,
  stopDrum,
} from './saurian_drum';
import { clearTotems, crumbleTotems, stepTotems, stepTotemThrows } from './saurian_totems';

function freshState(timers = true): SaurianFightState {
  return {
    kind: 'saurian',
    tailTimer: timers ? T.tailFirst : 99,
    stompTimer: timers ? T.stompFirst : 99,
    tailYaw: null,
    plantedAt: null,
    totemTimer: timers ? T.totemFirst : 99,
    totemsThrown: 0,
    totems: [],
    drum: null,
    howdahBroken: false,
    riderId: null,
    enraged: false,
    casts: 0,
  };
}

/** The Saurian's fight state, started on its first engaged tick (a dev trigger
 *  starts it with its clocks parked, so only the triggered mechanic fires). */
export function saurianState(saurian: Entity, timers = true): SaurianFightState {
  if (saurian.wildheartFight?.kind !== 'saurian') saurian.wildheartFight = freshState(timers);
  return saurian.wildheartFight;
}

/** The pull ended (an evade, a wipe): drop the bar, the totems, the drum and
 *  the state. The rider, once down, is a mob of the claim in its own right. */
function endSaurianFight(ctx: SimContext, inst: InstanceSlot, saurian: Entity): void {
  clearCastIf(saurian, SAURIAN_TAIL_SWIPE, SAURIAN_STOMP);
  const st = saurian.wildheartFight?.kind === 'saurian' ? saurian.wildheartFight : null;
  if (st) {
    clearTotems(ctx, inst, saurian, st);
    stopDrum(ctx, saurian, st);
  }
  saurian.wildheartFight = undefined;
}

/** Start a Tail Swipe behind it. Returns true when it started. */
export function startTailSwipe(saurian: Entity, st: SaurianFightState): boolean {
  if (saurian.castingAbility !== null) return false;
  st.tailYaw = saurian.facing;
  st.tailTimer = T.tailEvery;
  st.casts++;
  st.plantedAt = { ...saurian.pos };
  startBar(saurian, SAURIAN_TAIL_SWIPE, T.tailCast, null);
  return true;
}

/** Start an Earthshaking Stomp. Returns true when it started. */
export function startStomp(saurian: Entity, st: SaurianFightState): boolean {
  if (saurian.castingAbility !== null) return false;
  st.stompTimer = T.stompEvery;
  st.casts++;
  st.plantedAt = { ...saurian.pos };
  startBar(saurian, SAURIAN_STOMP, T.stompCast, null);
  return true;
}

/** The tail lands: everyone in the rear cone is struck and thrown. Returns
 *  how many it struck. */
function landTailSwipe(
  ctx: SimContext,
  inst: InstanceSlot,
  saurian: Entity,
  st: SaurianFightState,
): number {
  const rear = (st.tailYaw ?? saurian.facing) + Math.PI;
  st.tailYaw = null;
  ctx.emit({
    type: 'spellfx',
    sourceId: saurian.id,
    targetId: saurian.id,
    school: 'physical',
    fx: 'nova',
    ability: SAURIAN_TAIL_SWIPE,
  });
  let n = 0;
  for (const p of claimPlayers(ctx, inst)) {
    if (!inCone(saurian.pos, rear, p.pos, T.tailRange, T.tailArcDeg)) continue;
    ctx.dealDamage(
      saurian,
      p,
      mechanicDamage(ctx, saurian, T.tailMin, T.tailMax),
      false,
      'physical',
      'Tail Swipe',
      'hit',
      true,
    );
    if (!p.dead) applyKnockback(ctx, saurian, p, T.tailKnockback);
    n++;
  }
  return n;
}

/** The stomp lands: everyone in reach is struck and knocked down. Returns how
 *  many it struck. */
function landStomp(
  ctx: SimContext,
  inst: InstanceSlot,
  saurian: Entity,
  st: SaurianFightState,
): number {
  ctx.emit({
    type: 'spellfx',
    sourceId: saurian.id,
    targetId: saurian.id,
    school: 'physical',
    fx: 'nova',
    ability: SAURIAN_STOMP,
  });
  // Heroic, while the drum is aboard: the quickened Stomp is priced down
  // (ids.ts). The roll is drawn exactly as before.
  const scale = st.drum ? T.drumStompScale : 1;
  let n = 0;
  for (const p of claimPlayers(ctx, inst)) {
    if (dist2d(p.pos, saurian.pos) > T.stompRadius) continue;
    ctx.dealDamage(
      saurian,
      p,
      Math.max(1, Math.round(mechanicDamage(ctx, saurian, T.stompMin, T.stompMax) * scale)),
      false,
      'physical',
      'Earthshaking Stomp',
      'hit',
      true,
    );
    if (!p.dead) {
      ctx.applyAura(p, {
        id: SAURIAN_KNOCKDOWN,
        name: 'Knocked Down',
        kind: 'stun',
        remaining: T.knockdown,
        duration: T.knockdown,
        value: 0,
        sourceId: saurian.id,
        school: 'physical',
      });
    }
    n++;
  }
  return n;
}

/** Howdah Rider: the howdah breaks (once per pull) and the Howdah Hexcaller
 *  leaps off its back; it lands `riderLandDelay` later behind the right flank
 *  (landRider), on the beat the model's HowdahBreak clip drops its own rider
 *  into the ford, so the two never stand side by side. */
export function breakHowdah(ctx: SimContext, saurian: Entity, st: SaurianFightState): void {
  st.howdahBroken = true;
  st.riderLandsIn = T.riderLandDelay;
  // The drum goes down with it; the rider throws no more totems.
  stopDrum(ctx, saurian, st);
  ctx.emit({
    type: 'spellfx',
    sourceId: saurian.id,
    targetId: saurian.id,
    school: 'physical',
    fx: 'nova',
    ability: SAURIAN_HOWDAH_BREAK,
  });
  ctx.emit({ type: 'log', text: SAURIAN_HOWDAH_LOG, color: '#e8c070', entityId: saurian.id });
}

/** The leaping rider hits the water to the Saurian's right and behind it,
 *  straight into the fight. Returns the rider (null if it could not spawn). */
export function landRider(
  ctx: SimContext,
  inst: InstanceSlot,
  saurian: Entity,
  st: SaurianFightState,
): Entity | null {
  st.riderLandsIn = undefined;
  const victim = riderVictim(ctx, inst, saurian);
  // Its right is a quarter turn clockwise of its facing; behind is the reverse.
  const f = saurian.facing;
  const rx = -Math.cos(f);
  const rz = Math.sin(f);
  const rider = spawnKitAdd(
    ctx,
    inst,
    saurian,
    HOWDAH_HEXCALLER_ID,
    saurian.pos.x + rx * T.riderLandRight - Math.sin(f) * T.riderLandBack,
    saurian.pos.z + rz * T.riderLandRight - Math.cos(f) * T.riderLandBack,
    victim,
  );
  st.riderId = rider?.id ?? null;
  if (rider)
    ctx.emit({
      type: 'spellfx',
      sourceId: rider.id,
      targetId: rider.id,
      school: 'physical',
      fx: 'nova',
      ability: SAURIAN_RIDER_LANDS,
    });
  return rider;
}

/** Who the landing rider goes for: the Saurian's target, or (the Saurian
 *  fell while it leapt) the nearest living player of the claim. */
function riderVictim(ctx: SimContext, inst: InstanceSlot, saurian: Entity): Entity | null {
  const target =
    saurian.aggroTargetId !== null ? (ctx.entities.get(saurian.aggroTargetId) ?? null) : null;
  if (target && !target.dead && target.kind === 'player') return target;
  let best: Entity | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead) continue;
    const d = dist2d(p.pos, saurian.pos);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** The rider in mid-leap: count it down and land it (alive or dead, the
 *  Saurian threw it). */
function tickRiderLeap(
  ctx: SimContext,
  inst: InstanceSlot,
  saurian: Entity,
  st: SaurianFightState,
): void {
  if (st.riderLandsIn === undefined) return;
  st.riderLandsIn -= DT;
  if (st.riderLandsIn <= 1e-9) landRider(ctx, inst, saurian, st);
}

/** Enrage under a fifth of its health: a damage-done aura for the pull (the
 *  damage seam folds it into every hit it deals, swings and strikes alike). */
export function enrageSaurian(ctx: SimContext, saurian: Entity, st: SaurianFightState): void {
  st.enraged = true;
  ctx.applyAura(saurian, {
    id: SAURIAN_ENRAGE,
    name: 'Enrage',
    kind: 'buff_dmg_done',
    remaining: 3600,
    duration: 3600,
    permanent: true,
    value: T.enrageDamage,
    sourceId: saurian.id,
    school: 'physical',
    undispellable: true,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: saurian.id,
    targetId: saurian.id,
    school: 'physical',
    fx: 'nova',
    ability: SAURIAN_ENRAGE,
  });
}

function dropEnrage(saurian: Entity): void {
  if (saurian.auras.some((a) => a.id === SAURIAN_ENRAGE))
    saurian.auras = saurian.auras.filter((a) => a.id !== SAURIAN_ENRAGE);
}

/** Hold the Saurian where it braced for its bar (the mob AI may walk it). */
function holdPlanted(ctx: SimContext, saurian: Entity, st: SaurianFightState): void {
  if (!st.plantedAt) st.plantedAt = { ...saurian.pos };
  if (saurian.pos.x !== st.plantedAt.x || saurian.pos.z !== st.plantedAt.z) {
    saurian.pos.x = st.plantedAt.x;
    saurian.pos.y = st.plantedAt.y;
    saurian.pos.z = st.plantedAt.z;
    ctx.rebucket(saurian);
  }
}

/** The rider's fate, while the Saurian fights: when it fell. */
function watchRider(ctx: SimContext, st: SaurianFightState): void {
  if (st.riderId === null || st.riderDiedAt !== undefined) return;
  const rider = ctx.entities.get(st.riderId);
  if (rider?.dead) st.riderDiedAt = ctx.time;
}

/** The Saurian has fallen: settle the Toppled Titan deed (it and its rider
 *  within 20 s of each other), then let the state go. */
function settleSaurianDeed(ctx: SimContext, inst: InstanceSlot, saurian: Entity): void {
  const st = saurian.wildheartFight?.kind === 'saurian' ? saurian.wildheartFight : null;
  if (!st || st.deedSettled) return;
  if (st.diedAt === undefined) {
    st.diedAt = ctx.time;
    clearCastIf(saurian, SAURIAN_TAIL_SWIPE, SAURIAN_STOMP);
    crumbleTotems(ctx, saurian, st);
    stopDrum(ctx, saurian, st);
  }
  tickRiderLeap(ctx, inst, saurian, st);
  watchRider(ctx, st);
  const rider = st.riderId !== null ? ctx.entities.get(st.riderId) : undefined;
  if (st.riderDiedAt !== undefined) {
    if (Math.abs(st.riderDiedAt - st.diedAt) <= SAURIAN_DEED_WINDOW + 1e-9)
      grantClaimDeed(ctx, inst, SAURIAN_DEED);
    st.deedSettled = true;
  } else if (
    (!rider && st.riderLandsIn === undefined) ||
    ctx.time - st.diedAt > SAURIAN_DEED_WINDOW
  ) {
    st.deedSettled = true;
  }
}

/** One tick of the Great Saurian's kit (after the mob AI). */
export function tickSaurian(
  ctx: SimContext,
  inst: InstanceSlot,
  saurian: Entity,
  engaged: boolean,
): void {
  if (saurian.dead) {
    settleSaurianDeed(ctx, inst, saurian);
    return;
  }
  if (!engaged) {
    dropEnrage(saurian);
    if (saurian.wildheartFight) endSaurianFight(ctx, inst, saurian);
    return;
  }
  const fresh = saurian.wildheartFight?.kind !== 'saurian';
  const st = saurianState(saurian);
  // Heroic: the drum starts with the pull.
  if (fresh && drumAboard(inst)) startDrum(ctx, saurian, st);
  tickRiderLeap(ctx, inst, saurian, st);
  watchRider(ctx, st);
  // The rider's totems: the broken ones snap back (and silence the drum),
  // the standing ones mend, and he throws the next from his seat.
  if (stepTotems(ctx, saurian, st) > 0) silenceDrum(ctx, saurian, st);
  if (saurian.dead) return;
  stepTotemThrows(ctx, inst, saurian, st);
  // Both clocks run through the other strike's bar: "every 12 s", "every 16 s"
  // (the Stomp's faster while the heroic drum beats).
  st.tailTimer -= DT;
  st.stompTimer -= DT * stepDrum(ctx, saurian, st);
  const share = saurian.maxHp > 0 ? saurian.hp / saurian.maxHp : 1;
  if (!st.howdahBroken && share <= T.howdahAtHpPct) breakHowdah(ctx, saurian, st);
  if (!st.enraged && share <= T.enrageAtHpPct) enrageSaurian(ctx, saurian, st);
  const bar = saurian.castingAbility;
  if (bar === SAURIAN_TAIL_SWIPE || bar === SAURIAN_STOMP) {
    holdPlanted(ctx, saurian, st);
    if (bar === SAURIAN_TAIL_SWIPE && st.tailYaw !== null) saurian.facing = st.tailYaw;
    saurian.swingTimer = Math.max(saurian.swingTimer, 0.6);
    saurian.castRemaining = Math.max(0, saurian.castRemaining - DT);
    if (saurian.castRemaining > 0) return;
    clearCastIf(saurian, bar);
    st.plantedAt = null;
    if (bar === SAURIAN_TAIL_SWIPE) landTailSwipe(ctx, inst, saurian, st);
    else landStomp(ctx, inst, saurian, st);
    return;
  }
  if (bar !== null || ctx.isStunned(saurian)) return;
  st.plantedAt = null;
  // One strike at a time: the stomp first when both are due.
  if (st.stompTimer <= 0) startStomp(saurian, st);
  else if (st.tailTimer <= 0) startTailSwipe(saurian, st);
}

/** A fight held on a lost target (index.ts `paused`): the totems still mend
 *  and still snap back, so a blip never freezes them. */
export function tickSaurianPaused(ctx: SimContext, saurian: Entity, st: SaurianFightState): void {
  if (stepTotems(ctx, saurian, st) > 0) silenceDrum(ctx, saurian, st);
}

/** `/dev wildheart trigger drum`: is the drum beating now? */
export function saurianDrumBeating(st: SaurianFightState): boolean {
  return drumBeating(st);
}
