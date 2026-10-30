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

/**
 * A PLACED building: one of the painted Tidehold models, stood at the anchor,
 * turn and size it has on the Studio rebuild map (maps/eastbrook_rebuild), so
 * the built-in town and that map show the same street. A building whose
 * model bakes a shut door is SEALED, like every town building before it: the
 * record is one solid box. One whose model bakes an open doorway is
 * `walkIn`, entered the way Fenbridge's are (sim/town_walk_in.ts).
 *
 * `anchor` is where the model's own origin stands. Every measurement below is
 * the model's own at its AUTHORED size, in its own axes; `scale` carries them
 * to the size the building stands at. `walls` is the walled body: `position`,
 * `nativeDimensions` and `footprint` are that rectangle, so collision, the
 * calm pad, the rest area and the map silhouette all follow the walls a
 * player sees rather than the eaves above them. `annexes` are the parts that
 * stand outside the wall box and are just as solid (a bell tower, a
 * strongroom, a forge shelter): each is one more box in the same axes, so the
 * record's own box never has to swallow the open ground beside a tower to
 * seal it. `reach` is the whole ground rectangle the model covers (porch,
 * stair, awning and chimney included), which sits off the origin: the draw
 * cull, the grass clearing and the level pad read that one. These models face
 * local -Z, so the door and its standing point are on the -Z side, the
 * opposite of the kit shells they replaced.
 */
function makePlacedBuilding(spec: {
  id: string;
  assetId: string;
  kind: 'house' | 'inn' | 'chapel';
  anchor: Point2;
  rotation: number;
  /** The size the model stands at, in multiples of its authored size. */
  scale: number;
  /** The whole model in its own axes: its centre off the origin, its ground
   *  extents, and its full height from the bottom of its footing. */
  reach: { x: number; z: number; width: number; height: number; depth: number };
  /** The walled body in the model's own axes. */
  walls: { x: number; z: number; width: number; depth: number };
  /** Solid parts outside the wall box, in the model's own axes. */
  annexes?: readonly { name: string; x: number; z: number; width: number; depth: number }[];
  /** Where the door sits along the front (local -Z) face. */
  doorX: number;
  /** The model's largest dimension at authored size, measured off the shipped
   *  file (`reach` is rounded, too coarse to scale the baked collision rows
   *  by). */
  modelSize: number;
  /** An open doorway a player walks through: the record collides on the
   *  model's own baked walls and stands its floor and entry step as walkable
   *  ground (sim/town_walk_in.ts), the way the same model does as a Studio
   *  placement. Without it the record is one sealed box. */
  walkIn?: boolean;
}) {
  const size = spec.scale;
  // the model's yard of footing, buried, with the ground line sunk a further 0.05
  const lift = -(size + 0.05);
  // the stoop grows with the building, so a grander one's step stands further
  // out (exactly the town's 1.8 at its standing size)
  const frontClearance = PLACED_FRONT_CLEARANCE * (size / STANDARD_SCALE);
  const reach = {
    x: spec.reach.x * size,
    z: spec.reach.z * size,
    width: spec.reach.width * size,
    height: spec.reach.height * size,
    depth: spec.reach.depth * size,
  };
  const walls = {
    x: spec.walls.x * size,
    z: spec.walls.z * size,
    width: spec.walls.width * size,
    depth: spec.walls.depth * size,
  };
  const position = localToWorld(spec.anchor, spec.rotation, walls.x, walls.z);
  const wallFrontZ = walls.z - walls.depth / 2;
  const annexes: Obb2[] = (spec.annexes ?? []).map((annex) => ({
    id: `${spec.id}:${annex.name}`,
    center: localToWorld(spec.anchor, spec.rotation, annex.x * size, annex.z * size),
    halfWidth: (annex.width * size) / 2,
    halfDepth: (annex.depth * size) / 2,
    rotation: spec.rotation,
  }));
  return {
    id: spec.id,
    assetId: spec.assetId,
    kind: spec.kind,
    walkIn: spec.walkIn === true,
    position,
    nativeDimensions: {
      width: walls.width,
      // above the ground line: the footing below it is buried
      height: reach.height + lift,
      depth: walls.depth,
    },
    rotation: spec.rotation,
    footprint: {
      id: spec.id,
      center: position,
      halfWidth: walls.width / 2,
      halfDepth: walls.depth / 2,
      rotation: spec.rotation,
    },
    maxCornerRadius: Math.hypot(walls.width / 2, walls.depth / 2),
    frontClearance,
    frontStandingPoint: localToWorld(
      spec.anchor,
      spec.rotation,
      spec.doorX * size,
      wallFrontZ - frontClearance,
    ),
    /** The way a visitor looks standing at the door, facing out of it. */
    frontFacing: Math.atan2(Math.sin(spec.rotation + Math.PI), Math.cos(spec.rotation + Math.PI)),
    placement: {
      x: spec.anchor.x,
      z: spec.anchor.z,
      rotation: spec.rotation,
      scale: size,
      lift,
      /** The model's largest dimension at authored size: its baked collision
       *  rows are stored in multiples of this over the placed-asset target
       *  height (sim/town_walk_in.ts). */
      modelSize: spec.modelSize,
    },
    annexes,
    reach: {
      id: spec.id,
      center: localToWorld(spec.anchor, spec.rotation, reach.x, reach.z),
      halfWidth: reach.width / 2,
      halfDepth: reach.depth / 2,
      rotation: spec.rotation,
    },
  };
}

