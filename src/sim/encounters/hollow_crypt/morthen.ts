// Morthen the Gravecaller on the Rite Ring: a three-act rite the group must
// break (docs/design/dungeon-rework/hollow_crypt.md 5.4; tuning and the kit's
// summary in morthen_ids.ts). His entrance is morthen_rise.ts; this module is
// his fight from the landing to his death (the Knellwyrm follows,
// knellwyrm.ts).
//
//   The Calling     Shadow Pulse (a 2 s bar planted on his spot, then shadow
//                   on everyone within 12 yd) and Gravecall (a Bound Soul from
//                   the next alcove: morthen_gravecall.ts).
//   The Rite        at 65 percent (he never drops below it first) he glides
//                   back to the altar inside the Unquiet Ward (immune) and
//                   channels the Rite of the Unquiet; the candles gutter out
//                   (morthen_candles.ts), Grave Chill rises on everyone every
//                   second, and two Restless Bones climb out of the alcoves.
//                   The fourth candle relit shatters the ward: the Rite Broken
//                   (an 8 s stun laid by the encounter: his template's control
//                   immunity does not cover his own broken rite) and 25
//                   percent more damage taken for its length. Then the
//                   Calling again until his Last Rites.
//   Last Rites      at 35 percent Gravecall stops; Reap the Unquiet (a 2 s bar,
//                   aim locked at its start, then a 120 degree, 14 yd sweep in
//                   front of him) and a faster Shadow Pulse.
//   Heroic          Name the Dead (morthen_candles.ts) and Grasp of the Grave
//                   (morthen_grasp.ts), in every act.
//
// Zero rng in every pick (the alcoves are counted, the marks hashed); the only
// draws are damage rolls, in claim-player order. Every visible state rides
// existing entity fields (cast bars, facing, auras, the candle, ring and soul
// objects), so the online client mirrors it with no wire or IWorld change.

import { dropKitObject } from '../../mob/trash_kit/kit_objects';
import { spawnKitAdd } from '../../mob/trash_kit/spawn';
import { inCone } from '../../mob/trash_kit/targets';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity } from '../../types';
import type { MorthenFightState } from './boss_state';
import {
  bossTarget,
  claimPlayers,
  clearCastIf,
  dropAuraById,
  dropEncounterBody,
  grantClaimDeed,
  localOf,
  mechanicDamage,
  pickMarkTargets,
  startBar,
} from './claim';
import { MORTHEN_SPOT } from './ids';
import { MARROW_BONES_ID } from './marrow_ids';
import {
  candlesLit,
  clearCandles,
  gutterCandles,
  retireCandleBodies,
  stepCandles,
} from './morthen_candles';
import { clearGrasps, stepGrasp } from './morthen_grasp';
import { boundSouls, launchBoundSoul } from './morthen_gravecall';
import {
  graveChillAt,
  MORTHEN_GORGED,
  MORTHEN_GRASP_ROOT,
  MORTHEN_GRAVE_CHILL,
  MORTHEN_REAP,
  MORTHEN_RITE,
  MORTHEN_RITE_BROKEN,
  MORTHEN_SHADOW_PULSE,
  MORTHEN_SHATTERED,
  MORTHEN_TUNING,
  MORTHEN_UNQUIET_WARD,
  MORTHEN_WARD_SHATTERS,
  RITE_ALCOVE_SPOTS,
} from './morthen_ids';

const T = MORTHEN_TUNING;
export const MORTHEN_DEED = 'dgn_morthen_candlelight';

type MorthenBar = 'pulse' | 'reap';
const BAR_ID: Record<MorthenBar, string> = { pulse: MORTHEN_SHADOW_PULSE, reap: MORTHEN_REAP };
const BAR_SECONDS: Record<MorthenBar, number> = { pulse: T.pulseCast, reap: T.reapCast };

function freshState(): MorthenFightState {
  return {
    kind: 'morthen',
    act: 'calling',
    t: 0,
    fightT: 0,
    pulseTimer: T.pulseFirst,
    soulTimer: T.soulFirst,
    reapTimer: T.reapFirst,
    graspTimer: T.graspFirst,
    souls: 0,
    casts: 0,
    bar: null,
    riteDone: false,
    striding: false,
    chillTick: 1,
    candles: [],
    order: [],
    litOrder: [],
    channels: [],
    riteAt: 0,
    candlelight: false,
    grasps: [],
  };
}

/** Plant him on an instance-local spot this tick: no step, no swing. */
function holdAt(ctx: SimContext, inst: InstanceSlot, boss: Entity, x: number, z: number): void {
  const o = ctx.instanceOriginOf(inst);
  const g = ctx.groundPos(o.x + x, o.z + z);
  boss.pos.x = g.x;
  boss.pos.y = g.y;
  boss.pos.z = g.z;
  boss.swingTimer = Math.max(boss.swingTimer, 0.6);
  ctx.grid.update(boss);
}

