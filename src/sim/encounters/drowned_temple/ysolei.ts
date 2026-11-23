// Ysolei, Avatar of the Drowned Moon, on the Moon Altar island (docs/design/
// dungeon-rework/drowned_temple.md, "Boss 3"): run out of the undertow toward
// the dry half (G13 pull, G10 half zones).
//
//   Lunar Tide    every 10 s a 1.5 s bar, then 60 to 80 frost within 13 yd.
//   Undertow      every 25 s (first at 15 s) a 3 s channel dragging everyone
//                 toward her at 3.5 yd a second (a runner still gains ground),
//                 then the Tidal Crash: 250 to 300 frost within 12 yd.
//   Rising Tide   from 66 percent the lagoon floods one HALF of the island
//                 (north or south of the east-west causeway line), switching
//                 halves every 30 s after a 10 s shimmer on the half about to
//                 flood. Standing in flood water: 45 frost a second, 50 percent
//                 slower. Every Undertow has one right way out: the dry half.
//   Moonspawn     two at 60 and 30 percent, and she enrages under 30 (the
//                 template's summonAdds and enrage, kept from the shipped fight).
//                 Each opens with a roar on a real bar the moment she is free
//                 (Moonspawn Call, Drowned Wrath): her Summon and Enrage clips.
//   The body      a colossal serpent coiled on the Moon Altar (moveSpeed 0):
//                 she never leaves it, so the causeway line (the flood's
//                 border) always runs through her.
//   Heroic        Riptide: each Undertow leaves a whirl where each player stood
//                 when it began (40 frost a second for 10 s). Drowned Moon:
//                 every 20 s a Moonspawn climbs out of the flooded half.
//   The moon      Moonlight Tears at 75 and 45 percent, the Full Moon at 20
//                 (ysolei_moon.ts): body-block the tears rolling at her, break
//                 her Plenilune Ward before the moon falls.
//
// Zero rng in every pick (the first flooded half is hashed); the only draws
// are the damage rolls.

import { MOBS } from '../../data';
import { spawnKitAdd } from '../../mob/trash_kit/spawn';
import { kitHash } from '../../mob/trash_kit/targets';
import { pullToward } from '../../pull_toward';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity, type YsoleiFightState } from '../../types';
import {
  claimObjectAt,
  claimPlayers,
  clearCastOf,
  dropEncounterObject,
  grantClaimDeed,
  mechanicDamage,
  spawnTempleObject,
  startCast,
} from './claim';
import {
  ALTAR,
  inTideHalf,
  MOONSPAWN_ID,
  otherHalf,
  RIPTIDE_TEMPLATE,
  TIDE_HALF_SPOTS,
  TIDE_TEMPLATES,
  type TideHalf,
  type TideState,
  YSOLEI_CALL,
  YSOLEI_FLOODED,
  YSOLEI_LUNAR_TIDE,
  YSOLEI_TIDAL_CRASH,
  YSOLEI_TUNING,
  YSOLEI_UNDERTOW,
  YSOLEI_WRATH,
} from './ids';
import { queueMoonCalls, resetMoon, stepMoonCasts, stepTears } from './ysolei_moon';

const T = YSOLEI_TUNING;
export const YSOLEI_DEED = 'dgn_ysolei_high_and_dry';

function freshState(): YsoleiFightState {
  return {
    kind: 'ysolei',
    lunarTimer: T.lunarFirst,
    undertowTimer: T.undertowFirst,
    undertow: null,
    tide: null,
    riptides: [],
    moonTimer: T.drownedMoonEvery,
    floodTick: 1,
    crashed: false,
    summonsRoared: 0,
    wrathRoared: false,
    roars: [],
    tearWaves: 0,
    tearCalls: 0,
    tears: [],
    glows: [],
    sear: [],
    fullMoon: null,
  };
}

/** Players on the island (and its rim). */
function islandPlayers(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const o = ctx.instanceOriginOf(inst);
  return claimPlayers(ctx, inst).filter(
    (p) => !p.dead && Math.hypot(p.pos.x - o.x - ALTAR.x, p.pos.z - o.z - ALTAR.z) <= ALTAR.r + 10,
  );
}

