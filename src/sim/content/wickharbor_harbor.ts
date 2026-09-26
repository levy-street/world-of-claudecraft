// Wickharbor's wooden harbor (the Galecrest): the shore boardwalk laid along the waterline
// under the bluff, the great quay that fills the water off it from the north pier down to
// the ferry wharf, the two fingers (the north pier and the middle pier) out from the quay's
// sea face, the two stairs climbing the bluff from the boardwalk to the town, and the Old
// Beacon's dock with the stair down the headland to it. Data-as-code; ../gale_harbor.ts walks the decks (GALE_HARBOR_DECKS), the
// colliders are built by ../wickharbor_harbor.ts, and render/wickharbor_harbor.ts draws the
// one Blender model (public/models/props/wickharbor_harbor.glb,
// scripts/assets/wickharbor_harbor/, which reads THESE numbers through its exported
// layout.json). The ferry wharf off the boardwalk's south end is its own record
// (content/wickharbor_wharf.ts) in the same wood.
//
// The harbor frame is the boardwalk's: `u` along it (its heading, south), `v` across it
// (positive seaward, east). Every plank surface is set above the water here, never by the
// ground under it, so each one is exact whatever the terrain; the shore anchors (ax, az)
// only keep the terrain under the roots padded as it always was (terrain_calm_anchors.ts),
// and the decks keep their old order for that.
//
// The great quay lies in the ferry wharf's own frame (QUAY_ORIGIN, QUAY_ROT: the wharf's
// origin and heading, which the north pier has always shared), at the boardwalk's height, so
// the wharf's pier becomes the raised berth mole along the quay's south side and its flight
// the stair up onto it. It is two plank fields split along the line of the boardwalk's south
// end: the north half from the boardwalk's seaward edge to the sea face, between the north
// pier and that line; the south half from the wharf's arm and flight to the sea face, between
// that line and the wharf's pier. The sea face runs where the berth head begins (the ship
// lies clear beyond it, as it always lay clear of the head).
//
// The joins, so no two floors ever share a plank plane:
//  - the quay's north half meets the boardwalk along its seaward edge (a cut), the north
//    pier along the pier's south side, and its south half along the boardwalk's south end
//    line (a cut on each);
//  - the quay's south half meets the wharf's pier, arm and berth head along their edges,
//    1.75 yd below their planks (the wharf's own rails stand on that drop);
//  - the middle pier runs straight out from the quay's sea face, its root ON the face;
//  - the north pier keeps its heading and is cut along the boardwalk's seaward edge, so the
//    two share the edge and nothing else;
//  - the north stair runs square off the boardwalk's landward edge from the boardwalk's own
//    height, and lands on the bluff top where the ground meets it;
//  - the south stair climbs a bluff too steep for that: its first tread stands ON the
//    boardwalk's landward edge a step above the planks (the ferry wharf's flight idiom);
//  - the Beacon dock is cut along the end of the stair that comes down onto its root.
// tests/wickharbor_harbor.test.ts pins all of it and walks every route.
//
// The plank heights are the built-in world's (WORLD_SEED), set above the water like the ferry
// wharf's, and the Blender model is built on that world's terrain: a headless world on another
// seed keeps the same planks.
//
// Imports from ../gale_harbor are type-only, and must stay so: gale_harbor.ts imports this
// module, so a value imported back would be read before it is initialised.
//
// Scale: the player model stands 2.6 yd to the crown on a 0.5 yd body radius and climbs
// 0.9 yd unaided (MAX_STEP_HEIGHT): the boardwalk is 3.4 wide, the piers 3.6 to 4.4, the
// quay some 23 by 14, the stairs 2.6 to 2.8, the rails stand 1.2 yd (the wharf's, above a
// jump), and the quay's crane and cargo shelter stand well over a player's head.

import type { GaleDeckCut, GaleDeckDef } from '../gale_harbor';
import type { WyrmwatchHarborProp } from './wyrmwatch_harbor';

/** The harbor frame: the boardwalk's centre and heading (atan2(dx, dz)). */
export const WICKHARBOR_HARBOR_FRAME = { x: 467.5, z: 358, rot: -0.124 } as const;

const SU = Math.sin(WICKHARBOR_HARBOR_FRAME.rot);
const CU = Math.cos(WICKHARBOR_HARBOR_FRAME.rot);

