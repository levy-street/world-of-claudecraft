// The Gravemarch, the 5v5 battleground map, as plain numbers. Like
// dungeon_layout.ts this file is the single source of truth for BOTH the
// visual dressing (src/render/battleground.ts builds meshes from these
// records) and the collision set (src/sim/colliders.ts derives
// BATTLEGROUND_COLLIDERS via battlegroundColliders), so what you see is what
// you collide with. All coordinates are instance-local (origin =
// battlegroundOrigin(slot) in data.ts), y is flat (0) across the band.
//
// Compass: Team A (the Ember Company, red) holds the SOUTH base (negative z),
// Team B (the Pale Company, blue) holds the NORTH base (positive z). The map
// is exactly mirror-symmetric across z = 0 so neither side is favored. Two
// lanes run south to north: the Shield Road (west, negative x) and the Spear
// Road (east, positive x). Between them lie the Barrows (scatter cover) and
// the ruined bell chapel at the center where the Knell Warden stands.
// See docs/prd/battlegrounds.md for the design.
// Sim layer: no three.js imports.
import type { Collider } from './colliders';
import type { BgTeam } from './types';

export type { BgTeam };
export type BgLane = 'west' | 'east';
export type BgStructureKind = 'warstone' | 'bulwark';
export type BgStructureTier = 'outer' | 'inner';

// ---------------------------------------------------------------------------
// Footprint. The whole map must stay inside the battleground x-band
// (isBattlegroundPos) and well inside the slot spacing along z.
// ---------------------------------------------------------------------------
export const BG_HALF_X = 85; // east-west half extent (perimeter wall centreline)
export const BG_HALF_Z = 120; // south-north half extent
export const BG_WALL_H = 6; // visual wall height hint for the renderer

// Lane centreline x at the straight mid-section, and the base gate x.
export const BG_LANE_GATE_X = 45; // lanes pass the base walls here
const LANE_MID_X = 56; // lanes bow outward to here at z = 0
export const BG_LANE_ROAD_HALF_W = 4; // visual road half width

// Base geometry (team A side; team B mirrors across z = 0).
export const BG_BASE_WALL_Z = 88; // base wall centreline |z|
export const BG_WARSTONE_Z = 102; // warstone centre |z|
export const BG_WARSTONE_DAIS_R = 6; // walkable dais, deliberately NO collider
const BASE_GATE_HALF_W = 8; // gate opening half width at each lane

// Center chapel (the Knell).
export const BG_CHAPEL_R = 14; // ring wall radius
export const BG_KNELL_POS = { x: 0, z: 0 };

export interface BgPoint {
  x: number;
  z: number;
}

export interface BgSpawnPoint extends BgPoint {
  facing: number;
}

// ---------------------------------------------------------------------------
// Team spawns: five points on the warstone dais arc, facing the field.
// facing 0 looks toward +z (north); Math.PI toward -z (south).
// ---------------------------------------------------------------------------
export const BG_SPAWNS_A: BgSpawnPoint[] = [
  { x: -12, z: -108, facing: 0 },
  { x: -6, z: -110, facing: 0 },
  { x: 0, z: -111, facing: 0 },
  { x: 6, z: -110, facing: 0 },
  { x: 12, z: -108, facing: 0 },
];
export const BG_SPAWNS_B: BgSpawnPoint[] = BG_SPAWNS_A.map((s) => ({
  x: s.x,
  z: -s.z,
  facing: Math.PI,
}));

export function bgSpawns(team: BgTeam): BgSpawnPoint[] {
  return team === 'A' ? BG_SPAWNS_A : BG_SPAWNS_B;
}

// ---------------------------------------------------------------------------
// Structures. Bulwarks stand just off the road on the defended side; the
// warstone crowns the base dais. Ids are stable wire/content identifiers.
// ---------------------------------------------------------------------------
export interface BgStructureDef {
  id: string;
  team: BgTeam;
  kind: BgStructureKind;
  lane: BgLane | null;
  tier: BgStructureTier | null;
  x: number;
  z: number;
  /** movement collider radius (rubble keeps blocking after destruction) */
  r: number;
}

function mirrorStructure(s: BgStructureDef): BgStructureDef {
  return {
    ...s,
    id: s.id.replace(/^a_/, 'b_'),
    team: 'B',
    z: -s.z,
  };
}