/** A marker aura the encounter keeps (topped up once it has run down by half,
 *  so it does not rewrite the wire every tick). */
function marker(
  e: Entity,
  id: string,
  name: string,
  seconds: number,
  sourceId: number,
  kind: 'slow' | 'buff_dr',
  value: number,
  value2: number,
): void {
  const a = e.auras.find((x) => x.id === id);
  if (a) {
    if (a.remaining < seconds * 0.5) a.remaining = seconds;
    a.value2 = value2;
    return;
  }
  e.auras.push({
    id,
    name,
    kind,
    remaining: seconds,
    duration: seconds,
    value,
    value2,
    sourceId,
    school: 'shadow',
    undispellable: true,
  });
}

/** Start one of his bars (the cadence and the dev triggers). */
export function startMorthenBar(
  ctx: SimContext,
  _inst: InstanceSlot,
  boss: Entity,
  st: MorthenFightState,
  what: MorthenBar,
): boolean {
  if (st.bar || st.act === 'rite' || st.act === 'broken') return false;
  const target = bossTarget(ctx, boss);
  const yaw = target
    ? Math.atan2(target.pos.x - boss.pos.x, target.pos.z - boss.pos.z)
    : boss.facing;
  if (what === 'reap' && !target) return false;
  st.casts++;
  boss.facing = yaw;
  st.bar = { what, yaw };
  startBar(boss, BAR_ID[what], BAR_SECONDS[what], what === 'reap' ? (target?.id ?? null) : null);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: target?.id ?? boss.id,
    school: 'shadow',
    fx: 'windup',
    ability: BAR_ID[what],
  });
  if (what === 'pulse')
    st.pulseTimer = st.act === 'last_rites' ? T.pulseEveryLastRites : T.pulseEvery;
  else st.reapTimer = T.reapEvery;
  return true;
}

/** A bar lands. */
function landBar(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: MorthenFightState): void {
  const bar = st.bar;
  if (!bar) return;
  st.bar = null;
  clearCastIf(boss, BAR_ID[bar.what]);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'nova',
    ability: BAR_ID[bar.what],
  });
  for (const p of claimPlayers(ctx, inst)) {
    // The crag top only (the loft under the south rim is in reach on the map).
    if (p.pos.y < boss.pos.y - T.floorBand) continue;
    if (bar.what === 'pulse') {
      if (dist2d(p.pos, boss.pos) > T.pulseRadius) continue;
      ctx.dealDamage(
        boss,
        p,
        mechanicDamage(ctx, boss, T.pulseMin, T.pulseMax),
        false,
        'shadow',
        'Shadow Pulse',
        'hit',
        true,
      );
      continue;
    }
    if (!inCone(boss.pos, bar.yaw, p.pos, T.reapRange, T.reapArcDeg)) continue;
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.reapMin, T.reapMax),
      false,
      'shadow',
      'Reap the Unquiet',
      'hit',
      true,
    );
  }
}

/** At 65 percent (or the dev trigger): the Rite of the Unquiet. */
export function beginRite(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: MorthenFightState,
): boolean {
  if (st.riteDone || st.act === 'rite') return false;
  if (st.bar) clearCastIf(boss, BAR_ID[st.bar.what]);
  st.bar = null;
  st.riteDone = true;
  st.act = 'rite';
  st.t = 0;
  st.striding = true;
  st.chillTick = 1;
  st.riteAt = st.fightT;
  // He never drops below the line before his ward rises.
  boss.hp = Math.max(boss.hp, Math.min(boss.maxHp, Math.floor(boss.maxHp * T.riteAt)));
  boss.damageImmune = true;
  marker(boss, MORTHEN_UNQUIET_WARD, 'Unquiet Ward', 3600, boss.id, 'buff_dr', 0, 0);
  startBar(boss, MORTHEN_RITE, T.riteBar, null, true);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'windup',
    ability: MORTHEN_RITE,
  });
  gutterCandles(ctx, inst, boss, st);
  // Two Restless Bones climb out of the alcoves after the lighters.
  const o = ctx.instanceOriginOf(inst);
  const victims = pickMarkTargets(boss, claimPlayers(ctx, inst), T.riteBones, st.casts * 3 + 7);
  st.casts++;
  for (let i = 0; i < T.riteBones; i++) {
    const at = RITE_ALCOVE_SPOTS[(i * 2) % RITE_ALCOVE_SPOTS.length];
    spawnKitAdd(ctx, inst, boss, MARROW_BONES_ID, o.x + at.x, o.z + at.z, victims[i] ?? null);
  }
  return true;
}

