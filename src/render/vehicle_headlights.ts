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
  /** Radius of the bowl in the mesh. Used to VERIFY the site still lands on a
   *  lamp, and to size the glow against, never as the glow itself. */
  radius: number;
  /** Radius of the glowing sphere, sized to the BOWL: what shows is the cap
   *  standing proud of the dish, so this is the radius of the dome that fills
   *  the recess, not a bead sitting in it. */
  glow: number;
}

/**
 * The Rallycart's four lamps: two round bowls per side, side by side.
 *
 * Two earlier passes got this wrong in opposite directions, both by measuring
 * the wrong thing:
 *
 *  - The first sized a sphere to the whole angular HOUSING primitive (prim
 *    37/36, 0.112 wide), which filled each housing edge to edge and bloomed
 *    past it. Two white canteloupes.
 *  - The second histogrammed only the frontmost 15mm of the housing. But the
 *    housing SWEEPS BACK toward the outer edge, so that slice discarded the
 *    outboard bowl entirely and found the housing's inner edge instead. Both
 *    lamps ended up crowded inboard and far too small.
 *
 * The bowls are found by splitting the housing at its own midpoint and taking
 * the front surface of each half, which survives the sweep. They come out
 * near enough the same size, and the outboard one sits 18mm further back in z.
 *
 * `z` is the DISH SURFACE, the curved lens face itself, not the rim in front of
 * it and not the sphere's centre. The bowls are recessed 15 to 21mm behind
 * their rims, so anchoring to the rim leaves the glow standing proud of the
 * lens; see PIERCE.
 *
 * `radius` is kept at the conservative value the TEST's own circle-finder
 * reports (it takes one circle per primitive off its front face, which reads
 * a little smaller than the split-half measurement above). The glow is sized
 * against the real bowl, so it fills it; the radius column exists to catch a
 * re-rip moving the nose, and a conservative number there is the safe one.
 */
export const RALLYCART_HEADLIGHTS: readonly HeadlightSite[] = [
  // Hand tuned on screen, per lamp, and deliberately NOT symmetric. The mesh
  // came from an image through Tripo, so the two housings genuinely do not
  // mirror each other and a symmetric table lands at least one lamp off centre.
  // The measured values are the starting point, not the answer.
  //
  // The two INNER lamps sit 3mm BEHIND their measured dish surface. Pushing
  // them forward reads as better fill face on and wrong from three quarters,
  // where the dome comes out of the dish. Judge those two off the angle, never
  // off a front-on screenshot.
  { x: -0.157, y: 0.211, z: 0.448, radius: 0.025, glow: 0.02 },
  { x: -0.222, y: 0.215, z: 0.424, radius: 0.024, glow: 0.018 },
  { x: 0.154, y: 0.209, z: 0.449, radius: 0.025, glow: 0.02 },
  // Far right: was taken from the vertex CENTROID, which the dense cluster on
  // its inboard side pulled 4mm out and 3mm low. This is the bounding-box
  // midpoint of the same dish, which is what actually centres it.
  { x: 0.219, y: 0.213, z: 0.427, radius: 0.024, glow: 0.018 },
];

/** How far the sphere's CENTRE sits behind the dish surface, as a fraction of
 *  its own radius. What the eye gets is the spherical cap in front of the dish.
 *
 *  Under 0.5 on purpose, so the cap is close to a full hemisphere and its
 *  silhouette is close to the sphere's full radius: `sqrt(1 - SINK^2)`, about
 *  0.94 here. That is what makes the lamp read as the whole bowl lighting up.
 *
 *  A fixed SMALL offset in model units (this file's previous rule, 2mm proud of
 *  the dish) is the trap: a shallow cap's silhouette is only
 *  `sqrt(2*r*h - h^2)`, which at 2mm on a 17mm sphere is an 8mm disc inside a
 *  25mm bowl, and the dish is faceted, so what actually showed was a ragged
 *  crescent rather than a circle. */
const SINK = 0.35;

/** Warm white. Rally lamps are not daylight balanced, and a pure white sphere
 *  reads as a UI element rather than a bulb. */
const LAMP_COLOR = 0xfff2cf;

/** HDR multiplier where a composer exists, to put the lamps over the bloom
 *  threshold. Without one there is nothing to bloom into and anything above 1
 *  would only clip to white. */
const LAMP_HDR = 1.5;

/** Four spheres, two geometries shared across every cart in the world, so this
 *  is cheap. It was 10 while the visible cap was a sliver; at close range a
 *  near-hemisphere that size shows its facets on the silhouette. */
const SEGMENTS = 20;

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
    const mesh = new THREE.Mesh(lampGeometry(site.glow), lampMaterial());
    mesh.position.set(site.x, site.y, site.z - site.glow * SINK);
    mesh.frustumCulled = false;
    chassis.add(mesh);
  }
}
