import { describe, expect, it } from 'vitest';
import {
  STRIP_MAX_X,
  STRIP_MIN_X,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_X,
  WORLD_MIN_Z,
  ZONES,
  zoneAt,
} from '../src/sim/data';
import type { ZoneDef } from '../src/sim/types';
import { inHollowOpenSea, terrainHeight, WATER_LEVEL, zoneBiomeAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';
import { openSeaNearness } from '../src/ui/map_open_sea_edge_core';
import {
  type MapRegion,
  mapCanvasHeight,
  mapZoneRegion,
  paintTerrainRows,
} from '../src/ui/map_terrain';

const SEED = WORLD_SEED;

function zoneRegion(zoneId: string): MapRegion {
  const zone = ZONES.find((z) => z.id === zoneId) ?? ZONES[0];
  return { minX: WORLD_MIN_X, maxX: WORLD_MAX_X, minZ: zone.zMin, maxZ: zone.zMax };
}

// Render the whole canvas in one pass.
function renderFull(W: number, region: MapRegion, seed: number): Uint8ClampedArray {
  const H = mapCanvasHeight(W, region);
  const data = new Uint8ClampedArray(W * H * 4);
  paintTerrainRows(data, W, H, region, seed, 0, H);
  return data;
}

// Render the same canvas in row-band slices, the way the idle prewarm does.
function renderChunked(
  W: number,
  region: MapRegion,
  seed: number,
  rowsPerSlice: number,
): Uint8ClampedArray {
  const H = mapCanvasHeight(W, region);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let row = 0; row < H; row += rowsPerSlice) {
    paintTerrainRows(data, W, H, region, seed, row, Math.min(H, row + rowsPerSlice));
  }
  return data;
}

describe('map terrain painter', () => {
  const region = zoneRegion(ZONES[1]?.id ?? ZONES[0].id);
  const W = 96; // small but representative; keeps the test fast

  it('chunked render is byte-identical to a single pass (any slice size)', () => {
    const full = renderFull(W, region, SEED);
    for (const slice of [1, 7, 16, 13]) {
      expect(renderChunked(W, region, SEED, slice)).toEqual(full);
    }
  });

  it('is deterministic for a fixed seed and region', () => {
    expect(renderFull(W, region, SEED)).toEqual(renderFull(W, region, SEED));
  });

  it('writes a fully opaque RGBA buffer', () => {
    const data = renderFull(W, region, SEED);
    for (let k = 3; k < data.length; k += 4) expect(data[k]).toBe(255);
  });

  it('produces different terrain for different zones', () => {
    const a = renderFull(W, zoneRegion(ZONES[0].id), SEED);
    const b = renderFull(W, zoneRegion(ZONES[1].id), SEED);
    expect(a).not.toEqual(b);
  });

  // zoneBiomeAt now IS `zoneAt(x, z).biome` (the merge settlement delegated
  // it), so comparing the two would be a tautology that can never fail. The
  // map-colour contract is pinned as LITERALS instead, one per ladder arm of
  // the 2D walk: a rect hit in each column at one shared z, the
  // southmost-containing-band fallback where no rect covers x, and the
  // northmost clamp past the world's end. Values re-derived from the shipped
  // ZONES table; a zone reshape that moves these is a map-colour change and
  // should be decided, not absorbed.
  it('zoneBiomeAt walks the 2D ladder (literal probes per arm)', () => {
    // One z, three columns, three different biomes: the 2D rect hit.
    expect(zoneBiomeAt(0, 400)).toBe('marsh'); // mirefen strip
    expect(zoneBiomeAt(300, 400)).toBe('gale'); // galecrest east column
    expect(zoneBiomeAt(-300, 400)).toBe('fen'); // willowfen west column
    // No rect covers x=600 anywhere: the southmost band containing z wins.
    expect(zoneBiomeAt(600, 400)).toBe('marsh');
    // Past every zone's north end: the northmost zone clamps.
    expect(zoneBiomeAt(0, 2500)).toBe('ember'); // drakelands, zMax 2420
  });
});

