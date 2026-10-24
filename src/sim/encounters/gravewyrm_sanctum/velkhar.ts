// Grand Necromancer Velkhar in the Ritual Vault (docs/design/dungeon-rework/
// gravewyrm_sanctum.md section 6.2): only the cold keeps them down. Kill the
// thawed dead on cold ice; any that fall in meltwater rise again.
//
//   Waking Thaw       every 30 s (first at 15 s) one pyre flares and two
//                     Raised Bonewalkers climb out of its pool; it roars 1.5 s
//                     early (the flare object on its pool). The pools take turns in order.
//                     At 66 and 33 percent three more rise, one from each pool
//                     (the shipped waves, now from the pools).
//   Unquenched/Held   (G24) a Bonewalker that dies in meltwater sinks: a ring
//                     of bubbles counts 4 s, then it rises again at 60 percent
//                     health and Velkhar is healed 2 percent (the tithe). One
//                     that dies on cold ice is Held: a rimed statue stays
//                     where it fell and it is gone for good.
//   Grasp of the Thawed  a Bonewalker standing in meltwater deals 30 percent
//                     more damage.
//   Soulfire Trench   every 18 s a 2 s bar paints a lane from him toward a
//                     player to the vault's rim; then 200 to 240 to everyone in
//                     it, and the lane stays a 4 yd meltwater strip for 20 s.
//   Shadow Volley     every 12 s a 1.5 s bar, then 90 to 110 to everyone.
//   Heroic            Warm Hands: a Bonewalker standing still 3 s melts a 3 yd
//                     puddle under itself for 8 s. Twice-Woken: a Bonewalker
//                     that rises again comes back at full health with 25
//                     percent more damage.
//
// Meltwater is the three pools, the live strips and the puddles
// (meltwater.ts). Deeds: "Stay Buried" (shipped, the kill-order task in
// deeds.ts) now means every Bonewalker Held: one sunk and waiting to rise is
// not destroyed. "Cold Comfort" (no Bonewalker rose a second time) is granted
// here at his death.
//
// Deterministic: the pools take turns in order, the trench's victim is hashed
// among the non-tanks (pickMarkTargets), each add picks the nearest player
// (ties to the lower id); the only rng draws are the damage rolls, in
// claim-player order. Every visible state rides existing entity fields (the
// cast bars with castTargetId and a locked facing, the auras, the encounter
// objects, `nova` spellfx), so the online client mirrors it with no wire change.

import { RITUAL_VAULT, THAW_POOLS } from '../../content/gravewyrm_sanctum_layout';
import { onBossAddsSummonedForDeeds, setBossAddPendingForDeeds } from '../../deeds';
import { spawnKitAdd } from '../../mob/trash_kit/spawn';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import { dropEncounterBody, pickMarkTargets } from '../sunken_bastion/claim';
import {
  claimPlayers,
  clearCastIf,
  dropAuraById,
  dropEncounterObject,
  grantClaimDeed,
  holdPlanted,
  mechanicDamage,
  spawnSanctumObject,
  startBar,
} from './claim';
import {
  BONEWALKER_ID,
  SANCTUM_DEED_IDS,
  SANCTUM_HELD_STATUE,
  SANCTUM_MELT_STRIP,
  SANCTUM_PYRE_FLARE,
  SANCTUM_TRENCH_LANE,
  SANCTUM_UNQUENCHED_RING,
  SANCTUM_WARM_PUDDLE,
  VELKHAR_TUNING as T,
  VELKHAR_GRASP,
  VELKHAR_HELD,
  VELKHAR_SHADOW_VOLLEY,
  VELKHAR_SOULFIRE_TRENCH,
  VELKHAR_TITHE,
  VELKHAR_TWICE_WOKEN,
  VELKHAR_UNQUENCHED,
  VELKHAR_WAKING_THAW,
} from './ids';
import { inMeltwater, type MeltZones, rayToRim } from './meltwater';
import type { VelkharFightState, VelkharWalker } from './velkhar_state';

/** Seconds a pyre's flare object lingers after the flare (the fire dying down). */
const EMBER_LINGER = 1.5;
/** A Bonewalker that moved less than this in a tick is standing still. */
const STILL_EPS = 0.05;
/** Yards the climbing Bonewalkers stand from the pyre, toward the vault's middle. */
const CLIMB_OUT = 4;

