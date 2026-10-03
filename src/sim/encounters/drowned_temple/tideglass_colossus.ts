// The Tideglass Colossus on the Prism Terrace (docs/design/dungeon-rework/
// drowned_temple.md, "Boss 2"): your own reflection fights you; kill each
// other's (G22 mirror reflections).
//
//   The walk         it chases its foe across the terrace like any boss (the
//                    mob AI), plants its feet while a bar runs so the lane and
//                    the ring land where they were drawn, and never steps off
//                    the Prism Terrace (a tank who runs down the stair leaves
//                    it pacing the rim).
//   Reflections      at 75, 50 and 25 percent the prism flares (a 2 s bar) and
//                    every player on the terrace gains a Reflection: a glass
//                    copy of them that hunts its owner. It takes NO damage from
//                    its owner and full damage from everyone else, and each
//                    living Reflection makes the Colossus take 10 percent less.
//   Moonlight Lance  every 12 s a 2 s bar, a 30 yd lane of moonlight locked on
//                    one player's spot (90 to 110 arcane). Step out sideways.
//   Resonant Slam    every 14 s a 1.5 s bar, 70 to 90 to everyone within 12 yd
//                    and a knockback; never inside a Prism Flare.
//   Heroic           Shattering Glass: a Reflection bursts where it breaks (80
//                    arcane in 4 yd). Swapped Images: every 8 s the Reflections
//                    pass to the next owner, so who cannot hit which changes.
//
// Zero rng in every pick (the lance's victim is hashed); the only draws are
// the damage rolls.

import { reflectionTemplateFor } from '../../content/drowned_temple';
import { MOBS } from '../../data';
import { applyKnockback } from '../../knockback';
import { inLane } from '../../mob/trash_kit/lane';
import { spawnKitAdd } from '../../mob/trash_kit/spawn';
import { kitHash } from '../../mob/trash_kit/targets';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { angleTo, type ColossusFightState, DT, dist2d, type Entity } from '../../types';
import { claimPlayers, clearCastOf, grantClaimDeed, mechanicDamage, startCast } from './claim';
import {
  COLOSSUS_MOONLIGHT_LANCE,
  COLOSSUS_PRISM_FLARE,
  COLOSSUS_PRISM_WARD,
  COLOSSUS_RESONANT_SLAM,
  COLOSSUS_TUNING,
  REFLECTION_ID,
  REFLECTION_SHATTER,
  TERRACE,
} from './ids';

const T = COLOSSUS_TUNING;
export const COLOSSUS_DEED = 'dgn_colossus_mirror';

function freshState(): ColossusFightState {
  return {
    kind: 'colossus',
    lanceTimer: T.lanceFirst,
    slamTimer: T.slamFirst,
    flares: 0,
    lanceYaw: null,
    reflections: [],
    swapTimer: T.swapEvery,
    casts: 0,
    lingered: false,
    plantedAt: null,
  };
}

/** The Colossus's own casts (the bars it plants its feet for). */
const PLANTED_CASTS: ReadonlySet<string> = new Set([
  COLOSSUS_PRISM_FLARE,
  COLOSSUS_MOONLIGHT_LANCE,
  COLOSSUS_RESONANT_SLAM,
]);

/** How far from the terrace's centre it may stand (its rim, less a step). */
const TERRACE_WALK_RADIUS = TERRACE.r - 1.5;

/** While a bar runs the Colossus stands where it began it (the mob AI walked
 *  it this tick; this runs after, so the step is undone). Off its bars it
 *  walks freely, but never past the terrace's rim. */
function holdGround(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: ColossusFightState,
): void {
  if (boss.castingAbility !== null && PLANTED_CASTS.has(boss.castingAbility)) {
    if (!st.plantedAt) st.plantedAt = { ...boss.pos };
    if (boss.pos.x !== st.plantedAt.x || boss.pos.z !== st.plantedAt.z) {
      boss.pos = { ...st.plantedAt };
      ctx.rebucket(boss);
    }
    return;
  }
  st.plantedAt = null;
  const o = ctx.instanceOriginOf(inst);
  const dx = boss.pos.x - o.x - TERRACE.x;
  const dz = boss.pos.z - o.z - TERRACE.z;
  const d = Math.hypot(dx, dz);
  if (d <= TERRACE_WALK_RADIUS) return;
  const k = TERRACE_WALK_RADIUS / d;
  boss.pos = ctx.groundPos(o.x + TERRACE.x + dx * k, o.z + TERRACE.z + dz * k);
  ctx.rebucket(boss);
}

/** Players on the terrace (its disc and a margin). */
function terracePlayers(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const o = ctx.instanceOriginOf(inst);
  return claimPlayers(ctx, inst).filter(
    (p) =>
      !p.dead && Math.hypot(p.pos.x - o.x - TERRACE.x, p.pos.z - o.z - TERRACE.z) <= TERRACE.r + 8,
  );
}

/** Point a Reflection at its (current) owner and hold the chase on them. */
function bindReflection(r: Entity, owner: Entity): void {
  r.mirrorOwnerId = owner.id;
  r.forcedTargetId = owner.id;
  r.forcedTargetTimer = 999;
  r.aggroTargetId = owner.id;
}

