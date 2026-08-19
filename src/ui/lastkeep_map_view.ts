// Pure, host-agnostic model for the walk-in castle interior maps (the floor
// plans the minimap and the world-map window show inside The Last Keep and
// Dawnhold Castle instances).
//
// The pure-core half of the pure-core + canvas-painter split (reference
// hud/delve/delve_map.ts / minimap_markers.ts), PARAMETERIZED over a
// CastlePlanSpec so both authored castle interiors share one implementation.
// Two jobs, one source of truth per interior:
//
// 1. BAKE-TIME: lastKeepPlanSvg / dawnholdPlanSvg render one deterministic SVG
//    floor plan per STORY straight from the authored rooms/doors (rooms as
//    subtle fills, walls from authoredWallSegments so door openings are real
//    gaps, stair rungs across every lift-changing doorway; the active story
//    bright, the other stories dimmed for context).
//    scripts/build_lastkeep_map.mjs / build_dawnhold_map.mjs encode those SVGs
//    to the shipped public/map_bg/<interior>_<story>.webp plates, and the
//    per-interior fingerprints pin them fresh (tests/lastkeep_map_baked.test.ts
//    and tests/dawnhold_map_baked.test.ts red until a re-bake).
// 2. RUNTIME: the build*MinimapModel / build*WorldMapModel pairs map IWorld
//    state to a flat draw model in canvas-pixel space (the plate blit rect plus
//    player / party / exit / loot markers), selected per story by the player's
//    current lift on instance-local coords. The painter
//    (lastkeep_map_painter.ts) owns the 2D context, the plate image cache, the
//    color tokens, and the localized story title.
//
// Coordinate convention matches the overworld map surfaces: +X is map-LEFT
// (east = -X) and +Z is map-UP, so the compass reading inside a castle matches
// the world and the player arrow uses the same angle = -facing convention.
//
// DOM-free / i18n-free / Three-free / deterministic so the map-view tests can
// drive it with both a Sim-shaped and a ClientWorld-mirror-shaped IWorld stub
// (position-derived only, so it is host-agnostic by construction).

import { dungeonAt, instanceOrigin, instanceSlotForZ } from '../sim/data';
import {
  DAWNHOLD_DOORS,
  DAWNHOLD_ROOMS,
  DUNGEON_WALL_HW,
  dawnholdKeepLiftAt,
  LASTKEEP_DOORS,
  LASTKEEP_ROOMS,
  lastKeepLiftAt,
} from '../sim/dungeon_layout';
import {
  type AuthoredDoor,
  type AuthoredRoom,
  authoredWallSegments,
  doorRampHalf,
  roomAt,
} from '../sim/rift/authored';
import type { IWorld } from '../world_api';

// ---------------------------------------------------------------------------
// Stories: each castle's lift bands. The lift field is single-valued (stories
// sit side by side in plan), so a story is a BAND of lifts and the
// half-landing stair rooms classify with the story they climb toward.
// Thresholds are midpoints between adjacent authored lift values.
// ---------------------------------------------------------------------------

export type LastKeepStoryId = 'undercroft' | 'state' | 'residence' | 'tower';

export const LASTKEEP_STORY_IDS: readonly LastKeepStoryId[] = [
  'undercroft',
  'state',
  'residence',
  'tower',
];

// The Last Keep's bands: gaol stair 1.5 / state 3.0, throne dais 4.2 /
// residence stairs 4.5, residence 6.0 / tower 7.5.
const UNDERCROFT_MAX_LIFT = 2.25;
const STATE_MAX_LIFT = 4.35;
const RESIDENCE_MAX_LIFT = 6.75;

/** The story a lift value (from lastKeepLiftAt, ramps included) belongs to. */
export function lastKeepStoryForLift(lift: number): LastKeepStoryId {
  if (lift < UNDERCROFT_MAX_LIFT) return 'undercroft';
  if (lift < STATE_MAX_LIFT) return 'state';
  if (lift < RESIDENCE_MAX_LIFT) return 'residence';
  return 'tower';
}

