// Sexton Marrow in the Bell Yard: the parish gravedigger, raised and still
// digging (docs/design/dungeon-rework/hollow_crypt.md 5.1; tuning and the kit's
// summary in marrow_ids.ts).
//
//   Shovelful               every 11 s (first at 6 s) a 1.2 s bar, aim locked
//                           at its start: a cone of grave dirt off the spade
//                           (8 yd, 80 degrees) for 1.5 of his melee roll and
//                           Dirt in the Eyes (50 percent slow, 6 s).
//   Measured for the Grave  every 15 s (first at 9 s) a 1 s bar marks a
//                           non-tank; 4 s later the grave caves in where they
//                           stand (42 to 52 physical within 3 yd) and the pit
//                           stays: Grave Dirt, 9 shadow a second and 40 percent
//                           slow inside. Eight graves at most (the oldest fills).
//   Burial Toll             at 66 and 33 percent he strides to the bell rope
//                           (immune), rings for 3 s, and the Toll lands: 30 to
//                           38 shadow on everyone, and every Open Grave gives up
//                           a Restless Bones.
//   Heroic                  Gravedigger's Blow (a stacking strike on the tank),
//                           Grave Vigor (faster swings in a grave), Unquiet
//                           Earth (lingering 2 s in a grave raises the dead).
//
// Zero rng in every pick (pickMarkTargets hashes the victims); the only draws
// are the damage rolls, in claim-player order.

import { beginCastHold, endCastHold, keepCastHold } from '../../mob/trash_kit/cast_hold';
import { spawnKitAdd } from '../../mob/trash_kit/spawn';
import { inCone } from '../../mob/trash_kit/targets';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import type { MarrowFightState } from './boss_state';
import {
  bossTarget,
  claimPlayers,
  clearCastIf,
  dropAuraById,
  dropEncounterObject,
  grantClaimDeed,
  heavySwing,
  localOf,
  mechanicDamage,
  pickMarkTargets,
  spawnCryptObject,
  startBar,
} from './claim';
import {
  BELL_YARD,
  bellRopeSpot,
  inGrave,
  MARROW_BELL_PEAL,
  MARROW_BLOW_STACKS,
  MARROW_BONES_ID,
  MARROW_BONES_RISE,
  MARROW_BURIAL_TOLL,
  MARROW_DIRT_IN_EYES,
  MARROW_GRAVE_DIRT,
  MARROW_GRAVE_OPENS,
  MARROW_GRAVE_TEMPLATE,
  MARROW_GRAVE_VIGOR,
  MARROW_GRAVEDIGGERS_BLOW,
  MARROW_MEASURE,
  MARROW_MEASURED,
  MARROW_SHOVELFUL,
  MARROW_TOLLING,
  MARROW_TUNING,
} from './marrow_ids';

const T = MARROW_TUNING;
export const MARROW_DEED = 'dgn_marrow_tidy';
/** A grave opened this near the yard's centre spoils the deed (yd from it). */
export const MARROW_TIDY_RADIUS = BELL_YARD.r - 7;

type MarrowBar = 'shovel' | 'measure' | 'blow';
const BAR_ID: Record<MarrowBar, string> = {
  shovel: MARROW_SHOVELFUL,
  measure: MARROW_MEASURE,
  blow: MARROW_GRAVEDIGGERS_BLOW,
};
const BAR_SECONDS: Record<MarrowBar, number> = {
  shovel: T.shovelCast,
  measure: T.measureCast,
  blow: T.blowCast,
};

function freshState(): MarrowFightState {
  return {
    kind: 'marrow',
    shovelTimer: T.shovelFirst,
    measureTimer: T.measureFirst,
    blowTimer: T.blowFirst,
    casts: 0,
    bar: null,
    marks: [],
    graves: [],
    dirtTick: 1,
    tolls: 0,
    toll: null,
    tidy: true,
  };
}

const heroicOf = (inst: InstanceSlot) => inst.difficulty === 'heroic';

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

/** A quiet marker aura refreshed while its condition holds (topped up only
 *  once it has run down by half, so it does not rewrite the wire each tick). */
