// The ledge climb: the scripted pull-up that ends a jump on top of something
// the body could not simply vault.
//
// It is a MOVEMENT MODE, in the same family as Heroic Leap's flight and the
// warrior's charge: while it runs it owns the body's position outright, so the
// path cannot be fought by input, gravity, or collision (the destination was
// validated before the climb started). It is short, it always completes on a
// surface the body fits on, and it is interruptible by the things that should
// interrupt it, which is the difference between a traversal move and a
// teleport.
//
// The curve is the shape of a real mantle rather than a straight line: the
// body rises first, hands to the lip, and only then pulls forward over the
// edge. Rising and translating on separate eases is what stops it reading as
// a slide up an invisible ramp.
//
// Pure sim: no rng, no wall clock. `Sim.updatePlayerMovement` runs the driver
// in its short-circuit chain and the renderer reads the same state to pose it.

import { MANTLE_REACH, supportHeightAt } from './colliders';
import { isRooted, isStunned } from './combat/cc';
import { PLAYER_BODY_RADIUS } from './pathfind';
import { findLedgeGrab, LEDGE_GRAB_MAX, LEDGE_GRAB_MIN } from './physics/ledge';
import { GRAVITY, JUMP_VELOCITY } from './player_motion';
import { DT, type Entity, type LedgeClimb } from './types';
import { groundHeight } from './world';

/** Pull-up pacing: the duration scales with how far the body actually rises,
 *  so hopping onto a low ledge stays snappy while hauling up onto a stall
 *  canopy or a roof reads as effort. A 1 yd pull lands near 0.46 s, the
 *  tallest reachable ledge near 0.65 s. */
export const CLIMB_DURATION_BASE = 0.3;
export const CLIMB_DURATION_PER_YARD = 0.16;

/** How long the pull-up onto a ledge `rise` yards up takes. */
export function climbDuration(rise: number): number {
  return CLIMB_DURATION_BASE + CLIMB_DURATION_PER_YARD * Math.max(0, rise);
}
/** Fraction of the climb spent rising before the body pulls forward. */
const CLIMB_RISE_PHASE = 0.62;
/** Clearance above the ledge the body settles at (it stands ON the surface). */
const CLIMB_SETTLE_EPS = 1e-3;
/** A climb only starts while genuinely airborne and not already rising fast. */
const CLIMB_MAX_RISE_SPEED = 2.5;

/**
 * The pull-up is for lips ABOVE YOUR HEAD: a ledge lower than this over the
 * floor the body is jumping from is silent-vault territory (the mantle
 * covers rises up to jump apex + MANTLE_REACH from flat ground), so a hop
 * onto a crate or a bench never plays the full-body climb. Measured against
 * the floor DIRECTLY BENEATH the body at grab time, so chained parkour
 * (crate to canopy) also stays a quick vault while a ground-level jump at
 * the same canopy is a real climb.
 *
 * Derived, not hand-tuned: it must always equal the true vault ceiling, or a
 * band of lips the mantle can already reach gets forced into the scripted
 * climb instead (this drifted once already, when MANTLE_REACH moved and this
 * literal did not).
 */
const CLIMB_JUMP_APEX = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
export const CLIMB_MIN_OVERHEAD = CLIMB_JUMP_APEX + MANTLE_REACH;

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * Should this airborne body grab a ledge? Starts the climb when so.
 * Returns true when a climb was armed this tick.
 */
export function tryStartClimb(p: Entity, seed: number): boolean {
  if (p.climb) return false;
  if (p.onGround || p.dead || p.ghost) return false;
  // Rising fast means the jump is still going up; grabbing then would cut the
  // arc short and rob the player of the height they just bought. Wait for the
  // apex, which is also when a real climber's hands reach the lip.
  if (p.vy > CLIMB_MAX_RISE_SPEED) return false;
  if (isStunned(p) || isRooted(p)) return false;
  const grab = findLedgeGrab(
    { seed, radius: PLAYER_BODY_RADIUS, facing: p.facing, vx: p.vx, vz: p.vz },
    p.pos.x,
    p.pos.y,
    p.pos.z,
  );
  if (!grab) return false;
  // Only lips above the head earn the pull-up; anything lower stays in the
  // silent vault's band. The reference floor is whatever the body would
  // stand on right here: the terrain, or the standable top underfoot.
  const floorY = Math.max(
    groundHeight(p.pos.x, p.pos.z, seed),
    supportHeightAt(seed, p.pos.x, p.pos.z, PLAYER_BODY_RADIUS, p.pos.y + 1e-3),
  );
  if (grab.topY - floorY < CLIMB_MIN_OVERHEAD) return false;
  const toY = grab.topY + CLIMB_SETTLE_EPS;
  p.climb = {
    from: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
    to: { x: grab.x, y: toY, z: grab.z },
    elapsed: 0,
    duration: climbDuration(toY - p.pos.y),
  };
  // The climb owns motion from here: drop the flight's velocity so nothing
  // downstream (air control, the landing detector) sees a body still falling.
  p.vx = 0;
  p.vz = 0;
  p.vy = 0;
  p.jumping = false;
  return true;
}

/** Pose along the climb, written straight onto the entity. */
function poseAt(p: Entity, c: LedgeClimb): void {
  const t = Math.min(1, c.elapsed / c.duration);
  // Rise first, then pull forward: two eases on one clock.
  const up = smooth(Math.min(1, t / CLIMB_RISE_PHASE));
  const fwd = smooth(Math.max(0, (t - CLIMB_RISE_PHASE * 0.45) / (1 - CLIMB_RISE_PHASE * 0.45)));
  p.pos.y = c.from.y + (c.to.y - c.from.y) * up;
  p.pos.x = c.from.x + (c.to.x - c.from.x) * fwd;
  p.pos.z = c.from.z + (c.to.z - c.from.z) * fwd;
}

/**
 * Advance an in-progress climb. Returns true while the climb owns movement,
 * so the caller skips the normal movement kernel entirely.
 */
export function advanceClimb(p: Entity): boolean {
  const c = p.climb;
  if (!c) return false;
  // Death, or CC that would break any other scripted move, drops the body.
  // `fallStartY` is deliberately left at its pre-jump value: the fall that
  // follows a broken climb is the same fall the jump started, so its damage
  // measures from where the body left the ground, not from mid-pull.
  if (p.dead || isStunned(p)) {
    p.climb = null;
    p.onGround = false;
    return false;
  }
  c.elapsed += DT;
  poseAt(p, c);
  if (c.elapsed >= c.duration) {
    p.pos.x = c.to.x;
    p.pos.y = c.to.y;
    p.pos.z = c.to.z;
    p.climb = null;
    p.onGround = true;
    p.jumping = false;
    p.vx = 0;
    p.vz = 0;
    p.vy = 0;
    p.fallStartY = p.pos.y;
  }
  return true;
}

/** How high above its start a climb is reaching, for tests and telemetry. */
export function climbRise(c: LedgeClimb): number {
  return c.to.y - c.from.y;
}

export { LEDGE_GRAB_MAX, LEDGE_GRAB_MIN };
