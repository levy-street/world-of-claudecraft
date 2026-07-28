import {
  buildingCameraHeight,
  buildingTerrainEnvelope,
  isEastbrookGrandArmoury,
} from './building_layout';
import { MOUNT_RACE_JUMP_FIXTURES, raceGateSegment } from './content/mounts';
import {
  arenaOriginAt,
  DUNGEON_X_THRESHOLD,
  defaultDelveModules,
  delveAt,
  delveModuleLocal,
  dungeonAt,
  getActiveWorldContent,
  INSTANCE_SLOT_COUNT,
  instanceOrigin,
  isArenaPos,
  isDelvePos,
  isRiftPos,
  isYumiMazePos,
  PORTALS,
  RIFT_REGION_HALF_X,
  RIFT_REGION_HALF_Z,
  yumiMazeOriginAt,
} from './data';
import { type DelveModuleId, delveModuleColliders } from './delve_layout';
import { isLitanyModuleId, litanyModuleLosColliders } from './delve_litany_layout';
import {
  ARENA_LAYOUT,
  CRYPT_LAYOUT,
  DROWNED_COURT_LAYOUT,
  LASTKEEP_LAYOUT,
  layoutColliders,
  NYTHRAXIS_LAYOUT,
  SANCTUM_LAYOUT,
  TEMPLE_LAYOUT,
} from './dungeon_layout';
import { emberLilySpots } from './ember_lilies';
import { fenWillowSpots, hollowWillowSpots } from './fen_willows';
import { ORKADIA_FIELD_COLLIDER_SPECS, ORKADIA_FIELD_WALLS } from './orkadia_field';
import type { BuildingDef, WorldContent } from './types';
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
  /** Absolute world-space top used by camera occlusion; movement ignores it. */
  cameraTopY?: number;
  /**
   * When true the chase cam ray passes straight through this collider (no
   * pull-in). Movement still collides. Used for props that the renderer hides
   * when they cross the eye-to-camera segment instead of zooming in.
   */
  camGhost?: boolean;
}

export interface ObbCollider {
  type: 'obb';
  x: number;
  z: number;
  hw: number; // half width (local x)
  hd: number; // half depth (local z)
  rot: number; // yaw, three.js rotation.y convention
  /** Absolute world-space top used by camera occlusion; movement ignores it. */
  cameraTopY?: number;
  /** See {@link CircleCollider.camGhost}. */
  camGhost?: boolean;
  /**
   * Low fence rail: a grounded mover collides normally, but a mover that is
   * airborne above the rail (see `FENCE_RAIL_HEIGHT`) jumps clear of it. Set on
   * the OBBs built from `PROPS.fences`.
   */
  isFence?: boolean;
}

export type Collider = CircleCollider | ObbCollider;

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

