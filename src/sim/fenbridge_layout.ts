// Canonical Fenbridge rebuild layout. This is a pure, frozen data/geometry
// module shared by simulation content, collision, rendering, and acceptance
// capture. Keep engine imports, randomness, clocks, and mutable runtime state
// out of this file: it imports only the shared town kit, itself pure.

import {
  makePlacedTownBuilding,
  placedTownSeat,
  scalePlacedTownMeasurements,
} from './placed_town_kit';

export interface Point2 {
  x: number;
  z: number;
}

export interface Obb2 {
  id: string;
  center: Point2;
  halfWidth: number;
  halfDepth: number;
  rotation: number;
}

/** The town's circle: the ring its four entrances stand on. */
interface CircularWallConfig {
  center: Point2;
  radius: number;
}

interface CircularWallGate {
  id: string;
  roadId: string;
  crossing: Point2;
  width: number;
  angle: number;
  startAngle: number;
  endAngle: number;
  start: Point2;
  end: Point2;
}

export interface CircularWallSegment {
  id: string;
  assetId: string;
  startAngle: number;
  endAngle: number;
  start: Point2;
  end: Point2;
  arcLength: number;
  chordLength: number;
  height: number;
  footprint: Obb2;
}

const TAU = Math.PI * 2;

/** Transform a point with the yaw convention used by building colliders. */
export function localToWorld(
  center: Point2,
  rotation: number,
  localX: number,
  localZ: number,
): Point2 {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: center.x + localX * cos + localZ * sin,
    z: center.z - localX * sin + localZ * cos,
  };
}

export function facingToward(from: Point2, to: Point2): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function obbCorners(obb: Obb2): Point2[] {
  return [
    localToWorld(obb.center, obb.rotation, -obb.halfWidth, -obb.halfDepth),
    localToWorld(obb.center, obb.rotation, obb.halfWidth, -obb.halfDepth),
    localToWorld(obb.center, obb.rotation, obb.halfWidth, obb.halfDepth),
    localToWorld(obb.center, obb.rotation, -obb.halfWidth, obb.halfDepth),
  ];
}

export function distancePointToObb(point: Point2, obb: Obb2): number {
  const dx = point.x - obb.center.x;
  const dz = point.z - obb.center.z;
  const cos = Math.cos(obb.rotation);
  const sin = Math.sin(obb.rotation);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  return Math.hypot(
    Math.max(Math.abs(localX) - obb.halfWidth, 0),
    Math.max(Math.abs(localZ) - obb.halfDepth, 0),
  );
}

function obbAxes(obb: Obb2): Point2[] {
  return [
    { x: Math.cos(obb.rotation), z: -Math.sin(obb.rotation) },
    { x: Math.sin(obb.rotation), z: Math.cos(obb.rotation) },
  ];
}

function projection(corners: readonly Point2[], axis: Point2): [number, number] {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const corner of corners) {
    const value = corner.x * axis.x + corner.z * axis.z;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  return [minimum, maximum];
}

/** Strict SAT overlap. Edge contact alone is not an overlap. */
export function obbsOverlap(left: Obb2, right: Obb2): boolean {
  const leftCorners = obbCorners(left);
  const rightCorners = obbCorners(right);
  for (const axis of [...obbAxes(left), ...obbAxes(right)]) {
    const [leftMinimum, leftMaximum] = projection(leftCorners, axis);
    const [rightMinimum, rightMaximum] = projection(rightCorners, axis);
    if (leftMaximum <= rightMinimum || rightMaximum <= leftMinimum) return false;
  }
  return true;
}

/** Sample every polyline segment at a deterministic maximum spacing. */
export function samplePolyline(points: readonly Point2[], maximumStep: number): Point2[] {
  if (!(maximumStep > 0) || points.length === 0) return [];
  if (points.length === 1) return [{ ...points[0] }];
  const samples: Point2[] = [{ ...points[0] }];
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    const divisions = Math.max(
      1,
      Math.ceil(Math.hypot(end.x - start.x, end.z - start.z) / maximumStep),
    );
    for (let division = 1; division <= divisions; division++) {
      const progress = division / divisions;
      samples.push({
        x: start.x + (end.x - start.x) * progress,
        z: start.z + (end.z - start.z) * progress,
      });
    }
  }
  return samples;
}

function pointOnCircle(center: Point2, radius: number, angle: number): Point2 {
  return {
    x: center.x + Math.cos(angle) * radius,
    z: center.z + Math.sin(angle) * radius,
  };
}