const STRUCTURES_A: BgStructureDef[] = [
  { id: 'a_warstone', team: 'A', kind: 'warstone', lane: null, tier: null, x: 0, z: -102, r: 2.5 },
  {
    id: 'a_west_outer',
    team: 'A',
    kind: 'bulwark',
    lane: 'west',
    tier: 'outer',
    x: -49,
    z: -38,
    r: 1.8,
  },
  {
    id: 'a_west_inner',
    team: 'A',
    kind: 'bulwark',
    lane: 'west',
    tier: 'inner',
    x: -47,
    z: -72,
    r: 1.8,
  },
  {
    id: 'a_east_outer',
    team: 'A',
    kind: 'bulwark',
    lane: 'east',
    tier: 'outer',
    x: 49,
    z: -38,
    r: 1.8,
  },
  {
    id: 'a_east_inner',
    team: 'A',
    kind: 'bulwark',
    lane: 'east',
    tier: 'inner',
    x: 47,
    z: -72,
    r: 1.8,
  },
];

export const BG_STRUCTURES: BgStructureDef[] = [
  ...STRUCTURES_A,
  ...STRUCTURES_A.map(mirrorStructure),
];

export function bgStructure(id: string): BgStructureDef | null {
  return BG_STRUCTURES.find((s) => s.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Lanes. Waypoints run in the ATTACK direction for team A (south to north,
// ending at the enemy warstone); team B columns walk the mirrored path. The
// bow outward at mid-lane keeps the roads clear of the chapel ring.
// ---------------------------------------------------------------------------
const LANE_WEST_A: BgPoint[] = [
  { x: -BG_LANE_GATE_X, z: -92 }, // out of the base gate
  { x: -53, z: -45 },
  { x: -LANE_MID_X, z: 0 },
  { x: -53, z: 45 },
  { x: -BG_LANE_GATE_X, z: 86 }, // enemy gate
  { x: -BG_LANE_GATE_X, z: 94 }, // through it
  { x: 0, z: BG_WARSTONE_Z }, // the enemy warstone
];

function mirrorX(path: BgPoint[]): BgPoint[] {
  return path.map((p) => ({ x: -p.x, z: p.z }));
}
function mirrorZ(path: BgPoint[]): BgPoint[] {
  return path.map((p) => ({ x: p.x, z: -p.z }));
}

const LANE_EAST_A: BgPoint[] = mirrorX(LANE_WEST_A);

/** Waypoints a minion column of `team` walks down `lane`, in march order. */
export function bgLaneWaypoints(team: BgTeam, lane: BgLane): BgPoint[] {
  const a = lane === 'west' ? LANE_WEST_A : LANE_EAST_A;
  return team === 'A' ? a : mirrorZ(a);
}

/** Where a team's minion column musters (first waypoint pulled toward its base). */
export function bgMinionMuster(team: BgTeam, lane: BgLane): BgPoint {
  const gate = bgLaneWaypoints(team, lane)[0];
  return { x: gate.x, z: team === 'A' ? gate.z - 4 : gate.z + 4 };
}

// ---------------------------------------------------------------------------
// Barrow scatter: cover and LoS breaks in the fields between the lanes and
// the chapel. Authored for the NORTH half and mirrored south so the field is
// fair. Kinds drive both the collider radius and the renderer's dressing.
// 'spears' and 'banner' rows are cosmetic only (no collider) so they never
// snag movement; mounds/trees/rocks/ruins block like overworld props.
// ---------------------------------------------------------------------------
export type BgScatterKind = 'mound' | 'tree' | 'rock' | 'ruin' | 'grave' | 'spears' | 'banner';

export interface BgScatterDef extends BgPoint {
  kind: BgScatterKind;
  /** deterministic per-prop variation for the renderer (yaw, variant pick) */
  seed: number;
}

const SCATTER_COLLIDER_R: Record<BgScatterKind, number> = {
  mound: 2.2,
  tree: 0.9,
  rock: 1.4,
  ruin: 2.0,
  grave: 0.9,
  spears: 0,
  banner: 0,
};

// North half (z > 0). Mirrored to the south half below.
const SCATTER_N: BgScatterDef[] = [
  // west field, between the Shield Road and the chapel
  { kind: 'mound', x: -32, z: 22, seed: 1 },
  { kind: 'tree', x: -24, z: 34, seed: 2 },
  { kind: 'grave', x: -28, z: 28, seed: 3 },
  { kind: 'rock', x: -38, z: 44, seed: 4 },
  { kind: 'mound', x: -22, z: 56, seed: 5 },
  { kind: 'tree', x: -34, z: 66, seed: 6 },
  { kind: 'grave', x: -18, z: 48, seed: 7 },
  { kind: 'ruin', x: -30, z: 76, seed: 8 },
  // east field, between the Spear Road and the chapel
  { kind: 'mound', x: 32, z: 22, seed: 9 },
  { kind: 'tree', x: 24, z: 34, seed: 10 },
  { kind: 'grave', x: 28, z: 28, seed: 11 },
  { kind: 'rock', x: 38, z: 44, seed: 12 },
  { kind: 'mound', x: 22, z: 56, seed: 13 },
  { kind: 'tree', x: 34, z: 66, seed: 14 },
  { kind: 'grave', x: 18, z: 48, seed: 15 },
  { kind: 'ruin', x: 30, z: 76, seed: 16 },
  // outer verges, beyond the roads
  { kind: 'tree', x: -70, z: 30, seed: 17 },
  { kind: 'rock', x: -74, z: 62, seed: 18 },
  { kind: 'tree', x: 70, z: 30, seed: 19 },
  { kind: 'rock', x: 74, z: 62, seed: 20 },
  // cosmetic war-litter along the roads (no colliders)
  { kind: 'spears', x: -48, z: 26, seed: 21 },
  { kind: 'banner', x: -60, z: 52, seed: 22 },
  { kind: 'spears', x: 48, z: 26, seed: 23 },
  { kind: 'banner', x: 60, z: 52, seed: 24 },
  { kind: 'spears', x: -8, z: 20, seed: 25 },
  { kind: 'spears', x: 8, z: 20, seed: 26 },
];

export const BG_SCATTER: BgScatterDef[] = [
  ...SCATTER_N,
  ...SCATTER_N.map((s, i) => ({ ...s, z: -s.z, seed: 100 + i })),
];

// ---------------------------------------------------------------------------
// Chapel ring: eight arc stubs with openings at N/S/E/W. Plain OBBs so both
// collision and the renderer place the same broken wall segments.
// ---------------------------------------------------------------------------
export interface BgChapelStub {
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
}

export const BG_CHAPEL_STUBS: BgChapelStub[] = (() => {
  const out: BgChapelStub[] = [];
  for (let i = 0; i < 8; i++) {
    // stub centres sit between the four openings (angles 22.5 + 45k degrees)
    const ang = ((22.5 + 45 * i) * Math.PI) / 180;
    out.push({
      x: Math.sin(ang) * BG_CHAPEL_R,
      z: Math.cos(ang) * BG_CHAPEL_R,
      hw: 4.2,
      hd: 0.9,
      // Long axis (hw) tangent to the ring: rotation.y of `ang` maps local +x
      // to (cos ang, -sin ang), the tangent at position (sin ang, cos ang).
      rot: ang,
    });
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Collision set (instance-local). Mirrors layoutColliders in dungeon_layout.ts.
// ---------------------------------------------------------------------------
export function battlegroundColliders(): Collider[] {
  const out: Collider[] = [];
  // perimeter walls
  for (const sx of [-BG_HALF_X, BG_HALF_X]) {
    out.push({ type: 'obb', x: sx, z: 0, hw: 1, hd: BG_HALF_Z, rot: 0 });
  }
  for (const sz of [-BG_HALF_Z, BG_HALF_Z]) {
    out.push({ type: 'obb', x: 0, z: sz, hw: BG_HALF_X, hd: 1, rot: 0 });
  }
  // base walls with a gate opening at each lane (both teams)
  const gateHw = BASE_GATE_HALF_W;
  const gx = BG_LANE_GATE_X;
  for (const sign of [-1, 1]) {
    const z = BG_BASE_WALL_Z * sign;
    // outer segments: wall from the perimeter to each gate's outer edge
    const outerHw = (BG_HALF_X - (gx + gateHw)) / 2;
    const outerCx = gx + gateHw + outerHw;
    out.push({ type: 'obb', x: -outerCx, z, hw: outerHw, hd: 1, rot: 0 });
    out.push({ type: 'obb', x: outerCx, z, hw: outerHw, hd: 1, rot: 0 });
    // centre segment between the two gates
    out.push({ type: 'obb', x: 0, z, hw: gx - gateHw, hd: 1, rot: 0 });
  }
  // chapel ring stubs
  for (const s of BG_CHAPEL_STUBS) {
    out.push({ type: 'obb', x: s.x, z: s.z, hw: s.hw, hd: s.hd, rot: s.rot });
  }
  // structures (rubble keeps blocking after destruction)
  for (const s of BG_STRUCTURES) {
    out.push({ type: 'circle', x: s.x, z: s.z, r: s.r });
  }
  // barrow scatter (cosmetic kinds carry r 0 and are skipped)
  for (const s of BG_SCATTER) {
    const r = SCATTER_COLLIDER_R[s.kind];
    if (r > 0) out.push({ type: 'circle', x: s.x, z: s.z, r });
  }
  return out;
}