/** A harbor-frame point (u along the boardwalk, v across it, seaward positive) in world yards. */
export function harborPoint(u: number, v: number): { x: number; z: number } {
  return {
    x: WICKHARBOR_HARBOR_FRAME.x + SU * u + CU * v,
    z: WICKHARBOR_HARBOR_FRAME.z + CU * u - SU * v,
  };
}

/** A world point in the harbor frame. */
export function harborLocal(x: number, z: number): { u: number; v: number } {
  const dx = x - WICKHARBOR_HARBOR_FRAME.x;
  const dz = z - WICKHARBOR_HARBOR_FRAME.z;
  return { u: dx * SU + dz * CU, v: dx * CU - dz * SU };
}

/** The boardwalk and the two north piers: the plank height of the shore network, the
 *  freeboard floor plus the deck lift of ../gale_harbor.ts (GALE_DECK_FREEBOARD 0.55 +
 *  GALE_DECK_LIFT 0.34: its shore anchor lies under the freeboard). */
export const WICKHARBOR_BOARDWALK_TOP = 0.89;
/** The Old Beacon dock: its anchor on the headland's bench, plus the deck lift. */
export const WICKHARBOR_BEACON_DOCK_TOP = 1.8858;
/** The Beacon stair's head on the headland (its anchor, plus the deck lift). */
export const WICKHARBOR_BEACON_STAIR_TOP = 6.9871;
/** The south stair's first tread stands this far over the boardwalk it rests on (the ferry
 *  wharf flight's first rise). */
export const WICKHARBOR_STAIR_FIRST_RISE = 0.25;
/** The boardwalk's half width: its seaward edge at v = +1.7, its landward edge at -1.7. */
export const WICKHARBOR_BOARDWALK_HALF_WIDTH = 1.7;
export const WICKHARBOR_BOARDWALK_HALF_LENGTH = 8.1;

export type WickharborHarborDeckId =
  | 'pierNorth'
  | 'pierMiddle'
  | 'boardwalk'
  | 'stairSouth'
  | 'stairNorth'
  | 'beaconPier'
  | 'beaconStair'
  | 'quayNorth'
  | 'quaySouth';

/** The great quay's frame: the ferry wharf's origin and heading (content/wickharbor_wharf.ts
 *  WICKHARBOR_WHARF_ORIGIN and WICKHARBOR_WHARF_ROT, pinned equal by the tests; not imported,
 *  as that module reads ../gale_harbor's values, which import this one). `along` runs out to
 *  sea, `across` north. */
export const QUAY_ORIGIN = { x: 452.54, z: 374.79 } as const;
export const QUAY_ROT = 1.3;
const QX = Math.sin(QUAY_ROT);
const QZ = Math.cos(QUAY_ROT);

/** A quay-frame point (along, across) in world yards. */
export function quayPoint(along: number, across: number): { x: number; z: number } {
  return {
    x: QUAY_ORIGIN.x + QX * along + QZ * across,
    z: QUAY_ORIGIN.z + QZ * along - QX * across,
  };
}

/** A world point in the quay frame. */
export function quayLocal(x: number, z: number): { along: number; across: number } {
  const dx = x - QUAY_ORIGIN.x;
  const dz = z - QUAY_ORIGIN.z;
  return { along: dx * QX + dz * QZ, across: dx * QZ - dz * QX };
}

/** The quay's sea face (where the ferry wharf's berth head begins), the wharf pier's north
 *  edge it runs along, and the wharf arm's east edge it starts from (quay frame). */
export const QUAY_FACE_A = 26.3;
export const QUAY_WHARF_EDGE_C = 2.8;
export const QUAY_ARM_EDGE_A = 12.65;
/** The berth head's north end, where the sea face's rail begins. */
export const QUAY_BERTH_HEAD_C = 5.5;
/** The north pier: its centre and half width (its south side bounds the quay). */
const PIER_N_CENTRE = { x: 481.6, z: 353.7 } as const;
const PIER_N_HW = 1.8;
/** The north pier's south side, in the quay frame (the pier shares the quay's heading). */
export const QUAY_NORTH_EDGE_C = quayLocal(PIER_N_CENTRE.x, PIER_N_CENTRE.z).across - PIER_N_HW;
/** The middle pier: a finger straight out from the sea face, across MID_C0..MID_C1, out to
 *  MID_A1 (its head, a stride short of where the old square pier's head stood). */
export const QUAY_MID_C0 = 18.2;
export const QUAY_MID_C1 = 22.2;
export const QUAY_MID_A1 = 34.3;

