// Pure placement core for a PLACED mobile crafting station's world object
// (src/sim/professions/mobile_station_object.ts): maps the entity's
// templateId to the prop cluster the Three half (mobile_stations.ts) builds
// around it. The cluster is the TOWN station's own (STATION_PROP_CLUSTERS by
// the station type the craft resolves to), so a placed Laden Hearth reads
// exactly like the kitchens station in a town: the bonfire with its flame,
// a crate and a barrel. Per-item overrides make the capstone tools read as
// capstones: the Grand Cauldron is GRAND (the players' word), a taller
// cauldron with a fire under it, and the hearth's fire is a larger blaze.
//
// Three/DOM/i18n-free and deterministic (RENDER_PURE_CORES) so a plain
// Vitest can pin that every placeable item and every station craft yields
// a plan, and that the overrides land on the anchor prop only.

import {
  mobileStationCraftOf,
  mobileStationItemOf,
} from '../sim/professions/mobile_station_object';
import { stationTypeForCraft } from '../sim/professions/stations';
import { STATION_PROP_CLUSTERS, type StationPropKind } from '../sim/town_props';

/** One prop of a placed station, in the station's LOCAL frame (the entity's
 *  position is the origin; dx/dz are yards; rot is yaw; scale multiplies
 *  the prop's normalized town height). `fire` marks a prop that carries a
 *  flame cone (the kitchens campfire recipe), with its own scale. */
export interface MobileStationProp {
  kind: StationPropKind;
  dx: number;
  dz: number;
  rot: number;
  scale: number;
  fire: number;
}

/** Item-level overrides on the cluster's ANCHOR prop (its first entry, the
 *  thematic piece: campfire, cauldron, anvil). Keyed by the placing item id;
 *  a specialization placement or an item with no row keeps the town look. */
const ANCHOR_OVERRIDES: Readonly<Record<string, { scale: number; fire: number }>> = {
  // Grand: a cauldron near twice the town's, over a fire.
  grand_cauldron: { scale: 1.9, fire: 1.1 },
  // A proper blaze, not a cook's ember.
  laden_hearth: { scale: 1.25, fire: 1.35 },
};

/** The town kitchens campfire always burns; every other town anchor is
 *  fireless unless an override lights it. */
const TOWN_FIRE_SCALE = 1;

/** The prop plan for a placed station entity's templateId, or null when the
 *  templateId is not a mobile station (or names a craft no station serves). */
export function mobileStationPropPlan(
  templateId: string | null | undefined,
): MobileStationProp[] | null {
  const craft = mobileStationCraftOf(templateId);
  const type = craft === null ? undefined : stationTypeForCraft(craft);
  if (!type) return null;
  const itemId = mobileStationItemOf(templateId);
  const override = itemId === null ? undefined : ANCHOR_OVERRIDES[itemId];
  return STATION_PROP_CLUSTERS[type].map((prop, index) => {
    const anchor = index === 0;
    const townFire = prop.kind === 'campfire' ? TOWN_FIRE_SCALE : 0;
    return {
      kind: prop.kind,
      dx: prop.dx,
      dz: prop.dz,
      rot: prop.rot,
      scale: anchor && override ? override.scale : 1,
      fire: anchor && override ? Math.max(townFire, override.fire) : townFire,
    };
  });
}
