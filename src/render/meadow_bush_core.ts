// Clustered vale bushes: sparse leafy bushes, flowering bushes and ferns in small
// clusters where a painted meadow grows its undergrowth, along path verges,
// against wall and building bases, round rocks and at the foot of a few trees.
// The Eastbrook companion to the patchy meadow (meadow_patch_core.ts): the grass
// rings these bushes too, so a bush stands IN a tuft of grass, not on bare paint.
//
// Purely visual dressing: the spots join the shipped ground-dressing scatter
// (foliage_dressing_spots.ts generateDressing), drawn by the existing bush,
// bush_flowers and fern instanced meshes of each dressing bucket, so they add
// instances and no draw call or program. They never collide.
//
// Gameplay first: no spot on a road or path, in a doorway, on a deck or the
// strand, in a hub or camp clearing, inside a building, rock or trunk, or within
// reach of anything a player clicks (NPCs, gather nodes, quest objects, farm
// beds, mailboxes, boards, stations). The list is identical on every graphics
// tier (no GFX read): density compensation stays the base scatter's job.
//
// Pure: sim reads only, deterministic in (seed, content). Built once per scope.

import { FARM_PATCHES } from '../sim/content/farm_patches';
import { GATHER_NODES } from '../sim/content/gather_nodes';
import { getActiveWorldContent } from '../sim/data';
import { onHarborPlanks } from '../sim/deck_surfaces';
import { farmPatchesFor, gatherNodesFor } from '../sim/moved_objects';
import { reachDeckClear } from '../sim/reach_decks';
import { noise2 } from '../sim/rng';
import type { WorldContent } from '../sim/types';
import {
  roadDistance,
  terrainCutAtHeight,
  terrainHeight,
  terrainSteepness,
  WATER_LEVEL,
} from '../sim/world';
import {
  type EastbrookGrassExclusion,
  eastbrookGrassExclusions,
  hashAt,
  insideAnyBuildingFootprint,
  insideDressingExclusion,
  insideEastbrookGrassExclusion,
} from './foliage_core';
import {
  type MeadowScope,
  meadowScopeDecorations,
  meadowScopeFor,
  meadowScopeWeight,
} from './meadow_scope_core';

/** The existing dressing models a cluster draws from (no new asset). */
export type MeadowBushKind = 'bush' | 'bushFlowers' | 'fern';

export interface MeadowBushSpot {
  readonly x: number;
  readonly z: number;
  readonly kind: MeadowBushKind;
  readonly scale: number;
}

/** Where a cluster grew; tests read it, the renderer does not. */
export type MeadowBushSite = 'verge' | 'rock' | 'wall' | 'tree';

export interface MeadowBushPlacement extends MeadowBushSpot {
  readonly site: MeadowBushSite;
}

// ---------------------------------------------------------------------------
// Tunable knobs
// ---------------------------------------------------------------------------

/** Verge clusters sit this far (yards from the road centreline) behind the
 *  tall verge grass: never on the path, never on its dirt shoulder. */
export const MEADOW_BUSH_VERGE_NEAR = 4.4;
export const MEADOW_BUSH_VERGE_FAR = 7.8;
/** Hard floor for any bush: no spot closer to a road centreline than this. */
export const MEADOW_BUSH_ROAD_CLEAR = 3.9;
/** Candidate spacing (yards) of the verge walk, before the cluster gates. */
export const MEADOW_BUSH_VERGE_STEP = 3.6;
/** Share of verge candidates in a bushy stretch that seed a cluster. */
export const MEADOW_BUSH_VERGE_RATE = 0.6;
/** Share of rocks that gather a cluster at their foot. */
export const MEADOW_BUSH_ROCK_RATE = 0.72;
/** Share of perimeter stops along a wall or building base that seed one. */
export const MEADOW_BUSH_WALL_RATE = 0.5;
/** Share of trees that keep a fern or bush at their foot (field margins). */
export const MEADOW_BUSH_TREE_RATE = 0.17;
/** No bush within this many yards of a door apron's standing point. */
export const MEADOW_BUSH_DOOR_CLEAR = 4.5;
/** No bush within this many yards of anything a player clicks. */
export const MEADOW_BUSH_INTERACT_CLEAR = 3.5;
/** Closest two bushes may stand (yards between centres). */
export const MEADOW_BUSH_MIN_SPACING = 1.05;
/** Scale band: the anchor of a cluster is the big one, members smaller. Kept
 *  under the base scatter's own ceiling (1.6) on purpose. */
