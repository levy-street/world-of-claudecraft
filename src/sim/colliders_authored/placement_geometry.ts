// Pure transform and outline helpers for the authored placement lane: the
// renderer's XYZ euler as a matrix (so a tilted placement's collision leans
// with the model), the signed winding of an XZ outline, and its convex hull.
// Extracted out of colliders.ts with the placement emitters.

/** Row-major 3x3 for the renderer's XYZ euler, so a tilted placement's
 *  collision leans with the model instead of standing where the untilted asset
 *  was. Matches THREE.Euler(x, y, z, 'XYZ') exactly. */
export function eulerMatrix(rx: number, ry: number, rz: number): number[] {
  const cx = Math.cos(rx),
    sx = Math.sin(rx),
    cy = Math.cos(ry),
    sy = Math.sin(ry),
    cz = Math.cos(rz),
    sz = Math.sin(rz);
  return [
    cy * cz,
    -cy * sz,
    sy,
    cx * sz + sx * sy * cz,
    cx * cz - sx * sy * sz,
    -sx * cy,
    sx * sz - cx * sy * cz,
    sx * cz + cx * sy * sz,
    cx * cy,
  ];
}

export function applyMat(m: readonly number[], x: number, y: number, z: number): Point3 {
  return {
    x: m[0] * x + m[1] * y + m[2] * z,
    y: m[3] * x + m[4] * y + m[5] * z,
    z: m[6] * x + m[7] * y + m[8] * z,
  };
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Signed area sign of a closed XZ outline; negative means clockwise. */
export function outlineWinding(hull: readonly [number, number][]): number {
  let signed = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    signed += a[0] * b[1] - b[0] * a[1];
  }
  return signed;
}

/** Convex hull of an XZ point cloud (monotone chain), for a tilted outline. */
export function convexHullXZ(points: readonly [number, number][]): [number, number][] {
  if (points.length < 3) return [...points];
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (src: [number, number][]): [number, number][] => {
    const out: [number, number][] = [];
    for (const p of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...build(pts), ...build([...pts].reverse())];
}
