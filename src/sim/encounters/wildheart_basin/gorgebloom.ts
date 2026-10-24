// The Gorgebloom at the foot of the Weeping Falls (docs/design/dungeon-rework/
// wildheart_basin.md section 5.2): stomp the seeds, but only while you are
// clean. A carnivorous flower the size of a house, rooted on its dais; it
// never moves, it turns to face its targets.
//
//   Seed Rain   every 15 s a 1.5 s bar, then six Seedpods land on the loam
//               beds (one per bed). A clean player who walks over a pod stomps
//               it flat. A pod left alone sprouts a Thorn Sprout (an elite
//               biter) 12 s after it landed; it reads RIPE for its last 4 s.
//   Pollinate   every 10 s two players glow gold for 8 s. A pollinated touch
//               makes the pod sprout at once: the clean stomp, the pollinated
//               stay off the seeds.
//   Vine Lash   every 10 s a 1.5 s bar and a 30 yd lane toward a player (the
//               bloom turns and holds that aim): 180 to 220 and a 2 s root.
//   Gorge       every 15 s a 1.5 s bar on the tank, then twice its melee and
//               Digesting: 40 nature a second for 6 s.
//   Bloom Spit  the rooted bloom is never kited: once its target stands out of
//               its reach for 1.5 s it spits at it every 2 s.
//   Heroic      Burrowing Seeds: a pod not stomped within 6 s burrows and
//               rises as a sprout beside the nearest player. Pollen Cloud: a
//               player who stands within 3 yd of a pollinated one for 2 s is
//               pollinated too.
//
// The deed (Weed Control): defeat it without a single Thorn Sprout growing.
// When it dies its sprouts wither with it. Deterministic: the pod spots, the
// marks and the lash's mark are hashed (kitHash, pickMarkTargets); the only
// rng draws are damage rolls. Every visible state rides existing fields (the
// bars and the bloom's facing, the pod objects and their template ids, the
// Pollinated, root and Digesting auras, `spellfx` with the cast ids).

import { GORGEBLOOM_LOAM_BEDS } from '../../content/wildheart_basin_layout';
import { inLane } from '../../mob/trash_kit/lane';
import { spawnKitAdd } from '../../mob/trash_kit/spawn';
import { kitHash } from '../../mob/trash_kit/targets';
import { combatProfileForMob } from '../../mob_combat';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity, type GorgebloomFightState } from '../../types';
import {
  arenaPlayers,
  bossTarget,
  claimPlayers,
  clearCastIf,
  dropAuraById,
  dropEncounterBody,
  dropEncounterObject,
  grantClaimDeed,
  heavySwing,
  localOf,
  mechanicDamage,
  nearestPlayerTo,
  pickMarkTargets,
  spawnBasinObject,
  startBar,
} from './claim';
import {
  BLOOM_DIGESTING,
  BLOOM_GORGE,
  BLOOM_POLLINATE,
  BLOOM_POLLINATED,
  BLOOM_SEED_BURROW,
  BLOOM_SEED_RAIN,
  BLOOM_SEED_SPROUT,
  BLOOM_SEED_STOMP,
  BLOOM_SPIT,
  BLOOM_VINE_LASH,
  BLOOM_VINE_LASHED,
  GORGEBLOOM_DEED,
  GORGEBLOOM_LINES,
  BLOOM_TUNING as T,
  THORN_SPROUT_ID,
  WILDHEART_SEEDPOD,
  WILDHEART_SEEDPOD_RIPE,
} from './ids';

/** The terrace's players (the arena and a margin round it). */
const TERRACE = { x: 84, z: 42, r: 34 } as const;

function freshState(timers: boolean): GorgebloomFightState {
  const off = timers ? 0 : 99;
  return {
    kind: 'gorgebloom',
    seedTimer: T.seedFirst + off,
    pollinateTimer: T.pollinateFirst + off,
    lashTimer: T.lashFirst + off,
    gorgeTimer: T.gorgeFirst + off,
    lashYaw: null,
    pods: [],
    cloud: [],
    outOfReach: 0,
    spitTimer: 0,
    sprouted: false,
    casts: 0,
  };
}

/** The Gorgebloom's fight state, started on its first engaged tick (a dev
 *  trigger starts it with its clocks parked). */
