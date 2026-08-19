// Thin consumer that turns one mounted body's per-frame motion into engine-chug
// cue calls, so renderer.ts carries a call rather than the policy.
//
// The cadence math itself is pure and lives in mount_chug_core.ts; this module
// is the glue that owns the "should this body chug at all" question and the
// fan-out to the sink. It sits here rather than in renderer.ts because a
// VEHICLE mount's engine turns over in states the renderer's stride ladder
// treats as mutually exclusive (moving, stopped, airborne), so it cannot ride
// inside that ladder and would otherwise be a standalone block in a coordinator
// that is an active extraction target (src/render/CLAUDE.md).
//
// Deliberately NOT the mountEngine take set (src/game/mount_engine_state.ts):
// that path is a windup, sustained loop, and winddown driven off a moving flag
// and owned by sfx.ts per entity id. This one hands the caller the cadence.
import type { SpatialAudioSink } from './audio_sink';
import {
  createMountChugState,
  type MountChugState,
  mountTopSpeed,
  stepMountChug,
} from './mount_chug_core';

export type { MountChugState };

export interface MountChugDrive {
  /** Live accumulator for this body, or null if it has never chugged. */
  state: MountChugState | null;
  mountKey: string;
  speed: number;
  airborne: boolean;
  dt: number;
  /** World position to place the cue at. */
  x: number;
  y: number;
  z: number;
  self: boolean;
  /** Mounted, alive, and close enough to be audible. */
  active: boolean;
}

/**
 * Fire this frame's chugs for one body and return its next accumulator.
 *
 * Returns null once the body stops qualifying (dismounted, dead, out of the
 * audible gate), which drops the accumulator so a body that qualifies again
 * restarts on a clean cadence instead of firing a banked chug immediately.
 * State is allocated on first use, so a gait mount never pays for one.
 */
export function driveMountChug(
  sink: SpatialAudioSink,
  drive: MountChugDrive,
): MountChugState | null {
  if (!drive.active) return null;
  const state = drive.state ?? createMountChugState();
  const chug = stepMountChug(state, {
    speed: drive.speed,
    topSpeed: mountTopSpeed(drive.mountKey),
    airborne: drive.airborne,
    dt: drive.dt,
  });
  // sink.mountChug no-ops for a mount with no chug cue, which is every gait
  // mount, so the common case costs one guarded call.
  for (let fired = 0; fired < chug.chugs; fired++) {
    sink.mountChug(drive.x, drive.y, drive.z, drive.mountKey, chug.rate, chug.gain, drive.self);
  }
  return state;
}
