import {
  authoredPrismsForPath,
  authoredRampsForPath,
  type BakedCollisionBox,
  bakedBoxesForPath,
} from './asset_collision';
import {
  BANKER_CHEST_HALF_DEPTH,
  BANKER_CHEST_HALF_WIDTH,
  BANKER_CHEST_TARGET_HEIGHT,
  type BankerChestBlockedAt,
  type BankerChestLocalPlacement,
  bankerChestCenterWorld,
  resolveSolidBankerChestPlacement,
} from './banker_chest_layout';
import { battlegroundColliders } from './battleground_layout';
import {
  buildingCameraHeight,
  buildingTerrainEnvelope,
  isEastbrookGrandArmoury,
} from './building_layout';
import {
  buildColliderCellIndex,
  type ColliderCellIndex,
  cellKey,
  cellKeyAt,
  colliderBounds,
  colliderCellAt,
  GRID_CELL,
  MAX_BODY_RADIUS,
} from './collider_cells';
import { MOUNT_RACE_JUMP_FIXTURES, raceGateSegment } from './content/mounts';
import {
  arenaOriginAt,
  BG_SLOT_COUNT,
  BUILTIN_WORLD,
  battlegroundOrigin,
  DUNGEON_FLOOR_Y,
  DUNGEON_X_THRESHOLD,
  DUNGEONS,
  defaultDelveModules,
  delveAt,
  delveModuleLocal,
  GATHER_NODES,
  getActiveWorldContent,
  INSTANCE_SLOT_COUNT,
  instanceOrigin,
  isArenaPos,
  isBgPos,
  isDelvePos,
  isRiftPos,
  isYumiMazePos,
  PORTALS,
  RIFT_REGION_HALF_X,
  RIFT_REGION_HALF_Z,
  riftNearestFloorOriginZ,
  STRIP_MAX_X,
  STRIP_MIN_X,
  yumiMazeOriginAt,
} from './data';
import { usesOverworldSiteDressing } from './map_presentation';
import type { CollisionPrism } from './mesh_prisms';
import { invalidatePlacementRamps } from './placement_ramps';

// Re-exported from the extracted cell-index module so existing importers keep
// their './colliders' path.
export { MAX_BODY_RADIUS } from './collider_cells';

import {
  DAWNHOLD_PARAPET_HALF,
  DAWNHOLD_WALL_LEDGES,
  dawnholdParapetSegments,
} from './dawnhold_layout';
import { buildDecorPropColliders } from './decor_prop_colliders';
import {
  decorationHasCollider,
  ROCK_RADIUS_PER_SCALE,
  rockHeight,
  rockRadius,
} from './decoration_dims';
import { type DelveModuleId, delveModuleColliders } from './delve_layout';
import { isLitanyModuleId, litanyModuleLosColliders } from './delve_litany_layout';
import { dungeonDoorJambColliders } from './dungeon_door_jambs';
import { dungeonInstanceAt, INTERIOR_LAYOUTS } from './dungeon_floor';
import {
  ARENA_LAYOUT,
  CRYPT_LAYOUT,
  DAWNHOLD_LAYOUT,
  DROWNED_COURT_LAYOUT,
  LASTKEEP_LAYOUT,
  layoutColliders,
} from './dungeon_layout';
import { emberLilySpots } from './ember_lilies';
import { isAuthoredTownBuildingDef } from './authored_town_buildings';
import { fenWillowSpots, hollowWillowSpots } from './fen_willows';
import { FENBRIDGE_LAYOUT } from './fenbridge_layout';
import { forgefatherFortressColliders, forgefatherStreetlampSites } from './forgefather_fortress';
import { derivedInteriorColliders } from './interior_collider_sets';
import {
  benchDrawnHeight,
  CHAPEL_HALL,
  CHAPEL_HALL_ROOF_EAVE,
  CHAPEL_HALL_ROOF_TOP,
  CHAPEL_TOWER,
  campCrateShape,
  DELVE_ARCH_HD,
  DELVE_ARCH_HEIGHT,
  DELVE_ARCH_HW,
  DOCK_BOAT,
  DOCK_DRESSING,
  delveArchZ,
  GATHER_NODE_BODIES,
  GRAVE_COUNT,
  GRAVE_RADIUS,
  graveHeight,
  graveOffset,
  MAILBOX_HD,
  MAILBOX_HW,
  MINE_CART,
  propPlacementRoll,
  SMITHY_DRESSING,
  STALL_DRESSING,
  TOWN_WALL_PARAPET_FRAC,
  TOWN_WALL_PILLAR_HW_FRAC,
  TOWN_WALL_SHORT_PILLAR_ALONG,
  TOWN_WALL_SHORT_PILLAR_TOP_FRAC,
  TOWN_WALL_TALL_PILLAR_ALONG,
} from './prop_layout';
import { type PlacedStreetlamp, planStreetlamps, styleStreetlampSites } from './streetlamp_layout';
import { STREETLAMP_COLLIDER_RADIUS, STREETLAMP_FIXTURE_HEIGHT } from './streetlamp_style';
import { townPropPlacements } from './town_props';
import type { PlacedAsset, WorldContent } from './types';
import { WILDHEART_COLLIDERS } from './wildheart_field';
import {
  crossesSealedBorder,
  type Decoration,
  farshorePalmSpots,
  gardenMazeCellPieces,
  generateDecorationsInBounds,
  groundHeight,
  MAZE_CELL,
  MAZE_COLS,
  MAZE_ROWS,
  MAZE_WALL_DEPTH,
  MAZE_WALL_HEIGHT,
  MAZE_X0,
  MAZE_Z1,
  reachPalmSpots,
  roadDistance,
  terrainHeight,
  waterLevelAt,
} from './world';
import { yumiMazeColliders } from './yumi_maze_layout';

// Static world collision. Prop placement comes from the per-zone content
// modules (merged into PROPS by sim/data.ts): the renderer builds its meshes
// from the same defs, so what you see is what you collide with.
// Sim layer: no three.js imports.

export interface CircleCollider {
  type: 'circle';
  x: number;
  z: number;
  r: number;
  /** Absolute world-space visual top used by sight checks; movement ignores it. */
  cameraTopY?: number;
  /**
   * Absolute world-space BASE (the ground the obstacle stands on). A mover
   * whose head is below it passes underneath — cave tubes run under surface
   * props, and an authored upper storey does not wall the floor below it.
   * Absent = height-agnostic (blocker walls, interior wall sets): blocks at
   * every depth, which is every collider the shipped world builds.
   */
  baseY?: number;
  /**
   * Pass-under floor for MOVEMENT only (the shipped world's surface props):
   * a body walking a cave tube or carve sheet below this height passes under
   * the prop instead of hitting its 2D footprint. Deliberately NOT `baseY`,
   * which also suppresses the collider in `sightBlockedAt`: the open world has
   * no terrain occlusion in that model, so a prop standing on a bank is the
   * only thing blocking a sight line across it, and letting a distant low eye
   * see under it would let mobs and pets see through the bank.
   */
  underY?: number;
  /**
   * Absolute world-space top of the PHYSICAL obstacle for movement (parkour):
   * a mover whose feet reach this height passes over instead of being walled
   * (see `passesOver`). Distinct from `cameraTopY`, which follows the visual
   * silhouette and often includes flames or roofs taller than the solid body.
   * Undefined means full-height, blocking at any altitude (buildings, trees, wells).
   */
  moveTopY?: number;
  /**
   * A mover may stand ON `moveTopY` (crates, rocks): the top feeds
   * `supportHeightAt` (landing/walking surface) and grants the airborne
   * mantle lift, so a jump at the rim hoists the body onto the top.
   */
  standable?: boolean;
  /** Optional pitched surface for the standable top (see {@link TopSlope}). */
  topSlope?: TopSlope;
  /**
   * Absolute world-space UNDERSIDE of an elevated slab: a mover with height
   * whose head clears this passes BENEATH the collider (the balcony-walk
   * contract; see `passesOver`). Height-less movers (mobs, pathfinding) never
   * read it, so to them the slab stays a full-height solid by design.
   * Undefined means nothing passes under (the default for everything).
   */
  passUnderY?: number;
  /** Engine bookkeeping: index into the owning grid's dedupe stamp buffer. */
  gridIndex?: number;
  /**
   * Dev attribution: which source emitted this collider (a placement's model
   * path plus its lane, e.g. "/models/props/inn.glb#prism"). Never read by
   * gameplay — the playtest Dev panel surfaces it so an invisible wall can
   * name itself. Absent = a built-in record collider.
   */
  src?: string;
}

export interface ObbCollider {
  type: 'obb';
  x: number;
  z: number;
  hw: number; // half width (local x)
  hd: number; // half depth (local z)
  rot: number; // yaw, three.js rotation.y convention
  /** Absolute world-space visual top used by sight checks; movement ignores it. */
  cameraTopY?: number;
  /** See {@link CircleCollider.baseY}. */
  baseY?: number;
  /** See {@link CircleCollider.underY}. */
  underY?: number;
  /** See {@link CircleCollider.moveTopY}. */
  moveTopY?: number;
  /** See {@link CircleCollider.standable}. */
  standable?: boolean;
  /** See {@link CircleCollider.topSlope}. */
  topSlope?: TopSlope;
  /** See {@link CircleCollider.passUnderY}. */
  passUnderY?: number;
  /**
   * Low fence rail: a grounded mover collides normally, but a mover that is
   * airborne above the rail (see `FENCE_RAIL_HEIGHT`) jumps clear of it. Set on
   * the OBBs built from `PROPS.fences`.
   */
  isFence?: boolean;
  /** See {@link CircleCollider.gridIndex}. */
  gridIndex?: number;
  /** See {@link CircleCollider.src}. */
  src?: string;
}

/**
 * A convex banded prism: the shape a Collision Master volume collides as.
 *
 * An OBB is a 4-gon prism, so this loses nothing and gains the sections a
 * rectangle could only approximate — hexagonal rocks, round towers, angled
 * walls. It exists because the maker's authored volumes ARE the contract:
 * fitting rectangles to them put a large share of the collider outside the
 * drawn shape, which in game is an invisible wall short of the thing modelled.
 */
export interface PrismCollider {
  type: 'prism';
  /** See {@link CircleCollider.passUnderY}. */
  passUnderY?: number;
  /** Outline anchor (the placement's world position). */
  x: number;
  z: number;
  /** Convex outline, counter-clockwise, in world yards RELATIVE to (x, z):
   *  flat u,v pairs. Relative so the anchor alone drives broad-phase bounds. */
  poly: readonly number[];
  /** Bounding radius of `poly` about (x, z) — the O(1) narrow-phase reject, so
   *  a prism costs less than an OBB for every mover that is not touching it. */
  br: number;
  /**
   * LOFT outlines (world yards relative to x,z, same vertex count and
   * correspondence as `poly`): the authored section at baseY and at moveTopY.
   * Height-aware consumers interpolate between them at the mover's own feet
   * height (see prismPolyAt), so a tapered Collision Master volume collides
   * exactly as drawn instead of as a stack of flat-walled hulls. `poly`
   * stays the coverage-complete union hull for height-blind consumers.
   */
  polyLo?: readonly number[];
  polyHi?: readonly number[];
  /** See {@link CircleCollider.cameraTopY}. */
  cameraTopY?: number;
  /** See {@link CircleCollider.baseY}. */
  baseY?: number;
  /** See {@link CircleCollider.underY}. */
  underY?: number;
  /** See {@link CircleCollider.moveTopY}. An authored volume is a real physical
   *  body, so the parkour solver reads its top exactly like a crate's. */
  moveTopY?: number;
  /** See {@link CircleCollider.standable}. This is what lets an authored deck
   *  (a second storey, a ramp landing) carry a body rather than only block it. */
  standable?: boolean;
  /** See {@link CircleCollider.topSlope}. */
  topSlope?: TopSlope;
  /** See {@link CircleCollider.gridIndex}. */
  gridIndex?: number;
  /** See {@link CircleCollider.src}. */
  src?: string;
}

export type Collider = CircleCollider | ObbCollider | PrismCollider;

/**
 * The collider shape a HAND-AUTHORED layout emits (arena, delves, rifts, the
 * battleground, interior wall sets, shipped-map imports). Prisms only ever come
 * from a placement's Collision Master volumes, so layout code can keep reading
 * `hw`/`hd`/`rot` off anything that is not a circle.
 */
export type LayoutCollider = CircleCollider | ObbCollider;

/**
 * A shaped (non-flat) standable top: real roofs pitch. `moveTopY` stays the
 * MAXIMUM surface height (the ridge line or cone peak), so blocking logic can
 * keep using it conservatively; the sampled surface only ever falls from
 * there, clamped at the eaves. `colliderTopAt` is the one sampler.
 */
export interface TopSlope {
  /** 'ridge': gable with a straight high line; 'cone': radial peak at the
   *  circle's centre. */
  kind: 'ridge' | 'cone';
  /** Which LOCAL axis the ridge's high line runs along ('x' default): the
   *  surface falls across the other axis. Measured per asset (house_3 and
   *  the coffins ridge along their local z, the market stands along x). */
  axis?: 'x' | 'z';
  /** surface drop per yard of run away from the ridge line / peak */
  pitch: number;
  /** lowest surface height (absolute Y); the slope clamps here (the eaves) */
  eaveY: number;
}

/**
 * The standable surface height of a collider at a point: `moveTopY` for flat
 * tops, the pitched surface for sloped ones (never above `moveTopY`, never
 * below the eaves). Infinity for full-height colliders, which have no top.
 */
export function colliderTopAt(c: Collider, x: number, z: number): number {
  const top = c.moveTopY;
  if (top === undefined) return Infinity;
  const s = c.topSlope;
  if (!s) return top;
  let run: number;
  // A prism has no single yaw to measure a ridge across, so a sloped one falls
  // radially like a cone.
  if (s.kind === 'cone' || c.type === 'circle' || c.type === 'prism') {
    run = Math.hypot(x - c.x, z - c.z);
  } else {
    const cos = Math.cos(-c.rot);
    const sin = Math.sin(-c.rot);
    const lx = (x - c.x) * cos + (z - c.z) * sin;
    const lz = -(x - c.x) * sin + (z - c.z) * cos;
    // The surface falls across the axis PERPENDICULAR to the ridge line.
    run = s.axis === 'z' ? Math.abs(lx) : Math.abs(lz);
  }
  return Math.max(s.eaveY, top - run * s.pitch);
}

// ---------------------------------------------------------------------------
// Parkour heights (movement-blocking tops, mantle, standable support)
// ---------------------------------------------------------------------------

/**
 * How far above a mover's feet a STANDABLE top may still sit and be treated as
 * passable while airborne: the mantle assist. A jump whose apex falls short of
 * a crate rim by up to this much still carries the body over, and the support
 * snap in the movement kernel then seats the feet on the top (the vault).
 *
 * It is pinned to the grounded stride band (`MAX_STEP_HEIGHT` in
 * `physics/character.ts`; the equality is pinned by
 * `tests/physics_character.test.ts`) rather than tuned on its own, for two
 * reasons. An airborne body must never lose ground a grounded stride crosses
 * for free, and this ONE number is read by BOTH halves of the tick: the
 * horizontal gates (`passesOver` here, `blocksAt` in the solver) and the
 * vertical support query (`floorHeightAt`'s `maxY` in `player_motion.ts`).
 * They must move together, or the horizontal pass admits a top the landing
 * snap then refuses to seat and the body tunnels into the prop. It also
 * leaves the traversal ladder gapless: `LEDGE_GRAB_MIN` is the same 0.9, so
 * every standable top is either vaulted or grabbed, never a mid-air wall.
 * The literal lives here (not imported) because `physics/` imports this
 * module, never the reverse.
 */
export const MANTLE_REACH = 0.9;
/** Float slack when comparing feet height against a collider top. */
export const MOVE_TOP_EPS = 1e-3;
// How much of the body radius must overlap a standable top before it supports
// the mover: standing needs the center meaningfully over the prop, while the
// full collision radius still gates entry, so a jump can graze past a rim
// without being captured by it.
export const SUPPORT_OVERLAP = 0.5;
// Physical movement tops (yards above the prop's ground). The visual/sight
// tops above stay untouched: cameraTopY for a campfire includes the flame,
// but the SOLID obstacle is only the log pile, which is what a jump clears.
// Exported so tests pin against the one authoritative value.
export const CAMPFIRE_MOVE_TOP = 0.55;
export { campCrateShape } from './prop_layout';
// Standable roofs, all MEASURED from the shipped GLBs at the scales the
// renderer places them (dequantized bounds; see docs/design/physics-asset-audit.md).
// The tops are SHAPED: gables falling from a ridge line to real eaves, so
// feet track the pitched surface the eye sees.
// Market stand (market_stand_1/2 scaled to 3.1 x 2.6 x 2.5, group sunk 0.06):
// a 3.1 x 2.5 BOX whose steep awning ridges along the stall's local x axis,
// falling from 2.54 at the ridge to 1.50 at the front/back edges. The eave is
// vault height (jump on at the edge), the ridge climb height.
export const STALL_HALF_W = 1.55;
export const STALL_HALF_D = 1.25;
export const STALL_CANOPY_TOP = 2.54;
export const STALL_CANOPY_EAVE = 1.5;
// Dock hut / chapel hall use house_3, whose roof ridges along the model's
// local z (the OBB depth) and whose eaves sit at 60 percent of the height:
// walls to ~1.57, then the big pitched roof. The hut is scaled to 2.6 tall.
export const DOCK_HUT_ROOF_TOP = 2.6;
export const DOCK_HUT_ROOF_EAVE = 1.57;