export function bloomState(bloom: Entity, timers = true): GorgebloomFightState {
  if (bloom.wildheartFight?.kind !== 'gorgebloom') bloom.wildheartFight = freshState(timers);
  return bloom.wildheartFight;
}

/** The terrace's players, in entity-id order. */
export function terracePlayers(ctx: SimContext, inst: InstanceSlot): Entity[] {
  return arenaPlayers(ctx, inst, claimPlayers(ctx, inst), TERRACE.x, TERRACE.z, TERRACE.r);
}

function isPollinated(p: Entity): boolean {
  return p.auras.some((a) => a.id === BLOOM_POLLINATED);
}

/** Where pod `k` of a rain lands on bed `k`: a hashed spot inside the bed. */
export function podSpot(bloomId: number, salt: number, k: number): { x: number; z: number } {
  const bed = GORGEBLOOM_LOAM_BEDS[k % GORGEBLOOM_LOAM_BEDS.length];
  const h = kitHash(bloomId, salt * 13 + k);
  const a = ((h % 360) * Math.PI) / 180;
  const r = bed.r * 0.55 * (((h >>> 9) % 100) / 100);
  return { x: bed.x + Math.sin(a) * r, z: bed.z + Math.cos(a) * r };
}

/** Seed Rain's bar. Returns true when it started. */
export function startSeedRain(bloom: Entity, st: GorgebloomFightState): boolean {
  if (bloom.castingAbility !== null) return false;
  st.seedTimer = T.seedEvery;
  startBar(bloom, BLOOM_SEED_RAIN, T.seedCast, null);
  return true;
}

/** The pods land on the loam. Returns how many. */
export function rainSeeds(
  ctx: SimContext,
  inst: InstanceSlot,
  bloom: Entity,
  st: GorgebloomFightState,
): number {
  st.casts++;
  for (let k = 0; k < T.seedCount; k++) {
    const at = podSpot(bloom.id, st.casts, k);
    const pod = spawnBasinObject(ctx, inst, WILDHEART_SEEDPOD, 'Seedpod', at.x, at.z, T.podTouch);
    st.pods.push({ objectId: pod.id, x: at.x, z: at.z, age: 0 });
    ctx.emit({
      type: 'spellfx',
      sourceId: bloom.id,
      targetId: pod.id,
      school: 'nature',
      fx: 'projectile',
      ability: BLOOM_SEED_RAIN,
    });
  }
  ctx.emit({ type: 'log', text: GORGEBLOOM_LINES.seeds, color: '#e8e05a', entityId: bloom.id });
  return T.seedCount;
}

/** A Thorn Sprout rises at an instance-local spot, straight into the fight
 *  on the nearest player. */
function sprout(
  ctx: SimContext,
  inst: InstanceSlot,
  bloom: Entity,
  st: GorgebloomFightState,
  lx: number,
  lz: number,
): Entity | null {
  st.sprouted = true;
  const o = ctx.instanceOriginOf(inst);
  const victim = nearestPlayerTo(terracePlayers(ctx, inst), o.x + lx, o.z + lz);
  const add = spawnKitAdd(ctx, inst, bloom, THORN_SPROUT_ID, o.x + lx, o.z + lz, victim);
  ctx.emit({
    type: 'spellfx',
    sourceId: bloom.id,
    targetId: add?.id ?? bloom.id,
    school: 'nature',
    fx: 'nova',
    ability: BLOOM_SEED_SPROUT,
  });
  ctx.emit({ type: 'log', text: GORGEBLOOM_LINES.sprout, color: '#e8a050', entityId: bloom.id });
  return add;
}

/** Heroic Burrowing Seeds: the pod sinks and rises beside the nearest player. */
function burrow(
  ctx: SimContext,
  inst: InstanceSlot,
  bloom: Entity,
  st: GorgebloomFightState,
  pod: GorgebloomFightState['pods'][number],
): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: bloom.id,
    targetId: pod.objectId,
    school: 'nature',
    fx: 'nova',
    ability: BLOOM_SEED_BURROW,
  });
  const o = ctx.instanceOriginOf(inst);
  const near = nearestPlayerTo(terracePlayers(ctx, inst), o.x + pod.x, o.z + pod.z);
  if (!near) {
    sprout(ctx, inst, bloom, st, pod.x, pod.z);
    return;
  }
  // It rises 2.5 yd off the player, on the side the pod lay.
  const at = localOf(ctx, inst, near);
  const dx = pod.x - at.x;
  const dz = pod.z - at.z;
  const d = Math.hypot(dx, dz) || 1;
  sprout(ctx, inst, bloom, st, at.x + (dx / d) * 2.5, at.z + (dz / d) * 2.5);
}

