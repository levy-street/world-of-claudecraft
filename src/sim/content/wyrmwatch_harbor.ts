// The Wyrmwatch cliff harbor: the built waterfront at the Drakelands ferry berth
// (content/transport_ships.ts DRAKELANDS_BERTH, the Wyrmwatch ferry pier in
// ../ferry_piers.ts). Data-as-code; the colliders are built by
// ../wyrmwatch_harbor.ts, the walkable decks join the ferry pier surface query
// (../ferry_piers.ts), and render/wyrmwatch_harbor.ts draws the one Blender model
// (public/models/props/wyrmwatch_harbor.glb, scripts/assets/wyrmwatch_harbor/,
// which reads THESE numbers through its exported layout.json).
//
// The layout, world yards (x east, z south of the berth's frame; heights are
// yards above the waterline, the ferry pier's own convention):
//  - the pier (unchanged, ../ferry_piers.ts) runs out east at z 1899.2 from the
//    foot of the bluff (x 490) to the berth, its planks 2.64 above the water;
//  - the north yard: a quay beside the pier's root, west of the route marker,
//    the forecourt of the Harbormaster's House (content/wyrmwatch_harbor_house.ts),
//    whose floor is the `houseFloor` deck here and whose door faces the pier;
//  - the south quay: off the pier's south side, along the foot of the cliff;
//  - the switchback: the first flight climbs south from the quay over the water,
//    turns on a wide landing, and the second climbs back north against the cliff
//    face to the top landing, a balcony at the cliff edge with the harbor gate;
//  - the path: flagstones from the gate west across the plateau toward the
//    Wyrmwatch hub, stopping short of its ground (the hub itself is not ours).
//
// Surveyed against the terrain (every deck clears it except where a landing meets
// the crest by design), the two rocks at the old stair head (476.6, 1896.2) and
// (479.4, 1897.3), the rocks near the path, the route marker's walkway, and the
// ferry's approach and departure lanes; tests/wyrmwatch_harbor.test.ts pins all
// of it and walks the whole climb with the real movement kernel.
//
// Scale: the player model stands 2.6 yd to the crown on a 0.5 yd body radius and
// climbs 0.9 yd unaided (MAX_STEP_HEIGHT), so flights are 3.2 yd wide, the rails
// stand 1.2 yd high (above a jump), the gate clears 5 yd, and the house door 3.8 yd;
// the dressing is sized generously so the player reads small beside it.

import type { GaleDeckDef } from '../gale_harbor';
import { HARBOR_HOUSE, HARBOR_HOUSE_FLOOR_ABOVE_WATER } from './wyrmwatch_harbor_house';

/** The quays stand at the Wyrmwatch ferry pier's plank height (FERRY_PIER_DECK_ABOVE_WATER). */
export const WYRMWATCH_QUAY_ABOVE_WATER = 2.64;
/** The switchback's turning landing. */
export const WYRMWATCH_LANDING_ABOVE_WATER = 5.6;
/** The top landing at the cliff edge (the crest there stands 8.1 to 8.7). */
export const WYRMWATCH_TOP_ABOVE_WATER = 8.5;
/** Rail height over the planks it guards (the ferry's rail: above a jump). */
export const WYRMWATCH_RAIL_HEIGHT = 1.2;
/** Sight passes over the open balustrade above its bottom rail. */
export const WYRMWATCH_RAIL_SIGHT = 0.3;
/** Rail collider thickness: the rail's line stands this far inside the edge. */
export const WYRMWATCH_RAIL_THICKNESS = 0.3;

/** The model's origin (the GLB root is placed here, on the waterline). */
export const WYRMWATCH_HARBOR_ORIGIN = { x: 490, z: 1905 } as const;

const QUAY = WYRMWATCH_QUAY_ABOVE_WATER;
const LANDING = WYRMWATCH_LANDING_ABOVE_WATER;
const TOP = WYRMWATCH_TOP_ABOVE_WATER;

/** A walkable harbor deck, named for the model and the tests. */
export interface WyrmwatchHarborDeck extends GaleDeckDef {
  id:
    | 'northYard'
    | 'southQuay'
    | 'flightOne'
    | 'turnLanding'
    | 'flightTwo'
    | 'topLanding'
    | 'houseFloor';
  /** Stair flights draw as treads; level decks as planks; the house floor is drawn by the
   *  house (its boards run under the walls). */
  kind: 'quay' | 'flight' | 'landing' | 'floor';
}

/** Every deck is level or a two-height ramp set above the water, never by the
 *  terrain, so a surface is exact whatever the ground under it. Rot 0 runs a
 *  deck's length along +z, rot PI along -z (galeDeckSurfaceAt's near end is
 *  along -hl). */
