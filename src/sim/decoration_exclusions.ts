import { getActiveWorldContent, isBuiltinWorldActive } from './data';
import { activeFenbridgeReachCovers } from './fenbridge_touchup';
import { mirefenTavernCovers } from './mirefen_tavern_floor';
import { mirefenTavernGroundsCovers } from './mirefen_tavern_grounds';
import { PAINTED_TOWNS } from './painted_towns';
import { distancePointToObb, type Obb2 } from './placed_town_kit';

/** Scatter keeps this far off a painted town building's reach (sim/painted_towns/):
 *  a trunk, a canopy or a rock beside it would stand through its eaves. */
export const PAINTED_TOWN_SCATTER_PAD = 3;
/** ...and a road lamp this far off it, so no post stands against a wall. */
export const PAINTED_TOWN_LAMP_PAD = 1;

/** Each painted town that stands buildings, with one circle round every reach, so
 *  a point far from every town costs one distance test per town. Derived once from
 *  the frozen layouts; read-only after. */
const PAINTED_TOWN_REACHES: readonly {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly reaches: readonly Obb2[];
}[] = PAINTED_TOWNS.filter((town) => town.buildings.length > 0).map((town) => {
  const { x, z } = town.hub.center;
  let radius = 0;
  for (const building of town.buildings) {
    const reach = building.reach;
    radius = Math.max(
      radius,
      Math.hypot(reach.center.x - x, reach.center.z - z) +
        Math.hypot(reach.halfWidth, reach.halfDepth),
    );
  }
  return { x, z, radius, reaches: town.buildings.map((building) => building.reach) };
});

/** Whether (x, z) lies within `pad` yards of a painted town building's reach. */
export function paintedTownReachCovers(x: number, z: number, pad: number): boolean {
  for (const town of PAINTED_TOWN_REACHES) {
    if (Math.hypot(x - town.x, z - town.z) > town.radius + pad) continue;
    const point = { x, z };
    for (const reach of town.reaches) {
      if (distancePointToObb(point, reach) < pad) return true;
    }
  }
  return false;
}

import { inParterrePlot } from './garden_parterre_plots';
import type { BiomeId } from './types';

/** Authored clearings remove only named scatter, never terrain anchors or heights.
 * Both collision and rendering consume this same deterministic placement gate. */