/** The claim's tide object for one half (created on first use, kept for the
 *  claim's life: its template id carries dry, warned or flooded). */
function tideObject(ctx: SimContext, inst: InstanceSlot, half: TideHalf): Entity {
  const spot = TIDE_HALF_SPOTS[half];
  const have = claimObjectAt(ctx, inst, spot.x, spot.z);
  if (have) return have;
  return spawnTempleObject(
    ctx,
    inst,
    TIDE_TEMPLATES.dry,
    half === 'north' ? 'North Tide' : 'South Tide',
    spot.x,
    spot.z,
    ALTAR.r,
  );
}

function setTide(ctx: SimContext, inst: InstanceSlot, half: TideHalf, state: TideState): void {
  const obj = tideObject(ctx, inst, half);
  obj.templateId = TIDE_TEMPLATES[state];
  // The south half's object faces south, the north's north (the renderer
  // reads which half it is from where it stands; facing is a spare cue).
  obj.facing = half === 'north' ? 0 : Math.PI;
}

/** The half about to flood (or flooded) for a state, or null before the tide. */
export function floodedHalf(st: YsoleiFightState): TideHalf | null {
  if (!st.tide) return null;
  return st.tide.half;
}

/** Start the Rising Tide: the first half floods (hashed), the other stays dry. */
export function startRisingTide(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: YsoleiFightState,
): void {
  const first: TideHalf = kitHash(boss.id, 66) % 2 === 0 ? 'north' : 'south';
  st.tide = { half: first, timer: T.tideEvery };
  setTide(ctx, inst, first, 'flood');
  setTide(ctx, inst, otherHalf(first), 'dry');
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'frost',
    fx: 'nova',
    ability: YSOLEI_FLOODED,
  });
}

function stepTide(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: YsoleiFightState): void {
  const tide = st.tide;
  if (!tide) return;
  tide.timer -= DT;
  const next = otherHalf(tide.half);
  if (tide.timer <= T.tideWarn) setTide(ctx, inst, next, 'warn');
  if (tide.timer <= 0) {
    tide.half = next;
    tide.timer = T.tideEvery;
    setTide(ctx, inst, next, 'flood');
    setTide(ctx, inst, otherHalf(next), 'dry');
  }
  // Flood water: a slow while you stand in it, and frost every second.
  const o = ctx.instanceOriginOf(inst);
  st.floodTick -= DT;
  const tick = st.floodTick <= 0;
  if (tick) st.floodTick += 1;
  for (const p of islandPlayers(ctx, inst)) {
    if (!inTideHalf(tide.half, p.pos.x - o.x, p.pos.z - o.z)) continue;
    ctx.applyAura(p, {
      id: YSOLEI_FLOODED,
      name: 'Rising Tide',
      kind: 'slow',
      remaining: 0.35,
      duration: 0.35,
      value: T.floodSlow,
      sourceId: boss.id,
      school: 'frost',
    });
    if (!tick) continue;
    const amount = Math.max(1, Math.round(T.floodPerSecond * (boss.mechanicDamageMult ?? 1)));
    ctx.dealDamage(boss, p, amount, false, 'frost', 'Rising Tide', 'hit', true);
  }
  // Drowned Moon (heroic): a Moonspawn climbs out of the flooded half.
  if (inst.difficulty === 'heroic') {
    st.moonTimer -= DT;
    if (st.moonTimer <= 0) {
      st.moonTimer = T.drownedMoonEvery;
      const spot = TIDE_HALF_SPOTS[tide.half];
      const players = islandPlayers(ctx, inst);
      const victim =
        players.length > 0 ? players[kitHash(boss.id, ctx.tickCount) % players.length] : null;
      spawnKitAdd(ctx, inst, boss, MOONSPAWN_ID, o.x + spot.x, o.z + spot.z, victim);
    }
  }
}

