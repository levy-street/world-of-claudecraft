import { TUNNELS } from './content/tunnels';
import { terrainHeight } from './world';

// A true 3D voxel density field, layered on top of the existing (x,z)->y
// heightfield (world.ts). `voxelDensity` is a pure function of (x, y, z, seed):
// negative = solid ground, positive = open air. Outdoors, away from any
// authored tunnel, it is exactly `y - terrainHeight(x, z, seed)`, so the
// voxel field's surface is byte-identical to the existing heightfield and
// every existing (x,z)-only consumer (colliders, pathfind, mob locomotion)
// keeps working unchanged. Tunnels are hand-authored capsule paths (see
// content/tunnels.ts) subtracted from the solid terrain: the ONLY way caves
// get carved, matching the "terrain is a pure function of seed" invariant in
// world.ts (no procedural cave noise).
//
// This module is the first slice of the voxel migration: the engine only
// (density field + the seam-free chunked mesher in voxel_mesh.ts), proven by
// tests, not yet wired into the renderer or any live content. content/tunnels.ts
// today holds one fixture tunnel that exercises the carving math; it is not
// rendered in-game. Wiring real tunnel content into the renderer, and 3D
// collision/pathfinding through it (today's colliders.ts/pathfind.ts are still
// column-based, one height per x,z), are deliberate follow-up phases.

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Signed "carve" contribution of one capsule segment at a point: positive
// inside the capsule (this much open air), negative-ish falloff outside.
// Radius is linearly interpolated along the segment between its two
// waypoint radii, so a tunnel can taper.
function segmentCarve(
  px: number,
  py: number,
  pz: number,
  a: { x: number; y: number; z: number; radius: number },
  b: { x: number; y: number; z: number; radius: number },
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  const apx = px - a.x;
  const apy = py - a.y;
  const apz = pz - a.z;
  const t = len2 > 1e-9 ? clamp01((apx * abx + apy * aby + apz * abz) / len2) : 0;
  const cx = a.x + abx * t;
  const cy = a.y + aby * t;
  const cz = a.z + abz * t;
  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const radius = lerp(a.radius, b.radius, t);
  return radius - dist; // positive inside the capsule
}

// True 3D voxel density at a world point: negative = solid, positive = air,
// zero at the surface. Pure function of (x, y, z, seed) plus the fixed,
// hand-authored TUNNELS content.
export function voxelDensity(x: number, y: number, z: number, seed: number): number {
  let density = y - terrainHeight(x, z, seed);
  for (const tunnel of TUNNELS) {
    for (let i = 0; i + 1 < tunnel.waypoints.length; i++) {
      const carve = segmentCarve(x, y, z, tunnel.waypoints[i], tunnel.waypoints[i + 1]);
      if (carve > density) density = carve;
    }
  }
  return density;
}

export function isSolidVoxel(x: number, y: number, z: number, seed: number): boolean {
  return voxelDensity(x, y, z, seed) <= 0;
}

// Axis-aligned world-space bounding box a tunnel's geometry can possibly
// touch (waypoint sphere bounds + radius), used by the renderer/mesher to
// decide which chunks need tunnel meshing at all instead of sampling the
// whole world.
export function tunnelBounds(tunnel: (typeof TUNNELS)[number]): {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const w of tunnel.waypoints) {
    minX = Math.min(minX, w.x - w.radius);
    minY = Math.min(minY, w.y - w.radius);
    minZ = Math.min(minZ, w.z - w.radius);
    maxX = Math.max(maxX, w.x + w.radius);
    maxY = Math.max(maxY, w.y + w.radius);
    maxZ = Math.max(maxZ, w.z + w.radius);
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

export type { TunnelVolume, TunnelWaypoint } from './content/tunnels';
export { TUNNELS };