/** A walkable harbor deck, named for the model and the tests. */
export interface WickharborHarborDeck extends GaleDeckDef {
  id: WickharborHarborDeckId;
  /** Level decks draw as plank fields, stairs as treads. */
  kind: 'level' | 'stair';
}

const BW_HW = WICKHARBOR_BOARDWALK_HALF_WIDTH;
const BW = WICKHARBOR_BOARDWALK_TOP;

/** A deck square to the boardwalk, over the harbor-frame span v0..v1 (its near end at v0),
 *  centred on u, `hw` either side. Its heading runs from v0 toward v1. */
function squareDeck(
  id: WickharborHarborDeckId,
  kind: WickharborHarborDeck['kind'],
  u: number,
  v0: number,
  v1: number,
  hw: number,
  near: number,
  far: number,
  anchors: Pick<GaleDeckDef, 'ax' | 'az' | 'ax2' | 'az2'>,
): WickharborHarborDeck {
  const c = harborPoint(u, (v0 + v1) / 2);
  const seaward = v1 > v0;
  return {
    id,
    kind,
    x: c.x,
    z: c.z,
    rot: WICKHARBOR_HARBOR_FRAME.rot + (seaward ? Math.PI / 2 : -Math.PI / 2),
    hl: Math.abs(v1 - v0) / 2,
    hw,
    ...anchors,
    nearAboveWater: near,
    farAboveWater: far,
  };
}

/** The boardwalk's seaward edge as a cut: keep the side away from the boardwalk. */
const SEAWARD_EDGE: GaleDeckCut = {
  ...harborPoint(0, BW_HW),
  nx: CU,
  nz: -SU,
};

/** The Beacon stair (unchanged since the headland's cutting was carved for it,
 *  world.ts terrainHeight): down from the headland onto the dock's root. */
const BEACON_STAIR = {
  x: 503.3,
  z: 325.3,
  rot: 0.99,
  hl: 6.94,
  hw: 1.4,
} as const;
/** The stair's foot line, where the dock begins: keep the dock's side of it. */
const BEACON_STAIR_FOOT: GaleDeckCut = {
  x: BEACON_STAIR.x + Math.sin(BEACON_STAIR.rot) * BEACON_STAIR.hl,
  z: BEACON_STAIR.z + Math.cos(BEACON_STAIR.rot) * BEACON_STAIR.hl,
  nx: Math.sin(BEACON_STAIR.rot),
  nz: Math.cos(BEACON_STAIR.rot),
};

/** The shore network's one anchor (the boardwalk's root on the beach). */
const SHORE = { ax: 465, az: 354 } as const;

/** The boardwalk's south end line (harbor frame u = its half length) as a cut: the quay's
 *  north half keeps the boardwalk's side of it, the south half the other. */
const SOUTH_END = harborPoint(WICKHARBOR_BOARDWALK_HALF_LENGTH, 0);
const SOUTH_END_NORTH: GaleDeckCut = { ...SOUTH_END, nx: -SU, nz: -CU };
const SOUTH_END_SOUTH: GaleDeckCut = { ...SOUTH_END, nx: SU, nz: CU };

/** A level deck at the boardwalk's height over the quay-frame rectangle along a0..a1,
 *  across c0..c1 (its heading out to sea), trimmed by `cuts`. */
function quayDeck(
  id: WickharborHarborDeckId,
  a0: number,
  a1: number,
  c0: number,
  c1: number,
  cuts?: readonly GaleDeckCut[],
): WickharborHarborDeck {
  const c = quayPoint((a0 + a1) / 2, (c0 + c1) / 2);
  return {
    id,
    kind: 'level',
    x: c.x,
    z: c.z,
    rot: QUAY_ROT,
    hl: (a1 - a0) / 2,
    hw: (c1 - c0) / 2,
    ...SHORE,
    nearAboveWater: BW,
    farAboveWater: BW,
    ...(cuts ? { cuts } : {}),
  };
}

/** The harbor's walkable decks, in their old order (the terrain pads read their anchors in
 *  it). The middle pier and the stairs are laid square in the harbor frame; the north pier,
 *  the Beacon dock and its stair keep the headings they always had. */
