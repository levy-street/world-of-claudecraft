// The Gyre's wind, per player (the lanes and pockets themselves are the leaf module
// quartered_gyre_wind.ts, the velocity law the pure quartered_gyre_current.ts): put the Gale Lane on a
// body in a lane and let the gale carry it up the track, and lift a body that steps into, or hops
// over, a launch opening up over the face onto the next turn of the road; and throw a body, living
// or a released spirit, that steps onto one of the two wind pads up to the crown or back down to the
// foot (quartered_gyre_pads.ts). Called once per player per tick from the environment step
// (environment_damage.ts), after the frozen lakes' slick; that step visits the dead too.
//
// Only a body the motion kernel steers is carried or lifted, on foot or mounted: a stun, a root, a
// fear or a feigned death holds it where it stands, and a charge, a follow, a leap, a climb, a
// vehicle, a mount race or a lance brace owns its step already. The gale also lets a body that
// wears its aura keep a hop to the road (it carries the same velocity through the air, so a jump
// on a bend does not fly the tangent off the face), never holds a body below the pace it would run
// or ride at on its own, and holds one that has left the lane to what the gale gave it.
// Deterministic: no rng, no clock; a player nowhere near the peak costs one squared-distance
// check, and a world other than the built-in one (an editor play-test, an RL map) never sees it.

import { isFeigningDeath } from './combat/cast_move_gate';
import { isRooted } from './combat/cc';
import { TRINKET_AURA } from './content/trinkets';
import { isBuiltinWorldActive } from './data';
import { moveSpeedMult } from './player_motion';
import {
  type GaleWish,
  galeCoastClamp,
  galeCoastLimit,
  galeCurrentStep,
} from './quartered_gyre_current';
import { GYRE_WIND_PADS, gyreWindPadAt } from './quartered_gyre_pads';
import {
  GALE_LANE_AURA_ID,
  GALE_LANE_AURA_NAME,
  GALE_LANE_GRIP,
  GALE_LANE_LINGER,
  GALE_LANE_SPEED,
  GALE_LAUNCH_COOLDOWN,
  GALE_LAUNCH_COOLDOWN_ID,
  GALE_LIFT_NAME,
  GYRE_LAUNCH_OFFSET,
  type GyreTrackFrame,
  galeStrengthAtYards,
  gyreLaneAt,
  gyreLaunchPocketAt,
  gyreTrackFrameAt,
} from './quartered_gyre_wind';
import { GYRE_PEAK } from './quartered_landmarks';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { slipperyGrip } from './slippery_ground';
import { DT, type Entity, RUN_SPEED } from './types';

/** What the step needs of the Sim: to read a player's held keys and modes, to throw a caster off
 *  their cast and a sitter to their feet, and to read the ground a pad's flight comes down on. */
export type GyreWindHost = Pick<SimContext, 'cancelCast' | 'players' | 'standUp' | 'groundPos'>;

/** Squared radius round the peak past which nothing here can apply: the path's outer edge with the
 *  lip's pockets, or the farthest wind pad's edge, whichever reaches further. */
const NEAR_R2 =
  Math.max(
    GYRE_PEAK.startR + GYRE_PEAK.pathW / 2 + GYRE_LAUNCH_OFFSET + 2,
    ...GYRE_WIND_PADS.map(
      (pad) => Math.hypot(pad.x - GYRE_PEAK.x, pad.z - GYRE_PEAK.z) + pad.radius + 1,
    ),
  ) ** 2;

const frame: GyreTrackFrame = { t: 0, yards: 0, tx: 0, tz: 0, nx: 0, nz: 0, off: 0 };
const wish: GaleWish = { fx: 0, fz: 0, sx: 0, sz: 0 };
const velocity = { x: 0, z: 0 };

/** True when `p` wears the Gale Lane (not some other slick that shares its aura id). */
function wearsLaneAura(p: Entity): boolean {
  return p.auras.some((a) => a.id === GALE_LANE_AURA_ID && a.name === GALE_LANE_AURA_NAME);
}

/** The pace the body would run (or ride) at with no gale, yards a second: the kernel's own speed
 *  multiplier with the lane's three times the run set aside (a `buff_speed` of 1 is no buff at all,
 *  so the strongest other speed buff, the mount, a slow, all count as they would anywhere else). */
function ownPace(p: Entity): number {
  const lane = p.auras.find((a) => a.id === GALE_LANE_AURA_ID && a.name === GALE_LANE_AURA_NAME);
  if (!lane) return RUN_SPEED * moveSpeedMult(p);
  const value = lane.value;
  lane.value = 1;
  const pace = RUN_SPEED * moveSpeedMult(p);
  lane.value = value;
  return pace;
}

/** Put the Gale Lane on a body in a lane, topped up now and then (each top-up moves the deadline on
 *  the wire); it lapses a moment after the body leaves. The lane is the kernel's slippery-ground
 *  aura, so a body already on some other slick keeps that slick's own grip and is never given
 *  ours. */