export const MEADOW_BUSH_ANCHOR_SCALE: readonly [number, number] = [0.95, 1.3];
export const MEADOW_BUSH_MEMBER_SCALE: readonly [number, number] = [0.6, 0.95];
/** Bushes stay off the strand: ground must stand this high over the sea. */
const STRAND_FREEBOARD = 3.0;
const MAX_STEEPNESS = 0.62;

const VERGE_KINDS: readonly [MeadowBushKind, number][] = [
  ['bush', 0.42],
  ['bushFlowers', 0.33],
  ['fern', 0.25],
];
const ROCK_KINDS: readonly [MeadowBushKind, number][] = [
  ['fern', 0.45],
  ['bush', 0.4],
  ['bushFlowers', 0.15],
];
const WALL_KINDS: readonly [MeadowBushKind, number][] = [
  ['bushFlowers', 0.45],
  ['bush', 0.35],
  ['fern', 0.2],
];
const TREE_KINDS: readonly [MeadowBushKind, number][] = [
  ['fern', 0.6],
  ['bush', 0.3],
  ['bushFlowers', 0.1],
];

/** Visual footprint radius (yards per unit scale) of each model, measured off
 *  the shipped GLBs (bush and bush_flowers about 0.85, the fern's fronds 1.4). */
export const MEADOW_BUSH_FOOTPRINT: Readonly<Record<MeadowBushKind, number>> = {
  bush: 0.85,
  bushFlowers: 0.92,
  fern: 1.0,
};

/** Rock visual radius per unit decoration scale (the renderer draws a rock at
 *  about 0.62 x 1.1 of its 1.6-yard model radius per unit scale). */
export const MEADOW_ROCK_RADIUS_PER_SCALE = 1.05;
/** Tree trunk radius per unit decoration scale (the sim's trunk collider). */
export const MEADOW_TRUNK_RADIUS_PER_SCALE = 0.55;

function pickKind(table: readonly [MeadowBushKind, number][], roll: number): MeadowBushKind {
  let acc = 0;
  for (const [kind, weight] of table) {
    acc += weight;
    if (roll < acc) return kind;
  }
  return table[table.length - 1][0];
}

