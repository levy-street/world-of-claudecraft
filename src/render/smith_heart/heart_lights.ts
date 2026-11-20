// The Smith's Heart's lights: each vein's colour key over its guardian's
// arena and an accent at its mouth, the seal's pale glow, the forge's
// crucibles and the Frozen Lake's braziers (heart_plan_core.ts
// planHeartLights). Every point light rides the renderer's budgeted carriers,
// pushed to the fire-light sink (at most eight per light zone:
// tests/smith_heart_render_core.test.ts); a lamp carries a halo card, never a
// second light, and a light that only shapes stone (the colossi's fills, the
// Cleft's door glow: `noHalo`) carries none and holds steady instead of
// flickering like a fire. The dusk itself is a fog state of
// ../interior_light_rig.ts: the Hammer vein's own (`smithHeartHammer`), the
// Heart's own, and the borrowed `sunkenBastion` over the rest of the main map.

import * as THREE from 'three';
import type { FireLightSink } from '../point_light_budget';
import { markSharedMaterial } from '../shared_resource';
import { radialGlowTexture } from '../textures';
import { planHeartLights } from './heart_plan_core';

export interface HeartLightDeps {
  lowGfx: boolean;
  fireLights: FireLightSink;
}

const haloMaterials = new Map<number, THREE.SpriteMaterial>();

function haloMaterial(color: number): THREE.SpriteMaterial {
  let m = haloMaterials.get(color);
  if (!m) {
    m = new THREE.SpriteMaterial({
      map: radialGlowTexture(),
      color,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      name: `smithHeartHalo:${color.toString(16)}`,
    });
    markSharedMaterial(m);
    haloMaterials.set(color, m);
  }
  return m;
}

/** Plant every budgeted point light and its halo. */
export function buildHeartLights(
  group: THREE.Group,
  deps: HeartLightDeps,
  ground: (x: number, z: number) => number,
): void {
  for (const spot of planHeartLights()) {
    const y = spot.y ?? ground(spot.x, spot.z) + spot.lift;
    const intensity = deps.lowGfx ? spot.intensity * 0.6 : spot.intensity;
    const light = new THREE.PointLight(
      spot.color,
      intensity,
      deps.lowGfx ? spot.range * 0.75 : spot.range,
      2,
    );
    // The budget's flicker pass owns the live intensity from this base.
    light.userData.baseIntensity = intensity;
    if (spot.noHalo) light.userData.steady = true;
    light.position.set(spot.x, y, spot.z);
    group.add(light);
    deps.fireLights.push(light);
    if (spot.noHalo) continue;
    const halo = new THREE.Sprite(haloMaterial(spot.color));
    halo.position.set(spot.x, y, spot.z);
    const hs = 2 + spot.range * 0.12;
    halo.scale.set(hs, hs, 1);
    group.add(halo);
  }
}