function freshState(timers = true): VelkharFightState {
  return {
    kind: 'velkhar',
    thawTimer: timers ? T.thawFirst : 99,
    thawPool: 0,
    flare: null,
    embers: [],
    trenchTimer: timers ? T.trenchFirst : 99,
    volleyTimer: timers ? T.volleyFirst : 99,
    wavesFired: 0,
    plantedAt: null,
    painting: null,
    trenches: [],
    puddles: [],
    walkers: [],
    risers: [],
    statues: [],
    rises: 0,
    held: 0,
    casts: 0,
  };
}

/** Velkhar's fight state, started on his first engaged tick (a dev trigger
 *  starts it with its clocks parked, so only the triggered mechanic fires). */
export function velkharState(boss: Entity, timers = true): VelkharFightState {
  if (boss.sanctumFight?.kind !== 'velkhar') boss.sanctumFight = freshState(timers);
  return boss.sanctumFight;
}

/** The world spot of a thaw pool. */
function poolAt(
  ctx: SimContext,
  inst: InstanceSlot,
  i: number,
): { x: number; z: number; r: number } {
  const o = ctx.instanceOriginOf(inst);
  const p = THAW_POOLS[((i % THAW_POOLS.length) + THAW_POOLS.length) % THAW_POOLS.length];
  return { x: o.x + p.x, z: o.z + p.z, r: p.r };
}

/** The vault's meltwater right now (world coordinates). */
export function velkharMeltZones(
  ctx: SimContext,
  inst: InstanceSlot,
  st: VelkharFightState | null,
): MeltZones {
  return {
    pools: THAW_POOLS.map((_, i) => poolAt(ctx, inst, i)),
    strips: st ? st.trenches.filter((t) => t.melted) : [],
    puddles: st ? st.puddles.map((p) => ({ x: p.x, z: p.z, r: T.warmRadius })) : [],
    stripWidth: T.trenchWidth,
  };
}

/** The living player nearest a spot (ties to the lower id). */
function nearestPlayer(players: readonly Entity[], x: number, z: number): Entity | null {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const p of players) {
    const d = Math.hypot(p.pos.x - x, p.pos.z - z);
    if (d < bestD - 1e-9) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** Raise one Bonewalker at (x, z) into the fight (nearest player first). */
function raiseWalker(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VelkharFightState,
  x: number,
  z: number,
): Entity | null {
  const victim = nearestPlayer(claimPlayers(ctx, inst), x, z);
  const add = spawnKitAdd(ctx, inst, boss, BONEWALKER_ID, x, z, victim);
  if (!add) return null;
  add.facing = Math.atan2(boss.pos.x - x, boss.pos.z - z) + Math.PI;
  add.prevFacing = add.facing;
  st.walkers.push({ id: add.id, stillX: add.pos.x, stillZ: add.pos.z, still: 0, wet: false });
  onBossAddsSummonedForDeeds(ctx, boss, [add.id]);
  return add;
}

/** Bonewalkers climbing out of pool `i`: `count` of them on the pool's inner
 *  side, spread across it. */
function climbOut(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VelkharFightState,
  i: number,
  count: number,
): Entity[] {
  const pool = poolAt(ctx, inst, i);
  const o = ctx.instanceOriginOf(inst);
  const toMid = Math.atan2(o.x + RITUAL_VAULT.x - pool.x, o.z + RITUAL_VAULT.z - pool.z);
  const out: Entity[] = [];
  for (let k = 0; k < count; k++) {
    const spread = count === 1 ? 0 : (k / (count - 1) - 0.5) * 1.6;
    const a = toMid + spread;
    const add = raiseWalker(
      ctx,
      inst,
      boss,
      st,
      pool.x + Math.sin(a) * CLIMB_OUT,
      pool.z + Math.cos(a) * CLIMB_OUT,
    );
    if (add) {
      ctx.emit({
        type: 'spellfx',
        sourceId: add.id,
        targetId: add.id,
        school: 'shadow',
        fx: 'nova',
        ability: VELKHAR_WAKING_THAW,
      });
      out.push(add);
    }
  }
  return out;
}

/** A pyre flares now: the flare object takes the burst and lingers a moment. */
function flarePyre(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VelkharFightState,
  pool: number,
  objectId: number | null,
  count: number,
): Entity[] {
  const p = poolAt(ctx, inst, pool);
  const id =
    objectId ?? spawnSanctumObject(ctx, inst, SANCTUM_PYRE_FLARE, 'Thaw Pyre', p.x, p.z, p.r).id;
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: id,
    school: 'shadow',
    fx: 'nova',
    ability: VELKHAR_WAKING_THAW,
  });
  st.embers.push({ objectId: id, remaining: EMBER_LINGER });
  return climbOut(ctx, inst, boss, st, pool, count);
}

