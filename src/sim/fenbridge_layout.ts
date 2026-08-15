// Canonical Fenbridge rebuild layout. This is a pure, frozen data/geometry
// module shared by simulation content, collision, rendering, and acceptance
// capture. Keep engine imports, randomness, clocks, and mutable runtime state
// out of this file.

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

interface CircularWallConfig {
  idPrefix: string;
  assetId: string;
  center: Point2;
  radius: number;
  thickness: number;
  height: number;
  maximumSegmentSpan: number;
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

export function segmentToObb(id: string, start: Point2, end: Point2, width: number): Obb2 {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  return {
    id,
    center: { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 },
    halfWidth: Math.hypot(dx, dz) / 2,
    halfDepth: width / 2,
    rotation: Math.atan2(-dz, dx),
  };
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

function generateCircularWallSegments(
  config: CircularWallConfig,
  gates: readonly CircularWallGate[],
): CircularWallSegment[] {
  const sorted = [...gates].sort((left, right) => left.angle - right.angle);
  const segments: CircularWallSegment[] = [];
  for (let gateIndex = 0; gateIndex < sorted.length; gateIndex++) {
    const gate = sorted[gateIndex];
    const next = sorted[(gateIndex + 1) % sorted.length];
    const startAngle = gate.endAngle;
    let endAngle = next.startAngle;
    if (endAngle <= startAngle) endAngle += TAU;
    const intervalArcLength = (endAngle - startAngle) * config.radius;
    const count = Math.max(1, Math.ceil(intervalArcLength / config.maximumSegmentSpan));
    for (let intervalIndex = 0; intervalIndex < count; intervalIndex++) {
      const segmentStartAngle = startAngle + ((endAngle - startAngle) * intervalIndex) / count;
      const segmentEndAngle = startAngle + ((endAngle - startAngle) * (intervalIndex + 1)) / count;
      const start = pointOnCircle(config.center, config.radius, segmentStartAngle);
      const end = pointOnCircle(config.center, config.radius, segmentEndAngle);
      const id = `${config.idPrefix}_${String(segments.length).padStart(2, '0')}`;
      segments.push({
        id,
        assetId: config.assetId,
        startAngle: segmentStartAngle,
        endAngle: segmentEndAngle,
        start,
        end,
        arcLength: (segmentEndAngle - segmentStartAngle) * config.radius,
        chordLength: Math.hypot(end.x - start.x, end.z - start.z),
        height: config.height,
        footprint: segmentToObb(id, start, end, config.thickness),
      });
    }
  }
  return segments;
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

function makeBuilding(
  id: string,
  assetId: string,
  kind: 'house' | 'inn' | 'chapel',
  position: Point2,
  width: number,
  height: number,
  depth: number,
  rotation: number,
  entranceLocalX = 0,
) {
  const frontSocket = localToWorld(position, rotation, entranceLocalX, depth / 2);
  const frontStandingPoint = localToWorld(
    position,
    rotation,
    entranceLocalX,
    depth / 2 + FRONT_CLEARANCE,
  );
  return {
    id,
    assetId,
    kind,
    position,
    nativeDimensions: { width, height, depth },
    rotation,
    footprint: {
      id,
      center: position,
      halfWidth: width / 2,
      halfDepth: depth / 2,
      rotation,
    },
    maxCornerRadius: Math.hypot(width / 2, depth / 2),
    frontClearance: FRONT_CLEARANCE,
    frontStandingPoint,
    sockets: {
      entrance: {
        id: `${id}_entrance`,
        localPosition: { x: entranceLocalX, z: depth / 2 },
        position: frontSocket,
        standingPoint: frontStandingPoint,
      },
    },
  };
}

// Canonical site plan (master-plan.md). Every lot faces the cistern so the
// building front (+Z) and Eastbrook-style greeter facing open onto the square.
// Rotations are facingToward(lot, CIVIC_CENTER), then literal-pinned by tests.
const GATEHOUSE = makeBuilding(
  'fenbridge_warden_gatehouse',
  '/models/props/fenbridge_warden_gatehouse.glb',
  'house',
  { x: 9, z: 282 },
  7.8,
  10.5,
  7,
  facingToward({ x: 9, z: 282 }, CIVIC_CENTER),
);
const INN_BASE = makeBuilding(
  'fenbridge_crooked_reed_inn',
  '/models/props/fenbridge_crooked_reed_inn.glb',
  'inn',
  // Back-west ring: clear of the east-marsh road and the west gate path.
  { x: -21.25, z: 317 },
  9,
  8.8,
  8,
  facingToward({ x: -21.25, z: 317 }, CIVIC_CENTER),
  -2.8,
);
const CHAPEL_BASE = makeBuilding(
  'fenbridge_lantern_chapel',
  '/models/props/fenbridge_lantern_chapel.glb',
  'chapel',
  { x: -19.5, z: 294 },
  7,
  8.6,
  7,
  facingToward({ x: -19.5, z: 294 }, CIVIC_CENTER),
);
const APOTHECARY = makeBuilding(
  'fenbridge_moonwort_apothecary',
  '/models/props/fenbridge_moonwort_apothecary.glb',
  'house',
  { x: 17.8, z: 291.5 },
  7,
  7.2,
  6,
  facingToward({ x: 17.8, z: 291.5 }, CIVIC_CENTER),
);
const BANK_BASE = makeBuilding(
  'fenbridge_gilded_strongbox',
  '/models/props/fenbridge_gilded_strongbox.glb',
  'house',
  { x: 19.2, z: 309.5 },
  7.5,
  7.4,
  6.5,
  facingToward({ x: 19.2, z: 309.5 }, CIVIC_CENTER),
  // Matches the GLB front-entry socket local x = 1.75.
  1.75,
);
const TANNERY_BASE = makeBuilding(
  'fenbridge_hesk_tannery',
  '/models/props/fenbridge_hesk_tannery.glb',
  'house',
  // North ring, west of the north road so the gate stay open.
  { x: -2, z: 320 },
  12,
  7.2,
  7,
  facingToward({ x: -2, z: 320 }, CIVIC_CENTER),
);
const SCOUT_LODGE = makeBuilding(
  'fenbridge_scout_lodge',
  '/models/props/fenbridge_scout_lodge.glb',
  'house',
  // West of the north exit (smaller footprint than the tannery).
  { x: -13.5, z: 325.5 },
  8,
  7.6,
  6.5,
  facingToward({ x: -13.5, z: 325.5 }, CIVIC_CENTER),
);

// Market stall on the inn front apron (NW of the cistern, clear of chapel greeters).
const PROVISION_STALL_POSITION = { x: -14, z: 313 } as const;
const PROVISION_STALL_ROTATION = facingToward(PROVISION_STALL_POSITION, CIVIC_CENTER);
const PROVISION_STALL_WIDTH = 3.2;
const PROVISION_STALL_DEPTH = 1.6;
// Inner south-gate apron, board facing the square (readable on approach).
const MUSTER_BOARD_POSITION = { x: -6, z: 278 } as const;
const MUSTER_BOARD_ROTATION = facingToward(MUSTER_BOARD_POSITION, CIVIC_CENTER);
// Stand to the vendor's left of the counter, clear of the stall OBB so
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
      localPosition: { x: 0, z: INN_BASE.nativeDimensions.depth / 2 },
      position: PROVISION_STALL_POSITION,
      standingPoint: PROVISION_STALL_VENDOR_POINT,
    },
  },
};