/** Begin the Undertow: a 3 s channel that drags everyone in. */
export function startUndertow(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: YsoleiFightState,
): void {
  clearCastOf(boss, YSOLEI_LUNAR_TIDE);
  startCast(boss, YSOLEI_UNDERTOW, T.undertowSeconds, null, true);
  const o = ctx.instanceOriginOf(inst);
  st.undertow = {
    remaining: T.undertowSeconds,
    starts: islandPlayers(ctx, inst).map((p) => ({
      playerId: p.id,
      x: p.pos.x - o.x,
      z: p.pos.z - o.z,
    })),
  };
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'frost',
    fx: 'windup',
    ability: YSOLEI_UNDERTOW,
  });
}

function landCrash(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: YsoleiFightState): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'frost',
    fx: 'nova',
    ability: YSOLEI_TIDAL_CRASH,
  });
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead || dist2d(p.pos, boss.pos) > T.crashRadius) continue;
    st.crashed = true;
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.crashMin, T.crashMax),
      false,
      'frost',
      'Tidal Crash',
      'hit',
      true,
    );
  }
  // Riptide (heroic): a whirl stays where each pulled player stood.
  if (inst.difficulty === 'heroic' && st.undertow) {
    for (const s of st.undertow.starts) {
      const obj = spawnTempleObject(
        ctx,
        inst,
        RIPTIDE_TEMPLATE,
        'Riptide',
        s.x,
        s.z,
        T.riptideRadius,
      );
      st.riptides.push({ x: s.x, z: s.z, remaining: T.riptideSeconds, tick: 1, objectId: obj.id });
    }
  }
}

function stepUndertow(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: YsoleiFightState,
): boolean {
  const u = st.undertow;
  if (!u) return false;
  boss.swingTimer = Math.max(boss.swingTimer, 0.6);
  u.remaining -= DT;
  boss.castRemaining = Math.max(0, u.remaining);
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead || dist2d(p.pos, boss.pos) > T.undertowReach) continue;
    // Dragged to the edge of her coil, never inside the body.
    pullToward(
      ctx,
      p,
      boss.pos.x,
      boss.pos.z,
      T.undertowPull * DT,
      MOBS[boss.templateId]?.bodyRadius ?? 2,
    );
  }
  if (u.remaining > 0) return true;
  clearCastOf(boss, YSOLEI_UNDERTOW);
  landCrash(ctx, inst, boss, st);
  st.undertow = null;
  return false;
}

function stepRiptides(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: YsoleiFightState,
): void {
  const o = ctx.instanceOriginOf(inst);
  for (let i = st.riptides.length - 1; i >= 0; i--) {
    const r = st.riptides[i];
    r.remaining -= DT;
    r.tick -= DT;
    if (r.tick <= 0) {
      r.tick += 1;
      for (const p of claimPlayers(ctx, inst)) {
        if (p.dead || Math.hypot(p.pos.x - o.x - r.x, p.pos.z - o.z - r.z) > T.riptideRadius)
          continue;
        const amount = Math.max(1, Math.round(T.riptidePerSecond * (boss.mechanicDamageMult ?? 1)));
        ctx.dealDamage(boss, p, amount, false, 'frost', 'Riptide', 'hit', true);
      }
    }
    if (r.remaining > 0) continue;
    dropEncounterObject(ctx, inst, r.objectId);
    st.riptides.splice(i, 1);
  }
}

function stepLunar(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: YsoleiFightState): void {
  // The clocks run through her casts, so the Undertow keeps its 25 s beat.
  st.lunarTimer -= DT;
  st.undertowTimer -= DT;
  if (boss.castingAbility === YSOLEI_LUNAR_TIDE) {
    boss.swingTimer = Math.max(boss.swingTimer, 0.6);
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    if (boss.castRemaining > 0) return;
    clearCastOf(boss, YSOLEI_LUNAR_TIDE);
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'frost',
      fx: 'nova',
      ability: YSOLEI_LUNAR_TIDE,
    });
    for (const p of claimPlayers(ctx, inst)) {
      if (p.dead || dist2d(p.pos, boss.pos) > T.lunarRadius) continue;
      ctx.dealDamage(
        boss,
        p,
        mechanicDamage(ctx, boss, T.lunarMin, T.lunarMax),
        false,
        'frost',
        'Lunar Tide',
        'hit',
        true,
      );
    }
    return;
  }
  if (ctx.isStunned(boss) || boss.castingAbility !== null) return;
  if (st.undertowTimer <= 0) {
    st.undertowTimer = T.undertowEvery;
    startUndertow(ctx, inst, boss, st);
    return;
  }
  // No Lunar Tide in the last seconds before an Undertow (spacing lock).
  if (st.lunarTimer <= 0 && st.undertowTimer > T.lunarCast + 1) {
    st.lunarTimer = T.lunarEvery;
    startCast(boss, YSOLEI_LUNAR_TIDE, T.lunarCast, null);
  }
}