function staticWorldColliders(seed: number): Collider[] {
  const out: Collider[] = [];
  const content = getActiveWorldContent();
  const PROPS = content.props;

  // Hideable render props are `camGhost`: they keep blocking movement but the
  // chase cam no longer pulls in for them; the renderer hides whichever one
  // crosses the eye-to-camera segment instead.
  for (const b of PROPS.buildings) {
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
      camGhost: true,
    });
  }
  for (const w of PROPS.wells)
    out.push({
      type: 'circle',
      x: w.x,
      z: w.z,
      r: w.r,
      cameraTopY: topY(seed, w.x, w.z, w.height ?? 3.7),
      camGhost: w.camGhost ?? true,
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
      camGhost: true,
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
          camGhost: true,
        });
      out.push({
        type: 'circle',
        x: side.x - fx * 3.8,
        z: side.z - fz * 3.8,
        r: 3.2,
        cameraTopY: topY(seed, side.x, side.z, 9),
        camGhost: true,
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
      camGhost: true,
    });
  // ...and the Veiled Hollow's willows, same one-list contract
  for (const w of hollowWillowSpots(seed))
    out.push({
      type: 'circle',
      x: w.x,
      z: w.z,
      r: w.r,
      cameraTopY: topY(seed, w.x, w.z, 6),
      camGhost: true,
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
      camGhost: true,
    });
  }
  // The Palmreach strand: a slim trunk collider at the base of every beach
  // palm, from the same deterministic list the renderer instances the models
  // from (world.ts). camGhost so the chase cam passes through instead of
  // slamming in when a palm crosses the eye line.
  for (const p of reachPalmSpots(seed))
    out.push({
      type: 'circle',
      x: p.x,
      z: p.z,
      r: p.r,
      cameraTopY: topY(seed, p.x, p.z, 7),
      camGhost: true,
    });
  // ...and the Farshore strand's palms, the same one-list contract
  for (const p of farshorePalmSpots(seed))
    out.push({
      type: 'circle',
      x: p.x,
      z: p.z,
      r: p.r,
      cameraTopY: topY(seed, p.x, p.z, 7),
      camGhost: true,
    });
  for (const s of PROPS.stalls) {
    const cameraTopY = topY(seed, s.x, s.z, s.height ?? 3.1);
    if (s.w !== undefined && s.d !== undefined) {
      out.push({
        type: 'obb',
        x: s.x,
        z: s.z,
        hw: s.w / 2,
        hd: s.d / 2,
        rot: s.rot,
        cameraTopY,
        camGhost: s.camGhost ?? true,
      });
    } else {
      out.push({
        type: 'circle',
        x: s.x,
        z: s.z,
        r: s.r,
        cameraTopY,
        camGhost: s.camGhost ?? true,
      });
    }
  }
  for (const prop of [...(PROPS.benches ?? []), ...(PROPS.walls ?? [])]) {
    out.push({
      type: 'obb',
      x: prop.x,
      z: prop.z,
      hw: prop.w / 2,
      hd: prop.d / 2,
      rot: prop.rot,
      cameraTopY: topY(seed, prop.x, prop.z, prop.height),
      camGhost: prop.camGhost ?? false,
    });
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
      camGhost: true,
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
      camGhost: true,
    });
  }

  // mines: mound behind the timber portal
  for (const m of PROPS.mines) {
    const { x, z, r } = mineMoundFootprint(m);
    out.push({ type: 'circle', x, z, r, cameraTopY: topY(seed, x, z, r + 0.2), camGhost: true });
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
      camGhost: true,
    });
  }

  for (const t of PROPS.tents)
    out.push({
      type: 'circle',
      x: t.x,
      z: t.z,
      r: 1.5 * t.scale,
      cameraTopY: topY(seed, t.x, t.z, 3.4 * t.scale),
      camGhost: true,
    });
  for (const [x, z] of PROPS.crates)
    out.push({ type: 'circle', x, z, r: 0.65, cameraTopY: topY(seed, x, z, 1.35), camGhost: true });
  for (const [x, z] of PROPS.campfires)
    out.push({ type: 'circle', x, z, r: 0.85, cameraTopY: topY(seed, x, z, 1.45), camGhost: true });
  for (const [x, z] of PROPS.mudHuts)
    out.push({ type: 'circle', x, z, r: 1.1, cameraTopY: topY(seed, x, z, 12.5), camGhost: true });
  for (const ruin of PROPS.ruinRings) {
    for (let i = 0; i < ruin.columns; i++) {
      const ang = (i / ruin.columns) * Math.PI * 2;
      const x = ruin.x + Math.sin(ang) * ruin.ringR,
        z = ruin.z + Math.cos(ang) * ruin.ringR;
      out.push({ type: 'circle', x, z, r: 0.6, cameraTopY: topY(seed, x, z, 4.3), camGhost: true });
    }
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
      camGhost: true,
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
      camGhost: true,
      isFence: true,
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
      camGhost: true,
    });
  }

  // Editor-authored invisible blocker walls (custom maps only): one fence-width
  // OBB per segment, exactly the PROPS.fences math above, but NOT isFence (a
  // jump never clears a blocker) and camGhost (there is no mesh, so the chase
  // cam must never pull in for an invisible wall). Purely static data: no rng
  // draws, no tick-order impact, and no render mesh in playtest.
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
      camGhost: true,
    });
  }

  // The Sowfield boards, goal posts, net pockets, stand fronts, and plinth
  // (Vale Cup). ONE layout module (vale_cup_layout.ts) drives this movement
  // set, the ball's analytic wall reflection, the terrain flatten, and the
  // render dressing, so they can never drift. Deliberately NOT fences: boards
  // must not be jump-through mid-match (the north gate is the way in). Applies
  // for any active content, matching the flatten arm (crater-precedent leak).
  out.push(...valeCupColliders());
  return out;
}