// Where a visitor stands at a placed building's door: at the foot of its
// stoop, 1.8 yd off the wall face on the door's own line at the town's
// standing size, further at a grander one (the apothecary's shop at 1.5: at
// 1.8 its grown stoop stands in a body's way). Inside the 2 yd halo an inn's
// rest area keeps round its walls (building_layout.ts buildingRestPadding),
// so the tavern's doorstep is where a traveller rests.
const PLACED_FRONT_CLEARANCE = 1.8;
const DEGREE = Math.PI / 180;

// The Tidehold models are authored in yards with their ground line at y 0 and
// one yard of footing below it. Eastbrook stands them GRAND, so a player (2.6
// yd to the crown) walks in under a door of about five yards, the size the
// Highwatch rebuild settled on (highwatch_layout.ts). Measured off each
// model's baked collision (door head and ceiling over its floor, authored
// size), the town's standing size of 1.3 already does it for all but one:
//  - the bank: door 4.4, hall ceiling 5.4; at 1.3 the door clears 5.7, the
//    hall 7.0;
//  - the smithy: door 4.0, ceiling 4.8; at 1.3 the door clears 5.2, the forge
//    room 6.2;
//  - the inn (tavern): door 4.4, taproom ceiling 4.9; at 1.3 the door clears
//    5.7, the taproom 6.4;
//  - the chapel (hall): door 5.0, nave walls 8.4; at 1.3 the portal clears 6.5;
//  - the quay cottage (house_b, sealed): a storey of 4.0 over its step, 5.2 at
//    1.3;
//  - the apothecary's shop (shop_a): door 3.25, ceiling 4.2, the smallest; at
//    1.3 its door cleared only 4.2, so it stands at 1.5, the size Highwatch's
//    counting house (the same model) stands at: the door clears 4.9 and the
//    shop room 6.3.
const STANDARD_SCALE = 1.3;
const APOTHECARY_SCALE = 1.5;

