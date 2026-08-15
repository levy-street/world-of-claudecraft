import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_X, WORLD_MIN_Z, ZONES } from '../src/sim/data';
import { BAKED_MAP_BG } from '../src/ui/map_bg_manifest.generated';
import {
  hashPaintedRows,
  MAP_PLATE_PX_PER_YD,
  mapCanvasHeight,
  mapPlateWidth,
  mapZoneRegion,
} from '../src/ui/map_terrain';

// Freshness guard for the baked world-map plates (scripts/build_map_backgrounds.mjs).
// The plates are pure functions of (world seed, zone bounds, the terrain painter),
// so ANY world-generation or painter change must re-bake them: this test
// recomputes the manifest's per-zone fingerprint (the first N painted rows)
// and reds until `npm run assets:mapbg` is rerun.
describe('baked map backgrounds', () => {
  it('covers every zone (plus the minimap world strip) and every plate file exists', () => {
    const baked = Object.keys(BAKED_MAP_BG.zones).sort();
    expect(baked).toEqual([...ZONES.map((z) => z.id), 'world_strip'].sort());
    for (const zoneId of baked) {
      expect(
        fs.existsSync(path.join(__dirname, '..', 'public', 'map_bg', `${zoneId}.webp`)),
        `public/map_bg/${zoneId}.webp`,
      ).toBe(true);
    }
  });

  it('matches the current world generation (re-bake with npm run assets:mapbg)', () => {
    for (const zone of ZONES) {
      const entry = BAKED_MAP_BG.zones[zone.id as keyof typeof BAKED_MAP_BG.zones];
      const region = mapZoneRegion(zone);
      // Width follows the region now (a plate covers the square the window
      // frames), so the detail inside every zone stays at one pixels-per-yard.
      const W = mapPlateWidth(region);
      expect(entry.w, `${zone.id} plate width`).toBe(W);
      expect(BAKED_MAP_BG.pxPerYd, 'baked detail').toBe(MAP_PLATE_PX_PER_YD);
      expect(entry.h, `${zone.id} plate height`).toBe(mapCanvasHeight(W, region));
      expect(
        hashPaintedRows(region, BAKED_MAP_BG.seed, W, BAKED_MAP_BG.hashRows),
        `${zone.id} plate fingerprint (world gen changed? re-bake the plates)`,
      ).toBe(entry.rowHash);
    }
  }, 60_000);
});