export const WYRMWATCH_HARBOR_DECKS: readonly WyrmwatchHarborDeck[] = [
  // the north yard: x 487.5..492.2, z 1890.1..1897.2 (its south edge laps
  // 0.2 onto the pier's north edge at the pier's root, west of the marker; its
  // north edge laps 0.3 under the house's south wall, so the doorway has no seam)
  {
    id: 'northYard',
    kind: 'quay',
    x: 489.85,
    z: 1893.65,
    rot: 0,
    hl: 3.55,
    hw: 2.35,
    ax: 489.85,
    az: 1893.65,
    nearAboveWater: QUAY,
    farAboveWater: QUAY,
  },
  // the south quay: x 493.1..498.5, z 1901.2..1909.5 (laps 0.2 onto the pier)
  {
    id: 'southQuay',
    kind: 'quay',
    x: 495.8,
    z: 1905.35,
    rot: 0,
    hl: 4.15,
    hw: 2.7,
    ax: 495.8,
    az: 1905.35,
    nearAboveWater: QUAY,
    farAboveWater: QUAY,
  },
  // flight one: x 494.2..497.4, climbing south z 1909.3 -> 1917.5
  {
    id: 'flightOne',
    kind: 'flight',
    x: 495.8,
    z: 1913.4,
    rot: 0,
    hl: 4.1,
    hw: 1.6,
    ax: 495.8,
    az: 1909.3,
    nearAboveWater: QUAY,
    farAboveWater: LANDING,
  },
  // the turning landing: x 489.8..497.4, z 1917.3..1920.9
  {
    id: 'turnLanding',
    kind: 'landing',
    x: 493.6,
    z: 1919.1,
    rot: 0,
    hl: 1.8,
    hw: 3.8,
    ax: 493.6,
    az: 1919.1,
    nearAboveWater: LANDING,
    farAboveWater: LANDING,
  },
  // flight two: x 489.8..493.0, climbing north z 1917.5 -> 1910.3
  {
    id: 'flightTwo',
    kind: 'flight',
    x: 491.4,
    z: 1913.9,
    rot: Math.PI,
    hl: 3.6,
    hw: 1.6,
    ax: 491.4,
    az: 1917.5,
    nearAboveWater: LANDING,
    farAboveWater: TOP,
  },
  // the top landing: x 488.3..492.7, z 1906.3..1910.5, its west edge on the crest
  {
    id: 'topLanding',
    kind: 'landing',
    x: 490.5,
    z: 1908.4,
    rot: 0,
    hl: 2.1,
    hw: 2.2,
    ax: 490.5,
    az: 1908.4,
    nearAboveWater: TOP,
    farAboveWater: TOP,
  },
  // the Harbormaster's House floor: its whole footprint, x 487.9..498.3, z 1880.8..1890.4,
  // over the water north of the yard (the house's walls stand on its edges)
  {
    id: 'houseFloor',
    kind: 'floor',
    x: HARBOR_HOUSE.x,
    z: HARBOR_HOUSE.z,
    rot: 0,
    hl: HARBOR_HOUSE.hd,
    hw: HARBOR_HOUSE.hw,
    ax: HARBOR_HOUSE.x,
    az: HARBOR_HOUSE.z,
    nearAboveWater: HARBOR_HOUSE_FLOOR_ABOVE_WATER,
    farAboveWater: HARBOR_HOUSE_FLOOR_ABOVE_WATER,
  },
];

/**
 * The rails, as polylines of world (x, z) points standing 0.15 inside the deck
 * edges they guard (the collider is 0.3 thick, so its outer face IS the edge).
 * Each rail follows the planks under it. Openings are where the walkway runs on:
 * the pier into the north yard and the south quay, each flight onto its landing,
 * and the top landing through the gate onto the cliff top.
 */
export const WYRMWATCH_HARBOR_RAILS: readonly (readonly (readonly [number, number])[])[] = [
  // the inner line: from the house's south-west corner down the north yard's
  // landward side, across the pier's root against the cliff, down the south quay's cliff side, up flight
  // one's inner side, across the gap between the flights, up flight two's inner
  // side and round the top landing's seaward edges to the north gate post
  [
    [487.65, 1890.0],
    [487.65, 1897.05],
    [490.15, 1897.05],
    [490.15, 1901.25],
    [493.25, 1901.25],
    [493.25, 1909.35],
    [494.35, 1909.35],
    [494.35, 1917.45],
    [492.85, 1917.45],
    [492.85, 1910.6],
    [492.55, 1910.6],
    [492.55, 1906.45],
    [489.3, 1906.45],
  ],
  // the outer line: the south quay's end beside flight one, flight one's sea
  // side, round the turning landing, flight two's cliff side, and the top
  // landing's south edge to the south gate post
  [
    [498.35, 1909.35],
    [497.25, 1909.35],
    [497.25, 1920.75],
    [489.95, 1920.75],
    [489.95, 1910.35],
    [489.3, 1910.35],
  ],
];