export const WICKHARBOR_HARBOR_DECKS: readonly WickharborHarborDeck[] = [
  // the north pier: fanned north along the bay, cut along the boardwalk's seaward edge
  {
    id: 'pierNorth',
    kind: 'level',
    x: 481.6,
    z: 353.7,
    rot: 1.3,
    hl: 12,
    hw: 1.8,
    ...SHORE,
    nearAboveWater: BW,
    farAboveWater: BW,
    cuts: [SEAWARD_EDGE],
  },
  // the middle pier: a finger straight out from the quay's sea face
  quayDeck('pierMiddle', QUAY_FACE_A, QUAY_MID_A1, QUAY_MID_C0, QUAY_MID_C1),
  // the shore boardwalk along the waterline; its south end gives onto the ferry wharf,
  // whose flight stands on it
  {
    id: 'boardwalk',
    kind: 'level',
    x: WICKHARBOR_HARBOR_FRAME.x,
    z: WICKHARBOR_HARBOR_FRAME.z,
    rot: WICKHARBOR_HARBOR_FRAME.rot,
    hl: WICKHARBOR_BOARDWALK_HALF_LENGTH,
    hw: BW_HW,
    ...SHORE,
    nearAboveWater: BW,
    farAboveWater: BW,
  },
  // the south stair up the bluff to the town: its first tread on the boardwalk
  squareDeck('stairSouth', 'stair', 4.27, -1.35, -7.4, 1.3, BW + WICKHARBOR_STAIR_FIRST_RISE, 5.6, {
    ...SHORE,
    ax2: 458,
    az2: 361,
  }),
  // the north stair up to the harbor market, from the boardwalk's own edge
  squareDeck('stairNorth', 'stair', -4.85, -BW_HW, -8.0, 1.3, BW, 3.65, {
    ...SHORE,
    ax2: 460,
    az2: 352,
  }),
  // the Old Beacon dock: long and low off the headland's bench, begun where its stair ends
  {
    id: 'beaconPier',
    kind: 'level',
    x: 517.2,
    z: 337.2,
    rot: 0.785,
    hl: 13,
    hw: 2.2,
    ax: 507,
    az: 327,
    nearAboveWater: WICKHARBOR_BEACON_DOCK_TOP,
    farAboveWater: WICKHARBOR_BEACON_DOCK_TOP,
    cuts: [BEACON_STAIR_FOOT],
  },
  // ...and its stair down the headland's cutting from the lawn by the lighthouse
  {
    id: 'beaconStair',
    kind: 'stair',
    ...BEACON_STAIR,
    ax: 497,
    az: 321,
    ax2: 507,
    az2: 327,
    nearAboveWater: WICKHARBOR_BEACON_STAIR_TOP,
    farAboveWater: WICKHARBOR_BEACON_DOCK_TOP,
  },
  // the great quay's north half: from the boardwalk's seaward edge out to the sea face,
  // between the boardwalk's south end line and the north pier's south side
  quayDeck('quayNorth', 10, QUAY_FACE_A, 12, QUAY_NORTH_EDGE_C, [SEAWARD_EDGE, SOUTH_END_NORTH]),
  // ...and its south half: from the wharf's arm and flight out to the sea face, between the
  // wharf's pier and the boardwalk's south end line
  quayDeck('quaySouth', QUAY_ARM_EDGE_A, QUAY_FACE_A, QUAY_WHARF_EDGE_C, 14.6, [SOUTH_END_SOUTH]),
];

export function harborDeck(id: WickharborHarborDeckId): WickharborHarborDeck {
  const d = WICKHARBOR_HARBOR_DECKS.find((x) => x.id === id);
  if (!d) throw new Error(`no harbor deck ${id}`);
  return d;
}

/** A deck-frame point (along its heading, across it) in world yards. */
export function deckPoint(d: GaleDeckDef, along: number, across: number): { x: number; z: number } {
  return {
    x: d.x + Math.sin(d.rot) * along + Math.cos(d.rot) * across,
    z: d.z + Math.cos(d.rot) * along - Math.sin(d.rot) * across,
  };
}

/** A world point in a deck's frame. */
export function deckLocal(d: GaleDeckDef, x: number, z: number): { along: number; across: number } {
  const dx = x - d.x;
  const dz = z - d.z;
  return {
    along: dx * Math.sin(d.rot) + dz * Math.cos(d.rot),
    across: dx * Math.cos(d.rot) - dz * Math.sin(d.rot),
  };
}

