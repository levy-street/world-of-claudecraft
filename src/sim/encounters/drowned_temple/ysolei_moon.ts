// Ysolei calls the moon (the owner-approved proposal in the Temple encounter
// pass; the tuning and its math are in ids.ts YSOLEI_MOON_TUNING).
//
//   Moonlight Tears  at 75 and 45 percent she opens a Beckoning Moon bar (never
//                    kicked); the sky's moon swells and three tears of light
//                    (heroic four) fall on the island rim and roll slowly at
//                    her. Stand in a tear's way to stop it: a moderate hit and
//                    a Moonsear stack that makes the next tear on you hurt far
//                    more, so the group shares them. Each tear that reaches
//                    her is a Moonswell stack (more damage, a little health).
//                    Heroic: a stopped tear leaves a pool of moonlight.
//   The Full Moon    at 20 percent the moon itself descends: a 12 s Falling
//                    Moon bar (heroic 10 s) under her Plenilune Ward. Break the
//                    ward in time and the moon is eclipsed: she reels, stunned
//                    and exposed. Fail and the moon falls on the island and its
//                    might stays on her.
//
// Every visible state rides existing entity fields: the bars, the auras (the
// ward's value and value2 are its remaining and full size), and the tear
// objects' positions, so the online client mirrors it with no wire change.
// Zero rng in every pick (the first tear's heading is hashed); the only draws
// are the damage rolls, in player order.

import { MOBS } from '../../data';
import { kitHash } from '../../mob/trash_kit/targets';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { angleTo, DT, type Entity, type YsoleiFightState } from '../../types';
import {
  claimPlayers,
  clearCastOf,
  dropEncounterObject,
  mechanicDamage,
  spawnTempleObject,
  startCast,
} from './claim';
import {
  ALTAR,
  MOON_TEAR_TEMPLATE,
  MOONGLOW_TEMPLATE,
  tearDamage,
  tearLandingSpots,
  YSOLEI_BECKONING_MOON,
  YSOLEI_ECLIPSE,
  YSOLEI_ECLIPSE_EXPOSED,
  YSOLEI_ECLIPSED,
  YSOLEI_FALLING_MOON,
  YSOLEI_MOON_FALLS,
  YSOLEI_MOON_TUNING,
  YSOLEI_MOONBORNE_MIGHT,
  YSOLEI_MOONSEAR,
  YSOLEI_MOONSWELL,
  YSOLEI_PLENILUNE_WARD,
  YSOLEI_TEAR_ABSORBED,
  YSOLEI_TEAR_CAUGHT,
  YSOLEI_TEAR_LAND,
} from './ids';

const M = YSOLEI_MOON_TUNING;

/** How close a tear must roll to her to reach her (the edge of her coil). */
export function tearReach(boss: Entity): number {
  return (MOBS[boss.templateId]?.bodyRadius ?? 2) + 1;
}

/** Queue the calls her health has crossed (tears at 75 and 45, the Full Moon
 *  at 20). */
export function queueMoonCalls(boss: Entity, st: YsoleiFightState): void {
  const share = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
  while (st.tearWaves < M.tearsAt.length && share <= M.tearsAt[st.tearWaves]) {
    st.tearWaves++;
    st.tearCalls++;
  }
  if (st.fullMoon === null && share <= M.pleniluneAt) st.fullMoon = 'queued';
}

/** Open the Beckoning Moon bar (the dev trigger skips the queue). */
export function startBeckoning(boss: Entity): void {
  startCast(boss, YSOLEI_BECKONING_MOON, M.callCast, null);
}

