// Pure building gestures. A whole gesture is accepted or refused before any
// placements are allocated; callers apply the result as one undo operation.

import { type BuildingDef, type BuildingMembership, sanitizeBuilding } from '../sim/building';
import {
  type AuthoredCollisionRamp,
  MAX_AXIS_SCALE,
  MAX_PLACEMENTS,
  MAX_WORLD_COORD,
  type MapHitbox,
  type MapPlacement,
  MIN_AXIS_SCALE,
  MODEL_ASSET_ID,
} from '../sim/map_doc';
import { headingForEdge, snapPoint } from './city_build_core';
import { cmBox } from './cm_mesh';

export const MAX_BUILDING_GESTURE_PLACEMENTS = 256;
export const DEFAULT_BUILDING_WALL_THICKNESS = 0.3;
export const BUILDING_FLOOR_THICKNESS = 0.2;
const FLOOR_TILE_SIZE = 100;
const MIN_SPAN = 0.05;

export interface BuildingPoint {
  x: number;
  z: number;
}

export type BuildingPlacement = MapPlacement & { building: BuildingMembership };

export interface BuildingWallAsset {
  assetId: string;
  footprint: { sizeX: number; sizeY: number; sizeZ: number };
  scale: number;
  /** Facing flip, rounded to a half turn so the measured run axis still fits. */
  rotY?: number;
  hitboxes?: MapHitbox[];
  ramps?: AuthoredCollisionRamp[];
}

export interface BuildingDragOptions {
  mode: 'wall' | 'room' | 'floor';
  start: BuildingPoint;
  end: BuildingPoint;
  building: BuildingDef;
  level: number;
  gridSize: number;
  diagonal?: boolean;
  thickness?: number;
  wall?: BuildingWallAsset;
  existingPlacementCount: number;
}

export interface BuildingDragPlan {
  placements: BuildingPlacement[];
  corners: BuildingPoint[];
  error?: 'invalid' | 'empty' | 'capacity';
}

export function levelY(building: BuildingDef, level: number): number {
  return building.baseY + level * building.floorHeight;
}

/** Viewing lower levels hides only this building's higher placements. */
export function buildingPlacementVisible(
  membership: BuildingMembership | undefined,
  activeBuildingId: string | undefined,
  activeLevel: number,
  hideAbove = true,
): boolean {
  return (
    !hideAbove ||
    !membership ||
    membership.id !== activeBuildingId ||
    membership.level <= activeLevel
  );
}

/** Stable corner order regardless of which diagonal the pointer draws. */
export function roomCorners(
  start: BuildingPoint,
  end: BuildingPoint,
  gridSize: number,
): BuildingPoint[] {
  const a = snapPoint(start, gridSize);
  const b = snapPoint(end, gridSize);
  return [
    { x: Math.min(a.x, b.x), z: Math.min(a.z, b.z) },
    { x: Math.max(a.x, b.x), z: Math.min(a.z, b.z) },
    { x: Math.max(a.x, b.x), z: Math.max(a.z, b.z) },
    { x: Math.min(a.x, b.x), z: Math.max(a.z, b.z) },
  ];
}

function validPoint(point: BuildingPoint): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.z) &&
    Math.abs(point.x) <= MAX_WORLD_COORD &&
    Math.abs(point.z) <= MAX_WORLD_COORD
  );
}

function validOptions(options: BuildingDragOptions): boolean {
  const { building, level, gridSize, wall, thickness, existingPlacementCount } = options;
  const safe = sanitizeBuilding(building);
  if (
    !safe ||
    safe.baseY !== building.baseY ||
    safe.floorHeight !== building.floorHeight ||
    safe.levels !== building.levels ||
    !Number.isInteger(level) ||
    level < 0 ||
    level >= building.levels ||
    !validPoint(options.start) ||
    !validPoint(options.end) ||
    !Number.isFinite(gridSize) ||
    (gridSize !== 0 && (gridSize < MIN_SPAN || gridSize > 16)) ||
    (thickness !== undefined &&
      (!Number.isFinite(thickness) || thickness < 0.1 || thickness > 3)) ||
    !Number.isInteger(existingPlacementCount) ||
    existingPlacementCount < 0 ||
    existingPlacementCount > MAX_PLACEMENTS
  ) {
    return false;
  }
  if (!wall || options.mode === 'floor') return true;
  const { footprint, scale } = wall;
  return (
    typeof wall.assetId === 'string' &&
    wall.assetId.length > 0 &&
    wall.assetId.length <= 128 &&
    [footprint.sizeX, footprint.sizeY, footprint.sizeZ].every(
      (size) => Number.isFinite(size) && size > 0 && size <= 200,
    ) &&
    Number.isFinite(scale) &&
    scale >= MIN_AXIS_SCALE &&
    scale <= MAX_AXIS_SCALE &&
    (wall.rotY === undefined || Number.isFinite(wall.rotY)) &&
    building.floorHeight / (footprint.sizeY * scale) >= MIN_AXIS_SCALE &&
    building.floorHeight / (footprint.sizeY * scale) <= MAX_AXIS_SCALE
  );
}