/** The flare lands: one Reflection per player on the terrace, beside them. */
export function raiseReflections(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: ColossusFightState,
): number {
  let n = 0;
  for (const p of terracePlayers(ctx, inst)) {
    // It stands out of its owner's shadow, on the side away from the Colossus.
    const away = angleTo(boss.pos, p.pos);
    const own = reflectionTemplateFor(p.templateId);
    const r = spawnKitAdd(
      ctx,
      inst,
      boss,
      MOBS[own] ? own : REFLECTION_ID,
      p.pos.x + Math.sin(away) * 3,
      p.pos.z + Math.cos(away) * 3,
      p,
    );
    if (!r) continue;
    r.maxHp = Math.max(1, Math.round(boss.maxHp * T.reflectionShare));
    r.hp = r.maxHp;
    r.facing = angleTo(r.pos, p.pos);
    r.prevFacing = r.facing;
    bindReflection(r, p);
    st.reflections.push({ id: r.id, ownerId: p.id, born: ctx.time });
    n++;
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'arcane',
    fx: 'nova',
    ability: COLOSSUS_PRISM_FLARE,
  });
  return n;
}

/** A Reflection breaks (killed, or its owner fell): heroic Shattering Glass. */
function shatter(ctx: SimContext, inst: InstanceSlot, boss: Entity, r: Entity): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: r.id,
    targetId: r.id,
    school: 'arcane',
    fx: 'nova',
    ability: REFLECTION_SHATTER,
  });
  if (inst.difficulty !== 'heroic') return;
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead || dist2d(p.pos, r.pos) > T.shatterRadius) continue;
    const amount = Math.max(1, Math.round(T.shatterDamage * (boss.mechanicDamageMult ?? 1)));
    ctx.dealDamage(boss, p, amount, false, 'arcane', 'Shattering Glass', 'hit', true);
  }
}

function dropReflection(ctx: SimContext, boss: Entity, id: number): void {
  boss.summonedIds = boss.summonedIds.filter((s) => s !== id);
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (e?.targetId === id) e.targetId = null;
  }
  if (ctx.entities.has(id)) ctx.dropEntity(id);
}

/** Keep the living Reflections on their owners; count them into the ward. */
function stepReflections(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: ColossusFightState,
): void {
  for (let i = st.reflections.length - 1; i >= 0; i--) {
    const rec = st.reflections[i];
    const r = ctx.entities.get(rec.id);
    const owner = ctx.entities.get(rec.ownerId);
    if (!r || r.dead || r.hp <= 0) {
      if (ctx.time - rec.born > T.deedWindow) st.lingered = true;
      if (r) shatter(ctx, inst, boss, r);
      st.reflections.splice(i, 1);
      continue;
    }
    if (!owner || owner.dead) {
      // Its owner fell: the glass has nobody left to mirror.
      shatter(ctx, inst, boss, r);
      dropReflection(ctx, boss, r.id);
      st.reflections.splice(i, 1);
      continue;
    }
    if (ctx.time - rec.born > T.deedWindow) st.lingered = true;
    bindReflection(r, owner);
  }
  // Swapped Images (heroic): every few seconds each Reflection passes on.
  if (inst.difficulty === 'heroic' && st.reflections.length > 1) {
    st.swapTimer -= DT;
    if (st.swapTimer <= 0) {
      st.swapTimer = T.swapEvery;
      const owners = st.reflections.map((rec) => rec.ownerId);
      st.reflections.forEach((rec, i) => {
        rec.ownerId = owners[(i + 1) % owners.length];
        const r = ctx.entities.get(rec.id);
        const owner = ctx.entities.get(rec.ownerId);
        if (r && owner) bindReflection(r, owner);
      });
      ctx.emit({
        type: 'spellfx',
        sourceId: boss.id,
        targetId: boss.id,
        school: 'arcane',
        fx: 'windup',
        ability: COLOSSUS_PRISM_FLARE,
      });
    }
  } else {
    st.swapTimer = T.swapEvery;
  }
  // The prism ward: 10 percent less damage taken per living Reflection.
  const ward = Math.min(T.wardCap, T.wardPerReflection * st.reflections.length);
  const have = boss.auras.find((a) => a.id === COLOSSUS_PRISM_WARD);
  if (ward <= 0) {
    if (have) boss.auras = boss.auras.filter((a) => a.id !== COLOSSUS_PRISM_WARD);
  } else if (!have || Math.abs(have.value - ward) > 1e-9) {
    ctx.applyAura(boss, {
      id: COLOSSUS_PRISM_WARD,
      name: 'Prism Ward',
      kind: 'buff_dr',
      remaining: 9999,
      duration: 9999,
      value: ward,
      stacks: st.reflections.length,
      sourceId: boss.id,
      school: 'arcane',
    });
  }
}