function laneAura(p: Entity): void {
  const idx = p.auras.findIndex((a) => a.id === GALE_LANE_AURA_ID);
  if (idx >= 0) {
    const a = p.auras[idx];
    if (a.name === GALE_LANE_AURA_NAME && a.remaining < GALE_LANE_LINGER * 0.5) {
      a.remaining = GALE_LANE_LINGER;
    }
    return;
  }
  p.auras.push({
    id: GALE_LANE_AURA_ID,
    name: GALE_LANE_AURA_NAME,
    kind: 'buff_speed',
    remaining: GALE_LANE_LINGER,
    duration: GALE_LANE_LINGER,
    value: GALE_LANE_SPEED,
    value2: GALE_LANE_GRIP,
    sourceId: p.id,
    school: 'nature',
    undispellable: true,
  });
}

/** A body the motion kernel steers this tick: nothing holds it where it stands (a stun, a root, a
 *  fear, a feigned death) and no other mode owns its step (a charge, a follow, a leap, a climb, the
 *  Valkyr's call, a vehicle, a mount race or lesson, a lance brace, a dev anchor, a body that
 *  refuses to be moved). The gale carries and lifts only these. The same refusals as the Muster
 *  Grapnel's haul (combat/balgath_trinkets.ts), whose rule this follows so that no mode is ever
 *  pushed by two movers at once. */
function bodyIsFree(p: Entity, meta: PlayerMeta | undefined): boolean {
  if (isRooted(p) || isFeigningDeath(p)) return false;
  if (p.leap != null || p.climb != null || p.valkyrsCalling != null) return false;
  if (p.chargeTargetId != null || p.followTargetId != null) return false;
  if (
    meta &&
    (meta.vehicle || meta.mountRace || meta.mountTraining || meta.devAnchored || meta.lance)
  ) {
    return false;
  }
  return !p.auras.some((a) => a.id === TRINKET_AURA.anchor || a.id === TRINKET_AURA.foremanShape);
}

/** A held body does not coast on the gale's slide: the kernel would carry it on its stored velocity
 *  (up to the ride's ceiling, a long way) while the stun or the root is on it. Zeroed, the kernel's
 *  next step starts from rest. */
function holdInPlace(p: Entity): void {
  if (!p.onGround || (p.vx === 0 && p.vz === 0)) return;
  if (!(isRooted(p) || isFeigningDeath(p)) || !wearsLaneAura(p)) return;
  p.vx = 0;
  p.vz = 0;
}

/** What the held keys ask for, world yards a second at the run's pace, into `wish`, as the motion
 *  kernel derives it from the player's facing (without its gates, which `bodyIsFree` already
 *  applied): the forward and back keys, and the strafe keys, apart. Zero when none are held or the
 *  player's keys cannot be read. */
function readWish(p: Entity, meta: PlayerMeta | undefined): void {
  wish.fx = 0;
  wish.fz = 0;
  wish.sx = 0;
  wish.sz = 0;
  const input = meta?.moveInput;
  if (!input) return;
  const mz = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
  const mx = (input.strafeRight ? 1 : 0) - (input.strafeLeft ? 1 : 0);
  const sin = Math.sin(p.facing);
  const cos = Math.cos(p.facing);
  // world = forward * mz + right * mx, with right = (-cos f, sin f) (player_motion.ts)
  wish.fx = mz * sin * RUN_SPEED;
  wish.fz = mz * cos * RUN_SPEED;
  wish.sx = -mx * cos * RUN_SPEED;
  wish.sz = mx * sin * RUN_SPEED;
}

/** The gale's push on a body in a lane: its ground velocity after the kernel's slide step, run
 *  through the velocity law. A body in the air is blown too (the same law, so a hop on a bend keeps
 *  to the road), except one thrown by someone else's knockback, which flies its own line; and only
 *  a body the lane's slide actually holds. */
function windStep(p: Entity, meta: PlayerMeta | undefined, host: GyreWindHost | undefined): void {
  if (p.launchedBy) return;
  const grip = slipperyGrip(p);
  if (grip <= 0) return;
  // The road's frame where the body will be half way through its next step, not where it stands:
  // the velocity set here is the next step's, and a chord of a bend runs parallel to the bend's
  // tangent at its middle, so the body keeps to the road with no lag at any speed or radius.
  if (
    !gyreTrackFrameAt(p.pos.x + p.vx * DT * 0.5, p.pos.z + p.vz * DT * 0.5, frame) &&
    !gyreTrackFrameAt(p.pos.x, p.pos.z, frame)
  ) {
    return;
  }
  // a gale throws a caster off their cast and a sitter to their feet, as any shove does
  if (host) {
    if (p.castingAbility) host.cancelCast(p);
    if (p.sitting) host.standUp(p);
  }
  readWish(p, meta);
  const strength = galeStrengthAtYards(frame.yards);
  galeCurrentStep(p.vx, p.vz, wish, frame, strength, grip, ownPace(p), velocity);
  p.vx = velocity.x;
  p.vz = velocity.z;
}

/** A body wearing the Gale Lane out of every lane (the aura lingers a moment to carry a rider over
 *  the gap to the next one): held to the gale's own ceiling where it stands, or to its own pace
 *  where that is faster, so a held key cannot build speed the wind never gave, on the road's last
 *  stretch, at its ends or in a hop. */