interface EdgePlan {
  start: BuildingPoint;
  end: BuildingPoint;
  length: number;
  count: number;
}

/** Match the existing wall-run fit rule, but count before entering any piece loop. */
function edgePlan(start: BuildingPoint, end: BuildingPoint, pitch: number): EdgePlan {
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  const lower = Math.max(1, Math.floor(length / pitch));
  const count =
    Math.abs(Math.log(length / (lower * pitch))) <=
    Math.abs(Math.log(length / ((lower + 1) * pitch)))
      ? lower
      : lower + 1;
  return { start, end, length, count };
}

function placementBase(
  options: BuildingDragOptions,
  point: BuildingPoint,
  kind: BuildingMembership['kind'],
): BuildingPlacement {
  return {
    assetId: MODEL_ASSET_ID,
    x: point.x,
    z: point.z,
    rotY: 0,
    scale: 1,
    collide: true,
    collisionMode: 'baked',
    detached: true,
    groundY: levelY(options.building, options.level),
    y: 0,
    building: { id: options.building.id, level: options.level, kind },
  };
}

function wallPlacements(options: BuildingDragOptions, edges: EdgePlan[]): BuildingPlacement[] {
  const result: BuildingPlacement[] = [];
  const { wall, building } = options;
  const thickness = options.thickness ?? DEFAULT_BUILDING_WALL_THICKNESS;
  for (const edge of edges) {
    const dx = edge.end.x - edge.start.x;
    const dz = edge.end.z - edge.start.z;
    const pieceLength = edge.length / edge.count;
    const axis = wall && wall.footprint.sizeZ > wall.footprint.sizeX ? 'z' : 'x';
    const heading = headingForEdge(dx, dz, axis);
    for (let i = 0; i < edge.count; i++) {
      const t = (i + 0.5) / edge.count;
      const p = placementBase(
        options,
        { x: edge.start.x + t * dx, z: edge.start.z + t * dz },
        'wall',
      );
      p.rotY = heading;
      if (wall) {
        p.assetId = wall.assetId;
        if (axis === 'z') p.building.wallAxis = 'x';
        p.scale = wall.scale;
        p.scaleY = building.floorHeight / (wall.footprint.sizeY * wall.scale);
        p.rotY += (Math.round((wall.rotY ?? 0) / Math.PI) % 2) * Math.PI;
        const stretch =
          pieceLength / (wall.footprint[axis === 'x' ? 'sizeX' : 'sizeZ'] * wall.scale);
        if (axis === 'x') p.scaleX = stretch;
        else p.scaleZ = stretch;
        // Preserve doorway/window openings. The asset's own bake remains the
        // fallback; a full rectangular collision box would seal the opening.
        if (wall.hitboxes) p.hitboxes = wall.hitboxes.map((box) => ({ ...box }));
        if (wall.ramps) p.ramps = wall.ramps.map((ramp) => ({ ...ramp }));
      } else {
        const hx = pieceLength / 2;
        const hy = building.floorHeight / 2;
        const hz = thickness / 2;
        p.meshes = [cmBox(hx, hy, hz, hy)];
        p.hitboxes = [{ x: 0, y: hy, z: 0, hx, hy, hz }];
      }
      result.push(p);
    }
  }
  return result;
}

const SHARED_WALL_PRECISION = 1e8;

function sharedWallKey(p: MapPlacement): string | null {
  if (
    p.assetId !== MODEL_ASSET_ID ||
    p.building?.kind !== 'wall' ||
    !p.detached ||
    p.groundY === undefined ||
    (p.rotX ?? 0) !== 0 ||
    (p.rotZ ?? 0) !== 0 ||
    p.meshes?.length !== 1
  )
    return null;
  const mesh = p.meshes[0];
  if (mesh.ramp || mesh.verts.length !== 24 || mesh.tris.length !== 36) return null;
  const hx = Math.abs(mesh.verts[0]);
  const hz = Math.abs(mesh.verts[2]);
  const hy = Math.max(...mesh.verts.filter((_, i) => i % 3 === 1)) / 2;
  if (![hx, hy, hz].every((size) => Number.isFinite(size) && size > 0)) return null;
  // Only the untouched box primitive is symmetric under a half turn. A sculpted
  // wall or kit doorway cannot safely be removed from its bounds alone.
  const box = cmBox(hx, hy, hz, hy);
  if (
    mesh.verts.some((value, i) => Math.abs(value - box.verts[i]) > 1 / SHARED_WALL_PRECISION) ||
    mesh.tris.some((value, i) => value !== box.tris[i])
  )
    return null;
  const sx = p.scale * (p.scaleX ?? 1);
  const sy = p.scale * (p.scaleY ?? 1);
  const sz = p.scale * (p.scaleZ ?? 1);
  if (![sx, sy, sz].every((size) => Number.isFinite(size) && size > 0)) return null;
  let yaw = ((p.rotY % Math.PI) + Math.PI) % Math.PI;
  if (Math.PI - yaw < 1 / SHARED_WALL_PRECISION) yaw = 0;
  const dimensions = [p.x, p.z, p.groundY, p.y ?? 0, hx * sx, hy * sy, hz * sz, yaw];
  if (!dimensions.every(Number.isFinite)) return null;
  return JSON.stringify([
    p.building.id,
    p.building.level,
    ...dimensions.map((value) => Math.round(value * SHARED_WALL_PRECISION)),
  ]);
}

