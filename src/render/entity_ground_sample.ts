import { supportHeightAt } from '../sim/colliders';
import { isRiftPos } from '../sim/data';
import { generateRiftFloor, riftLiftAt } from '../sim/rift/rift_gen';
import { groundHeight } from '../sim/world';
import type { RiftFloorView } from '../world_api/dungeons';
import {
  commitEntityGroundSample,
  type EntityGroundSample,
  entityGroundSampleDue,
} from './entity_ground_sample_core';

/** Radius of the standable-prop query under a body's feet, in yards. */
const STAND_SUPPORT_RADIUS = 0.5;

/** Half-span of the terrain-gradient stencil under a body, in yards. */
const TILT_SAMPLE_SPAN = 0.55;

/** The per-body terrain-lean state the renderer's entity view carries:
 *  the gradient the lean core damps toward, the prop-top flag that holds a
 *  body upright, the resample countdown, and where the last stencil was read. */
export interface GroundTiltView {
  tiltSampleT: number;
  tiltSample: EntityGroundSample;
  tiltGradX: number;
  tiltGradZ: number;
  tiltOnProp: boolean;
}

/**
 * The terrain-lean gradient under a near body (four terrain samples around
 * the feet), resampled on the body's own time budget AND only once the body
 * has moved or the stencil is older than the cadence core's age: a standing
 * body's gradient does not change, so it stops paying four terrain reads
 * every interval; a moving body keeps the interval it always had. The
 * slowest gait still tracked every interval is ENTITY_GROUND_RESAMPLE_YD per
 * interval on one axis (2.5 yd/s at the 60 ms interval, a walk); below that
 * the gradient lags by at most the threshold, on a lean the core damps and
 * clamps anyway. `dt` and `intervalS` are seconds; the countdown lives on the
 * view so a crowd keeps its staggered phases.
 */
export function sampleGroundTilt(
  view: GroundTiltView,
  seed: number,
  x: number,
  y: number,
  z: number,
  dt: number,
  intervalS: number,
): void {
  view.tiltSampleT -= dt;
  if (view.tiltSampleT > 0) return;
  const elapsed = intervalS - view.tiltSampleT;
  view.tiltSampleT = intervalS;
  if (!entityGroundSampleDue(view.tiltSample, x, y, z, elapsed)) return;
  const hx0 = groundHeight(x - TILT_SAMPLE_SPAN, z, seed);
  const hx1 = groundHeight(x + TILT_SAMPLE_SPAN, z, seed);
  const hz0 = groundHeight(x, z - TILT_SAMPLE_SPAN, seed);
  const hz1 = groundHeight(x, z + TILT_SAMPLE_SPAN, seed);
  const mean = (hx0 + hx1 + hz0 + hz1) / 4;
  commitEntityGroundSample(view.tiltSample, x, y, z, mean);
  view.tiltGradX = (hx1 - hx0) / (2 * TILT_SAMPLE_SPAN);
  view.tiltGradZ = (hz1 - hz0) / (2 * TILT_SAMPLE_SPAN);
  // Standing well above the local terrain means a prop top, which is flat
  // whatever the ground below it does.
  view.tiltOnProp = y - mean > 0.2;
}

/** The slice of the world the sampler reads: the terrain seed and the active
 *  rift floor (IWorld carries both). */
export interface StandingSurfaceWorld {
  cfg: { seed: number };
  riftFloor: RiftFloorView | null;
}

/**
 * The standing surface under a body's feet at the displayed (x, y, z): the
 * terrain (`groundHeight`, the sim's own sampler), plus the raised-tier lift
 * of the active rift floor (the flat dungeon floor would otherwise read a
 * standing player as airborne on a platform), OR a standable prop top under
 * the feet (parkour: crates and rocks are walkable, else a body perched on a
 * crate would loop its jump pose), whichever is higher. The value the
 * renderer's airborne heuristic compares the feet against.
 */
export function standingSurfaceAt(
  seed: number,
  riftFloor: RiftFloorView | null,
  x: number,
  y: number,
  z: number,
): number {
  let ground = groundHeight(x, z, seed);
  if (riftFloor && isRiftPos(x)) {
    const floor = generateRiftFloor(
      riftFloor.seed,
      riftFloor.baseLevel,
      riftFloor.floorIndex,
      riftFloor.upgrade,
    );
    ground += riftLiftAt(floor, x - riftFloor.origin.x, z - riftFloor.origin.z);
  }
  return Math.max(ground, supportHeightAt(seed, x, z, STAND_SUPPORT_RADIUS, y + 0.01));
}

/**
 * The per-body entry the renderer's entity loop calls every frame: returns the
 * standing surface for the body at (x, y, z), sampling the world only when the
 * cadence core says so (`force` samples unconditionally: the local player keeps
 * its per-frame sample) and serving the cached value otherwise.
 */
export function sampleStandingSurface(
  sample: EntityGroundSample,
  world: StandingSurfaceWorld,
  x: number,
  y: number,
  z: number,
  dt: number,
  force: boolean,
): number {
  if (force || entityGroundSampleDue(sample, x, y, z, dt)) {
    commitEntityGroundSample(
      sample,
      x,
      y,
      z,
      standingSurfaceAt(world.cfg.seed, world.riftFloor, x, y, z),
    );
  }
  return sample.standY;
}