function lerp(range: readonly [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}

interface AvoidCircle {
  x: number;
  z: number;
  r: number;
}

/** Everything a player clicks or stands at in the scope, as clearance circles. */
function interactableCircles(scope: MeadowScope, content: WorldContent): AvoidCircle[] {
  const out: AvoidCircle[] = [];
  const pad = MEADOW_BUSH_INTERACT_CLEAR;
  const inRange = (x: number, z: number): boolean =>
    x > scope.minX - pad && x < scope.maxX + pad && z > scope.minZ - pad && z < scope.maxZ + pad;
  const add = (x: number, z: number, r = pad): void => {
    if (inRange(x, z)) out.push({ x, z, r });
  };
  for (const npc of Object.values(content.npcs)) add(npc.pos.x, npc.pos.z);
  for (const object of content.groundObjects) {
    for (const p of object.positions) add(p.x, p.z);
  }
  // where this world's touch-up moved them, not the shipped tables' rows
  for (const node of gatherNodesFor(content.objectMoves, GATHER_NODES)) add(node.pos.x, node.pos.z);
  for (const patch of farmPatchesFor(content.objectMoves, FARM_PATCHES)) {
    for (const bed of patch.beds) add(bed.x, bed.z);
  }
  const services = content.services;
  for (const station of services?.stations ?? []) add(station.pos.x, station.pos.z);
  for (const mailbox of services?.mailboxes ?? []) add(mailbox.x, mailbox.z);
  for (const board of services?.noticeboards ?? []) add(board.x, board.z);
  for (const board of services?.musterBoards ?? []) add(board.x, board.z);
  // standing props (ships, carts, tents) keep their own footprint clear
  for (const prop of content.props.decorProps ?? []) {
    if (prop.r && prop.r > 0) add(prop.x, prop.z, prop.r + 1);
  }
  return out;
}

const SPACING_CELL = 4;

class BushPlacer {
  readonly spots: MeadowBushPlacement[] = [];
  private readonly grid = new Map<number, MeadowBushPlacement[]>();
  private readonly avoid: AvoidCircle[];
  private readonly doors: AvoidCircle[];
  private readonly bodies: AvoidCircle[];
  private readonly townExclusions: readonly EastbrookGrassExclusion[];

  constructor(
    private readonly scope: MeadowScope,
    private readonly content: WorldContent,
    townExclusions: readonly EastbrookGrassExclusion[],
  ) {
    this.townExclusions = townExclusions;
    this.avoid = interactableCircles(scope, content);
    this.doors = townExclusions
      .filter((ex) => ex.kind === 'circle' && /apron$/i.test(ex.id))
      .map((ex) => ({ x: ex.x, z: ex.z, r: MEADOW_BUSH_DOOR_CLEAR }));
    const decorations = meadowScopeDecorations(scope);
    this.bodies = [
      ...decorations.rocks.map((d) => ({
        x: d.x,
        z: d.z,
        r: d.scale * MEADOW_ROCK_RADIUS_PER_SCALE + 0.25,
      })),
      ...decorations.trees.map((d) => ({
        x: d.x,
        z: d.z,
        r: d.scale * MEADOW_TRUNK_RADIUS_PER_SCALE + 0.45,
      })),
    ];
  }

  private key(cx: number, cz: number): number {
    return ((cx & 0xffff) << 16) | (cz & 0xffff);
  }

  private crowded(x: number, z: number): boolean {
    const cx = Math.floor(x / SPACING_CELL);
    const cz = Math.floor(z / SPACING_CELL);
    const minSq = MEADOW_BUSH_MIN_SPACING * MEADOW_BUSH_MIN_SPACING;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = this.grid.get(this.key(cx + i, cz + j));
        if (!list) continue;
        for (const s of list) {
          const dx = s.x - x;
          const dz = s.z - z;
          if (dx * dx + dz * dz < minSq) return true;
        }
      }
    }
    return false;
  }

  /** Every gameplay and ground gate, cheapest first. */
  allowed(x: number, z: number): boolean {
    if (meadowScopeWeight(this.scope, x, z) < 0.6) return false;
    if (this.crowded(x, z)) return false;
    for (const c of this.doors) {
      if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) return false;
    }
    for (const c of this.avoid) {
      if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) return false;
    }
    for (const c of this.bodies) {
      if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) return false;
    }
    const content = this.content;
    if (insideDressingExclusion(content.zones, content.camps, x, z)) return false;
    if (insideEastbrookGrassExclusion(this.townExclusions, x, z, 0.8)) return false;
    if (insideAnyBuildingFootprint(content.props.buildings, x, z, 0.8)) return false;
    if (roadDistance(x, z) < MEADOW_BUSH_ROAD_CLEAR) return false;
    if (!reachDeckClear(x, z, 1)) return false;
    const seed = this.scope.seed;
    const h = terrainHeight(x, z, seed);
    if (h < WATER_LEVEL + STRAND_FREEBOARD) return false;
    if (terrainCutAtHeight(x, z, h)) return false;
    if (onHarborPlanks(x, z, (sx, sz) => terrainHeight(sx, sz, seed), WATER_LEVEL)) return false;
    return terrainSteepness(x, z, seed) <= MAX_STEEPNESS;
  }

  place(x: number, z: number, kind: MeadowBushKind, scale: number, site: MeadowBushSite): boolean {
    if (!this.allowed(x, z)) return false;
    const spot: MeadowBushPlacement = { x, z, kind, scale, site };
    this.spots.push(spot);
    const k = this.key(Math.floor(x / SPACING_CELL), Math.floor(z / SPACING_CELL));
    const list = this.grid.get(k);
    if (list) list.push(spot);
    else this.grid.set(k, [spot]);
    return true;
  }

  /** One cluster: the anchor, then up to `extra` smaller members `spread` yards
   *  out. Given the edge's tangent (tx, tz, a unit vector), members string along
   *  it to alternating sides with a little give either way, so a verge or wall
   *  cluster follows its edge instead of crowding onto the path or the wall;
   *  without one they fall round the anchor. */
  cluster(
    x: number,
    z: number,
    kinds: readonly [MeadowBushKind, number][],
    extra: number,
    spread: number,
    site: MeadowBushSite,
    salt: number,
    tx = 0,
    tz = 0,
  ): void {
    const anchorKind = pickKind(kinds, hashAt(x, z, salt));
    const anchorScale = lerp(MEADOW_BUSH_ANCHOR_SCALE, hashAt(x, z, salt + 1));
    if (!this.place(x, z, anchorKind, anchorScale, site)) return;
    const along = tx !== 0 || tz !== 0;
    for (let m = 0; m < extra; m++) {
      const d = spread * (0.6 + 0.55 * hashAt(z, x, salt + 7 + m));
      let mx: number;
      let mz: number;
      if (along) {
        const side = m % 2 === 0 ? 1 : -1;
        const step = d * (1 + Math.floor(m / 2) * 0.8) * side;
        const give = (hashAt(x, z, salt + 2 + m) - 0.5) * spread * 0.7;
        mx = x + tx * step - tz * give;
        mz = z + tz * step + tx * give;
      } else {
        const a = hashAt(x, z, salt + 2 + m) * Math.PI * 2;
        mx = x + Math.cos(a) * d;
        mz = z + Math.sin(a) * d;
      }
      const kind = pickKind(kinds, hashAt(mx, mz, salt + 3));
      const scale = lerp(MEADOW_BUSH_MEMBER_SCALE, hashAt(mx, mz, salt + 4));
      this.place(mx, mz, kind, scale, site);
    }
  }
}

