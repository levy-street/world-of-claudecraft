// Harbor route markers: the signpost at every passenger ferry berth
// (content/transport_ships.ts TRANSPORT_ROUTES). Data-as-code; the placement
// math (which way the arrow turns, the post collider) lives in
// ../harbor_route_markers.ts and render/harbor_route_markers.ts draws the one
// shared model (public/models/props/harbor_route_marker.glb, built in Blender
// by scripts/assets/harbor_route_marker/).
//
// Each marker stands on its ferry pier's planks at the pier's entrance, on a
// stilt line just inside one edge, so the walkway beside it stays clear and
// the arrow board (above head height) reaches out along the edge toward the
// ship. The destination is the OTHER berth of the same route, named with a
// label the game already localizes (a zone name, or a town's map label); the
// sign carries that name and nothing else, no timetable.
//
// Positions (yards), per pier deck (x, z, rot, hl, hw):
//  - Eastbrook: the ferry pier (-107, -54, -PI/2, 10, 2.2) off the quay; the
//    marker stands 3 yd out from the quay on the south stilt line.
//  - Moonrest (the Nightbloom): the pier (-501, 1506, -PI/2, 11, 2.2) off the
//    sunset shore; 1 yd out from the shore root on the south stilt line.
//  - Wickharbor (the Galecrest): the ferry wharf's pier (content/wickharbor_wharf.ts:
//    rot 1.3, 5.6 wide), on its north half short of where the arm from the town's
//    boardwalk joins it (it stood here on the old deepwater pier too).
//  - Wyrmwatch (the Drakelands): the pier (498.5, 1899.2, PI/2, 8.5, 2.2) at
//    the foot of the bluff stair; 2 yd past the stair's foot, south stilt line.

/** Where a marker's route goes, as a label the client already localizes. */
export type HarborRouteMarkerDestination =
  | { kind: 'zone'; zone: string }
  | { kind: 'poi'; mark: string };

export interface HarborRouteMarkerDef {
  /** The route (TransportRouteDef.id) and the berth (TransportBerthDef.id)
   *  this marker stands at. */
  route: string;
  berth: string;
  /** The foot of the post, world yards. */
  x: number;
  z: number;
  /** The route's other end: what the board reads. */
  destination: HarborRouteMarkerDestination;
}

export const HARBOR_ROUTE_MARKERS: readonly HarborRouteMarkerDef[] = [
  {
    route: 'eastbrookNightbloom',
    berth: 'eastbrook',
    x: -100.2,
    z: -55.75,
    destination: { kind: 'zone', zone: 'nightbloom' },
  },
  {
    route: 'eastbrookNightbloom',
    berth: 'nightbloom',
    x: -491,
    z: 1504.25,
    destination: { kind: 'poi', mark: 'poi:eastbrook_vale:eastbrook' },
  },
  {
    route: 'wickharborDrakelands',
    berth: 'wickharbor',
    x: 460.29,
    z: 375.28,
    destination: { kind: 'zone', zone: 'drakelands' },
  },
  {
    route: 'wickharborDrakelands',
    berth: 'drakelands',
    x: 493.2,
    z: 1897.45,
    destination: { kind: 'poi', mark: 'poi:galecrest:wickharbor' },
  },
];
