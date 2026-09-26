// The Wickharbor ferry wharf: the one built waterfront at the Wickharbor ferry berth
// (content/transport_ships.ts WICKHARBOR_BERTH), off the south end of the town's shore
// boardwalk (../gale_harbor.ts). Data-as-code; the colliders are built by
// ../wickharbor_wharf.ts, the walkable decks join the ferry pier surface query
// (../ferry_piers.ts), and render/wickharbor_wharf.ts draws the one Blender model
// (public/models/props/wickharbor_wharf.glb, scripts/assets/wickharbor_wharf/, which
// reads THESE numbers through its exported layout.json).
//
// It replaces the pieces that used to cross here: the old deepwater pier, the shore
// boardwalk's diagonal ramp that ran across the pier's root to reach it, the ferry's
// boarding stair and its landing stage (four decks of ../gale_harbor.ts), and the moored
// ship that lay jammed behind their crossing (content/galecrest.ts). The planks of all of
// them sat at the same height and passed through each other.
//
// The layout, in the wharf's own frame (yards: `along` the pier's heading, WICKHARBOR_WHARF_ROT,
// from its root at the foot of the bluff out to the berth; `across` it, positive to the
// north, the boardwalk's side); every level plank stands at ONE height, the ferry pier
// height every other berth uses, so the gangplank lands on it the same way:
//  - the pier: along 0.3 to 26.3, 5.6 wide, its root against the bluff (a stone wall under
//    it), the route marker on its north half where it always stood;
//  - the berth head: along 26.3 to 30.3, 11 wide, broadside to the ship, its end exactly
//    where the old landing stage ended (the gangplank's outer tread lies over it, the hull
//    stays clear of it);
//  - the arm: north off the pier at along 9.45 to 12.65, out to across 8.65;
//  - the flight: the arm's width, climbing south from the boardwalk's south end
//    (0.89 above the water) onto the arm; its first tread stands ON the boardwalk's end, a
//    step above its planks, so the two never share a plank plane.
// The level decks only ever share edges; tests/wickharbor_wharf.test.ts pins that no two
// floors of the harbor overlap at the same height, and walks the town walkway to the
// gangplank with the real movement kernel.
//
// Scale: the player model stands 2.6 yd to the crown on a 0.5 yd body radius and climbs
// 0.9 yd unaided (MAX_STEP_HEIGHT): the pier is 5.6 yd wide, the flight 3.2, the rails
// stand 1.2 yd (above a jump), and the dressing is sized generously beside the player.

import { GALE_DECK_FREEBOARD, GALE_DECK_LIFT, type GaleDeckDef } from '../gale_harbor';
import type { WyrmwatchHarborProp } from './wyrmwatch_harbor';

/** The wharf's root (the old deepwater pier's root), on the waterline: the frame origin. */
export const WICKHARBOR_WHARF_ORIGIN = { x: 452.54, z: 374.79 } as const;
/** The pier's heading (atan2(dx, dz)); the berth's ship lies across it at rot + PI/2. */
export const WICKHARBOR_WHARF_ROT = 1.3;
/** Every level plank of the wharf, yards above the waterline: the ferry pier height of the
 *  other three berths (ferry_piers.ts FERRY_PIER_DECK_ABOVE_WATER), which the gangplank's
 *  outer tread meets 0.22 above. */
export const WICKHARBOR_WHARF_ABOVE_WATER = 2.64;
/** The town's shore boardwalk (../gale_harbor.ts, freeboard-clamped on the beach), which the
 *  flight climbs from. */
export const WICKHARBOR_BOARDWALK_ABOVE_WATER = GALE_DECK_FREEBOARD + GALE_DECK_LIFT;
/** The flight's first tread stands this far over the boardwalk it rests on. */
export const WICKHARBOR_FLIGHT_FIRST_RISE = 0.25;

const DIR_X = Math.sin(WICKHARBOR_WHARF_ROT);
const DIR_Z = Math.cos(WICKHARBOR_WHARF_ROT);

/** A wharf-frame point (along, across) in world yards. */
export function wharfPoint(along: number, across: number): { x: number; z: number } {
  return {
    x: WICKHARBOR_WHARF_ORIGIN.x + DIR_X * along + DIR_Z * across,
    z: WICKHARBOR_WHARF_ORIGIN.z + DIR_Z * along - DIR_X * across,
  };
}

/** A world point in the wharf frame. */
export function wharfLocal(x: number, z: number): { along: number; across: number } {
  const dx = x - WICKHARBOR_WHARF_ORIGIN.x;
  const dz = z - WICKHARBOR_WHARF_ORIGIN.z;
  return { along: dx * DIR_X + dz * DIR_Z, across: dx * DIR_Z - dz * DIR_X };
}

