// The shared kit of the built-in towns that stand painted Tidehold buildings
// (sim/fenbridge_layout.ts and sim/highwatch_layout.ts make their placed
// buildings the same way; sim/eastbrook_layout.ts keeps the original copy).
// Pure geometry and record building: no engine imports, no randomness, no
// clocks, nothing mutable, so a frozen layout module can import it.

import { WORLD_LAYOUT } from './world_layout/active';
import { placeLayoutBuilding } from './world_layout/building';

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

/** The facing that looks from `from` toward `to` (facing 0 looks along +z). */
export function facingToward(from: Point2, to: Point2): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/** Normalize an angle into (-PI, PI]. */
export function wrapAngle(angle: number): number {
  let wrapped = angle % TAU;
  if (wrapped <= -Math.PI) wrapped += TAU;
  if (wrapped > Math.PI) wrapped -= TAU;
  return wrapped;
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

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

export function indexById<T extends { id: string }>(
  records: readonly T[],
): Readonly<Record<string, T>> {
  return deepFreeze(Object.fromEntries(records.map((record) => [record.id, record])));
}

/** One NPC stand of a town layout. */
export function makeTownNpc(id: string, position: Point2, facing: number, anchorId: string) {
  return { id, position, facing, anchorId, bodyRadius: 0.6 };
}

/** How a town stands its painted buildings: one uniform size, the lift that
 *  buries the model's yard of footing (and sinks its ground line a further
 *  0.05), and how far off the wall face a visitor stands at the door. */
export interface PlacedTownSeat {
  scale: number;
  lift: number;
  frontClearance: number;
}

/**
 * A PLACED building: one of the painted Tidehold models stood at `anchor`
 * (where the model's own origin goes) with `rotation` and the town's seat.
 * `walls` is the walled body in the model's own axes, in yards at the placed
 * size: `position`, `nativeDimensions` and `footprint` are that rectangle, so
 * collision, the rest area and the map silhouette follow the walls a player
 * sees rather than the eaves above them. `annexes` are the parts outside the
 * wall box that are just as solid (a turret, a bell tower, a forge shelter),
 * each one more box in the same axes. `reach` is the whole ground rectangle
 * the model covers (porch, stair, awning and chimney included): the draw cull
 * and the grass clearing read that one. These models face local -Z, so the
 * door and its standing point are on the -Z side. A `walkIn` record collides
 * on the model's own baked walls and stands its floor as walkable ground
 * (sim/town_walk_in.ts); without it the record is one sealed box.
 */
export function makePlacedTownBuilding<Kind extends 'house' | 'inn' | 'chapel'>(
  spec: {
    id: string;
    assetId: string;
    kind: Kind;
    anchor: Point2;
    rotation: number;
    /** The whole model in its own axes: its centre off the origin, its ground
     *  extents, and its full height from the bottom of its footing. */
    reach: { x: number; z: number; width: number; height: number; depth: number };
    /** The walled body in the model's own axes. */
    walls: { x: number; z: number; width: number; depth: number };
    /** Solid parts outside the wall box, in the model's own axes. */
    annexes?: readonly { name: string; x: number; z: number; width: number; depth: number }[];
    /** Where the door sits along the front (local -Z) face. */
    doorX: number;
    walkIn?: boolean;
  },
  seat: PlacedTownSeat,
) {
  const position = localToWorld(spec.anchor, spec.rotation, spec.walls.x, spec.walls.z);
  const wallFrontZ = spec.walls.z - spec.walls.depth / 2;
  const annexes: Obb2[] = (spec.annexes ?? []).map((annex) => ({
    id: `${spec.id}:${annex.name}`,
    center: localToWorld(spec.anchor, spec.rotation, annex.x, annex.z),
    halfWidth: annex.width / 2,
    halfDepth: annex.depth / 2,
    rotation: spec.rotation,
  }));
  const doorSocket = localToWorld(spec.anchor, spec.rotation, spec.doorX, wallFrontZ);
  const frontStandingPoint = localToWorld(
    spec.anchor,
    spec.rotation,
    spec.doorX,
    wallFrontZ - seat.frontClearance,
  );
  const building = {
    id: spec.id,
    assetId: spec.assetId,
    kind: spec.kind,
    walkIn: spec.walkIn === true,
    position,
    nativeDimensions: {
      width: spec.walls.width,
      // above the ground line: the footing below it is buried
      height: spec.reach.height + seat.lift,
      depth: spec.walls.depth,
    },
    rotation: spec.rotation,
    footprint: {
      id: spec.id,
      center: position,
      halfWidth: spec.walls.width / 2,
      halfDepth: spec.walls.depth / 2,
      rotation: spec.rotation,
    },
    maxCornerRadius: Math.hypot(spec.walls.width / 2, spec.walls.depth / 2),
    frontClearance: seat.frontClearance,
    frontStandingPoint,
    /** The way a visitor looks standing at the door, facing out of it. */
    frontFacing: wrapAngle(spec.rotation + Math.PI),
    sockets: {
      entrance: {
        id: `${spec.id}_entrance`,
        // In the MODEL's own axes: the door on the -Z face.
        localPosition: { x: spec.doorX, z: wallFrontZ },
        position: doorSocket,
        standingPoint: frontStandingPoint,
      },
    },
    placement: {
      x: spec.anchor.x,
      z: spec.anchor.z,
      rotation: spec.rotation,
      scale: seat.scale,
      lift: seat.lift,
      /** The model's largest dimension at authored size: its baked collision
       *  rows are stored in multiples of this over the placed-asset target
       *  height (sim/town_walk_in.ts). `reach` is at the placed size, so the
       *  seat's scale comes back out. */
      modelSize: Math.max(spec.reach.width, spec.reach.height, spec.reach.depth) / seat.scale,
    },
    annexes,
    reach: {
      id: spec.id,
      center: localToWorld(spec.anchor, spec.rotation, spec.reach.x, spec.reach.z),
      halfWidth: spec.reach.width / 2,
      halfDepth: spec.reach.depth / 2,
      rotation: spec.rotation,
    },
  };
  return placeLayoutBuilding(building, WORLD_LAYOUT.buildings[spec.id]);
}

export type PlacedTownBuilding = ReturnType<typeof makePlacedTownBuilding>;

/** The shape of a placed building's measurements in the model's own axes. */
export interface PlacedTownMeasurements {
  reach: { x: number; z: number; width: number; height: number; depth: number };
  walls: { x: number; z: number; width: number; depth: number };
  annexes?: readonly { name: string; x: number; z: number; width: number; depth: number }[];
  doorX: number;
}

/** A building's measurements taken at the model's AUTHORED size, carried to a placed
 *  `scale` (every length grows with it, the anchor stays where the model's origin is). */
export function scalePlacedTownMeasurements<T extends PlacedTownMeasurements>(
  spec: T,
  scale: number,
): T {
  const r = spec.reach;
  const w = spec.walls;
  return {
    ...spec,
    reach: {
      x: r.x * scale,
      z: r.z * scale,
      width: r.width * scale,
      height: r.height * scale,
      depth: r.depth * scale,
    },
    walls: { x: w.x * scale, z: w.z * scale, width: w.width * scale, depth: w.depth * scale },
    annexes: spec.annexes?.map((annex) => ({
      name: annex.name,
      x: annex.x * scale,
      z: annex.z * scale,
      width: annex.width * scale,
      depth: annex.depth * scale,
    })),
    doorX: spec.doorX * scale,
  };
}

/** The seat of a painted Tidehold model (one yard of footing under its ground line at
 *  authored size) stood at `scale`: the lift buries the scaled footing and sinks the
 *  ground line a further 0.05, the seat every town gives them. */
export function placedTownSeat(scale: number, frontClearance: number): PlacedTownSeat {
  return { scale, lift: -(scale + 0.05), frontClearance };
}

/** One level stamp of a town's pads, before its falloff and mode are set. */
export interface TownPadStamp {
  x: number;
  z: number;
  radius: number;
  delta: number;
  hardness: number;
  gx?: number;
  gz?: number;
}

/**
 * Level ground under a building: a grid of `columns` by `rows` stamps along
 * its reach's own axes, each a hard disc over its cell that tapers `taper`
 * yards past the cell's corner, so the level ground hugs the walls instead of
 * spilling across the square (Highwatch's pads, sim/highwatch_layout.ts).
 */
export function padsAlong(
  building: { readonly reach: Obb2 },
  height: number,
  columns: number,
  rows: number,
  taper: number,
): TownPadStamp[] {
  const reach = building.reach;
  const cellWidth = (reach.halfWidth * 2) / columns;
  const cellDepth = (reach.halfDepth * 2) / rows;
  const core = Math.hypot(cellWidth / 2, cellDepth / 2);
  const radius = core + taper;
  const pads: TownPadStamp[] = [];
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      const center = localToWorld(
        reach.center,
        reach.rotation,
        -reach.halfWidth + cellWidth * (column + 0.5),
        -reach.halfDepth + cellDepth * (row + 0.5),
      );
      pads.push({ x: center.x, z: center.z, radius, delta: height, hardness: core / radius });
    }
  }
  return pads;
}