// The Tidehold rebuild: the eleven kit shells gave way to six painted
// buildings round an open middle, set out where the World of ClaudeCraft
// Studio map (data/maps/world_of_claudecraft.map.json) stands them: the bank
// with the weekly vault on its flank at the harbour end of the main street,
// the smithy north of the square on the old chapel rise, the inn up the slope
// beyond the farm plots, the chapel and its churchyard on the rise west of the
// square, the apothecary's shop at the crafts lane's end above the strand, and
// a cottage by the quay. Each stands at the anchor and turn that map gives it
// (the Studio placement's own x, z and rotY), except where its larger ground
// crossed something the built-in world keeps, and then only as far as that
// needs: the chapel stands 11.4 yd inland (5 yd west, 10.2 yd north) of the
// map's spot, where a sixth of its ground lay under the bay and its level
// shelf could not be seated without lifting seabed out of the sea (about 11
// yd is the least that clears it); the apothecary's shop 2 yd north, whose
// seaward eaves stood under 4 yd off the waterline, too close for its shelf
// to ease back down to the strand before the water; and the inn 3.5 yd back
// from its door, so its walls stand outside the farm beds' working reach.
// Building IDS are kept where the role is (the forge ambience keys on the
// smithy, the rest rule on the inn), so nothing that resolves through an id
// moved with the mesh. Reach boxes are the shipped models' bounds, and the
// wall and annex boxes are their baked collision lines
// (tests/eastbrook_placed_buildings.test.ts measures all of them off the
// shipped files). Every one whose model bakes an open doorway (all but the
// quay cottage) is walk-in.
const BUILDINGS = [
  makePlacedBuilding({
    id: 'eastbrook_bank',
    assetId: '/models/tidehold/bank.glb',
    kind: 'house',
    anchor: { x: -61.99, z: -118.33 },
    rotation: 225 * DEGREE,
    scale: STANDARD_SCALE,
    reach: { x: -0.7013, z: 0.7819, width: 22.6067, height: 22.5005, depth: 19.8387 },
    walls: { x: 0, z: 0, width: 18, depth: 12.4923 },
    annexes: [
      { name: 'strongroom', x: 0, z: 8.2, width: 5.8, depth: 3.9077 },
      { name: 'turret', x: -9.5923, z: -6.8462, width: 3.2308, depth: 3.2308 },
    ],
    doorX: 0,
    modelSize: 22.6067,
    walkIn: true,
  }),
  makePlacedBuilding({
    id: 'eastbrook_smithy',
    assetId: '/models/tidehold/smithy.glb',
    kind: 'house',
    anchor: { x: -4.2, z: -75.2 },
    rotation: 20 * DEGREE,
    scale: STANDARD_SCALE,
    reach: { x: 3.4285, z: -0.295, width: 19.797, height: 12.7809, depth: 11.6901 },
    walls: { x: 0, z: 0, width: 11, depth: 9 },
    // the open forge shelter at its west end: a raised deck under a roof,
    // crowded with the forge, the anvil and the quench trough
    annexes: [{ name: 'forge_shelter', x: 9.1231, z: -0.1, width: 7.2308, depth: 9.6 }],
    doorX: -1.2,
    modelSize: 19.797,
    walkIn: true,
  }),
  makePlacedBuilding({
    id: 'eastbrook_inn',
    assetId: '/models/tidehold/tavern.glb',
    kind: 'inn',
    anchor: { x: -30.34, z: -60.63 },
    rotation: 24 * DEGREE,
    scale: STANDARD_SCALE,
    reach: { x: 0.2721, z: -0.0502, width: 22.6483, height: 18.7798, depth: 16.7997 },
    walls: { x: 0, z: 0, width: 20, depth: 13 },
    annexes: [
      { name: 'front_bench', x: -5.1, z: -7.2462, width: 5.4, depth: 0.8923 },
      { name: 'barrels', x: 10.9, z: -4.9, width: 1.0923, depth: 2.2923 },
    ],
    doorX: 0,
    modelSize: 22.6483,
    walkIn: true,
  }),
  makePlacedBuilding({
    id: 'eastbrook_chapel',
    assetId: '/models/tidehold/hall.glb',
    kind: 'chapel',
    anchor: { x: 28.2, z: -119.62 },
    rotation: 125 * DEGREE,
    scale: STANDARD_SCALE,
    reach: { x: 1.9255, z: -0.254, width: 18.8515, height: 30.4998, depth: 24.212 },
    walls: { x: 0, z: 0, width: 12, depth: 22 },
    annexes: [
      { name: 'bell_tower', x: 8.2538, z: -9, width: 5.4, depth: 5.4 },
      { name: 'notice_board', x: -4.2, z: -11.8, width: 1.8, depth: 0.6 },
    ],
    doorX: 0,
    modelSize: 30.4998,
    walkIn: true,
  }),
  makePlacedBuilding({
    id: 'eastbrook_apothecary',
    assetId: '/models/tidehold/shop_a.glb',
    kind: 'house',
    anchor: { x: -30.59, z: -127.63 },
    rotation: 175 * DEGREE,
    scale: APOTHECARY_SCALE,
    reach: { x: 0, z: -0.8001, width: 13.004, height: 16.2797, depth: 12.2001 },
    walls: { x: 0, z: 0, width: 11, depth: 8.4 },
    annexes: [
      { name: 'stall_counter', x: 2.3769, z: -5.9231, width: 3.6154, depth: 0.7692 },
      // the barrels at the stall's east end, with the awning post beside them
      { name: 'stall_barrels', x: 4.8846, z: -5.7615, width: 1.4769, depth: 2.1692 },
    ],
    doorX: -1.6,
    modelSize: 16.2797,
    walkIn: true,
  }),
  makePlacedBuilding({
    id: 'eastbrook_quay_cottage',
    assetId: '/models/tidehold/house_b.glb',
    kind: 'house',
    anchor: { x: -59.11, z: -51.35 },
    rotation: 46 * DEGREE,
    scale: STANDARD_SCALE,
    reach: { x: -0.3041, z: 0, width: 15.0123, height: 15.9799, depth: 11.6997 },
    walls: { x: 0, z: 0, width: 12.7538, depth: 8.5538 },
    annexes: [{ name: 'crates', x: -7.0308, z: -1.8231, width: 1.1538, depth: 2.2462 }],
    doorX: 0,
    modelSize: 15.9799,
    // no walkIn: the cottage's model bakes a shut door, so it stays one sealed box
  }),
] as const;

function buildingById(id: string) {
  const building = BUILDINGS.find((candidate) => candidate.id === id);
  if (!building) throw new Error(`missing Eastbrook building ${id}`);
  return building;
}

/**
 * The crafts lane's benches and their masters stand where the kit workshops'
 * doors were. Those workshops are gone (the placed smithy took their trade),
 * but the stations are the lane now, an open yard south of the square, and
 * the forge, the toolworks and the kitchens, their routes, master stands and
 * yard fence are still measured from the same workshop lots and the old inn
 * door. The loom left its lot to the apothecary's shop (LOOM_POSITION).
 */
