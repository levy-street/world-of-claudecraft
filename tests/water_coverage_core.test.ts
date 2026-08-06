// The fine water sheets have to cover every coastline in the world rect.
//
// The regression: the zone rects do NOT tile the world's bounding box, and each
// un-zoned cell was left to the horizon apron, whose vertex cells are ~48 x 57
// yards at the vista tiers. Interpolating depth / seabed slope / alpha across a
// 48 yard triangle draws hard straight-edged wedges and diagonal colour steps,
// which is what was reported along the southwest shore: x -540..-180 by
// z -180..180 is the ONE un-zoned cell carrying a real coastline (the vale's
// west headland stands ~15 yards over its own beach inside it).

import { describe, expect, it } from 'vitest';
import {
  type CoverageZone,
  coveredByOtherSheet,
  gapsAdjacentTo,
  rectCovers,
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
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const BOUNDS = { minX: WORLD_MIN_X, maxX: WORLD_MAX_X, minZ: WORLD_MIN_Z, maxZ: WORLD_MAX_Z };
const gaps = () => waterCoverageGaps(ZONES, BOUNDS, STRIP_MIN_X, STRIP_MAX_X);
const zoneRects = () => zoneSheetRects(ZONES, STRIP_MIN_X, STRIP_MAX_X);

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

  it('covers the southwest coastline cell, the one that drew the wedges', () => {
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

  it('pins that every gap holding a coastline is a real gap, against live terrain', () => {
    // A gap with BOTH wet and dry ground is one the apron cannot represent:
    // those are exactly the sheets buildSheet(requireShore) builds. Assert the
    // set is non-empty and that the southwest cell is in it, so a future grid
    // change that strands a new coast on the apron fails here.
    const withShore = gaps().filter((gap) => {
      let wet = false;
      let dry = false;
      for (let x = gap.xMin + 4; x < gap.xMax; x += 8) {
        for (let z = gap.zMin + 4; z < gap.zMax; z += 8) {
          if (terrainHeight(x, z, WORLD_SEED) < WATER_LEVEL) wet = true;
          else dry = true;
        }
      }
      return wet && dry;
    });
    expect(withShore.map((g) => g.id)).toEqual(['gap:-540,-180']);
  });

  it('treats a gap as an abutting sheet, so no calm chop stripe forms at the seam', () => {
    // The chop feather fires only where the APRON is across an edge. The vale's
    // west edge (x -180) now has the southwest gap sheet across it, so the
    // feather must NOT fire there.
    const sheets = [...zoneRects(), ...gaps()];
    expect(coveredByOtherSheet(sheets, 'eastbrook_vale', -180.5, 0)).toBe(true);
    // ...while the true outer edge of the world still has only the apron.
    expect(coveredByOtherSheet(sheets, 'gap:-540,-180', -540.5, 0)).toBe(false);
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
