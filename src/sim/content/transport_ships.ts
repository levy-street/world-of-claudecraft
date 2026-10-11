// Transport ship hulls: the walkable collision layout of every ship model a
// `decorProps` row can moor (keyed by the row's `key`). Data-as-code; the
// placement math lives in ../transport_ship.ts and decor_prop_colliders.ts
// places a hull wherever its key is moored.
//
// The Eastbrook ferry (Phase 1: moored at the ferry pier's T-head, static,
// idle-animated). Numbers are yards in the ship frame (origin at the
// waterline centre, +z bow, +x port) and MIRROR the Blender source
// (scripts/assets/eastbrook_ferry/build_eastbrook_ferry.py), whose export
// stamps the headline dimensions into the shipped GLB's root extras;
// tests/eastbrook_ferry_asset.test.ts pins the two against each other.
//
// Scale: the player model stands 2.6 yd to the crown (HUMANOID_H in
// render/characters/manifest.ts) on a 0.5 yd body radius, climbs 0.9 yd
// unaided (MAX_STEP_HEIGHT) and jumps 1.125 yd (player_motion.ts). So the
// rails sit at 1.2 yd (waist height on the model, above a jump), stair
// treads rise 0.3 yd, the cabin door is 3 yd tall, and the waist deck is a
// 9.5 yd wide, 16 yd long open floor with the masts on the centre line.

import type {
  TransportBerthDef,
  TransportRouteDef,
  TransportTimings,
  TransportWaypoint,
} from '../transport_schedule';
import { railRun, type ShipHullLayout, type ShipVolume, stairFlight } from '../transport_ship';

const DECK = 3.3; // main (waist) deck, above the waterline
const CAPTAIN = 6.3; // quarterdeck over the stern cabin
const FORECASTLE = 4.5; // raised bow deck
const RAIL = 1.2; // rail height above the deck it guards
/** An open balustrade (turned posts under a rail) is seen and cast through
 *  above its bottom rail, this far over the deck it stands on. */
const BALUSTRADE_SIGHT = 0.3;

/** Outer half-beam of the hull at deck level, stern (-z) to stem (+z). The
 *  Blender source lofts the hull through the same stations. */
export const EASTBROOK_FERRY_BEAM_STATIONS: readonly (readonly [number, number])[] = [
  [-15.5, 4.1],
  [-12, 4.75],
  [-7.5, 5.05],
  [-2.5, 5.15],
  [0.8, 5.15],
  [5, 5.0],
  [8.5, 4.6],
  [11, 3.95],
  [13, 3.0],
  [14.5, 1.9],
  [15.5, 0.7],
];

/** Outer half-beam at z (linear between the stations). */
export function eastbrookFerryHalfBeam(z: number): number {
  const s = EASTBROOK_FERRY_BEAM_STATIONS;
  if (z <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) {
    if (z <= s[i][0]) {
      const [z0, w0] = s[i - 1];
      const [z1, w1] = s[i];
      return w0 + ((w1 - w0) * (z - z0)) / (z1 - z0);
    }
  }
  return s[s.length - 1][1];
}

/** Bulwark thickness: the rail's inner face sits this far inside the hull. */
const BULWARK = 0.35;
/** The port gangway opening (the Eastbrook pier side), ship-frame z. */
const GANGWAY_Z0 = -0.4;
const GANGWAY_Z1 = 2.0;
const GANGWAY_Z = (GANGWAY_Z0 + GANGWAY_Z1) / 2;
/** The clear width between the rail ends (each rail box overhangs its end by
 *  half its 0.3 thickness). */
const CLEAR = GANGWAY_Z1 - GANGWAY_Z0 - 0.3;

/** Rail centre-line points along one side between z0 and z1. */
function sideLine(side: 1 | -1, z0: number, z1: number, step = 1.5): [number, number][] {
  const pts: [number, number][] = [];
  const n = Math.max(1, Math.ceil(Math.abs(z1 - z0) / step));
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    pts.push([side * (eastbrookFerryHalfBeam(z) - BULWARK + 0.15), z]);
  }
  return pts;
}