/** Where two lines meet: each a point and a direction (world x, z). */
function meet(
  p: { x: number; z: number },
  d: { x: number; z: number },
  q: { x: number; z: number },
  e: { x: number; z: number },
): { x: number; z: number } {
  const den = d.x * e.z - d.z * e.x;
  const t = ((q.x - p.x) * e.z - (q.z - p.z) * e.x) / den;
  return { x: p.x + d.x * t, z: p.z + d.z * t };
}

function heading(d: GaleDeckDef): { x: number; z: number } {
  return { x: Math.sin(d.rot), z: Math.cos(d.rot) };
}

/** The rails stand this far inside the edges they guard (the collider is 0.3 thick, so its
 *  outer face IS the edge; the wharf's own inset). */
export const WICKHARBOR_RAIL_INSET = 0.15;
const IN = WICKHARBOR_RAIL_INSET;

const PIER_N = harborDeck('pierNorth');
const STAIR_S = harborDeck('stairSouth');
const STAIR_N = harborDeck('stairNorth');
const BEACON = harborDeck('beaconPier');
const BEACON_ST = harborDeck('beaconStair');

/** Where the boardwalk's north end is railed, from its seaward corner to this far across
 *  (landward of it the beach meets the planks within a stride). */
export const WICKHARBOR_NORTH_END_RAIL_V = 0.3;

/** The rails as world polylines. Openings: every join of two floors, the heads of the
 *  stairs on the bluff and the headland, the boardwalk's landward edge where the beach and
 *  the bluff's foot meet its planks, the landward half of its north end onto the beach,
 *  and its south end, where the ferry wharf's flight stands. The quay needs none where it
 *  meets the wharf: the wharf stands 1.75 yd over it there, railed on its own planks. */
export const WICKHARBOR_HARBOR_RAILS: readonly (readonly (readonly [number, number])[])[] = [
  // the seaward line: from the boardwalk's north end round the north pier, back along the
  // pier's south side to the quay's sea face, along the face round the middle pier, and on
  // to the ferry wharf's berth head (the wharf's own rail takes it on round the head)
  [
    harborPoint(-WICKHARBOR_BOARDWALK_HALF_LENGTH + IN, WICKHARBOR_NORTH_END_RAIL_V),
    // across the cut onto the north pier's root, and straight to its north corner (the pier
    // runs on past the boardwalk's end there, over the beach)
    harborPoint(-WICKHARBOR_BOARDWALK_HALF_LENGTH + IN, BW_HW + IN),
    deckPoint(PIER_N, -PIER_N.hl + IN, PIER_N.hw - IN),
    deckPoint(PIER_N, PIER_N.hl - IN, PIER_N.hw - IN),
    deckPoint(PIER_N, PIER_N.hl - IN, -PIER_N.hw + IN),
    quayPoint(QUAY_FACE_A - IN, QUAY_NORTH_EDGE_C + IN),
    quayPoint(QUAY_FACE_A - IN, QUAY_MID_C1 - IN),
    quayPoint(QUAY_MID_A1 - IN, QUAY_MID_C1 - IN),
    quayPoint(QUAY_MID_A1 - IN, QUAY_MID_C0 + IN),
    quayPoint(QUAY_FACE_A - IN, QUAY_MID_C0 + IN),
    quayPoint(QUAY_FACE_A - IN, QUAY_BERTH_HEAD_C - IN),
  ],
  // the north stair's south side, on along the boardwalk's landward edge over the hollow
  // under it
  [
    deckPoint(STAIR_N, STAIR_N.hl - IN, STAIR_N.hw - IN),
    harborPoint(-4.85 + STAIR_N.hw - IN, -BW_HW + IN),
    harborPoint(-0.9, -BW_HW + IN),
  ],
  // the north stair's north side, on a little way north along the landward edge
  [
    deckPoint(STAIR_N, STAIR_N.hl - IN, -STAIR_N.hw + IN),
    harborPoint(-4.85 - STAIR_N.hw + IN, -BW_HW + IN),
    harborPoint(-7.2, -BW_HW + IN),
  ],
  // the south stair's two sides, down to its first tread
  [
    deckPoint(STAIR_S, STAIR_S.hl - IN, STAIR_S.hw - IN),
    deckPoint(STAIR_S, -STAIR_S.hl + IN, STAIR_S.hw - IN),
  ],
  [
    deckPoint(STAIR_S, STAIR_S.hl - IN, -STAIR_S.hw + IN),
    deckPoint(STAIR_S, -STAIR_S.hl + IN, -STAIR_S.hw + IN),
  ],
  // the Beacon: down one side of the stair, across the dock's root beside its foot, round
  // the dock, and back up the stair's other side
  [
    deckPoint(BEACON_ST, -BEACON_ST.hl + IN, -BEACON_ST.hw + IN),
    deckPoint(BEACON_ST, BEACON_ST.hl + IN, -BEACON_ST.hw + IN),
    meet(
      deckPoint(BEACON_ST, BEACON_ST.hl + IN, 0),
      { x: Math.cos(BEACON_ST.rot), z: -Math.sin(BEACON_ST.rot) },
      deckPoint(BEACON, 0, -BEACON.hw + IN),
      heading(BEACON),
    ),
    deckPoint(BEACON, BEACON.hl - IN, -BEACON.hw + IN),
    deckPoint(BEACON, BEACON.hl - IN, BEACON.hw - IN),
    meet(
      deckPoint(BEACON_ST, BEACON_ST.hl + IN, 0),
      { x: Math.cos(BEACON_ST.rot), z: -Math.sin(BEACON_ST.rot) },
      deckPoint(BEACON, 0, BEACON.hw - IN),
      heading(BEACON),
    ),
    deckPoint(BEACON_ST, BEACON_ST.hl + IN, BEACON_ST.hw - IN),
    deckPoint(BEACON_ST, -BEACON_ST.hl + IN, BEACON_ST.hw - IN),
  ],
].map((rail) => rail.map((p) => [p.x, p.z] as const));