/** A walkable wharf deck, named for the model and the tests. */
export interface WickharborWharfDeck extends GaleDeckDef {
  id: 'pier' | 'berthHead' | 'arm' | 'flight';
  /** Level decks draw as the one plank field; the flight as treads. */
  kind: 'level' | 'flight';
  /** The deck's rectangle in the wharf frame: along a0..a1, across c0..c1. */
  frame: { a0: number; a1: number; c0: number; c1: number };
}

const LEVEL = WICKHARBOR_WHARF_ABOVE_WATER;

/** A level deck over the wharf-frame rectangle along a0..a1, across c0..c1. */
function levelDeck(
  id: WickharborWharfDeck['id'],
  a0: number,
  a1: number,
  c0: number,
  c1: number,
): WickharborWharfDeck {
  const centre = wharfPoint((a0 + a1) / 2, (c0 + c1) / 2);
  return {
    id,
    kind: 'level',
    frame: { a0, a1, c0, c1 },
    ...centre,
    rot: WICKHARBOR_WHARF_ROT,
    hl: (a1 - a0) / 2,
    hw: (c1 - c0) / 2,
    ax: centre.x,
    az: centre.z,
    nearAboveWater: LEVEL,
    farAboveWater: LEVEL,
  };
}

/** The flight: along a0..a1 (its width), climbing from across c1 (on the boardwalk) to c0
 *  (the arm's edge). Its own heading runs toward -across, so its near end (along -hl, the
 *  galeDeckSurfaceAt convention) is the foot on the boardwalk. */
function flightDeck(a0: number, a1: number, c0: number, c1: number): WickharborWharfDeck {
  const centre = wharfPoint((a0 + a1) / 2, (c0 + c1) / 2);
  return {
    id: 'flight',
    kind: 'flight',
    frame: { a0, a1, c0, c1 },
    ...centre,
    rot: WICKHARBOR_WHARF_ROT - Math.PI / 2,
    hl: (c1 - c0) / 2,
    hw: (a1 - a0) / 2,
    ax: centre.x,
    az: centre.z,
    nearAboveWater: WICKHARBOR_BOARDWALK_ABOVE_WATER + WICKHARBOR_FLIGHT_FIRST_RISE,
    farAboveWater: LEVEL,
  };
}

/** The pier's half width (the route marker stands on its north half). */
export const WICKHARBOR_PIER_HALF_WIDTH = 2.8;
const PW = WICKHARBOR_PIER_HALF_WIDTH;
/** Where the pier gives onto the berth head, and where the head ends (the old landing
 *  stage's end: the gangplank's outer tread lies over it, the hull stays clear of it). */
export const WICKHARBOR_BERTH_HEAD_A0 = 26.3;
export const WICKHARBOR_BERTH_HEAD_A1 = 30.3;
export const WICKHARBOR_BERTH_HEAD_HALF_WIDTH = 5.5;
/** The arm and the flight share one width: along 9.45 to 12.65. */
export const WICKHARBOR_ARM_A0 = 9.45;
export const WICKHARBOR_ARM_A1 = 12.65;
/** The arm's north edge, where the flight's head meets it, and the flight's foot, just
 *  inside the boardwalk's south end (whose edge runs across 11.92 to 12.42 here). */
export const WICKHARBOR_ARM_C1 = 8.65;
export const WICKHARBOR_FLIGHT_FOOT_C = 12.55;

/** Every deck is level or a two-height ramp set above the water, never by the terrain, so
 *  a surface is exact whatever the ground under it. */
export const WICKHARBOR_WHARF_DECKS: readonly WickharborWharfDeck[] = [
  levelDeck('pier', 0.3, WICKHARBOR_BERTH_HEAD_A0, -PW, PW),
  levelDeck(
    'berthHead',
    WICKHARBOR_BERTH_HEAD_A0,
    WICKHARBOR_BERTH_HEAD_A1,
    -WICKHARBOR_BERTH_HEAD_HALF_WIDTH,
    WICKHARBOR_BERTH_HEAD_HALF_WIDTH,
  ),
  levelDeck('arm', WICKHARBOR_ARM_A0, WICKHARBOR_ARM_A1, PW, WICKHARBOR_ARM_C1),
  flightDeck(WICKHARBOR_ARM_A0, WICKHARBOR_ARM_A1, WICKHARBOR_ARM_C1, WICKHARBOR_FLIGHT_FOOT_C),
];

/** The rails, as wharf-frame polylines (along, across) 0.15 inside the edges they guard
 *  (the collider is 0.3 thick, so its outer face IS the edge). The pier's root is railed
 *  too (a notch of air stands between it and the bluff). Openings: the arm onto the pier,
 *  the flight onto the boardwalk, and the berth head's face, an open quay (bollards,
 *  no rail: the ship lies against it, and its hull swings to within a yard of it as it
 *  casts off). The south line runs from the flight's west foot down the arm, across the
 *  pier's root, along the pier's south side and round the head's south end;
 *  the north line from the head's north end, back along the pier's north side and
 *  up the arm's and the flight's east side. The points between the corners (the flight's
 *  head, the pier's middles) carry newel posts and lanterns in the model. */
