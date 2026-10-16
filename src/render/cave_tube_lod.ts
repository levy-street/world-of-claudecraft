// Distance culling for the cave tube meshes (render/cave_mesh.ts).
//
// A tube mesh is a few thousand triangles and there are at most 32 of them,
// so the draw cost was never the problem: the point is that a mine dug under
// a mountain is INVISIBLE from outside except at its mouths, yet every tube
// was submitted (and shadow-cast) from anywhere on the map. SPACEY's rule for
// authored mines: "the cave only renders when you're close". Each tube
// hides once its footprint is further than CAVE_TUBE_VIEW_FAR from the
// camera, measured to the nearest point of its XZ bounds so a long gallery
// you are standing in never culls because its far end is far.
//
// The mouths: a tube's self-carved opening (autoMouth) discards terrain
// pixels whether or not the tube draws, so a culled mouth would show sky
// through the mountain. The far horizon is drawn by the far-terrain shell,
// which ignores cuts (the mountain reads solid from afar), and inside it the
// detail chunks reach ~150 yd, so a view distance past that keeps every mouth
// a camera can resolve backed by its tube.

import type * as THREE from 'three';

/** A tube draws while any point of its XZ footprint is within this (yards). */
export const CAVE_TUBE_VIEW_FAR = 240;

/** XZ footprint of one tube mesh, from its cached geometry bounds. */
export interface TubeFootprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Distance from (x, z) to the nearest point of a footprint (0 inside). */
export function footprintDistance(f: TubeFootprint, x: number, z: number): number {
  const dx = x < f.minX ? f.minX - x : x > f.maxX ? x - f.maxX : 0;
  const dz = z < f.minZ ? f.minZ - z : z > f.maxZ ? z - f.maxZ : 0;
  return Math.hypot(dx, dz);
}

/** Pure rule: does a tube with this footprint draw for a camera at (x, z)? */
export function tubeVisible(
  f: TubeFootprint,
  camX: number,
  camZ: number,
  far = CAVE_TUBE_VIEW_FAR,
): boolean {
  return footprintDistance(f, camX, camZ) <= far;
}

function footprintOf(mesh: THREE.Mesh): TubeFootprint | null {
  const geo = mesh.geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const b = geo.boundingBox;
  if (!b) return null;
  // tube meshes are built in world space (no transform on the mesh)
  return { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z };
}

/**
 * Per-frame: show/hide every tube mesh in the caves group by distance. A
 * handful of AABB tests, no allocation; the footprints come off the cached
 * geometry bounds, which buildOneCaveMesh already leaves on the geometry.
 * Returns how many tubes are drawing, for the perf overlay and tests.
 */
export function updateCaveTubeVisibility(
  group: THREE.Group,
  camX: number,
  camZ: number,
  far = CAVE_TUBE_VIEW_FAR,
): number {
  let drawn = 0;
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) continue;
    const f = footprintOf(mesh);
    const visible = f ? tubeVisible(f, camX, camZ, far) : true;
    mesh.visible = visible;
    if (visible) drawn++;
  }
  return drawn;
}