/** Keep existing shared bare walls, including their finishes, instead of z-fighting duplicates. */
export function filterExistingBuildingWalls<T extends MapPlacement>(
  placements: readonly T[],
  existing: readonly MapPlacement[],
): T[] {
  const occupied = new Set<string>();
  for (const p of existing) {
    const key = sharedWallKey(p);
    if (key !== null) occupied.add(key);
  }
  return placements.filter((p) => {
    const key = sharedWallKey(p);
    if (key === null) return true;
    if (occupied.has(key)) return false;
    occupied.add(key);
    return true;
  });
}

export function planBuildingDrag(options: BuildingDragOptions): BuildingDragPlan {
  const refuse = (
    error: BuildingDragPlan['error'],
    corners: BuildingPoint[] = [],
  ): BuildingDragPlan => ({
    placements: [],
    corners,
    error,
  });
  if (!validOptions(options)) return refuse('invalid');
  const { mode, gridSize, wall } = options;
  if (mode !== 'wall' && mode !== 'room' && mode !== 'floor') return refuse('invalid');
  const start = snapPoint(options.start, gridSize);
  const end = snapPoint(options.end, gridSize);
  if (mode === 'wall' && !options.diagonal) {
    if (Math.abs(end.x - start.x) >= Math.abs(end.z - start.z)) end.z = start.z;
    else end.x = start.x;
  }
  const corners = mode === 'wall' ? [start, end] : roomCorners(start, end, 0);
  if (corners.some((corner) => !validPoint(corner))) return refuse('invalid');
  const width = mode === 'wall' ? 0 : corners[1].x - corners[0].x;
  const depth = mode === 'wall' ? 0 : corners[2].z - corners[1].z;
  if (mode !== 'wall' && (width < MIN_SPAN || depth < MIN_SPAN)) return refuse('empty', corners);
  const pitch = wall
    ? Math.max(wall.footprint.sizeX, wall.footprint.sizeZ) * wall.scale
    : gridSize || 2;
  const edges: EdgePlan[] = [];
  if (mode === 'wall') edges.push(edgePlan(start, end, pitch));
  if (mode === 'room') {
    for (let i = 0; i < corners.length; i++) {
      edges.push(edgePlan(corners[i], corners[(i + 1) % corners.length], pitch));
    }
  }
  if (edges.some((edge) => edge.length < MIN_SPAN)) return refuse('empty', corners);
  const floorColumns = mode === 'wall' ? 0 : Math.ceil(width / FLOOR_TILE_SIZE);
  const floorRows = mode === 'wall' ? 0 : Math.ceil(depth / FLOOR_TILE_SIZE);
  const count = edges.reduce((sum, edge) => sum + edge.count, 0) + floorColumns * floorRows;
  if (
    !Number.isFinite(count) ||
    count > MAX_BUILDING_GESTURE_PLACEMENTS ||
    count > MAX_PLACEMENTS - options.existingPlacementCount
  ) {
    return refuse('capacity', corners);
  }
  if (
    wall &&
    edges.some((edge) => {
      const stretch = edge.length / (edge.count * pitch);
      return stretch < MIN_AXIS_SCALE || stretch > MAX_AXIS_SCALE;
    })
  ) {
    return refuse('invalid', corners);
  }
  const placements = wallPlacements(options, edges);
  const tileWidth = width / floorColumns;
  const tileDepth = depth / floorRows;
  for (let x = 0; x < floorColumns; x++) {
    for (let z = 0; z < floorRows; z++) {
      const p = placementBase(
        options,
        {
          x: corners[0].x + (x + 0.5) * tileWidth,
          z: corners[0].z + (z + 0.5) * tileDepth,
        },
        'floor',
      );
      const hx = tileWidth / 2;
      const hz = tileDepth / 2;
      const hy = BUILDING_FLOOR_THICKNESS / 2;
      p.meshes = [{ ...cmBox(hx, hy, hz, -hy), ramp: true }];
      p.hitboxes = [{ x: 0, y: -hy, z: 0, hx, hy, hz }];
      p.ramps = [{ x: 0, z: 0, hx, hz, y0: 0, y1: 0 }];
      placements.push(p);
    }
  }
  return { placements, corners };
}