/** The mover's feet altitude plus how much standable lift it gets (the
 * airborne mantle assist). Both hosts derive it from the SAME entity fields so
 * the server sim and the client self extrapolator gate colliders identically. */
export interface MoverHeight {
  y: number;
  lift: number;
}

export function moverHeight(e: { pos: { y: number }; onGround: boolean }): MoverHeight {
  return { y: e.pos.y, lift: e.onGround ? 0 : MANTLE_REACH };
}

/** Head clearance a mover with height needs to walk beneath an elevated slab
 *  (`passUnderY`): a touch above the tallest body so a deck one yard overhead
 *  still walls, while a real balcony admits the walk below. */
const PASS_UNDER_HEADROOM = 2.1;

// Does the mover pass clean over this collider at (x, z)? Full-height
// colliders (moveTopY undefined) never pass; standable tops grant the mantle
// lift. Sloped tops are sampled at the mover's own point, so the eaves of a
// roof pass a body the ridge would still wall. An elevated slab that carries
// `passUnderY` also passes the mover walking BENEATH it when their head
// clears its underside (the balcony-walk contract); height-less movers never
// reach here, so mobs and pathfinding still see a full-height solid.
function passesOver(c: Collider, mover: MoverHeight | undefined, x: number, z: number): boolean {
  if (!mover || c.moveTopY === undefined) return false;
  if (c.passUnderY !== undefined && mover.y + PASS_UNDER_HEADROOM <= c.passUnderY) return true;
  return colliderTopAt(c, x, z) <= mover.y + (c.standable ? mover.lift : 0) + MOVE_TOP_EPS;
}

// Pass-under gate: a mover this tall (head height) fits beneath a collider
// whose base is at least the margin above the head — cave tubes run under
// surface props/trees/fences without hitting their 2D footprints, and an
// authored second storey does not wall the floor below. Colliders with no
// baseY (everything the shipped world builds) block at every depth.
const MOVER_HEAD_Y = 2.0;
const UNDER_PASS_MARGIN = 0.4;

export function passesUnder(c: Collider, moverY: number | undefined): boolean {
  const floor = c.underY ?? c.baseY;
  return (
    moverY !== undefined && floor !== undefined && moverY + MOVER_HEAD_Y < floor - UNDER_PASS_MARGIN
  );
}

function topY(seed: number, x: number, z: number, height: number): number {
  return groundHeight(x, z, seed) + height;
}

// rotate a local offset by a three.js rotation.y angle
function rotY(lx: number, lz: number, rot: number): { x: number; z: number } {
  const c = Math.cos(rot),
    s = Math.sin(rot);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

// Scratch for prismPolyAt: consumed immediately by the caller, never held.
let prismOutlineView: number[] = [];

/**
 * The prism's effective outline for a body whose FEET are at `feetY`:
 * the loft interpolated at that height when the prism carries one, else the
 * union hull. Returns a shared scratch view - consume before the next call.
 */
export function prismPolyAt(c: PrismCollider, feetY: number | undefined): readonly number[] {
  const lo = c.polyLo;
  const hi = c.polyHi;
  if (
    feetY === undefined ||
    !lo ||
    !hi ||
    c.baseY === undefined ||
    c.moveTopY === undefined ||
    c.moveTopY - c.baseY < 1e-6 ||
    lo.length !== hi.length
  ) {
    return c.poly;
  }
  const t = Math.min(1, Math.max(0, (feetY - c.baseY) / (c.moveTopY - c.baseY)));
  const n = lo.length;
  if (prismOutlineView.length !== n) prismOutlineView = new Array(n);
  for (let i = 0; i < n; i++) {
    prismOutlineView[i] = lo[i] + (hi[i] - lo[i]) * t;
  }
  return prismOutlineView;
}

/** Row-major 3x3 for the renderer's XYZ euler, so a tilted placement's
 *  collision leans with the model instead of standing where the untilted asset
 *  was. Matches THREE.Euler(x, y, z, 'XYZ') exactly. */
function eulerMatrix(rx: number, ry: number, rz: number): number[] {
  const cx = Math.cos(rx),
    sx = Math.sin(rx),
    cy = Math.cos(ry),
    sy = Math.sin(ry),
    cz = Math.cos(rz),
    sz = Math.sin(rz);
  return [
    cy * cz,
    -cy * sz,
    sy,
    cx * sz + sx * sy * cz,
    cx * cz - sx * sy * sz,
    -sx * cy,
    sx * sz - cx * sy * cz,
    sx * cz + cx * sy * sz,
    cx * cy,
  ];
}

function applyMat(m: readonly number[], x: number, y: number, z: number): Point3 {
  return {
    x: m[0] * x + m[1] * y + m[2] * z,
    y: m[3] * x + m[4] * y + m[5] * z,
    z: m[6] * x + m[7] * y + m[8] * z,
  };
}

interface Point3 {
  x: number;
  y: number;
  z: number;
}

const NO_AUTHORED_PRISMS: readonly CollisionPrism[] = [];

/** Signed area sign of a closed XZ outline; negative means clockwise. */
function outlineWinding(hull: readonly [number, number][]): number {
  let signed = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    signed += a[0] * b[1] - b[0] * a[1];
  }
  return signed;
}