// Archive apron: left of the door on the clear front (not pressed into the wall).
const CHAPEL_ARCHIVE_STANDING_POINT = localToWorld(
  CHAPEL_BASE.position,
  CHAPEL_BASE.rotation,
  -2.4,
  CHAPEL_BASE.nativeDimensions.depth / 2 + FRONT_CLEARANCE,
);
const CHAPEL = {
  ...CHAPEL_BASE,
  sockets: {
    ...CHAPEL_BASE.sockets,
    archive: {
      id: 'fenbridge_lantern_chapel_archive',
      localPosition: { x: -2.4, z: CHAPEL_BASE.nativeDimensions.depth / 2 },
      position: localToWorld(
        CHAPEL_BASE.position,
        CHAPEL_BASE.rotation,
        -2.4,
        CHAPEL_BASE.nativeDimensions.depth / 2,
      ),
      standingPoint: CHAPEL_ARCHIVE_STANDING_POINT,
    },
  },
};

// Teller counter on the bank face; Petra stands on the apron in front of it
// (Eastbrook bursar style: front apron + building rotation into the square).
const BANK_TELLER_LOCAL_X = -1.25;
const BANK_TELLER_POSITION = localToWorld(
  BANK_BASE.position,
  BANK_BASE.rotation,
  BANK_TELLER_LOCAL_X,
  BANK_BASE.nativeDimensions.depth / 2,
);
const BANK_TELLER_STANDING_POINT = localToWorld(
  BANK_BASE.position,
  BANK_BASE.rotation,
  BANK_TELLER_LOCAL_X,
  BANK_BASE.nativeDimensions.depth / 2 + FRONT_CLEARANCE,
);
const BANK = {
  ...BANK_BASE,
  // Pathfinding apron: teller bay is clear; the door-bay stand collides with
  // the west-road sample at 1.5 yd. Socket local x stays 1.75 for GLB parity.
  frontStandingPoint: BANK_TELLER_STANDING_POINT,
  sockets: {
    ...BANK_BASE.sockets,
    entrance: {
      ...BANK_BASE.sockets.entrance,
      // Keep localPosition from makeBuilding (1.75); only the world stand moves.
      standingPoint: BANK_TELLER_STANDING_POINT,
    },
    teller: {
      id: 'fenbridge_gilded_strongbox_teller',
      localPosition: {
        x: BANK_TELLER_LOCAL_X,
        z: BANK_BASE.nativeDimensions.depth / 2,
      },
      position: BANK_TELLER_POSITION,
      standingPoint: BANK_TELLER_STANDING_POINT,
    },
  },
};