/** A solid thing standing in the harbor: what the sim collides with and the
 *  model draws there. Heights are over the ground (or planks) under its centre. */
export type WyrmwatchHarborPropKind =
  | 'gatePost'
  | 'lanternPost'
  | 'bollard'
  | 'crateStack'
  | 'barrel'
  /** A structural timber standing on the planks (a crane's mast, a cargo shelter's corner
   *  post): full height, never stood on. */
  | 'timberPost';

export interface WyrmwatchHarborProp {
  kind: WyrmwatchHarborPropKind;
  x: number;
  z: number;
  /** Yaw, three.js rotation.y convention (local +x turned onto (cos, -sin)). */
  rot: number;
  /** A circle (r) or a box (hw along local x, hd along local z). */
  r?: number;
  hw?: number;
  hd?: number;
  /** The solid's height over its base. */
  height: number;
  /** Crates, barrels and bollards can be stood on (the camp crates' idiom); the
   *  rest are full height to movement. */
  standable?: boolean;
}

export const WYRMWATCH_HARBOR_PROPS: readonly WyrmwatchHarborProp[] = [
  // the harbor gate at the head of the stair, one post either side of the top
  // landing's west edge on its own plinth
  { kind: 'gatePost', x: 488.8, z: 1906.05, rot: 0, r: 0.55, height: 7.2 },
  { kind: 'gatePost', x: 488.8, z: 1910.75, rot: 0, r: 0.55, height: 7.2 },
  // lantern posts: by the house door, at the yard's cliff corner, and three
  // along the path to Wyrmwatch (the rails' newel lanterns need no collider)
  { kind: 'lanternPost', x: 491.75, z: 1891.1, rot: 0, r: 0.24, height: 4.4 },
  { kind: 'lanternPost', x: 488.05, z: 1896.55, rot: 0, r: 0.24, height: 4.4 },
  { kind: 'lanternPost', x: 470.5, z: 1910.3, rot: 0, r: 0.24, height: 4.4 },
  { kind: 'lanternPost', x: 453.0, z: 1908.6, rot: 0, r: 0.24, height: 4.4 },
  { kind: 'lanternPost', x: 438.8, z: 1906.9, rot: 0, r: 0.24, height: 4.4 },
  // mooring bollards along the water sides of the yard and the quay
  { kind: 'bollard', x: 491.9, z: 1894.2, rot: 0, r: 0.32, height: 1.0, standable: true },
  { kind: 'bollard', x: 498.15, z: 1902.3, rot: 0, r: 0.32, height: 1.0, standable: true },
  { kind: 'bollard', x: 498.15, z: 1905.9, rot: 0, r: 0.32, height: 1.0, standable: true },
  // cargo on the yard's landward side, clear of the walk to the house door (the
  // nets went indoors)
  {
    kind: 'crateStack',
    x: 488.45,
    z: 1892.3,
    rot: 0,
    hw: 0.7,
    hd: 0.95,
    height: 1.7,
    standable: true,
  },
  { kind: 'barrel', x: 488.45, z: 1895.35, rot: 0, r: 0.5, height: 1.35, standable: true },
  // ...and on the south quay's cliff side, clear of the walk to flight one
  {
    kind: 'crateStack',
    x: 494.15,
    z: 1903.4,
    rot: 0,
    hw: 0.6,
    hd: 1.0,
    height: 1.7,
    standable: true,
  },
  { kind: 'barrel', x: 494.0, z: 1905.6, rot: 0, r: 0.5, height: 1.35, standable: true },
  { kind: 'barrel', x: 494.05, z: 1906.75, rot: 0, r: 0.5, height: 1.35, standable: true },
];

/** The flagstone path from the gate across the plateau toward Wyrmwatch: its
 *  centre line (world x, z) and half width. Drawn only (the ground under it is
 *  the walkable plateau), it stops at x 437.5, short of the hub's ground. */
export const WYRMWATCH_HARBOR_PATH: readonly (readonly [number, number])[] = [
  [488.2, 1908.4],
  [482, 1908.5],
  [474, 1908.3],
  [466, 1907.6],
  [458, 1906.8],
  [450, 1906.2],
  [443, 1905.4],
  [437.5, 1904.6],
];
export const WYRMWATCH_HARBOR_PATH_HALF_WIDTH = 1.3;
