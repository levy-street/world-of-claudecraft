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
      // Round 6 (owner): the house crowded the chapel green, standing between
      // Brother Aldric and the graves where the churchyard wall now runs. Its
      // lot is the north half of the new enclosure.
      id: 'eastbrook_home_rise',
      disposition: 'removed_after_live_review',
      kind: 'house',
      x: -8,
      z: -82,
      width: 6.9,
      depth: 5.6,
      rotation: 1.17,
    },
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
    {
      id: 'eastbrook_fence_market_outer',
      disposition: 'removed',
      start: { x: -12.222218917656093, z: 4.01813945810839 },
      end: { x: -11.729022993287566, z: 1.0589575136875549 },
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

const CIVIC_CENTER = { x: -14, z: -102 } as const;
// Keep the feature visually central while leaving the default spawn's east-side
// lane through the square clear for player and pet bodies. The old exact-center
// placement made x=2 a tangent for the player and an overlap for larger movers.
const CIVIC_FEATURE_CENTER = { x: -14.75, z: -102 } as const;
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

// Round 4: the preserved Grand Armoury leaves its Wolf Run lot. The KayKit
// barracks and a watch tower take over the (17.5, -5.5) ground as the Wolf
// Run garrison (zone1 decorProps rows own those placements); the armoury GLB
// and its render adapter stay shipped for custom worlds. preservedBuildings
// keeps its API shape as an empty list so every spread/map consumer holds.
export interface PreservedBuildingPlacement {
  id: string;
  assetId: string;
  landmark: string;
  kind: 'house' | 'inn' | 'chapel';
  position: Point2;
  nativeDimensions: { width: number; height: number; depth: number };
  aboveGradeHeight: number;
  foundationDepth: number;
  rotation: number;
  footprint: Obb2;
  maxCornerRadius: number;
  frontStandingPoint: Point2;
}

// Round 3 (owner): every kit building grew so its door reads at player
// height (uniform per-building factors, aspect kept: homes 1.25x, the
// workshop 1.2x, the tall civic pair 1.15x). The chapel is a bespoke asset
// with authored proportions and stays as shipped. The extra trio of homes
// that used to be zone1 decor props are first-class houses now, with lots,
// foundation skirts, and the same warm lit panes as the rest of the town.
const BUILDINGS = [
  makeBuilding(
    'eastbrook_bank',
    '/models/biome/hexb_townhall.glb',
    'house',
    { x: 12, z: -94 },
    8.6,
    12.7,
    6.9,
    -2.356194490192345,
  ),
  makeBuilding(
    'eastbrook_smithy',
    '/models/biome/hexb_workshop.glb',
    'house',
    { x: -2, z: -122 },
    8.4,
    9.6,
    6.6,
    -2.0344439357957027,
  ),
  makeBuilding(
    'eastbrook_inn',
    '/models/biome/hexb_tavern.glb',
    'inn',
    { x: -38, z: -88 },
    8.6,
    11.5,
    6.9,
    -2.5535900500422257,
    0.8,
  ),
  // Round 6b (owner): re-shelled as the KayKit church. The bespoke
  // eastbrook_chapel.glb was the last pre-kit building in town and read as an
  // odd grey leftover beside the coloured kit shells. The building ID is kept
  // deliberately: Brother Aldric's stand and facing, FURY's anchor and the
  // chapel capture view all resolve through it, so re-shelling changes the mesh
  // without disturbing any of them. Footprint is unchanged (nothing new can
  // collide with the churchyard rails), height raised so the spire reads, and
  // the kit shell is 2,519 triangles lighter than the bespoke one.
  makeBuilding(
    'eastbrook_chapel',
    '/models/biome/hex_church.glb',
    'chapel',
    { x: 2, z: -78 },
    5.5,
    9,
    6,
    0.7853981633974483,
  ),
  makeBuilding(
    'eastbrook_weaving_workshop',
    '/models/biome/hexb_home_a.glb',
    'house',
    { x: -28, z: -122 },
    6.9,
    9.4,
    5.6,
    2.5535900500422257,
  ),
  makeBuilding(
    'eastbrook_toolworks',
    '/models/biome/hexb_home_b.glb',
    'house',
    { x: -16, z: -128 },
    6.9,
    10.6,
    5.6,
    0.5880026035475675,
  ),
  makeBuilding(
    'eastbrook_home_market',
    '/models/biome/hexb_home_a.glb',
    'house',
    { x: -33, z: -111 },
    6.9,
    9.4,
    5.6,
    0.2,
  ),
  makeBuilding(
    'eastbrook_home_east',
    '/models/biome/hexb_home_b.glb',
    'house',
    { x: 22, z: -106 },
    6.9,
    10.6,
    5.6,
    -1.46,
  ),
  // Round 6 (owner + team): the harbour quarter. The town used to stop dead at
  // the inn and leave sixty yards of empty road between it and the quay, which
  // read as a village with a dock bolted on rather than a harbour town. These
  // six lots line the dock road out to the headland, alternating sides the way
  // a real street grows, each seated on ground probed level (slope under 0.06)
  // and dry, set back from the road centreline and clear of every neighbour.
  // APPENDED, never inserted: zone1 spreads this array by index.
  makeBuilding(
    'eastbrook_quayside_home',
    '/models/biome/hexb_home_b.glb',
    'house',
    { x: -82, z: -102 },
    6.9,
    10.6,
    5.6,
    -2.2,
  ),
  makeBuilding(
    'eastbrook_harbour_market',
    '/models/biome/hexb_market.glb',
    'house',
    { x: -68, z: -108 },
    8.6,
    7.5,
    7,
    -2.2,
  ),
  makeBuilding(
    'eastbrook_dock_home',
    '/models/biome/hexb_home_a.glb',
    'house',
    { x: -50, z: -112 },
    6.9,
    9.4,
    5.6,
    -2.2,
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
    { x: -14, z: -99.1 },
    1.8,
    0.6,
    Math.PI,
  ),
  makeObbPlacement(
    'eastbrook_civic_bench_south',
    '/models/dungeon/bench.glb',
    { x: -14, z: -104.9 },
    1.8,
    0.6,
    0,
  ),
  makeObbPlacement(
    'eastbrook_civic_bench_west',
    '/models/dungeon/bench.glb',
    { x: -11.1, z: -102 },
    1.8,
    0.6,
    Math.PI / 2,
  ),
];

const MARKET_STALL_SPECS = [
  // Round 6b (owner): the two stalls stood 9 yd apart on one line, which put
  // their keepers 6 yd apart, the tightest pair in town. Opened out across the
  // square instead, so the market reads as a square rather than a queue.
  ['eastbrook_market_stall_world_market', 'gold', { x: -20.5, z: -94 }, 2.4805494847391065],
  ['eastbrook_market_stall_provisions', 'green', { x: -19, z: -108 }, 0.6610431688506869],
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
// Yard locals track the grown smithy footprint (halfWidth 4.2, halfDepth
// 3.3): posts stay a clear step outside the walls so no fence end embeds.
const FENCES = [
  makeFence(
    'eastbrook_fence_smithy_west',
    'smithy_yard',
    localToWorld(SMITHY.position, SMITHY.rotation, -5.0, -5.5),
    localToWorld(SMITHY.position, SMITHY.rotation, -5.0, -3.7),
    0.28,
    0.9,
  ),
  makeFence(
    'eastbrook_fence_smithy_outer',
    'smithy_yard',
    localToWorld(SMITHY.position, SMITHY.rotation, -4.7, -5.8),
    localToWorld(SMITHY.position, SMITHY.rotation, 4.7, -5.8),
    0.28,
    0.9,
  ),
  makeFence(
    'eastbrook_fence_smithy_east',
    'smithy_yard',
    localToWorld(SMITHY.position, SMITHY.rotation, 5.0, -5.5),
    localToWorld(SMITHY.position, SMITHY.rotation, 5.0, -3.7),
    0.28,
    0.9,
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

// The harbor town has NO ring wall (site-plan.md section 2: a town grown
// along streets, open to its quay and beach). Gates and segments are empty
// on purpose; the machinery stays so the API and its consumers (renderer
// instancing, wall-pillar colliders, wallSegmentMirrored) hold their shape.
const WALL_GATES: ReturnType<typeof makeCircularWallGate>[] = [];

const WALL_SEGMENTS = generateCircularWallSegments(WALL_CONFIG, WALL_GATES);

/**
 * A wall wing is MIRRORED when its segment starts at a gate's end, putting
 * the wing's tall lantern pillar on the gate side. This is the one rule both
 * the renderer's instancing (render/eastbrook_town.ts) and the wall's
 * pillar colliders (sim/colliders.ts) hang the wing's asymmetry on, so the
 * lantern you see is the pylon that blocks.
 */
export function wallSegmentMirrored(segment: CircularWallSegment): boolean {
  return WALL_GATES.some(
    (gate) =>
      Math.abs(gate.end.x - segment.start.x) < 1e-8 &&
      Math.abs(gate.end.z - segment.start.z) < 1e-8,
  );
}

function gateCrossing(id: string): Point2 {
  const gate = WALL_GATES.find((candidate) => candidate.id === id);
  if (!gate) throw new Error(`missing Eastbrook wall gate ${id}`);
  return gate.crossing;
}

const ROADS = [
  {
    id: 'north',
    existingRoadPoint: { x: 6, z: -72 },
    gateId: null,
    halfWidth: 1.5,
    points: [
      { x: 14.6, z: -88.6 },
      { x: 12, z: -85 },
      { x: 10, z: -80 },
      { x: 6, z: -72 },
      { x: 0, z: -58 },
    ],
  },
  {
    id: 'east',
    existingRoadPoint: { x: -44, z: -98 },
    gateId: null,
    // The main street: a touch wider than the side lanes so the walk from
    // the square to the quay reads as the town's spine (owner refinement
    // round 3, tidier pathways).
    halfWidth: 2,
    points: [
      { x: -20, z: -102 },
      { x: -26, z: -101 },
      { x: -44, z: -98 },
      { x: -56, z: -88 },
      { x: -62, z: -76 },
      { x: -70, z: -68 },
      { x: -80, z: -66 },
      { x: -88, z: -60 },
      { x: -92, z: -56 },
    ],
  },
  {
    id: 'bandit',
    existingRoadPoint: { x: -10, z: -112 },
    gateId: null,
    halfWidth: 1.5,
    points: [
      { x: -11, z: -105.5 },
      { x: -10, z: -112 },
      { x: -9, z: -119 },
      { x: -12, z: -123 },
      { x: -22, z: -120.5 },
    ],
  },
  {
    id: 'northwest',
    existingRoadPoint: { x: -9.2, z: -132 },
    gateId: null,
    halfWidth: 1.5,
    // Shifted a step east of the grown toolworks lot (round 3) and trimmed
    // to end on the new strand, short of the pulled-in waterline.
    points: [
      { x: -12, z: -107.5 },
      { x: -10.8, z: -118 },
      { x: -9.2, z: -132 },
      { x: -9.2, z: -134 },
    ],
  },
  {
    id: 'southwest',
    existingRoadPoint: { x: 0, z: -99 },
    gateId: null,
    halfWidth: 1.5,
    points: [
      { x: 7, z: -97.4 },
      { x: 0, z: -99 },
      { x: -9, z: -100.4 },
    ],
  },
  {
    id: 'northeast',
    existingRoadPoint: { x: -92, z: -54 },
    gateId: null,
    halfWidth: 1.5,
    // Round 5 (owner): the dock read too dark at night. The lamp planner
    // samples every 26 yd of arc and alternates roadside, so the quay walk
    // serpentines the full pad (the pad ground holds near -2, above the
    // planner floor, so BOTH sides plant): the long run plus the swings
    // buys 3 lamp samples where the straight stub earned one.
    points: [
      { x: -92, z: -32 },
      { x: -92, z: -56 },
      { x: -96, z: -61 },
      { x: -92, z: -66 },
      { x: -92, z: -74 },
      { x: -96.5, z: -78 },
      { x: -92, z: -82 },
      { x: -92, z: -92 },
    ],
  },
  // A short lane from the inn's door down to the main street, so the inn
  // square joins the town's spine instead of floating beside it (owner
  // refinement round 3). APPENDED last: zone1's ZONE1_ROADS spreads these
  // entries by index, so new roads never land mid-array.
  {
    id: 'inn_lane',
    existingRoadPoint: { x: -44, z: -98 },
    gateId: null,
    halfWidth: 1.5,
    points: [
      { x: -40.8, z: -92.2 },
      { x: -42, z: -95 },
      { x: -44, z: -98 },
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
const APOTHECARY_POSITION = { x: -72, z: -96 } as const;
// Station cluster props sit at station + world-axis offsets (town_props.ts,
// no rotation), so the smith's and cook's work points derive the same way.
// Round 4: the smith stands on the yard's open corner, half a stride clear
// of the crate that his old derived spot nearly touched, facing the anvil.
// Round 5 (owner): Smith Haldren works his own KayKit blacksmith on the green
// between the civic square and the crafts lane (the zone1 decor prop at
// (2, -112), west face at x -2.2), standing a stride off its door and facing
// the shop. Forgemistress Darva keeps the crafting station.
const BLACKSMITH_SHOP_CENTER = { x: 2, z: -112 } as const;
const SMITH_POSITION = { x: -3.4, z: -112.5 } as const;
// Round 6b (owner): the forge and toolworks benches sit close together in the
// crafts lane, so their masters stand out to OPPOSITE sides of their own
// stations rather than both toward the middle. Each still works its bench;
// they just stop reading as one huddle.
const DARVA_POSITION = localToWorld(FORGE_STATION.position, SMITHY.rotation, 4.2, 0);
// Round 4: the cook works the prep side, a stride clear of the open flame
// (the kitchens campfire, the town's only open fire, burns at station +
// (-1.7, +0.9)). The prep offset holds z at -1.5 rather than the drafted
// -1.4 so the cook also keeps the full anchor clearance (0.85) plus a body
// radius (0.6) off the station point that service routes end on.
const KITCHENS_FIRE_POINT = {
  x: KITCHENS_STATION.position.x - 1.7,
  z: KITCHENS_STATION.position.z + 0.9,
} as const;
const COOK_POSITION = {
  x: KITCHENS_STATION.position.x + 0.2,
  z: KITCHENS_STATION.position.z - 1.5,
} as const;
const WEAVER_POSITION = localToWorld(LOOM_STATION.position, WEAVING_HOUSE.rotation, 2, 0);
const TINKER_POSITION = localToWorld(TOOLWORKS_STATION.position, TOOLWORKS.rotation, -3.2, 0);
const SAUL_POSITION = { x: 10.2, z: -87.5 } as const;
// Round 6b (owner): off the chapel step, where he stood 7 yd from Brother
// Aldric. FURY is a service NPC (the honor quartermaster), so he belongs on
// the town's edge rather than in the churchyard approach.
const FURY_POSITION = { x: 16, z: -78 } as const;

// Round 4: the marshal keeps watch beside his notice board, a clear stride
// from the bursar's queue and outside the board's posting envelope (the
// board's body and posting point both stay a full interact range away, the
// board comment's rule). The drafted spot at (9, -92.5) sat INSIDE the
// bank's rotated lot (the 45-degree townhall footprint owns that corner),
// so the watch stands on the green south of the board instead: outside the
// envelope, off the posting lane, facing the civic square he polices.
// Round 6b (owner): the town's NPCs are laid out by ROLE along the dockside
// road. Quest givers sit nearest the quay, because a new character spawns
// there and the zone's welcome line sends them to Redbrook: he used to be an
// eighty yard walk inland. Profession masters stay mid-town with their
// crafting stations (a forge master cannot leave the forge), and service NPCs
// sit out on the edges. Each group is spread, not clustered.
const MARSHAL_POSITION = { x: -58, z: -102 } as const;

const NPCS = [
  makeNpc('the_merchant', MERCHANT_POSITION, MARKET_STALLS[0].rotation, MARKET_STALLS[0].id),
  makeNpc(
    'marshal_redbrook',
    MARSHAL_POSITION,
    facingToward(MARSHAL_POSITION, CIVIC_CENTER),
    'eastbrook_harbour_market',
  ),
  makeNpc('trader_wilkes', TRADER_POSITION, MARKET_STALLS[1].rotation, MARKET_STALLS[1].id),
  makeNpc(
    'apothecary_lin',
    APOTHECARY_POSITION,
    facingToward(APOTHECARY_POSITION, CIVIC_CENTER),
    'eastbrook_quayside_home',
  ),
  makeNpc('brother_aldric', CHAPEL.frontStandingPoint, CHAPEL.rotation, CHAPEL.id),
  makeNpc(
    'smith_haldren',
    SMITH_POSITION,
    // Round 5 (owner): the smith looks OUT from his shop door over the green
    // toward the crafts lane, never at his own wall.
    facingToward(BLACKSMITH_SHOP_CENTER, SMITH_POSITION),
    'eastbrook_blacksmith',
  ),
  makeNpc('fisherman_brandt', { x: -95, z: -50 }, -1.5707963267948966, 'eastbrook_quay'),
  makeNpc('foreman_odell', { x: -84, z: -63 }, 0.6747409422235526, 'eastbrook_quay'),
  makeNpc('bursar_fernando', BANK.frontStandingPoint, BANK.rotation, BANK.id),
  makeNpc('card_master', { x: 20, z: -98 }, -2.677945044588987, 'eastbrook_bank'),
  makeNpc('chronicler_saul', SAUL_POSITION, TOOLWORKS.rotation, 'mailbox_eastbrook'),
  makeNpc('forgemistress_darva', DARVA_POSITION, SMITHY.rotation, FORGE_STATION.id),
  makeNpc(
    'cook_marlow',
    COOK_POSITION,
    facingToward(COOK_POSITION, KITCHENS_FIRE_POINT),
    KITCHENS_STATION.id,
  ),
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
const NOTICEBOARD_POSITION = { x: 5, z: -89 } as const;
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
    position: { x: -94, z: -58 },
    bodyRadius: 0.5,
  },
  mailbox: {
    id: 'mailbox_eastbrook',
    templateId: 'mailbox',
    assetId: '/models/props/mailbox_pillar.glb',
    position: { x: -10, z: -98 },
    bodyRadius: 0.8,
    interactionRadius: 7,
    // The pillar is a solid collider (the noticeboard pattern), so walkers
    // aim for the posting spot in front of it, not the pillar's own point.
    frontStandingPoint: { x: -10, z: -96.9 },
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
    position: { x: -2, z: -70 },
    legacyReleasePoint: { x: 0, z: -70 },
    healerTemplateId: 'spirit_healer',
    healerFacing: Math.PI,
    headstones: [
      { id: 'gy_eastbrook_headstone_0', position: { x: -2, z: -70 } },
      { id: 'gy_eastbrook_headstone_1', position: { x: 0.2, z: -70 } },
      { id: 'gy_eastbrook_headstone_2', position: { x: 2.4, z: -70 } },
      { id: 'gy_eastbrook_headstone_3', position: { x: -2, z: -67.4 } },
      { id: 'gy_eastbrook_headstone_4', position: { x: 0.2, z: -67.4 } },
      { id: 'gy_eastbrook_headstone_5', position: { x: 2.4, z: -67.4 } },
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
        { x: -94, z: -58 },
        { x: -92, z: -56 },
        { x: -90, z: -57 },
      ],
    },
    {
      id: 'eastbrook_mailbox_route',
      bodyRadius: 0.5,
      // Ends at the pillar's standing point, not inside it: the Ravenpost
      // is a solid collider now, and mail opens from interactionRadius 7.
      points: [
        { x: -12, z: -97.5 },
        { x: -10.8, z: -95.8 },
        { x: -10, z: -96.9 },
      ],
    },
    {
      id: 'eastbrook_noticeboard_route',
      bodyRadius: 0.5,
      points: [{ x: 4.5, z: -95 }, { x: 5, z: -92.5 }, NOTICEBOARD_FRONT_STANDING_POINT],
    },
    {
      id: 'eastbrook_graveyard_route',
      bodyRadius: 0.5,
      // The final approach threads the gap between the headstone columns
      // (x -14 and -11.8): the stones are solid colliders now, so the walk
      // may no longer run down the x -14 column straight through the middle
      // stone. The Spirit Healer's anchor stone itself stays scenery.
      points: [
        { x: 14, z: -89 },
        { x: 12, z: -85 },
        { x: 9, z: -79 },
        { x: 3, z: -72.5 },
        { x: -1, z: -71.4 },
      ],
    },
    {
      id: 'eastbrook_armoury_approach',
      bodyRadius: 0.8,
      // Round 4: the barracks approach. The Grand Armoury left the Wolf Run
      // lot and the KayKit barracks garrison stands on its ground, so the
      // walk still leaves the north road at the old town's heart and ends
      // at the same lot front. The route id stays for save/route stability.
      points: [
        { x: 2, z: -4 },
        { x: 8, z: -4.5 },
        { x: 10, z: -5 },
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
  preservedBuildings: [] as readonly PreservedBuildingPlacement[],
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