/** Test-only visibility into the authored static set so world-layout tests can
 *  pin real collider extents and camera tops rather than re-testing helpers. */
export const colliderInternalsForTest = { staticWorldColliders };

// Interior collision sets, in instance-local coordinates. Derived from the
// SAME plain-data layouts the renderer builds the KayKit modules from
// (sim/dungeon_layout.ts), so render geometry and collision can no longer
// drift apart. The boss dais is walkable and deliberately has no collider.
const CRYPT_COLLIDERS: Collider[] = layoutColliders(CRYPT_LAYOUT);
const SANCTUM_COLLIDERS: Collider[] = layoutColliders(SANCTUM_LAYOUT);
const TEMPLE_COLLIDERS: Collider[] = layoutColliders(TEMPLE_LAYOUT);
const ARENA_COLLIDERS: Collider[] = layoutColliders(ARENA_LAYOUT);
const DROWNED_COURT_COLLIDERS: Collider[] = layoutColliders(DROWNED_COURT_LAYOUT);
const NYTHRAXIS_COLLIDERS: Collider[] = layoutColliders(NYTHRAXIS_LAYOUT);
// The Last Keep: an authored room-graph interior, so its walls (minus
// doorways) and decor footprints all derive from the one shared layout,
// exactly like the rift citadel floors (layoutColliders routes through
// authoredColliders).
const LASTKEEP_COLLIDERS: Collider[] = layoutColliders(LASTKEEP_LAYOUT);

// Orkadia is an OPEN FIELD, not a room kit: a perimeter enclosure (plain obbs
// that pull the chase cam in like interior walls, so players cannot leave the
// war-camp) plus one circle per placed prop, camGhost + cameraTopY following
// the world-prop contract. Both halves derive from the SAME placement table
// the renderer builds the field from (src/sim/orkadia_field.ts), so what you
// see is what you collide with. The skull dais stays walkable (no collider),
// matching the room-kit boss-dais contract.
const ORKADIA_COLLIDERS: Collider[] = [
  ...ORKADIA_FIELD_WALLS.map(
    (w): Collider => ({ type: 'obb', x: w.x, z: w.z, hw: w.hw, hd: w.hd, rot: 0 }),
  ),
  ...ORKADIA_FIELD_COLLIDER_SPECS.map(
    (s): Collider => ({ type: 'circle', x: s.x, z: s.z, r: s.r, cameraTopY: s.h, camGhost: true }),
  ),
];

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
      camGhost: true,
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

// Interior collider sets keyed by DungeonDef.interior.
const INTERIOR_COLLIDERS: Record<string, Collider[]> = {
  crypt: CRYPT_COLLIDERS,
  sanctum: SANCTUM_COLLIDERS,
  temple: TEMPLE_COLLIDERS,
  nythraxis: NYTHRAXIS_COLLIDERS,
  orkadia: ORKADIA_COLLIDERS,
  wildheart: WILDHEART_COLLIDERS,
  lastkeep: LASTKEEP_COLLIDERS,
};

// ---------------------------------------------------------------------------
// Spatial grid + movement resolution
// ---------------------------------------------------------------------------

