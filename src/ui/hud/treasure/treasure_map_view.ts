// Treasure map window, the pure half: what the parchment shows for the map the
// character has read (src/sim/treasure_vault.ts). A crop of the zone's baked
// terrain plate with an X on the dig site, never the player's position or any
// label, so the player recognises the ground themselves; plus the upgrade
// offer. DOM-free: the window (treasure_map_window.ts) only paints this model.

import {
  nextTreasureMapRarity,
  TREASURE_MAP_UPGRADE_INKS,
  TREASURE_SITES_BY_ID,
  type TreasureMapRarity,
} from '../../../sim/content/treasure_maps';
import { ZONES } from '../../../sim/data';
import type { IWorld } from '../../../world_api';
import { mapZoneRegion } from '../../map_terrain';

/** World yards across the parchment's crop. */
export const TREASURE_MAP_CROP_YARDS = 320;

/** What redrawing the map a rarity finer takes (null at the top rarity). */
export interface TreasureMapUpgradeOffer {
  next: TreasureMapRarity;
  inks: number;
  held: number;
}

export interface TreasureMapModel {
  rarity: TreasureMapRarity;
  zoneId: string;
  /** Baked plate url, its scale and offset relative to the crop box (fractions
   *  of the box side), and the X inside the box (0 to 1, from the top-left). */
  plateUrl: string;
  plateScaleX: number;
  plateScaleY: number;
  plateOffsetX: number;
  plateOffsetY: number;
  markX: number;
  markY: number;
  upgrade: TreasureMapUpgradeOffer | null;
}

/** A stable pseudo-random pair in [-1, 1] from the site id, so the X is never
 *  dead centre and the same map always draws the same crop. */
function siteJitter(siteId: string): { jx: number; jz: number } {
  let h = 2166136261;
  for (let i = 0; i < siteId.length; i++) {
    h ^= siteId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = ((h >>> 0) % 2001) / 1000 - 1;
  const b = (((h >>> 11) >>> 0) % 2001) / 1000 - 1;
  return { jx: a, jz: b };
}

export function treasureMapModel(
  world: Pick<IWorld, 'treasureMap'>,
  inksHeld = 0,
): TreasureMapModel | null {
  const map = world.treasureMap;
  const site = map ? TREASURE_SITES_BY_ID[map.siteId] : undefined;
  const zone = site ? ZONES.find((entry) => entry.id === site.zoneId) : undefined;
  if (!map || !site || !zone) return null;
  const region = mapZoneRegion(zone);
  const spanX = region.maxX - region.minX;
  const spanZ = region.maxZ - region.minZ;
  const crop = Math.min(TREASURE_MAP_CROP_YARDS, spanX, spanZ);
  const { jx, jz } = siteJitter(site.id);
  // Slide the crop so the X sits off-centre, then keep it inside the plate.
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const cropMinX = clamp(site.x - crop / 2 + jx * crop * 0.28, region.minX, region.maxX - crop);
  const cropMaxX = cropMinX + crop;
  const cropMaxZ = clamp(site.z + crop / 2 + jz * crop * 0.28, region.minZ + crop, region.maxZ);
  const next = nextTreasureMapRarity(map.rarity);
  return {
    rarity: map.rarity,
    zoneId: zone.id,
    plateUrl: `/map_bg/${zone.id}.webp`,
    plateScaleX: spanX / crop,
    plateScaleY: spanZ / crop,
    // The baked terrain plate is mirrored horizontally by design: +X is on
    // the left (map_terrain.ts). Measure both crop and mark from maxX so the
    // parchment X identifies the same world coordinate the sim validates.
    plateOffsetX: -(region.maxX - cropMaxX) / crop,
    plateOffsetY: -(region.maxZ - cropMaxZ) / crop,
    markX: (cropMaxX - site.x) / crop,
    markY: (cropMaxZ - site.z) / crop,
    upgrade: next
      ? { next, inks: TREASURE_MAP_UPGRADE_INKS[map.rarity], held: Math.max(0, inksHeld) }
      : null,
  };
}
