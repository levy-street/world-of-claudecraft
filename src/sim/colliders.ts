import {
  BANKER_CHEST_HALF_DEPTH,
  BANKER_CHEST_HALF_WIDTH,
  BANKER_CHEST_TARGET_HEIGHT,
  type BankerChestBlockedAt,
  type BankerChestLocalPlacement,
  bankerChestCenterWorld,
  resolveSolidBankerChestPlacement,
} from './banker_chest_layout';
import {
  buildingCameraHeight,
  buildingTerrainEnvelope,
  isEastbrookGrandArmoury,
} from './building_layout';
import { MOUNT_RACE_JUMP_FIXTURES, raceGateSegment } from './content/mounts';
import { STATIONS } from './content/professions';
import {
  arenaOriginAt,
  DUNGEON_FLOOR_Y,
  DUNGEON_LIST,
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
  isDelvePos,
  isRiftPos,
  isYumiMazePos,
  NPCS,
  OVERWORLD_GRAVEYARDS,
  PORTALS,
  RIFT_REGION_HALF_X,
  RIFT_REGION_HALF_Z,
  yumiMazeOriginAt,
} from './data';
import {
  ROCK_COLLIDER_MIN_SCALE,
  ROCK_RADIUS_PER_SCALE,
  rockHeight,
  rockRadius,
} from './decoration_dims';
import { type DelveModuleId, delveModuleColliders } from './delve_layout';
import { isLitanyModuleId, litanyModuleLosColliders } from './delve_litany_layout';
import { dungeonInstanceAt, INTERIOR_LAYOUTS } from './dungeon_floor';
import {
  ARENA_LAYOUT,
  CRYPT_LAYOUT,
  DROWNED_COURT_LAYOUT,
  LASTKEEP_LAYOUT,
  layoutColliders,
} from './dungeon_layout';
import { emberLilySpots } from './ember_lilies';
import { fenWillowSpots, hollowWillowSpots } from './fen_willows';
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
  DOOR_ARCH_HEIGHT,
  DOOR_ARCH_JAMB_HD,
  DOOR_ARCH_JAMB_HW,
  DOOR_ARCH_JAMB_X,
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
import { townPropPlacements } from './town_props';
import type { WorldContent } from './types';
import { valeCupColliders } from './vale_cup_layout';
import { WILDHEART_FIELD_COLLIDER_SPECS, WILDHEART_FIELD_WALLS } from './wildheart_field';
import {
  crossesGardenHedge,
  crossesSealedBorder,
  type Decoration,
  farshorePalmSpots,
  generateDecorationsInBounds,
  groundHeight,
  reachPalmSpots,
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
  /** Engine bookkeeping: index into the owning grid's dedupe stamp buffer. */
  gridIndex?: number;
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
  /** See {@link CircleCollider.moveTopY}. */
  moveTopY?: number;
  /** See {@link CircleCollider.standable}. */
  standable?: boolean;
  /** See {@link CircleCollider.topSlope}. */
  topSlope?: TopSlope;
  /**
   * Low fence rail: a grounded mover collides normally, but a mover that is
   * airborne above the rail (see `FENCE_RAIL_HEIGHT`) jumps clear of it. Set on
   * the OBBs built from `PROPS.fences`.
   */
  isFence?: boolean;
  /** See {@link CircleCollider.gridIndex}. */
  gridIndex?: number;
}

