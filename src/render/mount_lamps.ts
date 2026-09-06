// Lit lamps carried on a mount's own skeleton: the Lanternback Troll's pair of
// storm lanterns hung off the iron throne he wears, and the Chimeglass
// Tortoise's single blue light behind his storm-glass spectacles.
//
// The lights are parented to the SWINGING BONE, not to the mount root, so the
// flame stays inside its glass through every swing of the run cycle for free:
// the skeleton already solves that motion, and a world-space light re-aimed
// each frame would always trail it by one update. The offset down the chain
// lives in the mount's visual spec (mount_visuals.ts) in MODEL units, so the
// same numbers hold whatever height the manifest normalizes the mount to.
//
// Point lights here join the renderer's ranked budget as DYNAMIC entries: they
// move, so the budget has to re-read their world position every frame, and in
// exchange it only ever zeroes their intensity and never restores it. That is
// why `updateMountLamps` re-drives the level every frame from before the pass
// (the same contract weapon_vfx.ts lights keep).
//
// The GLASS itself is not this module's job. The lamp materials in the GLBs are
// named `lantern_Glow` and `lens_Glow`, and buildTintedClone
// (characters/assets.ts) pins any material whose name CONTAINS `Glow` to
// EMISSIVE_GLOW, which is why both names work unchanged, the intensity
// calibrated against the bloom threshold. Re-boosting it here would fight that
// one calibration from a second place, and would not even reach: the low
// graphics tier rebuilds materials as Lambert and drops their names.

import * as THREE from 'three';
import {
  MOUNT_LAMP_COLOR,
  MOUNT_LAMP_DISTANCE,
  MOUNT_LAMP_INTENSITY,
  type MountVisualSpec,
  mountLampFlicker,
} from './mount_visuals';

export interface MountLamps {
  lights: THREE.PointLight[];
  /** Whether each light gutters like a wick, parallel to `lights`. */
  flickers: boolean[];
  /** Peak intensity per light, parallel to `lights`. The budget pass zeroes a
   *  dynamic light and never restores it, so the per-frame update has to know
   *  what level to drive each one back to, and that level is per-lamp now
   *  (a lantern and a spectacle lens do not burn at the same brightness). */
  peaks: number[];
}

/**
 * Hang one point light inside each lamp on a freshly built mount visual.
 *
 * Returns null when the mount carries no lamps, or when the GLB is missing the
 * bones the spec names (a model swap that renamed a joint degrades to an unlit
 * lantern rather than throwing inside the per-frame render path).
 */
export function attachMountLamps(root: THREE.Object3D, spec: MountVisualSpec): MountLamps | null {
  if (spec.lamps.length === 0) return null;
  const bones = new Map<string, THREE.Object3D>();
  root.traverse((object) => {
    if (!bones.has(object.name)) bones.set(object.name, object);
  });
  const lights: THREE.PointLight[] = [];
  const peaks: number[] = [];
  const flickers: boolean[] = [];
  for (const lamp of spec.lamps) {
    const bone = bones.get(lamp.bone);
    if (!bone) continue;
    const light = new THREE.PointLight(
      lamp.color ?? MOUNT_LAMP_COLOR,
      lamp.intensity ?? MOUNT_LAMP_INTENSITY,
      lamp.distance ?? MOUNT_LAMP_DISTANCE,
      2,
    );
    light.position.set(lamp.offset[0], lamp.offset[1], lamp.offset[2]);
    // Born hidden and dark: the budget pass owns `visible` from the frame it
    // first ranks this light, and a light that counted into numPointLights
    // before it was ranked would relink every lit material in view.
    light.visible = false;
    light.intensity = 0;
    light.userData.budgetDynamic = true;
    bone.add(light);
    lights.push(light);
    peaks.push(lamp.intensity ?? MOUNT_LAMP_INTENSITY);
    flickers.push((lamp.flicker ?? 'flame') === 'flame');
  }
  return lights.length > 0 ? { lights, peaks, flickers } : null;
}

/** Re-drive each lamp's flame level for this frame. Must run BEFORE the point
 *  light budget pass; the budget zeroes what it will not shine. */
export function updateMountLamps(lamps: MountLamps, timeSec: number): void {
  for (let i = 0; i < lamps.lights.length; i++) {
    const level = lamps.flickers[i] ? mountLampFlicker(timeSec, i) : 1;
    lamps.lights[i].intensity = lamps.peaks[i] * level;
  }
}

/** Detach and dispose every lamp light (mount dismissed, swapped, or culled). */
export function disposeMountLamps(lamps: MountLamps): void {
  for (const light of lamps.lights) {
    light.removeFromParent();
    light.dispose();
  }
  lamps.lights.length = 0;
  lamps.peaks.length = 0;
  lamps.flickers.length = 0;
}