export type DawnholdStoryId = 'ground' | 'solar';

export const DAWNHOLD_STORY_IDS: readonly DawnholdStoryId[] = ['ground', 'solar'];

// Dawnhold's bands: ground 0 / solar stair 1.5 (the stair classifies with the
// solar story it climbs toward, the lastkeep half-landing convention).
const DAWNHOLD_GROUND_MAX_LIFT = 0.75;

/** The story a lift value (from dawnholdKeepLiftAt, ramps included) belongs to. */
export function dawnholdStoryForLift(lift: number): DawnholdStoryId {
  return lift < DAWNHOLD_GROUND_MAX_LIFT ? 'ground' : 'solar';
}

// ---------------------------------------------------------------------------
// The per-interior plan spec: everything the shared implementation needs.
// ---------------------------------------------------------------------------

interface CastlePlanSpec<S extends string> {
  /** The DungeonDef.interior this plan activates for. */
  interior: string;
  rooms: readonly AuthoredRoom[];
  doors: readonly AuthoredDoor[];
  storyIds: readonly S[];
  storyForLift: (lift: number) => S;
  liftAt: (lx: number, lz: number) => number;
}

const LASTKEEP_SPEC: CastlePlanSpec<LastKeepStoryId> = {
  interior: 'lastkeep',
  rooms: LASTKEEP_ROOMS,
  doors: LASTKEEP_DOORS,
  storyIds: LASTKEEP_STORY_IDS,
  storyForLift: lastKeepStoryForLift,
  liftAt: lastKeepLiftAt,
};

const DAWNHOLD_SPEC: CastlePlanSpec<DawnholdStoryId> = {
  interior: 'dawnhold',
  rooms: DAWNHOLD_ROOMS,
  doors: DAWNHOLD_DOORS,
  storyIds: DAWNHOLD_STORY_IDS,
  storyForLift: dawnholdStoryForLift,
  liftAt: dawnholdKeepLiftAt,
};

// ---------------------------------------------------------------------------
// Instance-local position: each castle sits at the overflow instance origin
// for its dungeon index; slots stack along z. Position-derived only (online
// snapshots mirror positions the same way), so both IWorld hosts agree.
// ---------------------------------------------------------------------------

export interface LastKeepLocalPos {
  originX: number;
  originZ: number;
  lx: number;
  lz: number;
}

function castleLocal(interior: string, x: number, z: number): LastKeepLocalPos | null {
  const dungeon = dungeonAt(x);
  if (!dungeon || dungeon.interior !== interior) return null;
  const origin = instanceOrigin(dungeon.index, instanceSlotForZ(z));
  return { originX: origin.x, originZ: origin.z, lx: x - origin.x, lz: z - origin.z };
}

/** Instance-local coords when (x, z) stands inside a lastkeep-interior
 *  dungeon instance, else null. The activation guard for both map surfaces. */
export function lastKeepLocal(x: number, z: number): LastKeepLocalPos | null {
  return castleLocal('lastkeep', x, z);
}

/** Instance-local coords when (x, z) stands inside a dawnhold-interior
 *  dungeon instance, else null. */
export function dawnholdLocal(x: number, z: number): LastKeepLocalPos | null {
  return castleLocal('dawnhold', x, z);
}

/** Whether this world's player is inside The Last Keep (the branch guard Hud
 *  routes the minimap / map window through, like minimapMode's delve arm). */
export function lastKeepMapActive(world: IWorld): boolean {
  return lastKeepLocal(world.player.pos.x, world.player.pos.z) !== null;
}

/** Whether this world's player is inside Dawnhold Castle (the same guard). */
export function dawnholdMapActive(world: IWorld): boolean {
  return dawnholdLocal(world.player.pos.x, world.player.pos.z) !== null;
}

// ---------------------------------------------------------------------------
// Plate geometry: one fixed world rect (instance-local) per castle covers the
// whole plan, baked at a fixed resolution. Single source of truth for the
// bakers, the runtime blit math, and the freshness tests.
// ---------------------------------------------------------------------------

