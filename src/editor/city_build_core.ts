// City Build pure core: grid/rotation snapping, wall-run piece generation,
// prefab rebase/stamp math, and small helpers the City Build panel and app
// wiring share. DOM-free and deterministic so Vitest drives it directly
// (tests/editor_city_build_core.test.ts).

import type {
  AuthoredCollisionRamp,
  MapHitbox,
  MapPlacement,
  RoadDef,
  WallRunDef,
} from '../sim/map_doc';

// ---------------------------------------------------------------------------
// Build settings (the persistent build bar)
// ---------------------------------------------------------------------------

export interface CityBuildSettings {
  // Yards between grid lines; 0 disables positional snapping.
  gridSize: number;
  // Rotation snap step in degrees for kit placement and prefab stamps.
  rotSnapDeg: number;
  // Uniform scale applied to kit pieces. The engine normalizes every GLB to
  // about 2.2yd, which reads toy-sized for buildings; 3 restores a life-size
  // feel (a wall segment stands taller than the player).
  kitScale: number;
  // Snap kit pieces to their OWN footprint pitch instead of the world grid so
  // floor tiles and modules butt together edge to edge like blocks.
  tileSnap: boolean;
}

export const CITY_GRID_SIZES: readonly number[] = [0, 0.25, 0.5, 1, 2, 4];
export const CITY_ROT_SNAPS: readonly number[] = [15, 30, 45, 90];

export const DEFAULT_CITY_SETTINGS: CityBuildSettings = {
  gridSize: 1,
  rotSnapDeg: 45,
  kitScale: 3,
  tileSnap: true,
};

export function sanitizeCitySettings(v: unknown): CityBuildSettings {
  const out = { ...DEFAULT_CITY_SETTINGS };
  if (v && typeof v === 'object') {
    const s = v as Record<string, unknown>;
    if (typeof s.gridSize === 'number' && Number.isFinite(s.gridSize) && s.gridSize >= 0) {
      out.gridSize = Math.min(s.gridSize, 16);
    }
    if (typeof s.rotSnapDeg === 'number' && Number.isFinite(s.rotSnapDeg) && s.rotSnapDeg > 0) {
      out.rotSnapDeg = Math.min(Math.max(s.rotSnapDeg, 1), 180);
    }
    if (typeof s.kitScale === 'number' && Number.isFinite(s.kitScale) && s.kitScale > 0) {
      out.kitScale = Math.min(Math.max(s.kitScale, 0.1), 20);
    }
    if (typeof s.tileSnap === 'boolean') out.tileSnap = s.tileSnap;
  }
  return out;
}

export function snapCoord(v: number, gridSize: number): number {
  if (!(gridSize > 0)) return v;
  const snapped = Math.round(v / gridSize) * gridSize;
  return snapped === 0 ? 0 : snapped; // normalize -0
}

export function snapPoint(p: { x: number; z: number }, gridSize: number): { x: number; z: number } {
  return { x: snapCoord(p.x, gridSize), z: snapCoord(p.z, gridSize) };
}

export function snapAngleRad(rad: number, stepDeg: number): number {
  if (!(stepDeg > 0)) return rad;
  const step = (stepDeg * Math.PI) / 180;
  return Math.round(rad / step) * step;
}

export interface CityGridLayout {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  xLines: number[];
  zLines: number[];
  majorEvery: number;
}

/**
 * A cursor-centered world grid that stays useful at every snap size without
 * growing into an unbounded line mesh. The center moves in eight-cell chunks
 * so ordinary pointer movement does not rebuild the overlay every frame.
 */
