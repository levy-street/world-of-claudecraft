// The Sledge Tusker's soulfire trail (sledge_tusker.ts): while its sledge is
// still hitched (above half health) every Trample drags the burning braziers
// down the lane, and the lane it ran burns for 30 s: a strip from the lane's
// start as far as its centre ran, 2 yd either side of its line, 36 to 44 a
// second (the spilled patches' own rate) to anyone standing in it.
//
// A trail is ONE encounter object at the strip's start: its facing is the
// strip's yaw, its scale the strip's length, and its cast bar the seconds it
// has left (ids.ts SANCTUM_SOULFIRE_TRAIL, SANCTUM_TRAIL_BURN), so the online
// client mirrors the strip and its clock with no wire change. The fight state
// keeps the same numbers for the burn.
//
// Deterministic: no pick is rolled; the only rng draws are the burns' damage
// rolls, trail by trail in the order they were laid, player by player in
// claim order.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity, type TuskerFightState, type TuskerLane } from '../../types';
import { claimPlayers, dropEncounterObject, mechanicDamage, spawnSanctumObject } from './claim';
import { SANCTUM_SOULFIRE_TRAIL, SANCTUM_TRAIL_BURN, TUSKER_TUNING as T } from './ids';
import { inTrail } from './tusker_road';

/** The damage name of a trail's burn (re-localized by src/ui/sim_i18n.ts). */
export const TRAIL_DAMAGE_NAME = 'Soulfire Trail';

/** Lay a trail down the lane the charge is setting off along. Returns true
 *  when one was laid (a lunge too short to spill anything leaves none). */
export function layTrail(
  ctx: SimContext,
  inst: InstanceSlot,
  st: TuskerFightState,
  lane: TuskerLane,
): boolean {
  if (lane.length < T.trailMinLength) return false;
  // Never more than trailMax at once: the oldest goes out first (in play the
  // 16 s Trample clock against the 30 s burn already keeps it to two).
  while (st.trails.length >= T.trailMax) {
    const oldest = st.trails.shift();
    if (oldest) dropEncounterObject(ctx, inst, oldest.objectId);
  }
  const o = ctx.instanceOriginOf(inst);
  const x = o.x + lane.x;
  const z = o.z + lane.z;
  const obj = spawnSanctumObject(
    ctx,
    inst,
    SANCTUM_SOULFIRE_TRAIL,
    TRAIL_DAMAGE_NAME,
    x,
    z,
    lane.length,
  );
  obj.respawnTimer = Number.POSITIVE_INFINITY;
  obj.facing = lane.yaw;
  obj.prevFacing = lane.yaw;
  paintClock(obj, T.trailSeconds);
  st.trails.push({
    objectId: obj.id,
    x,
    z,
    yaw: lane.yaw,
    length: lane.length,
    remaining: T.trailSeconds,
    tick: T.trailTick,
  });
  return true;
}

function paintClock(obj: Entity, left: number): void {
  obj.castingAbility = SANCTUM_TRAIL_BURN;
  obj.castTotal = T.trailSeconds;
  obj.castRemaining = Math.max(0, left);
  obj.castTargetId = null;
  obj.channeling = false;
}

/** The burning trails: count down, scorch whoever stands in one each second,
 *  and go out. Runs through a paused fight and after the Tusker's death (a
 *  lost target never freezes fire on the road). */
export function stepTrails(
  ctx: SimContext,
  inst: InstanceSlot,
  tusker: Entity,
  st: TuskerFightState,
): void {
  if (st.trails.length === 0) return;
  const players = claimPlayers(ctx, inst);
  let spent = false;
  for (const trail of st.trails) {
    trail.remaining -= DT;
    trail.tick -= DT;
    if (trail.remaining <= 1e-9) {
      spent = true;
      continue;
    }
    const obj = ctx.entities.get(trail.objectId);
    if (obj) paintClock(obj, trail.remaining);
    if (trail.tick > 1e-9) continue;
    trail.tick += T.trailTick;
    for (const p of players) {
      if (p.dead || !inTrail(trail.x, trail.z, trail.yaw, trail.length, p.pos.x, p.pos.z)) continue;
      ctx.dealDamage(
        tusker,
        p,
        mechanicDamage(ctx, tusker, T.patchMin, T.patchMax),
        false,
        'shadow',
        TRAIL_DAMAGE_NAME,
        'hit',
        true,
      );
    }
  }
  if (!spent) return;
  for (const trail of st.trails)
    if (trail.remaining <= 1e-9) dropEncounterObject(ctx, inst, trail.objectId);
  st.trails = st.trails.filter((trail) => trail.remaining > 1e-9);
}

/** The pull ended: every trail goes out at once. */
export function clearTrails(ctx: SimContext, inst: InstanceSlot, st: TuskerFightState): void {
  for (const trail of st.trails) dropEncounterObject(ctx, inst, trail.objectId);
  st.trails = [];
}
