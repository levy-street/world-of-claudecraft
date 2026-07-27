export interface Point2 {
  x: number;
  z: number;
}

export interface Circle2 {
  center: Point2;
  radius: number;
}

export interface Obb2 {
  id: string;
  center: Point2;
  halfWidth: number;
  halfDepth: number;
  rotation: number;
}

export interface CircularWallConfig {
  assetId: string;
  center: Point2;
  radius: number;
  thickness: number;
  height: number;
  maximumSegmentSpan: number;
}

export interface CircularWallGate {
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

/** Move from an origin along local +Z for the supplied yaw. */
export function pointAtYaw(origin: Point2, yaw: number, distance: number): Point2 {
  return {
    x: origin.x + Math.sin(yaw) * distance,
    z: origin.z + Math.cos(yaw) * distance,
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

export function circleIntersectsObb(circle: Circle2, obb: Obb2): boolean {
  return distancePointToObb(circle.center, obb) <= circle.radius;
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
  if (!(maximumStep > 0)) return [];
  if (points.length === 0) return [];
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

/** Fill every interval between sorted gates with bounded chord OBBs. */
export function generateCircularWallSegments(
  config: CircularWallConfig,
  gates: readonly CircularWallGate[],
): CircularWallSegment[] {
  if (gates.length === 0) return [];
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
      const id = `eastbrook_wall_${String(segments.length).padStart(2, '0')}`;
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

export const REMOVED_EASTBROOK_PLACEMENTS = deepFreeze({
  buildings: [
    {
      id: 'legacy_eastbrook_house_northeast',
      disposition: 'removed',
      kind: 'house',
      x: 10,
      z: 12,
      width: 7,
      depth: 6,
      rotation: -0.4,
    },
    {
      id: 'legacy_eastbrook_house_northwest',
      disposition: 'removed',
      kind: 'house',
      x: -10,
      z: 10,
      width: 6,
      depth: 5,
      rotation: 0.5,
    },
    {
      id: 'legacy_eastbrook_chapel',
      disposition: 'removed',
      kind: 'chapel',
      x: -16,
      z: -8,
      width: 5,
      depth: 7,
      rotation: 0.9,
    },
  ],
  wells: [
    {
      id: 'legacy_eastbrook_well',
      disposition: 'replaced',
      replacedBy: 'eastbrook_civic_well_beacon',
      x: 0,
      z: 2,
      radius: 1.5,
    },
  ],
  stalls: [
    {
      id: 'legacy_eastbrook_provisioner_stall',
      disposition: 'removed',
      x: -8.5,
      z: 3,
      rotation: Math.PI / 2,
      radius: 1.7,
      smithy: false,
    },
    {
      id: 'legacy_eastbrook_smithy_stall',
      disposition: 'removed',
      x: 9.5,
      z: 17.5,
      rotation: -2.7,
      radius: 1.7,
      smithy: true,
    },
    {
      id: 'legacy_eastbrook_world_market_stall',
      disposition: 'removed',
      x: 0,
      z: 11.5,
      rotation: Math.PI,
      radius: 1.8,
      smithy: false,
    },
    {
      id: 'eastbrook_market_stall_artisans',
      disposition: 'removed_after_live_review',
      x: 3.5,
      z: 11.5,
      rotation: -2.788602,
      width: 2.8,
      depth: 2.2,
      smithy: false,
    },
  ],
  campfires: [{ id: 'legacy_eastbrook_town_fire', disposition: 'removed', x: 3, z: -4 }],
  fences: [
    {
      id: 'legacy_eastbrook_fence_east',
      disposition: 'removed',
      start: { x: 16, z: 16 },
      end: { x: 22, z: 4 },
    },
    {
      id: 'legacy_eastbrook_fence_west',
      disposition: 'removed',
      start: { x: -16, z: 14 },
      end: { x: -20, z: 2 },
    },
  ],
  artisanRow: [
    {
      id: 'engineering_workbench',
      disposition: 'removed',
      assetId: '/models/props/engineering_workbench.glb',
      nativeHeight: 1,
      x: 2,
      z: 20,
      rotation: 0.4,
    },
    {
      id: 'alchemy_cauldron',
      disposition: 'removed',
      assetId: '/models/props/alchemy_cauldron.glb',
      nativeHeight: 0.9,
      x: 5,
      z: 23,
      rotation: -0.6,
    },
    {
      id: 'cooking_spit',
      disposition: 'removed',
      assetId: '/models/props/cooking_spit.glb',
      nativeHeight: 0.85,
      x: 9,
      z: 25,
      rotation: 0,
    },
    {
      id: 'leatherworking_rack',
      disposition: 'removed',
      assetId: '/models/props/leatherworking_rack.glb',
      nativeHeight: 1.5,
      x: 13,
      z: 24,
      rotation: 0.9,
    },
    {
      id: 'tailoring_loom',
      disposition: 'removed',
      assetId: '/models/props/tailoring_loom.glb',
      nativeHeight: 1.3,
      x: 13.5,
      z: 20.5,
      rotation: 1.6,
    },
    {
      id: 'inscription_lectern',
      disposition: 'removed',
      assetId: '/models/props/inscription_lectern.glb',
      nativeHeight: 1.1,
      x: 19.5,
      z: 14.5,
      rotation: 2.4,
    },
    {
      id: 'enchanting_altar',
      disposition: 'removed',
      assetId: '/models/props/enchanting_altar.glb',
      nativeHeight: 1,
      x: 16,
      z: 13,
      rotation: -2.6,
    },
    {
      id: 'jewelcrafting_bench',
      disposition: 'removed',
      assetId: '/models/props/jewelcrafting_bench.glb',
      nativeHeight: 0.9,
      x: 15,
      z: 9,
      rotation: -1.8,
    },
    {
      id: 'mining_ore_cart',
      disposition: 'removed',
      assetId: '/models/props/mining_ore_cart.glb',
      nativeHeight: 1.1,
      x: 3,
      z: 12,
      rotation: -0.9,
    },
    {
      id: 'herbalism_drying_rack',
      disposition: 'removed',
      assetId: '/models/props/herbalism_drying_rack.glb',
      nativeHeight: 1.4,
      x: 1,
      z: 16,
      rotation: 0.3,
    },
  ],
  npcPlacements: [
    { id: 'the_merchant', disposition: 'relocated', position: { x: 0, z: 9.5 }, facing: Math.PI },
    { id: 'marshal_redbrook', disposition: 'relocated', position: { x: 4, z: 6 }, facing: Math.PI },
    {
      id: 'trader_wilkes',
      disposition: 'relocated',
      position: { x: -7, z: 3 },
      facing: Math.PI / 2,
    },
    {
      id: 'apothecary_lin',
      disposition: 'relocated',
      position: { x: 11, z: -3 },
      facing: -Math.PI / 2,
    },
    { id: 'brother_aldric', disposition: 'relocated', position: { x: -14, z: -10 }, facing: 0.8 },
    { id: 'smith_haldren', disposition: 'relocated', position: { x: 7, z: 16.5 }, facing: -2.7 },
    { id: 'fisherman_brandt', disposition: 'relocated', position: { x: -16, z: 6 }, facing: -0.75 },
    { id: 'foreman_odell', disposition: 'relocated', position: { x: -4, z: -14 }, facing: -2.14 },
    {
      id: 'bursar_fernando',
      disposition: 'relocated',
      position: { x: 13, z: 8 },
      facing: -Math.PI / 2,
    },
    {
      id: 'card_master',
      disposition: 'relocated',
      position: { x: 13, z: 2 },
      facing: -Math.PI / 2,
    },
    { id: 'chronicler_saul', disposition: 'relocated', position: { x: 15, z: -16 }, facing: 2.4 },
    {
      id: 'fury',
      disposition: 'relocated',
      position: { x: -11, z: 1 },
      facing: Math.PI / 2,
    },
    {
      id: 'forgemistress_darva',
      disposition: 'relocated',
      position: { x: 5, z: 15 },
      facing: -2.4,
    },
    {
      id: 'cook_marlow',
      disposition: 'relocated',
      position: { x: -12.5, z: 3 },
      facing: Math.PI / 2,
    },
    { id: 'weaver_ottilie', disposition: 'relocated', position: { x: -4, z: -9 }, facing: 0.8 },
    { id: 'tinker_gizzel', disposition: 'relocated', position: { x: 9.5, z: -14 }, facing: -0.8 },
  ],
  stationDecorativeClusters: [
    {
      id: 'station_eastbrook_forge',
      disposition: 'relocated',
      type: 'forge',
      position: { x: 7, z: 16.5 },
    },
    {
      id: 'station_eastbrook_kitchens',
      disposition: 'relocated',
      type: 'kitchens',
      position: { x: -11, z: 4.5 },
    },
    {
      id: 'station_eastbrook_loom',
      disposition: 'relocated',
      type: 'loom',
      position: { x: -2, z: -8 },
    },
    {
      id: 'station_eastbrook_toolworks',
      disposition: 'relocated',
      type: 'toolworks',
      position: { x: 11, z: -12 },
    },
  ],
} as const);

const CIVIC_CENTER = { x: 0, z: 2 } as const;
// Keep the feature visually central while leaving the default spawn's east-side
// lane through the square clear for player and pet bodies. The old exact-center
// placement made x=2 a tangent for the player and an overlap for larger movers.
const CIVIC_FEATURE_CENTER = { x: -0.75, z: 2 } as const;
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
  frontClearance = FRONT_CLEARANCE,
) {
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
    frontClearance,
    frontStandingPoint: localToWorld(position, rotation, 0, depth / 2 + frontClearance),
  };
}

const PRESERVED_ARMOURY = {
  id: 'eastbrook_grand_armoury',
  assetId: '/models/props/eastbrook_grand_armoury.glb',
  landmark: 'eastbrook_grand_armoury',
  kind: 'house',
  position: { x: 17.5, z: -5.5 },
  nativeDimensions: { width: 13, height: 16.35, depth: 9 },
  aboveGradeHeight: 15,
  foundationDepth: 1.35,
  rotation: -Math.PI / 2,
  footprint: {
    id: 'eastbrook_grand_armoury',
    center: { x: 17.5, z: -5.5 },
    halfWidth: 6.5,
    halfDepth: 4.5,
    rotation: -Math.PI / 2,
  },
  maxCornerRadius: Math.hypot(6.5, 4.5),
  frontStandingPoint: { x: 12, z: -5.5 },
} as const;

const BUILDINGS = [
  makeBuilding(
    'eastbrook_bank',
    '/models/props/eastbrook_bank.glb',
    'house',
    { x: 18, z: 10.5 },
    7,
    7.8,
    5.5,
    Math.atan2(-18, -8.5),
  ),
  makeBuilding(
    'eastbrook_smithy',
    '/models/props/eastbrook_smithy.glb',
    'house',
    { x: 4.8, z: 19.7 },
    7,
    7.5,
    5.5,
    -2.876775,
  ),
  makeBuilding(
    'eastbrook_inn',
    '/models/props/eastbrook_inn.glb',
    'inn',
    { x: -12.5, z: 16.5 },
    7.5,
    8.5,
    6,
    Math.atan2(12.5, -14.5),
    0.8,
  ),
  makeBuilding(
    'eastbrook_chapel',
    '/models/props/eastbrook_chapel.glb',
    'chapel',
    { x: -21, z: -2.3 },
    5.5,
    7,
    6,
    1.368826,
  ),
  makeBuilding(
    'eastbrook_weaving_workshop',
    '/models/props/eastbrook_weaving_workshop.glb',
    'house',
    { x: -7.2, z: -21 },
    5.5,
    5.8,
    4.5,
    0.30338,
  ),
  makeBuilding(
    'eastbrook_toolworks',
    '/models/props/eastbrook_toolworks.glb',
    'house',
    // Keep the long-established (2,-21) deterministic combat/open-field seam
    // and the southeast gate road clear while still moving the workshop
    // outward from its rebuild-v1 lot.
    { x: 6.2, z: -18 },
    5.5,
    5.8,
    4.5,
    -0.3006056700423954,
  ),
] as const;

function buildingById(id: string) {
  const building = BUILDINGS.find((candidate) => candidate.id === id);
  if (!building) throw new Error(`missing Eastbrook building ${id}`);
  return building;
}

function makeObbPlacement(
  id: string,
  assetId: string,
  position: Point2,
  width: number,
  depth: number,
  rotation: number,
) {
  return {
    id,
    assetId,
    position,
    width,
    depth,
    rotation,
    footprint: {
      id,
      center: position,
      halfWidth: width / 2,
      halfDepth: depth / 2,
      rotation,
    },
  };
}

// Three cardinal benches occupy the quiet sides of the civic ring. The east
// quadrant deliberately remains open as the spawn-to-square arrival lane.
const BENCHES = [
  makeObbPlacement(
    'eastbrook_civic_bench_north',
    '/models/dungeon/bench.glb',
    { x: 0, z: 4.9 },
    1.8,
    0.6,
    Math.PI,
  ),
  makeObbPlacement(
    'eastbrook_civic_bench_south',
    '/models/dungeon/bench.glb',
    { x: 0, z: -0.9 },
    1.8,
    0.6,
    0,
  ),
  makeObbPlacement(
    'eastbrook_civic_bench_west',
    '/models/dungeon/bench.glb',
    { x: -2.9, z: 2 },
    1.8,
    0.6,
    Math.PI / 2,
  ),
];

const MARKET_STALL_SPECS = [
  ['eastbrook_market_stall_world_market', 'gold', { x: -5.5, z: 9.5 }, 2.508844],
  ['eastbrook_market_stall_provisions', 'green', { x: -9, z: 0.5 }, 1.405648],
] as const;
const MARKET_STALLS = MARKET_STALL_SPECS.map(([id, canopyVariant, position, rotation]) => {
  const base = makeObbPlacement(
    id,
    '/models/props/eastbrook_market_stall.glb',
    position,
    2.8,
    2.2,
    rotation,
  );
  return {
    ...base,
    canopyVariant,
    radiusFromCivic: Math.hypot(position.x - CIVIC_CENTER.x, position.z - CIVIC_CENTER.z),
    height: 2.7,
    frontStandingPoint: localToWorld(position, rotation, 0, 1.6),
  };
});

function makeFence(
  id: string,
  district: 'smithy_yard' | 'market_edge',
  start: Point2,
  end: Point2,
  width: number,
  height: number,
) {
  return {
    id,
    assetId: '/models/props/fence.glb',
    district,
    start,
    end,
    width,
    height,
    footprint: segmentToObb(id, start, end, width),
  };
}

const SMITHY = buildingById('eastbrook_smithy');
const OUTER_MARKET_STALL = MARKET_STALLS[1];
const FENCES = [
  makeFence(
    'eastbrook_fence_smithy_west',
    'smithy_yard',
    localToWorld(SMITHY.position, SMITHY.rotation, -4.5, -4.9),
    localToWorld(SMITHY.position, SMITHY.rotation, -4.5, -3.2),
    0.28,
    0.9,
  ),
  makeFence(
    'eastbrook_fence_smithy_outer',
    'smithy_yard',
    localToWorld(SMITHY.position, SMITHY.rotation, -4.2, -5.2),
    localToWorld(SMITHY.position, SMITHY.rotation, 4.2, -5.2),
    0.28,
    0.9,
  ),
  makeFence(
    'eastbrook_fence_smithy_east',
    'smithy_yard',
    localToWorld(SMITHY.position, SMITHY.rotation, 4.5, -4.9),
    localToWorld(SMITHY.position, SMITHY.rotation, 4.5, -3.2),
    0.28,
    0.9,
  ),
  makeFence(
    'eastbrook_fence_market_outer',
    'market_edge',
    localToWorld(OUTER_MARKET_STALL.position, OUTER_MARKET_STALL.rotation, -4, -2.6),
    localToWorld(OUTER_MARKET_STALL.position, OUTER_MARKET_STALL.rotation, -1, -2.6),
    0.28,
    0.75,
  ),
] as const;

const WALL_CONFIG = {
  assetId: '/models/props/eastbrook_wall_wing.glb',
  center: { x: 0, z: 0 },
  radius: 28.4,
  thickness: 0.65,
  height: 2.7,
  maximumSegmentSpan: 6.5,
} as const;

function wallPoint(x: number, z: number): Point2 {
  const scale = WALL_CONFIG.radius / Math.hypot(x, z);
  return { x: x * scale, z: z * scale };
}

const WALL_GATES = [
  makeCircularWallGate(WALL_CONFIG, 'eastbrook_gate_east', 'east', wallPoint(28.506, 7.593), 5),
  makeCircularWallGate(
    WALL_CONFIG,
    'eastbrook_gate_northeast',
    'northeast',
    wallPoint(20.348, 21.359),
    5,
  ),
  makeCircularWallGate(WALL_CONFIG, 'eastbrook_gate_north', 'north', wallPoint(-7.469, 28.539), 5),
  makeCircularWallGate(
    WALL_CONFIG,
    'eastbrook_gate_northwest',
    'northwest',
    wallPoint(-23.95, 17.224),
    5,
  ),
  makeCircularWallGate(
    WALL_CONFIG,
    'eastbrook_gate_southwest',
    'southwest',
    wallPoint(-21.495, -20.204),
    5,
  ),
  makeCircularWallGate(WALL_CONFIG, 'eastbrook_gate_bandit', 'bandit', wallPoint(20.86, -20.86), 5),
] as const;

const WALL_SEGMENTS = generateCircularWallSegments(WALL_CONFIG, WALL_GATES);

function gateCrossing(id: string): Point2 {
  const gate = WALL_GATES.find((candidate) => candidate.id === id);
  if (!gate) throw new Error(`missing Eastbrook wall gate ${id}`);
  return gate.crossing;
}

const ROADS = [
  {
    id: 'north',
    existingRoadPoint: { x: 0, z: 8 },
    gateId: 'eastbrook_gate_north',
    halfWidth: 1.5,
    points: [
      { x: 0, z: 6.75 },
      { x: 0, z: 8 },
      gateCrossing('eastbrook_gate_north'),
      { x: -7.469, z: 28.539 },
    ],
  },
  {
    id: 'east',
    existingRoadPoint: { x: 8, z: 2 },
    gateId: 'eastbrook_gate_east',
    halfWidth: 1.5,
    points: [
      { x: 4.75, z: 2 },
      { x: 8, z: 2 },
      { x: 15, z: 3.5 },
      { x: 23, z: 4.5 },
      gateCrossing('eastbrook_gate_east'),
      { x: 28.506, z: 7.593 },
    ],
  },
  {
    id: 'bandit',
    existingRoadPoint: { x: 6, z: -6 },
    gateId: 'eastbrook_gate_bandit',
    halfWidth: 1.5,
    points: [
      pointAtYaw(CIVIC_CENTER, Math.atan2(6, -8), 4.75),
      { x: 6, z: -6 },
      { x: 8, z: -12 },
      gateCrossing('eastbrook_gate_bandit'),
      { x: 20.86, z: -20.86 },
    ],
  },
  {
    id: 'northwest',
    existingRoadPoint: { x: -8, z: 6 },
    gateId: 'eastbrook_gate_northwest',
    halfWidth: 1.5,
    points: [
      pointAtYaw(CIVIC_CENTER, Math.atan2(-8, 4), 4.75),
      { x: -8, z: 6 },
      { x: -15, z: 8 },
      { x: -21, z: 11 },
      gateCrossing('eastbrook_gate_northwest'),
      { x: -23.95, z: 17.224 },
    ],
  },
  {
    id: 'southwest',
    existingRoadPoint: { x: -6, z: -6 },
    gateId: 'eastbrook_gate_southwest',
    halfWidth: 1.5,
    points: [
      pointAtYaw(CIVIC_CENTER, Math.atan2(-6, -8), 4.75),
      { x: -6, z: -6 },
      { x: -10, z: -8 },
      { x: -20, z: -9 },
      { x: -22, z: -12 },
      { x: -17.851916681798443, z: -16.779722011586674 },
      gateCrossing('eastbrook_gate_southwest'),
      { x: -21.495, z: -20.204 },
    ],
  },
  {
    id: 'northeast',
    existingRoadPoint: { x: 6, z: 8 },
    gateId: 'eastbrook_gate_northeast',
    halfWidth: 1.5,
    points: [
      pointAtYaw(CIVIC_CENTER, Math.atan2(6, 6), 4.75),
      { x: 6, z: 8 },
      { x: 12, z: 14 },
      gateCrossing('eastbrook_gate_northeast'),
      { x: 20.348, z: 21.359 },
    ],
  },
] as const;

const BANK = buildingById('eastbrook_bank');
const INN = buildingById('eastbrook_inn');
const CHAPEL = buildingById('eastbrook_chapel');
const WEAVING_HOUSE = buildingById('eastbrook_weaving_workshop');
const TOOLWORKS = buildingById('eastbrook_toolworks');

const STATIONS = [
  {
    id: 'station_eastbrook_forge',
    type: 'forge',
    masterNpcId: 'forgemistress_darva',
    position: SMITHY.frontStandingPoint,
    interactionRadius: 20,
  },
  {
    id: 'station_eastbrook_kitchens',
    type: 'kitchens',
    masterNpcId: 'cook_marlow',
    position: localToWorld(INN.position, INN.rotation, 2.5, INN.nativeDimensions.depth / 2 + 1.5),
    interactionRadius: 20,
  },
  {
    id: 'station_eastbrook_loom',
    type: 'loom',
    masterNpcId: 'weaver_ottilie',
    position: WEAVING_HOUSE.frontStandingPoint,
    interactionRadius: 20,
  },
  {
    id: 'station_eastbrook_toolworks',
    type: 'toolworks',
    masterNpcId: 'tinker_gizzel',
    position: TOOLWORKS.frontStandingPoint,
    interactionRadius: 20,
  },
] as const;

const FORGE_STATION = STATIONS[0];
const KITCHENS_STATION = STATIONS[1];
const LOOM_STATION = STATIONS[2];
const TOOLWORKS_STATION = STATIONS[3];

function makeNpc(id: string, position: Point2, facing: number, anchorId: string) {
  return { id, position, facing, anchorId, bodyRadius: 0.6 };
}

const MERCHANT_POSITION = localToWorld(
  MARKET_STALLS[0].position,
  MARKET_STALLS[0].rotation,
  0,
  MARKET_STALLS[0].depth / 2 + 0.8,
);
const TRADER_POSITION = localToWorld(
  MARKET_STALLS[1].position,
  MARKET_STALLS[1].rotation,
  0,
  MARKET_STALLS[1].depth / 2 + 0.8,
);
// Lin is a quest herbalist, not a merchant. Keep her already-clear civic-green
// position without inventing a replacement stall or blocking the smithy sightline.
const APOTHECARY_POSITION = { x: 2.8431593444121797, z: 9.717148252611294 } as const;
const SMITH_POSITION = localToWorld(FORGE_STATION.position, SMITHY.rotation, -2, 0);
const DARVA_POSITION = localToWorld(FORGE_STATION.position, SMITHY.rotation, 2, 0);
const COOK_POSITION = localToWorld(KITCHENS_STATION.position, INN.rotation, 1.75, 0);
const WEAVER_POSITION = localToWorld(LOOM_STATION.position, WEAVING_HOUSE.rotation, 2, 0);
const TINKER_POSITION = localToWorld(TOOLWORKS_STATION.position, TOOLWORKS.rotation, 2, 0);
const SAUL_POSITION = { x: 0, z: -14.5 } as const;
const FURY_POSITION = { x: -22.5, z: -7.5 } as const;

const NPCS = [
  makeNpc('the_merchant', MERCHANT_POSITION, MARKET_STALLS[0].rotation, MARKET_STALLS[0].id),
  makeNpc(
    'marshal_redbrook',
    { x: 4.5, z: 5.5 },
    facingToward({ x: 4.5, z: 5.5 }, CIVIC_CENTER),
    'eastbrook_civic_well_beacon',
  ),
  makeNpc('trader_wilkes', TRADER_POSITION, MARKET_STALLS[1].rotation, MARKET_STALLS[1].id),
  makeNpc('apothecary_lin', APOTHECARY_POSITION, -2.788602, 'eastbrook_gate_northeast'),
  makeNpc('brother_aldric', CHAPEL.frontStandingPoint, CHAPEL.rotation, CHAPEL.id),
  makeNpc('smith_haldren', SMITH_POSITION, SMITHY.rotation, FORGE_STATION.id),
  makeNpc(
    'fisherman_brandt',
    { x: -22, z: 4 },
    facingToward({ x: -22, z: 4 }, CIVIC_CENTER),
    'eastbrook_gate_northwest',
  ),
  makeNpc('foreman_odell', { x: -8, z: -9.5 }, 0.607802, 'eastbrook_gate_southwest'),
  makeNpc('bursar_fernando', BANK.frontStandingPoint, BANK.rotation, BANK.id),
  makeNpc(
    'card_master',
    { x: 10.5, z: 1 },
    facingToward({ x: 10.5, z: 1 }, CIVIC_CENTER),
    PRESERVED_ARMOURY.id,
  ),
  makeNpc('chronicler_saul', SAUL_POSITION, TOOLWORKS.rotation, 'mailbox_eastbrook'),
  makeNpc('forgemistress_darva', DARVA_POSITION, SMITHY.rotation, FORGE_STATION.id),
  makeNpc('cook_marlow', COOK_POSITION, INN.rotation, KITCHENS_STATION.id),
  makeNpc('weaver_ottilie', WEAVER_POSITION, WEAVING_HOUSE.rotation, LOOM_STATION.id),
  makeNpc('tinker_gizzel', TINKER_POSITION, TOOLWORKS.rotation, TOOLWORKS_STATION.id),
  makeNpc('fury', FURY_POSITION, facingToward(FURY_POSITION, CIVIC_CENTER), 'eastbrook_chapel'),
] as const;

const BURSAR = NPCS.find((npc) => npc.id === 'bursar_fernando');
if (!BURSAR) throw new Error('missing Eastbrook bursar');
const BANKER_CHEST_LOCAL = { x: 1.15, z: -0.7, rotation: 0 } as const;
const BANKER_CHEST_SAMPLE_POINTS: Point2[] = [];
for (let column = 0; column < 9; column++) {
  const across = -1.09 + (2 * 1.09 * column) / 8;
  for (let row = 0; row < 5; row++) {
    const depth = -0.65 + (2 * 0.65 * row) / 4;
    BANKER_CHEST_SAMPLE_POINTS.push(
      localToWorld(
        BURSAR.position,
        BURSAR.facing,
        BANKER_CHEST_LOCAL.x + across,
        BANKER_CHEST_LOCAL.z + depth,
      ),
    );
  }
}

// The board sits on the south civic/Armoury transition with its public face
// toward the square.
// Keep both its body and standing point outside F-range of every service NPC:
// proximity interaction prioritizes lootable objects before NPCs, so a closer
// placement could otherwise steal the player's service interaction.
const NOTICEBOARD_POSITION = { x: 10, z: -8 } as const;
const NOTICEBOARD_ROTATION = facingToward(NOTICEBOARD_POSITION, CIVIC_CENTER);
const NOTICEBOARD_WIDTH = 2.4;
const NOTICEBOARD_DEPTH = 0.6;
const NOTICEBOARD_FRONT_STANDING_POINT = localToWorld(
  NOTICEBOARD_POSITION,
  NOTICEBOARD_ROTATION,
  0,
  1.4,
);

const SERVICES = {
  playerStart: {
    id: 'eastbrook_player_start',
    position: { x: 2, z: -2 },
    bodyRadius: 0.5,
  },
  mailbox: {
    id: 'mailbox_eastbrook',
    templateId: 'mailbox',
    assetId: '/models/props/mailbox_pillar.glb',
    position: { x: 0, z: -7.5 },
    bodyRadius: 0.8,
    interactionRadius: 7,
  },
  noticeboard: {
    id: 'eastbrook_noticeboard',
    // Static world-service ids use a reserved high range so adding a board
    // never shifts the long-established sequential entity allocator.
    entityId: 2_000_000_001,
    templateId: 'noticeboard_eastbrook',
    assetId: '/models/props/eastbrook_noticeboard.glb',
    name: 'Notice Board',
    position: NOTICEBOARD_POSITION,
    rotation: NOTICEBOARD_ROTATION,
    nativeDimensions: { width: NOTICEBOARD_WIDTH, height: 2.6, depth: NOTICEBOARD_DEPTH },
    footprint: {
      id: 'eastbrook_noticeboard',
      center: NOTICEBOARD_POSITION,
      halfWidth: NOTICEBOARD_WIDTH / 2,
      halfDepth: NOTICEBOARD_DEPTH / 2,
      rotation: NOTICEBOARD_ROTATION,
    },
    frontStandingPoint: NOTICEBOARD_FRONT_STANDING_POINT,
    interactionRadius: 4,
  },
  graveyard: {
    id: 'gy_eastbrook',
    position: { x: -14, z: -14 },
    legacyReleasePoint: { x: -12, z: -14 },
    healerTemplateId: 'spirit_healer',
    healerFacing: Math.PI,
    headstones: [
      { id: 'gy_eastbrook_headstone_0', position: { x: -14, z: -14 } },
      { id: 'gy_eastbrook_headstone_1', position: { x: -11.8, z: -14 } },
      { id: 'gy_eastbrook_headstone_2', position: { x: -9.6, z: -14 } },
      { id: 'gy_eastbrook_headstone_3', position: { x: -14, z: -11.4 } },
      { id: 'gy_eastbrook_headstone_4', position: { x: -11.8, z: -11.4 } },
      { id: 'gy_eastbrook_headstone_5', position: { x: -9.6, z: -11.4 } },
    ],
  },
  rest: { id: 'eastbrook_inn_rest', buildingId: 'eastbrook_inn' },
  stations: STATIONS,
  npcs: NPCS,
  routes: [
    {
      id: 'eastbrook_player_start_to_square',
      bodyRadius: 0.8,
      points: [
        { x: 2, z: -2 },
        { x: 2, z: 0 },
        { x: 2, z: 2 },
      ],
    },
    {
      id: 'eastbrook_mailbox_route',
      bodyRadius: 0.5,
      points: [
        { x: 2, z: -2 },
        { x: 1, z: -5 },
        { x: 0, z: -7.5 },
      ],
    },
    {
      id: 'eastbrook_noticeboard_route',
      bodyRadius: 0.5,
      points: [{ x: 2.85, z: -1.8 }, { x: 6, z: -6 }, NOTICEBOARD_FRONT_STANDING_POINT],
    },
    {
      id: 'eastbrook_graveyard_route',
      bodyRadius: 0.5,
      points: [
        { x: -2.85, z: -1.8 },
        { x: -6, z: -6 },
        { x: -10, z: -8 },
        { x: -14, z: -10 },
        { x: -14, z: -14 },
      ],
    },
    {
      id: 'eastbrook_armoury_approach',
      bodyRadius: 0.8,
      points: [
        { x: 4.75, z: 2 },
        { x: 8, z: 0 },
        { x: 10, z: -3 },
        { x: 12, z: -5.5 },
      ],
    },
  ],
  bankerChest: {
    id: 'eastbrook_banker_chest',
    assetId: '/models/props/banker_chest.glb',
    attachedToNpcId: 'bursar_fernando',
    bakedIntoBankAsset: false,
    targetHeight: 1.3,
    halfWidth: 1.09,
    halfDepth: 0.65,
    preferredLocalPlacement: BANKER_CHEST_LOCAL,
  },
  bankerChestSamplePoints: BANKER_CHEST_SAMPLE_POINTS,
} as const;

export const EASTBROOK_LAYOUT = deepFreeze({
  id: 'eastbrook_civic_layout_v2',
  preservedBuildings: [PRESERVED_ARMOURY],
  buildings: BUILDINGS,
  civic: {
    center: CIVIC_CENTER,
    ring: { radius: 4.75, pathHalfWidth: 1.5 },
    wellBeacon: {
      id: 'eastbrook_civic_well_beacon',
      assetId: '/models/props/eastbrook_civic_well_beacon.glb',
      position: CIVIC_FEATURE_CENTER,
      radius: 1.5,
      height: 3.1,
      nativeDimensions: { width: 3.2, height: 3.1, depth: 3.2 },
    },
    benches: BENCHES,
  },
  market: {
    arrangement: 'distributed',
    axisYaw: null,
    stalls: MARKET_STALLS,
  },
  fences: FENCES,
  wall: {
    ...WALL_CONFIG,
    gates: WALL_GATES,
    segments: WALL_SEGMENTS,
  },
  roads: ROADS,
  services: SERVICES,
} as const);

function indexById<T extends { id: string }>(records: readonly T[]): Readonly<Record<string, T>> {
  return deepFreeze(Object.fromEntries(records.map((record) => [record.id, record])));
}

/** Derived keyed views retain the exact frozen records owned by EASTBROOK_LAYOUT. */
export const EASTBROOK_BUILDINGS_BY_ID = indexById([
  ...EASTBROOK_LAYOUT.preservedBuildings,
  ...EASTBROOK_LAYOUT.buildings,
]);
export const EASTBROOK_NPC_PLACEMENTS_BY_ID = indexById(EASTBROOK_LAYOUT.services.npcs);
export const EASTBROOK_STATIONS_BY_ID = indexById(EASTBROOK_LAYOUT.services.stations);