function positiveAngle(angle: number): number {
  const wrapped = angle % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

function makeCircularWallGate(
  config: CircularWallConfig,
  id: string,
  roadId: string,
  crossing: Point2,
  width: number,
): CircularWallGate {
  const angle = positiveAngle(
    Math.atan2(crossing.z - config.center.z, crossing.x - config.center.x),
  );
  const halfAngle = Math.asin(width / (2 * config.radius));
  const startAngle = angle - halfAngle;
  const endAngle = angle + halfAngle;
  return {
    id,
    roadId,
    crossing,
    width,
    angle,
    startAngle,
    endAngle,
    start: pointOnCircle(config.center, config.radius, startAngle),
    end: pointOnCircle(config.center, config.radius, endAngle),
  };
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

export const REMOVED_FENBRIDGE_PLACEMENTS = deepFreeze({
  buildings: [
    {
      id: 'legacy_fenbridge_building_00',
      disposition: 'removed',
      kind: 'inn',
      x: 13,
      z: 306,
      width: 6,
      depth: 7,
      rotation: -1,
    },
    {
      id: 'legacy_fenbridge_building_01',
      disposition: 'removed',
      kind: 'house',
      x: -13,
      z: 308,
      width: 7,
      depth: 6,
      rotation: 0.5,
    },
    {
      id: 'legacy_fenbridge_building_02',
      disposition: 'removed',
      kind: 'house',
      x: -12,
      z: 291,
      width: 6,
      depth: 5,
      rotation: 2.6,
    },
    {
      id: 'legacy_fenbridge_building_03',
      disposition: 'removed',
      kind: 'house',
      x: 11,
      z: 316,
      width: 6,
      depth: 5,
      rotation: 0.3,
    },
  ],
  wells: [
    {
      id: 'legacy_fenbridge_well',
      disposition: 'replaced',
      replacedBy: 'fenbridge_mirelight_cistern',
      x: 0,
      z: 302,
      radius: 1.5,
    },
  ],
  stalls: [
    {
      id: 'legacy_fenbridge_stall',
      disposition: 'replaced',
      replacedBy: 'fenbridge_provision_stall',
      x: -5,
      z: 310.5,
      rotation: Math.PI / 2,
      radius: 1.7,
    },
  ],
  campfires: [
    { id: 'legacy_fenbridge_campfire_00', disposition: 'removed', x: 4, z: 299 },
    { id: 'legacy_fenbridge_campfire_01', disposition: 'removed', x: -2, z: 293 },
  ],
  fences: [
    {
      id: 'legacy_fenbridge_fence_00',
      disposition: 'removed',
      start: { x: 16, z: 311 },
      end: { x: 21, z: 299 },
    },
    {
      id: 'legacy_fenbridge_fence_01',
      disposition: 'removed',
      start: { x: -18, z: 313 },
      end: { x: -22, z: 300 },
    },
  ],
  npcPlacements: [
    { id: 'warden_fenwick', disposition: 'relocated', position: { x: 3, z: 304 }, facing: Math.PI },
    {
      id: 'brother_aldric_fen',
      disposition: 'relocated',
      position: { x: -8, z: 296 },
      facing: 0.8,
    },
    {
      id: 'provisioner_hale',
      disposition: 'relocated',
      position: { x: -4, z: 308 },
      facing: Math.PI / 2,
    },
    {
      id: 'herbalist_yara',
      disposition: 'relocated',
      position: { x: 10, z: 295 },
      facing: -Math.PI / 2,
    },
    { id: 'scout_maren', disposition: 'relocated', position: { x: 6, z: 312 }, facing: -0.6 },
    {
      id: 'bursar_petra_vell',
      disposition: 'relocated',
      position: { x: 9, z: 303 },
      facing: -Math.PI / 2,
    },
    {
      id: 'chronicler_osric_fenn',
      disposition: 'relocated',
      position: { x: -14, z: 303 },
      facing: -1.4,
    },
    {
      id: 'tanner_hesk',
      disposition: 'preserved',
      position: { x: -11, z: 315.5 },
      facing: 2.3,
    },
  ],
  services: [
    {
      id: 'station_fenbridge_tannery',
      disposition: 'preserved',
      position: { x: -13, z: 314 },
    },
    { id: 'mailbox_fenbridge', disposition: 'preserved', position: { x: 6, z: 294 } },
    { id: 'gy_fenbridge', disposition: 'preserved', position: { x: -18, z: 286 } },
  ],
  groundObjects: [
    {
      id: 'legacy_fenbridge_muster_order_00',
      disposition: 'relocated',
      itemId: 'fen_muster_order',
      position: { x: 1, z: 294 },
    },
    {
      id: 'legacy_fenbridge_muster_order_01',
      disposition: 'relocated',
      itemId: 'fen_muster_order',
      position: { x: -2, z: 297 },
    },
  ],
} as const);

const CIVIC_CENTER = { x: 0, z: 303 } as const;
const FRONT_CLEARANCE = 1.5;

// The painted Tidehold models are authored in yards with their ground line at
// y 0 and one yard of footing below it; a visitor stands 1.8 yd off the wall
// face at a door at authored size, and that step grows with the building (its
// stoop grows too). Fenbridge stands them GRAND, as Highwatch does
// (sim/highwatch_layout.ts), each at the smallest size that walks a player
// (2.6 yd to the crown) in under a door of about five yards. Measured off
// each model's baked collision (door head and ceiling over its floor deck,
// authored size):
//  - the inn (tavern): door 4.4, taproom ceiling 4.9; at 1.2 the door clears
//    5.3 and the taproom 5.9, as Highwatch's inn (tavern_b, the same door and
//    ceiling) does;
//  - the chapel (hall): portal 5.0, nave walls 8.4 over its floor; already a
//    five-yard door, it keeps its authored size;
//  - the apothecary (shop_b) and the bank (shop_a): door 3.25, ceiling 4.2,
//    the smallest; at 1.5 each door clears 4.9 and the shop room 6.3;
//  - the warden's house (house_a, sealed): a storey of 3.95; at 1.4 it stands
//    5.5 a storey, as the Highwatch watch house does.
// Each record's measurements below are the model's at AUTHORED size
// (scalePlacedTownMeasurements carries them to the building's own scale); the
// lift buries the scaled footing and sinks the ground line a further 0.05.
const PLACED_FRONT_CLEARANCE = 1.8;
const WARDEN_HOUSE_SCALE = 1.4;
const INN_SCALE = 1.2;
const CHAPEL_SCALE = 1;
const APOTHECARY_SCALE = 1.5;
const BANK_SCALE = 1.5;

// The site plan. Two streets cross in the town's circle, which stands open
// with no palisade: the main street runs north from the south entrance (the
// causeway every traveller arrives by) past the cistern to the north
// entrance, and the marsh street joins the west and east entrances. The inn
// and the chapel face each other across the cistern, so the first thing a
// newcomer meets past the warden is a door to rest at and a door to pray at;
// the chapel's bell tower marks the crossroads, the
// barrow (the graveyard) lies along the chapel's south side, and the bank
// and the apothecary face each other up the north street. A quarter turn
// either way stands a building side-on to the circle with its door on a
// street: facing the cistern head-on, these models are too deep for it.
// Stood grand, the buildings keep their streets and their doors and grow
// outward, away from the square, past the old ring where they must: the
// warden's house stands at the south entrance itself, the inn steps two yards
// south and a stride back, and the bank and the apothecary step back off the
// north street and north off the marsh street, their back ends past the ring.
const EAST_FACING = Math.PI / 2; // the door looks east (-x), the model turned a quarter
const WEST_FACING = -Math.PI / 2; // the door looks west (+x)
// The Fenrire look of the painted set: the same models and geometry as
// /models/tidehold/, re-baked wearing the moss-grown town maps.
const PAINTED_SET = '/models/tidehold/fenrire';

const WARDEN_HOUSE = makePlacedTownBuilding(
  {
    id: 'fenbridge_warden_gatehouse',
    assetId: `${PAINTED_SET}/house_a.glb`,
    kind: 'house',
    // at the south entrance, west of the main street: the first door in town,
    // its stoop beside the muster order on this side of the causeway
    anchor: { x: 11.6, z: 274.6 },
    rotation: EAST_FACING,
    ...scalePlacedTownMeasurements(
      {
        reach: { x: 0.2145, z: 0, width: 11.763, height: 12.23, depth: 9.8 },
        walls: { x: 0, z: 0, width: 9.36, depth: 7.96 },
        doorX: -1.4,
      },
      WARDEN_HOUSE_SCALE,
    ),
  },
  placedTownSeat(WARDEN_HOUSE_SCALE, PLACED_FRONT_CLEARANCE * WARDEN_HOUSE_SCALE),
);
const INN_BASE = makePlacedTownBuilding(
  {
    id: 'fenbridge_crooked_reed_inn',
    assetId: `${PAINTED_SET}/tavern.glb`,
    kind: 'inn',
    // west of the cistern, its long front on the main street
    anchor: { x: 13.55, z: 298 },
    rotation: EAST_FACING,
    ...scalePlacedTownMeasurements(
      {
        reach: { x: 0.272, z: -0.05, width: 22.648, height: 18.78, depth: 16.8 },
        walls: { x: 0, z: 0, width: 20, depth: 13 },
        annexes: [
          { name: 'front_bench', x: -5.1, z: -7.25, width: 5.4, depth: 0.9 },
          { name: 'barrels', x: 10.9, z: -4.9, width: 1.1, depth: 2.3 },
        ],
        doorX: 0,
      },
      INN_SCALE,
    ),
    walkIn: true,
  },
  placedTownSeat(INN_SCALE, PLACED_FRONT_CLEARANCE * INN_SCALE),
);
const CHAPEL_BASE = makePlacedTownBuilding(
  {
    id: 'fenbridge_lantern_chapel',
    assetId: `${PAINTED_SET}/hall.glb`,
    kind: 'chapel',
    // east of the cistern, its gable and door facing the inn's
    anchor: { x: -16.2, z: 299.6 },
    rotation: WEST_FACING,
    ...scalePlacedTownMeasurements(
      {
        reach: { x: 1.9255, z: -0.254, width: 18.851, height: 30.5, depth: 24.212 },
        walls: { x: 0, z: 0, width: 12, depth: 22 },
        annexes: [
          // at the crossroads corner
          { name: 'bell_tower', x: 8.25, z: -9, width: 5.4, depth: 5.4 },
          // the chronicler's archive board, left of the door
          { name: 'notice_board', x: -4.2, z: -11.8, width: 1.8, depth: 0.6 },
        ],
        doorX: 0,
      },
      CHAPEL_SCALE,
    ),
    walkIn: true,
  },
  placedTownSeat(CHAPEL_SCALE, PLACED_FRONT_CLEARANCE * CHAPEL_SCALE),
);
const APOTHECARY = makePlacedTownBuilding(
  {
    id: 'fenbridge_moonwort_apothecary',
    // the potion shop: a flask on its sign, bottles on its street stall
    assetId: `${PAINTED_SET}/shop_b.glb`,
    kind: 'house',
    // north street, west side, facing the bank; its turret on the crossroads
    anchor: { x: 12.75, z: 326.4 },
    rotation: EAST_FACING,
    ...scalePlacedTownMeasurements(
      {
        reach: { x: 0.4745, z: -0.849, width: 13.649, height: 18.7, depth: 12.702 },
        walls: { x: 0, z: 0, width: 9.4, depth: 9 },
        annexes: [{ name: 'turret', x: 5.19, z: -4.99, width: 2.66, depth: 2.66 }],
        doorX: -0.7,
      },
      APOTHECARY_SCALE,
    ),
    walkIn: true,
  },
  placedTownSeat(APOTHECARY_SCALE, PLACED_FRONT_CLEARANCE * APOTHECARY_SCALE),
);
const BANK_BASE = makePlacedTownBuilding(
  {
    id: 'fenbridge_gilded_strongbox',
    // the goods shop with the sack sign: the town's counting house
    assetId: `${PAINTED_SET}/shop_a.glb`,
    kind: 'house',
    // north street, east side, its counter and awning on the street
    anchor: { x: -12.3, z: 325.3 },
    rotation: WEST_FACING,
    ...scalePlacedTownMeasurements(
      {
        reach: { x: 0, z: -0.8, width: 13.004, height: 16.28, depth: 12.2 },
        walls: { x: 0, z: 0, width: 11, depth: 8.4 },
        annexes: [
          { name: 'stall_counter', x: 2.375, z: -5.925, width: 3.61, depth: 0.77 },
          // the barrels at the stall's north end, with the awning post beside them
          { name: 'stall_barrels', x: 4.885, z: -5.762, width: 1.477, depth: 2.169 },
        ],
        doorX: -1.6,
      },
      BANK_SCALE,
    ),
    walkIn: true,
  },
  placedTownSeat(BANK_SCALE, PLACED_FRONT_CLEARANCE * BANK_SCALE),
);

// Provisioner Hale's stall stands on the main street in front of the inn's
// south half, its counter facing the street (the stall's front is its +Z).
const PROVISION_STALL_POSITION = { x: 3, z: 294.5 } as const;
const PROVISION_STALL_ROTATION = facingToward(PROVISION_STALL_POSITION, {
  x: 0,
  z: PROVISION_STALL_POSITION.z,
});
const PROVISION_STALL_WIDTH = 3.2;
const PROVISION_STALL_DEPTH = 1.6;
// By the south entrance, board facing the square (readable on approach).
const MUSTER_BOARD_POSITION = { x: -6, z: 278 } as const;
const MUSTER_BOARD_ROTATION = facingToward(MUSTER_BOARD_POSITION, CIVIC_CENTER);
// The vendor stands at the counter's south end, clear of the stall OBB so
// pathfinding can reach them (Eastbrook-style service apron, not inside mesh).
const PROVISION_STALL_VENDOR_POINT = localToWorld(
  PROVISION_STALL_POSITION,
  PROVISION_STALL_ROTATION,
  -(PROVISION_STALL_WIDTH / 2 + 0.9),
  0.15,
);

const INN = {
  ...INN_BASE,
  sockets: {
    ...INN_BASE.sockets,
    provisionCounter: {
      id: 'fenbridge_crooked_reed_inn_provision_counter',
      localPosition: null,
      position: PROVISION_STALL_POSITION,
      standingPoint: PROVISION_STALL_VENDOR_POINT,
    },
  },
};

// The chronicler keeps the chapel's archive at the notice board left of the
// door: he stands 1.5 yd off its face (the board is the model's, at the
// chapel's scale; the stride is a person's).
const CHAPEL_BOARD = { x: -4.2, z: -11.8, depth: 0.6 } as const;
const CHAPEL_BOARD_FACE = {
  x: CHAPEL_BOARD.x * CHAPEL_SCALE,
  z: (CHAPEL_BOARD.z - CHAPEL_BOARD.depth / 2) * CHAPEL_SCALE,
} as const;
const CHAPEL_ARCHIVE_POSITION = localToWorld(
  CHAPEL_BASE.placement,
  CHAPEL_BASE.rotation,
  CHAPEL_BOARD_FACE.x,
  CHAPEL_BOARD_FACE.z,
);
const CHAPEL_ARCHIVE_STANDING_POINT = localToWorld(
  CHAPEL_BASE.placement,
  CHAPEL_BASE.rotation,
  CHAPEL_BOARD_FACE.x,
  CHAPEL_BOARD_FACE.z - FRONT_CLEARANCE,
);
const CHAPEL = {
  ...CHAPEL_BASE,
  sockets: {
    ...CHAPEL_BASE.sockets,
    archive: {
      id: 'fenbridge_lantern_chapel_archive',
      localPosition: { x: CHAPEL_BOARD_FACE.x, z: CHAPEL_BOARD_FACE.z },
      position: CHAPEL_ARCHIVE_POSITION,
      standingPoint: CHAPEL_ARCHIVE_STANDING_POINT,
    },
  },
};

// Petra keeps the bank's door: the teller stand is the doorstep.
const BANK = {
  ...BANK_BASE,
  sockets: {
    ...BANK_BASE.sockets,
    teller: {
      ...BANK_BASE.sockets.entrance,
      id: 'fenbridge_gilded_strongbox_teller',
    },
  },
};

const BUILDINGS = [WARDEN_HOUSE, INN, CHAPEL, APOTHECARY, BANK] as const;

const WALL_CONFIG = {
  center: CIVIC_CENTER,
  radius: 31.5,
} as const;

const BASE_WALL_GATES = [
  makeCircularWallGate(
    WALL_CONFIG,
    'fenbridge_gate_south',
    'south_causeway',
    { x: 0, z: 271.5 },
    6,
  ),
  makeCircularWallGate(WALL_CONFIG, 'fenbridge_gate_west', 'west_marsh', { x: 30.5, z: 313 }, 6),
  makeCircularWallGate(WALL_CONFIG, 'fenbridge_gate_east', 'east_marsh', { x: -30.5, z: 314 }, 6),
  makeCircularWallGate(WALL_CONFIG, 'fenbridge_gate_north', 'north_fen', { x: 0, z: 334.5 }, 6),
] as const;

// Fenbridge stands open: no palisade and no gate arches, so the town has
// open ground all round it. The four entrances keep the ring's road
// crossings, so the streets, the scout's post and the muster board meet the
// marsh where they always did; the palisade and gate models stay shipped for
// Studio.
const WALL_GATES = BASE_WALL_GATES;
const WALL_SEGMENTS: readonly CircularWallSegment[] = [];

function gateCrossing(id: string): Point2 {
  const gate = WALL_GATES.find((candidate) => candidate.id === id);
  if (!gate) throw new Error(`missing Fenbridge wall gate ${id}`);
  return gate.crossing;
}

const GATE_RADIAL_APPROACH_DISTANCE = 4;

function gateRadialPoint(id: string, distanceFromCrossing: number): Point2 {
  const crossing = gateCrossing(id);
  const dx = crossing.x - CIVIC_CENTER.x;
  const dz = crossing.z - CIVIC_CENTER.z;
  const distance = Math.hypot(dx, dz);
  return {
    x: crossing.x + (dx / distance) * distanceFromCrossing,
    z: crossing.z + (dz / distance) * distanceFromCrossing,
  };
}

// The crossroads where the marsh street meets the main street, north of the
// cistern.
const CROSSROADS = { x: 0, z: 313.5 } as const;

const ROADS = [
  {
    id: 'south_causeway',
    gateId: 'fenbridge_gate_south',
    halfWidth: 1.5,
    points: [
      { x: 0, z: 80 },
      { x: 0, z: 180 },
      { x: -8, z: 240 },
      gateCrossing('fenbridge_gate_south'),
      { x: 0, z: 298 },
    ],
  },
  {
    id: 'west_marsh',
    gateId: 'fenbridge_gate_west',
    halfWidth: 1.5,
    points: [
      CROSSROADS,
      // bowed a stride north, clear of the inn's gable and chimney
      { x: 14, z: 313.7 },
      gateRadialPoint('fenbridge_gate_west', -GATE_RADIAL_APPROACH_DISTANCE),
      gateCrossing('fenbridge_gate_west'),
      gateRadialPoint('fenbridge_gate_west', GATE_RADIAL_APPROACH_DISTANCE),
      { x: 45, z: 336 },
      { x: 92, z: 350 },
      { x: 102, z: 392 },
      { x: 90, z: 420 },
    ],
  },
  {
    id: 'east_marsh',
    gateId: 'fenbridge_gate_east',
    halfWidth: 1.5,
    points: [
      CROSSROADS,
      // bowed a stride north, clear of the chapel's eaves
      { x: -14, z: 313.8 },
      gateRadialPoint('fenbridge_gate_east', -GATE_RADIAL_APPROACH_DISTANCE),
      gateCrossing('fenbridge_gate_east'),
      gateRadialPoint('fenbridge_gate_east', GATE_RADIAL_APPROACH_DISTANCE),
      { x: -40, z: 370 },
      { x: -80, z: 420 },
    ],
  },
  {
    id: 'north_fen',
    gateId: 'fenbridge_gate_north',
    halfWidth: 1.5,
    points: [
      { x: 0, z: 307.5 },
      gateCrossing('fenbridge_gate_north'),
      { x: 10, z: 400 },
      { x: 20, z: 470 },
      { x: 45, z: 515 },
    ],
  },
] as const;

/**
 * Ground-seated boardwalk modules (long axis = local X, joins at ±2).
 * Continuous runs down the main street: from the south entrance to the
 * cistern, and from the crossroads to the north entrance.
 */
function boardwalkModulesAlong(
  points: readonly Point2[],
  moduleLength = 4,
): Array<{ x: number; z: number; rotation: number }> {
  const modules: Array<{ x: number; z: number; rotation: number }> = [];
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    if (!(length > 0)) continue;
    const count = Math.max(1, Math.round(length / moduleLength));
    // Align local +X (module length) with the path direction.
    const rotation = Math.atan2(-(end.z - start.z), end.x - start.x);
    for (let step = 0; step < count; step++) {
      const progress = (step + 0.5) / count;
      modules.push({
        x: start.x + (end.x - start.x) * progress,
        z: start.z + (end.z - start.z) * progress,
        rotation,
      });
    }
  }
  return modules;
}

const BOARDWALK_PATHS: readonly (readonly Point2[])[] = [
  // South entrance -> cistern (6 modules along the causeway).
  [
    { x: 0, z: 274 },
    { x: 0, z: 298 },
  ],
  // Crossroads -> north entrance (4 modules up the north street).
  [
    { x: 0, z: 316 },
    { x: 0, z: 332 },
  ],
];

const BOARDWALKS = BOARDWALK_PATHS.flatMap((path) => boardwalkModulesAlong(path)).map(
  (placement, index) => ({
    id: `fenbridge_boardwalk_${String(index).padStart(2, '0')}`,
    assetId: '/models/props/fenbridge_boardwalk.glb',
    position: { x: placement.x, z: placement.z },
    rotation: placement.rotation,
    nativeDimensions: { width: 4, height: 0.15, depth: 1.4 },
    blocking: false,
  }),
);

const MUSTER_ORDERS = [
  { id: 'fenbridge_muster_order_west', position: { x: -3.75, z: 274.8 } },
  { id: 'fenbridge_muster_order_east', position: { x: 3.75, z: 274.8 } },
].map((order) => ({
  ...order,
  assetId: '/models/quest/fenbridge_muster_order.glb',
  itemId: 'fen_muster_order',
  blocking: false,
}));

// Tanner Hesk works an open yard in the north-east corner, behind the bank's
// back toward the east entrance: his tanning rack, barrel and crate stand
// round the station point (sim/town_props.ts STATION_PROP_CLUSTERS), and he
// keeps his place 2 yd off it (the cluster notes' tannery stand). The grand
// bank's back wall stands where the tanner used to, so the yard stepped six
// yards east and north, past the old ring line rather than on it.
const TANNERY_STATION_POSITION = { x: -26, z: 327 } as const;
const TANNER_POSITION = {
  x: TANNERY_STATION_POSITION.x + 2,
  z: TANNERY_STATION_POSITION.z + 1.5,
} as const;

const STATIONS = [
  {
    id: 'station_fenbridge_tannery',
    type: 'tannery',
    masterNpcId: 'tanner_hesk',
    position: TANNERY_STATION_POSITION,
    interactionRadius: 20,
  },
] as const;

function makeNpc(id: string, position: Point2, facing: number, anchorId: string) {
  return { id, position, facing, anchorId, bodyRadius: 0.6 };
}

// Scout Maren keeps the north entrance, looking down the north street into
// town. The grand bank's stall counter stands on her old spot, so she steps
// a stride and a half out to the street's edge, between the counter and the
// boardwalk: still inside the hub circle, where a quest giver must stand for
// her errands to count as the town's own (sim/town_quests.ts).
const SCOUT_POSITION = { x: -1.4, z: 330 } as const;
const NPCS = [
  // The warden greets arrivals at his own door, by the south entrance.
  makeNpc(
    'warden_fenwick',
    WARDEN_HOUSE.frontStandingPoint,
    WARDEN_HOUSE.frontFacing,
    WARDEN_HOUSE.id,
  ),
  makeNpc('brother_aldric_fen', CHAPEL.frontStandingPoint, CHAPEL.frontFacing, CHAPEL.id),
  // Eastbrook merchant: stand at the counter's end, face with the stall.
  makeNpc(
    'provisioner_hale',
    PROVISION_STALL_VENDOR_POINT,
    PROVISION_STALL_ROTATION,
    'fenbridge_provision_stall',
  ),
  makeNpc('herbalist_yara', APOTHECARY.frontStandingPoint, APOTHECARY.frontFacing, APOTHECARY.id),
  makeNpc(
    'scout_maren',
    SCOUT_POSITION,
    facingToward(SCOUT_POSITION, CROSSROADS),
    'fenbridge_gate_north',
  ),
  // Eastbrook bursar: the bank's doorstep, facing the street.
  makeNpc(
    'bursar_petra_vell',
    BANK.sockets.teller.standingPoint,
    BANK.frontFacing,
    BANK.sockets.teller.id,
  ),
  makeNpc(
    'chronicler_osric_fenn',
    CHAPEL_ARCHIVE_STANDING_POINT,
    CHAPEL.frontFacing,
    'fenbridge_lantern_chapel_archive',
  ),
  // Faces the crossroads from his yard, the station beside him.
  makeNpc(
    'tanner_hesk',
    TANNER_POSITION,
    facingToward(TANNER_POSITION, CROSSROADS),
    'station_fenbridge_tannery',
  ),
  // The farmer (the farming go-live): outside the hub circle on the town
  // side of the patch_mirefen raised beds (content/farm_patches.ts, beds at
  // z 339 and 344), facing north across them (facing 0 looks along +z).
  // Anchored to the patch rather than a building: nothing is built there.
  makeNpc('farmer_teasel', { x: -21, z: 333.5 }, 0, 'patch_mirefen'),
] as const;

const PRESERVED_PROPS = {
  mines: [],
  docks: [{ x: -66, z: 305, rot: 1.68, hutLocal: { x: 2.8, z: 2.4, hw: 1.7, hd: 1.5 } }],
  tents: [
    { x: 12, z: 474, rot: 0.5, scale: 1 },
    { x: 20, z: 466, rot: 2.1, scale: 1 },
    { x: -22, z: 486, rot: 1.2, scale: 1 },
    { x: -28, z: 494, rot: -0.7, scale: 1 },
    { x: -3, z: 505, rot: 2.9, scale: 1.3 },
  ],
  marshReeds: [
    [-82, 334],
    [-85, 337],
    [-97, 344],
    [-112, 338],
    [-74, 316],
    [-77, 295],
    [-96, 287],
    [-110, 274],
    [-123, 274],
  ],
  crates: [
    [14, 468],
    [18, 471],
    [-23, 491],
    [2, 504],
  ],
  campfires: [
    [16, 470],
    [-25, 489],
    [0, 506],
  ],
  mudHuts: [
    [-78, 269],
    [-83, 266],
    [-74, 275],
    [-117, 346],
    [-123, 354],
  ],
  ruinRings: [{ x: 100, z: 435, ringR: 7, columns: 7 }],
} as const;

// The town's post pillar stands at the inn's north corner on the crossroads.
const MAILBOX_POSITION = { x: 3.2, z: 310.2 } as const;

/**
 * Level pads under the grand buildings (terrain edits the built-in world,
 * sim/data.ts, and the Studio rebuild map both stamp; no other stamp reaches
 * the town's ground, so their place in either list moves no height). The town
 * stands on the marsh hub's plateau (world.ts: level at the marsh hub height
 * out to seven tenths of the hub radius, eased back into the fen beyond), and
 * the grand buildings reach past its level ground: each one stands on a pad
 * at the plateau's height across its whole reach, a row of stamps along its
 * long axis rather than one circle, so the level ground hugs its walls. Every
 * building first lays a wide, soft apron at that height, before any pad, so
 * the fen eases up to it at a walkable grade; the pads, applied after every
 * apron, then level each reach exactly (the Highwatch recipe,
 * sim/highwatch_layout.ts).
 */
const TOWN_GROUND_HEIGHT = 1.2;

function padsAlong(
  building: (typeof BUILDINGS)[number],
  columns: number,
  rows: number,
  taper: number,
) {
  const reach = building.reach;
  const cellWidth = (reach.halfWidth * 2) / columns;
  const cellDepth = (reach.halfDepth * 2) / rows;
  const core = Math.hypot(cellWidth / 2, cellDepth / 2);
  const radius = core + taper;
  const pads: { x: number; z: number; radius: number; delta: number; hardness: number }[] = [];
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      const center = localToWorld(
        reach.center,
        reach.rotation,
        -reach.halfWidth + cellWidth * (column + 0.5),
        -reach.halfDepth + cellDepth * (row + 0.5),
      );
      pads.push({
        x: center.x,
        z: center.z,
        radius,
        delta: TOWN_GROUND_HEIGHT,
        hardness: core / radius,
      });
    }
  }
  return pads;
}

