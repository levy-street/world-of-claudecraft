// The whole per-frame presentation pass for the mount under a rider: gait
// animation, body attitude (jump pitch and terrain-reactive suspension), the
// rider seat carried with it, and the mount's ambient particle trail.
//
// One function rather than a block inside the entity loop for the usual two
// reasons: it is mount behavior, not coordinator work, and renderer.ts is a
// named monolith under the line-count ratchet (root CLAUDE.md, Modularity).
// It reads the same shape the loop already had, so the seam is the parameter
// list and nothing else moved.
//
// The pieces it composes each own their own math:
//   - `CharacterVisual.update` runs the baked gait clips.
//   - `applyRocketSledAttitude` owns the rocket sled's jump nose-up and the
//     rigid rider carry.
//   - `vehicle_suspension_fx` owns four-wheel terrain response, and composes
//     ONTO the attitude above rather than replacing it.
// Order matters: attitude first, suspension second, because the suspension
// pass reads the pitch already on the body and adds to it.

import type * as THREE from 'three';
import type { AnimState, CharacterVisual } from './characters/visual';
import { applyRocketSledAttitude } from './goblin_rocket_sled_fx';
import { type MountVisualSpec, mountBobY } from './mount_visuals';
import { RALLYCART_EXHAUST_PORTS } from './vehicle_exhaust_core';
import {
  applyVehicleExhaust,
  createVehicleExhaust,
  type VehicleExhaustState,
} from './vehicle_exhaust_fx';
import { attachVehicleHeadlights, RALLYCART_HEADLIGHTS } from './vehicle_headlights';
import {
  applyVehicleSuspension,
  createVehicleSuspensionRig,
  type VehicleSuspensionRig,
} from './vehicle_suspension_fx';
import type { Vfx } from './vfx';

/** The EntityView slice this pass touches: a caller-owned view record. */
export interface MountPresentationHost {
  group: THREE.Object3D;
  visual: { root: THREE.Object3D } | null;
  mountVisual: CharacterVisual | null;
  mountLift: number;
  rocketSledJumpPitch: number;
  /** Turning on the spot, for the engine audio's pitch bend. Written here
   *  rather than in renderer.ts because the suspension rig is what knows it. */
  mountPivot: boolean;
  mountSuspension: VehicleSuspensionRig | null | undefined;
  /** Exhaust latch state, created on first sight of a piped mount. */
  mountExhaust: VehicleExhaustState | null;
}

export interface MountPresentationInputs {
  spec: MountVisualSpec | null;
  /** False when a druid form or death has taken the mount off screen. */
  shown: boolean;
  mountKey: string;
  /** The mount's own locomotion, borrowed from the rider. */
  anim: AnimState;
  /** The REAL airborne flag, not the rider's suppressed one: the mount carries
   *  the jump. */
  airborne: boolean;
  moving: boolean;
  facing: number;
  /** Raw vertical delta this frame, for the sled's jump attitude. */
  dyRaw: number;
  /** Scene clock, for the procedural bob phase. */
  time: number;
  /** False for a far-LOD or offscreen body: the rig advances but nothing that
   *  costs per-frame work runs. */
  present: boolean;
  animate: boolean;
  vfx: Vfx;
  /** Where this entity's engine audio is, for visuals that want to land on a
   *  specific moment inside an authored take. Null with no engine running. */
  enginePhase: { state: 'idle' | 'starting' | 'moving' | 'stopping'; elapsed: number } | null;
  groundSample: (x: number, z: number) => number;
  dt: number;
}

export function updateMountPresentation(
  v: MountPresentationHost,
  input: MountPresentationInputs,
): void {
  const { spec, dt } = input;
  if (v.mountVisual && spec && input.shown) {
    if (!input.present) {
      v.mountVisual.advanceOffscreen(dt);
      return;
    }
    v.mountVisual.update(dt, input.anim, input.animate);
    // The rider floats WITH the procedural bob (the hover cycle's idle float),
    // not just the mount body.
    const bob = spec.groundLift + mountBobY(spec, input.time, input.moving);
    const riderRoot = v.visual?.root;
    if (!riderRoot) return;
    applyRocketSledAttitude(
      v,
      v.mountVisual.root,
      riderRoot,
      input.mountKey === 'goblin_rocket_sled',
      input.airborne,
      dt > 1e-4 ? input.dyRaw / dt : 0,
      dt,
      bob,
      v.mountLift + bob,
      spec.seatFwd,
    );
    // A wheeled mount reads the ground under each of its four wheels and
    // answers with body pitch/roll plus per-corner spring travel. The rig is
    // probed once per mount and cached as null for everything without
    // suspension nodes, so this costs one property read for every other mount.
    if (v.mountSuspension === undefined) {
      v.mountSuspension = createVehicleSuspensionRig(v.mountVisual.root, v.group);
    }
    if (v.mountSuspension) {
      applyVehicleSuspension(
        v.mountSuspension,
        v.group,
        v.mountVisual.root,
        riderRoot,
        v.mountLift + bob,
        spec.seatFwd,
        !input.airborne,
        input.moving,
        input.facing,
        input.dyRaw,
        input.groundSample,
        dt,
      );
      v.mountPivot = v.mountSuspension.pivoting;
      // Lamps are parented into the chassis, so this is a one-time attach that
      // costs a property read afterwards and needs no per-frame update.
      if (spec.fx === 'pipes') {
        attachVehicleHeadlights(v.mountSuspension.chassis, RALLYCART_HEADLIGHTS);
      }
    }
    // Ambient mount particles: the snail paints its slime path while gliding,
    // the hover cycle streams aether exhaust off its tail.
    if (spec.fx === 'slime') {
      if (input.moving) input.vfx.mountSlimeTrail(v.group.position, dt);
    } else if (spec.fx === 'exhaust') {
      input.vfx.mountExhaust(v.group.position, input.facing, dt, input.moving);
    } else if (spec.fx === 'pipes' && v.mountSuspension) {
      // Piped exhaust rides the chassis matrix, so it keeps its place through
      // the body's pitch, roll and landing squat.
      v.mountExhaust ??= createVehicleExhaust();
      applyVehicleExhaust(v.mountExhaust, {
        chassis: v.mountSuspension.chassis,
        frontSign: v.mountSuspension.frontSign,
        ports: RALLYCART_EXHAUST_PORTS,
        phase: input.enginePhase?.state ?? 'idle',
        elapsed: input.enginePhase?.elapsed ?? 0,
        reversing: input.anim.backwards,
        pivoting: v.mountPivot,
        vfx: input.vfx,
        dt,
      });
    }
    return;
  }
  if (!input.shown && v.visual) {
    // Dismounted: relax every arm this pass drives, or the body keeps the
    // vehicle's last attitude after the vehicle is gone.
    v.rocketSledJumpPitch = 0;
    v.mountPivot = false;
    v.visual.root.rotation.x = 0;
    v.visual.root.rotation.z = 0;
    v.visual.root.position.x = 0;
  }
}