/** Convex hull of an XZ point cloud (monotone chain), for a tilted outline. */
function convexHullXZ(points: readonly [number, number][]): [number, number][] {
  if (points.length < 3) return [...points];
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (src: [number, number][]): [number, number][] => {
    const out: [number, number][] = [];
    for (const p of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...build(pts), ...build([...pts].reverse())];
}

/**
 * Emit one banded PRISM per authored Collision Master volume of a placement.
 *
 * The outline MUST come out counter-clockwise: pushOutPrism reads the interior
 * as "left of every edge", so a reversed one inverts the collider and makes the
 * whole world solid except inside it. Rotation preserves winding; a mirroring
 * scale would not, hence the explicit re-check.
 */
function emitPlacementPrisms(
  out: Collider[],
  p: PlacedAsset,
  prisms: readonly CollisionPrism[],
  base: number,
): void {
  const lift = p.y ?? 0;
  const s = p.scale > 0 ? p.scale : 1;
  const sx = s * (p.scaleX ?? 1);
  const sy = s * (p.scaleY ?? 1);
  const sz = s * (p.scaleZ ?? 1);
  const tiltX = p.rotX ?? 0;
  const tiltZ = p.rotZ ?? 0;
  // A tilted placement leans its collision with the model: every outline corner
  // goes through the FULL rotation and the leaned prism becomes the convex
  // shadow of that, banded by the corners' Y span.
  const m = tiltX !== 0 || tiltZ !== 0 ? eulerMatrix(tiltX, p.rotY, tiltZ) : null;
  for (const prism of prisms) {
    const flat: [number, number][] = [];
    let loY = Infinity;
    let hiYLocal = -Infinity;
    for (let i = 0; i < prism.poly.length; i += 2) {
      const mx = prism.poly[i] * sx;
      const mz = prism.poly[i + 1] * sz;
      if (m) {
        for (const py of [prism.y0 * sy, prism.y1 * sy]) {
          const w = applyMat(m, mx, py, mz);
          flat.push([w.x, w.z]);
          if (w.y < loY) loY = w.y;
          if (w.y > hiYLocal) hiYLocal = w.y;
        }
      } else {
        const w = rotY(mx, mz, p.rotY);
        flat.push([w.x, w.z]);
      }
    }
    if (!m) {
      loY = prism.y0 * sy;
      hiYLocal = prism.y1 * sy;
    }
    const hull = m ? convexHullXZ(flat) : flat;
    if (hull.length < 3) continue;
    const flipped = outlineWinding(hull) < 0;
    if (flipped) hull.reverse();
    const poly: number[] = [];
    let br = 0;
    for (const [hx, hz] of hull) {
      poly.push(hx, hz);
      br = Math.max(br, Math.hypot(hx, hz));
    }
    // LOFT outlines ride through the same scale + yaw (never the tilt path:
    // the leaned shadow hull re-orders vertices, breaking the index
    // correspondence the loft interpolation depends on). Reversed together
    // with poly so index i keeps matching across all three.
    let polyLo: number[] | undefined;
    let polyHi: number[] | undefined;
    if (!m && prism.polyLo && prism.polyHi && prism.polyLo.length === prism.poly.length) {
      const mapOutline = (src: readonly number[]): number[] => {
        const o: number[] = [];
        for (let i = 0; i < src.length; i += 2) {
          const w = rotY(src[i] * sx, src[i + 1] * sz, p.rotY);
          o.push(w.x, w.z);
        }
        if (flipped) {
          const r: number[] = [];
          for (let i = o.length - 2; i >= 0; i -= 2) r.push(o[i], o[i + 1]);
          return r;
        }
        return o;
      };
      polyLo = mapOutline(prism.polyLo);
      polyHi = mapOutline(prism.polyHi);
      for (let i = 0; i < polyLo.length; i += 2) {
        br = Math.max(
          br,
          Math.hypot(polyLo[i], polyLo[i + 1]),
          Math.hypot(polyHi[i], polyHi[i + 1]),
        );
      }
    }
    const lo = base + lift + loY;
    const hi = base + lift + hiYLocal;
    out.push({
      type: 'prism',
      x: p.x,
      z: p.z,
      poly,
      br,
      polyLo,
      polyHi,
      cameraTopY: hi,
      baseY: lo,
      moveTopY: hi,
      standable: true,
    });
  }
}

/**
 * Only a box that can actually be mounted is a support surface. A TALL sliver
 * (a wall panel, a fence picket) still BLOCKS — blocksAt reads moveTopY — but
 * it leaves the standable set: supportFromCandidates and floorHeightAt walk
 * every standable candidate per query, and on a dressed map many baked boxes
 * are exactly this kind of never-stood-on shape. A LOW box stays standable
 * whatever its footprint: step-up/mantle onto the top IS how a body crosses a
 * doorstep course or vaults a rail, and both gates require standable.
 */
const STANDABLE_MIN_HALF_EXTENT = 0.22;
const STANDABLE_LOW_TOP = MANTLE_REACH + 0.35;
function standableSurface(hw: number, hd: number, topAboveGround: number): boolean {
  return Math.min(hw, hd) >= STANDABLE_MIN_HALF_EXTENT || topAboveGround <= STANDABLE_LOW_TOP;
}

/**
 * Emit one banded OBB per baked box of a placement.
 *
 * `baseY` gates walking underneath (a cave tube, the floor below an authored
 * storey) and `moveTopY`+`standable` make the band's top a real surface, the
 * same treatment the shipped world gives crates, benches and hut roofs. A box
 * carries its own `ry` on top of the placement's yaw (hand-edited hitboxes).
 */
function emitPlacementBoxes(
  out: Collider[],
  p: PlacedAsset,
  baked: readonly BakedCollisionBox[],
  base: number,
): void {
  const lift = p.y ?? 0;
  const s = p.scale > 0 ? p.scale : 1;
  const sx = s * (p.scaleX ?? 1);
  const sy = s * (p.scaleY ?? 1);
  const sz = s * (p.scaleZ ?? 1);
  const tiltX = p.rotX ?? 0;
  const tiltZ = p.rotZ ?? 0;
  if (tiltX === 0 && tiltZ === 0) {
    for (const b of baked) {
      const off = rotY(b.x * sx, b.z * sz, p.rotY);
      const lo = base + lift + (b.y - b.hy) * sy;
      const hi = base + lift + (b.y + b.hy) * sy;
      // A box with its OWN yaw (hand-edited hitboxes, Collision Master
      // volumes) has its local axes rotated off the model's, so a per-axis
      // model scale must be measured through that rotation: hw is the box's
      // local-X extent as the scaled model actually stretches it, not
      // b.hx * sx (which silently swapped width and depth on a 90-degree
      // authored box under a fitted building's scaleX != scaleZ).
      const bry = (b as { ry?: number }).ry ?? 0;
      let hw = b.hx * sx;
      let hd = b.hz * sz;
      if (bry !== 0 && Math.abs(sx - sz) > 1e-6) {
        const bc = Math.cos(bry);
        const bs = Math.sin(bry);
        hw = b.hx * Math.hypot(bc * sx, bs * sz);
        hd = b.hz * Math.hypot(bs * sx, bc * sz);
      }
      hw = Math.max(0.05, hw);
      hd = Math.max(0.05, hd);
      out.push({
        type: 'obb',
        x: p.x + off.x,
        z: p.z + off.z,
        hw,
        hd,
        rot: p.rotY + bry,
        cameraTopY: hi,
        baseY: lo,
        moveTopY: hi,
        standable: standableSurface(hw, hd, hi - base),
      });
    }
    return;
  }
  // Tilted (the gizmo's X/Z rings): each box's 8 corners go through the model's
  // FULL rotation, then a yaw-OBB is fitted over their XZ shadow with the
  // corners' Y span as the band — the closest shape this engine's yaw-banded
  // colliders can represent.
  const m = eulerMatrix(tiltX, p.rotY, tiltZ);
  for (const b of baked) {
    const bry = (b as { ry?: number }).ry ?? 0;
    const bc = Math.cos(bry);
    const bs = Math.sin(bry);
    const corners: Point3[] = [];
    for (let i = 0; i < 8; i++) {
      const cxl = (i & 1 ? 1 : -1) * b.hx;
      const cyl = (i & 2 ? 1 : -1) * b.hy;
      const czl = (i & 4 ? 1 : -1) * b.hz;
      const mx = (b.x + cxl * bc + czl * bs) * sx;
      const mz = (b.z - cxl * bs + czl * bc) * sz;
      corners.push(applyMat(m, mx, (b.y + cyl) * sy, mz));
    }
    // Frame yaw from the box's longest rotated axis shadow (a vertical axis
    // casts none; the fence convention is rot = atan2(-dz, dx)).
    const axisX = applyMat(m, bc, 0, -bs);
    const axisZ = applyMat(m, bs, 0, bc);
    const dir =
      Math.hypot(axisX.x, axisX.z) * b.hx >= Math.hypot(axisZ.x, axisZ.z) * b.hz ? axisX : axisZ;
    const rot = Math.hypot(dir.x, dir.z) > 1e-6 ? Math.atan2(-dir.z, dir.x) : p.rotY;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    let loY = Infinity;
    let hiY = -Infinity;
    for (const c of corners) {
      const local = rotY(c.x, c.z, -rot);
      if (local.x < minU) minU = local.x;
      if (local.x > maxU) maxU = local.x;
      if (local.z < minV) minV = local.z;
      if (local.z > maxV) maxV = local.z;
      if (c.y < loY) loY = c.y;
      if (c.y > hiY) hiY = c.y;
    }
    const center = rotY((minU + maxU) / 2, (minV + maxV) / 2, rot);
    const lo = base + lift + loY;
    const hi = base + lift + hiY;
    const hw = Math.max(0.05, (maxU - minU) / 2);
    const hd = Math.max(0.05, (maxV - minV) / 2);
    out.push({
      type: 'obb',
      x: p.x + center.x,
      z: p.z + center.z,
      hw,
      hd,
      rot,
      cameraTopY: hi,
      baseY: lo,
      moveTopY: hi,
      standable: standableSurface(hw, hd, hi - base),
    });
  }
}

// default backward offset/radius for a mine's spoil mound behind the timber portal,
// shared with the renderer (src/render/props.ts) so the two can't drift apart
export const MINE_MOUND_DEFAULT_OFFSET = 3.4;
export const MINE_MOUND_DEFAULT_RADIUS = 5;

export function mineMoundFootprint(m: {
  x: number;
  z: number;
  rot: number;
  moundOffset?: number;
  moundRadius?: number;
}): { x: number; z: number; r: number } {
  const r = m.moundRadius ?? MINE_MOUND_DEFAULT_RADIUS;
  const mound = rotY(0, -(m.moundOffset ?? MINE_MOUND_DEFAULT_OFFSET), m.rot);
  return { x: m.x + mound.x, z: m.z + mound.z, r };
}

// ---------------------------------------------------------------------------
// Collider sets
// ---------------------------------------------------------------------------

// Positions no prop may stand on: authored NPCs, plus every overworld
// graveyard anchor, where a Spirit Healer is spawned at runtime rather than
// being an authored NPC record. Reads the ACTIVE content (byte-identical on
// shipped hosts) so a custom map's furniture is vetoed against ITS npcs and
// graveyards, never the builtin layout's.
function townNpcPositions(): { x: number; z: number }[] {
  const content = getActiveWorldContent();
  const out: { x: number; z: number }[] = [];
  for (const npc of Object.values(content.npcs)) {
    const pos = (npc as { pos?: { x: number; z: number } }).pos;
    if (pos) out.push({ x: pos.x, z: pos.z });
  }
  for (const g of content.services?.graveyards ?? []) out.push({ x: g.x, z: g.z });
  return out;
}

function standsOnNpcSpot(
  x: number,
  z: number,
  r: number,
  spots: readonly { x: number; z: number }[],
): boolean {
  for (const s of spots) {
    if (Math.hypot(s.x - x, s.z - z) < r + 0.4) return true;
  }
  return false;
}

function staticWorldColliders(seed: number): Collider[] {
  const out: Collider[] = [];
  const content = getActiveWorldContent();
  const PROPS = content.props;

  // Render hideables still block movement while their render subsystem fades
  // whichever one crosses the eye-to-camera segment to 20% opacity.
  // A document that owns the authored towns' buildings as placements carries
  // their (baked) collision itself — without this gate a moved town hall
  // leaves an invisible record collider standing on the square.
  const townBuildingsPromoted = content.promotedScenery?.authoredTowns === true;
  for (const b of PROPS.buildings) {
    if (townBuildingsPromoted && isAuthoredTownBuildingDef(b)) continue;
    if (b.kind === 'chapel' && b.assetId === undefined) {
      // The legacy procedural chapel is COMPOSED (render/props.ts): full-height
      // bell tower at the rear, squat entry hall in front. Collide the two
      // shapes it actually draws: the tower stays a wall, the hall roof is a
      // standable low roof a jump can grab. Buildings with an assetId render
      // from their own GLB (the Eastbrook rebuild kit) and take the authored
      // OBB below instead.
      const towerOff = rotY(0, CHAPEL_TOWER.dz, b.rot);
      out.push({
        type: 'obb',
        x: b.x + towerOff.x,
        z: b.z + towerOff.z,
        hw: (b.w * CHAPEL_TOWER.wScale) / 2,
        hd: (b.d * CHAPEL_TOWER.dScale) / 2,
        rot: b.rot,
        cameraTopY: topY(seed, b.x, b.z, buildingCameraHeight(b)),
      });
      const hallOff = rotY(0, b.d / 2 - CHAPEL_HALL.dzFromFront, b.rot);
      const hx = b.x + hallOff.x;
      const hz = b.z + hallOff.z;
      out.push({
        type: 'obb',
        x: hx,
        z: hz,
        hw: (b.w * CHAPEL_HALL.wScale) / 2,
        hd: CHAPEL_HALL.depth / 2,
        rot: b.rot,
        cameraTopY: topY(seed, hx, hz, CHAPEL_HALL_ROOF_TOP + 0.2),
        moveTopY: topY(seed, hx, hz, CHAPEL_HALL_ROOF_TOP),
        standable: true,
        // house_3 again: the ridge runs along the hall's local z (front to
        // back), falling across its width to the measured eave line.
        topSlope: {
          kind: 'ridge',
          axis: 'z',
          pitch: (CHAPEL_HALL_ROOF_TOP - CHAPEL_HALL_ROOF_EAVE) / ((b.w * CHAPEL_HALL.wScale) / 2),
          eaveY: topY(seed, hx, hz, CHAPEL_HALL_ROOF_EAVE),
        },
      });
      continue;
    }
    const cameraTopY = isEastbrookGrandArmoury(b)
      ? buildingTerrainEnvelope(b, (x, z) => terrainHeight(x, z, seed)).cameraTopY
      : topY(seed, b.x, b.z, buildingCameraHeight(b));
    out.push({
      type: 'obb',
      x: b.x,
      z: b.z,
      hw: b.w / 2,
      hd: b.d / 2,
      rot: b.rot,
      cameraTopY,
      // FORK: ground anchor for pass-under — a mover deep in a tube or carve
      // walks beneath surface props instead of hitting invisible walls.
      underY: topY(seed, b.x, b.z, 0),
    });
  }
  for (const w of PROPS.wells)
    out.push({
      type: 'circle',
      x: w.x,
      z: w.z,
      r: w.r,
      cameraTopY: topY(seed, w.x, w.z, w.height ?? 3.7),
      underY: topY(seed, w.x, w.z, 0),
    });
  // the collider runs wider than the data radius: the modeled trunks flare
  // at the base, and the r that sizes the tree understates the bark line
  for (const t of PROPS.greatTrees ?? [])
    out.push({
      type: 'circle',
      x: t.x,
      z: t.z,
      r: t.r * 1.45,
      cameraTopY: topY(seed, t.x, t.z, 7),
    });
  // The Duskfall Passage's cave mouths: each portal side wears a modeled
  // cave (render/hollow_gates.ts); two flank circles and a back circle
  // shape the walk-in so the only way through the rock is the mouth itself.
  //
  // Overworld-only, like the art. These circles sit on fixed world
  // coordinates, so an authored map inherited three invisible walls wherever
  // those numbers landed on it — the exact failure invisible decoration
  // colliders have hit before, and it outlives hiding the mesh.
  for (const portal of usesOverworldSiteDressing(content.presentationMode) ? PORTALS : []) {
    for (const side of [portal.a, portal.b]) {
      const f = Math.atan2(side.landing.x - side.x, side.landing.z - side.z);
      const fx = Math.sin(f);
      const fz = Math.cos(f);
      for (const flank of [1, -1])
        out.push({
          type: 'circle',
          x: side.x + fz * 3.4 * flank + fx * 0.6,
          z: side.z - fx * 3.4 * flank + fz * 0.6,
          r: 2.3,
          cameraTopY: topY(seed, side.x, side.z, 9),
        });
      out.push({
        type: 'circle',
        x: side.x - fx * 3.8,
        z: side.z - fz * 3.8,
        r: 3.2,
        cameraTopY: topY(seed, side.x, side.z, 9),
      });
    }
  }
  // The Willowfen's willows: a trunk collider at the base of every weeping
  // willow, from the same deterministic list the renderer instances the
  // models from (sim/fen_willows.ts). A document that owns the willows as
  // placements carries their trunks itself (promotedScenery.willows).
  const willowsPromoted = content.promotedScenery?.willows === true;
  if (!willowsPromoted)
    for (const w of fenWillowSpots(seed))
      out.push({
        type: 'circle',
        x: w.x,
        z: w.z,
        r: w.r,
        cameraTopY: topY(seed, w.x, w.z, 6),
      });
  // ...and the Veiled Hollow's willows, same one-list contract
  if (!willowsPromoted)
    for (const w of hollowWillowSpots(seed))
      out.push({
        type: 'circle',
        x: w.x,
        z: w.z,
        r: w.r,
        cameraTopY: topY(seed, w.x, w.z, 6),
      });
  // Dawnhold's outside climbing chain: corbelled shelves up each curtain
  // so the wall-walk is reachable by parkour as well as by the flights.
  // These are the only STANDABLE tops the castle has outdoors, because
  // the walls themselves are lift terrain rather than colliders and terrain
  // grants no ledge to grab.
  for (const l of DAWNHOLD_WALL_LEDGES) {
    out.push({
      type: 'obb',
      x: l.x,
      z: l.z,
      hw: l.hw,
      hd: l.hd,
      rot: 0,
      moveTopY: l.top,
      standable: true,
      cameraTopY: l.top,
    });
  }
  // ...and the crenellated parapet along each wall-walk's OUTER edge, from the
  // same plan the renderer lays its battlement modules from. The curtain is
  // terrain, and terrain gives a body no standoff at a DOWN edge, so the walk
  // was a 3.0yd strip with nothing at either lip and four ticks of drift put a
  // player over the side.
  //
  // moveTopY WITHOUT standable, the campfire's semantic further down this file:
  // a body whose feet are below the stone is blocked by it, and nobody may ever
  // the shelves right beside it, so the chase camera does not yank in on a
  // knee-high rail.
  for (const seg of dawnholdParapetSegments()) {
    const alongHalf = (seg.a1 - seg.a0) / 2;
    const mid = (seg.a0 + seg.a1) / 2;
    out.push({
      type: 'obb',
      x: seg.axis === 'z' ? seg.line : mid,
      z: seg.axis === 'z' ? mid : seg.line,
      hw: seg.axis === 'z' ? DAWNHOLD_PARAPET_HALF : alongHalf,
      hd: seg.axis === 'z' ? alongHalf : DAWNHOLD_PARAPET_HALF,
      rot: 0,
      moveTopY: seg.top,
      cameraTopY: seg.top,
    });
  }
  // ...and the Drakelands' giant ember lilies: the huge and giant tiers
  // carry a rocky-bed collider (r 0 skirt lilies stay walk-through
  // dressing), same one-list contract as the willows. A document that owns
  // the Drakelands dressing as placements carries the lily beds itself.
  if (content.promotedScenery?.emberDressing !== true)
    for (const lily of emberLilySpots(seed)) {
      if (lily.r <= 0) continue;
      out.push({
        type: 'circle',
        x: lily.x,
        z: lily.z,
        r: lily.r,
        cameraTopY: topY(seed, lily.x, lily.z, lily.fp * 0.55),
      });
    }
  // The Palmreach strand: a slim trunk collider at the base of every beach
  // palm, from the same deterministic list the renderer instances the models
  // from (world.ts). A document that owns a stand as placements carries its
  // trunks itself — without the gate a moved palm leaves an invisible
  // blocker standing where the world had planted it.
  if (content.promotedScenery?.reachPalms !== true)
    for (const p of reachPalmSpots(seed))
      out.push({
        type: 'circle',
        x: p.x,
        z: p.z,
        r: p.r,
        cameraTopY: topY(seed, p.x, p.z, 7),
      });
  // ...and the Farshore strand's palms, the same one-list contract
  if (content.promotedScenery?.farshorePalms !== true)
    for (const p of farshorePalmSpots(seed))
      out.push({
        type: 'circle',
        x: p.x,
        z: p.z,
        r: p.r,
        cameraTopY: topY(seed, p.x, p.z, 7),
      });
  for (const s of PROPS.stalls) {
    const cameraTopY = topY(seed, s.x, s.z, s.height ?? 3.1);
    if (s.w !== undefined && s.d !== undefined) {
      // Sized entries (the Eastbrook rebuild's authored market stalls and any
      // editor-authored stall): the authored OBB drives collision, exactly as
      // the release renders it. The rebuild stall mesh is scaled so its
      // bounding box fills the authored w x height x d envelope, and its
      // tallest element is the flat canopy deck, so the drawn canopy surface
      // sits at exactly the authored height: a standable roof a jump at the
      // counter's edge grabs, the rebuild's counterpart of the legacy gable.
      const canopyTop = s.height !== undefined ? topY(seed, s.x, s.z, s.height) : undefined;
      out.push({
        type: 'obb',
        x: s.x,
        z: s.z,
        hw: s.w / 2,
        hd: s.d / 2,
        rot: s.rot,
        cameraTopY,
        moveTopY: canopyTop,
        standable: canopyTop !== undefined,
      });
    } else {
      // Legacy market stand: the mesh is a normalized 3.1 x 2.5 BOX at the
      // stall's yaw (the old circle both overhung the flat sides and missed
      // the corners), and its awning is a steep gable ridging along the
      // stall's local x: vault onto the 1.5 eave at the front or back edge,
      // walk up the fabric, or grab the higher slope directly. A grounded
      // walk collides full-height.
      out.push({
        type: 'obb',
        x: s.x,
        z: s.z,
        hw: STALL_HALF_W,
        hd: STALL_HALF_D,
        rot: s.rot,
        cameraTopY,
        moveTopY: topY(seed, s.x, s.z, STALL_CANOPY_TOP),
        standable: true,
        topSlope: {
          kind: 'ridge',
          axis: 'x',
          pitch: (STALL_CANOPY_TOP - STALL_CANOPY_EAVE) / STALL_HALF_D,
          eaveY: topY(seed, s.x, s.z, STALL_CANOPY_EAVE),
        },
      });
    }
  }
  // Civic benches: the rebuild scales bench.glb uniformly to the authored
  // footprint (height follows the native aspect, eastbrook_town.ts), so the
  // drawn seat top is a pure function of w x d: town furniture, standable,
  // and at 0.40 for the civic benches it is a plain stride up.
  for (const bench of PROPS.benches ?? []) {
    const top = topY(seed, bench.x, bench.z, benchDrawnHeight(bench.w, bench.d));
    out.push({
      type: 'obb',
      x: bench.x,
      z: bench.z,
      hw: bench.w / 2,
      hd: bench.d / 2,
      rot: bench.rot,
      cameraTopY: topY(seed, bench.x, bench.z, bench.height),
      underY: topY(seed, bench.x, bench.z, 0),
      moveTopY: top,
      standable: true,
    });
  }
  // Eastbrook's town wall is a stone parapet with an open iron railing and
  // two modeled pillars. Fenbridge's palisade is instead a solid log curtain:
  // its one authored OBB stays full-height and carries no synthetic pillars.
  for (const wall of PROPS.walls ?? []) {
    const cameraTopY = topY(seed, wall.x, wall.z, wall.height);
    if (wall.assetId === FENBRIDGE_LAYOUT.wall.assetId) {
      out.push({
        type: 'obb',
        x: wall.x,
        z: wall.z,
        hw: wall.w / 2,
        hd: wall.d / 2,
        rot: wall.rot,
        cameraTopY,
      });
      continue;
    }

    const parapet = topY(seed, wall.x, wall.z, wall.height * TOWN_WALL_PARAPET_FRAC);
    out.push({
      type: 'obb',
      x: wall.x,
      z: wall.z,
      hw: wall.w / 2,
      hd: wall.d / 2,
      rot: wall.rot,
      cameraTopY,
      moveTopY: parapet,
      standable: true,
    });
    const mirror = wall.mirrored ? -1 : 1;
    const pillarHw = Math.max(0.24, wall.w * TOWN_WALL_PILLAR_HW_FRAC);
    for (const pillar of [
      { along: TOWN_WALL_TALL_PILLAR_ALONG * mirror, topFrac: null },
      { along: TOWN_WALL_SHORT_PILLAR_ALONG * mirror, topFrac: TOWN_WALL_SHORT_PILLAR_TOP_FRAC },
    ]) {
      const off = rotY(pillar.along * (wall.w / 2), 0, wall.rot);
      const px = wall.x + off.x;
      const pz = wall.z + off.z;
      const top =
        pillar.topFrac === null ? undefined : topY(seed, px, pz, wall.height * pillar.topFrac);
      out.push({
        type: 'obb',
        x: px,
        z: pz,
        hw: pillarHw,
        hd: wall.d / 2,
        rot: wall.rot,
        cameraTopY: topY(seed, px, pz, wall.height),
        moveTopY: top,
        standable: top !== undefined,
      });
    }
  }

  // Fenbridge's gate arch is a compound obstacle: the overhead beam never
  // closes the route, while its two authored jamb OBBs remain solid. The
  // stable wall ids gate this projection so custom worlds that remove the
  // Fenbridge palisade do not inherit invisible builtin collision.
  const wallIds = new Set((PROPS.walls ?? []).map((wall) => wall.id));
  if (FENBRIDGE_LAYOUT.wall.segments.every((segment) => wallIds.has(segment.id))) {
    for (const gate of FENBRIDGE_LAYOUT.wall.gates) {
      for (const jamb of gate.arch.jambs) {
        out.push({
          type: 'obb',
          x: jamb.center.x,
          z: jamb.center.z,
          hw: jamb.halfWidth,
          hd: jamb.halfDepth,
          rot: jamb.rotation,
          cameraTopY: topY(seed, jamb.center.x, jamb.center.z, gate.arch.nativeDimensions.height),
        });
      }
    }
  }

  // Interactable town boards are authored through active WorldContent rather
  // than PROPS. The same service record drives their spawn and exact OBB, and
  // custom worlds that omit the service inherit no Eastbrook collision.
  for (const board of content.services?.noticeboards ?? []) {
    out.push({
      type: 'obb',
      x: board.x,
      z: board.z,
      hw: board.width / 2,
      hd: board.depth / 2,
      rot: board.rotation,
      cameraTopY: topY(seed, board.x, board.z, board.height),
      underY: topY(seed, board.x, board.z, 0),
    });
  }
  // The dedicated Fenbridge renderer is built-in-only. Keep this specialized
  // service collision under the same authority so a programmatic custom world
  // cannot create an invisible solid board by supplying musterBoards data.
  if (content === BUILTIN_WORLD) {
    for (const board of content.services?.musterBoards ?? []) {
      out.push({
        type: 'obb',
        x: board.x,
        z: board.z,
        hw: board.width / 2,
        hd: board.depth / 2,
        rot: board.rotation,
        cameraTopY: topY(seed, board.x, board.z, board.height),
        underY: topY(seed, board.x, board.z, 0),
      });
    }
  }

  // Hand-placed GLB decor (src/sim/decor_prop_colliders.ts): a circle or box
  // per PROPS.decorProps entry, walk-through when r/hw+hd are absent, standable
  // on top when standableTop is set (see that module's header).
  out.push(...buildDecorPropColliders(seed, PROPS.decorProps ?? []));

  // THE GREAT MAZE's hedges. One box per drawn piece, straight off the same
  // grid the renderer lays the hedge GLBs from, so the blocked ground IS the
  // modeled hedge footprint.
  //
  // These are new, and their absence was a silent regression rather than a
  // deletion. The hedge used to be enforced by crossesGardenHedge, a bespoke
  // segment test living inside resolveMovement. When the parkour physics engine
  // landed, the OPEN WORLD moved onto moveCharacter (player_motion.ts) and
  // resolveMovement became the instanced-interior path, so the test simply
  // stopped being reached for players on foot. Nothing errored: mobs, pets and
  // Charge still route through resolveMove and still collided, so the maze went
  // on looking enforced while players walked through the hedges. Two unrelated
  // branches, the modeled hedge and the physics engine, auto-merged with no
  // conflict and neither author saw the other's half.
  //
  // Real colliders instead of a second bespoke test: the solver, pathfinding and
  // every mover get it from one place, and the next kernel rewrite inherits it.
  // Length is the CELL, not the drawn piece: the 0.75yd overlap at each end is
  // cosmetic leaf interlock, and where a run continues the neighbour's own box
  // covers the joint. Deliberately NOT merged into colinear runs: colliderBounds
  // and pruneCandidates both take an OBB's extent as hypot(hw, hd) on both axes,
  // so one 153yd run registers as a 153yd blob across cells nowhere near it.
  for (let r = 0; r < MAZE_ROWS; r++) {
    for (let c = 0; c < MAZE_COLS; c++) {
      const piece = gardenMazeCellPieces(c, r);
      if (!piece) continue;
      const x = MAZE_X0 + (c + 0.5) * MAZE_CELL;
      const z = MAZE_Z1 - (r + 0.5) * MAZE_CELL;
      const camTop = topY(seed, x, z, MAZE_WALL_HEIGHT);
      const half = MAZE_CELL / 2;
      const depth = MAZE_WALL_DEPTH / 2;
      // full height on purpose: a 6.1yd hedge is nobody's platform, so no
      // moveTopY and nothing to stand on or mantle
      if (piece.h) {
        out.push({ type: 'obb', x, z, hw: half, hd: depth, rot: 0, cameraTopY: camTop });
      }
      if (piece.v) {
        out.push({ type: 'obb', x, z, hw: depth, hd: half, rot: 0, cameraTopY: camTop });
      }
    }
  }

  // Ravenpost mailboxes: authored civic furniture, spawned by the Sim at this
  // exact spot (the noticeboard pattern). The pillar's lower body is the
  // collider; the raven crown is sculpture, not a platform, so it stays
  // full-height (the wells rule).
  for (const box of content.services?.mailboxes ?? []) {
    out.push({
      type: 'obb',
      x: box.x,
      z: box.z,
      hw: MAILBOX_HW,
      hd: MAILBOX_HD,
      rot: 0,
      cameraTopY: topY(seed, box.x, box.z, 2.9),
    });
  }

  // Gather nodes: the renderer draws every node's GLB at a fixed spot whether
  // or not it is ready to harvest, so ore veins and wood piles are permanent
  // solid, standable bodies; herb clusters stay soft vegetation on purpose
  // (GATHER_NODE_BODIES). INTERACT_RANGE (5) dwarfs the radii, so collision
  // never pushes a gatherer out of harvesting reach.
  for (const node of GATHER_NODES) {
    const nodeBody = GATHER_NODE_BODIES[node.type];
    if (!nodeBody) continue;
    const top = topY(seed, node.pos.x, node.pos.z, nodeBody.top);
    out.push({
      type: 'circle',
      x: node.pos.x,
      z: node.pos.z,
      r: nodeBody.r,
      cameraTopY: top,
      moveTopY: top,
      standable: true,
    });
  }

  // Dungeon door arch jambs (dungeon_door_jambs.ts owns the rule).
  out.push(...dungeonDoorJambColliders(seed, topY));
  // The Forgefather's Isle fortress: the owner's baked exterior pass
  // (forgefather_fortress.ts owns the ground-standing derivation). Built-in
  // world only: an authored map reuses these coordinates for its own ground
  // (the Deepglass's Tidehold market sits where the fortress does), and an
  // ungated push here put an invisible wall through its stalls.
  if (content === BUILTIN_WORLD) out.push(...forgefatherFortressColliders(seed));

  // Delve entrance portals: the whole slab is a solid one-way threshold
  // (players enter by talking to the warden; leaveDelve drops them mouth-side
  // of this collider, see prop_layout delveExitDropZ).
  for (const dm of PROPS.delveMarkers ?? []) {
    const az = delveArchZ(dm.z, dm.delveId);
    out.push({
      type: 'obb',
      x: dm.x,
      z: az,
      hw: DELVE_ARCH_HW,
      hd: DELVE_ARCH_HD,
      rot: 0,
      cameraTopY: topY(seed, dm.x, az, DELVE_ARCH_HEIGHT),
    });
  }

  // mines: mound behind the timber portal, plus the portal's two upright
  // timber posts (the overhead lintel beams start above head height and
  // never block). Post positions/size mirror the render placement.
  for (const m of PROPS.mines) {
    const { x, z, r } = mineMoundFootprint(m);
    out.push({
      type: 'circle',
      x,
      z,
      r,
      cameraTopY: topY(seed, x, z, r + 0.2),
      underY: topY(seed, x, z, 0),
    });
    for (const sx of [-1.45, 1.45]) {
      const post = rotY(sx, 0, m.rot);
      const px = m.x + post.x;
      const pz = m.z + post.z;
      out.push({
        type: 'circle',
        x: px,
        z: pz,
        r: 0.27,
        cameraTopY: topY(seed, px, pz, 3.4),
        underY: topY(seed, px, pz, 0),
      });
    }
  }

  // Dock decks are raised walkable ground in world.ts; only a non-empty hut blocks.
  for (const d of PROPS.docks) {
    if (d.hutLocal.hw <= 0 || d.hutLocal.hd <= 0) continue;
    const hut = rotY(d.hutLocal.x, d.hutLocal.z, d.rot);
    const x = d.x + hut.x,
      z = d.z + hut.z;
    out.push({
      type: 'obb',
      x,
      z,
      hw: d.hutLocal.hw,
      hd: d.hutLocal.hd,
      rot: d.rot,
      cameraTopY: topY(seed, x, z, 2.9),
      underY: topY(seed, x, z, 0),
      // The hut's roof is a climbable perch: full-height to a walk, a ledge
      // grab away from a jump. house_3's ridge runs along its local z (the
      // OBB depth axis), so the surface falls across |local x| to real eaves
      // at 60 percent of the height (measured GLB profile).
      moveTopY: topY(seed, x, z, DOCK_HUT_ROOF_TOP),
      standable: true,
      topSlope: {
        kind: 'ridge',
        axis: 'z',
        pitch: (DOCK_HUT_ROOF_TOP - DOCK_HUT_ROOF_EAVE) / d.hutLocal.hw,
        eaveY: topY(seed, x, z, DOCK_HUT_ROOF_EAVE),
      },
    });
    // The dock's loose dressing (DOCK_DRESSING: shore-side barrels and crate,
    // deliberately off the pinned-crossable plank walkway) used to be the
    // last walk-through props in the world. Heights are measured GLB bounds
    // times the placed scale; groundHeight under them already includes the
    // deck where they touch it, so tops ride the surface like the meshes do.
    for (const dd of DOCK_DRESSING) {
      const off = rotY(dd.x, dd.z, d.rot);
      const px = d.x + off.x;
      const pz = d.z + off.z;
      const top = topY(seed, px, pz, dd.height);
      out.push({
        type: 'circle',
        x: px,
        z: pz,
        r: dd.r,
        cameraTopY: top,
        moveTopY: top,
        standable: true,
      });
    }
    // The moored rowboat: a stridable deck you can actually step into, afloat
    // at the waterline or hauled up on the bank (the same predicate the
    // renderer uses to seat the mesh). The visual adds a small rotation
    // jitter; the hull's rounded OBB forgives the few degrees of difference.
    {
      const off = rotY(DOCK_BOAT.x, DOCK_BOAT.z, d.rot);
      const bx = d.x + off.x;
      const bz = d.z + off.z;
      const bg = groundHeight(bx, bz, seed);
      const wl = waterLevelAt(bx, bz, seed);
      const afloat = bg < wl - 0.1;
      const deckY = (afloat ? wl + 0.18 : bg + 0.06) + DOCK_BOAT.deckHeight;
      out.push({
        type: 'obb',
        x: bx,
        z: bz,
        hw: DOCK_BOAT.hw,
        hd: DOCK_BOAT.hd,
        rot: d.rot + DOCK_BOAT.rot,
        cameraTopY: deckY + 0.3,
        moveTopY: deckY,
        standable: true,
      });
    }
  }

  for (const t of PROPS.tents)
    out.push({
      type: 'circle',
      x: t.x,
      z: t.z,
      r: 1.5 * t.scale,
      cameraTopY: topY(seed, t.x, t.z, 3.4 * t.scale),
      underY: topY(seed, t.x, t.z, 0),
    });
  PROPS.crates.forEach(([x, z, stack], i) => {
    // Camp clutter renders as a wooden crate OR (every third) a barrel, with
    // a per-point scale roll: the collider takes the SAME roll, so its
    // footprint and top match the exact mesh drawn at this point. A stacked
    // point (the Gauntlet's parkour ledge) multiplies the same unit height,
    // exactly what the renderer draws.
    const shape = campCrateShape(x, z, i);
    const top = shape.top * (stack ?? 1);
    out.push({
      type: 'circle',
      x,
      z,
      r: shape.r,
      cameraTopY: topY(seed, x, z, top),
      moveTopY: topY(seed, x, z, top),
      underY: topY(seed, x, z, 0),
      standable: true,
    });
  });
  for (const [x, z] of PROPS.campfires)
    out.push({
      type: 'circle',
      x,
      z,
      r: 0.85,
      cameraTopY: topY(seed, x, z, 1.45),
      // The log pile is the solid part; the flame above it is not a wall. A
      // jump clears the fire, walking through it stays blocked, and it is
      // deliberately NOT standable (no perching inside the fire).
      moveTopY: topY(seed, x, z, CAMPFIRE_MOVE_TOP),
      underY: topY(seed, x, z, 0),
    });
  for (const [x, z] of PROPS.mudHuts)
    out.push({
      type: 'circle',
      x,
      z,
      r: 1.1,
      cameraTopY: topY(seed, x, z, 12.5),
      underY: topY(seed, x, z, 0),
    });
  for (const ruin of PROPS.ruinRings) {
    for (let i = 0; i < ruin.columns; i++) {
      const ang = (i / ruin.columns) * Math.PI * 2;
      const x = ruin.x + Math.sin(ang) * ruin.ringR,
        z = ruin.z + Math.cos(ang) * ruin.ringR;
      // The renderer keeps every fourth column intact (a tall monolith) and
      // breaks the rest into STUMPS of three deterministic heights. A stump
      // is a standable pillar a jump can grab, not an infinite wall: top =
      // column_broken's 0.65 native top x the render's y-scale, minus the
      // 0.1 the group sinks.
      const intact = i % 4 === 1;
      if (intact) {
        const sy = 3.5 + (i % 2) * 0.5;
        out.push({
          type: 'circle',
          x,
          z,
          r: 0.6,
          cameraTopY: topY(seed, x, z, sy - 0.1),
          underY: topY(seed, x, z, 0),
        });
      } else {
        const sy = 1.7 + (i % 3) * 0.85;
        const top = topY(seed, x, z, 0.65 * sy - 0.1);
        out.push({
          type: 'circle',
          x,
          z,
          r: 0.6,
          cameraTopY: top,
          moveTopY: top,
          standable: true,
          underY: topY(seed, x, z, 0),
        });
      }
    }
    // Toppled relics at the ring's heart (render offsets from props.ts): the
    // half-buried statue head, the carved block, and the fallen column lying
    // across the grass, all solid and all standable. The column's yaw takes
    // the SAME placement roll the renderer draws.
    const hx = ruin.x - 2;
    const hz = ruin.z - 3;
    out.push({
      type: 'circle',
      x: hx - 0.4,
      z: hz + 0.3,
      r: 0.7,
      cameraTopY: topY(seed, hx - 0.4, hz + 0.3, 1.35),
      moveTopY: topY(seed, hx - 0.4, hz + 0.3, 1.35),
      standable: true,
    });
    out.push({
      type: 'circle',
      x: hx + 2.1,
      z: hz - 1.3,
      r: 0.42,
      cameraTopY: topY(seed, hx + 2.1, hz - 1.3, 0.64),
      moveTopY: topY(seed, hx + 2.1, hz - 1.3, 0.64),
      standable: true,
    });
    out.push({
      type: 'obb',
      x: hx - 1.2,
      z: hz - 2.2,
      hw: 1.6,
      hd: 0.48,
      rot: 0.6 + (propPlacementRoll(ruin.x, ruin.z, 32) - 0.5) * 0.4,
      cameraTopY: topY(seed, hx - 1.2, hz - 2.2, 1.1),
      moveTopY: topY(seed, hx - 1.2, hz - 2.2, 1.1),
      standable: true,
    });
  }
  for (const f of PROPS.fences) {
    const dx = f.x2 - f.x1,
      dz = f.z2 - f.z1;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const x = (f.x1 + f.x2) / 2,
      z = (f.z1 + f.z2) / 2;
    const halfDepth = (f.width ?? FENCE_HALF_DEPTH * 2) / 2;
    out.push({
      type: 'obb',
      x,
      z,
      hw: len / 2 + (f.width === undefined ? FENCE_END_PAD : halfDepth),
      hd: halfDepth,
      rot: Math.atan2(-dz, dx),
      cameraTopY: topY(seed, x, z, f.height ?? FENCE_RAIL_HEIGHT),
      underY: topY(seed, x, z, 0),
      isFence: true,
    });
  }

  // Highwatch show-jumps: grounded riders collide with the visible fixture,
  // while the movement kernel's airborne `ignoreFences` path clears it during a
  // deliberate jump. The dimensions are the same data props.ts uses to scale
  // each GLB, preserving the what-you-see-is-what-you-collide-with contract.
  for (const jump of PROPS.raceCourse?.jumps ?? []) {
    const fixture = MOUNT_RACE_JUMP_FIXTURES[jump.kind];
    out.push({
      type: 'obb',
      x: jump.x,
      z: jump.z,
      hw: fixture.depth / 2,
      hd: fixture.width / 2,
      rot: jump.dir + Math.PI / 2,
      cameraTopY: topY(seed, jump.x, jump.z, fixture.maxHeight),
      isFence: true,
    });
  }

  // Graveyard headstones. Six per anchor on a fixed grid, and until now the
  // only top-level prop category with no collision at all: a whole cemetery
  // the player strolled through. Standable, so the taller crosses are
  // something to jump onto rather than a wall.
  const npcSpots = townNpcPositions();
  for (const gy of PROPS.graveyards) {
    for (let i = 0; i < GRAVE_COUNT; i++) {
      const off = graveOffset(i);
      const gx = gy.x + off.x;
      const gz = gy.z + off.z;
      // Same rule as the town furniture: never wall off an NPC. A Spirit
      // Healer hovers at every overworld graveyard's anchor, which is exactly
      // where the first stone of the grid is drawn, so that one stays scenery.
      if (standsOnNpcSpot(gx, gz, GRAVE_RADIUS, npcSpots)) continue;
      const top = topY(seed, gx, gz, graveHeight(i));
      out.push({
        type: 'circle',
        x: gx,
        z: gz,
        r: GRAVE_RADIUS,
        cameraTopY: top,
        moveTopY: top,
        standable: true,
      });
    }
  }

  // Profession-station clusters and Artisan Row: the town's furniture. Both
  // layouts are sim-owned data the renderer reads back (`town_props.ts`), so
  // an anvil you can see is an anvil you can climb on. The ACTIVE bundle's
  // stations, matching the gate and visuals: a custom map without services
  // gets no invisible builtin furniture, and its own stations do collide.
  for (const tp of townPropPlacements(
    (content.services?.stations ?? []).map((st) => ({ type: st.type, x: st.pos.x, z: st.pos.z })),
    townNpcPositions(),
  )) {
    const top = topY(seed, tp.x, tp.z, tp.size.height);
    out.push({
      type: 'circle',
      x: tp.x,
      z: tp.z,
      r: tp.size.r,
      cameraTopY: top,
      moveTopY: top,
      standable: tp.size.standable,
    });
  }

  // Market-stall dressing and the mine's ore cart: sub-props the renderer
  // draws as loose children of their parent, previously invisible to
  // collision. Local offsets rotate with the parent, exactly as the meshes do.
  // Sized entries (w/d authored) are the rebuild's own stall mesh, which
  // carries no legacy dressing children: skip them.
  for (const st of PROPS.stalls) {
    if (st.w !== undefined && st.d !== undefined) continue;
    for (const d of st.smithy ? SMITHY_DRESSING : STALL_DRESSING) {
      const off = rotY(d.x, d.z, st.rot);
      const x = st.x + off.x;
      const z = st.z + off.z;
      const top = topY(seed, x, z, d.height);
      out.push({
        type: 'circle',
        x,
        z,
        r: d.r,
        cameraTopY: top,
        moveTopY: top,
        standable: true,
      });
    }
  }
  for (const m of PROPS.mines) {
    const off = rotY(MINE_CART.x, MINE_CART.z, m.rot);
    const x = m.x + off.x;
    const z = m.z + off.z;
    const top = topY(seed, x, z, MINE_CART.height);
    out.push({
      type: 'circle',
      x,
      z,
      r: MINE_CART.r,
      cameraTopY: top,
      moveTopY: top,
      standable: true,
    });
  }

  // Editor-placed assets with a collide footprint (custom maps only; the
  // built-in world has no placements). The ONE placement record drives both the
  // renderer and this collider, so what you see is what you collide with.
  //
  // Shape resolution, most specific first. A bare circle is the LAST resort:
  // it is what a placement gets when nothing knows the asset's real footprint,
  // and for a long stretch it was the only thing emitted here, so every house,
  // wall and market stall a maker placed blocked as a disc the size of its
  // widest point. Everything below exists to stop that.
  //
  //   p.hitboxes        hand-edited boxes / the fine mesh bake on THIS
  //                     placement. The maker's own edit, so it wins outright.
  //   p.collideCustom   the maker deliberately kept the simple radius/shape.
  //   ramp decks        a walkable deck carries the floor (placement_ramps.ts),
  //                     so the body must NOT also wall the ramp it belongs to.
  //   baked boxes       the per-asset table (asset_collision.generated.ts) or a
  //                     Collision Master override, which is what gives all 1300+
  //                     catalogue assets a real shape.
  //   circle / square   the legacy footprint.
  for (const p of content.placements ?? []) {
    // The opt-in gate, and it must stay FIRST. custom_map.ts only writes
    // collideRadius when the placement's collision mode is not 'none', so an
    // absent radius IS the maker's "this one is decoration" — and every shape
    // below (baked boxes especially) would otherwise hand it collision anyway,
    // silently breaking the editor's collide toggle and decorationsMode.
    if (!p.collideRadius || p.collideRadius <= 0) continue;
    // Everything this placement emits gets a dev attribution stamp (see
    // Collider.src) naming the model path and which lane produced the shape.
    const srcMark = out.length;
    const stamp = (lane: string): void => {
      const src = `${p.path}#${lane}`;
      for (let i = srcMark; i < out.length; i++) out[i].src = src;
    };
    // Detached placements anchor at their frozen ground (they can sit INSIDE a
    // cave); grounded ones stand on the TERRAIN — the same seat the renderer
    // (placed_assets.ts) and the asset's own ramp decks (placement_ramps.ts)
    // use. Not groundHeight: that already includes this placement's own floor
    // deck, so a building with a walkable ground floor had every box lifted by
    // the deck height (the tavern's 2F floor boxes sat 0.37yd above the stair
    // summit and walled the landing). Either way the base gates the pass-under
    // check, so tubes run beneath surface decor but a rock placed down in the
    // cave still blocks.
    const base = p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, seed);
    if (p.worldPropKind === 'fence' && p.worldPropWidth) {
      const width = p.worldPropWidth * p.scale * (p.scaleX ?? 1);
      const depth = (p.worldPropDepth ?? 0.1) * p.scale * (p.scaleZ ?? 1);
      out.push({
        type: 'obb',
        x: p.x,
        z: p.z,
        hw: width / 2 + FENCE_END_PAD,
        hd: Math.max(FENCE_HALF_DEPTH, depth / 2),
        rot: p.rotY,
        cameraTopY: base + (p.y ?? 0) + FENCE_RAIL_HEIGHT,
        baseY: base + (p.y ?? 0),
        isFence: true,
      });
      stamp('fence');
      continue;
    }
    // Collision Master VOLUMES come first, ahead of every derived shape: the
    // maker modelled them and the editor draws them as the collision outline,
    // so they ARE the contract. This takes exactly the placements the baked-box
    // branch below would have taken (`derived`) — hand-edited hitboxes, a
    // hand-picked simple footprint and live session ramps still outrank the
    // asset default — and swaps the rectangle FITTED to each band for the
    // band's real outline.
    const derived = !(
      (p.hitboxes && p.hitboxes.length > 0) ||
      p.collideCustom ||
      (p.ramps && p.ramps.length > 0)
    );
    const prisms = derived
      ? authoredPrismsForPath(p.path, p.scale > 0 ? p.scale : 1)
      : NO_AUTHORED_PRISMS;
    if (prisms.length > 0) {
      emitPlacementPrisms(out, p, prisms, base);
      stamp('prism');
      continue;
    }
    const baked =
      p.hitboxes && p.hitboxes.length > 0
        ? p.hitboxes
        : p.collideCustom || (p.ramps && p.ramps.length > 0)
          ? null
          : bakedBoxesForPath(p.path, content.assetCollision);
    if (baked) {
      emitPlacementBoxes(out, p, baked, base);
      stamp(p.hitboxes && p.hitboxes.length > 0 ? 'hitboxes' : 'baked');
      continue;
    }
    // A placement with walkable ramp DECKS is walk-through except for the deck
    // floor it raises (placement_ramps.ts): the legacy circle below would wall
    // the player off their own ramp.
    //
    // BOTH deck sources count. `p.ramps` is a live Collision Master session
    // (pre-Lock-In); `authoredRampsForPath` is the SAVED override, and it has to
    // be checked here too — a stairs placement stamped with a simple footprint
    // before its ramp was authored reaches this line with `baked` null and used
    // to pick up a solid circle ("I can't walk up my own ramp, I get stuck").
    // Hand-edited `hitboxes` are deliberate blockers (a railing) and returned
    // above, so this never swallows one.
    if (p.ramps && p.ramps.length > 0) continue;
    if (authoredRampsForPath(p.path).length > 0) continue;
    if (!p.collideRadius || p.collideRadius <= 0) continue;
    const legacyTop = base + Math.max(2.5, p.collideRadius * 2);
    if (p.collideShape === 'square') {
      out.push({
        type: 'obb',
        x: p.x,
        z: p.z,
        hw: p.collideRadius,
        hd: p.collideRadius,
        rot: p.rotY,
        cameraTopY: legacyTop,
        baseY: base,
      });
      stamp('square');
      continue;
    }
    out.push({
      type: 'circle',
      x: p.x,
      z: p.z,
      r: p.collideRadius,
      cameraTopY: legacyTop,
      baseY: base,
    });
    stamp('circle');
  }

  // Editor-authored invisible blocker walls (custom maps only): one fence-width
  // OBB per segment, exactly the PROPS.fences math above, but NOT isFence (a
  // jump never clears a blocker). Purely static data: no rng draws, no
  // tick-order impact, and no render mesh in playtest.
  for (const b of content.blockers ?? []) {
    const dx = b.x2 - b.x1,
      dz = b.z2 - b.z1;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const x = (b.x1 + b.x2) / 2,
      z = (b.z1 + b.z2) / 2;
    out.push({
      type: 'obb',
      x,
      z,
      hw: len / 2 + FENCE_END_PAD,
      hd: FENCE_HALF_DEPTH,
      rot: Math.atan2(-dz, dx),
      cameraTopY: topY(seed, x, z, BLOCKER_WALL_HEIGHT),
    });
  }

  // Editor-authored collider volumes (custom maps only): the editor's own
  // collision primitives, placed as reserved 'collider/<kind>' placements and
  // resolved by sim/collider_volumes.ts. Boxes and walls are full-height OBBs
  // (a jump never clears one) and spheres are circles. PLANES deliberately emit
  // nothing here: they do not block, they raise the walkable floor, which
  // world.groundHeight reads straight off content.colliderVolumes.
  for (const v of content.colliderVolumes ?? []) {
    if (v.kind === 'box' || v.kind === 'wall') {
      out.push({
        type: 'obb',
        x: v.x,
        z: v.z,
        hw: v.sizeX / 2,
        hd: v.sizeZ / 2,
        rot: v.rotY,
        cameraTopY: topY(seed, v.x, v.z, Math.max(1, v.sizeY)),
        underY: topY(seed, v.x, v.z, 0),
      });
    } else if (v.kind === 'sphere') {
      out.push({
        type: 'circle',
        x: v.x,
        z: v.z,
        r: v.sizeX / 2,
        cameraTopY: topY(seed, v.x, v.z, Math.max(1, v.sizeX)),
        underY: topY(seed, v.x, v.z, 0),
      });
    }
  }

  // The banker's strongbox, LAST: its placement algorithm samples the chest
  // footprint against every collider above (the same choice the renderer used
  // to make against the full grid before the chest itself became solid). The
  // resolved spots are cached per grid so render/banker_chest.ts consumes the
  // SAME spot instead of re-resolving against a grid that now contains the
  // chest. Skipped for a banker whose own authored spot is blocked (a custom
  // world's spawn would relocate the NPC and the chest would strand).
  const chestSpots: BankerChestSpot[] = [];
  const chestBlockedAt: BankerChestBlockedAt = (_s, x, z, r, ignoreFences) => {
    const res = resolveAgainst(out, x, z, r, ignoreFences);
    return Math.abs(res.x - x) > 1e-4 || Math.abs(res.z - z) > 1e-4;
  };
  // The ACTIVE content's roster, like the npc veto above: a custom map's own
  // banker gets a chest and a builtin banker absent from that map gets none.
  for (const npc of Object.values(content.npcs)) {
    const rec = npc as { pos?: { x: number; z: number }; facing?: number; banker?: true };
    if (!rec.banker || !rec.pos) continue;
    const seat = resolveAgainst(out, rec.pos.x, rec.pos.z, 0.6);
    if (Math.abs(seat.x - rec.pos.x) > 1e-4 || Math.abs(seat.z - rec.pos.z) > 1e-4) continue;
    const anchor = { pos: rec.pos, facing: rec.facing ?? 0 };
    const local = resolveSolidBankerChestPlacement(anchor, seed, chestBlockedAt);
    if (!local) continue;
    const center = bankerChestCenterWorld(anchor, local);
    const top = topY(seed, center.x, center.z, BANKER_CHEST_TARGET_HEIGHT);
    chestSpots.push({
      anchorX: rec.pos.x,
      anchorZ: rec.pos.z,
      x: center.x,
      z: center.z,
      rotationY: anchor.facing + local.rotationY,
      localPlacement: local,
    });
    out.push({
      type: 'obb',
      x: center.x,
      z: center.z,
      hw: BANKER_CHEST_HALF_WIDTH,
      hd: BANKER_CHEST_HALF_DEPTH,
      rot: anchor.facing + local.rotationY,
      cameraTopY: top,
      moveTopY: top,
      standable: true,
    });
  }
  lastBuiltBankerChestSpots = chestSpots;

  return out;
}