function coastStep(p: Entity): void {
  if (p.launchedBy) return;
  // a body within its own pace is never slowed: skip the road lookup unless it is past it
  const pace = ownPace(p);
  if (p.vx * p.vx + p.vz * p.vz <= pace * pace) return;
  const onRoad = gyreTrackFrameAt(p.pos.x, p.pos.z, frame);
  const limit = galeCoastLimit(onRoad, onRoad ? galeStrengthAtYards(frame.yards) : 0, pace);
  if (galeCoastClamp(p.vx, p.vz, limit, velocity)) {
    p.vx = velocity.x;
    p.vz = velocity.z;
  }
}

/** Lift a body in a launch opening, on the ground or in a hop over it (the updraft catches a jump
 *  too): a scripted flight (the Heroic Leap's, with no landing blast, as the Muster Grapnel's haul)
 *  up over the face to the pocket's touchdown, which owns the body until it lands, so no key can
 *  steer it off the arc. A body thrown by someone else's knockback flies its own line. */
function launchStep(p: Entity, host: GyreWindHost | undefined): void {
  if (p.launchedBy) return;
  if ((p.cooldowns.get(GALE_LAUNCH_COOLDOWN_ID) ?? 0) > 0) return;
  const pocket = gyreLaunchPocketAt(p.pos.x, p.pos.y, p.pos.z);
  if (!pocket) return;
  throwOnTheWind(p, pocket.landing, pocket.duration, pocket.apex, host);
}

/** Throw a body standing on a wind pad (a released spirit too: it is how one gets back up to the
 *  crown from Gyrefoot Rest) to the pad's touchdown, on the same scripted flight as the pockets'. A
 *  touchdown on open ground is read off the ground when the flight starts; with no host to read it
 *  from, the crown pad throws nobody. */
function padStep(p: Entity, host: GyreWindHost | undefined): void {
  if (!p.onGround || p.launchedBy) return;
  if ((p.cooldowns.get(GALE_LAUNCH_COOLDOWN_ID) ?? 0) > 0) return;
  const pad = gyreWindPadAt(p.pos.x, p.pos.z);
  if (!pad) return;
  const { x, y, z } = pad.landing;
  const landing = y !== null ? { x, y, z } : (host?.groundPos(x, z) ?? null);
  if (!landing) return;
  throwOnTheWind(p, landing, pad.duration, pad.apex, host);
}

/** Set a body on the gale's scripted flight (the Heroic Leap's, with no landing blast, as the
 *  Muster Grapnel's haul) to `to`, which owns it until it lands: no key steers it off the arc and no
 *  fall is taken at the end. A gale throws a caster off their cast, as any shove does. */
function throwOnTheWind(
  p: Entity,
  to: { x: number; y: number; z: number },
  duration: number,
  apex: number,
  host: GyreWindHost | undefined,
): void {
  if (p.castingAbility && host) host.cancelCast(p);
  p.vx = 0;
  p.vz = 0;
  p.chargeTargetId = null;
  p.chargePath = [];
  p.leap = {
    from: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
    to: { x: to.x, y: to.y, z: to.z },
    elapsed: 0,
    duration,
    apex,
    landingAoe: { min: 0, max: 0, radius: 0 },
    abilityName: GALE_LIFT_NAME,
    abilityId: GALE_LAUNCH_COOLDOWN_ID,
    school: 'nature',
    // a released spirit thrown by a pad flies it (combat/heroic_leap.ts drops any other flight
    // left on a dead body)
    ...(p.ghost ? { spiritFlight: true as const } : {}),
  };
  p.cooldowns.set(GALE_LAUNCH_COOLDOWN_ID, GALE_LAUNCH_COOLDOWN);
}

/** The wind for one player this tick, on foot or mounted: the Gale Lane aura and the gale's push for
 *  a body in a lane, the hold on a body that wears the aura out of one, the lift for a body in a
 *  launch opening, and the throw for a body on a wind pad. A released spirit rides only the pads
 *  (the lanes and pockets are the living's). Nothing touches a corpse, the carried or ferry
 *  passengers, and a body something holds or another mover owns is never pushed. */
export function updateGyreWind(p: Entity, host?: GyreWindHost): void {
  if ((p.dead && !p.ghost) || p.carriedBy !== undefined) return;
  if (p.ferryRide) return;
  const dx = p.pos.x - GYRE_PEAK.x;
  const dz = p.pos.z - GYRE_PEAK.z;
  if (dx * dx + dz * dz > NEAR_R2) return;
  if (!isBuiltinWorldActive()) return;
  const meta = host?.players.get(p.id);
  if (!bodyIsFree(p, meta)) {
    holdInPlace(p);
    return;
  }
  if (!p.ghost) {
    if (gyreLaneAt(p.pos.x, p.pos.y, p.pos.z)) {
      laneAura(p);
      windStep(p, meta, host);
    } else if (wearsLaneAura(p)) {
      coastStep(p);
    }
    launchStep(p, host);
  }
  padStep(p, host);
}