/** Pods: stomped by a clean touch, sprung by a pollinated one, ripened and
 *  sprouted (or, on heroic, burrowed) by age. */
function stepPods(
  ctx: SimContext,
  inst: InstanceSlot,
  bloom: Entity,
  st: GorgebloomFightState,
  players: readonly Entity[],
): void {
  const heroic = inst.difficulty === 'heroic';
  const life = heroic ? T.heroicBurrow : T.podSprout;
  for (let i = st.pods.length - 1; i >= 0; i--) {
    const pod = st.pods[i];
    pod.age += DT;
    let toucher: Entity | null = null;
    for (const p of players) {
      const at = localOf(ctx, inst, p);
      if (Math.hypot(at.x - pod.x, at.z - pod.z) <= T.podTouch + 0.5) {
        toucher = p;
        break;
      }
    }
    if (toucher && !isPollinated(toucher)) {
      // Squelch: a clean stomp flattens it.
      ctx.emit({
        type: 'spellfx',
        sourceId: toucher.id,
        targetId: pod.objectId,
        school: 'nature',
        fx: 'nova',
        ability: BLOOM_SEED_STOMP,
      });
      st.pods.splice(i, 1);
      dropEncounterObject(ctx, inst, pod.objectId);
      continue;
    }
    if (toucher || pod.age >= life) {
      st.pods.splice(i, 1);
      dropEncounterObject(ctx, inst, pod.objectId);
      if (!toucher && heroic) burrow(ctx, inst, bloom, st, pod);
      else sprout(ctx, inst, bloom, st, pod.x, pod.z);
      continue;
    }
    if (pod.age >= life - T.podRipeFor) {
      const obj = ctx.entities.get(pod.objectId);
      if (obj && obj.templateId !== WILDHEART_SEEDPOD_RIPE) obj.templateId = WILDHEART_SEEDPOD_RIPE;
    }
  }
}

function pollinate(ctx: SimContext, bloom: Entity, p: Entity): void {
  ctx.applyAura(p, {
    id: BLOOM_POLLINATED,
    name: 'Pollinated',
    kind: 'vulnerability',
    remaining: T.pollinateSeconds,
    duration: T.pollinateSeconds,
    value: 0,
    sourceId: bloom.id,
    school: 'nature',
    undispellable: true,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: bloom.id,
    targetId: p.id,
    school: 'nature',
    fx: 'windup',
    ability: BLOOM_POLLINATE,
  });
}

/** Pollinate: two players (never one already gold) glow for 8 s. Returns
 *  how many it took. */
export function startPollinate(
  ctx: SimContext,
  inst: InstanceSlot,
  bloom: Entity,
  st: GorgebloomFightState,
): number {
  st.casts++;
  st.pollinateTimer = T.pollinateEvery;
  const players = terracePlayers(ctx, inst);
  const busy = new Set(players.filter(isPollinated).map((p) => p.id));
  const picks = pickMarkTargets(bloom, players, T.pollinateCount, st.casts, busy);
  for (const p of picks) pollinate(ctx, bloom, p);
  return picks.length;
}

/** Heroic Pollen Cloud: 2 s beside a pollinated player pollinates you too. */
function stepPollenCloud(
  ctx: SimContext,
  bloom: Entity,
  st: GorgebloomFightState,
  players: readonly Entity[],
): void {
  const gold = players.filter(isPollinated);
  const next: GorgebloomFightState['cloud'] = [];
  for (const p of players) {
    if (gold.includes(p)) continue;
    const near = gold.some((g) => dist2d(g.pos, p.pos) <= T.cloudRadius);
    if (!near) continue;
    const t = (st.cloud.find((c) => c.playerId === p.id)?.t ?? 0) + DT;
    if (t >= T.cloudSeconds - 1e-9) pollinate(ctx, bloom, p);
    else next.push({ playerId: p.id, t });
  }
  st.cloud = next;
}

/** Vine Lash's bar toward a player (a hashed non-tank). Returns the target,
 *  or null when nobody stands on the terrace. */