// Each building's stamp grid (`columns` along its width, `rows` along its
// depth), its pad's short taper and its apron's soft reach.
const GROUND = [
  { building: WARDEN_HOUSE, columns: 2, rows: 2, taper: 4, apron: 10 },
  { building: INN, columns: 3, rows: 2, taper: 4, apron: 10 },
  { building: CHAPEL, columns: 2, rows: 3, taper: 4, apron: 10 },
  { building: APOTHECARY, columns: 2, rows: 2, taper: 4, apron: 10 },
  { building: BANK, columns: 2, rows: 2, taper: 4, apron: 10 },
] as const;

const PADS = [
  ...GROUND.flatMap((g) => padsAlong(g.building, g.columns, g.rows, g.apron)),
  ...GROUND.flatMap((g) => padsAlong(g.building, g.columns, g.rows, g.taper)),
].map((pad) => ({ ...pad, falloff: 'smooth' as const, mode: 'level' as const }));

export const FENBRIDGE_LAYOUT = deepFreeze({
  id: 'fenbridge_rebuild_v1',
  zoneId: 'mirefen_marsh',
  hub: { center: { x: 0, z: 300 }, radius: 34 },
  buildings: BUILDINGS,
  civic: {
    center: CIVIC_CENTER,
    crossroads: CROSSROADS,
    ring: { radius: 4.5, pathHalfWidth: 1.5 },
    cistern: {
      id: 'fenbridge_mirelight_cistern',
      assetId: '/models/props/fenbridge_mirelight_cistern.glb',
      position: CIVIC_CENTER,
      radius: 1.8,
      height: 2.6,
      nativeDimensions: { width: 3.6, height: 2.6, depth: 3.6 },
    },
    provisionStall: {
      id: 'fenbridge_provision_stall',
      assetId: '/models/props/fenbridge_provision_stall.glb',
      position: PROVISION_STALL_POSITION,
      rotation: PROVISION_STALL_ROTATION,
      width: PROVISION_STALL_WIDTH,
      depth: PROVISION_STALL_DEPTH,
      height: 2.8,
      footprint: {
        id: 'fenbridge_provision_stall',
        center: PROVISION_STALL_POSITION,
        halfWidth: PROVISION_STALL_WIDTH / 2,
        halfDepth: PROVISION_STALL_DEPTH / 2,
        rotation: PROVISION_STALL_ROTATION,
      },
      customerStandingPoint: localToWorld(
        PROVISION_STALL_POSITION,
        PROVISION_STALL_ROTATION,
        0,
        PROVISION_STALL_DEPTH / 2 + 0.9,
      ),
      vendorStandingPoint: PROVISION_STALL_VENDOR_POINT,
    },
    musterBoard: {
      id: 'fenbridge_muster_board',
      assetId: '/models/props/fenbridge_muster_board.glb',
      position: MUSTER_BOARD_POSITION,
      rotation: MUSTER_BOARD_ROTATION,
      nativeDimensions: { width: 2.4, height: 2.6, depth: 0.6 },
      footprint: {
        id: 'fenbridge_muster_board',
        center: MUSTER_BOARD_POSITION,
        halfWidth: 1.2,
        halfDepth: 0.3,
        rotation: MUSTER_BOARD_ROTATION,
      },
      frontStandingPoint: localToWorld(MUSTER_BOARD_POSITION, MUSTER_BOARD_ROTATION, 0, 1.4),
    },
  },
  wall: {
    ...WALL_CONFIG,
    gates: WALL_GATES,
    segments: WALL_SEGMENTS,
  },
  roads: ROADS,
  pads: PADS,
  repeated: {
    boardwalks: BOARDWALKS,
    musterOrders: MUSTER_ORDERS,
  },
  services: {
    bank: {
      id: 'fenbridge_bank_service',
      buildingId: BANK.id,
      npcId: 'bursar_petra_vell',
      entrance: BANK.sockets.entrance,
      teller: BANK.sockets.teller,
    },
    mailbox: {
      id: 'mailbox_fenbridge',
      templateId: 'mailbox',
      assetId: '/models/props/mailbox_pillar.glb',
      position: MAILBOX_POSITION,
      bodyRadius: 0.8,
      interactionRadius: 7,
      // on the main street, east of the pillar
      frontStandingPoint: { x: MAILBOX_POSITION.x - 2, z: MAILBOX_POSITION.z },
    },
    graveyard: {
      id: 'gy_fenbridge',
      name: 'Fenbridge Barrow',
      position: { x: -18, z: 286 },
      healerTemplateId: 'spirit_healer',
      healerFacing: Math.PI,
    },
    rest: { id: 'fenbridge_inn_rest', buildingId: INN.id },
    stations: STATIONS,
    npcs: NPCS,
  },
  preservedProps: PRESERVED_PROPS,
} as const);

function indexById<T extends { id: string }>(records: readonly T[]): Readonly<Record<string, T>> {
  return deepFreeze(Object.fromEntries(records.map((record) => [record.id, record])));
}

/** Derived keyed views retain the exact frozen records owned by FENBRIDGE_LAYOUT. */
export const FENBRIDGE_BUILDINGS_BY_ID = indexById(FENBRIDGE_LAYOUT.buildings);
export const FENBRIDGE_NPC_PLACEMENTS_BY_ID = indexById(FENBRIDGE_LAYOUT.services.npcs);
export const FENBRIDGE_STATIONS_BY_ID = indexById(FENBRIDGE_LAYOUT.services.stations);
