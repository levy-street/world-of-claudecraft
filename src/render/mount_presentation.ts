// The per-frame mount step, split out of renderer.ts: drive the mount's own
// animation from its RIDER's locomotion, apply the procedural bob and (for a
// rolling mount) the roll, keep the rider planted on top of it, and emit the
// mount's ambient particles.
//
// This is a sibling module rather than a method on the renderer because none of
// it needs the renderer's private scene graph: it reads one view, one spec, and
// this frame's motion, and writes back through the narrow interfaces below. The
// math it leans on is already pure and Node-tested in mount_visuals.ts
// (mountBobY, mountRollStep, advanceRollAngle); this file is the thin consumer
// that puts those numbers onto the objects.

import type * as THREE from 'three';
import type { AnimState } from './characters/anim_state';
import type { CharacterVisual } from './characters/visual';
import { applyMountJumpAttitude } from './mount_jump_attitude';
import { advanceRollAngle, type MountVisualSpec, mountRollStep } from './mount_visuals';

/** The per-view state this step reads and advances. The live mount arrives
 *  through MountFrameInputs instead, already narrowed by the caller: a view
 *  whose mountVisual is still null has no mount step to run at all. */
export interface MountPresentationView {
  group: THREE.Object3D;
  /** World-unit rider lift onto the mount (0 when the mount is hidden). */
  mountLift: number;
  /** Accumulated roll of a ROLLING mount, in radians. Advanced here, and
   *  cleared here the moment the view carries a mount that does not roll. */
  mountRoll: number;
  /** Damped jump attitude, owned by mount_jump_attitude. */
  mountJumpPitch: number;
}

/** The particle sinks a mount can drive (the renderer's vfx layer). */
export interface MountPresentationFx {
  mountSlimeTrail(position: THREE.Vector3, dt: number): void;
  mountExhaust(position: THREE.Vector3, facing: number, dt: number, moving: boolean): void;
}

export interface MountFrameInputs {
  /** The built, shown mount visual. */
  mount: CharacterVisual;
  /** The rider on it. Narrowed by the caller for the same reason as mount. */
  riderVisual: CharacterVisual;
  spec: MountVisualSpec;
  dt: number;
  /** Renderer clock, for the procedural bob's phase. */
  timeSec: number;
  /** Whether clips advance this frame (the renderer's animation gate). */
  animate: boolean;
  moving: boolean;
  /** The REAL airborne flag, not the rider's suppressed one: the mount carries
   *  the jump while its rider holds their seat. */
  airborne: boolean;
  facing: number;
  /** This frame's displayed horizontal displacement in world units, which is
   *  the arc length the contact patch actually swept. */
  stepX: number;
  stepZ: number;
  /** Displayed vertical speed, for the jump attitude. */
  verticalVelocity: number;
}

/** A zeroed inputs record for the caller to own and refill each frame. The
 *  shape lives here, next to the interface it has to satisfy, so a new field
 *  cannot be added to MountFrameInputs and silently left unseeded by the one
 *  caller that allocates it. */
export function createMountFrameScratch(): MountFrameInputs {
  return {
    mount: null as unknown as CharacterVisual,
    riderVisual: null as unknown as CharacterVisual,
    spec: null as unknown as MountVisualSpec,
    dt: 0,
    timeSec: 0,
    animate: false,
    moving: false,
    airborne: false,
    facing: 0,
    stepX: 0,
    stepZ: 0,
    verticalVelocity: 0,
  };
}

/**
 * Fill the mount's own animation inputs from its RIDER's locomotion.
 *
 * Separate from the step below because BOTH arms of the presentation gate read
 * the result: the gated arm drives the mount's clips with it, and the rickshaw
 * puller reads it on-screen or off. Filling it inside the gated arm would hand
 * the off-screen puller whatever the last drawn rider happened to leave behind.
 *
 * The rigged quadrupeds run their baked gait clips (a live Idle loop while
 * standing, Walk/Run on the move, scripts/bake_mount_gaits.mjs); the clipless
 * mounts bob procedurally (the hover cycle floats, the griffin canters, the
 * snail glides flat, the boulder rolls).
 *
 * `airborne` is the REAL flag, not the rider's suppressed one: the mount
 * carries the jump while its rider holds their seat.
 */
export function fillMountAnimState(
  scratch: AnimState,
  rider: AnimState,
  spec: MountVisualSpec,
  airborne: boolean,
): void {
  scratch.speed = rider.speed;
  scratch.moving = rider.moving;
  scratch.running = rider.running;
  scratch.airborne = airborne;
  // A treading rider is forced backwards by the renderer (riderPoseFlags), and
  // that flag is about the RIDER pose, not the mount. Passing it through would
  // tell a rolling mount to play its own backpedal clip while it rolls forward.
  // Clipless rollers cannot show it today, but the trap should not be left set.
  scratch.backwards = rider.backwards && spec.rollRadius <= 0;
  scratch.swimming = rider.swimming;
}

/**
 * Advance one mounted rider's presentation by a frame.
 *
 * `scratch` is the caller-owned AnimState fillMountAnimState just wrote (one
 * per renderer, not per view), so a crowd of riders costs no allocations.
 */
export function updateMountPresentation(
  view: MountPresentationView,
  scratch: AnimState,
  fx: MountPresentationFx,
  input: MountFrameInputs,
): void {
  input.mount.update(input.dt, scratch, input.animate);

  // A rolling mount spins about its own centre, which is why its GLB is authored
  // origin-centred (manifest hover -0.8) and lifted back to the ground by exactly
  // its radius. Spin comes from this frame's travel, never from a hand-set rate:
  // omega = v / r is what makes the stone bite the ground instead of skating.
  if (input.spec.rollRadius > 0) {
    const forward = input.stepX * Math.sin(input.facing) + input.stepZ * Math.cos(input.facing);
    // Facing h points at (sin h, cos h), so the rider's right is (-cos h, sin h).
    // Only the magnitude reaches mountRollStep, but a lateral term that did not
    // match the convention would be a trap for whoever needs the signed value.
    const lateral = input.stepZ * Math.sin(input.facing) - input.stepX * Math.cos(input.facing);
    view.mountRoll = advanceRollAngle(view.mountRoll, mountRollStep(input.spec, forward, lateral));
  } else {
    // The VIEW outlives the mount. Swapping the boulder for a saddle mount
    // rebuilds mountVisual but keeps this view, and the accumulated roll is
    // composed onto EVERY mount's pitch axis below, so without this reset the
    // stone's last spin becomes a permanent pitch on the next mount: a mount
    // that does not tip has no path that ever relaxes it back to zero.
    view.mountRoll = 0;
  }

  // ONE writer owns the mount root transform. The bob, the ground lift, the
  // jump pitch and the rider seat all land in mount_jump_attitude, with the
  // roll composed onto the same axis as the pitch; a second writer here would
  // simply clobber whichever ran first.
  applyMountJumpAttitude(
    view,
    input.mount.root,
    input.riderVisual.root,
    input.spec,
    input.timeSec,
    input.moving,
    input.airborne,
    input.verticalVelocity,
    input.dt,
    view.mountRoll,
  );

  // Ambient mount particles: the snail paints its slime path while gliding, the
  // hover cycle streams aether exhaust off its tail.
  if (input.spec.fx === 'slime') {
    if (input.moving) fx.mountSlimeTrail(view.group.position, input.dt);
  } else if (input.spec.fx === 'exhaust') {
    fx.mountExhaust(view.group.position, input.facing, input.dt, input.moving);
  }
}