/** Waking Thaw: the next pyre in turn starts to roar (the warning). Returns
 *  the pool it roars in. */
export function startWakingThaw(
  ctx: SimContext,
  inst: InstanceSlot,
  st: VelkharFightState,
): number {
  if (st.flare) return st.flare.pool;
  const pool = st.thawPool % THAW_POOLS.length;
  st.thawPool = (pool + 1) % THAW_POOLS.length;
  const p = poolAt(ctx, inst, pool);
  const obj = spawnSanctumObject(ctx, inst, SANCTUM_PYRE_FLARE, 'Thaw Pyre', p.x, p.z, p.r);
  st.flare = { pool, objectId: obj.id, remaining: T.thawWarn };
  // The next roar starts a beat before the next flare is due.
  st.thawTimer = T.thawEvery + T.thawWarn;
  st.casts++;
  return pool;
}

/** Is he out of his vault (dragged off it)? The pools are out of his reach,
 *  so the dead climb out of the ice beside him instead. */
function outOfVault(ctx: SimContext, inst: InstanceSlot, boss: Entity): boolean {
  const o = ctx.instanceOriginOf(inst);
  return (
    Math.hypot(boss.pos.x - o.x - RITUAL_VAULT.x, boss.pos.z - o.z - RITUAL_VAULT.z) >
    RITUAL_VAULT.r + 2
  );
}

/** `count` Bonewalkers out of the ice in a ring beside him (a kited Velkhar). */
function raiseBeside(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VelkharFightState,
  count: number,
): Entity[] {
  const out: Entity[] = [];
  for (let k = 0; k < count; k++) {
    const a = boss.facing + (k * 2 * Math.PI) / count;
    const add = raiseWalker(
      ctx,
      inst,
      boss,
      st,
      boss.pos.x + Math.sin(a) * 3,
      boss.pos.z + Math.cos(a) * 3,
    );
    if (add) out.push(add);
  }
  return out;
}

/** The kept health waves: one Bonewalker climbs out of each pool. */
export function wakeWave(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VelkharFightState,
): Entity[] {
  st.wavesFired++;
  if (outOfVault(ctx, inst, boss)) return raiseBeside(ctx, inst, boss, st, THAW_POOLS.length);
  const out: Entity[] = [];
  for (let i = 0; i < THAW_POOLS.length; i++)
    out.push(...flarePyre(ctx, inst, boss, st, i, null, 1));
  return out;
}

/** Soulfire Trench: paint a lane toward a player. Returns true when it started. */
export function startSoulfireTrench(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VelkharFightState,
): boolean {
  if (boss.castingAbility !== null || st.painting) return false;
  const [victim] = pickMarkTargets(boss, claimPlayers(ctx, inst), 1, st.casts);
  if (!victim) return false;
  const o = ctx.instanceOriginOf(inst);
  const yaw = Math.atan2(victim.pos.x - boss.pos.x, victim.pos.z - boss.pos.z);
  const rim = { x: o.x + RITUAL_VAULT.x, z: o.z + RITUAL_VAULT.z, r: RITUAL_VAULT.r };
  const length = Math.max(4, rayToRim(boss.pos.x, boss.pos.z, yaw, rim, T.trenchLength));
  const obj = spawnSanctumObject(
    ctx,
    inst,
    SANCTUM_TRENCH_LANE,
    'Soulfire Trench',
    boss.pos.x,
    boss.pos.z,
    length,
  );
  obj.facing = yaw;
  obj.prevFacing = yaw;
  st.painting = {
    objectId: obj.id,
    x: boss.pos.x,
    z: boss.pos.z,
    yaw,
    length,
    remaining: T.trenchSeconds,
    melted: false,
  };
  st.trenchTimer = T.trenchEvery;
  st.casts++;
  st.plantedAt = { ...boss.pos };
  boss.facing = yaw;
  startBar(boss, VELKHAR_SOULFIRE_TRENCH, T.trenchCast, victim.id);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: victim.id,
    school: 'shadow',
    fx: 'windup',
    ability: VELKHAR_SOULFIRE_TRENCH,
  });
  return true;
}