function eastbrookFerryVolumes(): ShipVolume[] {
  const v: ShipVolume[] = [];
  const deck = (id: string, z0: number, z1: number, hw: number, top: number): void => {
    v.push({
      id,
      kind: 'deck',
      shape: 'obb',
      x: 0,
      z: (z0 + z1) / 2,
      hw,
      hd: (z1 - z0) / 2,
      top,
      standable: true,
    });
  };
  // Floors. Every box stays inside the hull's outer skin at its ends, and the
  // rail runs below line the edges, so the floor boxes may run under a rail.
  deck('captain_deck_aft', -15.2, -12, 4.05, CAPTAIN);
  deck('captain_deck_fore', -12, -7.5, 4.6, CAPTAIN);
  deck('main_deck_aft', -7.5, 5, 4.75, DECK);
  deck('main_deck_fore', 5, 8.5, 4.5, DECK);
  deck('forecastle_aft', 8.5, 11, 4.3, FORECASTLE);
  deck('forecastle_mid', 11, 13, 3.4, FORECASTLE);
  deck('forecastle_fore', 13, 14, 2.4, FORECASTLE);
  deck('forecastle_stem', 14, 14.8, 1.6, FORECASTLE);

  // Stairs: two wide flights up the quarterdeck face (against each rail,
  // leaving the cabin door clear between them) and one broad flight up to
  // the forecastle on the centre line. Treads rise 0.3, well under a stride.
  for (const side of [1, -1] as const) {
    const name = side === 1 ? 'port' : 'starboard';
    v.push(
      ...stairFlight(`captain_stair_${name}`, side * 3.72, 0.97, -2.5, -1, 0.5, 10, DECK, CAPTAIN),
    );
  }
  v.push(...stairFlight('forecastle_stair', 0, 1.6, 7.15, 1, 0.45, 3, DECK, FORECASTLE - 0.3));

  // Rails. The waist rail stops at the gangways; the stair section rises to
  // the quarterdeck's rail height with the treads it guards.
  for (const side of [1, -1] as const) {
    const name = side === 1 ? 'port' : 'starboard';
    v.push(...railRun(`rail_${name}_captain`, sideLine(side, -15.2, -7.5), CAPTAIN + RAIL));
    v.push(...railRun(`rail_${name}_stair`, sideLine(side, -7.5, -2.5), CAPTAIN + RAIL));
    v.push(...railRun(`rail_${name}_waist_aft`, sideLine(side, -2.5, GANGWAY_Z0), DECK + RAIL));
    v.push(...railRun(`rail_${name}_waist_fore`, sideLine(side, GANGWAY_Z1, 8.5), DECK + RAIL));
    v.push(
      ...railRun(`rail_${name}_forecastle`, sideLine(side, 8.5, 14.8, 1.1), FORECASTLE + RAIL),
    );
    // The quarterdeck stair's inner banister, over its upper half (a fall
    // from the lower treads is a short hop onto the waist).
    v.push(
      ...railRun(
        `banister_${name}`,
        [
          [side * 2.6, -4.5],
          [side * 2.6, -7.5],
        ],
        CAPTAIN + RAIL,
        0.25,
      ),
    );
    // Forecastle break rail, each side of its stair.
    v.push(
      ...railRun(
        `rail_${name}_forecastle_break`,
        [
          [side * 1.75, 8.6],
          [side * (eastbrookFerryHalfBeam(8.6) - BULWARK), 8.6],
        ],
        FORECASTLE + RAIL,
        0.3,
        'rail',
        FORECASTLE + BALUSTRADE_SIGHT,
      ),
    );
  }
  // The starboard gangway is closed by its drop bar until a dock meets it.
  v.push(
    ...railRun('gate_starboard', sideLine(-1, GANGWAY_Z0, GANGWAY_Z1), DECK + RAIL, 0.3, 'gate'),
  );
  // The bow rail closing the two forecastle rails at the stem head.
  const stemX = eastbrookFerryHalfBeam(14.8) - BULWARK + 0.15;
  v.push(
    ...railRun(
      'rail_bow',
      [
        [stemX, 14.8],
        [-stemX, 14.8],
      ],
      FORECASTLE + RAIL,
    ),
  );
  // Taffrail across the stern, and the quarterdeck's front rail over the
  // cabin door (open at each end where the stairs arrive).
  v.push(
    ...railRun(
      'rail_taffrail',
      [
        [-3.85, -15.25],
        [3.85, -15.25],
      ],
      CAPTAIN + RAIL,
    ),
  );
  v.push(
    ...railRun(
      'rail_captain_front',
      [
        [-2.6, -7.6],
        [2.6, -7.6],
      ],
      CAPTAIN + RAIL,
      0.3,
      'rail',
      CAPTAIN + BALUSTRADE_SIGHT,
    ),
  );

  // Masts: full-height posts on the centre line.
  const mast = (id: string, z: number, r: number, top: number): void => {
    v.push({ id, kind: 'mast', shape: 'circle', x: 0, z, r, top, standable: false });
  };
  mast('mast_fore', 11.2, 0.5, 24);
  mast('mast_main', 2.5, 0.55, 28);
  mast('mast_mizzen', -10.5, 0.45, 21);

  // Dressing along the deck edges. Everything that stands against a rail is a
  // WALL, not a floor: a bench or a crate a player could stand on would lift a
  // jump over the rail beside it. Only the low hatch in mid-deck is a floor.
  const prop = (
    id: string,
    x: number,
    z: number,
    hw: number,
    hd: number,
    top: number,
    standable = false,
  ): void => {
    v.push({ id, kind: 'prop', shape: 'obb', x, z, hw, hd, top, standable });
  };
  // the main hatch's raised grating, a low step on the waist
  prop('hatch_main', 0, -1.0, 1.1, 1.1, DECK + 0.22, true);
  prop('bench_port', 4.2, 5.0, 0.35, 1.3, DECK + 0.55);
  prop('bench_starboard', -4.2, 5.0, 0.35, 1.3, DECK + 0.55);
  prop('crates_port', 3.55, 7.5, 0.65, 0.8, DECK + 1.5);
  v.push({
    id: 'barrels_starboard',
    kind: 'prop',
    shape: 'circle',
    x: -3.6,
    z: 7.45,
    r: 0.8,
    top: DECK + 1.0,
    standable: false,
  });
  v.push({
    id: 'helm_wheel',
    kind: 'prop',
    shape: 'circle',
    x: 0,
    z: -13.4,
    r: 0.55,
    top: CAPTAIN + 1.8,
    standable: false,
  });
  prop('chart_table', -2.6, -9.6, 0.55, 0.75, CAPTAIN + 1.0);

  // Boarding. The port gangway's side platform, then the gangplank the
  // Eastbrook berth deploys onto the ferry pier's T-head (the pier deck
  // stands 2.64 yd above the water, so the plank drops 0.66 over 2.4 yd in
  // two treads).
  v.push({
    id: 'gangway_port',
    kind: 'gangway',
    shape: 'obb',
    x: 5.325,
    z: GANGWAY_Z,
    hw: 0.575,
    hd: 1.2,
    top: DECK,
    standable: true,
  });
  v.push({
    id: 'gangplank_1',
    kind: 'gangplank',
    shape: 'obb',
    x: 6.5,
    z: GANGWAY_Z,
    hw: 0.6,
    hd: 0.8,
    top: DECK - 0.22,
    standable: true,
  });
  v.push({
    id: 'gangplank_2',
    kind: 'gangplank',
    shape: 'obb',
    x: 7.7,
    z: GANGWAY_Z,
    hw: 0.6,
    hd: 0.8,
    top: DECK - 0.44,
    standable: true,
  });
  return v;
}

