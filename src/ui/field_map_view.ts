// Pure painted-map plan of an authored open-air dungeon field (the Sunken
// Bastion, the Hollow Crypt, any future AuthoredFieldDef): what the M-map and
// the minimap draw for the terrain itself, in instance-local yards. Derived
// from the SAME record the sim walks and the renderer draws (surfaces in
// their last-wins order, the generated cliff runs, the walls, the kit props,
// the dungeon's gates), so the map can never disagree with the ground.
//
// The painter (field_map_painter.ts) rasterises this once into a plate and
// the dungeon map (dungeon_map_view.ts) projects it and its markers.
//
// DOM-free, Three-free, deterministic.

import {
  RIM_FALLS,
  RIVER_COURSE,
  RIVER_FORD,
  WEEPING_FALLS,
} from '../sim/content/wildheart_basin_layout';
import { DUNGEONS } from '../sim/data';
import {
  type AuthoredFieldDef,
  authoredFieldCliffRuns,
  authoredFieldFor,
  type FieldGround,
  surfaceOutline,
} from '../sim/instances/authored_field';
import type { DungeonGateDef } from '../sim/types';

/** Yards of void kept round the field's walkable envelope on the map. */
export const FIELD_MAP_MARGIN = 14;

export type FieldMapLandmark = 'beacon' | 'chapel' | 'tower' | 'well' | 'altar' | 'statue';

export interface FieldMapSurface {
  /** The outline, instance-local (x, z), in draw order (a later one covers). */
  points: [number, number][];
  ground: FieldGround;
  /** Mean height (a path's average), for the height tint. */
  h: number;
  path: boolean;
}

export interface FieldMapSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

export interface FieldMapCliff extends FieldMapSegment {
  /** Unit normal from the high side to the low side. */
  nx: number;
  nz: number;
  drop: number;
  /** Falls into the void (the sea or the mist), not onto a lower terrace. */
  intoVoid: boolean;
  masonry: boolean;
}

export interface FieldMapProp {
  x: number;
  z: number;
  /** A circle footprint, or a box's four corners. */
  r: number | null;
  corners: [number, number][] | null;
}

export interface FieldMapPlan {
  key: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  void: 'sea' | 'mist' | 'jungle' | 'crevasse';
  heightMin: number;
  heightMax: number;
  surfaces: FieldMapSurface[];
  /** Tread lines across every stair (drawn over its surface). */
  treads: FieldMapSegment[];
  cliffs: FieldMapCliff[];
  /** Authored walls as four-corner blocks. */
  walls: [number, number][][];
  props: FieldMapProp[];
  landmarks: { kind: FieldMapLandmark; x: number; z: number }[];
  /** The dungeon's gates and seals: WHERE each passage is (a gate that is
   *  still shut is the live `gate` marker, never this static mark). */
  gates: (FieldMapSegment & { seal: boolean })[];
  /** Running and standing water in the void (a gorge's river and the pools
   *  under its falls), drawn over the void and under the terraces. */
  water: FieldMapWater;
}

export interface FieldMapWater {
  /** River ribbons: a centreline and its width (yards). */
  lines: { points: [number, number][]; width: number }[];
  /** Plunge pools at the foot of falls. */
  pools: { x: number; z: number; r: number }[];
}

/** The water a field's void holds (render and map only; the sim walks none of
 *  it). The Wildheart Basin: the river down the gorge, the ford's spill into
 *  it, the pools under the rim falls and the Weeping Falls' plunge pool. */
const FIELD_MAP_WATER: Readonly<Record<string, () => FieldMapWater>> = {
  wildheart: () => ({
    lines: [
      { points: RIVER_COURSE.map(([x, z]): [number, number] => [x, z]), width: 13 },
      {
        points: [
          [RIVER_FORD.x0, (RIVER_FORD.z0 + RIVER_FORD.z1) / 2],
          [RIVER_FORD.x0 - 14, (RIVER_FORD.z0 + RIVER_FORD.z1) / 2 + 12],
          [-112, -58],
        ],
        width: 10,
      },
    ],
    pools: [
      { x: WEEPING_FALLS.x + 1, z: WEEPING_FALLS.z, r: 13 },
      ...RIM_FALLS.filter((f) => f.id !== 'weeping').map((f) => ({
        x: f.x + Math.sin(f.facing) * 6,
        z: f.z + Math.cos(f.facing) * 6,
        r: f.width * 0.8,
      })),
    ],
  }),
};

function landmarkOf(kind: string): FieldMapLandmark | null {
  if (kind.includes('beacon')) return 'beacon';
  if (kind.includes('chapel') || kind.includes('altar')) return 'chapel';
  if (kind.includes('tower')) return 'tower';
  if (kind.includes('well') || kind.includes('fountain') || kind.includes('cistern')) return 'well';
  if (kind.includes('statue') || kind.includes('monument')) return 'statue';
  return null;
}

function boxCorners(x: number, z: number, hw: number, hd: number, rot: number): [number, number][] {
  // Sim yaw about y: local x runs along (cos, -sin), local z along (sin, cos).
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const out: [number, number][] = [];
  for (const [lx, lz] of [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ]) {
    out.push([x + lx * c + lz * s, z - lx * s + lz * c]);
  }
  return out;
}

