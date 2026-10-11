// Renderer-facing glue for the Buried Hoard open-air valleys: the rift-build,
// sky-anchor and per-frame grading calls the Renderer coordinator makes, kept
// here so renderer.ts stays a thin consumer (tests/monolith_budget.test.ts).
// The renderer imports this module as one namespace.

import type * as THREE from 'three';
import type { RiftFloorPlan } from '../sim/rift/types';
import type { RiftFloorView } from '../world_api';
import { GFX } from './gfx';
import { buildHoardValley, resolveHoardValleyEffectsProfile } from './hoard_valley';
import {
  type HoardValleyEnvironment,
  resolveHoardValleyEnvironment,
} from './hoard_valley_environment';
import type { SkyView } from './sky';

export {
  disposeHoardValleyGroup,
  updateHoardValleyDayNight,
  updateHoardValleySkyDayNight,
} from './hoard_valley';
export { resolveHoardValleyEnvironment } from './hoard_valley_environment';

/** What an outdoor hoard floor's build borrows from the renderer. */
export interface HoardValleyInteriorHost {
  scene: THREE.Object3D;
  compileGate?: (target: THREE.Object3D) => Promise<unknown>;
  /** Warms the representative zone sky the valley draws (renderer.prepareZoneSky). */
  prepareSky: (x: number, z: number) => Promise<unknown>;
}

/** Builds an outdoor (valley) hoard floor at its instance origin; the sky
 *  warm-up only runs on the standard-material tiers, as it always has. */
export function buildInterior(
  floor: RiftFloorPlan,
  origin: { x: number; z: number },
  valley: HoardValleyEnvironment | null,
  host: HoardValleyInteriorHost,
): Promise<THREE.Group> {
  const sky = valley?.sky;
  return Promise.resolve(
    buildHoardValley({
      scene: host.scene,
      compileGate: host.compileGate,
      plan: floor,
      offset: { x: origin.x, y: 0, z: origin.z },
      effectsProfile: resolveHoardValleyEffectsProfile(GFX.effectsTier),
      prepareEnvironment:
        sky && GFX.standardMaterials ? () => host.prepareSky(sky.x, sky.z) : undefined,
    }).group,
  );
}

/** Rides the sky dome along with the camera, except inside a hoard valley,
 *  where the dome stays on the dig zone's representative sky point. */
export function setSkyCamera(
  sky: Pick<SkyView, 'setCameraPos'>,
  riftFloor: RiftFloorView | null,
  camera: { readonly x: number; readonly z: number },
  dt: number,
): void {
  const anchor = resolveHoardValleyEnvironment(riftFloor)?.sky;
  sky.setCameraPos(anchor?.x ?? camera.x, anchor?.z ?? camera.z, dt);
}