/** The trench lands: everyone in the lane burns, and it melts into a strip. */
function landTrench(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VelkharFightState,
): number {
  const lane = st.painting;
  st.painting = null;
  if (!lane) return 0;
  const zones: MeltZones = {
    pools: [],
    strips: [lane],
    puddles: [],
    stripWidth: T.trenchWidth,
  };
  let n = 0;
  for (const p of claimPlayers(ctx, inst)) {
    if (!inMeltwater(zones, p.pos.x, p.pos.z)) continue;
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.trenchMin, T.trenchMax),
      false,
      'shadow',
      'Soulfire Trench',
      'hit',
      true,
    );
    n++;
  }
  const obj = ctx.entities.get(lane.objectId);
  if (obj) obj.templateId = SANCTUM_MELT_STRIP;
  lane.melted = true;
  lane.remaining = T.trenchSeconds;
  st.trenches.push(lane);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: lane.objectId,
    school: 'shadow',
    fx: 'nova',
    ability: VELKHAR_SOULFIRE_TRENCH,
  });
  return n;
}

/** Shadow Volley: a bar on him. */
export function startShadowVolley(boss: Entity, st: VelkharFightState): boolean {
  if (boss.castingAbility !== null || st.painting) return false;
  st.volleyTimer = T.volleyEvery;
  st.casts++;
  st.plantedAt = { ...boss.pos };
  startBar(boss, VELKHAR_SHADOW_VOLLEY, T.volleyCast, null);
  return true;
}

function landVolley(ctx: SimContext, inst: InstanceSlot, boss: Entity): number {
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'nova',
    ability: VELKHAR_SHADOW_VOLLEY,
  });
  let n = 0;
  for (const p of claimPlayers(ctx, inst)) {
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.volleyMin, T.volleyMax),
      false,
      'shadow',
      'Shadow Volley',
      'hit',
      true,
    );
    n++;
  }
  return n;
}

/** Heroic Warm Hands: a puddle under a Bonewalker. */
export function meltPuddle(
  ctx: SimContext,
  inst: InstanceSlot,
  st: VelkharFightState,
  x: number,
  z: number,
): void {
  const obj = spawnSanctumObject(ctx, inst, SANCTUM_WARM_PUDDLE, 'Warm Hands', x, z, T.warmRadius);
  st.puddles.push({ objectId: obj.id, x, z, remaining: T.warmSeconds });
}

/** A Bonewalker fell: decide what its death site makes of it (G24). */
function resolveDeath(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VelkharFightState,
  add: Entity,
): 'held' | 'unquenched' {
  const x = add.pos.x;
  const z = add.pos.z;
  if (inMeltwater(velkharMeltZones(ctx, inst, st), x, z)) {
    const ring = spawnSanctumObject(ctx, inst, SANCTUM_UNQUENCHED_RING, 'Unquenched', x, z, 1);
    st.risers.push({ corpseId: add.id, ringId: ring.id, x, z, remaining: T.riseDelay });
    setBossAddPendingForDeeds(ctx, boss, add.id, true);
    ctx.emit({
      type: 'spellfx',
      sourceId: ring.id,
      targetId: ring.id,
      school: 'shadow',
      fx: 'nova',
      ability: VELKHAR_UNQUENCHED,
    });
    return 'unquenched';
  }
  const statue = spawnSanctumObject(ctx, inst, SANCTUM_HELD_STATUE, 'Held', x, z, 1);
  statue.facing = add.facing;
  statue.prevFacing = add.facing;
  st.statues.push(statue.id);
  st.held++;
  ctx.emit({
    type: 'spellfx',
    sourceId: statue.id,
    targetId: statue.id,
    school: 'frost',
    fx: 'nova',
    ability: VELKHAR_HELD,
  });
  return 'held';
}

/** An Unquenched Bonewalker rises again: its sunk body goes, a new one climbs
 *  out where it fell, and Velkhar takes the tithe. */