const EXCLUSIONS = [
  // Wisp maze lawn: this ordinary tree overlaps the southeast trial corner.
  { x: 470.83139702072367, z: 1049.3634334169328 },
  { x: 430.56771796988323, z: 1058.3339893245138 },
  { x: 469.0259377551265, z: 1059.0917784823105 },
  // Wyrmroad horde lane: edge trees and a rock obscure incoming private actors.
  { x: 390.4622943964787, z: 1802.078793170862 },
  { x: 390.9927746313624, z: 1815.7276418884285 },
  { x: 411.3127885675058, z: 1812.7735601491295 },
  { x: 2.456450840458274, z: 211.33819991815835 },
  // The North Watch firing lanes: one ordinary tree obscured the middle lane.
  { x: 442.06173, z: 1003.16146 },
  // Wyrmwatch battery: rocks overlapping the firing lanes and supply crates.
  { x: 376.78737124521285, z: 1828.1877607954666 },
  { x: 378.3173164781183, z: 1840.3080333708785 },
  { x: 385.38642308069393, z: 1848.2350369272754 },
  { x: 384.4008878977038, z: 1874.3803454781882 },
  { x: 390.96715987753123, z: 1828.9928906559944 },
  { x: 395.7734629823826, z: 1831.624793476425 },
  // The relocated battery's far lane corner: two trees inside the new field.
  { x: 376.2271715174429, z: 1816.5684037525207 },
  { x: 380.44544397946447, z: 1815.2093056854792 },
  // Last Keep battery: named scatter across the firing lanes.
  { x: 368.3865608260967, z: 1924.1916371914558 },
  { x: 367.4546361025423, z: 1945.0561844334006 },
  { x: 370.69166315346956, z: 1915.294014248997 },
  { x: 375.35517376009375, z: 1926.9491909733042 },
  { x: 373.5998047152534, z: 1939.6218792777508 },
  // The Sunken Bastion's Drowned Gate Tower: a rock inside the west tower's
  // drum, and a tree against the east tower whose crown filled its hoarding.
  { x: 53.64584932429716, z: 511.6929228263907 },
  { x: 37.96934285759926, z: 518.8265399737284 },
  // The Wildheart Basin's Jaguar Maw: the great palm that grew on the door
  // itself, in the walk-in lane under the fangs, and the palm in its forecourt
  // that stood between the road's end and the maw.
  { x: -237.19542878307402, z: 1093.0744675970636 },
  { x: -246.96982042654417, z: 1079.8916892490815 },
  // Eastbrook's painted buildings (the Tidehold rebuild, eastbrook_layout.ts):
  // the scatter that stood on the ground they took. The weekly vault's three,
  // one of them shared with the bank on its flank.
  { x: -83.872, z: -103.628 },
  { x: -72.872, z: -101.956 },
  { x: -62.186, z: -102.367 },
  // The bank's: a boulder under its front steps and two trees in its reach.
  { x: -52.853, z: -116.816 },
  { x: -58.645, z: -107.878 },
  { x: -46.382, z: -120.497 },
  // Under the quay cottage's west gable.
  { x: -55.705, z: -58.456 },
  // Inside the apothecary's shop.
  { x: -32.145, z: -128.66 },
  // Under the tavern's north eaves.
  { x: -35.756, z: -58.377 },
  { x: -30.413, z: -59.072 },
  // The chapel's seven, from its bell tower to its altar end.
  { x: 13.491, z: -126.8 },
  { x: 12.424, z: -119.697 },
  { x: 23.486, z: -127.802 },
  { x: 26.947, z: -110.899 },
  { x: 29.999, z: -136.908 },
  { x: 35.861, z: -127.765 },
  { x: 34.664, z: -111.777 },
  // Among the churchyard's graves.
  { x: 40.058, z: -95.043 },
  // Highwatch's painted buildings (highwatch_layout.ts) reach past the hub's
  // scatter-free ring: the pine and the rock in the chapel's nave, the oak
  // before its south gable, and the trees and rocks whose crowns or shoulders
  // reached the inn, the watch house and the smithy.
  { x: -18.039, z: 624.694 },
  { x: -10.043, z: 630.927 },
  { x: -10.244, z: 618.3 },
  { x: 22.009, z: 634.679 },
  { x: 20.702, z: 704.601 },
  { x: 33.195, z: 650.412 },
  { x: 31.928, z: 667.127 },
  // ...and, the buildings stood grand (larger, set further out), the tree by
  // the counting house's north-east corner, the rock and the tree on the inn's
  // south end and back wall, and the rock under the smithy's forge shelter.
  { x: -25.576, z: 668.259 },
  { x: 27.314, z: 648.031 },
  { x: 34.786, z: 673.567 },
  { x: 31.334, z: 708.04 },
  // Fenbridge's painted buildings stood grand (fenbridge_layout.ts): the tree
  // the apothecary's back corner now stands on, past the hub's scatter-free ring.
  { x: 20.594, z: 335.37 },
  // The Highwatch adventurers' guild (highwatch_layout.ts) at the old stable yard: every
  // tree and rock on its pad, its yard or under its eaves.
  { x: 101.428, z: 679.908 },
  { x: 103.913, z: 707.165 },
  { x: 113.21, z: 715.414 },
  { x: 127.18, z: 687.533 },
  { x: 129.304, z: 692.734 },
];

/** Scatter keeps this far off the Mirefen tavern's walls (a trunk, a canopy or a rock
 *  beside the building would stand through its eaves). */
const TAVERN_SCATTER_PAD = 3;
/** ...and this far off its grounds (the forecourt, the stable, the pieces outside). */
const TAVERN_GROUNDS_SCATTER_PAD = 1.5;

const parsedDecorationExclusions = new WeakMap<
  readonly string[],
  readonly { x: number; z: number }[]
>();