/** Her roars: a new Moonspawn wave or the enrage queues one, and it rises on
 *  its own bar the moment she is free. Returns true while a roar owns her. */
function stepRoars(boss: Entity, st: YsoleiFightState): boolean {
  if (boss.firedSummons > st.summonsRoared) {
    st.summonsRoared = boss.firedSummons;
    st.roars.push(YSOLEI_CALL);
  }
  if (boss.enraged && !st.wrathRoared) {
    st.wrathRoared = true;
    st.roars.push(YSOLEI_WRATH);
  }
  const casting = boss.castingAbility;
  if (casting === YSOLEI_CALL || casting === YSOLEI_WRATH) {
    boss.swingTimer = Math.max(boss.swingTimer, 0.6);
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    if (boss.castRemaining <= 0) clearCastOf(boss, casting);
    return true;
  }
  if (casting !== null || st.roars.length === 0) return false;
  const next = st.roars.shift() as string;
  startCast(boss, next, next === YSOLEI_CALL ? T.callCast : T.wrathCast, null);
  return true;
}

/** The fight ended: the lagoon falls back and every whirl stills. */
export function resetYsolei(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  const st = boss.templeFight?.kind === 'ysolei' ? boss.templeFight : null;
  if (st) {
    for (const r of st.riptides) dropEncounterObject(ctx, inst, r.objectId);
    if (st.tide) {
      setTide(ctx, inst, 'north', 'dry');
      setTide(ctx, inst, 'south', 'dry');
    }
  }
  clearCastOf(boss, YSOLEI_LUNAR_TIDE);
  clearCastOf(boss, YSOLEI_UNDERTOW);
  clearCastOf(boss, YSOLEI_CALL);
  clearCastOf(boss, YSOLEI_WRATH);
  resetMoon(ctx, inst, boss, st);
  boss.templeFight = undefined;
}

/** One tick of Ysolei's fight. */
export function tickYsolei(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  engaged: boolean,
): void {
  let st = boss.templeFight?.kind === 'ysolei' ? boss.templeFight : null;
  if (boss.dead) {
    if (st) {
      if (!st.crashed) grantClaimDeed(ctx, inst, YSOLEI_DEED);
      resetYsolei(ctx, inst, boss);
    }
    return;
  }
  if (!engaged) {
    if (st) resetYsolei(ctx, inst, boss);
    return;
  }
  if (!st) {
    st = freshState();
    boss.templeFight = st;
  }
  const share = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
  if (!st.tide && share <= T.tideBelow) startRisingTide(ctx, inst, boss, st);
  stepTide(ctx, inst, boss, st);
  stepRiptides(ctx, inst, boss, st);
  queueMoonCalls(boss, st);
  stepTears(ctx, inst, boss, st);
  if (stepUndertow(ctx, inst, boss, st)) return;
  if (stepRoars(boss, st)) {
    // The clocks keep their beat through a roar.
    st.lunarTimer -= DT;
    st.undertowTimer -= DT;
    return;
  }
  if (stepMoonCasts(ctx, inst, boss, st)) {
    // The clocks keep their beat through the Beckoning Moon; they stand still
    // while the moon itself descends (ysolei_moon.ts).
    if (st.fullMoon !== 'falling' && boss.castingAbility !== null) {
      st.lunarTimer -= DT;
      st.undertowTimer -= DT;
    }
    return;
  }
  stepLunar(ctx, inst, boss, st);
}
