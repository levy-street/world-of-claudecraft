// Headlights: a glowing sphere sitting in each of the lamp circles on the nose.
//
// Mount-OWNED geometry rather than particles, the same call the Goblin Rocket
// Sled's continuous flame makes. A headlight is always there and never moves
// relative to the car, so spawning it into the shared particle pool every frame
// would be paying a per-frame cost for something a parented mesh does for free.
//
// Parenting is the whole trick. The spheres are children of the CHASSIS, so
// they inherit yaw, the suspension's pitch and roll, and the landing squat with
// no per-frame work at all. There is deliberately no update function here.
//
// Brightness comes from the composer rather than from view-angle maths. The
// material is additive with an HDR colour where bloom exists (`GFX.composer`),
// so a lamp blows out as it fills more of the screen and settles to an ember at
// distance. That is the "brighter when you look into it" read for free, and it
// is how the sled's flame is already graded.

import * as THREE from 'three';
import { GFX } from './gfx';

/**
 * One lamp, as a model-space offset from the chassis origin, with the radius of
 * the circle it sits in. The model faces +z, so `z` is toward the nose.
 *
 * MEASURED off the shipped mesh, with the same caveat as the exhaust ports:
 * these are bare primitives inside the Chassis mesh with no empties to name, so
 * a re-rip is the one thing that invalidates them, and
 * `rallycart_headlights.test.ts` re-finds the circles and fails if they move.
 */
export interface HeadlightSite {
  x: number;
  y: number;
  z: number;
  radius: number;
}

/**
 * The Rallycart's four lamp circles.
 *
 * Two per side, and CONCENTRIC rather than side by side: a filled disc with a
 * smaller ring sitting a little above its centre. So four spheres read as two
 * lamps each with a hot inner core, which is what a lit headlight looks like
 * anyway.
 */
export const RALLYCART_HEADLIGHTS: readonly HeadlightSite[] = [
  { x: -0.152, y: 0.208, z: 0.456, radius: 0.045 },
  { x: -0.164, y: 0.21, z: 0.455, radius: 0.019 },
  { x: 0.155, y: 0.201, z: 0.457, radius: 0.043 },
  { x: 0.159, y: 0.212, z: 0.455, radius: 0.019 },
];

/** Sit the sphere slightly proud of its lens, as a fraction of its own radius,
 *  so it is not half buried in the housing around it. */
const PROUD = 0.35;

/** Warm white. Rally lamps are not daylight balanced, and a pure white sphere
 *  reads as a UI element rather than a bulb. */
const LAMP_COLOR = 0xfff2cf;

/** HDR multiplier where a composer exists, to put the lamps over the bloom
 *  threshold. Without one there is nothing to bloom into and anything above 1
 *  would only clip to white. */
const LAMP_HDR = 2.3;

/** Small on screen, and there are four. */
const SEGMENTS = 10;

/** Shared across every cart in the world, and never disposed: one material and
 *  one geometry per distinct radius. The MESHES are per mount and go away with
 *  the chassis they hang off, so there is nothing per-mount left to clean up
 *  and no teardown to plumb through the visual lifecycle. */
let sharedMaterial: THREE.MeshBasicMaterial | null = null;
const sharedGeometry = new Map<number, THREE.SphereGeometry>();

function lampMaterial(): THREE.MeshBasicMaterial {
  sharedMaterial ??= new THREE.MeshBasicMaterial({
    color: new THREE.Color(LAMP_COLOR).multiplyScalar(GFX.composer ? LAMP_HDR : 1),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return sharedMaterial;
}

function lampGeometry(radius: number): THREE.SphereGeometry {
  let geometry = sharedGeometry.get(radius);
  if (!geometry) {
    geometry = new THREE.SphereGeometry(radius, SEGMENTS, SEGMENTS);
    sharedGeometry.set(radius, geometry);
  }
  return geometry;
}

/** Marks a chassis that already carries lamps, so the call is idempotent. */
const ATTACHED = 'vehicleHeadlights';

/**
 * Put a lamp in each circle, once.
 *
 * Safe to call every frame: it marks the chassis and returns immediately after
 * the first time. Keying off the CHASSIS rather than off view state is what
 * makes it survive a graphics-settings rebuild, which hands back a new mount
 * visual that would otherwise never get its lamps.
 */
export function attachVehicleHeadlights(
  chassis: THREE.Object3D,
  sites: readonly HeadlightSite[],
): void {
  if (chassis.userData[ATTACHED]) return;
  chassis.userData[ATTACHED] = true;
  for (const site of sites) {
    const mesh = new THREE.Mesh(lampGeometry(site.radius), lampMaterial());
    mesh.position.set(site.x, site.y, site.z + site.radius * PROUD);
    mesh.frustumCulled = false;
    chassis.add(mesh);
  }
}