/** Baked plate resolution. 8 px per yard keeps the widest room readable and
 *  the plates together well under the size of one zone terrain plate. */
export const LASTKEEP_PLATE_PX_PER_YD = 8;
// World-space margin around the outermost wall centreline so wall thickness
// and the dim surround never clip at the plate edge.
const PLATE_MARGIN_YD = 3;

export interface LastKeepPlanBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function computePlanBounds(rooms: readonly AuthoredRoom[]): LastKeepPlanBounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const r of rooms) {
    minX = Math.min(minX, r.x0);
    maxX = Math.max(maxX, r.x1);
    minZ = Math.min(minZ, r.z0);
    maxZ = Math.max(maxZ, r.z1);
  }
  const pad = DUNGEON_WALL_HW + PLATE_MARGIN_YD;
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
}

const LASTKEEP_BOUNDS = computePlanBounds(LASTKEEP_ROOMS);
const DAWNHOLD_BOUNDS = computePlanBounds(DAWNHOLD_ROOMS);

function boundsFor(spec: CastlePlanSpec<string>): LastKeepPlanBounds {
  return spec.interior === 'lastkeep' ? LASTKEEP_BOUNDS : DAWNHOLD_BOUNDS;
}

/** The instance-local world rect every Last Keep plate covers. */
export function lastKeepPlanBounds(): LastKeepPlanBounds {
  return LASTKEEP_BOUNDS;
}

/** The instance-local world rect every Dawnhold plate covers. */
export function dawnholdPlanBounds(): LastKeepPlanBounds {
  return DAWNHOLD_BOUNDS;
}

function plateSize(b: LastKeepPlanBounds): { w: number; h: number } {
  return {
    w: Math.round((b.maxX - b.minX) * LASTKEEP_PLATE_PX_PER_YD),
    h: Math.round((b.maxZ - b.minZ) * LASTKEEP_PLATE_PX_PER_YD),
  };
}

/** Baked plate pixel size (identical for every Last Keep story). */
export function lastKeepPlateSize(): { w: number; h: number } {
  return plateSize(LASTKEEP_BOUNDS);
}

/** Baked plate pixel size (identical for every Dawnhold story). */
export function dawnholdPlateSize(): { w: number; h: number } {
  return plateSize(DAWNHOLD_BOUNDS);
}

// ---------------------------------------------------------------------------
// The SVG floor plan. Colors are authored plate pigments (like the delve
// schematic's hexes in hud/delve/delve_map.ts): a baked image cannot read CSS
// tokens, and the palette is chosen to sit beside the zone plates
// (public/map_bg/drakelands.webp) - dark parchment stone, warm wall lines.
// Both castles share the palette so their maps read as one family.
// ---------------------------------------------------------------------------

const ROOM_FILL_ACTIVE = '#37301f';
const ROOM_FILL_INACTIVE = '#1a1610';
const WALL_ACTIVE = '#8a7850';
const WALL_INACTIVE = '#3d362a';
const STAIR_ACTIVE = '#b09c6a';
const STAIR_INACTIVE = '#4d4433';
const STAIR_RUNG_COUNT = 4;
const STAIR_RUNG_WIDTH_YD = 0.35;

// The two rooms a door joins, recovered by the same shared-wall-line rule
// authoredLiftAt uses, so the plan's stair rungs land exactly on the ramps the
// sim walks.
function doorRoomPair(
  rooms: readonly AuthoredRoom[],
  door: AuthoredDoor,
): [AuthoredRoom, AuthoredRoom] | null {
  const south = rooms.find((r) => r.z1 === door.z && door.x >= r.x0 && door.x <= r.x1);
  const north = rooms.find((r) => r.z0 === door.z && door.x >= r.x0 && door.x <= r.x1);
  if (south && north) return [south, north];
  const west = rooms.find((r) => r.x1 === door.x && door.z >= r.z0 && door.z <= r.z1);
  const east = rooms.find((r) => r.x0 === door.x && door.z >= r.z0 && door.z <= r.z1);
  if (west && east) return [west, east];
  return null;
}