export const WICKHARBOR_WHARF_RAIL_FRAME: readonly (readonly (readonly [number, number])[])[] = [
  [
    [9.6, 11.95],
    [9.6, 8.65],
    [9.6, 2.65],
    [0.45, 2.65],
    [0.45, -2.65],
    [13.45, -2.65],
    [26.45, -2.65],
    [26.45, -5.35],
    [29.95, -5.35],
  ],
  [
    [29.95, 5.35],
    [26.45, 5.35],
    [26.45, 2.65],
    [19.5, 2.65],
    [12.5, 2.65],
    [12.5, 8.65],
    [12.5, 12.35],
  ],
];

/** The rails as world polylines (what the colliders and the model use). */
export const WICKHARBOR_WHARF_RAILS: readonly (readonly (readonly [number, number])[])[] =
  WICKHARBOR_WHARF_RAIL_FRAME.map((rail) =>
    rail.map(([a, c]) => {
      const p = wharfPoint(a, c);
      return [p.x, p.z] as const;
    }),
  );

/** Props turn with the wharf: local +x runs along the pier (three.js yaw). */
const PROP_YAW = WICKHARBOR_WHARF_ROT - Math.PI / 2;

/** A wharf prop, placed in the wharf frame (the collider and the model read the world
 *  record below). */
interface WharfPropFrame {
  kind: WyrmwatchHarborProp['kind'];
  along: number;
  across: number;
  /** Extra yaw on top of the wharf's own. */
  turn?: number;
  r?: number;
  hw?: number;
  hd?: number;
  height: number;
  standable?: boolean;
}

const PROP_FRAME: readonly WharfPropFrame[] = [
  // lantern posts on the berth head's two outer corners, their lanterns hanging out over
  // the head's ends (the rails' newel lanterns light the pier and the arm, no collider)
  { kind: 'lanternPost', along: 29.0, across: -4.85, turn: -Math.PI / 2, r: 0.24, height: 4.4 },
  { kind: 'lanternPost', along: 29.0, across: 4.85, turn: Math.PI / 2, r: 0.24, height: 4.4 },
  // mooring bollards along the open berth face: a pair framing the gangplank, a pair
  // toward the corners (all short of the hull's swing as it casts off, along 30.26)
  { kind: 'bollard', along: 29.7, across: -2.25, r: 0.32, height: 1.0, standable: true },
  { kind: 'bollard', along: 29.7, across: 2.25, r: 0.32, height: 1.0, standable: true },
  { kind: 'bollard', along: 29.7, across: -4.2, r: 0.32, height: 1.0, standable: true },
  { kind: 'bollard', along: 29.7, across: 4.2, r: 0.32, height: 1.0, standable: true },
  // cargo on the berth head's corners, clear of the walk to the gangplank
  {
    kind: 'crateStack',
    along: 27.3,
    across: -4.2,
    hw: 0.7,
    hd: 0.95,
    height: 1.7,
    standable: true,
  },
  { kind: 'barrel', along: 28.75, across: -3.5, r: 0.5, height: 1.35, standable: true },
  { kind: 'barrel', along: 26.95, across: 4.45, r: 0.5, height: 1.35, standable: true },
  // ...and at the pier's root, in the corners either side of the walk
  {
    kind: 'crateStack',
    along: 1.55,
    across: -1.4,
    hw: 0.7,
    hd: 0.95,
    height: 1.7,
    standable: true,
  },
  { kind: 'barrel', along: 1.3, across: 1.75, r: 0.5, height: 1.35, standable: true },
];

export type WickharborWharfProp = WyrmwatchHarborProp;

export const WICKHARBOR_WHARF_PROPS: readonly WickharborWharfProp[] = PROP_FRAME.map((p) => {
  const at = wharfPoint(p.along, p.across);
  const out: WickharborWharfProp = {
    kind: p.kind,
    x: at.x,
    z: at.z,
    rot: PROP_YAW + (p.turn ?? 0),
    height: p.height,
    ...(p.r !== undefined ? { r: p.r } : { hw: p.hw ?? 0.5, hd: p.hd ?? 0.5 }),
    ...(p.standable ? { standable: true } : {}),
  };
  return out;
});

/** The ground the removed decks and ship were seated on keeps its calm pad (the terrain is
 *  byte-identical to before the wharf: terrain_calm_anchors.ts pads these as deck roots). */
export const WICKHARBOR_WHARF_CALM_ANCHORS: readonly (readonly [number, number])[] = [[451, 375]];