function lotFront(position: Point2, rotation: number, depth: number, across = 0): Point2 {
  return localToWorld(position, rotation, across, depth / 2 + FRONT_CLEARANCE);
}
const FORGE_LOT = { position: { x: -2, z: -122 }, rotation: -2.0344439357957027, depth: 6.6 };
const TOOLWORKS_LOT = { position: { x: -16, z: -128 }, rotation: 0.5880026035475675, depth: 5.6 };
const KITCHENS_LOT = { position: { x: -38, z: -88 }, rotation: -2.5535900500422257, depth: 6.9 };

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

// The square's centrepiece: the Realm Builder monument, which replaced the
// well beacon and its floating crystal.
//
// nativeDimensions are the SHIPPED sculpt's own bounding box scaled to the
// height below, and they have to stay proportional: eastbrook_town.ts
// placementMatrix scales each axis independently, so a hand-rounded entry
// shears the statue.
//
// Round 8 (owner): DOUBLED, 3.8 yards to 7.6. The plinth now stands about 2.2
// yards, over head height, with its honour plates between knee and chest as
// you walk up; the builder is another 5.4 yards above that. It is the tallest
// thing in the square by a long way, which is the point. It does overlap the
// nominal civic ring band, and that is fine: `civic.ring` is a stated
// intent that nothing reads for collision or drawing (only a layout-suite pin
// reads it at all). What the size DOES cost is bench room, see BENCH_RING_RADIUS.
const MONUMENT_HEIGHT = 7.6;
const MONUMENT_SOURCE = { width: 0.755235, height: 0.991974, depth: 0.702649 } as const;
const MONUMENT_SCALE = MONUMENT_HEIGHT / MONUMENT_SOURCE.height;
// Tight cylinder, not the old loose 1.5: the widest point in the sculpt is the
// lantern outrigger ring at 0.415158 source units, and nothing above it reaches
// past 0.36, so one cylinder at that radius hugs the whole silhouette. Rounded
// UP by a 1cm skin so the collider never cuts inside its own art.
const MONUMENT_SOURCE_RADIUS = 0.415158;
const MONUMENT_RADIUS = Math.ceil(MONUMENT_SOURCE_RADIUS * MONUMENT_SCALE * 100) / 100;
// Front plate, and the builder's own face, aim down the east quadrant: the
// open spawn-to-square arrival lane, so the first side of the monument a
// player meets is the one carrying the current honouree. The sculpt faces +Z
// at rotation 0, and east in this town is NEGATIVE x (the arrival is at
// x -94 and the bench named "west" sits at +x of the civic centre), so the
// quarter turn goes the other way: a Y Euler rotation maps local +Z to world
// (sin, cos), and only -PI/2 lands that on -x. (Spelled without naming the
// renderer library, which this module is asserted never to mention.)
const MONUMENT_ROTATION = -Math.PI / 2;

const MONUMENT = {
  id: 'eastbrook_realm_builder_monument',
  assetId: '/models/props/eastbrook_realm_builder_monument.glb',
  // Reserved static-service id. The noticeboard band (content/noticeboards.ts)
  // runs 2_000_000_001 upward and is APPEND ONLY, so the monument takes a slot
  // clear of it rather than the next free number.
  entityId: 2_000_000_100,
  // The literal, not the types.ts constant: this module is asserted to carry
  // ZERO imports (tests/eastbrook_layout_suite.test.ts), so the two are pinned
  // equal by tests/realm_builder_monument.test.ts instead.
  templateId: 'realm_builder_monument',
  name: 'Realm Builder Monument',
  position: CIVIC_FEATURE_CENTER,
  rotation: MONUMENT_ROTATION,
  radius: MONUMENT_RADIUS,
  height: MONUMENT_HEIGHT,
  nativeDimensions: {
    width: MONUMENT_SOURCE.width * MONUMENT_SCALE,
    height: MONUMENT_HEIGHT,
    depth: MONUMENT_SOURCE.depth * MONUMENT_SCALE,
  },
} as const;