/**
 * The deterministic SVG floor plan for one story: every room drawn (stories
 * are side by side in plan, so the full silhouette gives context), the active
 * story's rooms and walls bright, the rest dimmed; door openings are true
 * gaps in the wall runs; every lift-changing doorway carries stair rungs.
 */
function planSvg<S extends string>(spec: CastlePlanSpec<S>, storyId: S): string {
  const b = boundsFor(spec);
  const { w, h } = plateSize(b);
  // Instance-local world -> plate pixel (+X map-left, +Z map-up).
  const plateU = (x: number): number => (b.maxX - x) * LASTKEEP_PLATE_PX_PER_YD;
  const plateV = (z: number): number => (b.maxZ - z) * LASTKEEP_PLATE_PX_PER_YD;
  const svgRect = (x0: number, x1: number, z0: number, z1: number, fill: string): string => {
    const x = plateU(x1);
    const y = plateV(z1);
    const rw = plateU(x0) - x;
    const rh = plateV(z0) - y;
    return `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="${fill}"/>`;
  };
  const storyOfRoom = (room: AuthoredRoom): S => spec.storyForLift(room.lift ?? 0);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
  ];

  // Room floors (authored order; rooms never overlap).
  for (const room of spec.rooms) {
    const fill = storyOfRoom(room) === storyId ? ROOM_FILL_ACTIVE : ROOM_FILL_INACTIVE;
    parts.push(svgRect(room.x0, room.x1, room.z0, room.z1, fill));
  }

  // Wall runs (door openings already subtracted by authoredWallSegments). A
  // run is bright when it borders a room of the active story on either side.
  const hw = DUNGEON_WALL_HW;
  for (const seg of authoredWallSegments(spec.rooms, spec.doors)) {
    const mid = (seg.a + seg.b) / 2;
    const sideA =
      seg.axis === 'x'
        ? roomAt(spec.rooms, mid, seg.fixed - hw - 0.1)
        : roomAt(spec.rooms, seg.fixed - hw - 0.1, mid);
    const sideB =
      seg.axis === 'x'
        ? roomAt(spec.rooms, mid, seg.fixed + hw + 0.1)
        : roomAt(spec.rooms, seg.fixed + hw + 0.1, mid);
    const active =
      (sideA !== null && storyOfRoom(sideA) === storyId) ||
      (sideB !== null && storyOfRoom(sideB) === storyId);
    const fill = active ? WALL_ACTIVE : WALL_INACTIVE;
    if (seg.axis === 'x') {
      parts.push(svgRect(seg.a, seg.b, seg.fixed - hw, seg.fixed + hw, fill));
    } else {
      parts.push(svgRect(seg.fixed - hw, seg.fixed + hw, seg.a, seg.b, fill));
    }
  }

  // Stair rungs across every lift-changing doorway (the ramp band the sim
  // walks, doorRampHalf), perpendicular to the direction of travel.
  for (const door of spec.doors) {
    const pair = doorRoomPair(spec.rooms, door);
    if (!pair) continue;
    const liftA = pair[0].lift ?? 0;
    const liftB = pair[1].lift ?? 0;
    if (liftA === liftB) continue;
    const active = storyOfRoom(pair[0]) === storyId || storyOfRoom(pair[1]) === storyId;
    const fill = active ? STAIR_ACTIVE : STAIR_INACTIVE;
    const zWall = pair[0].z1 === door.z || pair[0].z0 === door.z;
    const across = zWall ? door.hd : door.hw;
    const ramp = doorRampHalf(across, liftB - liftA);
    for (let i = 1; i <= STAIR_RUNG_COUNT; i++) {
      const t = -ramp + (2 * ramp * i) / (STAIR_RUNG_COUNT + 1);
      if (zWall) {
        parts.push(
          svgRect(
            door.x - door.hw,
            door.x + door.hw,
            door.z + t - STAIR_RUNG_WIDTH_YD / 2,
            door.z + t + STAIR_RUNG_WIDTH_YD / 2,
            fill,
          ),
        );
      } else {
        parts.push(
          svgRect(
            door.x + t - STAIR_RUNG_WIDTH_YD / 2,
            door.x + t + STAIR_RUNG_WIDTH_YD / 2,
            door.z - door.hd,
            door.z + door.hd,
            fill,
          ),
        );
      }
    }
  }

  parts.push('</svg>');
  return parts.join('\n');
}