export const EASTBROOK_FERRY_HULL: ShipHullLayout = {
  id: 'eastbrookFerry',
  mainDeckY: DECK,
  captainDeckY: CAPTAIN,
  forecastleY: FORECASTLE,
  railHeight: RAIL,
  length: 31,
  beam: 10.3,
  halfBeamAt: eastbrookFerryHalfBeam,
  draft: 2.4,
  boarding: [
    { id: 'gangway_port', side: 'port', x: 5.15, y: DECK, z: GANGWAY_Z, width: CLEAR, open: true },
    {
      id: 'gangway_starboard',
      side: 'starboard',
      x: -5.15,
      y: DECK,
      z: GANGWAY_Z,
      width: CLEAR,
      open: false,
    },
  ],
  volumes: eastbrookFerryVolumes(),
};

/** Every hull a decorProps row can moor, by the row's `key`. */
export const TRANSPORT_SHIP_HULLS: Readonly<Record<string, ShipHullLayout>> = {
  eastbrookFerry: EASTBROOK_FERRY_HULL,
};

// ---------------------------------------------------------------------------
// Scheduled routes: two ferries (the same ship) sail free, round-trip
// timetables, Eastbrook Docks to Moonrest's shore in the Nightbloom, and
// Wickharbor to the shore below Wyrmwatch in the Drakelands
// (transport_schedule.ts owns the cycle math, transport_ferry.ts and transport_deck.ts carry the passengers on its
// moving deck). A route's ship is NOT a decorProps row: its hull colliders are
// placed at BOTH berths and gated by the schedule (transport_gates.ts), so the
// moored deck exists only where and while the ship lies docked; under way the
// deck is a kinematic platform that moves with the ship.
// ---------------------------------------------------------------------------