// Profession station on the open craft bay apron (outside the OBB so body 0.8
// pathfinding can stand on it). Master stands 1 to 3 yd from the station.
const TANNERY_STATION_POSITION = localToWorld(
  TANNERY_BASE.position,
  TANNERY_BASE.rotation,
  -2.5,
  TANNERY_BASE.nativeDimensions.depth / 2 + 1.5,
);
const TANNER_POSITION = localToWorld(
  TANNERY_BASE.position,
  TANNERY_BASE.rotation,
  -4.5,
  TANNERY_BASE.nativeDimensions.depth / 2 + 1.5,
);
const TANNERY = {
  ...TANNERY_BASE,
  sockets: {
    ...TANNERY_BASE.sockets,
    station: {
      id: 'fenbridge_hesk_tannery_station',
      localPosition: null,
      position: TANNERY_STATION_POSITION,
      standingPoint: TANNERY_STATION_POSITION,
    },
  },
};

const BUILDINGS = [GATEHOUSE, INN, CHAPEL, APOTHECARY, BANK, TANNERY, SCOUT_LODGE] as const;

const WALL_CONFIG = {
  idPrefix: 'fenbridge_palisade_wing',
  assetId: '/models/props/fenbridge_palisade_wing.glb',
  center: CIVIC_CENTER,
  radius: 31.5,
  thickness: 0.75,
  height: 3.4,
  maximumSegmentSpan: 12,
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

function addGateArch(gate: CircularWallGate) {
  const rotation = facingToward(gate.crossing, CIVIC_CENTER);
  const jambOffset = gate.width / 2 + 0.3;
  return {
    ...gate,
    arch: {
      id: `${gate.id}_arch`,
      assetId: '/models/props/fenbridge_gate_arch.glb',
      position: gate.crossing,
      rotation,
      nativeDimensions: { width: 7.2, height: 4.8, depth: 1 },
      openingWidth: gate.width,
      collision: 'jambs_only',
      jambs: [
        {
          ...segmentToObb(
            `${gate.id}_jamb_left`,
            localToWorld(gate.crossing, rotation, -jambOffset, -0.5),
            localToWorld(gate.crossing, rotation, -jambOffset, 0.5),
            0.6,
          ),
        },
        {
          ...segmentToObb(
            `${gate.id}_jamb_right`,
            localToWorld(gate.crossing, rotation, jambOffset, -0.5),
            localToWorld(gate.crossing, rotation, jambOffset, 0.5),
            0.6,
          ),
        },
      ],
    },
  };
}

const WALL_GATES = BASE_WALL_GATES.map(addGateArch);
const WALL_SEGMENTS = generateCircularWallSegments(WALL_CONFIG, WALL_GATES);

export function palisadeSegmentMirrored(segment: CircularWallSegment): boolean {
  return WALL_GATES.some(
    (gate) =>
      Math.abs(gate.end.x - segment.start.x) < 1e-8 &&
      Math.abs(gate.end.z - segment.start.z) < 1e-8,
  );
}

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
      { x: 4.5, z: 303 },
      { x: 7, z: 307 },
      { x: 10, z: 315 },
      { x: 19, z: 318 },
      { x: 26, z: 316 },
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
      { x: -4.5, z: 303 },
      { x: -8, z: 302 },
      { x: -15, z: 305 },
      { x: -22, z: 310 },
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
      { x: 4, z: 313 },
      { x: 9, z: 318 },
      { x: 11, z: 324 },
      // Keep east of the north-ring lots; wood nodes sit outside the wall.
      { x: 7.5, z: 330 },
      gateCrossing('fenbridge_gate_north'),
      { x: 10, z: 400 },
      { x: 20, z: 470 },
      { x: 45, z: 515 },
    ],
  },
] as const;

