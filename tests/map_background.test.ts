import { describe, expect, it } from 'vitest';
import { ZONES } from '../src/sim/data';
import {
  bakeZoneBitmap,
  hasMapBackground,
  MAP_BG_RES,
  mapZoneRegion,
  prebakeZone,
} from '../src/ui/map_background';
import { mapCanvasHeight, paintTerrainRows } from '../src/ui/map_terrain';

// A real zone band is the full world z-span, so its background is MAP_BG_RES square
// (~230k terrainHeight samples, ~200ms). That is faithful but too slow to bake
// several times per test under full-suite CPU contention (it times out). The bake +
// cache + slice logic under test is band-size independent, so use a SYNTHETIC zone
// with a thin z-band: H stays > ROWS_PER_SLICE (so the async path still spans
// multiple slices) while each bake is a few ms. The pixel math is unchanged - it
// samples terrainHeight by (x,z,seed), not the zone object - so byte-equality holds.
const smallZone = (id: string) => ({ ...ZONES[0], id, zMin: 0, zMax: 45 });

function singlePass(seed: number, zone: ReturnType<typeof smallZone>): Uint8ClampedArray {
  const region = mapZoneRegion(zone);
  const h = mapCanvasHeight(MAP_BG_RES, region);
  const data = new Uint8ClampedArray(MAP_BG_RES * h * 4);
  paintTerrainRows(data, MAP_BG_RES, h, region, seed, 0, h);
  return data;
}

describe('mapZoneRegion', () => {
  it('spans the full world in x and the zone band in z', () => {
    const zone = ZONES[0];
    const region = mapZoneRegion(zone);
    expect(region.minZ).toBe(zone.zMin);
    expect(region.maxZ).toBe(zone.zMax);
    expect(region.maxX).toBeGreaterThan(region.minX);
  });

  it('keeps the thin synthetic band tall enough to span multiple async slices', () => {
    // guards the test premise: a one-slice bake would not exercise prebakeZone's loop
    const h = mapCanvasHeight(MAP_BG_RES, mapZoneRegion(smallZone('z')));
    expect(h).toBeGreaterThan(24);
  });
});

describe('bakeZoneBitmap', () => {
  it('matches a single-pass terrain render and caches the result', () => {
    const seed = 50001;
    const zone = smallZone('bake_a');
    expect(hasMapBackground(seed, zone.id)).toBe(false);
    const bmp = bakeZoneBitmap(seed, zone);
    expect(bmp.w).toBe(MAP_BG_RES);
    expect(bmp.h).toBe(mapCanvasHeight(MAP_BG_RES, mapZoneRegion(zone)));
    expect(bmp.data).toEqual(singlePass(seed, zone));
    // cached: same reference back, and the presence flag flips
    expect(hasMapBackground(seed, zone.id)).toBe(true);
    expect(bakeZoneBitmap(seed, zone)).toBe(bmp);
  });

  it('keys the cache on seed (a different seed is a fresh bake)', () => {
    const zone = smallZone('bake_seedkey');
    const a = bakeZoneBitmap(50002, zone);
    const b = bakeZoneBitmap(50003, zone);
    expect(a).not.toBe(b);
    expect(a.data).not.toEqual(b.data);
  });
});

describe('prebakeZone', () => {
  it('produces the byte-identical bitmap to a synchronous bake and caches it', async () => {
    const seed = 50010;
    const zone = smallZone('pre_a');
    let lastDone = 0;
    let lastTotal = 0;
    await prebakeZone(seed, zone, (done, total) => {
      lastDone = done;
      lastTotal = total;
    });
    expect(hasMapBackground(seed, zone.id)).toBe(true);
    // progress reached the full canvas height
    expect(lastTotal).toBe(mapCanvasHeight(MAP_BG_RES, mapZoneRegion(zone)));
    expect(lastDone).toBe(lastTotal);
    // the sliced async bake equals the single pass
    expect(bakeZoneBitmap(seed, zone).data).toEqual(singlePass(seed, zone));
  });

  it('reports monotonically increasing row progress across multiple slices', async () => {
    const seed = 50011;
    const dones: number[] = [];
    await prebakeZone(seed, smallZone('pre_mono'), (done) => dones.push(done));
    expect(dones.length).toBeGreaterThan(1);
    for (let i = 1; i < dones.length; i++) expect(dones[i]).toBeGreaterThan(dones[i - 1]);
  });

  it('is a no-op on a cache hit (reports complete immediately)', async () => {
    const seed = 50012;
    const zone = smallZone('pre_hit');
    bakeZoneBitmap(seed, zone); // prime the cache
    let calls = 0;
    let done = 0;
    let total = 0;
    await prebakeZone(seed, zone, (d, t) => {
      calls++;
      done = d;
      total = t;
    });
    expect(calls).toBe(1);
    expect(done).toBe(total); // full
  });
});