/** The Eastbrook berth: broadside across the ferry pier's T-head, bow north
 *  (+z), the port gangway square to the pier's end (world z -54) so the
 *  gangplank drops onto the pier deck (Phase 1's mooring, unchanged). */
const EASTBROOK_BERTH: TransportBerthDef = {
  id: 'eastbrook',
  poi: 'poi:eastbrook_vale:eastbrook',
  x: -125,
  z: -54.8,
  rot: 0,
  // the ferry pier's T-head, facing back up the pier toward the quay
  landing: { x: -113.5, z: -54, facing: Math.PI / 2 },
};

/** The Wickharbor berth: broadside across the berth head of the Wickharbor ferry wharf
 *  (content/wickharbor_wharf.ts: its pier runs out at rot 1.3 from the foot of the bluff,
 *  the head ends 30.3 yd out, where the old deepwater pier's landing stage ended). The ship
 *  lies with the same relation to the pier as at Eastbrook (ship rot = pier rot + PI/2, the
 *  port gangway on the pier's axis), and the wharf stands at the ferry pier height, so the
 *  gangplank drops onto the head the way it does at every other berth. */
const WICKHARBOR_BERTH: TransportBerthDef = {
  id: 'wickharbor',
  poi: 'poi:galecrest:wickharbor',
  x: 487.3,
  z: 385.27,
  rot: 1.3 + Math.PI / 2,
  // on the wharf's pier, short of the berth head, facing town
  landing: { x: 473.25, z: 380.54, facing: 1.3 - Math.PI },
};

/** The Nightbloom berth: off the sunset shore at the end of the Gloamfield
 *  road, west of Moonrest, in the deep western strait. The ship lies bow
 *  north, its port gangway facing the shore across the end of the Moonrest
 *  ferry pier (content: sim/ferry_piers.ts), which stands in the water level
 *  with the gangplank the way Eastbrook's pier does. */
const NIGHTBLOOM_BERTH: TransportBerthDef = {
  id: 'nightbloom',
  poi: 'poi:nightbloom:moonrest',
  x: -520,
  z: 1505.2,
  rot: 0,
  // on the pier near its end, facing back up it toward the shore
  landing: { x: -508.5, z: 1506, facing: Math.PI / 2 },
};

/** The Drakelands berth: east of Wyrmwatch, in the deep strait below the
 *  bank. The ship lies bow south so its port gangway faces the shore (west)
 *  across the end of the Wyrmwatch ferry pier (sim/ferry_piers.ts). */
const DRAKELANDS_BERTH: TransportBerthDef = {
  id: 'drakelands',
  poi: 'poi:drakelands:wyrmwatch',
  x: 515,
  z: 1900,
  rot: Math.PI,
  // on the pier near its end, facing back up it toward the shore
  landing: { x: 503.5, z: 1899.2, facing: -Math.PI / 2 },
};

/** Where a ship turning about its stern lies: `stern` stays put while the
 *  bow swings to `rot` (the hull's 15.5 yd stern-to-centre offset). */
function sternPivot(sx: number, sz: number, rot: number): TransportWaypoint {
  return { x: sx + 15.5 * Math.sin(rot), z: sz + 15.5 * Math.cos(rot), rot };
}