/** Mark a Moonlight Lance at one player's spot. */
export function startLance(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: ColossusFightState,
): boolean {
  const players = terracePlayers(ctx, inst);
  if (players.length === 0) return false;
  st.casts++;
  const others = players.filter((p) => p.id !== boss.aggroTargetId);
  const pool = others.length > 0 ? others : players;
  const victim = pool[kitHash(boss.id, st.casts) % pool.length];
  st.lanceYaw = angleTo(boss.pos, victim.pos);
  boss.facing = st.lanceYaw;
  boss.prevFacing = st.lanceYaw;
  startCast(boss, COLOSSUS_MOONLIGHT_LANCE, T.lanceCast, victim.id);
  return true;
}

function landLance(ctx: SimContext, inst: InstanceSlot, boss: Entity, yaw: number): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'arcane',
    fx: 'heavyBolt',
    ability: COLOSSUS_MOONLIGHT_LANCE,
  });
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead) continue;
    if (!inLane(boss.pos.x, boss.pos.z, yaw, T.lanceLength, T.lanceHalfWidth, p.pos.x, p.pos.z))
      continue;
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.lanceMin, T.lanceMax),
      false,
      'arcane',
      'Moonlight Lance',
      'hit',
      true,
    );
  }
}

function landSlam(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'arcane',
    fx: 'nova',
    ability: COLOSSUS_RESONANT_SLAM,
  });
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead || dist2d(p.pos, boss.pos) > T.slamRadius) continue;
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.slamMin, T.slamMax),
      false,
      'arcane',
      'Resonant Slam',
      'hit',
      true,
    );
    if (!p.dead) applyKnockback(ctx, boss, p, T.slamKnockback);
  }
}

/** The next flare threshold is close: hold the slam so it never lands in one. */
function flareNear(boss: Entity, st: ColossusFightState): boolean {
  const next = T.flareAt[st.flares];
  if (next === undefined || boss.maxHp <= 0) return false;
  return boss.hp / boss.maxHp <= next + 0.03;
}

function stepCasts(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: ColossusFightState,
): void {
  const casting = boss.castingAbility;
  if (
    casting === COLOSSUS_PRISM_FLARE ||
    casting === COLOSSUS_MOONLIGHT_LANCE ||
    casting === COLOSSUS_RESONANT_SLAM
  ) {
    boss.swingTimer = Math.max(boss.swingTimer, 0.6);
    if (casting === COLOSSUS_MOONLIGHT_LANCE && st.lanceYaw !== null) boss.facing = st.lanceYaw;
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    if (boss.castRemaining > 0) return;
    clearCastOf(boss, casting);
    if (casting === COLOSSUS_PRISM_FLARE) raiseReflections(ctx, inst, boss, st);
    else if (casting === COLOSSUS_MOONLIGHT_LANCE) {
      landLance(ctx, inst, boss, st.lanceYaw ?? boss.facing);
      st.lanceYaw = null;
    } else landSlam(ctx, inst, boss);
    return;
  }
  if (ctx.isStunned(boss) || casting !== null) return;
  // The prism flares at each threshold, ahead of anything else.
  const share = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
  if (st.flares < T.flareAt.length && share <= T.flareAt[st.flares]) {
    st.flares++;
    startCast(boss, COLOSSUS_PRISM_FLARE, T.flareCast, null, true);
    return;
  }
  st.lanceTimer -= DT;
  st.slamTimer -= DT;
  if (st.slamTimer <= 0 && !flareNear(boss, st)) {
    st.slamTimer = T.slamEvery;
    startCast(boss, COLOSSUS_RESONANT_SLAM, T.slamCast, null);
    return;
  }
  if (st.lanceTimer <= 0) {
    st.lanceTimer = T.lanceEvery;
    startLance(ctx, inst, boss, st);
  }
}

/** The fight ended: every Reflection dissolves and the ward lifts. */
export function resetColossus(ctx: SimContext, boss: Entity): void {
  const st = boss.templeFight?.kind === 'colossus' ? boss.templeFight : null;
  if (st) for (const rec of st.reflections) dropReflection(ctx, boss, rec.id);
  for (const id of [COLOSSUS_PRISM_FLARE, COLOSSUS_MOONLIGHT_LANCE, COLOSSUS_RESONANT_SLAM])
    clearCastOf(boss, id);
  boss.auras = boss.auras.filter((a) => a.id !== COLOSSUS_PRISM_WARD);
  boss.templeFight = undefined;
}

/** One tick of the Tideglass Colossus's fight. */
export function tickColossus(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  engaged: boolean,
): void {
  let st = boss.templeFight?.kind === 'colossus' ? boss.templeFight : null;
  if (boss.dead) {
    if (st) {
      stepReflections(ctx, inst, boss, st);
      if (!st.lingered && st.flares > 0) grantClaimDeed(ctx, inst, COLOSSUS_DEED);
      resetColossus(ctx, boss);
    }
    return;
  }
  if (!engaged) {
    if (st) resetColossus(ctx, boss);
    return;
  }
  if (!st) {
    st = freshState();
    boss.templeFight = st;
  }
  stepReflections(ctx, inst, boss, st);
  stepCasts(ctx, inst, boss, st);
  holdGround(ctx, inst, boss, st);
}
