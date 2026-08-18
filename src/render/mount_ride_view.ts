// Per-frame drive for a ridden mount's own visual: its animation inputs, the
// procedural bob under both mount and rider, the roll of the cylinder mounts,
// and which ambient particle effect it sheds. Extracted from renderer.ts,
// which is at its monolith ceiling and stays a thin consumer (src/render/CLAUDE.md).
//
// The Three-facing writes live here rather than in a *_core because they ARE
// the work (three object3d writes and two emitter calls); the arithmetic they
// depend on is pure and unit-tested next door in mount_roll_core.ts.

import { advanceRoll, rollPivotOffset, topSurfaceSpeed } from './mount_roll_core';
import type { MountVisualSpec } from './mount_visuals';
import { mountBobY } from './mount_visuals';

/** The mount's animation scratch, shaped like the rider's AnimState subset the
 *  mount visual consumes. */
export interface MountAnimInputs {
  speed: number;
  moving: boolean;
  running: boolean;
  airborne: boolean;
  backwards: boolean;
  swimming: boolean;
}

/** The view fields this drive touches, narrowed so the module never imports
 *  the renderer or Three. */
export interface MountRideView {
  mountVisual: MountVisualLike | null;
  visual: { root: RiderRootLike } | null;
  mountLift: number;
  mountRoll: number;
  group: { position: Vec3Like };
}

/** Per-frame scalars. `bodySpeed` is deliberately separate from `anim.speed`:
 *  a standing rider's stride runs at the TOP-SURFACE speed (twice body speed),
 *  and rolling from that would spin the mount at twice the ground it covers. */
export interface MountRideFrame {
  dt: number;
  time: number;
  moving: boolean;
  bodySpeed: number;
  facing: number;
  present: boolean;
  animate: boolean;
}

/** Minimal shapes so this module never imports the renderer or Three. */
interface Vec3Like {
  x: number;
  y: number;
  z: number;
}
interface MountVisualLike {
  root: { position: { y: number; z: number }; rotation: { x: number } };
  update(dt: number, anim: MountAnimInputs, animate: boolean): void;
  advanceOffscreen(dt: number): void;
}
interface RiderRootLike {
  position: { y: number };
}
interface MountFxSink {
  mountSlimeTrail(at: Vec3Like, dt: number): void;
  mountExhaust(at: Vec3Like, facing: number, dt: number, moving: boolean): void;
}

/** Drive one ridden mount for a frame. Returns the new accumulated roll, which
 *  the caller stores back on its view. Off-screen mounts only advance clocks. */
export function driveMountRide(
  spec: MountVisualSpec,
  anim: MountAnimInputs,
  view: MountRideView,
  fxSink: MountFxSink,
  frame: MountRideFrame,
): number {
  const { mountVisual } = view;
  // The caller guards this, but the view field is nullable: a mount can be torn
  // down between the guard and here on a dismount frame.
  if (!mountVisual) return view.mountRoll;
  if (!frame.present) {
    mountVisual.advanceOffscreen(frame.dt);
    return view.mountRoll;
  }
  mountVisual.update(frame.dt, anim, frame.animate);
  // The rider floats WITH the procedural bob (the hover cycle's idle float),
  // not just the mount body.
  const bob = mountBobY(spec, frame.time, frame.moving);
  mountVisual.root.position.y = bob;
  if (view.visual) view.visual.root.position.y = view.mountLift + bob;
  // Cylinder mounts (the log, the barrel) turn about their local X axis, which
  // lies ACROSS travel, at omega = v / r so the contact patch stays still.
  let roll = view.mountRoll;
  if (spec.rollRadius > 0) {
    roll = advanceRoll(roll, frame.bodySpeed * frame.dt, spec.rollRadius);
    mountVisual.root.rotation.x = roll;
    // Pivot on the AXLE, not the model origin. Props are normalized with their
    // origin at the base, so rotating about it swings the body through the
    // floor in a circle once per turn (rollPivotOffset owns the correction).
    const pivot = rollPivotOffset(roll, spec.rollRadius);
    mountVisual.root.position.y += pivot.y;
    mountVisual.root.position.z = pivot.z;
  }
  // Ambient mount particles: the snail paints its slime path while gliding,
  // the hover cycle streams aether exhaust off its tail.
  if (spec.fx === 'slime') {
    if (frame.moving) fxSink.mountSlimeTrail(view.group.position, frame.dt);
  } else if (spec.fx === 'exhaust') {
    fxSink.mountExhaust(view.group.position, frame.facing, frame.dt, frame.moving);
  }
  return roll;
}

/** Below this ground speed a rolling mount is treated as parked and its rider
 *  stands still. Deliberately not zero: the sim leaves a hair of residual speed
 *  on the frame a player releases their key. */
export const STANDING_WALK_MIN_SPEED = 0.05;

/** The rider's animation inputs, narrowed to what a standing rider overrides. */
export interface RiderAnimInputs {
  speed: number;
  moving: boolean;
  running: boolean;
  backwards: boolean;
}

/** Pose a rider who STANDS on a rolling mount instead of sitting in it.
 *
 *  The surface under them travels forward at twice body speed
 *  (mount_roll_core.topSurfaceSpeed), so they backpedal against it to hold
 *  station, which is the joke. Two details matter:
 *
 *  - the stride runs against the SURFACE, not the body: matching body speed
 *    leaves the feet visibly slipping on a log turning twice as fast;
 *  - it rides the animation state machine's own `backwards` seam rather than
 *    adding a dispatch, so `backwards` picks the walkBack clip where one
 *    exists and reverseBackpedal negates the walk timeScale where it does not
 *    (src/render/characters/anim_state.ts). */
export function applyStandingRider(st: RiderAnimInputs, bodySpeed: number): boolean {
  // A PARKED mount is not rolling, so its rider has nothing to walk against and
  // simply stands there. Forcing the walk here would backpedal them on the spot
  // beside a motionless log, which reads as a bug rather than a joke (and it is
  // the same reason the bob in mount_visuals.ts carries no idle for these).
  if (bodySpeed <= STANDING_WALK_MIN_SPEED) return false;
  st.speed = topSurfaceSpeed(bodySpeed);
  st.moving = true;
  st.running = false;
  st.backwards = true;
  return true;
}

/** Copy the rider's locomotion inputs onto the mount's own anim scratch.
 *
 *  `airborne` is deliberately the REAL flag rather than the rider's suppressed
 *  one: the mount carries the jump arc while the rider holds their pose. */
export function copyMountAnim(
  mst: MountAnimInputs,
  st: Readonly<MountAnimInputs>,
  airborne: boolean,
): MountAnimInputs {
  mst.speed = st.speed;
  mst.moving = st.moving;
  mst.running = st.running;
  mst.airborne = airborne;
  mst.backwards = st.backwards;
  mst.swimming = st.swimming;
  return mst;
}
