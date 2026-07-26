// The Open Source reward-chest beacon: the one steady, warm thing left in a room
// the raid has just wrecked. Built into the ARMED chest's entity view, so it
// appears exactly when the sim swaps the chest template sealed -> armed
// (renderer.ts rebuilds the view on that swap) and needs no position math of its
// own. Cosmetic only.
//
// WHY THE STEADINESS IS THE POINT. Everything else in the cleared room is
// broken and breathing: the seal's surviving circuit traces smoulder on their
// own phases and its rim swells as a fault lamp. The beacon does none of that.
// It is the only steady light in the room, and that contrast is what makes the
// eye go to it.
//
// WHY IT IS COLD. The arena is lit by 18 pillar torches, so the room's ambient
// read is already warm orange, and the wrecked seal is ember orange on top of
// that. A warm gold beacon (the first revision) simply dissolved into all of it
// at range, which is exactly where it has a job to do. Cold white-blue is the
// one hue nothing else in the room occupies, so it separates instead of
// blending. Steady + cold + vertical against broken + warm + flat: three
// separate axes of contrast, which is what buys legibility across 42 units of
// murk rather than raw brightness.
//
// WHY IT IS TWO PARTS. The renderer ranks every point light in the scene by
// distance to the viewer and keeps only GFX.maxPointLights visible (as few as 2
// on constrained devices), a budget the arena's 18 pillar torches already
// compete for. The chest sits 42u from the centre seal while the inner torch
// ring sits at 24u, so a beacon that was ONLY a PointLight would be ranked out
// at exactly the distance where a player needs to find the reward, and would be
// ranked out harder on low tiers. That would make "where is the loot" a
// graphics-preset question, which the fairness rule forbids. So:
//   - the shaft and the floor pool are plain additive meshes that render on
//     EVERY tier and carry the long read from the centre of the room;
//   - the PointLight is local warmth only, and earns its budget slot honestly
//     once someone walks over to open the chest.

import * as THREE from 'three';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';
import { radialGlowTexture } from './textures';

/** Cold white-blue: the one hue neither the torches nor the wrecked seal use. */
const BEACON_COLOR = 0xcfeaff;
const SHAFT_WIDTH = 4.6;
const SHAFT_HEIGHT = 15;
/** Centred so the column runs from just under the chest lid to well overhead. */
const SHAFT_CENTRE_Y = SHAFT_HEIGHT * 0.42;
const SHAFT_OPACITY = 0.52;
/** The bright core at the chest itself, so the column has a source. */
const CORE_SIZE = 2.2;
const CORE_Y = 1.15;
const CORE_OPACITY = 0.82;
const POOL_RADIUS = 5.4;
const POOL_Y = 0.06;
const POOL_OPACITY = 0.62;
const LIGHT_INTENSITY = 14;
const LIGHT_RANGE = 18;
const LIGHT_Y = 1.9;

let glowTexture: THREE.CanvasTexture | null = null;
let poolGeometry: THREE.CircleGeometry | null = null;
let shaftMaterial: THREE.SpriteMaterial | null = null;
let coreMaterial: THREE.SpriteMaterial | null = null;
let poolMaterial: THREE.MeshBasicMaterial | null = null;

function glow(): THREE.CanvasTexture {
  glowTexture ??= radialGlowTexture();
  return glowTexture;
}

// Sprites rather than a cone: a stretched radial gradient stays soft at every
// edge and reads as a column of light from any camera angle, where a cone shows
// a hard silhouette at its top and from directly above.
function spriteMaterial(opacity: number): THREE.SpriteMaterial {
  return markSharedMaterial(
    new THREE.SpriteMaterial({
      map: glow(),
      color: BEACON_COLOR,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
}

/**
 * The beacon group, positioned in the chest view's local space (origin at the
 * chest's feet). The caller adds it to the entity view group; every material and
 * geometry here is process-lifetime and marked shared, so per-view disposal on
 * interest churn never tears down the cache.
 */
export function buildSourceCaveChestBeacon(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'source-cave-chest-beacon';

  shaftMaterial ??= spriteMaterial(SHAFT_OPACITY);
  const shaft = new THREE.Sprite(shaftMaterial);
  shaft.scale.set(SHAFT_WIDTH, SHAFT_HEIGHT, 1);
  shaft.position.y = SHAFT_CENTRE_Y;
  shaft.renderOrder = 2;

  coreMaterial ??= spriteMaterial(CORE_OPACITY);
  const core = new THREE.Sprite(coreMaterial);
  core.scale.set(CORE_SIZE, CORE_SIZE, 1);
  core.position.y = CORE_Y;
  core.renderOrder = 3;

  poolGeometry ??= markSharedGeometry(
    new THREE.CircleGeometry(POOL_RADIUS, 24).rotateX(-Math.PI / 2),
  );
  poolMaterial ??= markSharedMaterial(
    new THREE.MeshBasicMaterial({
      map: glow(),
      color: BEACON_COLOR,
      transparent: true,
      opacity: POOL_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  const pool = new THREE.Mesh(poolGeometry, poolMaterial);
  pool.position.y = POOL_Y;
  pool.renderOrder = 1;

  // budgetBase is what the renderer's point-light budget restores this light to
  // when it wins a slot (renderer.ts budgetFireLights); without it the budget
  // would latch whatever intensity it happened to read first.
  const light = new THREE.PointLight(BEACON_COLOR, LIGHT_INTENSITY, LIGHT_RANGE, 2);
  light.position.y = LIGHT_Y;
  light.userData.budgetBase = LIGHT_INTENSITY;

  group.add(pool, shaft, core, light);
  return group;
}
