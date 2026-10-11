import { describe, expect, it } from 'vitest';
import { TREASURE_SITES } from '../src/sim/content/treasure_maps';
import { ZONES } from '../src/sim/data';
import { treasureMapModel } from '../src/ui/hud/treasure/treasure_map_view';
import { mapZoneRegion } from '../src/ui/map_terrain';

describe('treasure map parchment projection', () => {
  it('places every X over the same world coordinate shown by its mirrored terrain plate', () => {
    for (const site of TREASURE_SITES) {
      const model = treasureMapModel({
        treasureMap: { rarity: 'legendary', siteId: site.id },
      });
      const zone = ZONES.find((entry) => entry.id === site.zoneId)!;
      const region = mapZoneRegion(zone);
      const spanX = region.maxX - region.minX;
      const spanZ = region.maxZ - region.minZ;

      expect(model, site.id).not.toBeNull();
      // The baked plate draws +X on the left. Its image-space X is therefore
      // measured from maxX, while Z is measured from maxZ at the top.
      const plateSiteX = (region.maxX - site.x) / spanX;
      const plateSiteY = (region.maxZ - site.z) / spanZ;
      expect(model!.markX, `${site.id} horizontal`).toBeCloseTo(
        model!.plateOffsetX + plateSiteX * model!.plateScaleX,
        10,
      );
      expect(model!.markY, `${site.id} vertical`).toBeCloseTo(
        model!.plateOffsetY + plateSiteY * model!.plateScaleY,
        10,
      );
      expect(model!.markX, `${site.id} X in crop`).toBeGreaterThanOrEqual(0);
      expect(model!.markX, `${site.id} X in crop`).toBeLessThanOrEqual(1);
      expect(model!.markY, `${site.id} Y in crop`).toBeGreaterThanOrEqual(0);
      expect(model!.markY, `${site.id} Y in crop`).toBeLessThanOrEqual(1);
    }
  });
});