/** The tears fall on the rim and start rolling at her. */
function landTears(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: YsoleiFightState): void {
  const n = inst.difficulty === 'heroic' ? M.tearCountHeroic : M.tearCount;
  const base = ((kitHash(boss.id, 750 + st.tearWaves * 13) % 360) * Math.PI) / 180;
  for (const spot of tearLandingSpots(n, base)) {
    // Its scale is the catch radius: the silver circle a body steps into.
    const obj = spawnTempleObject(
      ctx,
      inst,
      MOON_TEAR_TEMPLATE,
      'Moonlight Tear',
      spot.x,
      spot.z,
      M.tearCatch,
    );
    obj.facing = angleTo(obj.pos, boss.pos);
    obj.prevFacing = obj.facing;
    st.tears.push({ x: spot.x, z: spot.z, objectId: obj.id });
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: obj.id,
      school: 'arcane',
      fx: 'nova',
      ability: YSOLEI_TEAR_LAND,
    });
  }
}

/** Raise the Plenilune Ward and open the Falling Moon bar. */
export function startFullMoon(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: YsoleiFightState,
): void {
  const seconds = inst.difficulty === 'heroic' ? M.fallingCastHeroic : M.fallingCast;
  const ward = Math.max(1, Math.round(boss.maxHp * M.wardShare));
  ctx.applyAura(boss, {
    id: YSOLEI_PLENILUNE_WARD,
    name: 'Plenilune Ward',
    kind: 'absorb',
    remaining: seconds + 0.5,
    duration: seconds + 0.5,
    value: ward,
    value2: ward,
    sourceId: boss.id,
    school: 'arcane',
  });
  startCast(boss, YSOLEI_FALLING_MOON, seconds, null, true);
  st.fullMoon = 'falling';
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'arcane',
    fx: 'wardBloom',
    ability: YSOLEI_FALLING_MOON,
  });
}

function wardLeft(boss: Entity): number {
  const a = boss.auras.find((x) => x.id === YSOLEI_PLENILUNE_WARD);
  return a ? Math.max(0, a.value) : 0;
}

function eclipse(ctx: SimContext, boss: Entity, st: YsoleiFightState): void {
  clearCastOf(boss, YSOLEI_FALLING_MOON);
  boss.auras = boss.auras.filter((a) => a.id !== YSOLEI_PLENILUNE_WARD);
  st.fullMoon = 'done';
  // Her own reel (sourceId herself): a boss's control immunity lets it in.
  ctx.applyAura(boss, {
    id: YSOLEI_ECLIPSED,
    name: 'Eclipsed',
    kind: 'stun',
    remaining: M.eclipseSeconds,
    duration: M.eclipseSeconds,
    value: 0,
    sourceId: boss.id,
    school: 'arcane',
  });
  ctx.applyAura(boss, {
    id: YSOLEI_ECLIPSE_EXPOSED,
    name: 'Eclipsed',
    kind: 'vulnerability',
    remaining: M.eclipseSeconds,
    duration: M.eclipseSeconds,
    value: M.eclipseVuln,
    sourceId: boss.id,
    school: 'arcane',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'arcane',
    fx: 'nova',
    ability: YSOLEI_ECLIPSE,
  });
}

function moonFalls(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: YsoleiFightState): void {
  clearCastOf(boss, YSOLEI_FALLING_MOON);
  boss.auras = boss.auras.filter((a) => a.id !== YSOLEI_PLENILUNE_WARD);
  st.fullMoon = 'done';
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'arcane',
    fx: 'nova',
    ability: YSOLEI_MOON_FALLS,
  });
  const o = ctx.instanceOriginOf(inst);
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead || Math.hypot(p.pos.x - o.x - ALTAR.x, p.pos.z - o.z - ALTAR.z) > ALTAR.r + 10)
      continue;
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, M.fallMin, M.fallMax),
      false,
      'arcane',
      'Falling Moon',
      'hit',
      true,
    );
  }
  ctx.applyAura(boss, {
    id: YSOLEI_MOONBORNE_MIGHT,
    name: 'Moonborne Might',
    kind: 'buff_dmg_done',
    remaining: 9999,
    duration: 9999,
    value: M.mightShare,
    sourceId: boss.id,
    school: 'arcane',
  });
}

/**
 * Her moon bars: run the one in flight, or open a queued call when she is
 * free. Returns true while a moon bar owns her (and, for the Falling Moon,
 * while her other clocks stand still: the caller reads `st.fullMoon`).
 */