function treadsOf(
  points: readonly (readonly [number, number, number])[],
  halfWidth: number,
): FieldMapSegment[] {
  const out: FieldMapSegment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, az, ah] = points[i];
    const [bx, bz, bh] = points[i + 1];
    if (Math.abs(bh - ah) < 0.2) continue;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    const steps = Math.max(2, Math.round(len / 1.4));
    for (let k = 1; k < steps; k++) {
      const t = (k / steps) * len;
      const cx = ax + dx * t;
      const cz = az + dz * t;
      out.push({
        ax: cx - dz * halfWidth * 0.92,
        az: cz + dx * halfWidth * 0.92,
        bx: cx + dz * halfWidth * 0.92,
        bz: cz - dx * halfWidth * 0.92,
      });
    }
  }
  return out;
}

function gateBar(g: DungeonGateDef): FieldMapSegment & { seal: boolean } {
  // Three.js yaw: the gate's local x (its width) runs along (cos rot, -sin rot).
  const c = Math.cos(g.rot);
  const s = Math.sin(g.rot);
  return {
    ax: g.x - c * g.hw,
    az: g.z + s * g.hw,
    bx: g.x + c * g.hw,
    bz: g.z - s * g.hw,
    seal: g.kind === 'fog_wall',
  };
}

const plans = new WeakMap<AuthoredFieldDef, FieldMapPlan>();

/** The painted-map plan of a field (cached per record), with the gates of the
 *  dungeon whose interior it is. */
export function fieldMapPlan(def: AuthoredFieldDef): FieldMapPlan {
  const cached = plans.get(def);
  if (cached) return cached;
  const gates = Object.values(DUNGEONS).find((d) => d.interior === def.key)?.gates ?? [];
  let heightMin = Infinity;
  let heightMax = -Infinity;
  const surfaces: FieldMapSurface[] = [];
  const treads: FieldMapSegment[] = [];
  for (const s of def.surfaces) {
    // A hidden surface (a raised drawbridge) is not ground the map can promise.
    if (s.hidden) continue;
    const h =
      s.kind === 'path' ? s.points.reduce((sum, p) => sum + p[2], 0) / s.points.length : s.h;
    heightMin = Math.min(heightMin, h);
    heightMax = Math.max(heightMax, h);
    surfaces.push({
      points: surfaceOutline(s),
      ground: s.ground ?? (s.kind === 'path' ? 'flagstone' : 'earth'),
      h,
      path: s.kind === 'path',
    });
    if (s.kind === 'path' && s.stairs) treads.push(...treadsOf(s.points, s.halfWidth));
  }
  const cliffs: FieldMapCliff[] = authoredFieldCliffRuns(def).map((run) => ({
    ax: run.ax,
    az: run.az,
    bx: run.bx,
    bz: run.bz,
    nx: run.nx,
    nz: run.nz,
    drop: run.high - run.low,
    intoVoid: run.low <= def.voidHeight + 0.5,
    masonry: run.style === 'masonry' || run.style === 'balustrade',
  }));
  const walls = def.walls.map((w) => boxCorners(w.x, w.z, w.hw, w.hd, w.rot));
  const props: FieldMapProp[] = [];
  const landmarks: FieldMapPlan['landmarks'] = [];
  for (const p of def.props) {
    const mark = landmarkOf(p.kind);
    if (mark) landmarks.push({ kind: mark, x: p.x, z: p.z });
    if (p.r !== undefined) props.push({ x: p.x, z: p.z, r: p.r, corners: null });
    else if (p.hw !== undefined && p.hd !== undefined)
      props.push({ x: p.x, z: p.z, r: null, corners: boxCorners(p.x, p.z, p.hw, p.hd, p.rot) });
  }
  const b = def.bounds;
  const plan: FieldMapPlan = {
    key: def.key,
    bounds: {
      minX: b.minX - FIELD_MAP_MARGIN,
      maxX: b.maxX + FIELD_MAP_MARGIN,
      minZ: b.minZ - FIELD_MAP_MARGIN,
      maxZ: b.maxZ + FIELD_MAP_MARGIN,
    },
    void: def.mapVoid ?? 'mist',
    heightMin,
    heightMax,
    surfaces,
    treads,
    cliffs,
    walls,
    props,
    landmarks,
    gates: gates.map(gateBar),
    water: FIELD_MAP_WATER[def.key]?.() ?? { lines: [], pools: [] },
  };
  plans.set(def, plan);
  return plan;
}

/** The painted-map plan for a dungeon interior key, or null when the interior
 *  is not an authored open-air field. */
export function fieldMapForInterior(interior: string): FieldMapPlan | null {
  const def = authoredFieldFor(interior);
  return def ? fieldMapPlan(def) : null;
}

/** 0..1 height of a surface within its field (the tint ramp's input). */
export function fieldMapHeightShare(plan: FieldMapPlan, h: number): number {
  const span = plan.heightMax - plan.heightMin;
  return span > 0 ? (h - plan.heightMin) / span : 0.5;
}