/**
 * The sea lane Eastbrook to the Nightbloom. The only water that joins them
 * runs up the far west of the world: out of the cove and north up the deep
 * western strait, west along the deep channel south of the Willowfen, then
 * north up the long western shallows past the Palmreach and into the
 * Nightbloom's deep western strait, straight in onto the berth. Authored
 * against the heightfield and the colliders, pinned by
 * tests/transport_lanes.test.ts (the waterline hull afloat, clear of every
 * pier, post and moored hull; the shallows are the known keel-in-sand
 * stretch the owner accepted).
 *
 * The cove is barely longer than the ship, so it casts off by swinging its
 * bow west about its stern (clear of the piers behind it) before it gathers
 * way, then turns north out of the cove mouth.
 */
const EASTBROOK_TO_NIGHTBLOOM: readonly TransportWaypoint[] = [
  { x: EASTBROOK_BERTH.x, z: EASTBROOK_BERTH.z, rot: EASTBROOK_BERTH.rot },
  sternPivot(-125, -70.3, -0.3),
  sternPivot(-125, -70.3, -0.75),
  sternPivot(-125, -70.3, -1.2),
  sternPivot(-125, -70.3, -Math.PI / 2),
  { x: -152, z: -70.6 },
  { x: -166, z: -72 },
  { x: -179, z: -68 },
  { x: -186, z: -52 },
  { x: -187, z: -20 },
  { x: -186, z: 20 },
  { x: -186, z: 60 },
  { x: -186, z: 100 },
  { x: -193, z: 138 },
  { x: -212, z: 158 },
  { x: -245, z: 165 },
  { x: -300, z: 165 },
  { x: -360, z: 165 },
  { x: -420, z: 165 },
  { x: -478, z: 165 },
  { x: -518, z: 172 },
  { x: -544, z: 200 },
  { x: -552, z: 240 },
  { x: -552, z: 300 },
  { x: -552, z: 360 },
  { x: -552, z: 420 },
  { x: -550, z: 480 },
  { x: -548, z: 540 },
  { x: -546, z: 600 },
  { x: -546, z: 660 },
  { x: -546, z: 720 },
  { x: -540, z: 790 },
  { x: -526, z: 828 },
  { x: -540, z: 866 },
  { x: -554, z: 910 },
  { x: -548, z: 970 },
  { x: -540, z: 1030 },
  { x: -520, z: 1080 },
  { x: -496, z: 1122 },
  { x: -476, z: 1165 },
  { x: -482, z: 1205 },
  { x: -502, z: 1250 },
  { x: -514, z: 1300 },
  { x: -516, z: 1360 },
  { x: -518, z: 1420 },
  { x: -520, z: 1465 },
  { x: NIGHTBLOOM_BERTH.x, z: 1485, rot: NIGHTBLOOM_BERTH.rot },
  { x: NIGHTBLOOM_BERTH.x, z: NIGHTBLOOM_BERTH.z, rot: NIGHTBLOOM_BERTH.rot },
];

/**
 * The sea lane the Nightbloom to Eastbrook: the same sea road the other way.
 * The berth faces north up the strait, so it casts off by swinging its bow
 * west, away from the pier, about its stern until it points south, then runs
 * the western shallows south, east along the channel, down the western
 * strait, and into the cove, where it swings north onto the berth along an
 * arc that keeps its bow clear of the ferry pier's T-head.
 */