/** The fourth candle: the ward shatters and he is stunned, exposed. */
function shatterWard(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: MorthenFightState,
): void {
  st.act = 'broken';
  st.t = 0;
  st.striding = false;
  if (st.fightT - st.riteAt <= T.candlelightSeconds + 1e-6) st.candlelight = true;
  clearCastIf(boss, MORTHEN_RITE);
  boss.damageImmune = false;
  dropAuraById(boss, MORTHEN_UNQUIET_WARD);
  retireCandleBodies(ctx, inst, st);
  for (const p of claimPlayers(ctx, inst)) dropAuraById(p, MORTHEN_GRAVE_CHILL);
  // The stun is the encounter's own: laid straight on him (his control
  // immunity guards him from players, never from his own broken rite).
  dropAuraById(boss, MORTHEN_RITE_BROKEN);
  boss.auras.push({
    id: MORTHEN_RITE_BROKEN,
    name: 'Rite Broken',
    kind: 'stun',
    remaining: T.brokenSeconds,
    duration: T.brokenSeconds,
    value: 0,
    sourceId: boss.id,
    school: 'holy',
    undispellable: true,
  });
  ctx.applyAura(boss, {
    id: MORTHEN_SHATTERED,
    name: 'Shattered Ward',
    kind: 'vulnerability',
    remaining: T.brokenSeconds,
    duration: T.brokenSeconds,
    value: T.brokenVuln,
    sourceId: boss.id,
    school: 'holy',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'holy',
    fx: 'nova',
    ability: MORTHEN_WARD_SHATTERS,
  });
}

/** One tick of the Rite: the glide to the altar, the hold, Grave Chill, the candles. */
function stepRite(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: MorthenFightState): void {
  const at = localOf(ctx, inst, boss);
  if (st.striding) {
    const dx = MORTHEN_SPOT.x - at.x;
    const dz = MORTHEN_SPOT.z - at.z;
    const d = Math.hypot(dx, dz);
    const step = T.riteStrideSpeed * DT;
    if (d > step && st.t < T.riteStrideMax - 1e-6) {
      boss.facing = Math.atan2(dx, dz);
      holdAt(ctx, inst, boss, at.x + (dx / d) * step, at.z + (dz / d) * step);
    } else {
      st.striding = false;
      holdAt(ctx, inst, boss, MORTHEN_SPOT.x, MORTHEN_SPOT.z);
    }
  } else {
    holdAt(ctx, inst, boss, MORTHEN_SPOT.x, MORTHEN_SPOT.z);
  }
  boss.damageImmune = true;
  // The Rite's bar runs on (it starts again while the ward stands).
  if (boss.castingAbility !== MORTHEN_RITE) startBar(boss, MORTHEN_RITE, T.riteBar, null, true);
  boss.castRemaining = Math.max(0, boss.castRemaining - DT);
  if (boss.castRemaining <= 1e-6) startBar(boss, MORTHEN_RITE, T.riteBar, null, true);
  stepCandles(ctx, inst, boss, st);
  const lit = candlesLit(st);
  marker(boss, MORTHEN_UNQUIET_WARD, 'Unquiet Ward', 3600, boss.id, 'buff_dr', 0, lit);
  if (lit >= st.candles.length && st.candles.length > 0) {
    shatterWard(ctx, inst, boss, st);
    return;
  }
  // Grave Chill: a bite a second on everyone, rising as the Rite goes on.
  const bite = graveChillAt(st.t);
  const players = claimPlayers(ctx, inst);
  for (const p of players)
    marker(p, MORTHEN_GRAVE_CHILL, 'Grave Chill', 2, boss.id, 'slow', 1, bite);
  st.chillTick -= DT;
  if (st.chillTick > 1e-6) return;
  st.chillTick += 1;
  for (const p of players) {
    ctx.dealDamage(
      boss,
      p,
      Math.max(1, Math.round(bite * (boss.mechanicDamageMult ?? 1))),
      false,
      'shadow',
      'Grave Chill',
      'hit',
      true,
    );
  }
}