export function stepMoonCasts(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: YsoleiFightState,
): boolean {
  if (boss.castingAbility === YSOLEI_BECKONING_MOON) {
    boss.swingTimer = Math.max(boss.swingTimer, 0.6);
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    if (boss.castRemaining > 0) return true;
    clearCastOf(boss, YSOLEI_BECKONING_MOON);
    landTears(ctx, inst, boss, st);
    return true;
  }
  if (boss.castingAbility === YSOLEI_FALLING_MOON) {
    boss.swingTimer = Math.max(boss.swingTimer, 0.6);
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    if (wardLeft(boss) <= 0) eclipse(ctx, boss, st);
    else if (boss.castRemaining <= 0) moonFalls(ctx, inst, boss, st);
    return true;
  }
  if (boss.castingAbility !== null || ctx.isStunned(boss) || st.undertow) return false;
  // One wave of tears at a time: the next call waits for the last tear.
  if (
    st.tearCalls > 0 &&
    st.tears.length === 0 &&
    st.undertowTimer > M.callCast + M.callUndertowGap
  ) {
    st.tearCalls--;
    startBeckoning(boss);
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'arcane',
      fx: 'windup',
      ability: YSOLEI_BECKONING_MOON,
    });
    return true;
  }
  if (st.fullMoon === 'queued' && st.tearCalls === 0 && st.tears.length === 0) {
    startFullMoon(ctx, inst, boss, st);
    return true;
  }
  return false;
}

function stopTear(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: YsoleiFightState,
  p: Entity,
  at: { x: number; z: number },
): void {
  // The burn's count lives in the fight state: the aura is its display, so a
  // cleanse, a slow immunity or an Ice Block cannot shed the stacks.
  const now = ctx.time;
  st.sear = st.sear.filter((s) => s.until > now);
  const mark = st.sear.find((s) => s.playerId === p.id);
  const stacks = mark ? mark.stacks : 0;
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: p.id,
    school: 'arcane',
    fx: 'nova',
    ability: YSOLEI_TEAR_CAUGHT,
  });
  ctx.dealDamage(
    boss,
    p,
    tearDamage(mechanicDamage(ctx, boss, M.tearMin, M.tearMax), stacks),
    false,
    'arcane',
    'Moonlight Tear',
    'hit',
    true,
  );
  if (mark) {
    mark.stacks++;
    mark.until = now + M.moonsearSeconds;
  } else st.sear.push({ playerId: p.id, stacks: 1, until: now + M.moonsearSeconds });
  if (!p.dead) {
    ctx.applyAura(p, {
      id: YSOLEI_MOONSEAR,
      name: 'Moonsear',
      // A mark, not a slow: the value leaves the runner at full speed.
      kind: 'slow',
      remaining: M.moonsearSeconds,
      duration: M.moonsearSeconds,
      value: 1,
      stacks: stacks + 1,
      sourceId: boss.id,
      school: 'arcane',
    });
  }
  if (inst.difficulty === 'heroic') {
    const obj = spawnTempleObject(
      ctx,
      inst,
      MOONGLOW_TEMPLATE,
      'Spilled Moonlight',
      at.x,
      at.z,
      M.glowRadius,
    );
    st.glows.push({ x: at.x, z: at.z, remaining: M.glowSeconds, tick: 1, objectId: obj.id });
  }
}

function absorbTear(ctx: SimContext, boss: Entity): void {
  const swell = boss.auras.find((a) => a.id === YSOLEI_MOONSWELL);
  const stacks = (swell?.stacks ?? 0) + 1;
  ctx.applyAura(boss, {
    id: YSOLEI_MOONSWELL,
    name: 'Moonswell',
    kind: 'buff_dmg_done',
    remaining: 9999,
    duration: 9999,
    value: M.moonswellDamage * stacks,
    stacks,
    sourceId: boss.id,
    school: 'arcane',
  });
  boss.hp = Math.min(boss.maxHp, boss.hp + Math.round(boss.maxHp * M.moonswellHeal));
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'arcane',
    fx: 'nova',
    ability: YSOLEI_TEAR_ABSORBED,
  });
}

