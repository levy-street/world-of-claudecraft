// Ambient mount-effect dispatch: the one place a MountVisualSpec.fx kind turns
// into a particle call. Split out of renderer.ts (a monolith-budget coordinator)
// so the mapping is a small module the renderer consumes rather than another
// branch cluster inside the per-entity frame loop.
//
// The switch is EXHAUSTIVE on purpose: a new fx kind added to MountVisualSpec
// without a case here fails `tsc` at the `never` default instead of compiling
// clean and silently rendering nothing, which is exactly how an effect goes
// missing unnoticed. The emission math itself lives in mount_fx_core.ts; this
// module only routes, and the emitters live on the Vfx pool.

import type * as THREE from 'three';
import type { MountVisualSpec } from './mount_visuals';

/** The slice of Vfx this dispatch needs, so a Vitest can drive it with a spy
 *  instead of a live particle pool, scene, or GPU. */
export interface MountFxSink {
  mountSlimeTrail(at: THREE.Vector3, dt: number): void;
  mountExhaust(at: THREE.Vector3, yaw: number, dt: number, moving: boolean): void;
  mountGrit(at: THREE.Vector3, yaw: number, speed: number, dt: number): void;
  mountRiftGlow(at: THREE.Vector3, dt: number, moving: boolean): void;
}

/**
 * Emit one frame of a mount's ambient effect, if it has one.
 *
 * Which effects run while standing still is deliberate and differs per mount:
 * the snail's slime and the rock's grit are laid down by MOTION and stop dead
 * when the rider does, while the hover cycle's exhaust and the socketed rock's
 * rift light idle on, because both of those mounts float rather than rest.
 */
export function emitMountFx(
  sink: MountFxSink,
  spec: MountVisualSpec,
  at: THREE.Vector3,
  yaw: number,
  speed: number,
  dt: number,
  moving: boolean,
): void {
  switch (spec.fx) {
    case null:
      return;
    case 'slime':
      if (moving) sink.mountSlimeTrail(at, dt);
      return;
    case 'exhaust':
      sink.mountExhaust(at, yaw, dt, moving);
      return;
    case 'grit':
      if (moving) sink.mountGrit(at, yaw, speed, dt);
      return;
    case 'riftglow':
      sink.mountRiftGlow(at, dt, moving);
      return;
    default: {
      // A new fx kind must add its case above: this assignment makes that a
      // compile error rather than a mount that silently renders nothing.
      // Assigned and dropped, never returned, because the function is void.
      const unreachable: never = spec.fx;
      void unreachable;
      return;
    }
  }
}