const NIGHTBLOOM_TO_EASTBROOK: readonly TransportWaypoint[] = [
  { x: NIGHTBLOOM_BERTH.x, z: NIGHTBLOOM_BERTH.z, rot: NIGHTBLOOM_BERTH.rot },
  sternPivot(-520, 1489.7, -0.5),
  sternPivot(-520, 1489.7, -1.1),
  sternPivot(-520, 1489.7, -1.7),
  sternPivot(-520, 1489.7, -2.3),
  sternPivot(-520, 1489.7, -2.8),
  sternPivot(-520, 1489.7, -Math.PI),
  { x: -520, z: 1440 },
  { x: -518, z: 1400 },
  { x: -516, z: 1340 },
  { x: -512, z: 1290 },
  { x: -500, z: 1245 },
  { x: -480, z: 1205 },
  { x: -476, z: 1165 },
  { x: -496, z: 1122 },
  { x: -520, z: 1080 },
  { x: -540, z: 1030 },
  { x: -548, z: 970 },
  { x: -554, z: 910 },
  { x: -540, z: 866 },
  { x: -526, z: 828 },
  { x: -540, z: 790 },
  { x: -546, z: 720 },
  { x: -546, z: 660 },
  { x: -546, z: 600 },
  { x: -548, z: 540 },
  { x: -550, z: 480 },
  { x: -552, z: 420 },
  { x: -552, z: 360 },
  { x: -552, z: 300 },
  { x: -552, z: 240 },
  { x: -544, z: 200 },
  { x: -518, z: 172 },
  { x: -478, z: 165 },
  { x: -420, z: 165 },
  { x: -360, z: 165 },
  { x: -300, z: 165 },
  { x: -245, z: 165 },
  { x: -212, z: 158 },
  { x: -193, z: 138 },
  { x: -186, z: 100 },
  { x: -186, z: 60 },
  { x: -186, z: 20 },
  { x: -187, z: -20 },
  { x: -187, z: -50 },
  { x: -182, z: -70 },
  { x: -171, z: -77.5 },
  { x: -159, z: -75 },
  { x: -145, z: -74.8 },
  { x: -137.35, z: -73.28 },
  { x: -130.86, z: -68.94 },
  { x: -126.52, z: -62.45 },
  { x: EASTBROOK_BERTH.x, z: EASTBROOK_BERTH.z, rot: EASTBROOK_BERTH.rot },
];

/**
 * The sea lane Wickharbor to the Drakelands. North out of Wickharbor's bay,
 * up the eastern shallows, through the deep Thornpeak water and its narrow
 * northern neck (widened for the ship, content/zone3.ts), up the
 * Evergarden shallows and into the deep eastern strait along the Drakelands
 * coast. At the berth it runs on past the pier, heading north, and swings its
 * bow east about its stern until it points south, lying alongside the pier.
 * It casts off from Wickharbor by pivoting its bow east away from the
 * berth head of the wharf (content/wickharbor_wharf.ts), as the ferry always has.
 */
const WICKHARBOR_TO_DRAKELANDS: readonly TransportWaypoint[] = [
  { x: WICKHARBOR_BERTH.x, z: WICKHARBOR_BERTH.z, rot: WICKHARBOR_BERTH.rot },
  { x: 489.6, z: 385.9, rot: WICKHARBOR_BERTH.rot },
  { x: 492.6, z: 383.4, rot: 2.5 },
  { x: 497.8, z: 379, rot: 2.05 },
  { x: 505.5, z: 375, rot: 1.78 },
  { x: 519, z: 375 },
  { x: 531, z: 386 },
  { x: 537, z: 410 },
  { x: 537, z: 440 },
  { x: 536, z: 480 },
  { x: 536, z: 540 },
  { x: 536, z: 600 },
  { x: 536, z: 660 },
  { x: 540, z: 710 },
  { x: 539.5, z: 740 },
  { x: 539.5, z: 767 },
  { x: 538.5, z: 800 },
  { x: 532, z: 825 },
  { x: 532, z: 865 },
  { x: 528, z: 905 },
  { x: 522, z: 945 },
  { x: 522, z: 1000 },
  { x: 522, z: 1060 },
  { x: 522, z: 1110 },
  { x: 524, z: 1160 },
  { x: 524, z: 1220 },
  { x: 524, z: 1280 },
  { x: 524, z: 1360 },
  { x: 524, z: 1440 },
  { x: 524, z: 1520 },
  { x: 524, z: 1600 },
  { x: 524, z: 1680 },
  { x: 529, z: 1740 },
  { x: 530, z: 1800 },
  { x: 526, z: 1850 },
  { x: 520, z: 1885 },
  { x: DRAKELANDS_BERTH.x, z: 1915.5, rot: 0 },
  sternPivot(515, 1915.5, 0),
  sternPivot(515, 1915.5, 0.6),
  sternPivot(515, 1915.5, 1.2),
  sternPivot(515, 1915.5, 1.8),
  sternPivot(515, 1915.5, 2.4),
  sternPivot(515, 1915.5, 2.9),
  { x: DRAKELANDS_BERTH.x, z: DRAKELANDS_BERTH.z, rot: DRAKELANDS_BERTH.rot },
];