export function cityGridLayout(
  center: { x: number; z: number },
  gridSize: number,
): CityGridLayout | null {
  if (!(gridSize > 0) || !Number.isFinite(gridSize)) return null;
  const spacing = Math.min(16, Math.max(0.05, gridSize));
  const radius = Math.min(48, Math.max(spacing * 20, Math.min(10, spacing * 40)));
  const chunk = spacing * 8;
  const cx = snapCoord(center.x, chunk);
  const cz = snapCoord(center.z, chunk);
  const minX = Math.ceil((cx - radius) / spacing) * spacing;
  const maxX = Math.floor((cx + radius) / spacing) * spacing;
  const minZ = Math.ceil((cz - radius) / spacing) * spacing;
  const maxZ = Math.floor((cz + radius) / spacing) * spacing;
  const xLines: number[] = [];
  const zLines: number[] = [];
  for (let x = minX; x <= maxX + spacing * 0.25 && xLines.length < 81; x += spacing) {
    xLines.push(snapCoord(x, spacing));
  }
  for (let z = minZ; z <= maxZ + spacing * 0.25 && zLines.length < 81; z += spacing) {
    zLines.push(snapCoord(z, spacing));
  }
  return {
    minX: xLines[0] ?? cx,
    maxX: xLines[xLines.length - 1] ?? cx,
    minZ: zLines[0] ?? cz,
    maxZ: zLines[zLines.length - 1] ?? cz,
    xLines,
    zLines,
    majorEvery: 5,
  };
}

export function pathHasNode(
  points: readonly { x: number; z: number }[],
  point: { x: number; z: number },
  tolerance = 0.01,
): boolean {
  const radius = Math.max(0.001, tolerance);
  const radiusSq = radius * radius;
  return points.some((candidate) => {
    const dx = candidate.x - point.x;
    const dz = candidate.z - point.z;
    return dx * dx + dz * dz <= radiusSq;
  });
}

export function withoutLastPathPoint<T>(points: readonly T[]): T[] {
  return points.length > 0 ? points.slice(0, -1) : [];
}

// The world-yard center-to-center pitch of a kit piece at the given rotation:
// snapping centers to multiples of this pitch makes adjacent pieces butt
// together exactly. Yaw rotates the footprint, so the axis-aligned pitch is
// the rotated bounds (at 90-degree steps this simply swaps X and Z).
export function rotatedPitch(
  footprint: { sizeX: number; sizeZ: number },
  scale: number,
  rotY: number,
): { px: number; pz: number } {
  const c = Math.abs(Math.cos(rotY));
  const s = Math.abs(Math.sin(rotY));
  return {
    px: Math.max(0.05, (footprint.sizeX * c + footprint.sizeZ * s) * scale),
    pz: Math.max(0.05, (footprint.sizeX * s + footprint.sizeZ * c) * scale),
  };
}

// Snap a kit piece's center onto its own footprint lattice ("connect tiles"):
// every snapped center sits on a multiple of the pitch, so two pieces dropped
// in neighboring cells share an edge with no gap and no overlap.
export function tileSnapPoint(
  p: { x: number; z: number },
  footprint: { sizeX: number; sizeZ: number },
  scale: number,
  rotY: number,
): { x: number; z: number } {
  const { px, pz } = rotatedPitch(footprint, scale, rotY);
  return { x: snapCoord(p.x, px), z: snapCoord(p.z, pz) };
}

// ---------------------------------------------------------------------------
// Deterministic ids for city-owned records (no randomness: derived from the
// existing id set so save/undo replay stays stable).
// ---------------------------------------------------------------------------