/** A resolved banker-chest spot: where the strongbox stands and collides. */
export interface BankerChestSpot {
  anchorX: number;
  anchorZ: number;
  x: number;
  z: number;
  rotationY: number;
  localPlacement: BankerChestLocalPlacement;
}

// Captured by the most recent staticWorldColliders run and stored per grid,
// so bankerChestSpots(seed) always reflects the active world's build.
let lastBuiltBankerChestSpots: BankerChestSpot[] = [];
const bankerChestSpotsByGrid = new WeakMap<object, BankerChestSpot[]>();

/**
 * The resolved banker-chest placements for the active world at `seed`: the
 * single source render/banker_chest.ts places the mesh from, so the drawn
 * chest and its standable collider are always the same box.
 */
export function bankerChestSpots(seed: number): readonly BankerChestSpot[] {
  return bankerChestSpotsByGrid.get(gridFor(seed)) ?? [];
}

/** Test-only visibility into the authored static set so world-layout tests can
 *  pin real collider extents and camera tops rather than re-testing helpers. */
export const colliderInternalsForTest = { staticWorldColliders };

// Interior collision sets, in instance-local coordinates. Derived from the
// SAME plain-data layouts the renderer builds the KayKit modules from
// (sim/dungeon_layout.ts), so render geometry and collision can no longer
// drift apart. The boss dais is walkable and deliberately has no collider:
// its elevation is FLOOR, not obstacle (world.ts groundHeight lifts it).
const ARENA_COLLIDERS: Collider[] = layoutColliders(ARENA_LAYOUT);
const DROWNED_COURT_COLLIDERS: Collider[] = layoutColliders(DROWNED_COURT_LAYOUT);
// Thornhollow Fields battleground (the Thornhollow field): compiled per-asset baked
// collision, far too many colliders for the old linear per-slot scan. Every
// slot's copy is registered into the open-world spatial GRID instead (see
// gridFor), so movement, sight, camera and support all reach the field
// through the same cell reads the open world uses. Fresh copies per grid
// build: gridFor stamps its own gridIndex onto every collider, so two grids
// (content/seed pairs) must never share collider objects.
function bandSlotColliders(): Collider[] {
  const out: Collider[] = [];
  const base = battlegroundColliders();
  for (let slot = 0; slot < BG_SLOT_COUNT; slot++) {
    const o = battlegroundOrigin(slot);
    for (const c of base) {
      // Y values (cameraTopY/moveTopY/topSlope) stay as-is: the band's ground
      // IS the field heightfield, so field-local Y is absolute world Y.
      out.push({ ...c, x: c.x + o.x, z: c.z + o.z });
    }
  }
  return out;
}

