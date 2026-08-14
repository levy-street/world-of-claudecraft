/**
 * Sun-shadow texel snapping: quantize the shadow camera's anchor (the point
 * the directional light targets, which the frustum follows) to whole
 * shadow-map texels in light space, so the orthographic rasterization grid
 * never slides under static geometry while the player moves ("shadow
 * swimming": sub-texel frustum translation re-rasterizes every static shadow
 * edge on a slightly shifted grid each frame, which reads as edge shimmer).
 *
 * The basis mirrors how three builds the directional shadow camera's view
 * matrix (Matrix4.lookAt with world up, the same convention
 * foliage_shadow_core.ts resolves): right = normalize(up x dir) with
 * up = (0, 1, 0), then up' = dir x right. The anchor moves only inside the
 * right/up' plane, and the light position translates with it, so the light
 * DIRECTION is bit-identical and the visible lighting cannot move; only the
 * shadow grid stops sliding. Snapping quantizes translation; the day/night
 * light-direction drift still re-rasterizes, which no translation snap can
 * absorb (and which is continuous, not tied to camera motion).
 */

export interface ShadowAnchor {
  x: number;
  y: number;
  z: number;
}

/** A light direction this vertical has no stable lookAt basis (matches the
 *  MIN_HORIZONTAL_DIR guard in foliage_shadow_core.ts); below it the snap
 *  passes the anchor through untouched rather than inventing a basis. */
const MIN_HORIZONTAL_DIR = 1e-4;

/** World units covered by one shadow-map texel: the orthographic box width
 *  over the map resolution. Non-positive inputs disable snapping (0). */
export function shadowTexelWorldSize(orthoWidth: number, mapSize: number): number {
  return orthoWidth > 0 && mapSize > 0 ? orthoWidth / mapSize : 0;
}

/**
 * Snap `(x, y, z)` to the shadow-map texel grid of a directional light
 * looking along `-dir` (dir points from the target toward the light; it need
 * not be normalized). Fills and returns the caller-owned `out` (per-frame
 * path: no allocation). A degenerate direction or a non-positive texel size
 * passes the anchor through unsnapped.
 */
export function snapShadowAnchor(
  dirX: number,
  dirY: number,
  dirZ: number,
  x: number,
  y: number,
  z: number,
  texelWorld: number,
  out: ShadowAnchor,
): ShadowAnchor {
  out.x = x;
  out.y = y;
  out.z = z;
  if (!(texelWorld > 0)) return out;
  const len = Math.hypot(dirX, dirY, dirZ);
  if (!(len > 0)) return out;
  const dx = dirX / len;
  const dy = dirY / len;
  const dz = dirZ / len;
  // right = up x dir with up = (0, 1, 0), which is (dir.z, 0, -dir.x).
  const rl = Math.hypot(dz, dx);
  if (!(rl >= MIN_HORIZONTAL_DIR)) return out;
  const rightX = dz / rl;
  const rightZ = -dx / rl;
  // up' = dir x right; with rightY = 0 this expands to
  // (dy * rightZ, dz * rightX - dx * rightZ, -dy * rightX).
  const upX = dy * rightZ;
  const upY = dz * rightX - dx * rightZ;
  const upZ = -dy * rightX;
  // Light-space grid coordinates of the anchor (rightY = 0 drops the y term).
  // Round, not floor: rounding is numerically stable AT grid points (a
  // re-snapped anchor stays put; floor can drop a whole texel on the k*texel
  // knife edge from float error), and both quantize onto the same absolute
  // grid.
  const u = rightX * x + rightZ * z;
  const v = upX * x + upY * y + upZ * z;
  const du = Math.round(u / texelWorld) * texelWorld - u;
  const dv = Math.round(v / texelWorld) * texelWorld - v;
  out.x = x + rightX * du + upX * dv;
  out.y = y + upY * dv;
  out.z = z + rightZ * du + upZ * dv;
  return out;
}
