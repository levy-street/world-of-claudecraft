// Pure, host-agnostic draw model for the Gravemarch battleground schematic
// map (the delve-map precedent: docs/prd/battlegrounds.md "Map/minimap").
//
// The pure-core half of the pure-core + canvas-painter split (reference
// delve_map.ts + delve_map_painter.ts): it projects the authored layout
// (src/sim/battleground_layout.ts, plain data, a sanctioned sim import) and
// the BgMatchInfo snapshot into canvas-pixel primitives; the painter
// (battleground_map_painter.ts) only resolves --color-bg-* tokens and strokes.
//
// Classic fidelity: enemy champions are NEVER drawn here. The dynamic markers
// are the team structures (hollow when destroyed), the own-team ally dots
// (match.allies), the Knell, and the self arrow.
//
// Canvas space matches the minimap/delve convention: +X is map-LEFT, north
// (+z, the Pale Company base) is up. One uniform scale on both axes (the field
// is taller than wide, so x letterboxes) keeps shapes true.

import {
  BG_BASE_WALL_Z,
  BG_CHAPEL_R,
  BG_HALF_X,
  BG_HALF_Z,
  bgLaneWaypoints,
} from '../sim/battleground_layout';
import type { BgMatchInfo, BgTeamId, IWorld } from '../world_api';

export interface BgMapPoint {
  cx: number;
  cy: number;
}

export interface BgMapSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The static (per-canvas-size cacheable) schematic geometry. */
export interface BgMapStatic {
  /** Cache key: the layout is constant, so only the canvas size matters. */
  sizeSig: string;
  /** The field footprint rectangle. */
  field: { x: number; y: number; w: number; h: number };
  /** The two roads (Shield Road west, Spear Road east) as polylines. */
  roads: BgMapPoint[][];
  /** Base wall segments (both teams; the gate openings are the gaps). */
  walls: BgMapSegment[];
  /** The center bell-chapel ring. */
  chapel: { cx: number; cy: number; r: number };
}

export interface BgMapStructureMarker extends BgMapPoint {
  team: BgTeamId;
  kind: 'warstone' | 'bulwark';
  alive: boolean;
}

export interface BgMapModel {
  statics: BgMapStatic;
  structures: BgMapStructureMarker[];
  allies: BgMapPoint[];
  knell: (BgMapPoint & { alive: boolean }) | null;
  player: BgMapPoint & { angle: number };
}

/** Uniform px-per-yard scale: fit the taller z extent inside the padded canvas. */
function bgMapScale(canvasSize: number, pad: number): number {
  return (canvasSize - pad * 2) / (BG_HALF_Z * 2);
}

/** Instance-local (x, z) to canvas (cx, cy): +X map-left, +z (north) up. */
export function bgLocalToCanvas(
  localX: number,
  localZ: number,
  canvasSize: number,
  pad: number,
): BgMapPoint {
  const s = bgMapScale(canvasSize, pad);
  const half = canvasSize / 2;
  return { cx: half - localX * s, cy: half - localZ * s };
}

/** Build the static schematic geometry for one canvas size (painter-cached). */
export function bgMapStatic(canvasSize: number, pad: number): BgMapStatic {
  const to = (x: number, z: number) => bgLocalToCanvas(x, z, canvasSize, pad);
  const s = bgMapScale(canvasSize, pad);

  const nw = to(BG_HALF_X, BG_HALF_Z); // +x is map-left, +z is up
  const field = {
    x: nw.cx,
    y: nw.cy,
    w: BG_HALF_X * 2 * s,
    h: BG_HALF_Z * 2 * s,
  };

  // Team A's waypoint lists trace each road end to end; drop the final
  // waypoint (the enemy warstone itself) so the road stops at the base.
  const roads = (['west', 'east'] as const).map((lane) => {
    const wps = bgLaneWaypoints('A', lane);
    return wps.slice(0, wps.length - 1).map((p) => to(p.x, p.z));
  });

  // Base walls at |z| = BG_BASE_WALL_Z, drawn as one segment per side (the
  // schematic keeps the silhouette; the gates read from the roads crossing).
  const walls: BgMapSegment[] = [];
  for (const sign of [-1, 1]) {
    const a = to(-BG_HALF_X, BG_BASE_WALL_Z * sign);
    const b = to(BG_HALF_X, BG_BASE_WALL_Z * sign);
    walls.push({ x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy });
  }

  const center = to(0, 0);
  return {
    sizeSig: `${canvasSize}x${pad}`,
    field,
    roads,
    walls,
    chapel: { cx: center.cx, cy: center.cy, r: BG_CHAPEL_R * s },
  };
}

/**
 * Build the full draw model for one frame. Returns null when there is no
 * battleground match to draw. Reads only IWorld members (bgInfo.match,
 * player), so the offline Sim and the online ClientWorld mirror produce
 * identical output. `statics` should be the cached bgMapStatic for the size.
 */
export function bgMapModel(
  world: IWorld,
  statics: BgMapStatic,
  canvasSize: number,
  pad: number,
): BgMapModel | null {
  const match: BgMatchInfo | null = world.bgInfo?.match ?? null;
  if (!match) return null;
  const origin = match.origin;
  const to = (wx: number, wz: number) =>
    bgLocalToCanvas(wx - origin.x, wz - origin.z, canvasSize, pad);

  const structures: BgMapStructureMarker[] = match.structures.map((s) => ({
    ...to(s.x, s.z),
    team: s.team,
    kind: s.kind,
    alive: s.alive,
  }));

  const p = world.player;
  const allies: BgMapPoint[] = [];
  for (const a of match.allies) {
    if (a.pid === p.id) continue; // self is the arrow, not an ally dot
    allies.push(to(a.x, a.z));
  }

  const knell = { ...to(match.knell.x, match.knell.z), alive: match.knell.alive };

  return {
    statics,
    structures,
    allies,
    knell,
    player: { ...to(p.pos.x, p.pos.z), angle: -p.facing },
  };
}
