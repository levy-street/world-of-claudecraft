// Pure 2D polygon geometry helpers (XZ plane, world-unit space). No DOM/rng
// deps; a leaf module like threat.ts/spatial.ts imported directly by tests and
// by delve_litany_layout.ts for authoring/validating room boundary polygons.

export interface Point2D {
  x: number;
  z: number;
}

/** Shoelace signed area. Positive means the points wind counter-clockwise
 *  (increasing angle in the standard x-right, z-up sense). */
export function polygonSignedArea(points: readonly Point2D[]): number {
  let sum = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    sum += a.x * b.z - b.x * a.z;
  }
  return sum / 2;
}

/** Point-in-polygon via ray casting (even-odd rule). Winding-independent. */
export function polygonContainsPoint(points: readonly Point2D[], x: number, z: number): boolean {
  let inside = false;
  const n = points.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = points[i];
    const pj = points[j];
    const intersects =
      pi.z > z !== pj.z > z && x < ((pj.x - pi.x) * (z - pi.z)) / (pj.z - pi.z) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** True when `pole` lies in the polygon's kernel: for every directed edge (in
 *  CCW winding), the pole is strictly on the interior (left) side of the line
 *  through that edge. Every point of a star-shaped polygon is then visible
 *  from `pole` along a straight segment that never leaves the polygon. Input
 *  is normalized to CCW winding first so the test works regardless of the
 *  authored winding. */
export function polygonIsStarShaped(points: readonly Point2D[], pole: Point2D): boolean {
  const n = points.length;
  if (n < 3) return false;
  const ccw = polygonSignedArea(points) >= 0 ? points : [...points].reverse();
  for (let i = 0; i < n; i++) {
    const a = ccw[i];
    const b = ccw[(i + 1) % n];
    const edgeX = b.x - a.x;
    const edgeZ = b.z - a.z;
    const toPoleX = pole.x - a.x;
    const toPoleZ = pole.z - a.z;
    // Left side of a CCW edge has a positive 2D cross product.
    const cross = edgeX * toPoleZ - edgeZ * toPoleX;
    if (cross < 0) return false;
  }
  return true;
}

function segmentsIntersect(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): boolean {
  const d1x = p2.x - p1.x;
  const d1z = p2.z - p1.z;
  const d2x = p4.x - p3.x;
  const d2z = p4.z - p3.z;
  const denom = d1x * d2z - d1z * d2x;
  if (Math.abs(denom) < 1e-12) return false; // parallel/collinear: treat as non-crossing
  const dx = p3.x - p1.x;
  const dz = p3.z - p1.z;
  const t = (dx * d2z - dz * d2x) / denom;
  const u = (dx * d1z - dz * d1x) / denom;
  const eps = 1e-9;
  return t > eps && t < 1 - eps && u > eps && u < 1 - eps;
}

/** O(n^2) segment-pair self-intersection test. Skips adjacent edges (they
 *  legitimately share an endpoint). */
export function polygonSelfIntersects(points: readonly Point2D[]): boolean {
  const n = points.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i) continue;
      const isAdjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (isAdjacent) continue;
      const b1 = points[j];
      const b2 = points[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/** The boundary x on the west (-1) or east (+1) side of the polygon at height
 *  z, i.e. the outermost edge-crossing x on that side. Returns null when the
 *  polygon does not span z. Used by render dressing to hug the wall profile. */
export function polygonXAtZ(points: readonly Point2D[], z: number, side: -1 | 1): number | null {
  let best: number | null = null;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const az = a.z;
    const bz = b.z;
    if (az === bz) continue;
    if ((z < az && z < bz) || (z > az && z > bz)) continue;
    if (z < Math.min(az, bz) || z > Math.max(az, bz)) continue;
    const t = (z - az) / (bz - az);
    if (t < 0 || t > 1) continue;
    const x = a.x + (b.x - a.x) * t;
    if (best === null) best = x;
    else if (side < 0 ? x < best : x > best) best = x;
  }
  return best;
}