// The Last Keep: an authored room-graph interior, so its walls (minus
// doorways) and decor footprints all derive from the one shared layout,
// exactly like the rift citadel floors (layoutColliders routes through
// authoredColliders). Seated on DUNGEON_FLOOR_Y like every derived interior
// set below, so its standable tops read in the same frame.
const LASTKEEP_COLLIDERS: Collider[] = layoutColliders(LASTKEEP_LAYOUT, undefined, DUNGEON_FLOOR_Y);
// Dawnhold Castle: the Evergarden garden palace, same authored room-graph
// derivation as The Last Keep (walls minus doorways plus decor footprints).
const DAWNHOLD_COLLIDERS: Collider[] = layoutColliders(DAWNHOLD_LAYOUT, undefined, DUNGEON_FLOOR_Y);

// Arena slots host fixed maps by slot parity (EVEN = Coliseum, ODD = Drowned
// Court; see ARENA_MAPS in dungeon_layout.ts). Both sets are built once at
// module load, so per-slot collision stays fully static. Exported for the
// per-slot layout pin tests.
export function arenaCollidersForSlot(slot: number): Collider[] {
  return ((slot % 2) + 2) % 2 === 1 ? DROWNED_COURT_COLLIDERS : ARENA_COLLIDERS;
}

// Interiors whose collision is NOT derived from an INTERIOR_LAYOUTS room plan:
// Wildheart is an open field (walls plus prop specs) and the Last Keep is an
// authored room graph. Both are static, so they short-circuit the per-dungeon
// derivation below rather than falling back to the crypt plan.
const STATIC_INTERIOR_COLLIDERS: Record<string, Collider[]> = {
  wildheart: WILDHEART_COLLIDERS,
  lastkeep: LASTKEEP_COLLIDERS,
  dawnhold: DAWNHOLD_COLLIDERS,
};

// Per-dungeon interior sets: assembly extracted to interior_collider_sets.ts
// (which also appends the Ignivar authored dressing-prop colliders).
function interiorCollidersFor(dungeonId: string | null, interior: string): Collider[] {
  return derivedInteriorColliders(dungeonId, interior, STATIC_INTERIOR_COLLIDERS);
}

// ---------------------------------------------------------------------------
// Spatial grid + movement resolution
// ---------------------------------------------------------------------------

// GRID_CELL / MAX_BODY_RADIUS moved to collider_cells.ts (shared with the
// rift region indexes); imported above.
/** Fence/blocker wall half-thickness (yards); the editor's blocker overlay
 * reuses it so the drawn wall matches the collider exactly. */
export const FENCE_HALF_DEPTH = 0.35;
const FENCE_END_PAD = 0.35;
/** Blocker walls are full-height (a jump never clears one, unlike a fence);
 * this visual top is retained for the record. */
const BLOCKER_WALL_HEIGHT = 6;
/**
 * Visual top of a low village fence rail (yards). The fence.glb rail is ~0.33yd
 * native and renders at ~2.9x, so its silhouette tops out around waist height.
 * This value feeds ONLY the spell line-of-sight check (`sightBlockedAt`): it MUST
 * stay below `SIGHT_HEIGHT` (1.6) so a caster sees and casts over a fence, matching what
 * the player sees on screen (issue #1668). The old 2.8 estimate sat above the
 * eye line and wrongly blocked casts. A jump still clears the rail for movement
 * regardless (see sim `Entity.jumping`). */
const FENCE_RAIL_HEIGHT = 0.95;

interface ColliderGrid {
  cells: Map<number, Collider[]>;
  // The authored prop grid above is cheap and eager. The multi-realm
  // decoration field is generated one queried cell at a time, then combined
  // with that authored list. This keeps collision identical without making a
  // cold Sim enumerate the whole continent before its first spawn.
  decorationCells: Map<number, Collider[]>;
  combinedCells: Map<number, Collider[]>;
  /** Decoration bodies built so far, keyed by world position, so a body that
   *  spans two cells is the SAME object in both. That is what lets the
   *  stamp dedupe below collapse it to a single test, exactly as it does for
   *  the eagerly indexed authored colliders. */
  decorationBodies: Map<string, Collider>;
  /** Per-collider visit stamps for allocation-free multi-cell dedupe. Grows
   *  as lazily built decoration bodies claim ids past the authored range. */
  stamps: Uint32Array;
  /** Next free `gridIndex`. Authored colliders own [0, authoredCount); every
   *  decoration body takes the next id as it materializes. */
  nextGridIndex: number;
  /** Bumped once per query; a stamp equal to it means "already collected". */
  gen: number;
}

// cellKey / cellKeyAt moved to collider_cells.ts (shared with the rift
// region indexes); imported above.

// Grids are cached per (active world content, seed). The WeakMap keeps the
// built-in world's grid warm forever and lets swapped-out custom maps be
// collected; the editor invalidates explicitly after mutating placements.
const gridCaches = new WeakMap<WorldContent, Map<number, ColliderGrid>>();

/** Drop the cached collider grid for the ACTIVE world content (editor-only:
 * call after mutating its placements/props in place). */
export function invalidateStaticColliders(): void {
  gridCaches.delete(getActiveWorldContent());
  // Stairs-deck ramps derive from the SAME placements, and they are a separate
  // cache: bust them together or an edit moves the blockers while the walkable
  // deck stays where the stairs used to be.
  invalidatePlacementRamps(getActiveWorldContent());
}

// colliderBounds moved to collider_cells.ts; imported above.