function riseAgain(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VelkharFightState,
  corpseId: number,
  x: number,
  z: number,
): Entity | null {
  setBossAddPendingForDeeds(ctx, boss, corpseId, false);
  dropEncounterBody(ctx, inst, boss, corpseId);
  const add = raiseWalker(ctx, inst, boss, st, x, z);
  if (!add) return null;
  // A Bonewalker that rose again paid its kill already: no second XP (the
  // Mere Hydra's regrown-head rule), so meltwater is never an XP loop.
  add.regrown = true;
  st.rises++;
  if (inst.difficulty === 'heroic') {
    add.hp = add.maxHp;
    ctx.applyAura(add, {
      id: VELKHAR_TWICE_WOKEN,
      name: 'Twice-Woken',
      kind: 'buff_dmg_done',
      remaining: 3600,
      duration: 3600,
      permanent: true,
      value: T.twiceWokenDamage,
      sourceId: boss.id,
      school: 'shadow',
      undispellable: true,
    });
  } else {
    add.hp = Math.max(1, Math.round(add.maxHp * T.riseHpShare));
  }
  const heal = Math.min(boss.maxHp - boss.hp, Math.round(boss.maxHp * T.titheHeal));
  if (heal > 0) {
    boss.hp += heal;
    ctx.emit({ type: 'heal', targetId: boss.id, amount: heal });
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: add.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'nova',
    ability: VELKHAR_TITHE,
  });
  return add;
}

/** Grasp of the Thawed on, or off, as a Bonewalker steps in or out of water. */
function setGrasp(
  ctx: SimContext,
  boss: Entity,
  add: Entity,
  w: VelkharWalker,
  wet: boolean,
): void {
  if (wet === w.wet) return;
  w.wet = wet;
  if (!wet) {
    dropAuraById(add, VELKHAR_GRASP);
    return;
  }
  ctx.applyAura(add, {
    id: VELKHAR_GRASP,
    name: 'Grasp of the Thawed',
    kind: 'buff_dmg_done',
    remaining: 3600,
    duration: 3600,
    permanent: true,
    value: T.graspDamage,
    sourceId: boss.id,
    school: 'shadow',
    undispellable: true,
  });
}

/** Every tracked Bonewalker: deaths resolve by their site, the living read the
 *  water under them (Grasp) and, on heroic, how long they have stood still. */
function stepWalkers(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VelkharFightState,
): void {
  const heroic = inst.difficulty === 'heroic';
  const keep: VelkharWalker[] = [];
  for (const w of st.walkers) {
    const add = ctx.entities.get(w.id);
    if (!add) continue;
    if (add.dead || add.hp <= 0) {
      resolveDeath(ctx, inst, boss, st, add);
      continue;
    }
    keep.push(w);
  }
  st.walkers = keep;
  const zones = velkharMeltZones(ctx, inst, st);
  for (const w of st.walkers) {
    const add = ctx.entities.get(w.id) as Entity;
    setGrasp(ctx, boss, add, w, inMeltwater(zones, add.pos.x, add.pos.z));
    if (!heroic) continue;
    if (Math.hypot(add.pos.x - w.stillX, add.pos.z - w.stillZ) > STILL_EPS) {
      w.stillX = add.pos.x;
      w.stillZ = add.pos.z;
      w.still = 0;
      continue;
    }
    w.still += DT;
    if (w.still + 1e-9 >= T.warmStill) {
      w.still = 0;
      meltPuddle(ctx, inst, st, add.pos.x, add.pos.z);
    }
  }
}

/** The clocks of the floor: risers, strips, puddles and the dying flares. */
function stepFloor(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: VelkharFightState): void {
  if (st.risers.length > 0) {
    for (const r of st.risers) r.remaining -= DT;
    const due = st.risers.filter((r) => r.remaining <= 1e-9);
    if (due.length > 0) {
      st.risers = st.risers.filter((r) => r.remaining > 1e-9);
      for (const r of due) {
        dropEncounterObject(ctx, inst, r.ringId);
        riseAgain(ctx, inst, boss, st, r.corpseId, r.x, r.z);
      }
    }
  }
  for (const t of st.trenches) t.remaining -= DT;
  for (const t of st.trenches.filter((t) => t.remaining <= 1e-9))
    dropEncounterObject(ctx, inst, t.objectId);
  st.trenches = st.trenches.filter((t) => t.remaining > 1e-9);
  for (const p of st.puddles) p.remaining -= DT;
  for (const p of st.puddles.filter((p) => p.remaining <= 1e-9))
    dropEncounterObject(ctx, inst, p.objectId);
  st.puddles = st.puddles.filter((p) => p.remaining > 1e-9);
  for (const e of st.embers) e.remaining -= DT;
  for (const e of st.embers.filter((e) => e.remaining <= 1e-9))
    dropEncounterObject(ctx, inst, e.objectId);
  st.embers = st.embers.filter((e) => e.remaining > 1e-9);
}