export function startVineLash(
  ctx: SimContext,
  inst: InstanceSlot,
  bloom: Entity,
  st: GorgebloomFightState,
): Entity | null {
  if (bloom.castingAbility !== null) return null;
  st.casts++;
  st.lashTimer = T.lashEvery;
  const [target] = pickMarkTargets(bloom, terracePlayers(ctx, inst), 1, st.casts);
  if (!target) return null;
  st.lashYaw = Math.atan2(target.pos.x - bloom.pos.x, target.pos.z - bloom.pos.z);
  bloom.facing = st.lashYaw;
  startBar(bloom, BLOOM_VINE_LASH, T.lashCast, target.id);
  return target;
}

/** The lash lands along its locked lane. Returns how many it struck. */
function landVineLash(
  ctx: SimContext,
  inst: InstanceSlot,
  bloom: Entity,
  st: GorgebloomFightState,
): number {
  const yaw = st.lashYaw ?? bloom.facing;
  st.lashYaw = null;
  ctx.emit({
    type: 'spellfx',
    sourceId: bloom.id,
    targetId: bloom.id,
    school: 'nature',
    fx: 'nova',
    ability: BLOOM_VINE_LASH,
  });
  let n = 0;
  for (const p of claimPlayers(ctx, inst)) {
    if (!inLane(bloom.pos.x, bloom.pos.z, yaw, T.lashLength, T.lashHalfWidth, p.pos.x, p.pos.z))
      continue;
    ctx.dealDamage(
      bloom,
      p,
      mechanicDamage(ctx, bloom, T.lashMin, T.lashMax),
      false,
      'nature',
      'Vine Lash',
      'hit',
      true,
    );
    if (!p.dead) {
      ctx.applyAura(p, {
        id: BLOOM_VINE_LASHED,
        name: 'Vine Lashed',
        kind: 'root',
        remaining: T.lashRoot,
        duration: T.lashRoot,
        value: 0,
        sourceId: bloom.id,
        school: 'nature',
      });
    }
    n++;
  }
  return n;
}

/** Gorge's bar on the tank. Returns true when it started. */
export function startGorge(ctx: SimContext, bloom: Entity, st: GorgebloomFightState): boolean {
  if (bloom.castingAbility !== null) return false;
  const tank = bossTarget(ctx, bloom);
  if (!tank) return false;
  st.gorgeTimer = T.gorgeEvery;
  startBar(bloom, BLOOM_GORGE, T.gorgeCast, tank.id);
  return true;
}

/** Gorge lands: a heavy bite and Digesting. */
function landGorge(ctx: SimContext, bloom: Entity, tank: Entity): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: bloom.id,
    targetId: tank.id,
    school: 'nature',
    fx: 'nova',
    ability: BLOOM_GORGE,
  });
  heavySwing(ctx, bloom, tank, T.gorgeMult, 'Gorge');
  if (tank.dead) return;
  ctx.applyAura(tank, {
    id: BLOOM_DIGESTING,
    name: 'Digesting',
    kind: 'dot',
    remaining: T.digestSeconds,
    duration: T.digestSeconds,
    value: Math.max(1, Math.round(T.digestPerSecond * (bloom.mechanicDamageMult ?? 1))),
    tickInterval: 1,
    tickTimer: 1,
    sourceId: bloom.id,
    school: 'nature',
  });
}

/** Bloom Spit: a target it cannot reach is spat at (never kited). */
function stepSpit(ctx: SimContext, bloom: Entity, st: GorgebloomFightState): void {
  const target = bossTarget(ctx, bloom);
  st.spitTimer = Math.max(0, st.spitTimer - DT);
  if (!target) {
    st.outOfReach = 0;
    return;
  }
  const reach = combatProfileForMob(bloom.templateId, bloom.scale).meleeRange + 0.5;
  if (dist2d(bloom.pos, target.pos) <= reach + 0.5) {
    st.outOfReach = 0;
    return;
  }
  st.outOfReach += DT;
  if (st.outOfReach < T.spitDelay || st.spitTimer > 0 || bloom.castingAbility !== null) return;
  st.spitTimer = T.spitEvery;
  bloom.facing = Math.atan2(target.pos.x - bloom.pos.x, target.pos.z - bloom.pos.z);
  ctx.emit({
    type: 'spellfx',
    sourceId: bloom.id,
    targetId: target.id,
    school: 'nature',
    fx: 'projectile',
    ability: BLOOM_SPIT,
  });
  ctx.dealDamage(
    bloom,
    target,
    mechanicDamage(ctx, bloom, T.spitMin, T.spitMax),
    false,
    'nature',
    'Bloom Spit',
    'hit',
    true,
  );
}

