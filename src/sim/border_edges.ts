import { STRIP_MAX_X, STRIP_MIN_X, ZONES } from './data';
import type { ZoneDef } from './types';

// Ridge walls along every shared zone edge, each opened by a road pass. A
// zone with sealedSouthBorder instead gets a taller, narrower wall with NO
// pass, its crest shifted into the sealed zone's own band so the southern
// neighbor's border content keeps (nearly) its original ground. Sealed
// zones are entered only through a portal (see portals content).
//
// The world is a GRID of zone rectangles (see data.ts zoneAt): horizontal
// edges separate north-south neighbors (the classic band borders) and
// vertical edges separate east-west columns with the same math rotated a
// quarter turn. An edge that spans its whole world row keeps the classic
// unbounded ridge (byte-identical to the strip era); a partial edge
// feathers to nothing past its span ends.
export interface BorderEdge {
  kind: 'h' | 'v';
  at: number; // the edge line: z for 'h', x for 'v'
  lo: number; // span start along the edge (x for 'h', z for 'v')
  hi: number; // span end
  fullRow: boolean; // spans the whole world row: no end feather
  passAt: number; // pass coordinate along the span
  sealed: boolean;
  /** No ridge rises along this edge: the border is open water (a strait the
   *  north zone declares with waterSouthBorder). The pass still marks the
   *  land bridge. Absent on every classic edge. */
  water?: true;
}

/** The pass on a vertical edge between `a` (west) and `b` (east). A column
 *  zone holds ONE crossing value per side, and since the Quartered Isle a
 *  column's west side can face two strip zones (the Drakelands meet both the
 *  Frostveil and the isle), so the east neighbour's westPassZ may belong to
 *  the OTHER edge. The first candidate that lies inside this edge's span
 *  wins; with none inside, the classic precedence holds unchanged (west side
 *  first, then the east side, then the middle). */
function verticalPassAt(a: ZoneDef, b: ZoneDef, lo: number, hi: number): number {
  for (const passZ of [b.westPassZ, a.eastPassZ]) {
    if (passZ !== undefined && passZ >= lo && passZ <= hi) return passZ;
  }
  return b.westPassZ ?? a.eastPassZ ?? (lo + hi) / 2;
}

/** All shared edges between adjacent zone rects (pure; exported for tests). */
export function computeBorderEdges(zones: readonly ZoneDef[]): BorderEdge[] {
  const zx0 = (zn: ZoneDef) => zn.xMin ?? STRIP_MIN_X;
  const zx1 = (zn: ZoneDef) => zn.xMax ?? STRIP_MAX_X;
  const edges: BorderEdge[] = [];
  for (const a of zones) {
    for (const b of zones) {
      // horizontal edge: b sits directly north of a, rects overlapping in x
      if (a.zMax === b.zMin) {
        const lo = Math.max(zx0(a), zx0(b));
        const hi = Math.min(zx1(a), zx1(b));
        if (hi - lo > 1) {
          const sealed = b.sealedSouthBorder === true;
          // full row = nothing that touches or crosses the border line lies
          // beyond this span (a column zone whose band SPANS the line counts
          // too: its interior must not inherit the row wall)
          const fullRow = zones.every(
            (zn) => zn.zMax < a.zMax || zn.zMin > a.zMax || (zx0(zn) >= lo && zx1(zn) <= hi),
          );
          edges.push({
            kind: 'h',
            at: a.zMax + (sealed ? 15 : 0),
            lo,
            hi,
            fullRow,
            passAt: b.southPassX ?? 0,
            sealed,
            ...(b.waterSouthBorder && !sealed ? { water: true as const } : {}),
          });
        }
      }
      // vertical edge: b sits directly east of a, rects overlapping in z
      if (zx1(a) === zx0(b)) {
        const lo = Math.max(a.zMin, b.zMin);
        const hi = Math.min(a.zMax, b.zMax);
        if (hi - lo > 1) {
          edges.push({
            kind: 'v',
            at: zx1(a),
            lo,
            hi,
            fullRow: false, // a column border never spans the world's full z
            passAt: verticalPassAt(a, b, lo, hi),
            sealed: false,
          });
        }
      }
    }
  }
  return edges;
}

export const BORDER_EDGES: readonly BorderEdge[] = computeBorderEdges(ZONES);

// Crest z of every sealed border: an uncrossable line for swept movement
// within the edge's x span (plus its feather). Portal teleports assign
// positions directly and are unaffected; the column realms whose bands
// span the same z live outside the span and walk freely.
export const SEALED_BORDERS: readonly { at: number; lo: number; hi: number }[] =
  BORDER_EDGES.filter((e) => e.kind === 'h' && e.sealed).map((e) => ({
    at: e.at,
    lo: e.lo - 24,
    hi: e.hi + 24,
  }));

export function crossesSealedBorder(x: number, z0: number, z1: number): boolean {
  for (const b of SEALED_BORDERS) {
    if (x >= b.lo && x <= b.hi && (z0 - b.at) * (z1 - b.at) < 0) return true;
  }
  return false;
}