function marker(
  e: Entity,
  id: string,
  name: string,
  seconds: number,
  sourceId: number,
  kind: 'slow' | 'buff_haste',
  value: number,
): void {
  const a = e.auras.find((x) => x.id === id);
  if (a) {
    if (a.remaining < seconds * 0.5) a.remaining = seconds;
    a.value = value;
    return;
  }
  e.auras.push({
    id,
    name,
    kind,
    remaining: seconds,
    duration: seconds,
    value,
    sourceId,
    school: 'shadow',
    undispellable: true,
  });
}

/** Start one of his bars (the cadence and the dev triggers). */
export function startMarrowBar(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: MarrowFightState,
  what: MarrowBar,
): boolean {
  if (st.bar || st.toll) return false;
  let target: Entity | null;
  if (what === 'measure') {
    const busy = new Set(st.marks.map((m) => m.playerId));
    target = pickMarkTargets(boss, claimPlayers(ctx, inst), 1, st.casts * 3 + 1, busy)[0] ?? null;
  } else {
    target = bossTarget(ctx, boss);
  }
  if (!target) return false;
  st.casts++;
  const yaw = Math.atan2(target.pos.x - boss.pos.x, target.pos.z - boss.pos.z);
  boss.facing = yaw;
  st.bar = { what, targetId: target.id, yaw };
  startBar(boss, BAR_ID[what], BAR_SECONDS[what], target.id);
  // He works planted: the spot and the aim the bar began with, however his
  // foe moves (mob/trash_kit/cast_hold.ts).
  beginCastHold(boss, BAR_ID[what]);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: target.id,
    school: what === 'measure' ? 'shadow' : 'physical',
    fx: 'windup',
    ability: BAR_ID[what],
  });
  if (what === 'shovel') st.shovelTimer = T.shovelEvery;
  else if (what === 'measure') st.measureTimer = T.measureEvery;
  else st.blowTimer = T.blowEvery;
  return true;
}

/** A bar lands. */
function landBar(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: MarrowFightState): void {
  const bar = st.bar;
  if (!bar) return;
  st.bar = null;
  clearCastIf(boss, BAR_ID[bar.what]);
  endCastHold(boss);
  const target = ctx.entities.get(bar.targetId);
  if (bar.what === 'shovel') {
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'physical',
      fx: 'nova',
      ability: MARROW_SHOVELFUL,
    });
    for (const p of claimPlayers(ctx, inst)) {
      if (!inCone(boss.pos, bar.yaw, p.pos, T.shovelRange, T.shovelArcDeg)) continue;
      heavySwing(ctx, boss, p, T.shovelMult, 'Shovelful');
      if (p.dead) continue;
      ctx.applyAura(p, {
        id: MARROW_DIRT_IN_EYES,
        name: 'Dirt in the Eyes',
        kind: 'slow',
        remaining: T.shovelSlowSeconds,
        duration: T.shovelSlowSeconds,
        value: T.shovelSlow,
        sourceId: boss.id,
        school: 'physical',
      });
    }
    return;
  }
  if (!target || target.dead || target.ghost) return;
  if (bar.what === 'blow') {
    heavySwing(ctx, boss, target, T.blowMult, "Gravedigger's Blow");
    if (target.dead) return;
    const prev = target.auras.find((a) => a.id === MARROW_BLOW_STACKS);
    const stacks = Math.min(T.blowMaxStacks, (prev?.stacks ?? 0) + 1);
    dropAuraById(target, MARROW_BLOW_STACKS);
    ctx.applyAura(target, {
      id: MARROW_BLOW_STACKS,
      name: "Gravedigger's Blow",
      kind: 'vulnerability',
      remaining: T.blowSeconds,
      duration: T.blowSeconds,
      value: T.blowVulnPerStack * stacks,
      stacks,
      sourceId: boss.id,
      school: 'physical',
    });
    return;
  }
  // Measured: the grave opens under them in markSeconds.
  st.marks.push({ playerId: target.id, remaining: T.markSeconds });
  dropAuraById(target, MARROW_MEASURED);
  target.auras.push({
    id: MARROW_MEASURED,
    name: 'Measured for the Grave',
    kind: 'slow',
    remaining: T.markSeconds,
    duration: T.markSeconds,
    value: 1,
    // The grave's reach rides the mark, so every client paints the ring the sim opens.
    value2: T.graveRadius,
    sourceId: boss.id,
    school: 'shadow',
    undispellable: true,
  });
}

