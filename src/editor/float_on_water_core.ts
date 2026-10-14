// Assets that ride ON the water. A fresh Studio placement dropped over water
// is seated detached on the surface instead of on the seabed the plain
// terrain seat would sink it to. The caller reads the surface with the sim's
// own `waterLevelAt` (declared lakes, border waters, the generator's open
// sea), so a ship floats exactly where a swimmer swims; on dry ground
// (-Infinity) the normal seat applies.
//
// Heights are model yards over the asset's lowest point, at scale 1:
//  - the Tidehold galleon (scripts/assets/deepglass/dg_galleon.py) floats
//    with its keel 1.72 under the surface, which puts its main deck and
//    boarding landings (9.8) 8.08 over it: level with a Warden pier's planks
//    (6.08 on the -2 harbour). A galleon placed larger would ride its deck
//    high over the pier, so it sinks further until the deck meets the pier
//    level; a smaller one keeps its waterline.
//  - its gangplank lies level at that same pier height at any scale.

/** A Warden pier's planks over the harbour water (6.08 on the -2 sea). */
export const PIER_FREEBOARD = 8.08;

/** How an asset floats: the waterline it rides at and the boarding deck that
 *  should meet a pier (null: none). */
interface FloatSeat {
  waterline: number | null;
  deck: number | null;
}

export const FLOATERS: Readonly<Record<string, FloatSeat>> = {
  'deepglass/wharf_galleon': { waterline: 1.72, deck: 9.8 },
  'deepglass/wharf_gangplank': { waterline: null, deck: 0 },
};

/** The detached groundY for a floating seat, or null when the asset does not
 *  float or there is no water surface where it was dropped. */
export function floatingGroundY(assetId: string, scale: number, water: number): number | null {
  const f = FLOATERS[assetId];
  if (f === undefined || !Number.isFinite(water)) return null;
  const s = scale > 0 ? scale : 1;
  const afloat = f.waterline === null ? Number.POSITIVE_INFINITY : water - f.waterline * s;
  const atPier = f.deck === null ? Number.POSITIVE_INFINITY : water + PIER_FREEBOARD - f.deck * s;
  return Math.min(afloat, atPier);
}