/** A harbor prop, placed in its deck's frame, or ('quay') in the great quay's frame (the
 *  collider and the model read the world record below). */
interface HarborPropFrame {
  deck: WickharborHarborDeckId | 'quay';
  kind: WyrmwatchHarborProp['kind'];
  along: number;
  across: number;
  /** Extra yaw on top of the deck's own (props turn with their deck: local +x along it). */
  turn?: number;
  r?: number;
  hw?: number;
  hd?: number;
  height: number;
  standable?: boolean;
}

const PROP_FRAME: readonly HarborPropFrame[] = [
  // lantern posts at the pier heads, their lanterns hanging out over the water beyond the
  // rails (the rails' newel lanterns light the walks between, no collider)
  {
    deck: 'pierNorth',
    kind: 'lanternPost',
    along: 11.4,
    across: -1.2,
    turn: -Math.PI / 2,
    r: 0.24,
    height: 4.4,
  },
  {
    deck: 'beaconPier',
    kind: 'lanternPost',
    along: 12.3,
    across: -1.55,
    turn: -Math.PI / 2,
    r: 0.24,
    height: 4.4,
  },
  {
    deck: 'beaconPier',
    kind: 'lanternPost',
    along: 12.3,
    across: 1.55,
    turn: Math.PI / 2,
    r: 0.24,
    height: 4.4,
  },
  // ...and on the boardwalk, one on the landward rail between the stairs
  {
    deck: 'boardwalk',
    kind: 'lanternPost',
    along: -2.3,
    across: -1.1,
    turn: Math.PI,
    r: 0.24,
    height: 4.4,
  },
  // cargo at the pier heads, against a rail, clear of the walk
  {
    deck: 'pierNorth',
    kind: 'barrel',
    along: 10.1,
    across: 1.02,
    r: 0.45,
    height: 1.35,
    standable: true,
  },
  {
    deck: 'beaconPier',
    kind: 'crateStack',
    along: 10.4,
    across: -1.25,
    turn: Math.PI / 2,
    hw: 0.55,
    hd: 0.95,
    height: 1.7,
    standable: true,
  },
  {
    deck: 'beaconPier',
    kind: 'barrel',
    along: 8.3,
    across: 1.3,
    r: 0.5,
    height: 1.35,
    standable: true,
  },
  // the great quay (its own frame: along out to sea, across north). Lantern posts on the
  // sea face, their lanterns hanging out over the water, and one on the middle pier's head
  { deck: 'quay', kind: 'lanternPost', along: 25.45, across: 6.4, r: 0.24, height: 4.4 },
  { deck: 'quay', kind: 'lanternPost', along: 25.45, across: 24.6, r: 0.24, height: 4.4 },
  {
    deck: 'quay',
    kind: 'lanternPost',
    along: 33.3,
    across: 21.35,
    turn: Math.PI / 2,
    r: 0.24,
    height: 4.4,
  },
  // mooring bollards along the sea face and on the middle pier's head, inside the rails
  {
    deck: 'quay',
    kind: 'bollard',
    along: 25.5,
    across: 9.4,
    r: 0.32,
    height: 1.0,
    standable: true,
  },
  {
    deck: 'quay',
    kind: 'bollard',
    along: 25.5,
    across: 16.4,
    r: 0.32,
    height: 1.0,
    standable: true,
  },
  {
    deck: 'quay',
    kind: 'bollard',
    along: 33.4,
    across: 19.0,
    r: 0.32,
    height: 1.0,
    standable: true,
  },
  // the quay crane: its mast by the sea face, the jib swung out over the water (the model's;
  // only the mast stands in the way)
  { deck: 'quay', kind: 'timberPost', along: 23.8, across: 12.2, r: 0.5, height: 7.4 },
  // the cargo shelter on the quay's north side: four corner posts under a shingled roof, the
  // cargo under it (the eaves stand clear of a player's crown even stood on the crates)
  { deck: 'quay', kind: 'timberPost', along: 14.6, across: 22.8, r: 0.2, height: 5.2 },
  { deck: 'quay', kind: 'timberPost', along: 19.6, across: 22.8, r: 0.2, height: 5.2 },
  { deck: 'quay', kind: 'timberPost', along: 14.6, across: 25.7, r: 0.2, height: 5.2 },
  { deck: 'quay', kind: 'timberPost', along: 19.6, across: 25.7, r: 0.2, height: 5.2 },
  {
    deck: 'quay',
    kind: 'crateStack',
    along: 16.1,
    across: 24.6,
    hw: 0.7,
    hd: 0.95,
    height: 1.7,
    standable: true,
  },
  {
    deck: 'quay',
    kind: 'barrel',
    along: 18.1,
    across: 25.0,
    r: 0.5,
    height: 1.35,
    standable: true,
  },
  {
    deck: 'quay',
    kind: 'barrel',
    along: 18.2,
    across: 23.8,
    r: 0.5,
    height: 1.35,
    standable: true,
  },
  // cargo waiting for the crane, clear of the walk along the face
  {
    deck: 'quay',
    kind: 'crateStack',
    along: 22.0,
    across: 9.6,
    hw: 0.7,
    hd: 0.95,
    height: 1.7,
    standable: true,
  },
  { deck: 'quay', kind: 'barrel', along: 20.6, across: 8.3, r: 0.5, height: 1.35, standable: true },
  { deck: 'quay', kind: 'barrel', along: 20.5, across: 7.1, r: 0.5, height: 1.35, standable: true },
  // a barrel on the middle pier's head, against its north rail
  {
    deck: 'quay',
    kind: 'barrel',
    along: 32.2,
    across: 21.3,
    r: 0.45,
    height: 1.35,
    standable: true,
  },
];