export function nextCityId(prefix: string, existing: Iterable<string>): string {
  let max = 0;
  const re = new RegExp(`^${prefix}_(\\d+)$`);
  for (const id of existing) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}_${max + 1}`;
}

// ---------------------------------------------------------------------------
// Wall runs: fit segment pieces exactly along each polyline edge.
// ---------------------------------------------------------------------------

// Wall style presets built from catalogue kits. labelKey is an editor.city.*
// translation key the panel resolves; the core only carries data.
export interface AssetFootprint {
  sizeX: number;
  sizeZ: number;
  // Model height; absent when a caller only ever needed the ground footprint.
  sizeY?: number;
}

// The walk-through castle wall tower (public/models/city/wall_tower.glb,
// generated by scripts/gen_wall_tower.mjs). WALL_TOWER_SRC mirrors the model's
// source-yard blueprint (asset_scale.ts pins normalization so scale 1 = these
// yards): a solid shaft up to the arcade floor at deckY, six open pillar bays
// the rampart deck walks straight through, and an overhanging roof.
export const WALL_TOWER_ASSET = 'city/wall_tower';
export const WALL_TOWER_SRC = {
  height: 9.6,
  deckY: 4.5, // arcade floor, wallTowerFit aligns this to the wall walk height
  deckHalf: 2.05,
  shaftHalf: 1.75,
  pillar: { r: 1.7, half: 0.17, y0: 4.5, y1: 7.2 },
  lintel: { y0: 7.2, y1: 7.5, half: 1.88 },
  roof: { y0: 7.5, y1: 9.6, half: 2.5 },
} as const;

/**
 * Fit the walk-through tower to a wall run: scale so the arcade floor lands
 * exactly on the wall's walk height, plus model-unit collision (solid shaft,
 * six pillars, roof slab, the bays between stay open so players walk through
 * the tower top) and the arcade-floor walk deck.
 */
export function wallTowerFit(wallTopWorld: number): {
  scale: number;
  hitboxes: MapHitbox[];
  ramps: AuthoredCollisionRamp[];
} {
  const T = WALL_TOWER_SRC;
  const scale = Math.max(0.4, wallTopWorld / T.deckY);
  const hitboxes: MapHitbox[] = [
    // Solid shaft (ground to arcade floor).
    { x: 0, y: T.deckY / 2, z: 0, hx: T.shaftHalf, hy: T.deckY / 2, hz: T.shaftHalf },
    // Roof slab (also keeps the cone from swallowing arrows/players).
    {
      x: 0,
      y: (T.roof.y0 + T.roof.y1) / 2,
      z: 0,
      hx: T.lintel.half,
      hy: (T.roof.y1 - T.roof.y0) / 2,
      hz: T.lintel.half,
    },
  ];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k + Math.PI / 6; // matches gen_wall_tower.mjs hexPoint
    hitboxes.push({
      x: Math.cos(a) * T.pillar.r,
      y: (T.pillar.y0 + T.lintel.y1) / 2,
      z: Math.sin(a) * T.pillar.r,
      hx: T.pillar.half,
      hy: (T.lintel.y1 - T.pillar.y0) / 2,
      hz: T.pillar.half,
    });
  }
  const ramps: AuthoredCollisionRamp[] = [
    { x: 0, z: 0, hx: T.deckHalf, hz: T.deckHalf, y0: T.deckY, y1: T.deckY },
  ];
  return { scale, hitboxes, ramps };
}

export interface WallStyle {
  id: string;
  labelKey: string;
  segmentAssetId: string;
  postAssetId?: string;
  // Stairs asset for the "stairs up" option. Must ascend toward model -Z
  // (the dungeon stairs family; see generateWallStairs).
  stairAssetId?: string;
  // Reliable normalized bounds used when an asset is still streaming or its
  // GLB cannot be measured. This keeps every preset buildable.
  segmentFootprint: AssetFootprint;
  postFootprint?: AssetFootprint;
  stairFootprint?: AssetFootprint;
}

export const WALL_STYLES: readonly WallStyle[] = [
  {
    id: 'castle',
    labelKey: 'editor.city.styleCastle',
    segmentAssetId: 'medieval_village_v2/buildings/CastleWall_01',
    postAssetId: WALL_TOWER_ASSET,
    stairAssetId: 'dungeon/stairs_long',
    segmentFootprint: { sizeX: 1.1, sizeZ: 0.133, sizeY: 2.2 },
    postFootprint: { sizeX: 5, sizeZ: 5, sizeY: 9.6 },
    stairFootprint: { sizeX: 1.5, sizeZ: 2.25, sizeY: 1.1 },
  },
  {
    id: 'stone',
    labelKey: 'editor.city.styleStone',
    segmentAssetId: 'dungeon/wall',
    postAssetId: 'dungeon/pillar',
    stairAssetId: 'dungeon/stairs_long',
    segmentFootprint: { sizeX: 2.2, sizeZ: 0.45, sizeY: 2.2 },
    postFootprint: { sizeX: 0.5, sizeZ: 0.5, sizeY: 2.2 },
    stairFootprint: { sizeX: 1.5, sizeZ: 2.25, sizeY: 1.1 },
  },
  {
    id: 'fence-wood',
    labelKey: 'editor.city.styleWoodFence',
    segmentAssetId: 'biome/city_fence_wood',
    postAssetId: 'dungeon/fence_pillar',
    segmentFootprint: { sizeX: 2.2, sizeZ: 0.23, sizeY: 1.29 },
    postFootprint: { sizeX: 0.45, sizeZ: 0.45, sizeY: 2.2 },
  },
  {
    id: 'fence-metal',
    labelKey: 'editor.city.styleMetalFence',
    segmentAssetId: 'biome/city_fence_metal',
    postAssetId: 'dungeon/fence_pillar',
    segmentFootprint: { sizeX: 1.495, sizeZ: 0.12, sizeY: 2.2 },
    postFootprint: { sizeX: 0.45, sizeZ: 0.45, sizeY: 2.2 },
  },
  {
    id: 'fence-castle',
    labelKey: 'editor.city.styleCastleFence',
    segmentAssetId: 'medieval_village_v2/buildings/CastleFence_01',
    segmentFootprint: { sizeX: 2.2, sizeZ: 0.44, sizeY: 1.848 },
  },
  {
    id: 'hex',
    labelKey: 'editor.city.styleHexWall',
    segmentAssetId: 'biome/hex_wall',
    postAssetId: 'biome/hex_tower',
    stairAssetId: 'dungeon/stairs_long',
    segmentFootprint: { sizeX: 2.2, sizeZ: 0.88, sizeY: 1.21 },
    postFootprint: { sizeX: 1.457, sizeZ: 1.682, sizeY: 2.2 },
    stairFootprint: { sizeX: 1.5, sizeZ: 2.25, sizeY: 1.1 },
  },
];

export function wallStyleById(id: string): WallStyle {
  return WALL_STYLES.find((s) => s.id === id) ?? WALL_STYLES[0];
}

export function wallFootprintOrFallback(
  style: WallStyle,
  assetId: string,
  measured: AssetFootprint | null,
): AssetFootprint | null {
  if (
    measured &&
    measured.sizeX > 0.01 &&
    measured.sizeZ > 0.01 &&
    (measured.sizeY === undefined || measured.sizeY > 0.01)
  ) {
    return { ...measured };
  }
  if (assetId === style.segmentAssetId) return { ...style.segmentFootprint };
  if (assetId === style.postAssetId && style.postFootprint) return { ...style.postFootprint };
  if (assetId === style.stairAssetId && style.stairFootprint) return { ...style.stairFootprint };
  return null;
}

export interface WallPiece {
  kind: 'segment' | 'post' | 'stair';
  assetId: string;
  x: number;
  z: number;
  rotY: number;
  scale: number;
  // Stretch applied along the piece's run axis so segments meet exactly.
  stretchAxis?: 'x' | 'z';
  stretch?: number;
  // Vertical multiplier (stairs match the wall's walk height with it).
  scaleY?: number;
  // Authored walkable decks carried straight onto the placement (stairs).
  ramps?: AuthoredCollisionRamp[];
}

// rotY that aligns the asset's run axis with the edge direction (dx, dz).
// three.js rotateY(a) maps local +X to (cos a, -sin a) and local +Z to
// (sin a, cos a) in world (x, z).
export function headingForEdge(dx: number, dz: number, runAxis: 'x' | 'z'): number {
  return runAxis === 'x' ? Math.atan2(-dz, dx) : Math.atan2(dx, dz);
}

// Generate the fitted pieces for a wall run. Segments are placed midpoint by
// midpoint along each edge, uniformly scaled by def.scale and stretched along
// their run axis so each edge is closed exactly. Posts land on every corner
// vertex, plus every def.postEvery-th internal segment boundary when set.
export function generateWallPieces(
  def: WallRunDef,
  segment: AssetFootprint,
  post?: AssetFootprint,
): WallPiece[] {
  const pts = def.points;
  if (pts.length < 2) return [];
  const pieces: WallPiece[] = [];
  const runAxis: 'x' | 'z' = segment.sizeX >= segment.sizeZ ? 'x' : 'z';
  const baseLen = Math.max(segment.sizeX, segment.sizeZ) * def.scale;
  if (!(baseLen > 0.01)) return [];
  const edges: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) edges.push([i, i + 1]);
  if (def.closed && pts.length > 2) edges.push([pts.length - 1, 0]);
  for (const [ai, bi] of edges) {
    const a = pts[ai];
    const b = pts[bi];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const rotY = headingForEdge(dx, dz, runAxis);
    // Piece count: of the two candidate counts around len/baseLen, take the
    // one whose stretch RATIO is closest to 1 (log distance, so 0.8x squash
    // and 1.25x stretch weigh the same). Crenellations and window cutouts
    // distort least this way.
    const lower = Math.max(1, Math.floor(len / baseLen));
    const n =
      Math.abs(Math.log(len / (lower * baseLen))) <=
      Math.abs(Math.log(len / ((lower + 1) * baseLen)))
        ? lower
        : lower + 1;
    const pieceLen = len / n;
    const stretch = pieceLen / baseLen;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      pieces.push({
        kind: 'segment',
        assetId: def.segmentAssetId,
        x: a.x + dx * t,
        z: a.z + dz * t,
        rotY,
        scale: def.scale,
        stretchAxis: runAxis,
        stretch,
      });
      if (def.postAssetId && post && def.postEvery > 0 && k > 0 && k % def.postEvery === 0) {
        const bt = k / n;
        pieces.push({
          kind: 'post',
          assetId: def.postAssetId,
          x: a.x + dx * bt,
          z: a.z + dz * bt,
          rotY,
          scale: def.scale,
        });
      }
    }
  }
  if (def.postAssetId && post) {
    const cornerCount = def.closed ? pts.length : pts.length;
    for (let i = 0; i < cornerCount; i++) {
      // Open runs keep posts on both endpoints; closed runs skip nothing (the
      // loop's duplicate seam is a single vertex list, no repeated point).
      pieces.push({
        kind: 'post',
        assetId: def.postAssetId,
        x: pts[i].x,
        z: pts[i].z,
        rotY: 0,
        scale: def.scale,
      });
    }
  }
  return pieces;
}

// ---------------------------------------------------------------------------
// Walkable rampart tops + stairs
// ---------------------------------------------------------------------------

// The walk height of a wall piece in model units: the top of its collision
// boxes (fitted box or bake), else the model's bounding height.
export function wallTopModelY(hitboxes: readonly MapHitbox[] | undefined, sizeY: number): number {
  let top = 0;
  for (const b of hitboxes ?? []) top = Math.max(top, b.y + b.hy);
  return top > 0.05 ? top : Math.max(0.1, sizeY);
}

// Flat walk decks covering a wall piece's top, one per collision box (model
// units; the placement ramps channel scales and rotates them at runtime).
// With no boxes, one deck spans the whole footprint.
export function wallTopRamps(
  hitboxes: readonly MapHitbox[] | undefined,
  footprint: AssetFootprint,
): AuthoredCollisionRamp[] {
  const top = wallTopModelY(hitboxes, footprint.sizeY ?? 2.2);
  // Patrol comfort: a fitted box can hug a thin parapet, so the deck is never
  // narrower than the piece's own depth (nor a 0.12-model-unit floor).
  const minHz = Math.max(0.12, footprint.sizeZ * 0.45);
  if (hitboxes && hitboxes.length > 0) {
    return hitboxes.map((b) => {
      const ramp: AuthoredCollisionRamp = {
        x: b.x,
        z: b.z,
        hx: b.hx,
        hz: Math.max(b.hz, minHz),
        y0: top,
        y1: top,
      };
      if (b.ry) ramp.ry = b.ry;
      return ramp;
    });
  }
  return [
    {
      x: 0,
      z: 0,
      hx: footprint.sizeX / 2,
      hz: Math.max(footprint.sizeZ / 2, minHz),
      y0: top,
      y1: top,
    },
  ];
}

// Stairs pieces climbing from the ground to the wall's walk deck. The stair
// asset ascends toward its model -Z (the dungeon stairs family bake), so the
// placement yaw points -Z INTO the wall and the authored deck rises along the
// same direction (deck-local +X mapped onto model -Z via ry = pi/2). Vertical
// scaleY stretches the stair so its top lands exactly at the walk height.
export function generateWallStairs(
  def: WallRunDef,
  stair: AssetFootprint,
  wallTopModel: number,
  // World-yard clearance pushing open-end stairs outward past the corner
  // tower's solid shaft (the arcade deck overhangs the shaft, so a stair
  // topping out at the shaft face still meets the walkable floor).
  endClearance = 0,
): WallPiece[] {
  const pts = def.points;
  if (!def.stairAssetId || pts.length < 2) return [];
  const stairH = Math.max(0.1, stair.sizeY ?? 2.2);
  const wallTopWorld = wallTopModel * def.scale * (def.heightScale ?? 1);
  const scaleY = wallTopWorld / (stairH * def.scale);
  const lenWorld = stair.sizeZ * def.scale;
  const deck: AuthoredCollisionRamp = {
    x: 0,
    z: 0,
    hx: stair.sizeZ / 2,
    hz: stair.sizeX / 2,
    ry: Math.PI / 2,
    y0: 0,
    y1: stairH,
  };
  const make = (
    end: { x: number; z: number },
    into: { x: number; z: number },
    clearance = 0,
  ): WallPiece => ({
    kind: 'stair',
    assetId: def.stairAssetId as string,
    x: end.x - into.x * (clearance + lenWorld / 2),
    z: end.z - into.z * (clearance + lenWorld / 2),
    rotY: Math.atan2(-into.x, -into.z),
    scale: def.scale,
    scaleY,
    ramps: [{ ...deck }],
  });
  const unit = (ax: number, az: number, bx: number, bz: number): { x: number; z: number } => {
    const d = Math.hypot(bx - ax, bz - az) || 1;
    return { x: (bx - ax) / d, z: (bz - az) / d };
  };
  if (def.closed && pts.length > 2) {
    // One stair beside the first edge's midpoint, on the edge's left side
    // (for a loop drawn counter-clockwise that is the courtyard side, the
    // natural place for rampart stairs).
    const a = pts[0];
    const b = pts[1];
    const dir = unit(a.x, a.z, b.x, b.z);
    const side = { x: -dir.z, z: dir.x };
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    return [make(mid, { x: -side.x, z: -side.z })];
  }
  const first = pts[0];
  const second = pts[1];
  const last = pts[pts.length - 1];
  const beforeLast = pts[pts.length - 2];
  return [
    make(first, unit(first.x, first.z, second.x, second.z), endClearance),
    make(last, unit(last.x, last.z, beforeLast.x, beforeLast.z), endClearance),
  ];
}

// Convert generated pieces into ordinary map placements tagged with the run id.
export function wallPiecesToPlacements(def: WallRunDef, pieces: WallPiece[]): MapPlacement[] {
  return pieces.map((piece) => {
    const p: MapPlacement = {
      assetId: piece.assetId,
      x: piece.x,
      z: piece.z,
      rotY: piece.rotY,
      scale: piece.scale,
      collide: true,
      cityId: def.id,
    };
    const height = def.heightScale ?? 1;
    const thickness = def.thicknessScale ?? 1;
    if (piece.kind !== 'stair') {
      if (Math.abs(height - 1) > 0.001) p.scaleY = height;
      if (piece.kind === 'post' && Math.abs(thickness - 1) > 0.001) {
        p.scaleX = thickness;
        p.scaleZ = thickness;
      } else if (piece.kind === 'segment' && Math.abs(thickness - 1) > 0.001) {
        if (piece.stretchAxis === 'x') p.scaleZ = thickness;
        else p.scaleX = thickness;
      }
    }
    if (piece.stretchAxis && piece.stretch && Math.abs(piece.stretch - 1) > 0.001) {
      if (piece.stretchAxis === 'x') p.scaleX = piece.stretch;
      else p.scaleZ = piece.stretch;
    }
    if (piece.scaleY && Math.abs(piece.scaleY - 1) > 0.001) {
      (p as { scaleY?: number }).scaleY = piece.scaleY;
    }
    if (piece.ramps && piece.ramps.length > 0) {
      p.ramps = piece.ramps.map((r) => ({ ...r }));
      // Ramp decks replace blocking outright (colliders skip boxed blocking
      // when decks exist), so stairs carry no boxes at all.
      p.collisionMode = 'baked';
    }
    return p;
  });
}

// Indices of every placement derived from the given city record.
export function cityPlacementIndices(
  placements: readonly MapPlacement[],
  cityId: string,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < placements.length; i++) {
    if (placements[i].cityId === cityId) out.push(i);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Roads
// ---------------------------------------------------------------------------

// The road polylines world-content assembly appends to the legacy roads.
export function roadDefPolylines(
  defs: readonly RoadDef[] | undefined,
): { x: number; z: number }[][] {
  if (!defs || defs.length === 0) return [];
  return defs.map((d) => d.points.map((p) => ({ x: p.x, z: p.z })));
}

// Combined roads array (legacy + authored) for world content and previews.
export function combinedRoads(
  legacy: readonly (readonly { x: number; z: number }[])[] | undefined,
  defs: readonly RoadDef[] | undefined,
): { x: number; z: number }[][] {
  const out: { x: number; z: number }[][] = [];
  for (const road of legacy ?? []) out.push(road.map((p) => ({ x: p.x, z: p.z })));
  for (const road of roadDefPolylines(defs)) out.push(road);
  return out;
}

// Axis-aligned bounds of a polyline plus a margin, for terrain rebuilds.
export function polylineBounds(
  points: readonly { x: number; z: number }[],
  margin: number,
): { minX: number; minZ: number; maxX: number; maxZ: number } | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX: minX - margin, minZ: minZ - margin, maxX: maxX + margin, maxZ: maxZ + margin };
}

// ---------------------------------------------------------------------------
// Prefabs: named groups of placements stored relative to their own anchor.
// ---------------------------------------------------------------------------

export interface CityPrefab {
  name: string;
  items: MapPlacement[]; // x/z relative to the prefab anchor
}

// Rebase copied placements around their centroid so a stamp positions the
// group by its middle. Returns deep clones; the inputs are never mutated.
export function rebaseAsPrefab(name: string, items: readonly MapPlacement[]): CityPrefab | null {
  if (items.length === 0) return null;
  let cx = 0;
  let cz = 0;
  for (const p of items) {
    cx += p.x;
    cz += p.z;
  }
  cx /= items.length;
  cz /= items.length;
  const clones = items.map((p) => {
    const c = JSON.parse(JSON.stringify(p)) as MapPlacement;
    c.x = p.x - cx;
    c.z = p.z - cz;
    return c;
  });
  return { name, items: clones };
}

// Materialize a prefab at a world point (already snapped by the caller).
export function stampPrefab(prefab: CityPrefab, origin: { x: number; z: number }): MapPlacement[] {
  return prefab.items.map((p) => {
    const c = JSON.parse(JSON.stringify(p)) as MapPlacement;
    c.x = p.x + origin.x;
    c.z = p.z + origin.z;
    delete c.cityId;
    delete c.uid;
    return c;
  });
}

export const MAX_CITY_PREFABS = 60;

export function sanitizeCityPrefabs(v: unknown): CityPrefab[] {
  if (!Array.isArray(v)) return [];
  const out: CityPrefab[] = [];
  for (const raw of v.slice(0, MAX_CITY_PREFABS)) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;
    if (typeof p.name !== 'string' || !p.name || p.name.length > 60) continue;
    if (!Array.isArray(p.items) || p.items.length === 0) continue;
    const items: MapPlacement[] = [];
    for (const item of p.items.slice(0, 400)) {
      const it = item as Record<string, unknown> | null;
      if (!it || typeof it !== 'object') continue;
      if (typeof it.assetId !== 'string') continue;
      if (typeof it.x !== 'number' || !Number.isFinite(it.x)) continue;
      if (typeof it.z !== 'number' || !Number.isFinite(it.z)) continue;
      items.push(it as unknown as MapPlacement);
    }
    if (items.length > 0) out.push({ name: p.name, items });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ghost placement feasibility (green vs red)
// ---------------------------------------------------------------------------

// Cheap overlap test for the kit ghost: blocked when the snapped point sits
// closer to an existing colliding placement than the combined clearance.
export function ghostBlocked(
  placements: readonly MapPlacement[],
  x: number,
  z: number,
  clearance: number,
): boolean {
  const r = Math.max(0.2, clearance);
  for (const p of placements) {
    if (!p.collide) continue;
    const other = Math.max(0.4, (p.collideRadius ?? p.scale * 0.5) * 0.8);
    const dx = p.x - x;
    const dz = p.z - z;
    if (dx * dx + dz * dz < (r + other) * (r + other) * 0.25) return true;
  }
  return false;
}