/** Its sprouts wither with it (or with the pull). */
function witherSprouts(ctx: SimContext, inst: InstanceSlot, bloom: Entity): void {
  for (const id of [...bloom.summonedIds]) {
    const add = ctx.entities.get(id);
    if (add?.templateId !== THORN_SPROUT_ID) continue;
    if (!add.dead) {
      ctx.emit({
        type: 'spellfx',
        sourceId: add.id,
        targetId: add.id,
        school: 'nature',
        fx: 'nova',
        ability: BLOOM_SEED_BURROW,
      });
    }
    dropEncounterBody(ctx, inst, bloom, id);
  }
}

/** The pull ended: the pods and the gold go, the sprouts wither. */
function endBloomFight(ctx: SimContext, inst: InstanceSlot, bloom: Entity): void {
  const st = bloom.wildheartFight?.kind === 'gorgebloom' ? bloom.wildheartFight : null;
  if (st) for (const pod of st.pods) dropEncounterObject(ctx, inst, pod.objectId);
  for (const p of claimPlayers(ctx, inst)) dropAuraById(p, BLOOM_POLLINATED);
  witherSprouts(ctx, inst, bloom);
  clearCastIf(bloom, BLOOM_SEED_RAIN, BLOOM_VINE_LASH, BLOOM_GORGE);
  bloom.wildheartFight = undefined;
}

/** One tick of the Gorgebloom (after the mob AI). */
export function tickGorgebloom(
  ctx: SimContext,
  inst: InstanceSlot,
  bloom: Entity,
  engaged: boolean,
): void {
  const live = bloom.wildheartFight?.kind === 'gorgebloom' ? bloom.wildheartFight : null;
  if (bloom.dead) {
    if (live) {
      if (!live.sprouted) grantClaimDeed(ctx, inst, GORGEBLOOM_DEED);
      endBloomFight(ctx, inst, bloom);
    }
    return;
  }
  if (!engaged) {
    if (live) endBloomFight(ctx, inst, bloom);
    return;
  }
  const st = bloomState(bloom);
  const players = terracePlayers(ctx, inst);
  stepPods(ctx, inst, bloom, st, players);
  if (inst.difficulty === 'heroic') stepPollenCloud(ctx, bloom, st, players);
  st.pollinateTimer -= DT;
  if (st.pollinateTimer <= 0) startPollinate(ctx, inst, bloom, st);
  stepSpit(ctx, bloom, st);
  const bar = bloom.castingAbility;
  if (bar === BLOOM_SEED_RAIN || bar === BLOOM_VINE_LASH || bar === BLOOM_GORGE) {
    if (bar === BLOOM_VINE_LASH && st.lashYaw !== null) bloom.facing = st.lashYaw;
    bloom.swingTimer = Math.max(bloom.swingTimer, 0.6);
    bloom.castRemaining = Math.max(0, bloom.castRemaining - DT);
    if (bloom.castRemaining > 0) return;
    const targetId = bloom.castTargetId;
    clearCastIf(bloom, bar);
    if (bar === BLOOM_SEED_RAIN) rainSeeds(ctx, inst, bloom, st);
    else if (bar === BLOOM_VINE_LASH) landVineLash(ctx, inst, bloom, st);
    else {
      const tank = targetId !== null ? ctx.entities.get(targetId) : undefined;
      if (tank && !tank.dead) landGorge(ctx, bloom, tank);
    }
    return;
  }
  st.seedTimer -= DT;
  st.lashTimer -= DT;
  st.gorgeTimer -= DT;
  if (bar !== null || ctx.isStunned(bloom)) return;
  // One bar at a time: the bite first, then the seeds, then the lash.
  if (st.gorgeTimer <= 0 && startGorge(ctx, bloom, st)) return;
  if (st.seedTimer <= 0 && startSeedRain(bloom, st)) return;
  if (st.lashTimer <= 0) startVineLash(ctx, inst, bloom, st);
}