/** Open a grave at an instance-local spot: the cave-in, then the pit. */
function openGrave(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: MarrowFightState,
  x: number,
  z: number,
): void {
  if (Math.hypot(x - BELL_YARD.x, z - BELL_YARD.z) < MARROW_TIDY_RADIUS) st.tidy = false;
  // Past the cap the oldest grave fills in first.
  while (st.graves.length >= T.graveCap) {
    const old = st.graves.shift();
    if (old) dropEncounterObject(ctx, inst, old.objectId);
  }
  const obj = spawnCryptObject(
    ctx,
    inst,
    MARROW_GRAVE_TEMPLATE,
    'Open Grave',
    x,
    z,
    0,
    T.graveRadius,
  );
  st.graves.push({ objectId: obj.id, x, z, radius: T.graveRadius, stir: 0, rest: 0 });
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: obj.id,
    school: 'physical',
    fx: 'detonate',
    ability: MARROW_GRAVE_OPENS,
  });
  const o = ctx.instanceOriginOf(inst);
  for (const p of claimPlayers(ctx, inst)) {
    if (!inGrave(x, z, T.graveRadius, p.pos.x - o.x, p.pos.z - o.z)) continue;
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.graveOpenMin, T.graveOpenMax),
      false,
      'physical',
      'Open Grave',
      'hit',
      true,
    );
  }
}

/** The marks count down; each one that runs out opens its grave. */
function stepMarks(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: MarrowFightState): void {
  if (st.marks.length === 0) return;
  const keep: MarrowFightState['marks'] = [];
  for (const m of st.marks) {
    m.remaining -= DT;
    if (m.remaining > 1e-6) {
      keep.push(m);
      continue;
    }
    const p = ctx.entities.get(m.playerId);
    if (!p) continue;
    dropAuraById(p, MARROW_MEASURED);
    // A mark that died or left the yard still opens where they last stood.
    const at = localOf(ctx, inst, p);
    openGrave(ctx, inst, boss, st, at.x, at.z);
  }
  st.marks = keep;
}

/** Raise one Restless Bones at an instance-local spot, on a hashed player. */
function raiseBones(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: MarrowFightState,
  x: number,
  z: number,
  victim: Entity | null,
): void {
  const o = ctx.instanceOriginOf(inst);
  const players = claimPlayers(ctx, inst);
  const who = victim ?? pickMarkTargets(boss, players, 1, st.casts * 3 + 2)[0] ?? null;
  st.casts++;
  const add = spawnKitAdd(ctx, inst, boss, MARROW_BONES_ID, o.x + x, o.z + z, who);
  if (!add) return;
  ctx.emit({
    type: 'spellfx',
    sourceId: add.id,
    targetId: add.id,
    school: 'shadow',
    fx: 'nova',
    ability: MARROW_BONES_RISE,
  });
}

/** The graves: Grave Dirt on whoever stands in one, Grave Vigor on him, and
 *  the heroic Unquiet Earth. */
function stepGraves(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: MarrowFightState): void {
  const o = ctx.instanceOriginOf(inst);
  const heroic = heroicOf(inst);
  const graveAt = (e: Entity) => {
    const lx = e.pos.x - o.x;
    const lz = e.pos.z - o.z;
    for (const g of st.graves) if (inGrave(g.x, g.z, g.radius, lx, lz)) return g;
    return null;
  };
  if (heroic && st.toll === null && graveAt(boss))
    marker(boss, MARROW_GRAVE_VIGOR, 'Grave Vigor', 1, boss.id, 'buff_haste', T.graveVigorHaste);
  else dropAuraById(boss, MARROW_GRAVE_VIGOR);
  st.dirtTick -= DT;
  const pulse = st.dirtTick <= 1e-6;
  if (pulse) st.dirtTick += 1;
  const stirred = new Set<number>();
  for (const p of claimPlayers(ctx, inst)) {
    const g = graveAt(p);
    if (!g) {
      dropAuraById(p, MARROW_GRAVE_DIRT);
      continue;
    }
    marker(p, MARROW_GRAVE_DIRT, 'Grave Dirt', 1, boss.id, 'slow', T.graveSlow);
    stirred.add(g.objectId);
    if (!pulse) continue;
    ctx.dealDamage(
      boss,
      p,
      Math.max(1, Math.round(T.graveDirtPerSecond * (boss.mechanicDamageMult ?? 1))),
      false,
      'shadow',
      'Grave Dirt',
      'hit',
      true,
    );
  }
  if (!heroic) return;
  // Unquiet Earth: the dead stir under whoever lingers in their grave.
  for (const g of st.graves) {
    g.rest = Math.max(0, g.rest - DT);
    if (!stirred.has(g.objectId)) {
      g.stir = 0;
      continue;
    }
    g.stir += DT;
    if (g.stir < T.unquietLinger - 1e-6 || g.rest > 0) continue;
    g.stir = 0;
    g.rest = T.unquietRest;
    raiseBones(ctx, inst, boss, st, g.x, g.z, null);
  }
}