/**
 * The sea lane the Drakelands to Wickharbor: the same sea road the other way.
 * The berth already faces south, so it simply gathers way down the strait,
 * and at Wickharbor it swings round the bay's north end and runs in along
 * the berth's own axis.
 */
const DRAKELANDS_TO_WICKHARBOR: readonly TransportWaypoint[] = [
  { x: DRAKELANDS_BERTH.x, z: DRAKELANDS_BERTH.z, rot: DRAKELANDS_BERTH.rot },
  { x: 516, z: 1870 },
  { x: 522, z: 1830 },
  { x: 528, z: 1790 },
  { x: 529, z: 1740 },
  { x: 524, z: 1680 },
  { x: 524, z: 1600 },
  { x: 524, z: 1520 },
  { x: 524, z: 1440 },
  { x: 524, z: 1360 },
  { x: 524, z: 1280 },
  { x: 524, z: 1220 },
  { x: 524, z: 1160 },
  { x: 522, z: 1110 },
  { x: 522, z: 1060 },
  { x: 522, z: 1000 },
  { x: 522, z: 945 },
  { x: 528, z: 905 },
  { x: 532, z: 865 },
  { x: 532, z: 825 },
  { x: 538, z: 795 },
  { x: 539.5, z: 767 },
  { x: 539.5, z: 740 },
  { x: 540, z: 710 },
  { x: 536, z: 660 },
  { x: 536, z: 600 },
  { x: 536, z: 540 },
  { x: 534, z: 500 },
  { x: 524, z: 470 },
  { x: 508, z: 461 },
  { x: 493, z: 457 },
  { x: 482, z: 443 },
  { x: 478.5, z: 424 },
  { x: 482, z: 404.6, rot: WICKHARBOR_BERTH.rot },
  { x: 484.6, z: 394.9, rot: WICKHARBOR_BERTH.rot },
  { x: WICKHARBOR_BERTH.x, z: WICKHARBOR_BERTH.z, rot: WICKHARBOR_BERTH.rot },
];

/** The ferries' timetable and handling (transport_schedule.ts), shared by
 *  both routes: a minute at each pier, then a voyage of about two minutes
 *  each way. They cruise at 19 yards a second (under three times a runner's
 *  pace), take about ten seconds to gather way or come to rest, and never
 *  swing the bow faster than a quarter radian a second, so they creep round
 *  the tight harbor turns and run the long reaches. */
export const EASTBROOK_FERRY_TIMINGS: TransportTimings = {
  docked: 60,
  cruise: 19,
  accel: 2,
  turnRate: 0.25,
};

/** Route A: Eastbrook Docks and Moonrest's shore, in the Nightbloom. */
export const EASTBROOK_NIGHTBLOOM_FERRY: TransportRouteDef = {
  id: 'eastbrookNightbloom',
  ship: 'eastbrookFerry',
  berths: [EASTBROOK_BERTH, NIGHTBLOOM_BERTH],
  lanes: [EASTBROOK_TO_NIGHTBLOOM, NIGHTBLOOM_TO_EASTBROOK],
  timings: EASTBROOK_FERRY_TIMINGS,
};

/** Route B: Wickharbor and the shore below Wyrmwatch, in the Drakelands. */
export const WICKHARBOR_DRAKELANDS_FERRY: TransportRouteDef = {
  id: 'wickharborDrakelands',
  ship: 'eastbrookFerry',
  berths: [WICKHARBOR_BERTH, DRAKELANDS_BERTH],
  lanes: [WICKHARBOR_TO_DRAKELANDS, DRAKELANDS_TO_WICKHARBOR],
  timings: EASTBROOK_FERRY_TIMINGS,
};

/** Every scheduled route in the built-in world, each sailed by its own ship
 *  (the same model and hull). */
export const TRANSPORT_ROUTES: readonly TransportRouteDef[] = [
  EASTBROOK_NIGHTBLOOM_FERRY,
  WICKHARBOR_DRAKELANDS_FERRY,
];