/**
 * Ground-seated boardwalk modules (long axis = local X, joins at ±2).
 * Continuous paths from the south gate into the square, then short spurs
 * toward the inn/chapel (west) and bank/apothecary (east) aprons.
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
  // South gate -> square (6 modules along the causeway).
  [
    { x: 0, z: 274 },
    { x: 0, z: 298 },
  ],
  // West spur to the inn / chapel approach (3 modules).
  [
    { x: -2, z: 302 },
    { x: -14, z: 308 },
  ],
  // East spur to the bank / apothecary approach (3 modules).
  [
    { x: 2, z: 302 },
    { x: 14, z: 300 },
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

// Eastbrook pattern: greeters on the front apron face with the building
// (into the square). Gate guard faces arrivals; tanner faces the station.
const WARDEN_POSITION = localToWorld(
  GATEHOUSE.position,
  GATEHOUSE.rotation,
  -2.4,
  GATEHOUSE.nativeDimensions.depth / 2 + FRONT_CLEARANCE,
);
// Map lean-to: right front of the scout lodge (north lot, not the tannery).
const SCOUT_MAP_POSITION = localToWorld(
  SCOUT_LODGE.position,
  SCOUT_LODGE.rotation,
  2.2,
  SCOUT_LODGE.nativeDimensions.depth / 2 + FRONT_CLEARANCE,
);
const NPCS = [
  // Face the square like the other greeters (not the south causeway).
  makeNpc('warden_fenwick', WARDEN_POSITION, GATEHOUSE.rotation, GATEHOUSE.id),
  makeNpc('brother_aldric_fen', CHAPEL.frontStandingPoint, CHAPEL.rotation, CHAPEL.id),
  // Eastbrook merchant: stand on the customer face, face with the stall.
  makeNpc(
    'provisioner_hale',
    PROVISION_STALL_VENDOR_POINT,
    PROVISION_STALL_ROTATION,
    'fenbridge_provision_stall',
  ),
  makeNpc('herbalist_yara', APOTHECARY.frontStandingPoint, APOTHECARY.rotation, APOTHECARY.id),
  makeNpc('scout_maren', SCOUT_MAP_POSITION, SCOUT_LODGE.rotation, SCOUT_LODGE.id),
  // Eastbrook bursar: bank front apron, face into the square.
  makeNpc(
    'bursar_petra_vell',
    BANK.sockets.teller.standingPoint,
    BANK.rotation,
    BANK.sockets.teller.id,
  ),
  makeNpc(
    'chronicler_osric_fenn',
    CHAPEL_ARCHIVE_STANDING_POINT,
    CHAPEL.rotation,
    'fenbridge_lantern_chapel_archive',
  ),
  // Face the square with the building (craft station stays on the apron).
  makeNpc('tanner_hesk', TANNER_POSITION, TANNERY.rotation, TANNERY.id),
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

export const FENBRIDGE_LAYOUT = deepFreeze({
  id: 'fenbridge_rebuild_v1',
  zoneId: 'mirefen_marsh',
  hub: { center: { x: 0, z: 300 }, radius: 34 },
  buildings: BUILDINGS,
  civic: {
    center: CIVIC_CENTER,
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
      position: { x: 6, z: 294 },
      bodyRadius: 0.8,
      interactionRadius: 7,
      frontStandingPoint: { x: 6, z: 296 },
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