/** At 66 and 33 percent: he strides to the bell rope (dev trigger too). */
export function beginToll(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: MarrowFightState,
): boolean {
  if (st.toll) return false;
  if (st.bar) clearCastIf(boss, BAR_ID[st.bar.what]);
  st.bar = null;
  endCastHold(boss);
  st.tolls++;
  st.toll = { phase: 'stride', t: 0, peals: 0 };
  boss.damageImmune = true;
  dropAuraById(boss, MARROW_TOLLING);
  boss.auras.push({
    id: MARROW_TOLLING,
    name: 'Burial Toll',
    kind: 'buff_dr',
    remaining: T.tollStrideMax + T.tollRing + 1,
    duration: T.tollStrideMax + T.tollRing + 1,
    value: 0,
    sourceId: boss.id,
    school: 'shadow',
    undispellable: true,
  });
  return true;
}

function endToll(boss: Entity, st: MarrowFightState): void {
  st.toll = null;
  clearCastIf(boss, MARROW_BURIAL_TOLL);
  boss.damageImmune = false;
  dropAuraById(boss, MARROW_TOLLING);
}

/** The Toll in flight: the stride, the ringing, the peals and the Toll. */
function stepToll(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: MarrowFightState): void {
  const toll = st.toll;
  if (!toll) return;
  const rope = bellRopeSpot();
  toll.t += DT;
  if (toll.phase === 'stride') {
    const at = localOf(ctx, inst, boss);
    const dx = rope.x - at.x;
    const dz = rope.z - at.z;
    const d = Math.hypot(dx, dz);
    const step = T.tollStrideSpeed * DT;
    if (d > step && toll.t < T.tollStrideMax - 1e-6) {
      boss.facing = Math.atan2(dx, dz);
      holdAt(ctx, inst, boss, at.x + (dx / d) * step, at.z + (dz / d) * step);
      return;
    }
    holdAt(ctx, inst, boss, rope.x, rope.z);
    toll.phase = 'ring';
    toll.t = 0;
    startBar(boss, MARROW_BURIAL_TOLL, T.tollRing, null, true);
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'shadow',
      fx: 'windup',
      ability: MARROW_BURIAL_TOLL,
    });
    return;
  }
  holdAt(ctx, inst, boss, rope.x, rope.z);
  // He hauls on the rope facing the tower (the bell swings over him).
  boss.facing = Math.atan2(BELL_YARD.x - rope.x, BELL_YARD.z - rope.z) + Math.PI;
  if (boss.castingAbility === MARROW_BURIAL_TOLL)
    boss.castRemaining = Math.max(0, T.tollRing - toll.t);
  // A peal at each second of the ringing (the last one is the Toll).
  const due = Math.min(T.tollPeals, Math.floor((toll.t + 1e-6) / (T.tollRing / T.tollPeals)));
  while (toll.peals < due) {
    toll.peals++;
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'shadow',
      fx: 'nova',
      ability: toll.peals >= T.tollPeals ? MARROW_BURIAL_TOLL : MARROW_BELL_PEAL,
    });
  }
  if (toll.t < T.tollRing - 1e-6) return;
  for (const p of claimPlayers(ctx, inst)) {
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.tollMin, T.tollMax),
      false,
      'shadow',
      'Burial Toll',
      'hit',
      true,
    );
  }
  // Every Open Grave gives up its dead.
  for (const g of st.graves) raiseBones(ctx, inst, boss, st, g.x, g.z, null);
  endToll(boss, st);
}