/** Drop every object the fight put on the floor (statues too when `all`). */
function clearFloor(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VelkharFightState,
  all: boolean,
): void {
  const ids: number[] = [
    ...(st.flare ? [st.flare.objectId] : []),
    ...st.embers.map((e) => e.objectId),
    ...(st.painting ? [st.painting.objectId] : []),
    ...st.trenches.map((t) => t.objectId),
    ...st.puddles.map((p) => p.objectId),
    ...st.risers.map((r) => r.ringId),
    ...(all ? st.statues : []),
  ];
  for (const id of ids) dropEncounterObject(ctx, inst, id);
  for (const r of st.risers) setBossAddPendingForDeeds(ctx, boss, r.corpseId, false);
}

/** The pull ended without his death (an evade or a wipe): the dead and the
 *  floor go, the clocks and the waves start over. */
function endVelkharFight(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  clearCastIf(boss, VELKHAR_SOULFIRE_TRENCH, VELKHAR_SHADOW_VOLLEY);
  const st = boss.sanctumFight;
  if (st?.kind === 'velkhar') {
    clearFloor(ctx, inst, boss, st, true);
    for (const w of st.walkers) dropEncounterBody(ctx, inst, boss, w.id);
    for (const r of st.risers) dropEncounterBody(ctx, inst, boss, r.corpseId);
  }
  // Any Bonewalker still standing (or lying) from this pull goes too.
  for (const id of [...boss.summonedIds]) {
    const e = ctx.entities.get(id);
    if (e?.templateId === BONEWALKER_ID) dropEncounterBody(ctx, inst, boss, id);
  }
  boss.sanctumFight = undefined;
}

/** He fell: the rite breaks. Sunk Bonewalkers never rise; Cold Comfort is
 *  earned when none rose a second time. */
function velkharFell(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VelkharFightState,
): void {
  clearCastIf(boss, VELKHAR_SOULFIRE_TRENCH, VELKHAR_SHADOW_VOLLEY);
  // A Bonewalker that fell on the killing tick still counts where it fell.
  stepWalkers(ctx, inst, boss, st);
  if (st.rises === 0) grantClaimDeed(ctx, inst, SANCTUM_DEED_IDS.velkharCold);
  clearFloor(ctx, inst, boss, st, false);
  for (const w of st.walkers) {
    const add = ctx.entities.get(w.id);
    if (add) dropAuraById(add, VELKHAR_GRASP);
  }
  boss.sanctumFight = undefined;
}