export function lastKeepPlanSvg(storyId: LastKeepStoryId): string {
  return planSvg(LASTKEEP_SPEC, storyId);
}

export function dawnholdPlanSvg(storyId: DawnholdStoryId): string {
  return planSvg(DAWNHOLD_SPEC, storyId);
}

// FNV-1a fingerprint over all of one castle's story SVGs: the freshness pin
// its baked manifest carries (the baked-plate tests recompute it from the
// live layout, so a layout or palette change reds until a re-bake).
function planFingerprint<S extends string>(spec: CastlePlanSpec<S>): string {
  let hash = 0x811c9dc5;
  for (const storyId of spec.storyIds) {
    const svg = planSvg(spec, storyId);
    for (let i = 0; i < svg.length; i++) {
      hash ^= svg.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}

export function lastKeepPlanFingerprint(): string {
  return planFingerprint(LASTKEEP_SPEC);
}

export function dawnholdPlanFingerprint(): string {
  return planFingerprint(DAWNHOLD_SPEC);
}

// ---------------------------------------------------------------------------
// Runtime draw models (canvas-pixel space; the painter only blits + strokes).
// ---------------------------------------------------------------------------

// Markers beyond (S/2 - RIM_INSET) from the minimap centre are culled, the
// same rim rule as the overworld minimap core.
const RIM_INSET = 7;

export interface LastKeepPlateRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export type LastKeepMarker =
  // The exit portal back to the overworld.
  | { kind: 'exit'; cx: number; cy: number }
  // A lootable ground object (the castle's keepsake).
  | { kind: 'loot'; cx: number; cy: number }
  // A party member (class-colored disc, like the delve schematic).
  | { kind: 'party'; cx: number; cy: number; cls: string; dead: boolean }
  // The local player's facing arrow, drawn last.
  | { kind: 'player'; cx: number; cy: number; angle: number };

export interface LastKeepMapModel {
  /** The story the player currently stands on (selects the plate + label). */
  storyId: string;
  /** Where the story plate blits on the canvas, in px. */
  plate: LastKeepPlateRect;
  markers: LastKeepMarker[];
}

// Shared marker collector: projects exit/loot objects, party members, and the
// player through the surface's local->canvas transform, in draw order.
function collectMarkers(
  world: IWorld,
  local: LastKeepLocalPos,
  toCanvas: (lx: number, lz: number) => { cx: number; cy: number },
  visible: (cx: number, cy: number) => boolean,
): LastKeepMarker[] {
  const markers: LastKeepMarker[] = [];
  const p = world.player;
  for (const e of world.entities.values()) {
    if (e.id === p.id || e.kind !== 'object') continue;
    const isExit = e.templateId === 'dungeon_exit' || e.templateId === 'dungeon_door';
    if (!isExit && !e.lootable) continue;
    const { cx, cy } = toCanvas(e.pos.x - local.originX, e.pos.z - local.originZ);
    if (!visible(cx, cy)) continue;
    markers.push({ kind: isExit ? 'exit' : 'loot', cx, cy });
  }
  const party = world.partyInfo;
  if (party) {
    for (const m of party.members) {
      if (m.pid === p.id) continue;
      const { cx, cy } = toCanvas(m.x - local.originX, m.z - local.originZ);
      if (!visible(cx, cy)) continue;
      markers.push({ kind: 'party', cx, cy, cls: m.cls, dead: m.dead !== 0 });
    }
  }
  const { cx, cy } = toCanvas(local.lx, local.lz);
  markers.push({ kind: 'player', cx, cy, angle: -p.facing });
  return markers;
}

/**
 * Minimap model: player-centered at the overworld marker scale (pxPerYard =
 * base scale * zoom), the story plate placed by its world rect so the player
 * sits at centre (the same blit math as the overworld zone-bg overlay).
 * Null when the player is not inside the castle.
 */
function buildMinimapModel<S extends string>(
  spec: CastlePlanSpec<S>,
  world: IWorld,
  S_: number,
  pxPerYard: number,
): LastKeepMapModel | null {
  const p = world.player;
  const local = castleLocal(spec.interior, p.pos.x, p.pos.z);
  if (!local) return null;
  const storyId = spec.storyForLift(spec.liftAt(local.lx, local.lz));
  const half = S_ / 2;
  const rim = half - RIM_INSET;
  const rim2 = rim * rim;
  const b = boundsFor(spec);
  const plate: LastKeepPlateRect = {
    dx: half - (b.maxX - local.lx) * pxPerYard,
    dy: half - (b.maxZ - local.lz) * pxPerYard,
    dw: (b.maxX - b.minX) * pxPerYard,
    dh: (b.maxZ - b.minZ) * pxPerYard,
  };
  const toCanvas = (lx: number, lz: number): { cx: number; cy: number } => ({
    cx: half - (lx - local.lx) * pxPerYard,
    cy: half - (lz - local.lz) * pxPerYard,
  });
  const visible = (cx: number, cy: number): boolean =>
    (cx - half) * (cx - half) + (cy - half) * (cy - half) <= rim2;
  return { storyId, plate, markers: collectMarkers(world, local, toCanvas, visible) };
}

/**
 * World-map model: the whole plan framed inside the square canvas at a uniform
 * scale (letterboxed on the shorter axis), markers projected with the same
 * transform. Null when the player is not inside the castle.
 */
function buildWorldMapModel<S extends string>(
  spec: CastlePlanSpec<S>,
  world: IWorld,
  S_: number,
  pad: number,
): LastKeepMapModel | null {
  const p = world.player;
  const local = castleLocal(spec.interior, p.pos.x, p.pos.z);
  if (!local) return null;
  const storyId = spec.storyForLift(spec.liftAt(local.lx, local.lz));
  const b = boundsFor(spec);
  const spanX = b.maxX - b.minX;
  const spanZ = b.maxZ - b.minZ;
  const scale = Math.min((S_ - pad * 2) / spanX, (S_ - pad * 2) / spanZ);
  const ox = (S_ - spanX * scale) / 2;
  const oy = (S_ - spanZ * scale) / 2;
  const plate: LastKeepPlateRect = { dx: ox, dy: oy, dw: spanX * scale, dh: spanZ * scale };
  const toCanvas = (lx: number, lz: number): { cx: number; cy: number } => ({
    cx: ox + (b.maxX - lx) * scale,
    cy: oy + (b.maxZ - lz) * scale,
  });
  const visible = (cx: number, cy: number): boolean => cx >= 0 && cx <= S_ && cy >= 0 && cy <= S_;
  return { storyId, plate, markers: collectMarkers(world, local, toCanvas, visible) };
}

export function buildLastKeepMinimapModel(
  world: IWorld,
  S: number,
  pxPerYard: number,
): LastKeepMapModel | null {
  return buildMinimapModel(LASTKEEP_SPEC, world, S, pxPerYard);
}

export function buildLastKeepWorldMapModel(
  world: IWorld,
  S: number,
  pad: number,
): LastKeepMapModel | null {
  return buildWorldMapModel(LASTKEEP_SPEC, world, S, pad);
}

export function buildDawnholdMinimapModel(
  world: IWorld,
  S: number,
  pxPerYard: number,
): LastKeepMapModel | null {
  return buildMinimapModel(DAWNHOLD_SPEC, world, S, pxPerYard);
}

export function buildDawnholdWorldMapModel(
  world: IWorld,
  S: number,
  pad: number,
): LastKeepMapModel | null {
  return buildWorldMapModel(DAWNHOLD_SPEC, world, S, pad);
}
