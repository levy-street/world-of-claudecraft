// Per-(seed, zone) world-map terrain background: the ~200ms terrain bake the
// world map blits behind its live markers. A background depends only on (seed,
// zone bounds), both fixed for the session, so it is immutable and cached.
//
// Baking it on the map-open click is the "lagazo": ~230k terrainHeight samples
// at MAP_BG_RES wide. So it is PRECOMPUTED behind the loading screen, at boot for
// every zone and again on a zone transition, never streamed during play. The
// pixel math (paintTerrainRows) stays in the pure, unit-tested `map_terrain`
// module; this module owns the cache, the zone region, and the row-sliced async
// bake the loading screen drives. The DOM canvas wrapper is the only non-pure part
// (getMapBackgroundCanvas), kept thin so the bake + cache stay Node-testable.
import type { ZoneDef } from '../sim/data';
import { WORLD_MAX_X, WORLD_MIN_X } from '../sim/data';
import { type MapRegion, mapCanvasHeight, paintTerrainRows } from './map_terrain';

// World-map background resolution (px wide); height follows the zone aspect.
export const MAP_BG_RES = 480;
// Whole rows per async slice. Painting by whole rows is byte-identical to a
// single pass (the only per-row state, the hillshade left-neighbour, resets each
// row), so a sliced bake equals the synchronous one. ~24 rows is a few ms.
const ROWS_PER_SLICE = 24;

// The full-zone band the world map draws: x spans the world, z is the zone band.
export function mapZoneRegion(zone: ZoneDef): MapRegion {
  return { minX: WORLD_MIN_X, maxX: WORLD_MAX_X, minZ: zone.zMin, maxZ: zone.zMax };
}

// A baked background as a flat RGBA bitmap (the shape an ImageData exposes).
export interface MapBitmap {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

// Keyed on (seed, zoneId): seed is fixed per session, but keying on it keeps the
// cache correct if a different-seed world is ever built in the same page.
const bitmaps = new Map<string, MapBitmap>();
const canvases = new Map<string, HTMLCanvasElement>();
const cacheKey = (seed: number, zoneId: string): string => `${seed}:${zoneId}`;

// True once the zone's background is baked (bitmap not yet drawn to a canvas, OR
// already promoted to a canvas), so a transition/open knows it is a no-op.
export function hasMapBackground(seed: number, zoneId: string): boolean {
  const k = cacheKey(seed, zoneId);
  return bitmaps.has(k) || canvases.has(k);
}

// Synchronous bake-on-miss of one zone's bitmap (pure: no DOM). The fallback when
// the map opens before the preload produced it; normally a cache hit.
export function bakeZoneBitmap(seed: number, zone: ZoneDef): MapBitmap {
  const cached = bitmaps.get(cacheKey(seed, zone.id));
  if (cached) return cached;
  const region = mapZoneRegion(zone);
  const w = MAP_BG_RES;
  const h = mapCanvasHeight(w, region);
  const data = new Uint8ClampedArray(w * h * 4);
  paintTerrainRows(data, w, h, region, seed, 0, h);
  const bmp: MapBitmap = { data, w, h };
  bitmaps.set(cacheKey(seed, zone.id), bmp);
  return bmp;
}

// Async, row-sliced bake that yields to the event loop between slices so the
// loading screen can paint its progress bar between chunks. Resolves once the
// zone bitmap is cached; a cache hit resolves immediately. `onRows(done, total)`
// reports painted-row progress (the denominator is the canvas height).
export async function prebakeZone(
  seed: number,
  zone: ZoneDef,
  onRows?: (done: number, total: number) => void,
): Promise<void> {
  if (bitmaps.has(cacheKey(seed, zone.id))) {
    onRows?.(1, 1);
    return;
  }
  const region = mapZoneRegion(zone);
  const w = MAP_BG_RES;
  const h = mapCanvasHeight(w, region);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row += ROWS_PER_SLICE) {
    const end = Math.min(h, row + ROWS_PER_SLICE);
    paintTerrainRows(data, w, h, region, seed, row, end);
    onRows?.(end, h);
    if (end < h) await yieldToLoop();
  }
  bitmaps.set(cacheKey(seed, zone.id), { data, w, h });
}

function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// DOM consumer: a canvas built once from the cached bitmap (baking the bitmap on
// miss), memoized so repeated map opens reuse the same canvas. Not Node-testable
// (needs a real 2D context); the bake + cache logic above is what tests cover.
export function getMapBackgroundCanvas(seed: number, zone: ZoneDef): HTMLCanvasElement {
  const key = cacheKey(seed, zone.id);
  const cachedCanvas = canvases.get(key);
  if (cachedCanvas) return cachedCanvas;
  const bmp = bakeZoneBitmap(seed, zone);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.w;
  canvas.height = bmp.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for the world-map background');
  const img = ctx.createImageData(bmp.w, bmp.h);
  img.data.set(bmp.data);
  ctx.putImageData(img, 0, 0);
  canvases.set(key, canvas);
  // The canvas is the live copy the map blits; drop the now-redundant bitmap so a
  // session holds one copy per zone, not two (hasMapBackground still sees it).
  bitmaps.delete(key);
  return canvas;
}
