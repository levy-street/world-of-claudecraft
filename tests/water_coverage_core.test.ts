// The fine water sheets have to cover every MEANINGFUL coastline in the world
// rect, and must NOT stretch a fine sheet over a rect that is almost all open
// sea.
//
// The zone rects do NOT tile the world's bounding box; each un-zoned cell is
// otherwise left to the horizon apron, whose vertex cells are ~48 x 57 yards at
// the vista tiers. Interpolating depth / seabed slope / alpha across a 48 yard
// triangle draws hard straight-edged wedges, so a cell with a real coastline
// needs its own fine sheet. But the southwest cell (x -540..-180 by z -180..180)
// is a 360x360yd rect whose ONLY dry ground is a ~1% sliver at the vale
// headland's west flank, off the play strip: a fine sheet there interpolates
// its shore attribute across the whole open-sea expanse and bands over the apron
// (the reported Eastbrook "duplicated water layer"). So a gap sheet is built
// only when its dry-land fraction clears WATER_GAP_MIN_SHORE_FRACTION.

import { describe, expect, it } from 'vitest';
import { shoreDepthAt } from '../src/render/water_core';
import {
  type CoverageZone,
  coveredByOtherSheet,
  gapDryFraction,
  gapSheetWorthBuilding,
  gapsAdjacentTo,
  rectCovers,
  WATER_GAP_MIN_SHORE_FRACTION,
  type WaterSheetRect,
  waterCoverageGaps,
  zoneSheetRects,
} from '../src/render/water_coverage_core';
import {
  STRIP_MAX_X,
  STRIP_MIN_X,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_X,
  WORLD_MIN_Z,
  ZONES,
} from '../src/sim/data';
import { WORLD_SEED } from '../src/sim/world_seed';

const BOUNDS = { minX: WORLD_MIN_X, maxX: WORLD_MAX_X, minZ: WORLD_MIN_Z, maxZ: WORLD_MAX_Z };
const gaps = () => waterCoverageGaps(ZONES, BOUNDS, STRIP_MIN_X, STRIP_MAX_X);
const zoneRects = () => zoneSheetRects(ZONES, STRIP_MIN_X, STRIP_MAX_X);

// Share of a gap rect that scans as dry land, against live terrain. This calls
// the SAME gapDryFraction on the SAME stride, with the same shoreDepthAt
// predicate, that water.ts builtGapRects decides on: the southwest fraction is
// only a dozen sampled points wide over a 360x360yd rect, so a guard that
// re-rolled its own lattice here would be reporting a different number than the
// decision it claims to pin. onStrip flips if ANY dry sample sits on the play
// strip (x > STRIP_MIN_X), i.e. a coast a skip would strand on the apron.
const gapDryScan = (gap: WaterSheetRect): { frac: number; onStrip: boolean } => {
  let onStrip = false;
  const frac = gapDryFraction(gap, (x, z) => {
    if (shoreDepthAt(x, z, WORLD_SEED) > 0) return false;
    if (x > STRIP_MIN_X) onStrip = true;
    return true;
  });
  return { frac, onStrip };
};
// The gaps that actually get a fine sheet (the rest are open sea the apron owns).
const builtGaps = () => gaps().filter((g) => gapSheetWorthBuilding(gapDryScan(g).frac));