/** The fight ended without a kill (a wipe, an evade): the rite goes quiet. */
export function resetMorthen(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  const st = boss.cryptBossFight;
  if (st?.kind === 'morthen') {
    clearCandles(ctx, inst, st);
    clearGrasps(ctx, inst, st);
    if (st.bar) clearCastIf(boss, BAR_ID[st.bar.what]);
  }
  clearCastIf(boss, MORTHEN_RITE);
  for (const orb of boundSouls(ctx, inst)) dropKitObject(ctx, inst, orb.id);
  dropRiteBones(ctx, inst, boss);
  boss.damageImmune = false;
  for (const id of [MORTHEN_UNQUIET_WARD, MORTHEN_RITE_BROKEN, MORTHEN_SHATTERED, MORTHEN_GORGED])
    dropAuraById(boss, id);
  for (const p of claimPlayers(ctx, inst)) {
    dropAuraById(p, MORTHEN_GRAVE_CHILL);
    dropAuraById(p, MORTHEN_GRASP_ROOT);
  }
  boss.cryptBossFight = undefined;
}

/** Morthen was slain: the deed (Every Candle Lit), then the tidy-up. */
function concludeMorthen(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: MorthenFightState,
): void {
  if (st.candlelight) grantClaimDeed(ctx, inst, MORTHEN_DEED);
  resetMorthen(ctx, inst, boss);
}

/** Is the fight still on while the AI may not read him as engaged this tick
 *  (held at the altar, stunned, between a dead target and the next one): he
 *  is in combat, not walking home, and somebody stands. A one-tick gap in the
 *  AI never resets a fight half done. */
function stillInFight(ctx: SimContext, inst: InstanceSlot, boss: Entity) {
  return boss.inCombat && boss.aiState !== 'evade' && claimPlayers(ctx, inst).length > 0;
}

/** The Rite's Restless Bones still standing go back to the earth. */
function dropRiteBones(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  for (const id of boss.summonedIds.slice()) {
    const e = ctx.entities.get(id);
    if (e?.templateId === MARROW_BONES_ID) dropEncounterBody(ctx, inst, boss, id);
  }
}

/** One tick of Morthen's fight (after his entrance). */
export function tickMorthen(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  engaged: boolean,
): void {
  let st = boss.cryptBossFight?.kind === 'morthen' ? boss.cryptBossFight : null;
  if (boss.dead) {
    if (st) concludeMorthen(ctx, inst, boss, st);
    return;
  }
  if (!engaged && !(st && stillInFight(ctx, inst, boss))) {
    if (st) resetMorthen(ctx, inst, boss);
    return;
  }
  if (!st) {
    st = freshState();
    boss.cryptBossFight = st;
  }
  st.fightT += DT;
  st.t += DT;
  stepGrasp(ctx, inst, boss, st);
  const share = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
  if (st.act === 'rite') {
    stepRite(ctx, inst, boss, st);
    return;
  }
  if (st.act === 'broken') {
    const at = localOf(ctx, inst, boss);
    holdAt(ctx, inst, boss, at.x, at.z);
    if (st.t < T.brokenSeconds - 1e-6) return;
    dropAuraById(boss, MORTHEN_RITE_BROKEN);
    st.act = share <= T.lastRitesAt ? 'last_rites' : 'calling';
    st.t = 0;
    return;
  }
  if (st.act === 'calling') {
    if (!st.riteDone && share <= T.riteAt) {
      beginRite(ctx, inst, boss, st);
      return;
    }
    if (st.riteDone && share <= T.lastRitesAt) {
      st.act = 'last_rites';
      st.t = 0;
      st.reapTimer = T.reapFirst;
      st.pulseTimer = Math.min(st.pulseTimer, T.pulseEveryLastRites);
    }
  }
  // His timers run under a bar too; one that comes due mid-bar waits for it.
  st.pulseTimer -= DT;
  if (st.act === 'last_rites') st.reapTimer -= DT;
  else {
    st.soulTimer -= DT;
    if (st.soulTimer <= 0) {
      st.soulTimer = T.soulEvery;
      launchBoundSoul(ctx, inst, boss, st.souls);
      st.souls++;
    }
  }
  if (st.bar) {
    const bar = st.bar;
    if (boss.castingAbility !== BAR_ID[bar.what]) {
      st.bar = null;
      return;
    }
    const at = localOf(ctx, inst, boss);
    holdAt(ctx, inst, boss, at.x, at.z);
    boss.facing = bar.yaw;
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    if (boss.castRemaining <= 1e-6) landBar(ctx, inst, boss, st);
    return;
  }
  if (ctx.isStunned(boss) || boss.castingAbility !== null) return;
  // One bar at a time: the Reap first in his Last Rites, then the pulse.
  if (st.act === 'last_rites' && st.reapTimer <= 0 && startMorthenBar(ctx, inst, boss, st, 'reap'))
    return;
  if (st.pulseTimer <= 0) startMorthenBar(ctx, inst, boss, st, 'pulse');
}

/** Send a Bound Soul now (the dev trigger). */
export function sendBoundSoul(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: MorthenFightState,
): void {
  launchBoundSoul(ctx, inst, boss, st.souls);
  st.souls++;
}
