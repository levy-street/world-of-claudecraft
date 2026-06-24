import { describe, expect, it } from 'vitest';
import { paintTerrainRows, mapCanvasHeight, type MapRegion } from '../src/ui/map_terrain';
import { ZONES, WORLD_MIN_X, WORLD_MAX_X, zoneAt } from '../src/sim/data';
import { zoneBiomeAt } from '../src/sim/world';

const SEED = 20061;

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
function renderChunked(W: number, region: MapRegion, seed: number, rowsPerSlice: number): Uint8ClampedArray {
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
    const b = renderFull(W, zoneRegion(ZONES[ZONES.length - 1].id), SEED);
    expect(a).not.toEqual(b);
  });

  // The painter swapped the inline `zoneAt(z).biome` for `zoneBiomeAt(z)`; pin
  // them as equivalent across the world's z-range so the swap can't silently
  // drift the map colours.
  it('zoneBiomeAt(z) matches zoneAt(z).biome across the world', () => {
    const minZ = ZONES[0].zMin;
    const maxZ = ZONES[ZONES.length - 1].zMax;
    for (let z = minZ; z < maxZ; z += 0.5) {
      expect(zoneBiomeAt(z)).toBe(zoneAt(z).biome);
    }
    // and just past the far edge, where both clamp to the last zone
    expect(zoneBiomeAt(maxZ + 50)).toBe(zoneAt(maxZ + 50).biome);
  });
});