function gridFor(seed: number): ColliderGrid {
  const content = getActiveWorldContent();
  let perContent = gridCaches.get(content);
  if (!perContent) {
    perContent = new Map();
    gridCaches.set(content, perContent);
  }
  let grid = perContent.get(seed);
  if (grid) return grid;
  const built = staticWorldColliders(seed);
  // The battleground band rides the same grid: its cells are far past the
  // overworld rect, so the hash map simply grows by the field's cells. Pushed
  // in a loop, never spread as arguments: the field times BG_SLOT_COUNT is
  // already five figures of colliders, and an argument-count limit that scales
  // with both the field and the slot count is not a limit worth having.
  for (const c of bandSlotColliders()) built.push(c);
  // Index every collider once so queries can dedupe against a flat stamp
  // buffer (a collider spanning cells appears in each of them).
  for (let i = 0; i < built.length; i++) built[i].gridIndex = i;
  grid = {
    cells: new Map(),
    decorationCells: new Map(),
    combinedCells: new Map(),
    decorationBodies: new Map(),
    stamps: new Uint32Array(built.length),
    nextGridIndex: built.length,
    gen: 0,
  };
  // Bind the chest spots this build resolved to this grid, so a later build
  // for another world/seed can never leak its spots into this one's readers.
  bankerChestSpotsByGrid.set(grid, lastBuiltBankerChestSpots);
  for (const c of built) registerInCells(grid, c);
  perContent.set(seed, grid);
  // Streetlamps join AFTER the grid is published, and the order is the whole
  // trick: planning a post calls resolvePosition to check the spot is free,
  // which routes straight back through gridFor. Caching the lamp-free grid
  // first turns that re-entry into a plain cache hit instead of a recursive
  // rebuild, and hands the plan exactly the rule it wants: a post is vetted
  // against buildings, props and decorations, never against another lamp
  // (spacing between lamps is the layout's own minSeparation).
  addStreetlampColliders(grid, seed);
  return grid;
}

/**
 * Index one collider into every cell its bounds, inflated by MAX_BODY_RADIUS,
 * touch. That margin is what makes the single-cell support and glue reads
 * complete, so every path that adds a collider to a grid goes through here
 * rather than repeating the arithmetic.
 */
function registerInCells(grid: ColliderGrid, c: Collider): void {
  const b = colliderBounds(c);
  const x0 = Math.floor((b.minX - MAX_BODY_RADIUS) / GRID_CELL);
  const x1 = Math.floor((b.maxX + MAX_BODY_RADIUS) / GRID_CELL);
  const z0 = Math.floor((b.minZ - MAX_BODY_RADIUS) / GRID_CELL);
  const z1 = Math.floor((b.maxZ + MAX_BODY_RADIUS) / GRID_CELL);
  for (let gx = x0; gx <= x1; gx++) {
    for (let gz = z0; gz <= z1; gz++) {
      const key = cellKey(gx, gz);
      const list = grid.cells.get(key);
      if (list) list.push(c);
      else grid.cells.set(key, [c]);
    }
  }
}

// ---------------------------------------------------------------------------
// Streetlamps
// ---------------------------------------------------------------------------

/** Body radius a candidate lamp spot is vetted with: resolvePosition pushes a
 *  body out of whatever it overlaps, so a spot that comes back moved was
 *  already owned by a building, stall, well or fence, and a lamp inside one of
 *  those is worse than no lamp. */
const LAMP_CLEARANCE = 1.1;
/** How far a candidate may be nudged by a collider before the spot is refused. */
const LAMP_CLEARANCE_EPSILON = 0.05;

// The lamps this grid resolved, stored per grid so a later build for another
// world or seed can never leak its posts into this one's readers. Same shape
// (and the same reason) as bankerChestSpotsByGrid above.
const streetlampsByGrid = new WeakMap<object, PlacedStreetlamp[]>();

/** Strict authored-area identity at a point, or null outside every zone. This
 *  decides which fixture style a stretch of road is lit with, so it must not
 *  fall back to a nearest zone: a lamp just outside every rect is genuinely
 *  wilderness and takes the default. */
function lampAreaAt(x: number, z: number, zones: readonly WorldZoneRect[]): string | null {
  for (const zone of zones) {
    const xMin = zone.xMin ?? STRIP_MIN_X;
    const xMax = zone.xMax ?? STRIP_MAX_X;
    if (x >= xMin && x < xMax && z >= zone.zMin && z < zone.zMax) return zone.id;
  }
  return null;
}

interface WorldZoneRect {
  id: string;
  zMin: number;
  zMax: number;
  xMin?: number;
  xMax?: number;
}

/**
 * Plan the whole world's streetlamps for `seed`, with each site's fixture
 * identity resolved. The ONE list: colliders below plant a post on it and
 * `streetlampPlacements` hands the same rows to the renderer, so what is drawn
 * and what is walked into cannot come apart.
 */
function buildStreetlampPlacements(seed: number): PlacedStreetlamp[] {
  const content = getActiveWorldContent();
  const plan = planStreetlamps(
    content.roads,
    content.zones.map((zone) => ({ x: zone.hub.x, z: zone.hub.z, radius: zone.hub.radius })),
    {
      groundAt: (x, z) => terrainHeight(x, z, seed),
      blocked: (x, z) => {
        const resolved = resolvePosition(seed, x, z, LAMP_CLEARANCE);
        return (
          Math.abs(resolved.x - x) > LAMP_CLEARANCE_EPSILON ||
          Math.abs(resolved.z - z) > LAMP_CLEARANCE_EPSILON
        );
      },
      roadClear: roadDistance,
      areaAt: (x, z) => lampAreaAt(x, z, content.zones),
    },
    {
      authoredClearMin: MAX_BODY_RADIUS + Math.max(...Object.values(STREETLAMP_COLLIDER_RADIUS)),
    },
  );
  const styled = styleStreetlampSites(plan.sites, content.zones);
  // Remember the PRISTINE builtin plan for the editor's streetlamp promotion:
  // planned before any post stands, so nothing self-blocks. A plan computed
  // against a world that already carries lamps (as colliders or as promoted
  // placements) drops nearly every site to its own clearance probe.
  if (content === BUILTIN_WORLD) builtinLampPlanBySeed.set(seed, styled);
  return styled;
}

const builtinLampPlanBySeed = new Map<number, PlacedStreetlamp[]>();

/**
 * The builtin world's streetlamp plan for `seed`, for the editor's promotion
 * of lamps into editable placements. Cached the first time the pristine
 * builtin world plans (its grid build, or this call while it is active); null
 * when it has never planned and the builtin world is not active to plan now —
 * callers skip the promotion then and retry on a later boot.
 */
export function builtinStreetlampPlan(seed: number): readonly PlacedStreetlamp[] | null {
  const cached = builtinLampPlanBySeed.get(seed);
  if (cached) return cached;
  if (getActiveWorldContent() !== BUILTIN_WORLD) return null;
  return streetlampPlacements(seed);
}

/**
 * Plant a solid post on every lamp the plan placed, then bind the plan to this
 * grid for the renderer to read back.
 *
 * The post is a full-height circle: no `moveTopY`, so it blocks at any
 * altitude. A five-and-a-half yard lamp is not something a jump clears, and
 * nothing about it is standable. `cameraTopY` carries its real top, which puts
 * it above the sight line and lets it block a cast exactly as a tree trunk of
 * the same girth does.
 *
 * A lamp standing where an authored NPC does keeps its mesh and loses its
 * collider, the same rule the graveyard headstones follow: the town's furniture
 * never walls off someone you have to walk up to and talk to.
 */
function addStreetlampColliders(grid: ColliderGrid, seed: number): void {
  // A world whose DOCUMENT owns the lamps as placements plans none at all:
  // the placements carry the fixtures, the colliders and (via the renderer's
  // promoted lane) the night lights, so the one list binds empty and every
  // consumer of it stands down together.
  if (getActiveWorldContent().promotedScenery?.streetlamps === true) {
    streetlampsByGrid.set(grid, []);
    return;
  }
  const placements = [...buildStreetlampPlacements(seed), ...forgefatherStreetlampSites()];
  streetlampsByGrid.set(grid, placements);
  if (placements.length === 0) return;
  const npcSpots = townNpcPositions();
  let planted = 0;
  for (const lamp of placements) {
    const r = STREETLAMP_COLLIDER_RADIUS[lamp.style];
    if (standsOnNpcSpot(lamp.x, lamp.z, r, npcSpots)) continue;
    const post: Collider = {
      type: 'circle',
      x: lamp.x,
      z: lamp.z,
      r,
      cameraTopY: lamp.y + STREETLAMP_FIXTURE_HEIGHT,
    };
    assignLateGridIndex(grid, post);
    registerInCells(grid, post);
    planted++;
  }
  // Vetting the sites above ran resolvePosition, which caches a combined
  // authored-plus-decoration list per cell. Those entries predate the posts
  // just registered, so drop the combined view (the expensive decoration
  // cells stay) and let it rebuild with the lamps in it.
  if (planted > 0) grid.combinedCells.clear();
}

/**
 * The resolved streetlamp placements for the active world at `seed`: the single
 * source `src/render/streetlamps.ts` instances its fixtures from, so the post
 * you see is the post you collide with (the `bankerChestSpots` arrangement).
 */
export function streetlampPlacements(seed: number): readonly PlacedStreetlamp[] {
  return streetlampsByGrid.get(gridFor(seed)) ?? [];
}

// Decoration scale is `0.7 + hash * 0.9` (world.ts), and rocks have the
// largest collision multiplier (ROCK_RADIUS_PER_SCALE). This conservative
// bound selects every candidate whose circle could be assigned to a queried
// grid cell.
const MAX_DECORATION_COLLIDER_RADIUS = 1.6 * ROCK_RADIUS_PER_SCALE;

function decorationCollider(seed: number, d: Decoration): Collider | null {
  if (d.kind === 'rock') {
    if (!decorationHasCollider(d)) return null;
    // Height comes from decoration_dims (the one source the renderer scales
    // the rock GLB to), so the collision top IS the silhouette top: a squat
    // field stone is inside the character step height and gets walked over,
    // instead of carrying an invisible wall above it.
    const height = rockHeight(d.x, d.z, d.scale, seed);
    const top = topY(seed, d.x, d.z, height);
    return {
      type: 'circle',
      x: d.x,
      z: d.z,
      r: rockRadius(d.scale),
      cameraTopY: top,
      moveTopY: top,
      standable: true,
    };
  }
  // tree trunks only; canopies don't block
  return {
    type: 'circle',
    x: d.x,
    z: d.z,
    r: 0.55 * d.scale,
    cameraTopY: topY(seed, d.x, d.z, 7.5 * d.scale),
  };
}

/** Claim the next `gridIndex` for a collider built after the eager pass,
 *  growing the grid's stamp buffer to cover it. Authored colliders are indexed
 *  in gridFor; streetlamp posts and lazily materialized decoration bodies join
 *  the same id space afterwards, which is what keeps queryOpenWorldColliders'
 *  dedupe complete across all three. */
function assignLateGridIndex(grid: ColliderGrid, c: Collider): void {
  const i = grid.nextGridIndex++;
  c.gridIndex = i;
  if (i >= grid.stamps.length) {
    const grown = new Uint32Array(Math.max(i + 1, grid.stamps.length * 2));
    grown.set(grid.stamps);
    grid.stamps = grown;
  }
}

function collidersInCell(grid: ColliderGrid, seed: number, gx: number, gz: number): Collider[] {
  const key = cellKey(gx, gz);
  const cached = grid.combinedCells.get(key);
  if (cached) return cached;

  let decorations = grid.decorationCells.get(key);
  if (!decorations) {
    decorations = [];
    const minX = gx * GRID_CELL;
    const maxX = (gx + 1) * GRID_CELL;
    const minZ = gz * GRID_CELL;
    const maxZ = (gz + 1) * GRID_CELL;
    const pad = MAX_BODY_RADIUS + MAX_DECORATION_COLLIDER_RADIUS;
    for (const decoration of generateDecorationsInBounds(seed, {
      minX: minX - pad,
      maxX: maxX + pad,
      minZ: minZ - pad,
      maxZ: maxZ + pad,
    })) {
      // One body per decoration, shared by every cell it spans (its position
      // is its identity: the field is deterministic in the seed). A neighbour
      // cell materialized later reuses this exact object, so a multi-cell
      // query dedupes it like any authored collider instead of testing and
      // depenetrating against the same surface twice.
      const bodyKey = `${decoration.x},${decoration.z}`;
      let collider = grid.decorationBodies.get(bodyKey);
      if (!collider) {
        const built = decorationCollider(seed, decoration);
        if (!built) continue;
        assignLateGridIndex(grid, built);
        grid.decorationBodies.set(bodyKey, built);
        collider = built;
      }
      const bounds = colliderBounds(collider);
      const x0 = Math.floor((bounds.minX - MAX_BODY_RADIUS) / GRID_CELL);
      const x1 = Math.floor((bounds.maxX + MAX_BODY_RADIUS) / GRID_CELL);
      const z0 = Math.floor((bounds.minZ - MAX_BODY_RADIUS) / GRID_CELL);
      const z1 = Math.floor((bounds.maxZ + MAX_BODY_RADIUS) / GRID_CELL);
      if (gx >= x0 && gx <= x1 && gz >= z0 && gz <= z1) decorations.push(collider);
    }
    grid.decorationCells.set(key, decorations);
  }

  const authored = grid.cells.get(key);
  const combined = authored?.length
    ? decorations.length
      ? [...authored, ...decorations]
      : authored
    : decorations;
  grid.combinedCells.set(key, combined);
  return combined;
}

// Push (x,z) out of one collider. Returns the corrected point, or null if clear.
/**
 * The axis-aligned box that covers a prism's outline. Consumers that can only
 * reason about rectangles (minimap, the coarse camera sweep) read this rather
 * than every face.
 */
export function prismBox(c: PrismCollider): {
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
} {
  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity;
  for (let i = 0; i < c.poly.length; i += 2) {
    const u = c.poly[i];
    const v = c.poly[i + 1];
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  if (minU > maxU) return { x: c.x, z: c.z, hw: c.br, hd: c.br, rot: 0 };
  return {
    x: c.x + (minU + maxU) / 2,
    z: c.z + (minV + maxV) / 2,
    hw: (maxU - minU) / 2,
    hd: (maxV - minV) / 2,
    rot: 0,
  };
}

/** Is (x,z) inside the prism's outline (no body-radius inflation)? */
export function insidePrism(c: PrismCollider, x: number, z: number): boolean {
  const px = x - c.x;
  const pz = z - c.z;
  if (px * px + pz * pz > c.br * c.br) return false;
  const poly = c.poly;
  const n = poly.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const ax = poly[i];
    const az = poly[i + 1];
    const ex = poly[j] - ax;
    const ez = poly[j + 1] - az;
    if ((px - ax) * ez - (pz - az) * ex > 0) return false;
  }
  return true;
}

/**
 * Push a body of radius `r` out of a convex prism: the nearest face for a body
 * outside it, the SHALLOWEST face for one already inside (the exit it is
 * closest to), so a mover that spawns in a wall walks out the near side rather
 * than being flung through the far one.
 */
function pushOutPrism(
  c: PrismCollider,
  x: number,
  z: number,
  r: number,
  feetY?: number,
): { x: number; z: number } | null {
  const px = x - c.x;
  const pz = z - c.z;
  const reach = c.br + r;
  if (px * px + pz * pz > reach * reach) return null; // O(1) reject
  // Height-aware: a lofted prism collides with its authored section at the
  // mover's own feet height, so a tapered volume feels exactly as drawn.
  const poly = prismPolyAt(c, feetY);
  const n = poly.length;
  let inside = true;
  let faceD = Number.NEGATIVE_INFINITY;
  let faceNx = 0;
  let faceNz = 0;
  let nearX = 0;
  let nearZ = 0;
  let nearD2 = Infinity;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const ax = poly[i];
    const az = poly[i + 1];
    const ex = poly[j] - ax;
    const ez = poly[j + 1] - az;
    const len2 = ex * ex + ez * ez;
    if (len2 < 1e-12) continue;
    const len = Math.sqrt(len2);
    // Counter-clockwise outline: the outward normal of a->b is (ez, -ex).
    const nx = ez / len;
    const nz = -ex / len;
    const d = (px - ax) * nx + (pz - az) * nz;
    if (d > 0) inside = false;
    if (d > faceD) {
      faceD = d;
      faceNx = nx;
      faceNz = nz;
    }
    let t = ((px - ax) * ex + (pz - az) * ez) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + ex * t;
    const cz = az + ez * t;
    const d2 = (px - cx) * (px - cx) + (pz - cz) * (pz - cz);
    if (d2 < nearD2) {
      nearD2 = d2;
      nearX = cx;
      nearZ = cz;
    }
  }
  if (nearD2 === Infinity) return null; // degenerate outline
  if (inside) {
    // faceD is negative inside: clear the face by the body radius on top of it.
    const push = r - faceD;
    return { x: c.x + px + faceNx * push, z: c.z + pz + faceNz * push };
  }
  const dist = Math.sqrt(nearD2);
  if (dist >= r) return null;
  if (dist < 1e-6) {
    return { x: c.x + nearX + faceNx * r, z: c.z + nearZ + faceNz * r };
  }
  const k = r / dist;
  return { x: c.x + nearX + (px - nearX) * k, z: c.z + nearZ + (pz - nearZ) * k };
}