function clearMarks(ctx: SimContext, inst: InstanceSlot): void {
  for (const p of claimPlayers(ctx, inst)) {
    dropAuraById(p, MARROW_MEASURED);
    dropAuraById(p, MARROW_GRAVE_DIRT);
  }
}

function fillGraves(ctx: SimContext, inst: InstanceSlot, st: MarrowFightState): void {
  for (const g of st.graves) dropEncounterObject(ctx, inst, g.objectId);
  st.graves = [];
}

/** The fight ended (a wipe, an evade, a reset): the graves fill, the marks
 *  clear, the toll stops. */
export function resetMarrow(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  const st = boss.cryptBossFight;
  if (st?.kind === 'marrow') {
    fillGraves(ctx, inst, st);
    if (st.bar) clearCastIf(boss, BAR_ID[st.bar.what]);
    if (st.toll) endToll(boss, st);
  }
  endCastHold(boss);
  boss.damageImmune = false;
  boss.auras = boss.auras.filter((a) => a.id !== MARROW_TOLLING && a.id !== MARROW_GRAVE_VIGOR);
  clearMarks(ctx, inst);
  boss.cryptBossFight = undefined;
}

/** Marrow was slain: the deed, then the tidy-up. */
function concludeMarrow(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: MarrowFightState,
): void {
  if (st.tidy) grantClaimDeed(ctx, inst, MARROW_DEED);
  fillGraves(ctx, inst, st);
  clearMarks(ctx, inst);
  boss.damageImmune = false;
  boss.cryptBossFight = undefined;
}

/** One tick of Sexton Marrow's fight. */
export function tickMarrow(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  engaged: boolean,
): void {
  let st = boss.cryptBossFight?.kind === 'marrow' ? boss.cryptBossFight : null;
  if (boss.dead) {
    if (st) concludeMarrow(ctx, inst, boss, st);
    return;
  }
  // The stride takes him off his target's heels, so the AI may read him as
  // walking home for a tick: the Toll keeps the fight alive until it is rung.
  // A wipe ends it at once (nobody left standing: no Toll into an empty yard).
  if (!engaged && !(st?.toll && claimPlayers(ctx, inst).length > 0)) {
    if (st) resetMarrow(ctx, inst, boss);
    return;
  }
  if (!st) {
    st = freshState();
    boss.cryptBossFight = st;
  }
  stepMarks(ctx, inst, boss, st);
  stepGraves(ctx, inst, boss, st);
  if (st.toll) {
    stepToll(ctx, inst, boss, st);
    return;
  }
  const share = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
  if (st.tolls < T.tollAt.length && share <= T.tollAt[st.tolls]) {
    beginToll(ctx, inst, boss, st);
    return;
  }
  // His timers run under a bar too; one that comes due mid-bar waits for it.
  st.shovelTimer -= DT;
  st.measureTimer -= DT;
  if (heroicOf(inst)) st.blowTimer -= DT;
  if (st.bar) {
    const bar = st.bar;
    if (boss.castingAbility !== BAR_ID[bar.what]) {
      st.bar = null;
      endCastHold(boss);
      return;
    }
    // The mob AI walked and turned him this tick: stand him back on the spot
    // and the facing the bar began with (never where the chase left him).
    keepCastHold(boss, BAR_ID[bar.what]);
    boss.swingTimer = Math.max(boss.swingTimer, 0.6);
    ctx.grid.update(boss);
    // The cone's aim is locked; a mark bar keeps turning to its victim.
    if (bar.what === 'shovel') boss.facing = bar.yaw;
    else {
      const t = ctx.entities.get(bar.targetId);
      if (t) boss.facing = Math.atan2(t.pos.x - boss.pos.x, t.pos.z - boss.pos.z);
    }
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    if (boss.castRemaining <= 1e-6) landBar(ctx, inst, boss, st);
    return;
  }
  if (ctx.isStunned(boss) || boss.castingAbility !== null) return;
  // One bar at a time: the grave first (it needs its 4 s), then the spade.
  if (st.measureTimer <= 0 && startMarrowBar(ctx, inst, boss, st, 'measure')) return;
  if (st.shovelTimer <= 0 && startMarrowBar(ctx, inst, boss, st, 'shovel')) return;
  if (heroicOf(inst) && st.blowTimer <= 0) startMarrowBar(ctx, inst, boss, st, 'blow');
}