/** One building's ground in a town's pads: the height its reach is levelled
 *  to, the grid of stamps over it, the pad's short taper and the apron's wide one. */
export interface TownGround {
  readonly building: { readonly reach: Obb2 };
  readonly height: number;
  readonly columns: number;
  readonly rows: number;
  readonly taper: number;
  readonly apron: number;
}

/**
 * A town's level pads, laid the way Highwatch lays them: every building's wide
 * soft APRON first (the hill eases down to it, and the fill out from it, at a
 * walkable grade), then the caller's `between` stamps (a square re-levelled, a
 * lane graded between two heights), then every building's own pad with its
 * short taper, so each reach ends exactly level whatever the aprons left under
 * it, then the `after` stamps (ground a pad must not carry away). Smooth level
 * stamps, ready for the built-in world's terrain edits.
 */
export function levelTownPads(
  ground: readonly TownGround[],
  stamps: {
    readonly between?: readonly TownPadStamp[];
    readonly after?: readonly TownPadStamp[];
  } = {},
) {
  return [
    ...ground.flatMap((g) => padsAlong(g.building, g.height, g.columns, g.rows, g.apron)),
    ...(stamps.between ?? []),
    ...ground.flatMap((g) => padsAlong(g.building, g.height, g.columns, g.rows, g.taper)),
    ...(stamps.after ?? []),
  ].map((pad) => ({ ...pad, falloff: 'smooth' as const, mode: 'level' as const }));
}