export type Collider = CircleCollider | ObbCollider;

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
  if (s.kind === 'cone' || c.type === 'circle') {
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
const MOVE_TOP_EPS = 1e-3;
// How much of the body radius must overlap a standable top before it supports
// the mover: standing needs the center meaningfully over the prop, while the
// full collision radius still gates entry, so a jump can graze past a rim
// without being captured by it.
export const SUPPORT_OVERLAP = 0.5;
// Physical movement tops (yards above the prop's ground). The visual/sight
// tops above stay untouched: cameraTopY for a campfire includes the flame,
// but the SOLID obstacle is only the log pile, which is what a jump clears.
// Exported so tests pin against the one authoritative value.
export const CRATE_TOP = 1.35;
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

// Does the mover pass clean over this collider at (x, z)? Full-height
// colliders (moveTopY undefined) never pass; standable tops grant the mantle
// lift. Sloped tops are sampled at the mover's own point, so the eaves of a
// roof pass a body the ridge would still wall.
function passesOver(c: Collider, mover: MoverHeight | undefined, x: number, z: number): boolean {
  if (!mover || c.moveTopY === undefined) return false;
  return colliderTopAt(c, x, z) <= mover.y + (c.standable ? mover.lift : 0) + MOVE_TOP_EPS;
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
// being an authored NPC record.
function townNpcPositions(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (const npc of Object.values(NPCS)) {
    const pos = (npc as { pos?: { x: number; z: number } }).pos;
    if (pos) out.push({ x: pos.x, z: pos.z });
  }
  for (const g of OVERWORLD_GRAVEYARDS) out.push({ x: g.x, z: g.z });
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
  for (const b of PROPS.buildings) {
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
    });
  }
  for (const w of PROPS.wells)
    out.push({
      type: 'circle',
      x: w.x,
      z: w.z,
      r: w.r,
      cameraTopY: topY(seed, w.x, w.z, w.height ?? 3.7),
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
  for (const portal of PORTALS) {
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
  // models from (sim/fen_willows.ts).
  for (const w of fenWillowSpots(seed))
    out.push({
      type: 'circle',
      x: w.x,
      z: w.z,
      r: w.r,
      cameraTopY: topY(seed, w.x, w.z, 6),
    });
  // ...and the Veiled Hollow's willows, same one-list contract
  for (const w of hollowWillowSpots(seed))
    out.push({
      type: 'circle',
      x: w.x,
      z: w.z,
      r: w.r,
      cameraTopY: topY(seed, w.x, w.z, 6),
    });
  // ...and the Drakelands' giant ember lilies: the huge and giant tiers
  // carry a rocky-bed collider (r 0 skirt lilies stay walk-through
  // dressing), same one-list contract as the willows
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
  // from (world.ts).
  for (const p of reachPalmSpots(seed))
    out.push({
      type: 'circle',
      x: p.x,
      z: p.z,
      r: p.r,
      cameraTopY: topY(seed, p.x, p.z, 7),
    });
  // ...and the Farshore strand's palms, the same one-list contract
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
      moveTopY: top,
      standable: true,
    });
  }
  // Town wall segments: the drawn wing is a stone PARAPET with an open iron
  // railing above it, not a solid curtain, so the slab is a standable top a
  // jump vaults onto or clean over (the railing is see-through iron: the
  // fence rule). The wing's two pillars ride each segment: the short capped
  // one is a standable step above the parapet, and only the tall lantern
  // pylon (gate-side on `mirrored` wings) blocks full-height. Mob pathing is
  // untouched: grounded movers without a jump still treat the slab as a wall.
  for (const wall of PROPS.walls ?? []) {
    const parapet = topY(seed, wall.x, wall.z, wall.height * TOWN_WALL_PARAPET_FRAC);
    out.push({
      type: 'obb',
      x: wall.x,
      z: wall.z,
      hw: wall.w / 2,
      hd: wall.d / 2,
      rot: wall.rot,
      cameraTopY: topY(seed, wall.x, wall.z, wall.height),
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
    });
  }

  // hand-placed GLB decor: circle collider matched to the model footprint;
  // r 0/absent entries are walk-through dressing and add no collider
  for (const d of PROPS.decorProps ?? []) {
    if (!d.r) continue;
    out.push({
      type: 'circle',
      x: d.x,
      z: d.z,
      r: d.r,
      cameraTopY: topY(seed, d.x, d.z, d.h ?? 4),
    });
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

  // Overworld dungeon door arches: only the two stone JAMBS collide, because
  // walking into the mouth IS the enter trigger. The Abandoned Crypt's door
  // draws no arch (an invisible click box at the mine), and two dungeons can
  // share one doorway, so dedupe by position.
  const doorSpots = new Set<string>();
  for (const dungeon of DUNGEON_LIST) {
    if (dungeon.overworldDoor === false) continue;
    if (dungeon.id === 'nythraxis_crypt') continue;
    const key = `${dungeon.doorPos.x},${dungeon.doorPos.z}`;
    if (doorSpots.has(key)) continue;
    doorSpots.add(key);
    for (const sx of [-DOOR_ARCH_JAMB_X, DOOR_ARCH_JAMB_X]) {
      const x = dungeon.doorPos.x + sx;
      out.push({
        type: 'obb',
        x,
        z: dungeon.doorPos.z,
        hw: DOOR_ARCH_JAMB_HW,
        hd: DOOR_ARCH_JAMB_HD,
        rot: 0,
        cameraTopY: topY(seed, x, dungeon.doorPos.z, DOOR_ARCH_HEIGHT),
      });
    }
  }

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
    out.push({ type: 'circle', x, z, r, cameraTopY: topY(seed, x, z, r + 0.2) });
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
      const wl = waterLevelAt(bx, bz);
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
    });
  PROPS.crates.forEach(([x, z], i) => {
    // Camp clutter renders as a wooden crate OR (every third) a barrel, with
    // a per-point scale roll: the collider takes the SAME roll, so its
    // footprint and top match the exact mesh drawn at this point.
    const shape = campCrateShape(x, z, i);
    out.push({
      type: 'circle',
      x,
      z,
      r: shape.r,
      cameraTopY: topY(seed, x, z, shape.top),
      moveTopY: topY(seed, x, z, shape.top),
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
    });
  for (const [x, z] of PROPS.mudHuts)
    out.push({ type: 'circle', x, z, r: 1.1, cameraTopY: topY(seed, x, z, 12.5) });
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
  // an anvil you can see is an anvil you can climb on.
  for (const tp of townPropPlacements(
    STATIONS.map((st) => ({ type: st.type, x: st.pos.x, z: st.pos.z })),
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
  for (const p of content.placements ?? []) {
    if (!p.collideRadius || p.collideRadius <= 0) continue;
    out.push({
      type: 'circle',
      x: p.x,
      z: p.z,
      r: p.collideRadius,
      cameraTopY: topY(seed, p.x, p.z, Math.max(2.5, p.collideRadius * 2)),
    });
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

  // The Sowfield boards, goal posts, net pockets, stand fronts, and plinth
  // (Vale Cup). ONE layout module (vale_cup_layout.ts) drives this movement
  // set, the ball's analytic wall reflection, the terrain flatten, and the
  // render dressing, so they can never drift. Deliberately NOT fences: boards
  // must not be jump-through mid-match (the north gate is the way in). Applies
  // for any active content, matching the flatten arm (crater-precedent leak).
  out.push(...valeCupColliders());

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
  for (const npc of Object.values(NPCS)) {
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
// The Last Keep: an authored room-graph interior, so its walls (minus
// doorways) and decor footprints all derive from the one shared layout,
// exactly like the rift citadel floors (layoutColliders routes through
// authoredColliders). Seated on DUNGEON_FLOOR_Y like every derived interior
// set below, so its standable tops read in the same frame.
const LASTKEEP_COLLIDERS: Collider[] = layoutColliders(LASTKEEP_LAYOUT, undefined, DUNGEON_FLOOR_Y);

// Wildheart follows the same open-field contract, but its walkable bridges and
// water ribbons are heightfield surfaces rather than blocking props.
const WILDHEART_COLLIDERS: Collider[] = [
  ...WILDHEART_FIELD_WALLS.map(
    (wall): Collider => ({
      type: 'obb',
      x: wall.x,
      z: wall.z,
      hw: wall.hw,
      hd: wall.hd,
      rot: 0,
    }),
  ),
  ...WILDHEART_FIELD_COLLIDER_SPECS.map(
    (spec): Collider => ({
      type: 'circle',
      x: spec.x,
      z: spec.z,
      r: spec.r,
      cameraTopY: spec.h,
    }),
  ),
];

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
};

// Per-DUNGEON interior sets: dungeons sharing a room plan (Hollow Crypt and
// the Sunken Bastion are both 'crypt') dress their wall-side slots with
// different furniture, so the standable tops differ per dungeon even where
// the walls do not. Built lazily, cached by dungeon id.
const interiorSetByDungeon = new Map<string, Collider[]>();
function interiorCollidersFor(dungeonId: string | null, interior: string): Collider[] {
  const staticSet = STATIC_INTERIOR_COLLIDERS[interior];
  if (staticSet) return staticSet;
  const key = dungeonId ?? `interior:${interior}`;
  let set = interiorSetByDungeon.get(key);
  if (!set) {
    const layout = INTERIOR_LAYOUTS[interior] ?? CRYPT_LAYOUT;
    const dressing = dungeonId ? DUNGEONS[dungeonId]?.tombDressing : undefined;
    set = layoutColliders(layout, dressing, DUNGEON_FLOOR_Y);
    interiorSetByDungeon.set(key, set);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Spatial grid + movement resolution
// ---------------------------------------------------------------------------

const GRID_CELL = 16;
/** Largest mover we resolve for. Doubles as the grid's registration margin:
 *  every collider is inserted into all cells its bounds inflated by this
 *  touch, which is what makes the single-cell support and glue reads below
 *  complete (their reach beyond a collider's bounds never exceeds it). */
export const MAX_BODY_RADIUS = 0.8;
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

// Grid cells are keyed by a packed integer rather than a `gx,gz` template
// string. The key is built on every lookup in the movement and line-of-sight
// hot paths, and a string key allocated there was the single
// largest source of per-tick garbage in the physics solver (it dominated even
// on empty ground, where there is no collider work to do at all). The bias
// keeps negative cells positive; the span covers any world the editor can
// author (cell 16 yd, so +/- 32768 cells is +/- 524288 yd).
const CELL_KEY_BIAS = 32768;
const CELL_KEY_SPAN = 65536;
function cellKey(gx: number, gz: number): number {
  return (gx + CELL_KEY_BIAS) * CELL_KEY_SPAN + (gz + CELL_KEY_BIAS);
}

// Grids are cached per (active world content, seed). The WeakMap keeps the
// built-in world's grid warm forever and lets swapped-out custom maps be
// collected; the editor invalidates explicitly after mutating placements.
const gridCaches = new WeakMap<WorldContent, Map<number, ColliderGrid>>();

/** Drop the cached collider grid for the ACTIVE world content (editor-only:
 * call after mutating its placements/props in place). */
export function invalidateStaticColliders(): void {
  gridCaches.delete(getActiveWorldContent());
}

function colliderBounds(c: Collider): { minX: number; maxX: number; minZ: number; maxZ: number } {
  if (c.type === 'circle') {
    return { minX: c.x - c.r, maxX: c.x + c.r, minZ: c.z - c.r, maxZ: c.z + c.r };
  }
  const ext = Math.hypot(c.hw, c.hd);
  return { minX: c.x - ext, maxX: c.x + ext, minZ: c.z - ext, maxZ: c.z + ext };
}

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
  for (const c of built) {
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
  perContent.set(seed, grid);
  return grid;
}

// Decoration scale is `0.7 + hash * 0.9` (world.ts), and rocks have the
// largest collision multiplier (ROCK_RADIUS_PER_SCALE). This conservative
// bound selects every candidate whose circle could be assigned to a queried
// grid cell.
const MAX_DECORATION_COLLIDER_RADIUS = 1.6 * ROCK_RADIUS_PER_SCALE;

function decorationCollider(seed: number, d: Decoration): Collider | null {
  if (d.kind === 'rock') {
    if (d.scale < ROCK_COLLIDER_MIN_SCALE) return null;
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

/** Claim the next `gridIndex` for a lazily built decoration body, growing the
 *  grid's stamp buffer to cover it. Authored colliders are indexed eagerly in
 *  gridFor; decorations join the same id space as they materialize, which is
 *  what keeps queryOpenWorldColliders' dedupe complete. */
function assignDecorationGridIndex(grid: ColliderGrid, c: Collider): void {
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
        assignDecorationGridIndex(grid, built);
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
function pushOut(c: Collider, x: number, z: number, r: number): { x: number; z: number } | null {
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
      const res = pushOut(c, px, pz, r);
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
}
const RIFT_REGIONS = new Map<number, RiftRegion[]>();
let NEXT_RIFT_TOKEN = 1;

export function allocRiftCollisionToken(): number {
  return NEXT_RIFT_TOKEN++;
}

export function setRiftRegion(token: number, ox: number, oz: number, colliders: Collider[]): void {
  let list = RIFT_REGIONS.get(token);
  if (!list) {
    list = [];
    RIFT_REGIONS.set(token, list);
  }
  const i = list.findIndex((r) => r.ox === ox && r.oz === oz);
  if (i >= 0) list[i] = { ox, oz, colliders };
  else list.push({ ox, oz, colliders });
}

export function clearRiftRegion(token: number, ox: number, oz: number): void {
  const list = RIFT_REGIONS.get(token);
  if (!list) return;
  const i = list.findIndex((r) => r.ox === ox && r.oz === oz);
  if (i >= 0) list.splice(i, 1);
}

function riftRegionAt(token: number, x: number, z: number): RiftRegion | null {
  const list = RIFT_REGIONS.get(token);
  if (!list) return null;
  for (const r of list) {
    if (Math.abs(x - r.ox) <= RIFT_REGION_HALF_X && Math.abs(z - r.oz) <= RIFT_REGION_HALF_Z) {
      return r;
    }
  }
  return null;
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
    const local = resolveAgainst(region.colliders, x - region.ox, z - region.oz, r, ignoreFences);
    return { x: local.x + region.ox, z: local.z + region.oz };
  }
  if (x > DUNGEON_X_THRESHOLD) {
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
  return isYumiMazePos(x) || isDelvePos(x) || isArenaPos(x) || x > DUNGEON_X_THRESHOLD;
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
  if (x > DUNGEON_X_THRESHOLD) {
    // Dungeon interiors: the furniture tops (coffin lids, cargo stacks) are
    // standable surfaces exactly like the open world's crates and canopies.
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
  if (x > DUNGEON_X_THRESHOLD) {
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
  if (isYumiMazePos(x) || isDelvePos(x) || isArenaPos(x)) return null;
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
  if (isYumiMazePos(x) || isDelvePos(x) || isArenaPos(x) || x > DUNGEON_X_THRESHOLD) {
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
    let nextX = fromX + dx * t;
    // A sealed zone border is a hard wall regardless of terrain slope (the
    // climb gate projects rise along the movement direction, so a shallow
    // diagonal would otherwise sneak over the crest). Clamp z at the crest
    // and keep the x component, so pushing into the wall slides along it.
    let nextZ = crossesSealedBorder(x, z, fromZ + dz * t) ? z : fromZ + dz * t;
    // The Great Maze's hedges are hard walls for the same reason, tested as
    // a segment crossing (an endpoint-only test teleports a stalled mover
    // across once its target passes the wall). The faces are axis-aligned,
    // so slide by dropping whichever axis component pushes into the hedge.
    if (crossesGardenHedge(x, z, nextX, nextZ)) {
      if (!crossesGardenHedge(x, z, x, nextZ)) nextX = x;
      else if (!crossesGardenHedge(x, z, nextX, z)) nextZ = z;
      else break; // cornered against the hedge
    }
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
    if (crossesGardenHedge(x, z, resolved.x, resolved.z)) break;
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
): boolean {
  const res = resolvePosition(seed, x, z, r, ignoreFences, delveModules, undefined, riftToken);
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
      if (pushOut(c, lx, lz, r) !== null) return true;
    }
    return false;
  };
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
    return region ? overlapsAny(region.colliders, x - region.ox, z - region.oz, false) : false;
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
  from: { x: number; z: number },
  to: { x: number; z: number },
  r = 0.05,
  delveModules?: readonly string[],
  riftToken = 0,
): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return true;
  // The sight line runs eye-to-eye: lerp the endpoint eye heights per sample so
  // a low prop only blocks when its top actually crosses the line.
  const eyeFrom = groundHeight(from.x, from.z, seed) + SIGHT_HEIGHT;
  const eyeTo = groundHeight(to.x, to.z, seed) + SIGHT_HEIGHT;
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