function pushOut(
  c: Collider,
  x: number,
  z: number,
  r: number,
  feetY?: number,
): { x: number; z: number } | null {
  if (c.type === 'prism') return pushOutPrism(c, x, z, r, feetY);
  if (c.type === 'circle') {
    const dx = x - c.x,
      dz = z - c.z;
    const min = c.r + r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return null;
    const d = Math.sqrt(d2);
    if (d < 1e-6) return { x: c.x + min, z: c.z };
    const k = min / d;
    return { x: c.x + dx * k, z: c.z + dz * k };
  }
  // OBB: into local frame
  const local = rotY(x - c.x, z - c.z, -c.rot);
  const ex = c.hw + r,
    ez = c.hd + r;
  if (Math.abs(local.x) >= ex || Math.abs(local.z) >= ez) return null;
  const pushX = ex - Math.abs(local.x);
  const pushZ = ez - Math.abs(local.z);
  const out = { x: local.x, z: local.z };
  if (pushX < pushZ) out.x = Math.sign(local.x || 1) * ex;
  else out.z = Math.sign(local.z || 1) * ez;
  const world = rotY(out.x, out.z, c.rot);
  return { x: c.x + world.x, z: c.z + world.z };
}

function resolveAgainst(
  list: Collider[],
  x: number,
  z: number,
  r: number,
  ignoreFences = false,
  mover?: MoverHeight,
): { x: number; z: number } {
  let px = x,
    pz = z;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const c of list) {
      if (ignoreFences && c.type === 'obb' && c.isFence) continue;
      if (passesOver(c, mover, px, pz)) continue;
      if (passesUnder(c, mover?.y)) continue;
      const res = pushOut(c, px, pz, r, mover?.y);
      if (res) {
        px = res.x;
        pz = res.z;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x: px, z: pz };
}

// ---------------------------------------------------------------------------
// Procedural Rift regions. A rift floor's collision comes from its GENERATED
// DungeonLayout, so it cannot be a static INTERIOR_COLLIDERS entry. rift/runs.ts
// publishes the active floor's instance-local collider set here on spawn/descent
// and clears it on free; every region-aware collision function below reads it, so
// movement, mob pathing, and line-of-sight all respect the
// generated geometry uniformly. Keyed by a per-Sim COLLISION TOKEN (allocated
// once per world via allocRiftCollisionToken, NOT the world seed: two Sims in
// one process can share a seed) plus the instance origin, so concurrent rifts
// and multiple Sims stay isolated. Token 0 means "no rift regions".
interface RiftRegion {
  ox: number;
  oz: number;
  colliders: Collider[];
  /** Cell index over `colliders`, built once at publish. Movement and sight
   *  read the sample point's cell instead of scanning the whole floor's list;
   *  the MAX_BODY_RADIUS registration margin (collider_cells.ts) keeps the
   *  single-cell read complete for every live resolve radius. */
  cells: ColliderCellIndex;
}
// token -> floor origin z -> region. Every region shares RIFT_X_MIN as its ox
// and floor origins are RIFT_FLOOR_SPACING (340) apart while regions span
// +/- RIFT_REGION_HALF_Z (160), so origins never collide and oz is a unique
// key. riftNearestFloorOriginZ derives the only candidate origin for a
// position, making the lookup O(1) instead of a scan over every occupied
// slot (NEVER riftOriginAt here: its slot clamp maps the south half of a
// floor 0 into the previous slot's top floor).
const RIFT_REGIONS = new Map<number, Map<number, RiftRegion>>();
let NEXT_RIFT_TOKEN = 1;

export function allocRiftCollisionToken(): number {
  return NEXT_RIFT_TOKEN++;
}

/** Publish a rift floor's generated collider set. `cellSize` is a test seam:
 *  the equivalence suite publishes a reference region with cellSize Infinity,
 *  one all-covering cell that reproduces the pre-index full-list scan (see
 *  collider_cells.ts: a finite size quadrants at the local origin instead). */
export function setRiftRegion(
  token: number,
  ox: number,
  oz: number,
  colliders: Collider[],
  cellSize?: number,
): void {
  let byOz = RIFT_REGIONS.get(token);
  if (!byOz) {
    byOz = new Map();
    RIFT_REGIONS.set(token, byOz);
  }
  // The seam may only WIDEN cells (the reference token's one giant cell): a
  // smaller-than-GRID_CELL cell would break the registration-margin
  // completeness argument, so clamp.
  const size = cellSize === undefined ? undefined : Math.max(cellSize, GRID_CELL);
  byOz.set(oz, { ox, oz, colliders, cells: buildColliderCellIndex(colliders, size) });
}

export function clearRiftRegion(token: number, ox: number, oz: number): void {
  const byOz = RIFT_REGIONS.get(token);
  if (!byOz) return;
  // oz is the key (every origin shares RIFT_X_MIN as its ox); the ox guard
  // keeps a mismatched clear from deleting someone else's region if that
  // invariant ever breaks. Drop the emptied inner map so throwaway Sims
  // (character creation constructs one per call) leave nothing behind.
  if (byOz.get(oz)?.ox === ox) byOz.delete(oz);
  if (byOz.size === 0) RIFT_REGIONS.delete(token);
}

function riftRegionAt(token: number, x: number, z: number): RiftRegion | null {
  const byOz = RIFT_REGIONS.get(token);
  if (!byOz) return null;
  // The nearest floor origin is the only region that can contain (x, z):
  // regions are 320 deep on 340 spacing, so they never overlap. MUST be the
  // true nearest-origin derivation (riftNearestFloorOriginZ, allocation-free,
  // once per movement resolve and per 0.5 yd sight sample), never
  // riftOriginAt: see the map comment above.
  const region = byOz.get(riftNearestFloorOriginZ(z));
  if (!region) return null;
  if (Math.abs(x - region.ox) > RIFT_REGION_HALF_X || Math.abs(z - region.oz) > RIFT_REGION_HALF_Z)
    return null;
  return region;
}

function instanceLocal(
  x: number,
  z: number,
): {
  ox: number;
  oz: number;
  interior: string;
  dungeonId: string | null;
} {
  const inst = dungeonInstanceAt(x, z);
  if (inst) {
    return { ox: inst.ox, oz: inst.oz, interior: inst.interior, dungeonId: inst.dungeonId };
  }
  // Past the threshold but outside every dungeon band (legacy fallback):
  // resolve against index 0's slots as a plain crypt, as before.
  let best = 0,
    bestD = Infinity;
  for (let i = 0; i < INSTANCE_SLOT_COUNT; i++) {
    const o = instanceOrigin(0, i);
    const d = Math.abs(z - o.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const o = instanceOrigin(0, best);
  return { ox: o.x, oz: o.z, interior: 'crypt', dungeonId: null };
}

// Resolve a movement destination against all static geometry. Movers slide
// along obstacles. `r` is the body radius. `mover` (feet height + mantle
// lift) lets a jumping/standing body pass over low prop tops; omitted, every
// collider blocks at any height (mobs, pathfinding, legacy callers).
export function resolvePosition(
  seed: number,
  x: number,
  z: number,
  r = 0.5,
  ignoreFences = false,
  delveModules?: readonly string[],
  mover?: MoverHeight,
  riftToken = 0,
): { x: number; z: number } {
  // The battleground band deliberately has NO branch here: its colliders live
  // in the spatial grid at absolute coordinates and its ground is real terrain
  // (groundHeight's band arm), so the grid fall-through below serves it with
  // the full mover contract (pass-over, standable decks) like the open world.
  if (isYumiMazePos(x)) {
    const o = yumiMazeOriginAt(z);
    const local = resolveAgainst(yumiMazeColliders(), x - o.x, z - o.z, r);
    return { x: local.x + o.x, z: local.z + o.z };
  }
  if (isDelvePos(x)) {
    const delve = delveAt(x);
    const mods = delveModules?.length ? delveModules : delve ? defaultDelveModules(delve.id) : [];
    const loc = delveModuleLocal(x, z, mods);
    const colliders = delveModuleColliders(loc.moduleId as DelveModuleId);
    const local = resolveAgainst(colliders, loc.localX, loc.localZ, r);
    return { x: local.x + loc.ox, z: local.z + loc.oz };
  }
  if (isArenaPos(x)) {
    const o = arenaOriginAt(z);
    const local = resolveAgainst(arenaCollidersForSlot(o.slot), x - o.x, z - o.z, r, ignoreFences);
    return { x: local.x + o.x, z: local.z + o.z };
  }
  if (isRiftPos(x)) {
    const region = riftRegionAt(riftToken, x, z);
    if (!region) return { x, z };
    const lx = x - region.ox;
    const lz = z - region.oz;
    // Single-cell read by the ORIGINAL point, the same contract as the
    // open-world arm below: complete for r <= MAX_BODY_RADIUS via the
    // registration margin (collider_cells.ts). A wider body (the boulder
    // push resolves at r = 1.0) falls back to the full floor list, which is
    // exactly the pre-index scan: rare, per-interaction, and byte-identical.
    const list = r <= MAX_BODY_RADIUS ? colliderCellAt(region.cells, lx, lz) : region.colliders;
    if (!list) return { x, z };
    const local = resolveAgainst(list, lx, lz, r, ignoreFences);
    return { x: local.x + region.ox, z: local.z + region.oz };
  }
  if (x > DUNGEON_X_THRESHOLD && !isBgPos(x)) {
    const { ox, oz, interior, dungeonId } = instanceLocal(x, z);
    const colliders = interiorCollidersFor(dungeonId, interior);
    // `mover` rides through so a jumping body passes over (and lands on) the
    // standable furniture tops, exactly as it does in the open world.
    const local = resolveAgainst(colliders, x - ox, z - oz, r, ignoreFences, mover);
    return { x: local.x + ox, z: local.z + oz };
  }
  const grid = gridFor(seed);
  const list = collidersInCell(grid, seed, Math.floor(x / GRID_CELL), Math.floor(z / GRID_CELL));
  if (list.length === 0) return { x, z };
  return resolveAgainst(list, x, z, r, ignoreFences, mover);
}

/**
 * Highest STANDABLE prop top under the body at (x,z) that sits at or below
 * `maxY`: the walking/landing surface the movement kernel maxes against the
 * terrain. Grounded movers pass their feet height (exact: a taller prop beside
 * you never levitates you); airborne movers add MANTLE_REACH so a jump at a
 * rim seats on top. Open-world grid only: instanced interiors have no props.
 * Returns -Infinity when nothing supports.
 */
/**
 * Is (x) inside an instanced region (dungeon interior, delve, arena, Yumi
 * maze) rather than the open world? Those regions are flat-floored rooms of
 * full-height walls resolved in region-local coordinates, so the open-world
 * physics broadphase does not apply to them.
 */
export function isInstancedRegion(x: number): boolean {
  // The battleground band is EXCLUDED although it sits past the dungeon
  // threshold: the Thornhollow field has sculpted terrain and standable decks,
  // so its movement runs the open-world character physics solver over the
  // grid, not the flat instanced kernel.
  return (
    isYumiMazePos(x) || isDelvePos(x) || isArenaPos(x) || (x > DUNGEON_X_THRESHOLD && !isBgPos(x))
  );
}

/**
 * Broadphase for the character physics solver: append every open-world
 * collider whose grid cell overlaps the given AABB into `out` (caller-owned,
 * so the hot path does not allocate a list per call). A collider spanning
 * several cells is appended ONCE: the membership check keeps the solver from
 * testing, and depenetrating against, the same surface twice. Returns `out`.
 * Empty inside instanced regions, which never route here.
 */
export function queryOpenWorldColliders(
  seed: number,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  out: Collider[],
): Collider[] {
  if (isInstancedRegion(minX) || isInstancedRegion(maxX)) return out;
  const grid = gridFor(seed);
  const gx0 = Math.floor(minX / GRID_CELL);
  const gx1 = Math.floor(maxX / GRID_CELL);
  const gz0 = Math.floor(minZ / GRID_CELL);
  const gz1 = Math.floor(maxZ / GRID_CELL);
  // Single-cell queries are the overwhelmingly common case (a 16 yd cell
  // versus a sub-yard step) and need no dedupe at all.
  if (gx0 === gx1 && gz0 === gz1) {
    const only = collidersInCell(grid, seed, gx0, gz0);
    for (let i = 0; i < only.length; i++) out.push(only[i]);
    return out;
  }
  // Multi-cell: stamp each collider as it is taken. Allocation-free and O(1)
  // per collider, where a rescan of `out` (or a Set) costs more the denser the
  // ground gets, which is exactly where the budget is tightest.
  if (grid.gen >= 0xffffffff) {
    grid.stamps.fill(0);
    grid.gen = 0;
  }
  const gen = ++grid.gen;
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gz = gz0; gz <= gz1; gz++) {
      // Through collidersInCell, not grid.cells: the decoration field is
      // materialized per cell on demand and every body it yields carries a
      // gridIndex from the same counter, so the stamp dedupe below covers
      // authored props and decorations alike. It can GROW grid.stamps, so
      // the buffer is re-read (never hoisted) after the call.
      const list = collidersInCell(grid, seed, gx, gz);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const gi = c.gridIndex as number;
        if (grid.stamps[gi] === gen) continue;
        grid.stamps[gi] = gen;
        out.push(c);
      }
    }
  }
  return out;
}

/**
 * Highest STANDABLE prop top under the body at (x, z) that sits at or below
 * `maxY`: the walking and landing surface the movement kernel maxes against
 * the terrain (see `physics/character.ts` `floorHeightAt`). Grounded movers
 * pass their exact feet height; airborne movers add the mantle reach.
 * Open-world grid only; returns -Infinity when nothing supports.
 */
export function supportHeightAt(
  seed: number,
  x: number,
  z: number,
  r: number,
  maxY: number,
): number {
  // Region order matters: every instanced band sits past the dungeon
  // threshold, so the specific bands must be ruled out FIRST (the same
  // routing resolvePosition uses).
  if (isYumiMazePos(x) || isDelvePos(x) || isArenaPos(x)) return -Infinity;
  if (x > DUNGEON_X_THRESHOLD && !isBgPos(x)) {
    // Dungeon interiors: the furniture tops (coffin lids, cargo stacks) are
    // standable surfaces exactly like the open world's crates and canopies.
    // (The battleground band falls through to the grid read below: its
    // rampart and stair decks are ordinary standable colliders there.)
    const { ox, oz, interior, dungeonId } = instanceLocal(x, z);
    return bestStandableTop(interiorCollidersFor(dungeonId, interior), x - ox, z - oz, r, maxY);
  }
  const grid = gridFor(seed);
  // A single-cell read is complete BY CONSTRUCTION: gridFor registers every
  // collider into all cells its bounds inflated by MAX_BODY_RADIUS (0.8)
  // touch, and support can only reach r * SUPPORT_OVERLAP (at most 0.4)
  // beyond a collider's footprint, so any collider able to support a body in
  // this cell is registered here. tests/physics_audit_world.test.ts pins both
  // the margin arithmetic and a boundary-straddling case.
  const list = collidersInCell(grid, seed, Math.floor(x / GRID_CELL), Math.floor(z / GRID_CELL));
  if (list.length === 0) return -Infinity;
  return bestStandableTop(list, x, z, r, maxY);
}

/** How far above the terrain an authored deck still counts as the FLOOR for
 *  object placement. Covers the battleground's flag podiums and stair landings
 *  (2.5yd) while leaving the ramparts (5.7yd) obstacles overhead, so a body
 *  seated under one lands beneath it rather than on top of it. */
export const DECK_FLOOR_REACH = 3;

/**
 * The surface an OBJECT placed at (x, z) rests on: the terrain, or an authored
 * walkable deck close above it. The Thornhollow battleground field is the one
 * region whose FLOOR is partly authored (flag podiums, stair landings), so a
 * flag, rune or teleported body seated there must land on the deck instead of
 * sinking to the terrain beneath it.
 *
 * Deliberately NOT used by the movement kernel: that keeps terrain height and
 * standable prop tops separate (`supportHeightAt`) so walking UNDER a deck
 * never lifts the body onto it.
 */
export function placementFloorHeight(seed: number, x: number, z: number): number {
  const ground = groundHeight(x, z, seed);
  if (!isBgPos(x)) return ground;
  return Math.max(ground, supportHeightAt(seed, x, z, 0.5, ground + DECK_FLOOR_REACH));
}

/**
 * Slope glue: the standable surface the body is STANDING ON (its sampled top
 * at the previous position within a small tolerance of the feet) sampled at
 * the NEW position. This is what lets a grounded body walk UP a pitched roof
 * without the strict support query (capped at the feet, the anti-levitation
 * rule) flickering it airborne every other tick. Only surfaces underfoot at
 * the start qualify, so a taller prop BESIDE the body still never lifts it.
 * Returns -Infinity when the body was not standing on any prop top.
 */