/** Unit tangent of the nearest road at (x, z): perpendicular to the gradient
 *  of the road distance (which points away from the road). */
function roadTangent(x: number, z: number, out: [number, number]): [number, number] {
  const e = 0.6;
  const gx = roadDistance(x + e, z) - roadDistance(x - e, z);
  const gz = roadDistance(x, z + e) - roadDistance(x, z - e);
  const len = Math.hypot(gx, gz);
  if (!Number.isFinite(len) || len < 1e-6) {
    out[0] = 0;
    out[1] = 0;
    return out;
  }
  out[0] = -gz / len;
  out[1] = gx / len;
  return out;
}

/** Bushy stretches along a verge: a slow noise so clusters gather on some
 *  reaches and leave others open (never an evenly spaced hedge). */
function vergeBushy(seed: number, x: number, z: number): boolean {
  return noise2(x / 26 + 3.1, z / 26 - 7.7, seed + 0x5b1) > 0.46;
}

function placeVerges(placer: BushPlacer, scope: MeadowScope): void {
  const step = MEADOW_BUSH_VERGE_STEP;
  const tangent: [number, number] = [0, 0];
  for (let gx = scope.minX + step * 0.5; gx < scope.maxX; gx += step) {
    for (let gz = scope.minZ + step * 0.5; gz < scope.maxZ; gz += step) {
      const x = gx + (hashAt(gx, gz, 61) - 0.5) * step;
      const z = gz + (hashAt(gx, gz, 62) - 0.5) * step;
      if (!vergeBushy(scope.seed, x, z)) continue;
      if (hashAt(gx, gz, 63) > MEADOW_BUSH_VERGE_RATE) continue;
      const rd = roadDistance(x, z);
      if (rd < MEADOW_BUSH_VERGE_NEAR || rd > MEADOW_BUSH_VERGE_FAR) continue;
      const extra = 2 + Math.floor(hashAt(gx, gz, 64) * 2);
      roadTangent(x, z, tangent);
      placer.cluster(x, z, VERGE_KINDS, extra, 1.9, 'verge', 70, tangent[0], tangent[1]);
    }
  }
}

