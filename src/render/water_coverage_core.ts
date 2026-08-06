// PURE (unit-tested, Three-free): which rectangles the fine water sheets have
// to cover, and which sheet owns a given point.
//
// The water surface is drawn by two kinds of sheet: a fine per-zone plane at
// ~2 yard vertex spacing, and ONE horizon apron whose cells are ~48 x 57 yards
// at the vista tiers. Every shore signal (depth, seabed slope, and through them
// the foam band, the shallow tint, the shore film and the dry-tile cull) is a
// per-vertex attribute, so a sheet resolves the coastline only as finely as its
// grid: the apron cannot represent a beach at all, and interpolating a shore
// across a 48 yard triangle is what draws hard straight-edged wedges and
// diagonal colour steps along a coast.
//
// The zone rects do NOT tile the world's bounding box. The grid is a set of
// per-realm rectangles, and where no realm claims a cell (today: the southwest
// corner, x -540..-180 by z -180..180, plus the northern bay) the only sheet
// over that water is the apron. The southwest corner carries a real coastline
// (the vale's west headland stands 15 yards over its own beach), which is
// exactly where the wedges were reported.
//
// So: the apron is only ever CORRECT where there is no coastline to resolve.
// Anywhere the world rect has a shore, a fine sheet has to own it. This module
// computes the un-zoned rectangles from the zone list, so the rule holds for
// any future grid (and for a custom map) instead of being tuned to today's.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts).

/** A rectangle a fine water sheet covers. Zone planes carry their zone id. */
export interface WaterSheetRect {
  readonly id: string;
  readonly xMin: number;
  readonly xMax: number;
  readonly zMin: number;
  readonly zMax: number;
}

/** The zone fields this module needs; ZoneDef satisfies it structurally. */
export interface CoverageZone {
  readonly id: string;
  readonly zMin: number;
  readonly zMax: number;
  readonly xMin?: number;
  readonly xMax?: number;
}

export interface CoverageBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Degenerate rects (a shared boundary line, not an area) are not coverage. */
const MIN_RECT_SIDE = 1e-6;

function rectOf(zone: CoverageZone, stripMinX: number, stripMaxX: number): WaterSheetRect {
  return {
    id: zone.id,
    xMin: zone.xMin ?? stripMinX,
    xMax: zone.xMax ?? stripMaxX,
    zMin: zone.zMin,
    zMax: zone.zMax,
  };
}

/** Every zone's rect, with the strip default applied, in zone order. */
export function zoneSheetRects(
  zones: readonly CoverageZone[],
  stripMinX: number,
  stripMaxX: number,
): WaterSheetRect[] {
  return zones.map((zone) => rectOf(zone, stripMinX, stripMaxX));
}

/**
 * The rectangles inside `bounds` that no zone claims.
 *
 * Cut the bounding box on every zone boundary line in both axes: zone
 * membership is constant inside each resulting cell (the same argument
 * worldXBoundsAt's row index rests on), so testing one point per cell decides
 * the whole cell. Cells are returned individually rather than merged into
 * maximal rectangles: there are a handful, each becomes at most one sheet, and
 * keeping them axis-cut means a gap sheet always shares its full edge with
 * whatever lies across it, which is what the chop feather's abutment test and
 * the seam agreement both want.
 *
 * Deterministic order (x then z), so sheet ids are stable across runs.
 */
export function waterCoverageGaps(
  zones: readonly CoverageZone[],
  bounds: CoverageBounds,
  stripMinX: number,
  stripMaxX: number,
): WaterSheetRect[] {
  const rects = zoneSheetRects(zones, stripMinX, stripMaxX);
  const cut = (lo: number, hi: number, lines: number[]): number[] => {
    const inside = lines.filter((v) => v > lo + MIN_RECT_SIDE && v < hi - MIN_RECT_SIDE);
    return [...new Set([lo, ...inside, hi])].sort((a, b) => a - b);
  };
  const xs = cut(
    bounds.minX,
    bounds.maxX,
    rects.flatMap((r) => [r.xMin, r.xMax]),
  );
  const zs = cut(
    bounds.minZ,
    bounds.maxZ,
    rects.flatMap((r) => [r.zMin, r.zMax]),
  );
  const gaps: WaterSheetRect[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const xMin = xs[i];
      const xMax = xs[i + 1];
      const zMin = zs[j];
      const zMax = zs[j + 1];
      if (xMax - xMin < MIN_RECT_SIDE || zMax - zMin < MIN_RECT_SIDE) continue;
      const cx = (xMin + xMax) / 2;
      const cz = (zMin + zMax) / 2;
      const claimed = rects.some(
        (r) => cx >= r.xMin && cx <= r.xMax && cz >= r.zMin && cz <= r.zMax,
      );
      if (claimed) continue;
      gaps.push({ id: `gap:${xMin},${zMin}`, xMin, xMax, zMin, zMax });
    }
  }
  return gaps;
}

/** True when (x, z) lies inside the rect (edges inclusive, as coverage is). */
export function rectCovers(rect: WaterSheetRect, x: number, z: number): boolean {
  return x >= rect.xMin && x <= rect.xMax && z >= rect.zMin && z <= rect.zMax;
}

/**
 * True when some sheet OTHER than `selfId` covers (x, z).
 *
 * The chop-displacement feather reads this: a sheet feathers its short chop to
 * the apron's groundswell-only constant approaching an edge the APRON is across,
 * and must not feather an edge another fine sheet is across (both carry
 * identical chop there, and feathering drew a calm stripe down every internal
 * border water). Gap sheets count exactly like zone planes here, or the new
 * seam between a zone and its gap neighbour grows the same stripe.
 */
export function coveredByOtherSheet(
  sheets: readonly WaterSheetRect[],
  selfId: string,
  x: number,
  z: number,
): boolean {
  return sheets.some((rect) => rect.id !== selfId && rectCovers(rect, x, z));
}

/**
 * Gap rects sharing a boundary with `rect` (including diagonal corner touches).
 *
 * Gap sheets have no zone of their own, so nothing streams them in. They are
 * built alongside the ADJACENT zone's prepare instead, which keeps the whole
 * rule inside the water view: no renderer change, and a gap's sheet is always
 * ready before the player can stand in a zone that looks out over it.
 */
export function gapsAdjacentTo(
  gaps: readonly WaterSheetRect[],
  rect: WaterSheetRect,
  reachYards = 0,
): WaterSheetRect[] {
  const r = Math.max(0, reachYards);
  return gaps.filter(
    (gap) =>
      gap.xMin - r <= rect.xMax &&
      gap.xMax + r >= rect.xMin &&
      gap.zMin - r <= rect.zMax &&
      gap.zMax + r >= rect.zMin,
  );
}
