// The Mere Hydra's three elements (docs/design/dungeon-rework/drowned_temple.md
// 4.3, sixth pass): each head is an element with its own attack, and whoever
// wields an element casts it (its own head, or the survivor that inherited it,
// ids.ts hydraElementOwners).
//
//   Freezing Breath   ICE, the left head: a 2 s bar, then a 60 degree cone of
//                 frost 18 yd long (110 to 130) that chills (30 percent slower
//                 for 4 s). The cone locks on its victim's spot as the bar starts.
//   Venom Spit    VENOM, the centre head: three 4 yd pools under three
//                 players, bursting 1.5 s later (60 to 75 nature), each leaving
//                 venom that burns 20 a second for 6 s. Spread, then step out.
//   Crushing Torrent WATER, the right head: a 2 s bar, then a 26 yd lane of water
//                 (90 to 110 frost) that hurls everyone in it 8 yd down the
//                 lane. The lane locks as the bar starts: step out sideways.
//
// Zero rng in every pick (the victims are hashed); the only draws are the
// damage rolls, in player order.

import { inLane } from '../../mob/trash_kit/lane';
import { inCone, kitHash } from '../../mob/trash_kit/targets';
import { pullToward } from '../../pull_toward';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { angleTo, DT, dist2d, type Entity, type HydraFightState } from '../../types';
import {
  claimPlayers,
  clearCastOf,
  dropEncounterObject,
  mechanicDamage,
  spawnTempleObject,
  startCast,
} from './claim';
import {
  BRINE_SPIT_TEMPLATE,
  HYDRA_BRINE_SPIT,
  HYDRA_CRUSHING_TORRENT,
  HYDRA_FROSTBITE,
  HYDRA_TIDE_BREATH,
  HYDRA_TUNING,
  POOL,
  VENOM_POOL_TEMPLATE,
} from './ids';

const T = HYDRA_TUNING;

/** Players round the pool (its rim and a margin). */
export function poolPlayers(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const o = ctx.instanceOriginOf(inst);
  return claimPlayers(ctx, inst).filter(
    (p) => !p.dead && Math.hypot(p.pos.x - o.x - POOL.x, p.pos.z - o.z - POOL.z) <= POOL.r + 14,
  );
}

function hashedPick(players: readonly Entity[], seed: number, salt: number): Entity | null {
  if (players.length === 0) return null;
  return players[kitHash(seed, salt) % players.length];
}

/** Someone in reach who is not the tank, when anyone else is there. */
function victimFor(
  ctx: SimContext,
  inst: InstanceSlot,
  head: Entity,
  reach: number,
  st: HydraFightState,
): Entity | null {
  const players = poolPlayers(ctx, inst).filter((p) => dist2d(p.pos, head.pos) <= reach);
  st.casts++;
  const others = players.filter((p) => p.id !== head.aggroTargetId);
  return hashedPick(others.length > 0 ? others : players, head.id, st.casts);
}

// ---- ice: the Freezing Breath ------------------------------------------------------------

/** Start a Freezing Breath on `head`, aimed at a hashed victim. */
export function startTideBreath(
  ctx: SimContext,
  inst: InstanceSlot,
  head: Entity,
  st: HydraFightState,
): boolean {
  const victim = victimFor(ctx, inst, head, T.breathRange + 4, st);
  if (!victim) return false;
  head.facing = angleTo(head.pos, victim.pos);
  head.prevFacing = head.facing;
  startCast(head, HYDRA_TIDE_BREATH, T.breathCast, victim.id);
  return true;
}

function landBreath(ctx: SimContext, inst: InstanceSlot, head: Entity): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: head.id,
    targetId: head.id,
    school: 'frost',
    fx: 'frostCone',
    ability: HYDRA_TIDE_BREATH,
    range: T.breathRange,
    angle: T.breathArcDeg,
  });
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead || !inCone(head.pos, head.facing, p.pos, T.breathRange, T.breathArcDeg)) continue;
    ctx.dealDamage(
      head,
      p,
      mechanicDamage(ctx, head, T.breathMin, T.breathMax),
      false,
      'frost',
      'Freezing Breath',
      'hit',
      true,
    );
    if (p.dead) continue;
    ctx.applyAura(p, {
      id: HYDRA_FROSTBITE,
      name: 'Frostbitten',
      kind: 'slow',
      remaining: T.chillSeconds,
      duration: T.chillSeconds,
      value: T.chillSlow,
      sourceId: head.id,
      school: 'frost',
    });
  }
}

/** Advance a Freezing Breath bar; the cone lands when it runs out. */
export function stepBreath(ctx: SimContext, inst: InstanceSlot, head: Entity): void {
  if (head.castingAbility !== HYDRA_TIDE_BREATH) return;
  head.swingTimer = Math.max(head.swingTimer, 0.6);
  // The cone holds the aim it took when the bar started.
  head.facing = head.prevFacing;
  head.castRemaining = Math.max(0, head.castRemaining - DT);
  if (head.castRemaining > 0) return;
  clearCastOf(head, HYDRA_TIDE_BREATH);
  landBreath(ctx, inst, head);
}

// ---- venom: the Venom Spit ---------------------------------------------------------