/** The tears roll at her: a body in the way stops one, the rest reach her.
 *  The heroic moonglow pools burn and dry. */
export function stepTears(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: YsoleiFightState,
): void {
  const o = ctx.instanceOriginOf(inst);
  const reach = tearReach(boss);
  const players = claimPlayers(ctx, inst).filter((p) => !p.dead);
  for (let i = st.tears.length - 1; i >= 0; i--) {
    const tr = st.tears[i];
    const tx = boss.pos.x - o.x - tr.x;
    const tz = boss.pos.z - o.z - tr.z;
    const d = Math.hypot(tx, tz);
    const step = Math.min(M.tearSpeed * DT, Math.max(0, d - reach));
    if (d > 1e-6) {
      tr.x += (tx / d) * step;
      tr.z += (tz / d) * step;
    }
    const obj = ctx.entities.get(tr.objectId);
    if (obj) {
      obj.pos = ctx.groundPos(o.x + tr.x, o.z + tr.z);
      ctx.rebucket(obj);
    }
    // The nearest body in its way stops it (the lowest id on a tie).
    let catcher: Entity | null = null;
    let best: number = M.tearCatch;
    for (const p of players) {
      // A body a tear felled this tick catches nothing more.
      if (p.dead) continue;
      const pd = Math.hypot(p.pos.x - o.x - tr.x, p.pos.z - o.z - tr.z);
      if (pd < best || (catcher !== null && pd === best && p.id < catcher.id)) {
        best = pd;
        catcher = p;
      }
    }
    if (catcher) {
      stopTear(ctx, inst, boss, st, catcher, { x: tr.x, z: tr.z });
      dropEncounterObject(ctx, inst, tr.objectId);
      st.tears.splice(i, 1);
      continue;
    }
    if (d - step > reach + 1e-6) continue;
    absorbTear(ctx, boss);
    dropEncounterObject(ctx, inst, tr.objectId);
    st.tears.splice(i, 1);
  }
  for (let i = st.glows.length - 1; i >= 0; i--) {
    const g = st.glows[i];
    g.remaining -= DT;
    g.tick -= DT;
    if (g.tick <= 0) {
      g.tick += 1;
      for (const p of players) {
        if (p.dead || Math.hypot(p.pos.x - o.x - g.x, p.pos.z - o.z - g.z) > M.glowRadius) continue;
        const amount = Math.max(1, Math.round(M.glowPerSecond * (boss.mechanicDamageMult ?? 1)));
        ctx.dealDamage(boss, p, amount, false, 'arcane', 'Spilled Moonlight', 'hit', true);
      }
    }
    if (g.remaining > 0) continue;
    dropEncounterObject(ctx, inst, g.objectId);
    st.glows.splice(i, 1);
  }
}

/** The fight ended: the tears and the moonlight drain, the moon's marks fade. */
export function resetMoon(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: YsoleiFightState | null,
): void {
  if (st) {
    for (const tr of st.tears) dropEncounterObject(ctx, inst, tr.objectId);
    for (const g of st.glows) dropEncounterObject(ctx, inst, g.objectId);
    st.tears = [];
    st.glows = [];
    st.sear = [];
  }
  clearCastOf(boss, YSOLEI_BECKONING_MOON);
  clearCastOf(boss, YSOLEI_FALLING_MOON);
  const moonAuras = new Set([
    YSOLEI_PLENILUNE_WARD,
    YSOLEI_ECLIPSED,
    YSOLEI_ECLIPSE_EXPOSED,
    YSOLEI_MOONBORNE_MIGHT,
    YSOLEI_MOONSWELL,
  ]);
  boss.auras = boss.auras.filter((a) => !moonAuras.has(a.id));
  for (const p of claimPlayers(ctx, inst)) {
    if (p.auras.some((a) => a.id === YSOLEI_MOONSEAR))
      p.auras = p.auras.filter((a) => a.id !== YSOLEI_MOONSEAR);
  }
}