function placeRocks(placer: BushPlacer, scope: MeadowScope): void {
  for (const rock of meadowScopeDecorations(scope).rocks) {
    if (hashAt(rock.x, rock.z, 81) > MEADOW_BUSH_ROCK_RATE) continue;
    const radius = rock.scale * MEADOW_ROCK_RADIUS_PER_SCALE;
    const count = 1 + Math.floor(hashAt(rock.x, rock.z, 82) * 3);
    const start = hashAt(rock.x, rock.z, 83) * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      // a fan round one side of the stone, not an even ring
      const a = start + (i - (count - 1) / 2) * (0.7 + 0.5 * hashAt(rock.z, rock.x, 84 + i));
      const d = radius + 0.55 + hashAt(rock.x, rock.z, 87 + i) * 0.9;
      const x = rock.x + Math.cos(a) * d;
      const z = rock.z + Math.sin(a) * d;
      const kind = pickKind(ROCK_KINDS, hashAt(x, z, 90));
      const range = i === 0 ? MEADOW_BUSH_ANCHOR_SCALE : MEADOW_BUSH_MEMBER_SCALE;
      placer.place(x, z, kind, lerp(range, hashAt(x, z, 91)) * 0.92, 'rock');
    }
  }
}

interface Footprint {
  x: number;
  z: number;
  halfW: number;
  halfD: number;
  rot: number;
}

/** The built edges in scope a hedge-foot cluster can hug: building reaches and
 *  wall boxes and long fences from the town layout, plus the content's own
 *  building records (the vault). Small furniture (benches, stalls) is left out. */
function wallFootprints(
  scope: MeadowScope,
  content: WorldContent,
  townExclusions: readonly EastbrookGrassExclusion[],
): Footprint[] {
  const out: Footprint[] = [];
  const inScope = (x: number, z: number): boolean =>
    x >= scope.minX && x < scope.maxX && z >= scope.minZ && z < scope.maxZ;
  for (const ex of townExclusions) {
    if (ex.kind !== 'obb' || !inScope(ex.x, ex.z)) continue;
    if (Math.max(ex.halfWidth, ex.halfDepth) < 2.2) continue;
    out.push({ x: ex.x, z: ex.z, halfW: ex.halfWidth, halfD: ex.halfDepth, rot: ex.rotation });
  }
  for (const b of content.props.buildings) {
    if (!inScope(b.x, b.z)) continue;
    out.push({ x: b.x, z: b.z, halfW: b.w / 2, halfD: b.d / 2, rot: b.rot });
  }
  return out;
}