// Three cardinal benches occupy the quiet sides of the civic ring. The east
// quadrant deliberately remains open as the spawn-to-square arrival lane.
//
// Round 7 re-seated them for the monument, and moved what they ring. They used
// to sit 2.9 yards off CIVIC_CENTER, the square's own point; a statue is what
// people sit facing, so they now ring CIVIC_FEATURE_CENTER, the statue's own.
//
// Round 8 pushed them as far out as the square allows, because the doubled
// monument eats most of the room they used to have. The ceiling is the
// SOUTHWEST ROAD: its last centreline sample sits at (-9, -100.4), and the
// west bench's own box has to stay 1.5 yards off it, which caps the ring at
// 4.12 (solve hypot(|5.75 - R| - 0.3, 0.7) >= 1.5). At 4.1 that leaves about
// 0.6 yards between a bench back and the plinth: snug rather than roomy, and
// the most the square can give once the statue is this size. Anything wider
// reds tests/eastbrook_layout_suite.test.ts on the lane clearance.
//
// The graphics pass swapped the dungeon kit's bench for the painted Eastbrook
// bench, which keeps its own painted textures (render/eastbrook_town.ts draws
// it from its own GLB, not the vertex-coloured batch). Same 1.8 x 0.6 boxes,
// turns and ring; its seat stands 0.40 tall at this fit (sim/prop_layout.ts).
const BENCH_RING_RADIUS = 4.1;
const CIVIC_BENCH_ASSET = '/models/props/eastbrook_painted_bench.glb';
const BENCHES = [
  makeObbPlacement(
    'eastbrook_civic_bench_north',
    CIVIC_BENCH_ASSET,
    { x: CIVIC_FEATURE_CENTER.x, z: CIVIC_FEATURE_CENTER.z + BENCH_RING_RADIUS },
    1.8,
    0.6,
    Math.PI,
  ),
  makeObbPlacement(
    'eastbrook_civic_bench_south',
    CIVIC_BENCH_ASSET,
    { x: CIVIC_FEATURE_CENTER.x, z: CIVIC_FEATURE_CENTER.z - BENCH_RING_RADIUS },
    1.8,
    0.6,
    0,
  ),
  makeObbPlacement(
    'eastbrook_civic_bench_west',
    CIVIC_BENCH_ASSET,
    { x: CIVIC_FEATURE_CENTER.x + BENCH_RING_RADIUS, z: CIVIC_FEATURE_CENTER.z },
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

// The forge yard's low fence, on the far side of the forge bench from the
// lane: it stands where it stood behind the kit workshop, and closes the
// crafts yard off from the green now that the workshop is gone.
const FENCES = [
  makeFence(
    'eastbrook_fence_smithy_west',
    'smithy_yard',
    localToWorld(FORGE_LOT.position, FORGE_LOT.rotation, -5.0, -5.5),
    localToWorld(FORGE_LOT.position, FORGE_LOT.rotation, -5.0, -3.7),
    0.28,
    0.9,
  ),
  makeFence(
    'eastbrook_fence_smithy_outer',
    'smithy_yard',
    localToWorld(FORGE_LOT.position, FORGE_LOT.rotation, -4.7, -5.8),
    localToWorld(FORGE_LOT.position, FORGE_LOT.rotation, 4.7, -5.8),
    0.28,
    0.9,
  ),
  makeFence(
    'eastbrook_fence_smithy_east',
    'smithy_yard',
    localToWorld(FORGE_LOT.position, FORGE_LOT.rotation, 5.0, -5.5),
    localToWorld(FORGE_LOT.position, FORGE_LOT.rotation, 5.0, -3.7),
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
    existingRoadPoint: { x: 12.5, z: -71 },
    gateId: null,
    halfWidth: 1.5,
    // Swung west round the smithy's forge shelter, which stands on the old
    // line, so it leaves the square beside the coast track (the two run as
    // one wide way for a dozen yards) before turning back along the smithy's
    // north wall onto the old line, the silverleaf patch on the meadow above
    // (herb_eastbrook_4) left off the verge.
    points: [
      { x: 14.6, z: -88.6 },
      { x: 15.8, z: -83 },
      { x: 17, z: -76 },
      { x: 12.5, z: -71 },
      { x: 4, z: -67 },
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
    // The crafts lane: it stops short of the apothecary's shop, which took
    // the lane's old end and the loom yard beside it.
    points: [
      { x: -11, z: -105.5 },
      { x: -10, z: -112 },
      { x: -9, z: -119 },
      { x: -12, z: -123 },
      { x: -18.5, z: -121.5 },
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
  // A lane from the inn's door down to the main street, so the inn joins the
  // town's spine instead of floating beside it (owner refinement round 3; it
  // reaches up the slope to the door since the inn moved north of the farm
  // plots). APPENDED last: zone1's ZONE1_ROADS spreads these entries by
  // index, so new roads never land mid-array.
  {
    id: 'inn_lane',
    existingRoadPoint: { x: -44, z: -98 },
    gateId: null,
    halfWidth: 1.5,
    points: [
      { x: -35.75, z: -72.77 },
      { x: -37, z: -82 },
      { x: -38.5, z: -90 },
      { x: -40.5, z: -96 },
      { x: -44, z: -98 },
    ],
  },
] as const;

const BANK = buildingById('eastbrook_bank');
const CHAPEL = buildingById('eastbrook_chapel');
const SMITHY = buildingById('eastbrook_smithy');

// The apothecary's shop took the loom yard at the crafts lane's west end, so
// the loom stands across the lane's last bend, still in the yard south of the
// square, its weaver on the master's side of the bench (town_props.ts: the
// loom master stands at station -2, -1).
const LOOM_POSITION = { x: -18.5, z: -116.5 } as const;

const STATIONS = [
  {
    id: 'station_eastbrook_forge',
    type: 'forge',
    masterNpcId: 'forgemistress_darva',
    position: lotFront(FORGE_LOT.position, FORGE_LOT.rotation, FORGE_LOT.depth),
    interactionRadius: 20,
  },
  {
    id: 'station_eastbrook_kitchens',
    type: 'kitchens',
    masterNpcId: 'cook_marlow',
    // The tavern's kitchen yard, beside the inn lane where it meets the main
    // street (the World of ClaudeCraft Studio map keeps it there as the inn
    // moves up the slope).
    position: lotFront(KITCHENS_LOT.position, KITCHENS_LOT.rotation, KITCHENS_LOT.depth, 2.5),
    interactionRadius: 20,
  },
  {
    id: 'station_eastbrook_loom',
    type: 'loom',
    masterNpcId: 'weaver_ottilie',
    position: LOOM_POSITION,
    interactionRadius: 20,
  },
  {
    id: 'station_eastbrook_toolworks',
    type: 'toolworks',
    masterNpcId: 'tinker_gizzel',
    position: lotFront(TOOLWORKS_LOT.position, TOOLWORKS_LOT.rotation, TOOLWORKS_LOT.depth),
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
// Starter combat givers occupy the civic square with room between each stand.
// Wilkes keeps his vendor service on the market edge; trades stay at their stations.
const TRADER_POSITION = { x: -25, z: -94 } as const;
// The apothecary keeps her shop: she stands out from its door toward the
// square, looking up at it, so the starter combat givers still read as one
// group round the square (each within 12 yd of another, and none more than
// 18 yd off it, tests/eastbrook_combat_giver_visibility.test.ts).
const APOTHECARY_POSITION = { x: -24.5, z: -112.5 } as const;
// On the main street at the square's corner.
const BRANDT_POSITION = { x: -22.3, z: -104.6 } as const;
// On the open ground south-west of the square the Weekly Vault left (it
// stands at the bank now), within a short walk of Marshal Redbrook: with the
// apothecary's door down the crafts lane, he is the marshal's near neighbour.
const ODELL_POSITION = { x: -3.5, z: -104.5 } as const;
// Station cluster props sit at station + world-axis offsets (town_props.ts,
// no rotation), so the cook's work point derives the same way.
// Smith Haldren keeps the smithy: he stands at its door north of the square,
// looking out of it. Forgemistress Darva keeps the crafting station in the
// crafts lane south of the square.
const SMITH_POSITION = SMITHY.frontStandingPoint;
// Round 6b (owner): the forge and toolworks benches sit close together in the
// crafts lane, so their masters stand out to OPPOSITE sides of their own
// stations rather than both toward the middle. Each still works its bench;
// they just stop reading as one huddle.
const DARVA_POSITION = localToWorld(FORGE_STATION.position, FORGE_LOT.rotation, 4.2, 0);
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
const WEAVER_POSITION = { x: -20.5, z: -117.5 } as const;
const TINKER_POSITION = localToWorld(TOOLWORKS_STATION.position, TOOLWORKS_LOT.rotation, -3.2, 0);
const SAUL_POSITION = { x: 10.2, z: -87.5 } as const;
// Round 6b (owner): FURY is a service NPC (the honor quartermaster), so he
// belongs on the town's edge rather than in the churchyard approach: a few
// strides west of where the north road and the coast track leave the square
// side by side.
const FURY_POSITION = { x: 21, z: -83.5 } as const;

// Marshal stands beside the noticeboard, a full INTERACT_RANGE clear of
// both the board's body and its posting point so a player posting a notice
// is never handed his dialogue (tests/noticeboard_interaction.test.ts and
// the layout suite pin that clearance), facing the square that holds the
// other combat givers. He keeps the step he took out from the apothecary's
// shopfront when the first Tidehold layout stood the shop on his old ground
// (the shop is down on the strand now; the Studio rebuild map has him a
// hand's width further south, at z -95.5, which is inside the 2.5 yd the
// givers keep off the civic link road).
const MARSHAL_POSITION = { x: 1.5, z: -95.3 } as const;
// The chapel's door looks across the coast track to the square; Brother
// Aldric greets from the foot of its steps. The bursar and the card master
// flank the bank's door, a few strides out from it and either side of its
// line, looking out of it.
const ALDRIC_POSITION = CHAPEL.frontStandingPoint;
const BANK_DOOR_OUT = 4.16;
const BANK_DOOR_SIDE = 4.5;
const BURSAR_POSITION = localToWorld(
  BANK.frontStandingPoint,
  BANK.rotation,
  BANK_DOOR_SIDE,
  -BANK_DOOR_OUT,
);
const CARD_MASTER_POSITION = localToWorld(
  BANK.frontStandingPoint,
  BANK.rotation,
  -BANK_DOOR_SIDE,
  -BANK_DOOR_OUT,
);
const BANK_DOOR_FACING = BANK.frontFacing;

const NPCS = [
  makeNpc('the_merchant', MERCHANT_POSITION, MARKET_STALLS[0].rotation, MARKET_STALLS[0].id),
  makeNpc(
    'marshal_redbrook',
    MARSHAL_POSITION,
    facingToward(MARSHAL_POSITION, CIVIC_CENTER),
    'eastbrook_noticeboard',
  ),
  makeNpc(
    'trader_wilkes',
    TRADER_POSITION,
    facingToward(TRADER_POSITION, CIVIC_CENTER),
    'eastbrook_civic_square',
  ),
  makeNpc(
    'apothecary_lin',
    APOTHECARY_POSITION,
    facingToward(APOTHECARY_POSITION, CIVIC_CENTER),
    'eastbrook_apothecary',
  ),
  makeNpc('brother_aldric', ALDRIC_POSITION, CHAPEL.frontFacing, CHAPEL.id),
  // The smith looks OUT from his door, never at his own wall.
  makeNpc('smith_haldren', SMITH_POSITION, SMITHY.frontFacing, 'eastbrook_smithy'),
  makeNpc(
    'fisherman_brandt',
    BRANDT_POSITION,
    facingToward(BRANDT_POSITION, CIVIC_CENTER),
    'eastbrook_civic_square',
  ),
  makeNpc(
    'foreman_odell',
    ODELL_POSITION,
    facingToward(ODELL_POSITION, CIVIC_CENTER),
    'eastbrook_civic_square',
  ),
  makeNpc('bursar_fernando', BURSAR_POSITION, BANK_DOOR_FACING, BANK.id),
  makeNpc('card_master', CARD_MASTER_POSITION, BANK_DOOR_FACING, BANK.id),
  makeNpc('chronicler_saul', SAUL_POSITION, TOOLWORKS_LOT.rotation, 'mailbox_eastbrook'),
  makeNpc('forgemistress_darva', DARVA_POSITION, FORGE_LOT.rotation, FORGE_STATION.id),
  makeNpc(
    'cook_marlow',
    COOK_POSITION,
    facingToward(COOK_POSITION, KITCHENS_FIRE_POINT),
    KITCHENS_STATION.id,
  ),
  makeNpc(
    'weaver_ottilie',
    WEAVER_POSITION,
    facingToward(WEAVER_POSITION, LOOM_STATION.position),
    LOOM_STATION.id,
  ),
  makeNpc('tinker_gizzel', TINKER_POSITION, TOOLWORKS_LOT.rotation, TOOLWORKS_STATION.id),
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

// The churchyard's first plot: the props graveyard anchor, the Pale Keeper's
// stone. The second plot (zone1 graveyards) fills the yard's south end.
const GRAVEYARD_ANCHOR = { x: 37.5, z: -99.3 } as const;

// The Weekly Vault: a stone hall flush against the bank's harbour-side
// flank, its door looking the way the bank's does, toward the square. At the
// Studio map's own spot its box ran 0.34 yd into the bank's wall, so it
// stands half a yard further out along its own width; it stands on the
// bank's shelf (EASTBROOK_LAYOUT.pads).
const WEEKLY_VAULT = { x: -73.73, z: -103.4, rot: Math.PI / 4 } as const;

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
  // The churchyard moved with the chapel, off the rise the smithy took: its
  // graves stand inside the iron railings beside the chapel's north wall
  // (zone1 decorProps), the Pale Keeper over the first stone of the grid.
  graveyard: {
    id: 'gy_eastbrook',
    position: GRAVEYARD_ANCHOR,
    legacyReleasePoint: { x: GRAVEYARD_ANCHOR.x + 2, z: GRAVEYARD_ANCHOR.z },
    healerTemplateId: 'spirit_healer',
    healerFacing: Math.PI,
    // six stones on the props graveyard grid (2.2 yd apart in x, 2.6 in z)
    headstones: [0, 1, 2, 3, 4, 5].map((index) => ({
      id: `gy_eastbrook_headstone_${index}`,
      position: {
        x: GRAVEYARD_ANCHOR.x + (index % 3) * 2.2,
        z: GRAVEYARD_ANCHOR.z + Math.floor(index / 3) * 2.6,
      },
    })),
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
      // Out of the square's west corner, round the north end of the
      // churchyard's east rails and in through the gap the rails leave at its
      // north-east corner, toward the square (the rails are walk-through
      // dressing, but a walk to the graves keeps to the way in), stopping
      // short of the stones (solid colliders) within the Pale Keeper's reach.
      points: [
        { x: 14, z: -89 },
        { x: 20, z: -90.5 },
        { x: 26.5, z: -89.5 },
        { x: 33.6, z: -90.8 },
        { x: 37, z: -94 },
        { x: 38.6, z: -95.2 },
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

/** One level stamp of a building's pad (the HeightStamp shape, in plain data:
 *  this module imports nothing). */
export interface EastbrookPad {
  x: number;
  z: number;
  radius: number;
  delta: number;
  falloff: 'smooth';
  mode: 'level';
  hardness: number;
}

/**
 * Level pads under a rectangle: a grid of stamps whose solid cores just cover
 * its cells, so the level ground hugs the rectangle instead of spilling round
 * it in one great disc (the Highwatch pads, highwatch_layout.ts), with
 * `taper` yards of eased grade beyond. Every stamp levels to `height`.
 */
function padsOver(
  box: { center: Point2; halfWidth: number; halfDepth: number; rotation: number },
  height: number,
  columns: number,
  rows: number,
  taper: number,
): EastbrookPad[] {
  const cellWidth = (box.halfWidth * 2) / columns;
  const cellDepth = (box.halfDepth * 2) / rows;
  const core = Math.hypot(cellWidth / 2, cellDepth / 2);
  const radius = core + taper;
  const pads: EastbrookPad[] = [];
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      const center = localToWorld(
        box.center,
        box.rotation,
        -box.halfWidth + cellWidth * (column + 0.5),
        -box.halfDepth + cellDepth * (row + 0.5),
      );
      pads.push({
        x: center.x,
        z: center.z,
        radius,
        delta: height,
        falloff: 'smooth',
        mode: 'level',
        hardness: core / radius,
      });
    }
  }
  return pads;
}

// The ground under the placed buildings: each stands on a level shelf that
// covers its whole reach (porch, stair and eaves), so nothing grows up
// through a floor and no footing hangs over a dip, eased into the streets
// round it. The shelves keep to the town's grade: the bank, the vault on its
// flank and the apothecary's shop on the strand's lip at the main street's
// height (-0.7), the chapel on the plat beside the coast track (-0.9), and
// the smithy, the inn and the quay cottage on the rise north of the square
// (0.5), cut into it, each with a long taper so the banks behind them stay
// climbable. Neighbours share a height wherever their tapers overlap, so one
// pad never tilts another building's floor; the coastal ones keep a short
// taper that ends on the dry strand (no ground crosses the sea surface). In
// the built-in world they are the last stamps on their ground (data.ts), the
// Studio rebuild map carries the same list.
const BANK_SHELF = -0.7;
const CHAPEL_SHELF = -0.9;
const RISE_SHELF = 0.5;
const PADS: EastbrookPad[] = [
  ...padsOver(buildingById('eastbrook_bank').reach, BANK_SHELF, 5, 5, 4),
  // the vault and the apron before its door, on the bank's shelf
  ...padsOver(
    {
      center: localToWorld(WEEKLY_VAULT, WEEKLY_VAULT.rot, 0, 1.75),
      halfWidth: 7,
      halfDepth: 7.75,
      rotation: WEEKLY_VAULT.rot,
    },
    BANK_SHELF,
    2,
    2,
    4,
  ),
  ...padsOver(buildingById('eastbrook_smithy').reach, RISE_SHELF, 3, 2, 5),
  ...padsOver(buildingById('eastbrook_inn').reach, RISE_SHELF, 3, 3, 9),
  ...padsOver(buildingById('eastbrook_chapel').reach, CHAPEL_SHELF, 3, 4, 4),
  // a finer grid, so the shelf hugs the shop's seaward eaves and its taper is
  // spent before the strand reaches the water
  ...padsOver(buildingById('eastbrook_apothecary').reach, BANK_SHELF, 4, 4, 4),
  ...padsOver(buildingById('eastbrook_quay_cottage').reach, RISE_SHELF, 2, 2, 8),
];

export const EASTBROOK_LAYOUT = deepFreeze({
  id: 'eastbrook_civic_layout_v2',
  preservedBuildings: [] as readonly PreservedBuildingPlacement[],
  buildings: BUILDINGS,
  pads: PADS,
  // The vault stands where the Studio map stands it, against the bank's
  // harbour-side flank (WEEKLY_VAULT).
  weeklyVault: {
    id: 'eastbrook_weekly_vault',
    kind: 'house',
    x: WEEKLY_VAULT.x,
    z: WEEKLY_VAULT.z,
    w: 14,
    d: 12,
    rot: WEEKLY_VAULT.rot,
    height: 13,
    // 3 yd off the front face, 4.1 yd along it from the door toward the bank
    keeper: localToWorld(WEEKLY_VAULT, WEEKLY_VAULT.rot, 4.1, 9),
  },
  civic: {
    center: CIVIC_CENTER,
    ring: { radius: 4.75, pathHalfWidth: 1.5 },
    monument: MONUMENT,
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