// The open-sea limit: the swim-fatigue boundary is a rect test, so before this
// the safe/lethal colour step painted a hard straight edge through open water
// and the map read as a lighter box pasted over the sea. The sea is one ramp
// now: water deepens toward the open ocean and the boundary is NOT marked (the
// sim states it, with a toast and 8s of grace). Sampled in WORLD coordinates
// rather than pixels, because every claim here is about yards: how far ahead the
// deepening reaches, and that nothing is drawn at the limit itself.
describe('map terrain painter: the open-sea limit', () => {
  const zone = ZONES.find((z) => z.id === 'wraithwood');
  if (!zone) throw new Error('wraithwood zone missing');
  const region = mapZoneRegion(zone);
  // Plates bake per zone now (mapPlateWidth; the Wraithwood's is 613), but the
  // claims here are in yards, so any resolution fine enough to resolve a ~1 yd
  // feature will do. 480 keeps the render cheap.
  const W = 480;
  const H = mapCanvasHeight(W, region);
  const data = renderFull(W, region, SEED);

  const luma = (x: number, z: number): number => {
    const ix = Math.min(
      W - 1,
      Math.max(0, Math.round(((region.maxX - x) / (region.maxX - region.minX)) * W)),
    );
    const iy = Math.min(
      H - 1,
      Math.max(0, Math.round(((region.maxZ - z) / (region.maxZ - region.minZ)) * H)),
    );
    const k = (iy * W + ix) * 4;
    return 0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2];
  };
  const isWater = (x: number, z: number) => terrainHeight(x, z, SEED) < WATER_LEVEL;

  /** World x where safe water turns lethal at this z, with open water either
   *  side of it (so the reading is about the limit, never a shoreline). The
   *  Wraithwood is a COLUMN zone, so its own x band is searched, not the strip. */
  function crossingAt(z: number): number | null {
    for (let x = region.minX + 40; x < region.maxX - 40; x += 0.5) {
      if (inHollowOpenSea(x, z) || !isWater(x, z)) continue;
      if (!inHollowOpenSea(x + 0.5, z)) continue; // lethal on the +x side
      // Open water either side, safe for 30 yd inward and lethal for 12 yd
      // outward, so the reading is an unambiguous crossing rather than a
      // shoreline or a narrow channel between two lethal bands.
      let clear = true;
      for (let d = -30; d <= 12; d += 1.5) if (!isWater(x + d, z)) clear = false;
      for (let d = -30; d < 0; d += 1.5) if (inHollowOpenSea(x + d, z)) clear = false;
      for (let d = 1; d <= 12; d += 1.5) if (!inHollowOpenSea(x + d, z)) clear = false;
      // Comparable depth at the two sample points, so the reading is about the
      // approach easing and not the depth grade running under it, and the far
      // point demonstrably clear of ANY limit (near the zone's eastern margin a
      // patch of water can have lethal sea on both sides, which eases both
      // samples and makes the comparison meaningless).
      if (Math.abs(terrainHeight(x - 2, z, SEED) - terrainHeight(x - 28, z, SEED)) > 0.6)
        clear = false;
      if (openSeaNearness(x - 28, z, inHollowOpenSea) > 0) clear = false;
      if (clear) return x; // else keep looking: that one was not a clean limit
    }
    return null;
  }

  const crossings = [1300, 1340, 1400, 1500, 1600, 1700, 1800]
    .map((z) => ({ z, x: crossingAt(z) }))
    .filter((c): c is { z: number; x: number } => c.x !== null);

  it('finds real limit crossings in open water to test against', () => {
    expect(crossings.length).toBeGreaterThan(2);
  });

  it('deepens the safe water as the limit closes', () => {
    // Flat without the approach easing: the old painter held one safe tone right
    // up to the step.
    const deepened = crossings.filter(({ x, z }) => luma(x - 2, z) < luma(x - 28, z));
    expect(deepened.length).toBe(crossings.length);
  });

  it('does NOT mark the limit, because the sim states it far better', () => {
    // Deliberate, and the reason it is safe: crossing raises an on-screen error
    // toast repeated every 4s plus 8 seconds of grace before the first damage
    // pulse (src/sim/fatigue.ts), which is real time to turn around and reaches
    // a swimmer who is looking at the world rather than at the map. A rule drawn
    // across open water restates that less well and costs a straight line
    // through the sea, so the map draws no boundary of its own: no pixel near
    // the limit is brighter than the safe water well inside it.
    for (const { x, z } of crossings) {
      let brightest = 0;
      for (let d = -3; d <= 0; d += 0.25) brightest = Math.max(brightest, luma(x + d, z));
      expect(brightest, `z=${z}`).toBeLessThanOrEqual(luma(x - 28, z));
    }
  });

  it('keeps the lethal side deeper on the ramp than water well inside the limit', () => {
    // One sea, walked to different depths: continuous colour, but open ocean
    // still reads as open ocean rather than flattening into the shallows.
    for (const { x, z } of crossings) {
      expect(luma(x + 8, z), `z=${z}`).toBeLessThan(luma(x - 28, z));
    }
  });
});

