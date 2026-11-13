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
  /** No ridge rises along this edge: it is the side of ground a
   *  claimsOverlap zone took from a column (types.ts ZoneDef.claimsOverlap),
   *  where the two zones meet over open land so the claimer fades into its
   *  neighbour instead of being walled off, and the neighbour's camps beside
   *  the line keep their ground. Absent on every classic edge. */
  open?: true;
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

interface Piece {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** A zone's ground as disjoint rects: its own rect, minus every rect a
 *  claimsOverlap neighbour takes out of it (types.ts ZoneDef.claimsOverlap).
 *  A zone nothing claims from is its one rect, so every classic edge below
 *  is found exactly as before. Exported for tests. */
export function zonePieces(zone: ZoneDef, zones: readonly ZoneDef[]): Piece[] {
  let pieces: Piece[] = [
    {
      x0: zone.xMin ?? STRIP_MIN_X,
      x1: zone.xMax ?? STRIP_MAX_X,
      z0: zone.zMin,
      z1: zone.zMax,
    },
  ];
  if (zone.claimsOverlap) return pieces;
  for (const claimer of zones) {
    if (claimer === zone || claimer.claimsOverlap !== true) continue;
    const c: Piece = {
      x0: claimer.xMin ?? STRIP_MIN_X,
      x1: claimer.xMax ?? STRIP_MAX_X,
      z0: claimer.zMin,
      z1: claimer.zMax,
    };
    const next: Piece[] = [];
    for (const r of pieces) {
      if (c.x0 >= r.x1 || c.x1 <= r.x0 || c.z0 >= r.z1 || c.z1 <= r.z0) {
        next.push(r);
        continue;
      }
      // full-width slabs south and north of the claim, then the side slivers
      if (c.z0 > r.z0) next.push({ ...r, z1: c.z0 });
      if (c.z1 < r.z1) next.push({ ...r, z0: c.z1 });
      const z0 = Math.max(r.z0, c.z0);
      const z1 = Math.min(r.z1, c.z1);
      if (c.x0 > r.x0) next.push({ x0: r.x0, x1: c.x0, z0, z1 });
      if (c.x1 < r.x1) next.push({ x0: c.x1, x1: r.x1, z0, z1 });
    }
    pieces = next;
  }
  return pieces;
}

/** Touching or overlapping spans merged, sorted by start. */
function mergeSpans(spans: [number, number][]): [number, number][] {
  spans.sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else out.push([span[0], span[1]]);
  }
  return out;
}

/** The spans along which a piece of `a` meets a piece of `b`, keyed by the
 *  edge line: `b` north of `a` for 'h', east of `a` for 'v'. Spans of one
 *  line merge, so a neighbour split in two by a claim still meets a whole
 *  shipped border in one edge. */
function sharedLines(
  kind: 'h' | 'v',
  pa: readonly Piece[],
  pb: readonly Piece[],
): Map<number, [number, number][]> {
  const lines = new Map<number, [number, number][]>();
  for (const p of pa) {
    for (const q of pb) {
      const touch = kind === 'h' ? p.z1 === q.z0 : p.x1 === q.x0;
      if (!touch) continue;
      const lo = kind === 'h' ? Math.max(p.x0, q.x0) : Math.max(p.z0, q.z0);
      const hi = kind === 'h' ? Math.min(p.x1, q.x1) : Math.min(p.z1, q.z1);
      if (hi - lo <= 1) continue;
      const at = kind === 'h' ? p.z1 : p.x1;
      const spans = lines.get(at) ?? [];
      spans.push([lo, hi]);
      lines.set(at, spans);
    }
  }
  for (const [at, spans] of lines) lines.set(at, mergeSpans(spans));
  return lines;
}

/** All shared edges between adjacent zones (pure; exported for tests). Runs
 *  over each zone's pieces, so a claimsOverlap zone meets its neighbours
 *  along the claim's outline; with no claim every zone is its one rect and
 *  the edges are the classic rect-adjacency set, in the classic order. */
export function computeBorderEdges(zones: readonly ZoneDef[]): BorderEdge[] {
  const pieces = new Map<ZoneDef, Piece[]>();
  for (const zn of zones) pieces.set(zn, zonePieces(zn, zones));
  const allPieces = [...pieces.values()].flat();
  const edges: BorderEdge[] = [];
  for (const a of zones) {
    for (const b of zones) {
      if (a === b) continue;
      const pa = pieces.get(a) ?? [];
      const pb = pieces.get(b) ?? [];
      // horizontal edges: b sits directly north of a, overlapping in x
      for (const [at, spans] of sharedLines('h', pa, pb)) {
        for (const [lo, hi] of spans) {
          const sealed = b.sealedSouthBorder === true;
          // full row = nothing that touches or crosses the border line lies
          // beyond this span (a column zone whose band SPANS the line counts
          // too: its interior must not inherit the row wall)
          const fullRow = allPieces.every(
            (pc) => pc.z1 < at || pc.z0 > at || (pc.x0 >= lo && pc.x1 <= hi),
          );
          edges.push({
            kind: 'h',
            at: at + (sealed ? 15 : 0),
            lo,
            hi,
            fullRow,
            passAt: b.southPassX ?? 0,
            sealed,
            ...(b.waterSouthBorder && !sealed ? { water: true as const } : {}),
          });
        }
      }
      // vertical edges: b sits directly east of a, overlapping in z
      for (const [at, spans] of sharedLines('v', pa, pb)) {
        for (const [lo, hi] of spans) {
          edges.push({
            kind: 'v',
            at,
            lo,
            hi,
            fullRow: false, // a column border never spans the world's full z
            passAt: verticalPassAt(a, b, lo, hi),
            sealed: false,
            ...(a.claimsOverlap || b.claimsOverlap ? { open: true as const } : {}),
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