function placeWalls(
  placer: BushPlacer,
  scope: MeadowScope,
  content: WorldContent,
  townExclusions: readonly EastbrookGrassExclusion[],
): void {
  const STEP = 2.6;
  for (const f of wallFootprints(scope, content, townExclusions)) {
    const cos = Math.cos(f.rot);
    const sin = Math.sin(f.rot);
    // local (lx, lz) to world, the inverse of the exclusion test's rotation
    const toWorld = (lx: number, lz: number): [number, number] => [
      f.x + lx * cos + lz * sin,
      f.z - lx * sin + lz * cos,
    ];
    const sides: [number, number, number, number, number][] = [
      // start lx, start lz, dir lx, dir lz, length; outward normal follows
      [-f.halfW, -f.halfD, 1, 0, f.halfW * 2],
      [f.halfW, -f.halfD, 0, 1, f.halfD * 2],
      [f.halfW, f.halfD, -1, 0, f.halfW * 2],
      [-f.halfW, f.halfD, 0, -1, f.halfD * 2],
    ];
    for (const [sx, sz, dx, dz, length] of sides) {
      // outward normal of a counter-clockwise walk in local space
      const nx = dz;
      const nz = -dx;
      for (let t = STEP * 0.5; t < length; t += STEP) {
        const lx0 = sx + dx * t;
        const lz0 = sz + dz * t;
        const [wx0, wz0] = toWorld(lx0, lz0);
        if (noise2(wx0 / 9 + 1.7, wz0 / 9 - 4.3, scope.seed + 0x5b3) < 0.5) continue;
        if (hashAt(wx0, wz0, 101) > MEADOW_BUSH_WALL_RATE) continue;
        const out = 1.35 + hashAt(wx0, wz0, 102) * 0.7;
        const [x, z] = toWorld(lx0 + nx * out, lz0 + nz * out);
        const extra = hashAt(wx0, wz0, 103) < 0.55 ? 1 : 0;
        // the side's direction in world axes (toWorld is a rotation)
        const tx = dx * cos + dz * sin;
        const tz = -dx * sin + dz * cos;
        placer.cluster(x, z, WALL_KINDS, extra, 1.5, 'wall', 110, tx, tz);
      }
    }
  }
}

function placeTrees(placer: BushPlacer, scope: MeadowScope): void {
  for (const tree of meadowScopeDecorations(scope).trees) {
    if (hashAt(tree.x, tree.z, 121) > MEADOW_BUSH_TREE_RATE) continue;
    const trunk = tree.scale * MEADOW_TRUNK_RADIUS_PER_SCALE;
    const count = 1 + (hashAt(tree.x, tree.z, 122) < 0.4 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const a = hashAt(tree.x, tree.z, 123 + i) * Math.PI * 2;
      const d = trunk + 0.9 + hashAt(tree.z, tree.x, 125 + i) * 0.8;
      const x = tree.x + Math.cos(a) * d;
      const z = tree.z + Math.sin(a) * d;
      const kind = pickKind(TREE_KINDS, hashAt(x, z, 127));
      placer.place(x, z, kind, lerp(MEADOW_BUSH_MEMBER_SCALE, hashAt(x, z, 128)), 'tree');
    }
  }
}

const placementCache = new WeakMap<MeadowScope, readonly MeadowBushPlacement[]>();
const NONE: readonly MeadowBushPlacement[] = [];

/** Every clustered bush of the meadow scope, with the site that grew it. Empty
 *  outside the built-in world (no scope) and when the maker owns the scatter
 *  (decorationsMode 'empty'). */
export function meadowBushPlacements(
  seed: number,
  content: WorldContent = getActiveWorldContent(),
): readonly MeadowBushPlacement[] {
  if (content.decorationsMode === 'empty') return NONE;
  const scope = meadowScopeFor(seed, content);
  if (!scope) return NONE;
  const cached = placementCache.get(scope);
  if (cached) return cached;
  const townExclusions = eastbrookGrassExclusions(
    content.props.buildings,
    true,
    content.services?.noticeboards ?? [],
  );
  const placer = new BushPlacer(scope, content, townExclusions);
  // walls and rocks first: they are the scarcer sites, so the verge walk
  // spaces itself around them rather than the other way round
  placeWalls(placer, scope, content, townExclusions);
  placeRocks(placer, scope);
  placeVerges(placer, scope);
  placeTrees(placer, scope);
  const spots = placer.spots;
  placementCache.set(scope, spots);
  return spots;
}

/** The clustered bushes as plain dressing spots (kind, position, scale). */
export function meadowBushSpots(
  seed: number,
  content: WorldContent = getActiveWorldContent(),
): readonly MeadowBushSpot[] {
  return meadowBushPlacements(seed, content);
}