// The plate REGION itself, pinned without baking anything. The bake guard checks
// the dimensions that fall out of this, which would still pass if the geometry
// were wrong in a way that happened to keep its aspect; these are the two claims
// the geometry exists for, plus the one it must never break.
describe('map terrain painter: the plate region', () => {
  const zoneById = (id: string): ZoneDef => {
    const zone = ZONES.find((z) => z.id === id);
    if (!zone) throw new Error(`missing zone ${id}`);
    return zone;
  };

  it('always covers the zone it is for', () => {
    // The claim everything else rests on: widening the plate must never crop the
    // zone the map is OF.
    for (const zone of ZONES) {
      const r = mapZoneRegion(zone);
      // A strip zone declares no x bounds and spans the strip, the same
      // fallback mapZoneRegion applies.
      const zoneMinX = zone.xMin ?? STRIP_MIN_X;
      const zoneMaxX = zone.xMax ?? STRIP_MAX_X;
      expect(r.minX, `${zone.id} west`).toBeLessThanOrEqual(zoneMinX);
      expect(r.maxX, `${zone.id} east`).toBeGreaterThanOrEqual(zoneMaxX);
      expect(r.minZ, `${zone.id} south`).toBeLessThanOrEqual(zone.zMin);
      expect(r.maxZ, `${zone.id} north`).toBeGreaterThanOrEqual(zone.zMax);
    }
  });

  it('squares out to the window for a zone taller than it is wide', () => {
    // The Wraithwood is a column zone: 360 yd wide, 560 tall. The window frames
    // a 560 square, and the plate used to stop at the 360, which is the flat
    // ocean margin that made the map read as a lighter box.
    const zone = zoneById('wraithwood');
    const r = mapZoneRegion(zone);
    expect((zone.xMax ?? 0) - (zone.xMin ?? 0)).toBeLessThan(zone.zMax - zone.zMin);
    expect(r.maxX - r.minX).toBeGreaterThan((zone.xMax ?? 0) - (zone.xMin ?? 0));
    // The extra width is real world, not padding: it reaches into the strip.
    expect(r.minX).toBeLessThan(zone.xMin ?? 0);
  });

  it('never reaches past the world, however wide the square wants to be', () => {
    // terrainHeight answers for any coordinate, so an unclamped square paints
    // unreachable generator terrain as though it were a coastline. The
    // Wraithwood's square is the case: it wants 100 yd past WORLD_MAX_X.
    const zone = zoneById('wraithwood');
    const side = Math.max(
      (zone.xMax ?? STRIP_MAX_X) - (zone.xMin ?? STRIP_MIN_X),
      zone.zMax - zone.zMin,
    );
    const cx = ((zone.xMin ?? STRIP_MIN_X) + (zone.xMax ?? STRIP_MAX_X)) / 2;
    expect(cx + side / 2).toBeGreaterThan(WORLD_MAX_X); // unclamped, it overruns
    for (const z of ZONES) {
      const r = mapZoneRegion(z);
      expect(r.minX, `${z.id} west`).toBeGreaterThanOrEqual(WORLD_MIN_X);
      expect(r.maxX, `${z.id} east`).toBeLessThanOrEqual(WORLD_MAX_X);
      expect(r.minZ, `${z.id} south`).toBeGreaterThanOrEqual(WORLD_MIN_Z);
      expect(r.maxZ, `${z.id} north`).toBeLessThanOrEqual(WORLD_MAX_Z);
    }
  });
});