describe('water sheet coverage', () => {
  it('finds no gap that any zone already claims', () => {
    const rects = zoneRects();
    for (const gap of gaps()) {
      const cx = (gap.xMin + gap.xMax) / 2;
      const cz = (gap.zMin + gap.zMax) / 2;
      const claimed = rects.filter((r) => rectCovers(r, cx, cz)).map((r) => r.id);
      expect(claimed, `${gap.id} overlaps ${claimed.join(',')}`).toEqual([]);
    }
  });

  it('leaves no point of the world rect uncovered by a zone or a gap', () => {
    // The partition claim the whole design rests on: sample a lattice fine
    // enough to land inside every cell and assert each point has an owner.
    const sheets = [...zoneRects(), ...gaps()];
    const missing: string[] = [];
    for (let x = WORLD_MIN_X + 5; x < WORLD_MAX_X; x += 37) {
      for (let z = WORLD_MIN_Z + 5; z < WORLD_MAX_Z; z += 41) {
        if (!sheets.some((r) => rectCovers(r, x, z))) missing.push(`(${x}, ${z})`);
      }
    }
    expect(missing, missing.slice(0, 8).join(' ')).toEqual([]);
  });

  it('keeps the southwest un-zoned cell as a partition cell', () => {
    // The rect still exists and partitions the world (the "no point uncovered"
    // test leans on it); whether it earns a FINE sheet is decided separately,
    // below. Geometry pinned so a grid change that moves this cell is noticed.
    const sw = gaps().find((g) => g.xMin === -540 && g.zMin === -180);
    expect(
      sw,
      `gaps: ${gaps()
        .map((g) => g.id)
        .join(' ')}`,
    ).toBeDefined();
    expect(sw?.xMax).toBe(-180);
    expect(sw?.zMax).toBe(180);
  });

  it('skips the open-sea southwest gap sheet, against live terrain', () => {
    // The regression: the southwest cell is a 360x360yd rect whose only dry
    // ground is a ~1% sliver at the vale headland's west flank. It has SOME dry
    // land, so the original zero-dry gate built a full fine sheet over it, and
    // that sheet interpolated its shore attribute across the open sea and banded
    // over the apron (the reported "duplicated water layer"). A nonzero but
    // sub-threshold fraction must now SKIP.
    const sw = gaps().find((g) => g.xMin === -540 && g.zMin === -180);
    if (!sw) throw new Error('southwest gap missing');
    const { frac, onStrip } = gapDryScan(sw);
    // Has a coastline sliver (so the old gate would have built it)...
    expect(frac).toBeGreaterThan(0);
    // ...but far too little to justify a fine sheet over all that open water.
    expect(frac).toBeLessThan(WATER_GAP_MIN_SHORE_FRACTION);
    expect(gapSheetWorthBuilding(frac)).toBe(false);
    // Pinned as a RANGE, not just "under the threshold". The shipped grid reads
    // 1.46% against a 3% gate, a margin of only about 2x, and this PR's own vale
    // carve already moved it (it submerged part of the sliver: 1.56% before).
    // A one-sided assert would stay green right up to the moment a future
    // terrain edit flipped this gap into building a full sheet over open sea and
    // brought the banding back. These bounds red on the drift instead, while
    // still leaving room for an ordinary nearby edit.
    expect(frac).toBeGreaterThan(0.008);
    expect(frac).toBeLessThan(0.022);
    // The sliver it drops is off the play strip, so no on-strip coast is lost.
    expect(onStrip).toBe(false);
    // On today's grid every un-zoned cell is open-sea-dominated, so nothing
    // builds; the apron owns them all. A future grid that strands a REAL coast
    // (fraction over the threshold) would appear here and be caught.
    expect(builtGaps().map((g) => g.id)).toEqual([]);
  });

  it('a skipped gap does not abut as a sheet, so the neighbour feathers to apron', () => {
    // The chop feather fires only where the APRON is across an edge. The
    // southwest gap sheet is SKIPPED (open sea), so the vale's west edge (x -180)
    // abuts the apron and MUST feather there, the way it did before gap sheets
    // existed. water.ts passes the BUILT set here, not every rect.
    const built = [...zoneRects(), ...builtGaps()];
    expect(coveredByOtherSheet(built, 'eastbrook_vale', -180.5, 0)).toBe(false);
    expect(coveredByOtherSheet(built, 'gap:-540,-180', -540.5, 0)).toBe(false);
    // But a gap that IS worth building still counts as an abutting sheet, so no
    // calm chop stripe forms at a real zone/gap seam.
    const withBuiltGap = [
      ...zoneRects(),
      { id: 'gap:built', xMin: -540, xMax: -180, zMin: -180, zMax: 180 },
    ];
    expect(coveredByOtherSheet(withBuiltGap, 'eastbrook_vale', -180.5, 0)).toBe(true);
  });

  it('decides gap sheets on a shore fraction, at the pinned threshold', () => {
    expect(WATER_GAP_MIN_SHORE_FRACTION).toBe(0.03);
    // Below the threshold the apron owns the rect; at or above it earns a sheet.
    expect(gapSheetWorthBuilding(0)).toBe(false);
    expect(gapSheetWorthBuilding(0.0146)).toBe(false); // the measured southwest sliver
    expect(gapSheetWorthBuilding(WATER_GAP_MIN_SHORE_FRACTION - 1e-6)).toBe(false);
    expect(gapSheetWorthBuilding(WATER_GAP_MIN_SHORE_FRACTION)).toBe(true);
    expect(gapSheetWorthBuilding(0.25)).toBe(true);
  });

  it('attaches each gap to a zone that actually touches it', () => {
    const rects = zoneRects();
    for (const gap of gaps()) {
      const owners = rects.filter((r) => gapsAdjacentTo([gap], r).length > 0);
      expect(owners.length, `${gap.id} has no adjacent zone to build it`).toBeGreaterThan(0);
    }
  });

  it('partitions a synthetic grid with an interior hole', () => {
    // Behaviour pinned independently of the shipped world: a ring of four
    // zones around an empty middle yields exactly the middle cell.
    const zones: CoverageZone[] = [
      { id: 'nw', xMin: 0, xMax: 10, zMin: 10, zMax: 20 },
      { id: 'ne', xMin: 10, xMax: 20, zMin: 10, zMax: 20 },
      { id: 'sw', xMin: 0, xMax: 10, zMin: 0, zMax: 10 },
    ];
    const out = waterCoverageGaps(zones, { minX: 0, maxX: 20, minZ: 0, maxZ: 20 }, 0, 20);
    expect(out.map((g) => [g.xMin, g.xMax, g.zMin, g.zMax])).toEqual([[10, 20, 0, 10]]);
  });

  it('returns nothing when the zones already tile the bounds', () => {
    const zones: CoverageZone[] = [
      { id: 'a', xMin: 0, xMax: 10, zMin: 0, zMax: 10 },
      { id: 'b', xMin: 10, xMax: 20, zMin: 0, zMax: 10 },
    ];
    expect(waterCoverageGaps(zones, { minX: 0, maxX: 20, minZ: 0, maxZ: 10 }, 0, 20)).toEqual([]);
  });

  it('applies the strip default to a zone with no explicit x range', () => {
    const zones: CoverageZone[] = [{ id: 'strip', zMin: 0, zMax: 10 }];
    const rects = zoneSheetRects(zones, -180, 180);
    expect(rects[0]).toEqual({ id: 'strip', xMin: -180, xMax: 180, zMin: 0, zMax: 10 });
    // ...and the columns beside it are then genuine gaps.
    const out = waterCoverageGaps(zones, { minX: -540, maxX: 540, minZ: 0, maxZ: 10 }, -180, 180);
    expect(out.map((g) => [g.xMin, g.xMax])).toEqual([
      [-540, -180],
      [180, 540],
    ]);
  });

  it('ignores a degenerate rect that only shares a boundary line', () => {
    const zones: CoverageZone[] = [
      { id: 'a', xMin: 0, xMax: 10, zMin: 0, zMax: 10 },
      { id: 'line', xMin: 10, xMax: 10, zMin: 0, zMax: 10 },
    ];
    expect(waterCoverageGaps(zones, { minX: 0, maxX: 10, minZ: 0, maxZ: 10 }, 0, 10)).toEqual([]);
  });

  it('finds adjacency across a shared edge but not across a distant one', () => {
    const gap: WaterSheetRect = { id: 'g', xMin: 0, xMax: 10, zMin: 0, zMax: 10 };
    const touching: WaterSheetRect = { id: 't', xMin: 10, xMax: 20, zMin: 0, zMax: 10 };
    const apart: WaterSheetRect = { id: 'f', xMin: 40, xMax: 50, zMin: 0, zMax: 10 };
    expect(gapsAdjacentTo([gap], touching).map((g) => g.id)).toEqual(['g']);
    expect(gapsAdjacentTo([gap], apart)).toEqual([]);
  });
});
