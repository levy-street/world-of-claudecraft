// Pure subzone-detection helper for the HUD's classic "subzone text" banner.
// No DOM — kept separate from hud.ts so it can be unit-tested (cf. xp_bar.ts).
import type { WorldContent, ZoneDef } from '../sim/types';

// Enter a subzone within this many yards of its landmark; keep it until you
// move SUBZONE_DEADBAND yards further out, so straddling the edge of a POI
// doesn't re-fire the banner every step (mirrors the zone-banner dead-band).
export const SUBZONE_RADIUS = 32;
export const SUBZONE_DEADBAND = 8;

// The named landmark the player is standing in, or null in open wilderness.
// `current` is the subzone the HUD is already showing; passing it back in
// applies the hysteresis above so a player loitering on the boundary keeps the
// same subzone instead of flickering between it and "nowhere".
export function nearestSubzone(
  x: number,
  z: number,
  pois: ZoneDef['pois'],
  current: string | null,
): string | null {
  let nearest: string | null = null;
  let bestD2 = SUBZONE_RADIUS * SUBZONE_RADIUS;
  for (const poi of pois) {
    const dx = x - poi.x;
    const dz = z - poi.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      nearest = poi.label;
    }
  }
  // Outside every enter-radius but still close to the one we're already in?
  // Stick with it until we clear the wider dead-band radius.
  if (nearest === null && current !== null) {
    const cur = pois.find((q) => q.label === current);
    if (cur) {
      const dx = x - cur.x;
      const dz = z - cur.z;
      const r = SUBZONE_RADIUS + SUBZONE_DEADBAND;
      if (dx * dx + dz * dz < r * r) return current;
    }
  }
  return nearest;
}

// ---------------------------------------------------------------------------
// Authored named areas (MapDoc `locations`, projected onto WorldContent).
//
// A zone POI is a POINT with a fixed 32-yard enter radius; an authored location
// is a RECTANGLE the maker dragged around a landmark with the Zone tool. A city
// map is built almost entirely out of the latter (Tidehold ships thirty of
// them, from a tavern's footprint to the whole causeway), and squashing those
// rects to a point would both miss the long thin ones (a ropewalk, a bridge
// span) and bleed 32 yards past the small ones. So they keep their extent and
// are tested by containment, not distance.
export type NamedArea = NonNullable<WorldContent['locations']>[number];

// Leave a named area only once you are this far OUTSIDE its rect, the rect
// equivalent of SUBZONE_DEADBAND: walking the boundary must not re-fire the
// banner every step.
export const AREA_EXIT_PAD = 6;

/** The authored area the player is standing in, or null outside every one.
 *  Nested rects resolve SMALLEST-first, so standing in Baldemar's Square
 *  (inside the Glass Market, inside the city) names the square: the tighter
 *  the maker drew the rect, the more specific the place they meant. */
export function namedAreaAt(
  x: number,
  z: number,
  areas: readonly NamedArea[],
  current: string | null,
): string | null {
  let nearest: string | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const area of areas) {
    if (x < area.minX || x > area.maxX || z < area.minZ || z > area.maxZ) continue;
    const size = (area.maxX - area.minX) * (area.maxZ - area.minZ);
    if (size < bestArea) {
      bestArea = size;
      nearest = area.name;
    }
  }
  if (nearest !== null) return nearest;
  // Outside every rect but still hugging the one we're already showing? Hold
  // it until we clear the pad (same hysteresis nearestSubzone applies to POIs).
  if (current !== null) {
    const cur = areas.find((a) => a.name === current);
    if (
      cur &&
      x >= cur.minX - AREA_EXIT_PAD &&
      x <= cur.maxX + AREA_EXIT_PAD &&
      z >= cur.minZ - AREA_EXIT_PAD &&
      z <= cur.maxZ + AREA_EXIT_PAD
    ) {
      return current;
    }
  }
  return null;
}

/** What the subzone banner should read, across BOTH landmark kinds.
 *  `poiIndex` is the zone-poi position the caller localizes through
 *  zonePoiLabel, or -1 for an authored area, whose name is authored text with
 *  no catalog key (the maker typed it; there is nothing to translate it to). */
export interface SubzoneHit {
  label: string;
  poiIndex: number;
}

/** Authored rects win over shipped POI points where both cover the player: a
 *  maker who drew a rect over the plaza meant that name for that ground, and
 *  the zone's own POI list is the coarse fallback the shipped world uses. */
export function currentSubzone(
  x: number,
  z: number,
  pois: ZoneDef['pois'],
  areas: readonly NamedArea[],
  current: string | null,
): SubzoneHit | null {
  const area = namedAreaAt(x, z, areas, current);
  if (area !== null) return { label: area, poiIndex: -1 };
  const poi = nearestSubzone(x, z, pois, current);
  if (poi === null) return null;
  return { label: poi, poiIndex: pois.findIndex((q) => q.label === poi) };
}