const GRID_CELL = 16;
const MAX_BODY_RADIUS = 0.8; // largest mover we resolve for
/** Fence/blocker wall half-thickness (yards); the editor's blocker overlay
 * reuses it so the drawn wall matches the collider exactly. */
export const FENCE_HALF_DEPTH = 0.35;
const FENCE_END_PAD = 0.35;
/** Blocker walls are full-height (a jump never clears one, unlike a fence);
 * this is only the camera-occlusion top for the record. */
const BLOCKER_WALL_HEIGHT = 6;
/**
 * Visual top of a low village fence rail (yards). The fence.glb rail is ~0.33yd
 * native and renders at ~2.9x, so its silhouette tops out around waist height.
 * Fences are `camGhost`, so camera occlusion skips them and this value feeds
 * ONLY the spell line-of-sight check (`sightBlockedAt`): it MUST stay below
 * `SIGHT_HEIGHT` (1.6) so a caster sees and casts over a fence, matching what
 * the player sees on screen (issue #1668). The old 2.8 (a stale camera-occlusion
 * guess, ~3x the real rail) sat above the eye line and wrongly blocked casts. A
 * jump still clears the rail for movement regardless (see sim `Entity.jumping`). */
const FENCE_RAIL_HEIGHT = 0.95;

interface ColliderGrid {
  cells: Map<string, Collider[]>;
  // The authored prop grid above is cheap and eager. The multi-realm
  // decoration field is generated one queried cell at a time, then combined
  // with that authored list. This keeps collision identical without making a
  // cold Sim enumerate the whole continent before its first spawn.
  decorationCells: Map<string, Collider[]>;
  combinedCells: Map<string, Collider[]>;
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
  grid = { cells: new Map(), decorationCells: new Map(), combinedCells: new Map() };
  for (const c of staticWorldColliders(seed)) {
    const b = colliderBounds(c);
    const x0 = Math.floor((b.minX - MAX_BODY_RADIUS) / GRID_CELL);
    const x1 = Math.floor((b.maxX + MAX_BODY_RADIUS) / GRID_CELL);
    const z0 = Math.floor((b.minZ - MAX_BODY_RADIUS) / GRID_CELL);
    const z1 = Math.floor((b.maxZ + MAX_BODY_RADIUS) / GRID_CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const key = `${gx},${gz}`;
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
// largest collision multiplier at 0.7. This conservative bound selects every
// candidate whose circle could be assigned to a queried grid cell.
const MAX_DECORATION_COLLIDER_RADIUS = 1.6 * 0.7;

function decorationCollider(seed: number, d: Decoration): Collider | null {
  if (d.kind === 'rock') {
    if (d.scale < 0.8) return null;
    return {
      type: 'circle',
      x: d.x,
      z: d.z,
      r: 0.7 * d.scale,
      cameraTopY: topY(seed, d.x, d.z, 1.25 * d.scale),
    };
  }
  // tree trunks only; canopies don't block
  return {
    type: 'circle',
    x: d.x,
    z: d.z,
    r: 0.55 * d.scale,
    cameraTopY: topY(seed, d.x, d.z, 7.5 * d.scale),
    camGhost: true,
  };
}

function collidersInCell(grid: ColliderGrid, seed: number, gx: number, gz: number): Collider[] {
  const key = `${gx},${gz}`;
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
      const collider = decorationCollider(seed, decoration);
      if (!collider) continue;
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
): { x: number; z: number } {
  let px = x,
    pz = z;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const c of list) {
      if (ignoreFences && c.type === 'obb' && c.isFence) continue;
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
// movement, mob pathing, line-of-sight and camera occlusion all respect the
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

function instanceLocal(x: number, z: number): { ox: number; oz: number; interior: string } {
  const dungeon = dungeonAt(x);
  const index = dungeon?.index ?? 0;
  let best = 0,
    bestD = Infinity;
  for (let i = 0; i < INSTANCE_SLOT_COUNT; i++) {
    const o = instanceOrigin(index, i);
    const d = Math.abs(z - o.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const o = instanceOrigin(index, best);
  return { ox: o.x, oz: o.z, interior: dungeon?.interior ?? 'crypt' };
}

// Resolve a movement destination against all static geometry. Movers slide
// along obstacles. `r` is the body radius.
export function resolvePosition(
  seed: number,
  x: number,
  z: number,
  r = 0.5,
  ignoreFences = false,
  delveModules?: readonly string[],
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
    const { ox, oz, interior } = instanceLocal(x, z);
    const colliders = INTERIOR_COLLIDERS[interior] ?? CRYPT_COLLIDERS;
    const local = resolveAgainst(colliders, x - ox, z - oz, r, ignoreFences);
    return { x: local.x + ox, z: local.z + oz };
  }
  const grid = gridFor(seed);
  const list = collidersInCell(grid, seed, Math.floor(x / GRID_CELL), Math.floor(z / GRID_CELL));
  if (list.length === 0) return { x, z };
  return resolveAgainst(list, x, z, r, ignoreFences);
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
  riftToken = 0,
): { x: number; z: number } {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return resolvePosition(seed, toX, toZ, r, ignoreFences, delveModules, riftToken);
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
    const resolved = resolvePosition(seed, nextX, nextZ, r, ignoreFences, delveModules, riftToken);
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
  const res = resolvePosition(seed, x, z, r, ignoreFences, delveModules, riftToken);
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

// ---------------------------------------------------------------------------
// Camera occlusion — third-person chase-cam pull-in
// ---------------------------------------------------------------------------
// The renderer sweeps a ray from the player's head (`a`) toward the desired
// camera position (`b`) and pulls the camera in to the surface of the first
// static obstacle in between, so the chase cam never sits inside a wall.
// Pure XZ math against the SAME colliders movement uses (what you see is what
// you collide with). Returns the fraction of the a->b segment the camera may
// travel before the first occluder (1 = unobstructed). Open-world colliders
// carry precomputed `cameraTopY` values, so large rocks still pull the camera
// in only when the ray passes below their visual top. Hideable props are
// flagged `camGhost` and skipped entirely (the renderer hides them instead).

// First entry param t along a->b for a circle (radius already padded).
// Infinity = no hit; we also bail when `a` is already inside (never slam the
// camera onto the player).
function rayCircleEntry(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  r: number,
): number {
  const dx = bx - ax,
    dz = bz - az;
  const a = dx * dx + dz * dz;
  if (a < 1e-12) return Infinity;
  const fx = ax - cx,
    fz = az - cz;
  const c = fx * fx + fz * fz - r * r;
  if (c < 0) return Infinity; // origin inside the circle
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  return (-b - Math.sqrt(disc)) / (2 * a);
}

// First entry param t along a->b for an OBB (extents already padded).
function rayObbEntry(
  c: ObbCollider,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  pad: number,
): number {
  const la = rotY(ax - c.x, az - c.z, -c.rot);
  const lb = rotY(bx - c.x, bz - c.z, -c.rot);
  const ex = c.hw + pad,
    ez = c.hd + pad;
  if (Math.abs(la.x) < ex && Math.abs(la.z) < ez) return Infinity; // origin inside the box
  const dx = lb.x - la.x,
    dz = lb.z - la.z;
  let tmin = -Infinity,
    tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (la.x < -ex || la.x > ex) return Infinity;
  } else {
    let t1 = (-ex - la.x) / dx,
      t2 = (ex - la.x) / dx;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (Math.abs(dz) < 1e-9) {
    if (la.z < -ez || la.z > ez) return Infinity;
  } else {
    let t1 = (-ez - la.z) / dz,
      t2 = (ez - la.z) / dz;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (tmax < tmin || tmax < 0) return Infinity;
  return tmin;
}

// Minimum entry fraction over one collider list (1 = clear). `infinite` skips
// the height gate (interior walls are full-height; the open world is not).
function sweepColliders(
  list: Collider[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  pad: number,
  infinite: boolean,
): number {
  let best = 1;
  for (const c of list) {
    if (c.camGhost) continue; // chase cam passes through; renderer hides it instead
    const t =
      c.type === 'circle'
        ? rayCircleEntry(ax, az, bx, bz, c.x, c.z, c.r + pad)
        : rayObbEntry(c, ax, az, bx, bz, pad);
    if (!(t > 1e-4) || t >= best) continue;
    if (!infinite && c.cameraTopY !== undefined && ay + (by - ay) * t > c.cameraTopY) continue;
    best = t;
  }
  return best;
}

// Fraction of the head->camera segment the chase cam may travel before the
// first static occluder. `a` is the look-at pivot (player head), `b` the
// desired camera position. Mirrors resolvePosition's region split.
export function cameraOcclusion(
  seed: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  pad = 0.35,
  delveModules?: readonly string[],
  riftToken = 0,
): number {
  if (isYumiMazePos(ax)) {
    const o = yumiMazeOriginAt(az);
    return sweepColliders(
      yumiMazeColliders(),
      ax - o.x,
      ay,
      az - o.z,
      bx - o.x,
      by,
      bz - o.z,
      pad,
      true,
    );
  }
  if (isDelvePos(ax)) {
    const delve = delveAt(ax);
    const mods = delveModules?.length ? delveModules : delve ? defaultDelveModules(delve.id) : [];
    const loc = delveModuleLocal(ax, az, mods);
    const colliders = delveModuleColliders(loc.moduleId as DelveModuleId);
    return sweepColliders(
      colliders,
      loc.localX,
      ay,
      loc.localZ,
      bx - loc.ox,
      by,
      bz - loc.oz,
      pad,
      true,
    );
  }
  if (isArenaPos(ax)) {
    const o = arenaOriginAt(az);
    return sweepColliders(
      arenaCollidersForSlot(o.slot),
      ax - o.x,
      ay,
      az - o.z,
      bx - o.x,
      by,
      bz - o.z,
      pad,
      true,
    );
  }
  if (isRiftPos(ax)) {
    const region = riftRegionAt(riftToken, ax, az);
    if (!region) return 1;
    return sweepColliders(
      region.colliders,
      ax - region.ox,
      ay,
      az - region.oz,
      bx - region.ox,
      by,
      bz - region.oz,
      pad,
      true,
    );
  }
  if (ax > DUNGEON_X_THRESHOLD) {
    const { ox, oz, interior } = instanceLocal(ax, az);
    const colliders = INTERIOR_COLLIDERS[interior] ?? CRYPT_COLLIDERS;
    return sweepColliders(colliders, ax - ox, ay, az - oz, bx - ox, by, bz - oz, pad, true);
  }
  const grid = gridFor(seed);
  const gx0 = Math.floor(Math.min(ax, bx) / GRID_CELL),
    gx1 = Math.floor(Math.max(ax, bx) / GRID_CELL);
  const gz0 = Math.floor(Math.min(az, bz) / GRID_CELL),
    gz1 = Math.floor(Math.max(az, bz) / GRID_CELL);
  let best = 1;
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gz = gz0; gz <= gz1; gz++) {
      const list = collidersInCell(grid, seed, gx, gz);
      if (list.length > 0)
        best = Math.min(best, sweepColliders(list, ax, ay, az, bx, by, bz, pad, false));
    }
  }
  return best;
}

// Eye height (yards above the ground) for the spell line-of-sight ray. An
// open-world obstacle whose visual top (`cameraTopY`, the same precomputed top
// the camera occlusion uses) sits at or below the sight line no longer blocks a
// cast: a campfire (top 1.45), a crate (1.35), or a small rock is something you
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
    const { ox, oz, interior } = instanceLocal(x, z);
    return overlapsAny(INTERIOR_COLLIDERS[interior] ?? CRYPT_COLLIDERS, x - ox, z - oz, false);
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
