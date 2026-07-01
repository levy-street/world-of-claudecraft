// The Drowned Litany: irregular marsh-ruin room geometry (sim layer, no Three.js).
import type { Collider } from './colliders';
import {
  DUNGEON_END_WALL_HW,
  DUNGEON_WALL_HW,
  type DungeonLayout,
  PILLAR_COLLIDER_R,
  TOMB_HD,
  TOMB_HW,
} from './dungeon_layout';

export type LitanyModuleId =
  | 'litany_sluice'
  | 'litany_ledger'
  | 'litany_ring'
  | 'litany_baptistry'
  | 'litany_choir_loft'
  | 'litany_causeway'
  | 'litany_apse';

export type LitanyShapeProfile =
  | 'crescent'
  | 'island_cluster'
  | 'ring'
  | 'sinkhole'
  | 'fan'
  | 'y_split'
  | 'asymmetric_apse';

export interface LitanyIsland {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

export interface LitanyDressingAnchor {
  kind:
    | 'reed_cluster'
    | 'plank_bridge'
    | 'shrine_fragment'
    | 'corpse_candle'
    | 'bell_fragment'
    | 'bone_pile'
    | 'sluice_post'
    | 'root_wall'
    | 'broken_bell_frame'
    | 'dead_tree';
  x: number;
  z: number;
  rot?: number;
}

export interface LitanyWalkableShape {
  points: Array<{ x: number; z: number }>;
}

export interface LitanyHazardZone {
  x: number;
  z: number;
  r: number;
  rx?: number;
  rz?: number;
  blocksMovement?: boolean;
  tier?: 'shallow' | 'deep';
}

export interface LitanyModuleGeometry {
  moduleId: LitanyModuleId;
  profile: LitanyShapeProfile;
  bounds: { xMin: number; xMax: number; zMin: number; zMax: number };
  zMin: number;
  zMax: number;
  wallX: number;
  doorZ: number;
  dais: { x: number; z: number; r: number };
  walkable: LitanyWalkableShape[];
  hazards: LitanyHazardZone[];
  islands: LitanyIsland[];
  pillars: Array<{ x: number; z: number }>;
  stubs: Array<{ x: number; z: number; hw: number; hd: number }>;
  tombs: Array<{ x: number; z: number }>;
  clutter: Array<{ x: number; z: number }>;
  dressing: LitanyDressingAnchor[];
}

export type LitanyMapPrimitive =
  | { kind: 'polygon'; points: Array<{ x: number; z: number }> }
  | {
      kind: 'circle';
      x: number;
      z: number;
      r: number;
      role: 'blackwater' | 'dais' | 'exit' | 'blocker';
    }
  | { kind: 'rect'; x: number; z: number; hw: number; hd: number; role: 'island' | 'blocker' };

export const LITANY_Z_MIN = -19;
export const LITANY_Z_MAX = 91;
export const LITANY_WALL_X = 25;
export const LITANY_SIDE_Z = 36;
export const LITANY_SIDE_HD = 55;
export const LITANY_DOOR_Z = -17;

export const LITANY_MODULE_IDS = [
  'litany_sluice',
  'litany_ledger',
  'litany_ring',
  'litany_baptistry',
  'litany_choir_loft',
  'litany_causeway',
  'litany_apse',
] as const;

const LITANY_BOUNDS = { xMin: -25, xMax: 25, zMin: LITANY_Z_MIN, zMax: LITANY_Z_MAX } as const;

type LitanyRoomDef = Omit<LitanyModuleGeometry, 'bounds' | 'doorZ'> & {
  wallX?: number;
  zMin?: number;
  zMax?: number;
};

function litanyRoom(def: LitanyRoomDef): LitanyModuleGeometry {
  const wallX = def.wallX ?? LITANY_WALL_X;
  const zMin = def.zMin ?? LITANY_Z_MIN;
  const zMax = def.zMax ?? LITANY_Z_MAX;
  return {
    bounds: { xMin: -wallX, xMax: wallX, zMin, zMax },
    doorZ: LITANY_DOOR_Z,
    ...def,
    wallX,
    zMin,
    zMax,
  };
}

function shellColliders(geo: LitanyModuleGeometry): Collider[] {
  const out: Collider[] = [];
  const sideZ = (geo.zMin + geo.zMax) / 2;
  const sideHd = (geo.zMax - geo.zMin) / 2;
  for (const sx of [-geo.wallX, geo.wallX]) {
    out.push({
      type: 'obb',
      x: sx,
      z: sideZ,
      hw: DUNGEON_WALL_HW,
      hd: sideHd,
      rot: 0,
    });
  }
  out.push({
    type: 'obb',
    x: 0,
    z: geo.zMax,
    hw: DUNGEON_END_WALL_HW,
    hd: DUNGEON_WALL_HW,
    rot: 0,
  });
  out.push({
    type: 'obb',
    x: 0,
    z: geo.zMin,
    hw: DUNGEON_END_WALL_HW,
    hd: DUNGEON_WALL_HW,
    rot: 0,
  });
  return out;
}

function interiorColliders(geo: LitanyModuleGeometry, includeHazards: boolean): Collider[] {
  const out: Collider[] = [];
  for (const s of geo.stubs) out.push({ type: 'obb', x: s.x, z: s.z, hw: s.hw, hd: s.hd, rot: 0 });
  for (const p of geo.pillars) out.push({ type: 'circle', x: p.x, z: p.z, r: PILLAR_COLLIDER_R });
  for (const t of geo.tombs)
    out.push({ type: 'obb', x: t.x, z: t.z, hw: TOMB_HW, hd: TOMB_HD, rot: 0 });
  for (const c of geo.clutter) out.push({ type: 'circle', x: c.x, z: c.z, r: 0.8 });
  if (includeHazards) {
    // Blackwater is shallow: walkable AND damaging (the tickDelveBlackwater hazard
    // only damages players who can STAND in it, and mobs/pathing ignore it). It is
    // never a movement wall unless a zone explicitly opts in (a future deep font).
    for (const hz of geo.hazards) {
      if (!hz.blocksMovement) continue;
      out.push({ type: 'circle', x: hz.x, z: hz.z, r: hz.rx ?? hz.r });
    }
  }
  return out;
}

// Per-room geometry (coordinate spec from docs/prd/drowned-litany-redesign.md)

// 1. Sluice (TIGHT) hw 14, z0 -12, z1 62
const LITANY_SLUICE = litanyRoom({
  moduleId: 'litany_sluice',
  profile: 'crescent',
  wallX: 14,
  zMin: -12,
  zMax: 62,
  dais: { x: 0, z: 59, r: 5 },
  walkable: [],
  hazards: [
    { x: -2, z: 26, rx: 13, rz: 22, r: 13, tier: 'shallow' },
    { x: -2, z: 26, rx: 10, rz: 18, r: 10, tier: 'deep' },
    { x: 5, z: 48, r: 7, tier: 'deep' },
  ],
  islands: [
    { x: 0, z: -9, hw: 5, hd: 3 },
    { x: 9, z: 5, hw: 3, hd: 3 },
    { x: 11, z: 22, hw: 3, hd: 3 },
    { x: 8, z: 40, hw: 3, hd: 3 },
    { x: 2, z: 54, hw: 4, hd: 3 },
    { x: 0, z: 59, hw: 4, hd: 3 },
  ],
  stubs: [],
  pillars: [
    { x: -9, z: 16 },
    { x: -7, z: 36 },
    { x: 5, z: 30 },
    { x: -3, z: 50 },
  ],
  tombs: [],
  clutter: [],
  dressing: [
    { kind: 'dead_tree', x: -9, z: 16 },
    { kind: 'dead_tree', x: -7, z: 36 },
    { kind: 'dead_tree', x: 5, z: 30 },
    { kind: 'dead_tree', x: -3, z: 50 },
  ],
});

// 2. Ledger (MEDIUM) hw 22, z0 -14, z1 86
const LITANY_LEDGER = litanyRoom({
  moduleId: 'litany_ledger',
  profile: 'island_cluster',
  wallX: 22,
  zMin: -14,
  zMax: 86,
  dais: { x: 0, z: 82, r: 6 },
  walkable: [],
  hazards: [
    { x: 0, z: 40, rx: 21, rz: 32, r: 21, tier: 'shallow' },
    { x: 0, z: 40, rx: 18, rz: 28, r: 18, tier: 'deep' },
  ],
  islands: [
    { x: 0, z: -11, hw: 5, hd: 3 },
    { x: -12, z: 8, hw: 4, hd: 3 },
    { x: -6, z: 24, hw: 4, hd: 3 },
    { x: 3, z: 40, hw: 4, hd: 4 },
    { x: 9, z: 56, hw: 4, hd: 3 },
    { x: 2, z: 72, hw: 4, hd: 3 },
    { x: 0, z: 82, hw: 5, hd: 3 },
  ],
  stubs: [],
  pillars: [
    { x: 16, z: 30 },
    { x: -16, z: 42 },
    { x: 15, z: 62 },
    { x: -15, z: 16 },
  ],
  tombs: [],
  clutter: [],
  dressing: [
    { kind: 'dead_tree', x: 16, z: 30 },
    { kind: 'dead_tree', x: -16, z: 42 },
    { kind: 'dead_tree', x: 15, z: 62 },
    { kind: 'dead_tree', x: -15, z: 16 },
  ],
});

// 3. Ring (LARGE) hw 25, z0 -16, z1 90
const LITANY_RING = litanyRoom({
  moduleId: 'litany_ring',
  profile: 'ring',
  wallX: 25,
  zMin: -16,
  zMax: 90,
  dais: { x: 0, z: 82, r: 6 },
  walkable: [],
  hazards: [
    { x: 0, z: 40, rx: 18, rz: 31, r: 18, tier: 'shallow' },
    { x: 0, z: 40, rx: 15, rz: 27, r: 15, tier: 'deep' },
  ],
  islands: [
    // dry perimeter
    { x: -20, z: 4, hw: 4, hd: 5 },
    { x: -21, z: 26, hw: 4, hd: 11 },
    { x: -21, z: 52, hw: 4, hd: 11 },
    { x: -16, z: 72, hw: 4, hd: 5 },
    { x: 20, z: 4, hw: 4, hd: 5 },
    { x: 21, z: 26, hw: 4, hd: 11 },
    { x: 21, z: 52, hw: 4, hd: 11 },
    { x: 16, z: 72, hw: 4, hd: 5 },
    { x: 0, z: -13, hw: 5, hd: 3 },
    { x: 0, z: 82, hw: 6, hd: 4 },
    // optional shortcut stones
    { x: 0, z: 20, hw: 3, hd: 3 },
    { x: 0, z: 40, hw: 3, hd: 3 },
    { x: 0, z: 60, hw: 3, hd: 3 },
  ],
  stubs: [],
  pillars: [
    { x: -8, z: 40 },
    { x: 8, z: 40 },
    { x: 0, z: 30 },
  ],
  tombs: [],
  clutter: [],
  dressing: [
    { kind: 'dead_tree', x: -8, z: 40 },
    { kind: 'dead_tree', x: 8, z: 40 },
    { kind: 'dead_tree', x: 0, z: 30 },
  ],
});

// 4. Baptistry (MEDIUM-TIGHT, fully dry) hw 18, z0 -12, z1 72
const LITANY_BAPTISTRY = litanyRoom({
  moduleId: 'litany_baptistry',
  profile: 'sinkhole',
  wallX: 18,
  zMin: -12,
  zMax: 72,
  dais: { x: 0, z: 64, r: 6 },
  walkable: [],
  hazards: [
    { x: 0, z: 40, rx: 16, rz: 16, r: 16, tier: 'shallow' },
    { x: -14, z: 22, r: 7, tier: 'shallow' },
    { x: 14, z: 24, r: 7, tier: 'shallow' },
    { x: 0, z: 40, rx: 12, rz: 12, r: 12, tier: 'deep' },
  ],
  islands: [
    { x: 0, z: -9, hw: 5, hd: 3 },
    { x: 15, z: 9, hw: 4, hd: 4 },
    { x: 16, z: 34, hw: 4, hd: 5 },
    { x: 12, z: 56, hw: 4, hd: 4 },
    { x: 0, z: 64, hw: 6, hd: 4 },
  ],
  stubs: [],
  pillars: [
    { x: 8, z: 34 },
    { x: -8, z: 34 },
    { x: 8, z: 46 },
    { x: -8, z: 46 },
  ],
  tombs: [],
  clutter: [],
  dressing: [
    { kind: 'dead_tree', x: 8, z: 34 },
    { kind: 'dead_tree', x: -8, z: 34 },
    { kind: 'dead_tree', x: 8, z: 46 },
    { kind: 'dead_tree', x: -8, z: 46 },
  ],
});

// 5. Choir Loft (WIDE/LARGE, fully dry) hw 25, z0 -12, z1 84
const LITANY_CHOIR_LOFT = litanyRoom({
  moduleId: 'litany_choir_loft',
  profile: 'fan',
  wallX: 25,
  zMin: -12,
  zMax: 84,
  dais: { x: 0, z: 74, r: 6 },
  walkable: [],
  hazards: [
    { x: -14, z: 32, rx: 8, rz: 20, r: 8, tier: 'shallow' },
    { x: 0, z: 42, rx: 7, rz: 18, r: 7, tier: 'shallow' },
    { x: 14, z: 32, rx: 8, rz: 20, r: 8, tier: 'shallow' },
    { x: -14, z: 32, rx: 6, rz: 17, r: 6, tier: 'deep' },
    { x: 0, z: 42, rx: 5, rz: 15, r: 5, tier: 'deep' },
    { x: 14, z: 32, rx: 6, rz: 17, r: 6, tier: 'deep' },
  ],
  islands: [
    { x: 0, z: -9, hw: 4, hd: 3 },
    { x: -7, z: 8, hw: 4, hd: 3 },
    { x: -20, z: 28, hw: 4, hd: 6 },
    { x: -14, z: 54, hw: 4, hd: 5 },
    { x: 0, z: 74, hw: 6, hd: 4 },
    { x: 7, z: 8, hw: 3, hd: 6 },
    { x: 20, z: 28, hw: 4, hd: 6 },
    { x: 14, z: 54, hw: 4, hd: 5 },
  ],
  stubs: [],
  pillars: [
    { x: -20, z: 48 },
    { x: 20, z: 48 },
    { x: -12, z: 18 },
    { x: 12, z: 18 },
  ],
  tombs: [],
  clutter: [],
  dressing: [
    { kind: 'dead_tree', x: -20, z: 48 },
    { kind: 'dead_tree', x: 20, z: 48 },
    { kind: 'dead_tree', x: -12, z: 18 },
    { kind: 'dead_tree', x: 12, z: 18 },
  ],
});

// 6. Causeway (TIGHT/LONG) hw 15, z0 -14, z1 92
const LITANY_CAUSEWAY = litanyRoom({
  moduleId: 'litany_causeway',
  profile: 'y_split',
  wallX: 15,
  zMin: -14,
  zMax: 92,
  dais: { x: 0, z: 82, r: 4 },
  walkable: [],
  hazards: [
    { x: -12, z: 40, rx: 9, rz: 41, r: 9, tier: 'shallow' },
    { x: 12, z: 40, rx: 9, rz: 41, r: 9, tier: 'shallow' },
    { x: -12, z: 40, rx: 7, rz: 38, r: 7, tier: 'deep' },
    { x: 12, z: 40, rx: 7, rz: 38, r: 7, tier: 'deep' },
    { x: 0, z: 22, r: 4, tier: 'deep' },
    { x: 0, z: 50, r: 4, tier: 'deep' },
    { x: 0, z: 72, r: 4, tier: 'deep' },
  ],
  islands: [
    { x: 0, z: -9, hw: 4, hd: 4 },
    { x: 0, z: 9, hw: 3, hd: 5 },
    { x: 0, z: 22, hw: 2, hd: 2 },
    { x: 0, z: 35, hw: 3, hd: 5 },
    { x: 0, z: 50, hw: 2, hd: 2 },
    { x: 0, z: 61, hw: 3, hd: 5 },
    { x: 0, z: 72, hw: 2, hd: 2 },
    { x: 0, z: 82, hw: 4, hd: 4 },
  ],
  stubs: [],
  pillars: [
    { x: -10, z: 16 },
    { x: 10, z: 30 },
    { x: -10, z: 52 },
    { x: 10, z: 64 },
    { x: -8, z: 82 },
  ],
  tombs: [],
  clutter: [],
  dressing: [
    { kind: 'dead_tree', x: -10, z: 16 },
    { kind: 'dead_tree', x: 10, z: 30 },
    { kind: 'dead_tree', x: -10, z: 52 },
    { kind: 'dead_tree', x: 10, z: 64 },
    { kind: 'dead_tree', x: -8, z: 82 },
  ],
});

// 7. Apse (BOSS/LARGE) hw 25, z0 -16, z1 92
const LITANY_APSE = litanyRoom({
  moduleId: 'litany_apse',
  profile: 'asymmetric_apse',
  wallX: 25,
  zMin: -16,
  zMax: 92,
  dais: { x: 0, z: 72, r: 12 },
  walkable: [],
  hazards: [
    { x: 0, z: 56, rx: 24, rz: 17, r: 24, tier: 'shallow' },
    { x: 0, z: 56, rx: 21, rz: 14, r: 21, tier: 'deep' },
    { x: -12, z: 22, r: 6, tier: 'deep' },
    { x: 12, z: 26, r: 6, tier: 'deep' },
  ],
  islands: [
    { x: 0, z: -13, hw: 5, hd: 3 },
    { x: -12, z: 6, hw: 5, hd: 4 },
    { x: 12, z: 8, hw: 5, hd: 4 },
    { x: -10, z: 30, hw: 4, hd: 4 },
    { x: 10, z: 32, hw: 4, hd: 4 },
    { x: 0, z: 44, hw: 5, hd: 4 },
    { x: 0, z: 60, hw: 9, hd: 9 },
    { x: 0, z: 72, hw: 11, hd: 11 },
  ],
  stubs: [],
  pillars: [
    { x: -16, z: 12 },
    { x: 16, z: 14 },
    { x: -16, z: 26 },
    { x: 16, z: 28 },
  ],
  tombs: [],
  clutter: [],
  dressing: [
    { kind: 'dead_tree', x: -18, z: 52 },
    { kind: 'dead_tree', x: 18, z: 54 },
    { kind: 'broken_bell_frame', x: 0, z: 88 },
    { kind: 'shrine_fragment', x: 0, z: 72 },
  ],
});

const LITANY_GEOMETRY: Record<(typeof LITANY_MODULE_IDS)[number], LitanyModuleGeometry> = {
  litany_sluice: LITANY_SLUICE,
  litany_ledger: LITANY_LEDGER,
  litany_ring: LITANY_RING,
  litany_baptistry: LITANY_BAPTISTRY,
  litany_choir_loft: LITANY_CHOIR_LOFT,
  litany_causeway: LITANY_CAUSEWAY,
  litany_apse: LITANY_APSE,
};

export function isLitanyModuleId(id: string): id is (typeof LITANY_MODULE_IDS)[number] {
  return (LITANY_MODULE_IDS as readonly string[]).includes(id);
}

export function litanyModuleGeometry(moduleId: LitanyModuleId): LitanyModuleGeometry | null {
  if (!isLitanyModuleId(moduleId)) return null;
  return LITANY_GEOMETRY[moduleId];
}

/** Movement + shell collision for a Litany module. */
export function litanyModuleColliders(moduleId: LitanyModuleId): Collider[] {
  const geo = litanyModuleGeometry(moduleId);
  if (!geo) return [];
  return [...shellColliders(geo), ...interiorColliders(geo, true)];
}

/** Tall obstacles that block ranged line of sight (excludes shallow Blackwater). */
export function litanyModuleLosColliders(moduleId: LitanyModuleId): Collider[] {
  const geo = litanyModuleGeometry(moduleId);
  if (!geo) return [];
  return [...shellColliders(geo), ...interiorColliders(geo, false)];
}

/** Blackwater hazard zones for module defs / tick (instance-local). */
export function litanyModuleHazards(
  moduleId: LitanyModuleId,
): Array<{ x: number; z: number; r: number; tier?: 'shallow' | 'deep' }> {
  const geo = litanyModuleGeometry(moduleId);
  if (!geo) return [];
  return geo.hazards.map((h) => ({ x: h.x, z: h.z, r: h.r, tier: h.tier }));
}

export function litanyModuleDressing(moduleId: LitanyModuleId): LitanyDressingAnchor[] {
  return litanyModuleGeometry(moduleId)?.dressing ?? [];
}

export function litanyModuleMapPrimitives(moduleId: LitanyModuleId): LitanyMapPrimitive[] {
  const geo = litanyModuleGeometry(moduleId);
  if (!geo) return [];
  const out: LitanyMapPrimitive[] = [];
  for (const shape of geo.walkable) out.push({ kind: 'polygon', points: shape.points });
  for (const isl of geo.islands) {
    out.push({ kind: 'rect', x: isl.x, z: isl.z, hw: isl.hw, hd: isl.hd, role: 'island' });
  }
  for (const hz of geo.hazards) {
    out.push({ kind: 'circle', x: hz.x, z: hz.z, r: hz.rx ?? hz.r, role: 'blackwater' });
  }
  for (const s of geo.stubs) {
    out.push({ kind: 'rect', x: s.x, z: s.z, hw: s.hw, hd: s.hd, role: 'blocker' });
  }
  for (const p of geo.pillars) {
    out.push({ kind: 'circle', x: p.x, z: p.z, r: PILLAR_COLLIDER_R, role: 'blocker' });
  }
  for (const t of geo.tombs) {
    out.push({ kind: 'rect', x: t.x, z: t.z, hw: TOMB_HW, hd: TOMB_HD, role: 'blocker' });
  }
  out.push({ kind: 'circle', x: geo.dais.x, z: geo.dais.z, r: geo.dais.r, role: 'dais' });
  out.push({ kind: 'circle', x: 0, z: geo.zMax - 2, r: 2, role: 'exit' });
  return out;
}

/** DungeonLayout bridge for reliquary-era consumers (entry, span, legacy schematic). */
export function litanyModuleLayout(
  moduleId: LitanyModuleId,
): (DungeonLayout & { litanyModuleId: LitanyModuleId }) | null {
  const geo = litanyModuleGeometry(moduleId);
  if (!geo) return null;
  return {
    zMin: geo.zMin,
    zMax: geo.zMax,
    sideWallZ: (geo.zMin + geo.zMax) / 2,
    sideWallHd: (geo.zMax - geo.zMin) / 2,
    wallX: geo.wallX,
    doorZ: geo.doorZ,
    pillars: geo.pillars,
    tombs: geo.tombs,
    stubs: geo.stubs,
    dais: geo.dais,
    clutter: geo.clutter,
    litanyModuleId: moduleId,
  };
}

/** True when walkable islands do not fill the bounding rectangle (data, not object count). */
export function litanyModuleIsNonRectangular(moduleId: LitanyModuleId): boolean {
  const geo = litanyModuleGeometry(moduleId);
  if (!geo) return false;
  const fullArea = geo.wallX * 2 * (geo.zMax - geo.zMin);
  const islandArea = geo.islands.reduce((sum, i) => sum + i.hw * 2 * i.hd * 2, 0);
  return islandArea < fullArea * 0.55;
}

export function litanyModuleBounds(moduleId: LitanyModuleId): {
  minX: number;
  maxX: number;
  zMin: number;
  zMax: number;
} {
  const geo = litanyModuleGeometry(moduleId);
  if (!geo) return { minX: -23, maxX: 23, zMin: LITANY_Z_MIN, zMax: LITANY_Z_MAX };
  return { minX: -geo.wallX, maxX: geo.wallX, zMin: geo.zMin, zMax: geo.zMax };
}