function activeWorldExclusionPoints(): readonly { x: number; z: number }[] {
  const keys = getActiveWorldContent().decorationExclusions;
  if (!keys || keys.length === 0) return [];
  const cached = parsedDecorationExclusions.get(keys);
  if (cached) return cached;
  const pts: { x: number; z: number }[] = [];
  for (const key of keys) {
    const parts = key.split(':');
    if (parts.length < 3) continue;
    const x = Number(parts[parts.length - 2]);
    const z = Number(parts[parts.length - 1]);
    if (Number.isFinite(x) && Number.isFinite(z)) pts.push({ x, z });
  }
  parsedDecorationExclusions.set(keys, pts);
  return pts;
}

export function isExcludedDecoration(x: number, z: number): boolean {
  if (
    (mirefenTavernCovers(x, z, TAVERN_SCATTER_PAD) ||
      mirefenTavernGroundsCovers(x, z, TAVERN_GROUNDS_SCATTER_PAD) ||
      activeFenbridgeReachCovers(x, z, PAINTED_TOWN_SCATTER_PAD)) &&
    isBuiltinWorldActive()
  ) {
    return true;
  }
  // the painted towns clear their whole ground, not named points (sim/painted_towns/)
  if (paintedTownReachCovers(x, z, PAINTED_TOWN_SCATTER_PAD)) return true;
  if (activeWorldExclusionPoints().some((point) => Math.hypot(x - point.x, z - point.z) < 0.25)) {
    return true;
  }
  return EXCLUSIONS.some((point) => Math.hypot(x - point.x, z - point.z) < 1.2);
}

/** The Evergarden curates its scatter: no wild pines (kind 'tree') anywhere on
 * its lawns, the realm keeps its oaks, topiary and specimen elders; and nothing
 * within six yards of a parterre bed. Judged at the decoration's FINAL position.
 * The renderer used to apply this alone, which left a trunk collider under every
 * pine nobody could see; the generator applies it now, so no host has them.
 * `biomeAt` is world.ts's `zoneBiomeAt`, injected to keep this leaf cycle-free. */
export function isCuratedGardenScatter(
  kind: 'tree' | 'tree2' | 'rock',
  x: number,
  z: number,
  biomeAt: (x: number, z: number) => BiomeId,
): boolean {
  return (kind === 'tree' && biomeAt(x, z) === 'garden') || inParterrePlot(x, z, 6);
}

/** Road lamps kept off authored clearings, matched to the exact planned site so no
 * other road-light placement is replanned. */
const STREETLAMP_EXCLUSIONS = [
  // The private wisp maze trial.
  { x: 460.6305996347541, z: 1028.5178347589988 },
  // The North Watch battery: a Wraithwood lamp inside the east firing lane.
  { x: 400.2, z: 1817 },
  // Fenbridge's painted buildings (fenbridge_layout.ts): the south road's last
  // lamp, on the inn's door step, and the north street's lamp under the
  // chapel's eaves by its bell tower.
  { x: 4.25, z: 297.4690161983138 },
  { x: -13.06878557216685, z: 310.4292763607378 },
  // ...and, the buildings stood grand, the marsh street's lamp the road plan
  // now stands under the apothecary's eaves, between its south wall and the street.
  { x: 12.944393496618803, z: 317.48530764241514 },
  // Highwatch's painted buildings (highwatch_layout.ts): the Fenbridge road's
  // lamp against the watch house's corner at the south gate.
  { x: 3.8, z: 628.0621005145729 },
];

export function isExcludedStreetlamp(x: number, z: number): boolean {
  if (isBuiltinWorldActive() && activeFenbridgeReachCovers(x, z, PAINTED_TOWN_LAMP_PAD)) {
    return true;
  }
  if (paintedTownReachCovers(x, z, PAINTED_TOWN_LAMP_PAD)) return true;
  const extraLamps = getActiveWorldContent().fenbridgeTouchup?.excludedStreetlamps;
  if (extraLamps?.some((point) => Math.hypot(x - point.x, z - point.z) < 0.05)) return true;
  return STREETLAMP_EXCLUSIONS.some((point) => Math.hypot(x - point.x, z - point.z) < 0.01);
}