export function slopeGlueHeight(
  seed: number,
  fromX: number,
  fromZ: number,
  x: number,
  z: number,
  r: number,
  feetY: number,
): number {
  let list: Collider[] | undefined;
  let ox = 0;
  let oz = 0;
  if (isYumiMazePos(x) || isDelvePos(x) || isArenaPos(x)) return -Infinity;
  if (x > DUNGEON_X_THRESHOLD && !isBgPos(x)) {
    const inst = instanceLocal(x, z);
    list = interiorCollidersFor(inst.dungeonId, inst.interior);
    ox = inst.ox;
    oz = inst.oz;
  } else {
    const grid = gridFor(seed);
    // The FROM cell is complete for the same registration-margin reason as
    // supportHeightAt: the glued surface holds the feet at `fromX/fromZ`, so
    // its bounds sit within the body's reach there, and one tick's stride
    // plus the support reach stays inside MAX_BODY_RADIUS.
    list = collidersInCell(
      grid,
      seed,
      Math.floor(fromX / GRID_CELL),
      Math.floor(fromZ / GRID_CELL),
    );
  }
  if (!list) return -Infinity;
  // Full body radius, deliberately wider than strict support's overlap gate:
  // this query only ever follows the surface ALREADY underfoot, so holding
  // the body on it while ANY of its disc still covers the top is the honest
  // walk-to-the-edge. It is also what keeps the eventual step-down clean: the
  // drop fires only once the disc fully clears the face, so the landing can
  // never start embedded, and depenetration can never convert the overlap
  // into free forward distance (the kerb-crossing speed exploit).
  const reachR = r;
  let best = -Infinity;
  for (const c of list) {
    if (!c.standable || c.moveTopY === undefined) continue;
    const startTop = colliderTopAt(c, fromX - ox, fromZ - oz);
    if (Math.abs(startTop - feetY) > 0.05) continue; // not the surface underfoot
    const lx = x - ox;
    const lz = z - oz;
    if (c.type === 'circle') {
      const dx = lx - c.x,
        dz = lz - c.z;
      const reach = c.r + reachR;
      if (dx * dx + dz * dz >= reach * reach) continue;
    } else if (c.type === 'prism') {
      if (!insidePrism(c, lx, lz)) continue;
    } else {
      const local = rotY(lx - c.x, lz - c.z, -c.rot);
      if (Math.abs(local.x) >= c.hw + reachR || Math.abs(local.z) >= c.hd + reachR) continue;
    }
    best = Math.max(best, colliderTopAt(c, lx, lz));
  }
  return best;
}

/**
 * The interior collider set and instance frame at a dungeon-interior world
 * point, for queries that scan colliders directly (the ledge grab's fit and
 * headroom checks). Null everywhere else, including the delve/arena/yumi
 * bands, which keep their own contracts.
 */
export function interiorColliderFrame(
  x: number,
  z: number,
): { list: Collider[]; ox: number; oz: number } | null {
  if (x <= DUNGEON_X_THRESHOLD) return null;
  if (isYumiMazePos(x) || isDelvePos(x) || isArenaPos(x) || isBgPos(x)) return null;
  const { ox, oz, interior, dungeonId } = instanceLocal(x, z);
  return { list: interiorCollidersFor(dungeonId, interior), ox, oz };
}

/** The highest standable `moveTopY` at or below `maxY` under (x, z) in a
 *  collider list (coordinates in the list's own frame). */
function bestStandableTop(list: Collider[], x: number, z: number, r: number, maxY: number): number {
  let best = -Infinity;
  const reachR = r * SUPPORT_OVERLAP;
  for (const c of list) {
    if (!c.standable || c.moveTopY === undefined) continue;
    // The SAMPLED surface (a pitched roof supports at its local height, not
    // its ridge) both gates against maxY and becomes the support height.
    if (c.type === 'circle') {
      const dx = x - c.x,
        dz = z - c.z;
      const reach = c.r + reachR;
      if (dx * dx + dz * dz >= reach * reach) continue;
    } else if (c.type === 'prism') {
      // Standing on an authored volume is a containment question: use the real
      // outline, not a rectangle fitted around it.
      if (!insidePrism(c, x, z)) continue;
    } else {
      const local = rotY(x - c.x, z - c.z, -c.rot);
      if (Math.abs(local.x) >= c.hw + reachR || Math.abs(local.z) >= c.hd + reachR) continue;
    }
    const top = colliderTopAt(c, x, z);
    if (top > maxY + MOVE_TOP_EPS || top <= best) continue;
    best = top;
  }
  return best;
}

/**
 * Grounded seat for an INSTANT relocation end point (heroic leap landing,
 * knockback end): the height-gated sweep that produced (x,z) may have passed
 * over low props, so a plain terrain re-seat could embed the body inside one.
 * Stand on a standable top under the point when the mover's previous feet
 * reached it; otherwise nudge full-height out of any overlapped collider and
 * seat on the terrain there. A clear point is returned unchanged.
 */
export function seatGroundedAt(
  seed: number,
  x: number,
  z: number,
  r: number,
  prevFeetY: number,
): { x: number; z: number; y: number } {
  const ground = groundHeight(x, z, seed);
  // Instanced regions have no prop tops and their own bounds/door clamps
  // (applied by the caller's sweep): plain terrain seat there, untouched.
  // The battleground band is NOT one of them: its decks are grid props.
  if (isInstancedRegion(x)) {
    return { x, z, y: ground };
  }
  const support = supportHeightAt(seed, x, z, r, prevFeetY + MOVE_TOP_EPS);
  if (support > ground) return { x, z, y: support };
  const res = resolvePosition(seed, x, z, r);
  return { x: res.x, z: res.z, y: groundHeight(res.x, res.z, seed) };
}

function crossesFence(fromX: number, fromZ: number, toX: number, toZ: number, r: number): boolean {
  // endPad extends the crossing test past each end of the segment. An authored
  // fence overrides it with its own width so a wide rail is not walked around
  // at its posts; the race gates keep the default.
  const crossesSegment = (
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    endPad = FENCE_END_PAD,
  ): boolean => {
    const dx = x2 - x1,
      dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return false;
    const ux = dx / len,
      uz = dz / len;
    const nx = -uz,
      nz = ux;
    const fromRelX = fromX - x1,
      fromRelZ = fromZ - z1;
    const toRelX = toX - x1,
      toRelZ = toZ - z1;
    const fromSide = fromRelX * nx + fromRelZ * nz;
    const toSide = toRelX * nx + toRelZ * nz;
    if (fromSide === 0 && toSide === 0) return false;
    if (fromSide * toSide > 0) return false;
    const denom = fromSide - toSide;
    const t = Math.abs(denom) < 1e-6 ? 0 : fromSide / denom;
    if (t < 0 || t > 1) return false;
    const hitX = fromX + (toX - fromX) * t;
    const hitZ = fromZ + (toZ - fromZ) * t;
    const along = (hitX - x1) * ux + (hitZ - z1) * uz;
    return along >= -endPad - r && along <= len + endPad + r;
  };

  const props = getActiveWorldContent().props;
  for (const f of props.fences) {
    if (crossesSegment(f.x1, f.z1, f.x2, f.z2, f.width === undefined ? undefined : f.width / 2)) {
      return true;
    }
  }
  // Click-to-move uses this same query to auto-jump a rail. Include the race
  // fixtures so its route behaves like keyboard movement instead of walking
  // into the new collider and stalling.
  for (const jump of props.raceCourse?.jumps ?? []) {
    const halfWidth = MOUNT_RACE_JUMP_FIXTURES[jump.kind].width / 2;
    const segment = raceGateSegment(jump, halfWidth);
    if (crossesSegment(segment.ax, segment.az, segment.bx, segment.bz)) return true;
  }
  return false;
}

export function resolveMovement(
  seed: number,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  r = 0.5,
  ignoreFences = false,
  delveModules?: readonly string[],
  mover?: MoverHeight,
  riftToken = 0,
): { x: number; z: number } {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6)
    return resolvePosition(seed, toX, toZ, r, ignoreFences, delveModules, mover, riftToken);
  const steps = Math.max(1, Math.ceil(d / 0.2));
  let x = fromX,
    z = fromZ;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const nextX = fromX + dx * t;
    // A sealed zone border is a hard wall regardless of terrain slope (the
    // climb gate projects rise along the movement direction, so a shallow
    // diagonal would otherwise sneak over the crest). Clamp z at the crest
    // and keep the x component, so pushing into the wall slides along it.
    const nextZ = crossesSealedBorder(x, z, fromZ + dz * t) ? z : fromZ + dz * t;
    // The Great Maze's hedges used to be tested here as a segment crossing.
    // They are real collider boxes now (staticWorldColliders), which the slide
    // below handles like any other wall, and keeping the segment test as well
    // would be actively harmful: a body that ends up INSIDE a hedge is pushed
    // out by resolvePosition, and a segment test from where it was to where it
    // was pushed crosses hedge by definition, so the escape would be cancelled
    // and the body held there.
    if (!ignoreFences && crossesFence(x, z, nextX, nextZ, r)) break;
    const resolved = resolvePosition(
      seed,
      nextX,
      nextZ,
      r,
      ignoreFences,
      delveModules,
      mover,
      riftToken,
    );
    // ...and a static-collider slide (a tree hugging the crest) must not
    // shove the resolved position across it either
    if (crossesSealedBorder(x, z, resolved.z)) break;
    // Rift interiors: a resolution is a SLIDE, never a teleport. When a wide
    // obstacle abuts a thin wall (a chamber-waist stub reaching the side wall),
    // chained pushOuts can walk the centre across the wall centreline and eject
    // the mover OUTSIDE the room; any step that resolves further than a
    // slide-scale distance from its target is that ejection, so treat it as a
    // hard block (keep the last good position) instead of accepting it. Scoped
    // to the rift band so no pre-existing space changes behavior.
    if (
      riftToken !== 0 &&
      isRiftPos(nextX) &&
      Math.hypot(resolved.x - nextX, resolved.z - nextZ) > 1.2
    ) {
      break;
    }
    x = resolved.x;
    z = resolved.z;
    if (Math.hypot(x - nextX, z - nextZ) > r * 0.25) {
      const remainingX = toX - nextX;
      const remainingZ = toZ - nextZ;
      const correctionX = x - nextX;
      const correctionZ = z - nextZ;
      if (remainingX * correctionX + remainingZ * correctionZ < 0) break;
    }
  }
  return { x, z };
}

export function isBlocked(
  seed: number,
  x: number,
  z: number,
  r = 0.5,
  ignoreFences = false,
  delveModules?: readonly string[],
  riftToken = 0,
  // Optional mover height, forwarded to the same pass-over / pass-under gates
  // resolvePosition already applies: without it every query is treated as a
  // ground-level body, so a banded collider (a felled column, an authored
  // second storey) reads as a full-height wall to anything asking.
  mover?: MoverHeight,
): boolean {
  const res = resolvePosition(seed, x, z, r, ignoreFences, delveModules, mover, riftToken);
  return Math.abs(res.x - x) > 1e-4 || Math.abs(res.z - z) > 1e-4;
}

// Would a straight move from (fromX,fromZ) to (toX,toZ) cross a fence line?
// Used by click-to-move to fire a jump just before reaching a fence it has
// routed through, since the player can hop over fences but not walk through.
export function pathCrossesFence(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  r = 0.5,
): boolean {
  return crossesFence(fromX, fromZ, toX, toZ, r);
}

// Eye height (yards above the ground) for the spell line-of-sight ray. An
// open-world obstacle whose precomputed visual top (`cameraTopY`) sits at or
// below the sight line no longer blocks a cast: a campfire (top 1.45), a crate
// (1.35), or a small rock is something you
// see and cast OVER, while buildings, trees, tents, and fences still block.
// Colliders without a known top (the interior wall layouts) always block, the
// conservative default, and MOVEMENT collision is untouched everywhere.
export const SIGHT_HEIGHT = 1.6;

interface SightFeetOverride {
  from?: number;
  to?: number;
}

// Does any collider at (x,z) rise above `sightY` (absolute world Y of the
// sight line at that sample)? Mirrors resolvePosition's zone routing so
// interiors, delves and the arena keep their wall sets, but tests pure overlap
// (no push-out) and applies the low-obstacle skip only where tops are known.
function sightBlockedAt(
  seed: number,
  x: number,
  z: number,
  r: number,
  sightY: number,
  riftToken = 0,
): boolean {
  const overlapsAny = (list: Collider[], lx: number, lz: number, skipLow: boolean): boolean => {
    for (const c of list) {
      if (skipLow && c.cameraTopY !== undefined && c.cameraTopY <= sightY) continue;
      // Above the eye line the obstacle is not in the way either: an authored
      // upper storey does not block line of sight along the floor below it.
      if (c.baseY !== undefined && c.baseY > sightY) continue;
      if (pushOut(c, lx, lz, r) !== null) return true;
    }
    return false;
  };
  if (isBgPos(x)) {
    // The field's terrain is honest cover: the ravine slopes, the keep mounds
    // and the pit rim block casts wherever the ground itself crosses the eye
    // line (the band arm of groundHeight serves the sculpted heightfield).
    if (groundHeight(x, z, seed) > sightY) return true;
    // Colliders live in the grid at absolute coordinates with known tops, so
    // the low-obstacle skip applies exactly like the open world's.
    //
    // R-BOUND ASSUMPTION, mirror it if you widen the sample. This reads the ONE
    // cell holding the sample point, not the cell RANGE the point's radius
    // spans. That is exact only while `r` stays within the padding gridFor()
    // indexes with (`MAX_BODY_RADIUS`, 0.8 yd): a collider is filed into every
    // cell its bounds plus that padding touch, so anything whose surface is
    // within 0.8 yd of the sample is already in this list. The live callers
    // reach here through lineOfSightClear's default `r = 0.05`, an order of
    // magnitude inside the pad. A caller passing r > MAX_BODY_RADIUS would
    // start MISSING colliders parked in a neighbouring cell (permissive: sight
    // reported clear through a surface), and must read the range instead, the
    // way queryOpenWorldColliders does over its stamp dedupe.
    const grid = gridFor(seed);
    const list = grid.cells.get(cellKeyAt(x, z));
    return list ? overlapsAny(list, x, z, true) : false;
  }
  if (isYumiMazePos(x)) {
    const o = yumiMazeOriginAt(z);
    return overlapsAny(yumiMazeColliders(), x - o.x, z - o.z, false);
  }
  if (isDelvePos(x)) {
    const delve = delveAt(x);
    const mods = delve ? defaultDelveModules(delve.id) : [];
    const loc = delveModuleLocal(x, z, mods);
    return overlapsAny(
      delveModuleColliders(loc.moduleId as DelveModuleId),
      loc.localX,
      loc.localZ,
      false,
    );
  }
  if (isArenaPos(x)) {
    const o = arenaOriginAt(z);
    return overlapsAny(arenaCollidersForSlot(o.slot), x - o.x, z - o.z, false);
  }
  if (isRiftPos(x)) {
    const region = riftRegionAt(riftToken, x, z);
    if (!region) return false;
    // Cell read per 0.5 yd sight sample: r is lineOfSightClear's 0.05, an
    // order of magnitude inside the MAX_BODY_RADIUS registration pad, so the
    // single cell is complete (the battleground arm above documents the same
    // R-BOUND ASSUMPTION).
    const list = colliderCellAt(region.cells, x - region.ox, z - region.oz);
    return list ? overlapsAny(list, x - region.ox, z - region.oz, false) : false;
  }
  if (x > DUNGEON_X_THRESHOLD) {
    const { ox, oz, interior, dungeonId } = instanceLocal(x, z);
    return overlapsAny(interiorCollidersFor(dungeonId, interior), x - ox, z - oz, false);
  }
  const grid = gridFor(seed);
  const list = collidersInCell(grid, seed, Math.floor(x / GRID_CELL), Math.floor(z / GRID_CELL));
  return list.length > 0 ? overlapsAny(list, x, z, true) : false;
}

export function lineOfSightClear(
  seed: number,
  from: { x: number; y?: number; z: number },
  to: { x: number; y?: number; z: number },
  r = 0.05,
  delveModules?: readonly string[],
  riftToken = 0,
  sightFeet?: SightFeetOverride,
): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return true;
  // The sight line runs eye-to-eye: lerp the endpoint eye heights per sample so
  // a low prop only blocks when its top actually crosses the line.
  //
  // The battleground keeps caller y because its sculpted terrain, standable
  // decks, and cover were authored against real fighter height. Raw caller y
  // remains untrusted everywhere else: entity-aware open-world callers may
  // opt in only after constraining feet height to terrain or authored support,
  // so a jump cannot lift the sight line above intended cover.
  const eyeAt = (p: { x: number; y?: number; z: number }, trustedY?: number): number =>
    (trustedY ??
      (isBgPos(p.x) ? (p.y ?? groundHeight(p.x, p.z, seed)) : groundHeight(p.x, p.z, seed))) +
    SIGHT_HEIGHT;
  const eyeFrom = eyeAt(from, sightFeet?.from);
  const eyeTo = eyeAt(to, sightFeet?.to);
  const steps = Math.max(2, Math.ceil(d / 0.5));
  if (isDelvePos(from.x)) {
    const delve = delveAt(from.x);
    const mods = delveModules?.length ? delveModules : delve ? defaultDelveModules(delve.id) : [];
    const loc = delveModuleLocal(from.x, from.z, mods);
    const moduleId = loc.moduleId as DelveModuleId;
    const los = isLitanyModuleId(moduleId)
      ? litanyModuleLosColliders(moduleId)
      : delveModuleColliders(moduleId);
    const toLocal = { x: to.x - loc.ox, z: to.z - loc.oz };
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = loc.localX + (toLocal.x - loc.localX) * t;
      const z = loc.localZ + (toLocal.z - loc.localZ) * t;
      const resolved = resolveAgainst(los, x, z, r);
      if (Math.abs(resolved.x - x) > 1e-4 || Math.abs(resolved.z - z) > 1e-4) return false;
    }
    return true;
  }
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = from.x + dx * t;
    const z = from.z + dz * t;
    if (sightBlockedAt(seed, x, z, r, eyeFrom + (eyeTo - eyeFrom) * t, riftToken)) return false;
  }
  return true;
}