/** One tick of Velkhar's fight (after the mob AI). */
export function tickVelkhar(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  engaged: boolean,
): void {
  const st0 = boss.sanctumFight?.kind === 'velkhar' ? boss.sanctumFight : null;
  if (boss.dead) {
    if (st0) velkharFell(ctx, inst, boss, st0);
    return;
  }
  if (!engaged) {
    if (st0) endVelkharFight(ctx, inst, boss);
    return;
  }
  const st = velkharState(boss);
  stepWalkers(ctx, inst, boss, st);
  stepFloor(ctx, inst, boss, st);
  // The kept health waves.
  const share = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
  while (st.wavesFired < T.waveAtHpPct.length && share <= T.waveAtHpPct[st.wavesFired])
    wakeWave(ctx, inst, boss, st);
  // Waking Thaw: the roar, then the flare. It runs through his bars.
  st.thawTimer -= DT;
  if (st.flare) {
    st.flare.remaining -= DT;
    if (st.flare.remaining <= 1e-9) {
      const f = st.flare;
      st.flare = null;
      if (outOfVault(ctx, inst, boss)) {
        dropEncounterObject(ctx, inst, f.objectId);
        raiseBeside(ctx, inst, boss, st, T.thawCount);
      } else flarePyre(ctx, inst, boss, st, f.pool, f.objectId, T.thawCount);
    }
  } else if (st.thawTimer <= T.thawWarn + 1e-9) startWakingThaw(ctx, inst, st);
  st.trenchTimer -= DT;
  st.volleyTimer -= DT;
  const bar = boss.castingAbility;
  if (bar === VELKHAR_SOULFIRE_TRENCH || bar === VELKHAR_SHADOW_VOLLEY) {
    if (st.plantedAt) holdPlanted(ctx, boss, st.plantedAt);
    if (bar === VELKHAR_SOULFIRE_TRENCH && st.painting) boss.facing = st.painting.yaw;
    boss.swingTimer = Math.max(boss.swingTimer, 0.6);
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    if (boss.castRemaining > 0) return;
    clearCastIf(boss, bar);
    st.plantedAt = null;
    if (bar === VELKHAR_SOULFIRE_TRENCH) landTrench(ctx, inst, boss, st);
    else landVolley(ctx, inst, boss);
    return;
  }
  if (st.painting) {
    // The bar was cut from outside: the lane is wiped with it.
    dropEncounterObject(ctx, inst, st.painting.objectId);
    st.painting = null;
  }
  if (bar !== null || ctx.isStunned(boss)) return;
  st.plantedAt = null;
  // One bar at a time: the trench first when both are due.
  if (st.trenchTimer <= 0) startSoulfireTrench(ctx, inst, boss, st);
  else if (st.volleyTimer <= 0) startShadowVolley(boss, st);
}

/** The Bonewalkers of the fight standing now, in raise order. */
export function velkharWalkers(ctx: SimContext, boss: Entity): Entity[] {
  const st = boss.sanctumFight?.kind === 'velkhar' ? boss.sanctumFight : null;
  if (!st) return [];
  const out: Entity[] = [];
  for (const w of st.walkers) {
    const e = ctx.entities.get(w.id);
    if (e && !e.dead) out.push(e);
  }
  return out;
}

/** `/dev sanctum trigger <mechanic>` for an engaged Velkhar: the reply line, or
 *  null when `what` is not one of his mechanics. */
export function velkharDevTrigger(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  what: string,
): string | null {
  const known = ['thaw', 'wave', 'trench', 'volley', 'warm', 'rise'];
  if (!known.includes(what)) return null;
  const st = velkharState(boss, false);
  if (what === 'trench' || what === 'volley') {
    clearCastIf(boss, VELKHAR_SOULFIRE_TRENCH, VELKHAR_SHADOW_VOLLEY);
    if (st.painting) dropEncounterObject(ctx, inst, st.painting.objectId);
    st.painting = null;
  }
  if (what === 'thaw') return `Waking Thaw (pool ${startWakingThaw(ctx, inst, st) + 1}).`;
  if (what === 'wave') return `A wave: ${wakeWave(ctx, inst, boss, st).length} Bonewalkers.`;
  if (what === 'trench')
    return startSoulfireTrench(ctx, inst, boss, st) ? 'Soulfire Trench.' : 'Nobody to aim at.';
  if (what === 'volley') return startShadowVolley(boss, st) ? 'Shadow Volley.' : 'Busy.';
  const add = velkharWalkers(ctx, boss)[0] ?? null;
  if (!add) return 'No Bonewalker stands: trigger thaw or wave first.';
  if (what === 'warm') {
    meltPuddle(ctx, inst, st, add.pos.x, add.pos.z);
    return 'Warm Hands: a puddle melts under a Bonewalker.';
  }
  // rise: drag it into the nearest pool and kill it there.
  const pool = THAW_POOLS.map((_, i) => poolAt(ctx, inst, i)).sort(
    (a, b) =>
      Math.hypot(a.x - add.pos.x, a.z - add.pos.z) - Math.hypot(b.x - add.pos.x, b.z - add.pos.z),
  )[0];
  add.pos = ctx.groundPos(pool.x + 2, pool.z);
  ctx.rebucket(add);
  add.hp = 0;
  ctx.handleDeath(add, nearestPlayer(claimPlayers(ctx, inst), add.pos.x, add.pos.z));
  return 'A Bonewalker sinks in the meltwater: it will rise again.';
}