export type WickharborHarborProp = WyrmwatchHarborProp;

export const WICKHARBOR_HARBOR_PROPS: readonly WickharborHarborProp[] = PROP_FRAME.map((p) => {
  const at =
    p.deck === 'quay'
      ? quayPoint(p.along, p.across)
      : deckPoint(harborDeck(p.deck), p.along, p.across);
  const rot = p.deck === 'quay' ? QUAY_ROT : harborDeck(p.deck).rot;
  return {
    kind: p.kind,
    x: at.x,
    z: at.z,
    rot: rot - Math.PI / 2 + (p.turn ?? 0),
    height: p.height,
    ...(p.r !== undefined ? { r: p.r } : { hw: p.hw ?? 0.5, hd: p.hd ?? 0.5 }),
    ...(p.standable ? { standable: true } : {}),
  };
});

/** Decor rows the rebuild moved off the planks (content/galecrest.ts), each keeping the
 *  terrain pad it had where it first lay (terrain_calm_anchors.ts), so the ground round the
 *  harbor is byte-identical: the two dinghies that rode where the great quay now stands (the
 *  first had lain half under the north pier's root before that), moored now in the slip
 *  between the north pier and the middle pier, out past the quay's sea face. */
export const WICKHARBOR_HARBOR_MOVED_DECOR: readonly {
  key: string;
  from: { x: number; z: number };
  to: { x: number; z: number };
}[] = [
  { key: 'hexBoat', from: { x: 474, z: 354 }, to: { x: 486.7, z: 359.1 } },
  { key: 'hexBoat', from: { x: 479, z: 357.5 }, to: { x: 490.4, z: 360.1 } },
];
