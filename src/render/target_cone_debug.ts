// Pure geometry helper for the dev-only Tab-target cone overlay.
//
// A debug ground decal that visualizes the Tab targeting "on screen" front cone
// (see src/sim/tab_target.ts): a flat circular sector laid on the terrain in
// front of the local player, spanning +/- the cone half-angle out to the near
// radius, draped over slopes so it reads on any ground. The cone parameters are
// injected by main.ts (the wiring layer) so this stays inside the render seam
// and never imports the sim targeting module directly.
//
// Host-agnostic (no Three.js, no DOM) so the sector geometry and world-placement
// math are unit-tested directly; the renderer is a thin consumer that turns the
// world positions into a BufferGeometry and re-drapes them each frame. Forward
// is (sin(facing), cos(facing)), matching the sim and the renderer's mesh yaw,
// so in local space the cone points down +Z.

/** A terrain height sampler: world (x, z) -> ground height on the up axis. */
export type HeightSampler = (x: number, z: number) => number;

/** Half-angle (radians) of the flared cone at planar distance d. */
export type HalfAngleAt = (d: number) => number;

export interface ConeFan {
  // Center-relative local XZ vertices, [x0,z0, x1,z1, ...], laid out as a polar
  // grid of `radial + 1` rings (ring 0 collapses to the apex at the origin) by
  // `angular + 1` columns. Column u in [0,1] maps to angle (2u - 1) * half(r), so
  // the side edges (u = 0 and u = 1) flare outward as the half-angle grows with
  // radius. In local space forward is +Z, so a vertex at angle a, radius r sits
  // at (sin(a) * r, cos(a) * r).
  localXZ: Float32Array;
  // Triangle indices for the filled flared sector (two per grid cell).
  index: Uint16Array;
  // Perimeter vertex indices in loop order (left edge, outer arc, right edge) for
  // a LineLoop outline.
  outline: Uint16Array;
  // Total vertex count.
  vertexCount: number;
}

/**
 * Build the local-space mesh for a FLARED cone: a sector whose half-angle is
 * `halfAt(r)` at each radius r out to `radius`, tessellated into a radial grid.
 * Because the half-angle varies with radius the region is not a plain sector
 * (its sides curve), so it is meshed as rings rather than an apex fan.
 */
export function buildFlaredConeFan(
  radius: number,
  halfAt: HalfAngleAt,
  radial: number,
  angular: number,
): ConeFan {
  const cols = angular + 1;
  const rings = radial + 1;
  const vertexCount = rings * cols;
  const localXZ = new Float32Array(vertexCount * 2);
  for (let i = 0; i <= radial; i++) {
    const r = (radius * i) / radial;
    const half = halfAt(r);
    for (let j = 0; j <= angular; j++) {
      const u = j / angular; // 0 = left edge, 1 = right edge
      const a = (2 * u - 1) * half;
      const v = (i * cols + j) * 2;
      localXZ[v] = Math.sin(a) * r;
      localXZ[v + 1] = Math.cos(a) * r;
    }
  }
  // Two triangles per grid cell. Ring 0 sits at the apex (r = 0), so its cells
  // are zero-area and harmless in the translucent fill.
  const index = new Uint16Array(radial * angular * 6);
  let k = 0;
  for (let i = 0; i < radial; i++) {
    for (let j = 0; j < angular; j++) {
      const v00 = i * cols + j;
      const v01 = v00 + 1;
      const v10 = v00 + cols;
      const v11 = v10 + 1;
      index[k++] = v00; index[k++] = v10; index[k++] = v01;
      index[k++] = v01; index[k++] = v10; index[k++] = v11;
    }
  }
  // Outline perimeter: up the left edge (j = 0), across the outer ring, down the
  // right edge (j = angular).
  const outline = new Uint16Array(rings + cols + rings);
  let o = 0;
  for (let i = 0; i <= radial; i++) outline[o++] = i * cols; // left edge, apex -> rim
  for (let j = 0; j <= angular; j++) outline[o++] = radial * cols + j; // outer arc
  for (let i = radial; i >= 0; i--) outline[o++] = i * cols + angular; // right edge, rim -> apex
  return { localXZ, index, outline, vertexCount };
}

/**
 * Build a full-circle ring's local XZ vertices (no apex), [x0,z0, x1,z1, ...],
 * for the query-radius outline. Symmetric, so drapeConeWorld can place it with
 * any facing. Feed the result to a LineLoop to draw the rim.
 */
export function buildRingXZ(radius: number, segments: number): Float32Array {
  const xz = new Float32Array(segments * 2);
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    xz[i * 2] = Math.sin(a) * radius;
    xz[i * 2 + 1] = Math.cos(a) * radius;
  }
  return xz;
}

/**
 * Place a local sector fan in the world: rotate each vertex by `facing` (local
 * +Z -> world (sin facing, cos facing)), translate to the player at (cx, cz),
 * and ride the terrain (sampled height plus a small `lift` to avoid z-fighting).
 *
 * @param localXZ flat [x0,z0, ...] local sector vertices from buildFlaredConeFan
 * @param cx      apex world X (player position)
 * @param cz      apex world Z (player position)
 * @param facing  player facing angle (radians)
 * @param lift    constant height above terrain, in world units
 * @param sample  terrain height sampler in world space
 * @param outXYZ  destination [x0,y0,z0, ...], length = (localXZ.length / 2) * 3
 * @returns       outXYZ
 */
export function drapeConeWorld(
  localXZ: ArrayLike<number>,
  cx: number,
  cz: number,
  facing: number,
  lift: number,
  sample: HeightSampler,
  outXYZ: Float32Array,
): Float32Array {
  const sinF = Math.sin(facing);
  const cosF = Math.cos(facing);
  const n = outXYZ.length / 3;
  for (let i = 0; i < n; i++) {
    const lx = localXZ[i * 2];
    const lz = localXZ[i * 2 + 1];
    const wx = cx + lx * cosF + lz * sinF;
    const wz = cz - lx * sinF + lz * cosF;
    outXYZ[i * 3] = wx;
    outXYZ[i * 3 + 1] = sample(wx, wz) + lift;
    outXYZ[i * 3 + 2] = wz;
  }
  return outXYZ;
}