/** Spit three venom pools under three players (fewer when fewer stand there). */
export function startBrineSpit(
  ctx: SimContext,
  inst: InstanceSlot,
  head: Entity,
  st: HydraFightState,
): number {
  const players = poolPlayers(ctx, inst);
  const o = ctx.instanceOriginOf(inst);
  const picked: Entity[] = [];
  for (let k = 0; k < T.spitCount && picked.length < players.length; k++) {
    st.casts++;
    const pool = players.filter((p) => !picked.includes(p));
    const p = hashedPick(pool, head.id, st.casts * 5 + k);
    if (p) picked.push(p);
  }
  for (const p of picked) {
    const x = p.pos.x - o.x;
    const z = p.pos.z - o.z;
    const obj = spawnTempleObject(ctx, inst, BRINE_SPIT_TEMPLATE, 'Venom Spit', x, z, T.spitRadius);
    st.spits.push({ x, z, remaining: T.spitWarn, objectId: obj.id });
  }
  if (picked.length > 0) {
    ctx.emit({
      type: 'spellfx',
      sourceId: head.id,
      targetId: picked[0].id,
      school: 'nature',
      fx: 'windup',
      ability: HYDRA_BRINE_SPIT,
    });
  }
  return picked.length;
}

/** The spit pools burst (each leaves venom), and the venom burns and dries. */
export function stepVenom(
  ctx: SimContext,
  inst: InstanceSlot,
  st: HydraFightState,
  source: Entity,
): void {
  const o = ctx.instanceOriginOf(inst);
  for (let i = st.spits.length - 1; i >= 0; i--) {
    const s = st.spits[i];
    s.remaining -= DT;
    if (s.remaining > 0) continue;
    st.spits.splice(i, 1);
    ctx.emit({
      type: 'spellfx',
      sourceId: source.id,
      targetId: s.objectId,
      school: 'nature',
      fx: 'nova',
      ability: HYDRA_BRINE_SPIT,
    });
    for (const p of claimPlayers(ctx, inst)) {
      if (p.dead || Math.hypot(p.pos.x - o.x - s.x, p.pos.z - o.z - s.z) > T.spitRadius) continue;
      ctx.dealDamage(
        source,
        p,
        mechanicDamage(ctx, source, T.spitMin, T.spitMax),
        false,
        'nature',
        'Venom Spit',
        'hit',
        true,
      );
    }
    dropEncounterObject(ctx, inst, s.objectId);
    const venom = spawnTempleObject(
      ctx,
      inst,
      VENOM_POOL_TEMPLATE,
      'Venom',
      s.x,
      s.z,
      T.venomRadius,
    );
    st.venom.push({ x: s.x, z: s.z, remaining: T.venomSeconds, objectId: venom.id });
  }
  for (let i = st.venom.length - 1; i >= 0; i--) {
    const v = st.venom[i];
    const before = v.remaining;
    v.remaining -= DT;
    // A burn on every whole second the venom has stood.
    if (Math.floor(T.venomSeconds - v.remaining) > Math.floor(T.venomSeconds - before)) {
      for (const p of claimPlayers(ctx, inst)) {
        if (p.dead || Math.hypot(p.pos.x - o.x - v.x, p.pos.z - o.z - v.z) > T.venomRadius)
          continue;
        const amount = Math.max(1, Math.round(T.venomPerSecond * (source.mechanicDamageMult ?? 1)));
        ctx.dealDamage(source, p, amount, false, 'nature', 'Venom', 'hit', true);
      }
    }
    if (v.remaining > 0) continue;
    dropEncounterObject(ctx, inst, v.objectId);
    st.venom.splice(i, 1);
  }
}

// ---- water: the Crushing Torrent --------------------------------------------------------

/** Start a Crushing Torrent on `head`: the lane locks toward a hashed victim. */
export function startTorrent(
  ctx: SimContext,
  inst: InstanceSlot,
  head: Entity,
  st: HydraFightState,
): boolean {
  const victim = victimFor(ctx, inst, head, T.torrentLength + 4, st);
  if (!victim) return false;
  const yaw = angleTo(head.pos, victim.pos);
  head.facing = yaw;
  head.prevFacing = yaw;
  st.torrent = { headId: head.id, yaw };
  startCast(head, HYDRA_CRUSHING_TORRENT, T.torrentCast, victim.id);
  return true;
}

function landTorrent(ctx: SimContext, inst: InstanceSlot, head: Entity, yaw: number): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: head.id,
    targetId: head.id,
    school: 'frost',
    fx: 'heavyBolt',
    ability: HYDRA_CRUSHING_TORRENT,
  });
  const ax = Math.sin(yaw);
  const az = Math.cos(yaw);
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead) continue;
    const { x, z } = head.pos;
    if (!inLane(x, z, yaw, T.torrentLength, T.torrentHalfWidth, p.pos.x, p.pos.z)) continue;
    ctx.dealDamage(
      head,
      p,
      mechanicDamage(ctx, head, T.torrentMin, T.torrentMax),
      false,
      'frost',
      'Crushing Torrent',
      'hit',
      true,
    );
    // Hurled on down the lane, the way the water runs.
    if (!p.dead)
      pullToward(ctx, p, p.pos.x + ax * 1000, p.pos.z + az * 1000, T.torrentKnockback, 0);
  }
}

/** Advance a Crushing Torrent bar; the lane lands when it runs out. */
export function stepTorrent(
  ctx: SimContext,
  inst: InstanceSlot,
  head: Entity,
  st: HydraFightState,
): void {
  if (head.castingAbility !== HYDRA_CRUSHING_TORRENT) return;
  head.swingTimer = Math.max(head.swingTimer, 0.6);
  const aim = st.torrent?.headId === head.id ? st.torrent.yaw : head.prevFacing;
  head.facing = aim;
  head.castRemaining = Math.max(0, head.castRemaining - DT);
  if (head.castRemaining > 0) return;
  clearCastOf(head, HYDRA_CRUSHING_TORRENT);
  landTorrent(ctx, inst, head, aim);
  st.torrent = null;
}
