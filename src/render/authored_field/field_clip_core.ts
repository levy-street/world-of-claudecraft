// Planar clipping for the authored-field terrain plan (field_mesh_core.ts): a
// walkable top is drawn only where its surface OWNS the ground, the way the
// sim's height answers (the last surface containing a point wins). Without it
// an earlier, higher terrace was drawn straight over a later, lower surface
// cut into it (the Sunken Bastion's moat ring inside the Lower Bailey, the Sea
// Gate ramp into the bailey lip), and a player walking the lower floor stood
// under the drawn paving with only their head showing.
//
// The subtraction is exact for convex clippers (a circle's fine ring, a
// rectangle) and decomposes a concave one (a bent path band) into ear-clipped
// triangles first. Every result piece is convex, so a fan triangulates it.
//
// Three-free, DOM-free, deterministic.

export type Ring = [number, number][];

const AREA_EPS = 1e-7;

/** Signed area in the x-z plane: positive when the ring winds counter-clockwise
 *  (interior on the LEFT of every edge, left of a->b = cross(b - a, p - a) > 0). */
export function ringArea(ring: readonly (readonly [number, number])[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

/** The ring wound counter-clockwise (a copy). */
export function ccw(ring: readonly (readonly [number, number])[]): Ring {
  const out: Ring = ring.map((p) => [p[0], p[1]]);
  return ringArea(out) < 0 ? out.reverse() : out;
}

/** True when a counter-clockwise ring is convex (collinear runs allowed). */
export function isConvexCcw(ring: Ring): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const c = ring[(i + 2) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross < -1e-9) return false;
  }
  return true;
}

/** Sutherland-Hodgman against one line: keep the side where `sign * cross >= 0`
 *  (sign 1: the left of a->b, the inside of a counter-clockwise clipper). */
function clipLine(
  poly: Ring,
  a: readonly [number, number],
  b: readonly [number, number],
  sign: 1 | -1,
): Ring {
  const out: Ring = [];
  const n = poly.length;
  if (n === 0) return out;
  const ex = b[0] - a[0];
  const ez = b[1] - a[1];
  const side = (p: readonly [number, number]): number =>
    sign * (ex * (p[1] - a[1]) - ez * (p[0] - a[0]));
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push([p[0], p[1]]);
    if (sp >= 0 !== sq >= 0) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function ringBox(ring: readonly (readonly [number, number])[]): Box {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of ring) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  return { minX, maxX, minZ, maxZ };
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
}

/**
 * A convex polygon minus a convex counter-clockwise clipper, as convex pieces:
 * for each clipper edge in turn, the part of what is left that lies outside
 * that edge is kept, the rest carries on to the next edge; whatever survives
 * every edge lies inside the clipper and is dropped.
 */
export function subtractConvex(poly: Ring, clipper: Ring): Ring[] {
  if (!boxesOverlap(ringBox(poly), ringBox(clipper))) return [poly];
  const out: Ring[] = [];
  let rest = poly;
  for (let i = 0; i < clipper.length; i++) {
    const a = clipper[i];
    const b = clipper[(i + 1) % clipper.length];
    const outside = clipLine(rest, a, b, -1);
    if (outside.length >= 3 && Math.abs(ringArea(outside)) > AREA_EPS) out.push(outside);
    rest = clipLine(rest, a, b, 1);
    if (rest.length < 3 || Math.abs(ringArea(rest)) <= AREA_EPS) return out;
  }
  return out;
}

/** A clipper prepared once: its convex parts and their joint bounding box. */
export interface PreparedClipper {
  box: Box;
  parts: Ring[];
}

/** Split a closed ring into convex counter-clockwise parts (itself when
 *  convex, else the triangles `triangulate` returns as index triples). */
export function prepareClipper(
  ring: readonly (readonly [number, number])[],
  triangulate: (pts: readonly (readonly [number, number])[]) => number[],
): PreparedClipper {
  const r = ccw(ring);
  if (isConvexCcw(r)) return { box: ringBox(r), parts: [r] };
  const tris = triangulate(r);
  const parts: Ring[] = [];
  for (let i = 0; i < tris.length; i += 3) {
    parts.push(ccw([r[tris[i]], r[tris[i + 1]], r[tris[i + 2]]]));
  }
  return { box: ringBox(r), parts };
}

/** A convex polygon minus every prepared clipper, as convex pieces. */
export function subtractAll(poly: Ring, clippers: readonly PreparedClipper[]): Ring[] {
  let pieces: Ring[] = [poly];
  const box = ringBox(poly);
  for (const c of clippers) {
    if (!boxesOverlap(box, c.box)) continue;
    for (const part of c.parts) {
      const next: Ring[] = [];
      for (const p of pieces) next.push(...subtractConvex(p, part));
      pieces = next;
      if (pieces.length === 0) return pieces;
    }
  }
  return pieces;
}
