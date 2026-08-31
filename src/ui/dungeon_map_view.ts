// Pure floor-plan model shared by the M-map and minimap while the player is
// inside any dungeon. Geometry comes straight from DungeonLayout: authored
// rooms/doors, polygon arenas, collider-backed decor footprints, and the dais.
// The painter therefore cannot drift from the walls and obstacles enforced by
// the authoritative Sim. Position-only instance resolution keeps offline Sim
// and online ClientWorld mirrors on the same path.

import { MOBS } from '../sim/data';
import { dungeonInstanceAt } from '../sim/dungeon_floor';
import { DUNGEON_WALL_HW, type DungeonLayout } from '../sim/dungeon_layout';
import { IGNIVAR_GATE_LOCKED_TEMPLATE } from '../sim/ignivar_raid_ids';
import { authoredWallSegments } from '../sim/rift/authored';
import { PLAYER_INTEREST_RADIUS } from '../sim/types';
import type { IWorld } from '../world_api';

const PLAN_MARGIN_YD = DUNGEON_WALL_HW + 2;
const MINIMAP_RIM_INSET = 7;
const NPC_INTEREST_RADIUS = 120;

function hasDedicatedCastleMap(interior: string): boolean {
  return interior === 'lastkeep' || interior === 'dawnhold';
}

export interface DungeonMapPoint {
  cx: number;
  cy: number;
}

export interface DungeonMapPolygon {
  points: DungeonMapPoint[];
}

export interface DungeonMapWall {
  a: DungeonMapPoint;
  b: DungeonMapPoint;
  width: number;
}

export interface DungeonMapCircle {
  cx: number;
  cy: number;
  r: number;
}

export interface DungeonMapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type DungeonMapMarker =
  | { kind: 'exit'; cx: number; cy: number }
  | { kind: 'gate'; cx: number; cy: number }
  | { kind: 'loot'; cx: number; cy: number; source: 'enemy' | 'object' }
  | { kind: 'npc'; cx: number; cy: number; templateId: string }
  | {
      kind: 'mob';
      cx: number;
      cy: number;
      templateId: string;
      aggro: boolean;
      boss: boolean;
    }
  | { kind: 'party'; cx: number; cy: number; cls: string; dead: boolean }
  | { kind: 'player'; cx: number; cy: number; angle: number };

export interface DungeonMapStaticGeometry {
  /** Exact authoritative layout used to derive this draw model. */
  sourceLayout: DungeonLayout;
  canvasWidth: number;
  canvasHeight: number;
  /** Instance-local bounds, including a small wall-safe framing margin. */
  bounds: DungeonMapBounds;
  floors: DungeonMapPolygon[];
  walls: DungeonMapWall[];
  doors: DungeonMapPolygon[];
  obstacles: DungeonMapCircle[];
  dais: DungeonMapCircle | null;
}

export interface DungeonMapModel extends DungeonMapStaticGeometry {
  dungeonId: string;
  staticGeometry: DungeonMapStaticGeometry;
  markers: DungeonMapMarker[];
}

export interface DungeonMinimapPaintModel {
  dungeonId: string;
  staticGeometry: DungeonMapStaticGeometry;
  plateX: number;
  plateY: number;
  markers: DungeonMapMarker[];
}

export interface DungeonMapLocal {
  dungeonId: string;
  layout: DungeonLayout;
  originX: number;
  originZ: number;
  lx: number;
  lz: number;
}

interface LocalPoint {
  x: number;
  z: number;
}

interface LocalWall {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

interface LocalCircle {
  x: number;
  z: number;
  r: number;
}

interface LocalPlan {
  bounds: DungeonMapBounds;
  floors: LocalPoint[][];
  walls: LocalWall[];
  doors: LocalPoint[][];
  obstacles: LocalCircle[];
  dais: LocalCircle;
}

interface Projection {
  scale: number;
  point: (x: number, z: number) => DungeonMapPoint;
}

const planCache = new WeakMap<DungeonLayout, LocalPlan>();
const projectedGeometryCache = new WeakMap<DungeonLayout, Map<string, DungeonMapStaticGeometry>>();

function rectPoints(x0: number, x1: number, z0: number, z1: number): LocalPoint[] {
  return [
    { x: x0, z: z0 },
    { x: x1, z: z0 },
    { x: x1, z: z1 },
    { x: x0, z: z1 },
  ];
}

function planFor(layout: DungeonLayout): LocalPlan {
  const cached = planCache.get(layout);
  if (cached) return cached;

  let floors: LocalPoint[][];
  let walls: LocalWall[];
  if (layout.rooms && layout.rooms.length > 0) {
    floors = layout.rooms.map((room) => rectPoints(room.x0, room.x1, room.z0, room.z1));
    walls = authoredWallSegments(layout.rooms, layout.doors ?? []).map((wall) =>
      wall.axis === 'x'
        ? { ax: wall.a, az: wall.fixed, bx: wall.b, bz: wall.fixed }
        : { ax: wall.fixed, az: wall.a, bx: wall.fixed, bz: wall.b },
    );
  } else if (layout.shellPolygon && layout.shellPolygon.length >= 3) {
    floors = [layout.shellPolygon.map((point) => ({ x: point.x, z: point.z }))];
    walls = layout.shellPolygon.map((point, index, polygon) => {
      const next = polygon[(index + 1) % polygon.length];
      return { ax: point.x, az: point.z, bx: next.x, bz: next.z };
    });
  } else {
    const halfX = layout.floorHalfX ?? layout.wallX ?? 23;
    floors = [rectPoints(-halfX, halfX, layout.zMin, layout.zMax)];
    walls = [
      { ax: -halfX, az: layout.zMin, bx: halfX, bz: layout.zMin },
      { ax: halfX, az: layout.zMin, bx: halfX, bz: layout.zMax },
      { ax: halfX, az: layout.zMax, bx: -halfX, bz: layout.zMax },
      { ax: -halfX, az: layout.zMax, bx: -halfX, bz: layout.zMin },
    ];
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const floor of floors) {
    for (const point of floor) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
  }
  const bounds: DungeonMapBounds = {
    minX: minX - PLAN_MARGIN_YD,
    maxX: maxX + PLAN_MARGIN_YD,
    minZ: minZ - PLAN_MARGIN_YD,
    maxZ: maxZ + PLAN_MARGIN_YD,
  };
  const doors = (layout.doors ?? []).map((door) =>
    rectPoints(door.x - door.hw, door.x + door.hw, door.z - door.hd, door.z + door.hd),
  );
  const obstacles = (layout.decor ?? [])
    .filter(
      (decor): decor is typeof decor & { r: number } =>
        Number.isFinite(decor.r) && (decor.r ?? 0) > 0,
    )
    .map((decor) => ({ x: decor.x, z: decor.z, r: decor.r }));
  const plan: LocalPlan = {
    bounds,
    floors,
    walls,
    doors,
    obstacles,
    dais: { ...layout.dais },
  };
  planCache.set(layout, plan);
  return plan;
}

/** Resolve the mapped dungeon and instance-local player position from world coordinates. */
export function dungeonMapLocal(x: number, z: number): DungeonMapLocal | null {
  const frame = dungeonInstanceAt(x, z);
  if (!frame || hasDedicatedCastleMap(frame.interior)) return null;
  return {
    dungeonId: frame.dungeonId,
    layout: frame.layout,
    originX: frame.ox,
    originZ: frame.oz,
    lx: x - frame.ox,
    lz: z - frame.oz,
  };
}

/** Shared branch guard for the M-map and minimap. */
export function dungeonMapActive(world: IWorld): boolean {
  return dungeonMapLocal(world.player.pos.x, world.player.pos.z) !== null;
}

function projectPolygon(points: readonly LocalPoint[], projection: Projection): DungeonMapPolygon {
  return { points: points.map((point) => projection.point(point.x, point.z)) };
}

function collectMarkers(
  world: IWorld,
  local: DungeonMapLocal,
  projection: Projection,
  visible: (point: DungeonMapPoint) => boolean,
): DungeonMapMarker[] {
  const markers: DungeonMapMarker[] = [];
  const p = world.player;

  for (const entity of world.entities.values()) {
    if (entity.id === p.id) continue;
    const markerRadius = entity.kind === 'npc' ? NPC_INTEREST_RADIUS : PLAYER_INTEREST_RADIUS;
    const dx = entity.pos.x - p.pos.x;
    const dz = entity.pos.z - p.pos.z;
    if (dx * dx + dz * dz > markerRadius * markerRadius) continue;
    const point = projection.point(entity.pos.x - local.originX, entity.pos.z - local.originZ);
    if (!visible(point)) continue;
    if (entity.kind === 'object') {
      if (entity.templateId === IGNIVAR_GATE_LOCKED_TEMPLATE) {
        markers.push({ kind: 'gate', ...point });
      } else if (entity.templateId === 'dungeon_exit' || entity.templateId === 'dungeon_door') {
        markers.push({ kind: 'exit', ...point });
      } else if (entity.lootable) {
        markers.push({ kind: 'loot', ...point, source: 'object' });
      }
      continue;
    }
    if (entity.kind === 'npc') {
      markers.push({ kind: 'npc', ...point, templateId: entity.templateId });
      continue;
    }
    if (entity.kind !== 'mob' || !entity.hostile) continue;
    if (entity.dead) {
      if (entity.lootable) markers.push({ kind: 'loot', ...point, source: 'enemy' });
      continue;
    }
    markers.push({
      kind: 'mob',
      ...point,
      templateId: entity.templateId,
      aggro: entity.aggroTargetId === p.id,
      boss: MOBS[entity.templateId]?.boss === true,
    });
  }

  const party = world.partyInfo;
  if (party) {
    for (const member of party.members) {
      if (member.pid === p.id) continue;
      const point = projection.point(member.x - local.originX, member.z - local.originZ);
      if (!visible(point)) continue;
      markers.push({
        kind: 'party',
        ...point,
        cls: member.cls,
        dead: member.dead !== 0,
      });
    }
  }

  const playerPoint = projection.point(local.lx, local.lz);
  markers.push({ kind: 'player', ...playerPoint, angle: -p.facing });
  return markers;
}

function projectStaticGeometry(
  local: DungeonMapLocal,
  plan: LocalPlan,
  projection: Projection,
  canvasWidth: number,
  canvasHeight: number,
  cacheKey: string | null,
): DungeonMapStaticGeometry {
  if (cacheKey) {
    const cached = projectedGeometryCache.get(local.layout)?.get(cacheKey);
    if (cached) return cached;
  }
  const geometry: DungeonMapStaticGeometry = {
    sourceLayout: local.layout,
    canvasWidth,
    canvasHeight,
    bounds: plan.bounds,
    floors: plan.floors.map((floor) => projectPolygon(floor, projection)),
    walls: plan.walls.map((wall) => ({
      a: projection.point(wall.ax, wall.az),
      b: projection.point(wall.bx, wall.bz),
      width: Math.max(1, DUNGEON_WALL_HW * 2 * projection.scale),
    })),
    doors: plan.doors.map((door) => projectPolygon(door, projection)),
    obstacles: plan.obstacles.map((obstacle) => {
      const point = projection.point(obstacle.x, obstacle.z);
      return { ...point, r: obstacle.r * projection.scale };
    }),
    dais: (() => {
      const point = projection.point(plan.dais.x, plan.dais.z);
      return { ...point, r: plan.dais.r * projection.scale };
    })(),
  };
  if (cacheKey) {
    let byKey = projectedGeometryCache.get(local.layout);
    if (!byKey) {
      byKey = new Map();
      projectedGeometryCache.set(local.layout, byKey);
    }
    byKey.set(cacheKey, geometry);
  }
  return geometry;
}

function buildModel(
  world: IWorld,
  projectionFor: (local: DungeonMapLocal, plan: LocalPlan) => Projection,
  visibleFor: (projection: Projection) => (point: DungeonMapPoint) => boolean,
  canvasWidth: number,
  canvasHeight: number,
  cacheKey: string | null,
): DungeonMapModel | null {
  const p = world.player;
  const local = dungeonMapLocal(p.pos.x, p.pos.z);
  if (!local) return null;
  const plan = planFor(local.layout);
  const projection = projectionFor(local, plan);
  const visible = visibleFor(projection);
  const geometry = projectStaticGeometry(
    local,
    plan,
    projection,
    canvasWidth,
    canvasHeight,
    cacheKey,
  );
  return {
    dungeonId: local.dungeonId,
    staticGeometry: geometry,
    ...geometry,
    markers: collectMarkers(world, local, projection, visible),
  };
}

/** Player-centred dungeon plan for the circular minimap. */
export function buildDungeonMinimapModel(
  world: IWorld,
  canvasSize: number,
  pxPerYard: number,
): DungeonMapModel | null {
  const half = canvasSize / 2;
  const rim = half - MINIMAP_RIM_INSET;
  const rim2 = rim * rim;
  return buildModel(
    world,
    (local) => ({
      scale: pxPerYard,
      point: (x, z) => ({
        cx: half - (x - local.lx) * pxPerYard,
        cy: half - (z - local.lz) * pxPerYard,
      }),
    }),
    () => (point) => {
      const dx = point.cx - half;
      const dy = point.cy - half;
      return dx * dx + dy * dy <= rim2;
    },
    canvasSize,
    canvasSize,
    null,
  );
}

/** Minimap hot-path model: stable layout-local geometry plus a moving plate offset and live markers. */
export function buildDungeonMinimapPaintModel(
  world: IWorld,
  canvasSize: number,
  pxPerYard: number,
): DungeonMinimapPaintModel | null {
  const local = dungeonMapLocal(world.player.pos.x, world.player.pos.z);
  if (!local) return null;
  const plan = planFor(local.layout);
  const spanX = plan.bounds.maxX - plan.bounds.minX;
  const spanZ = plan.bounds.maxZ - plan.bounds.minZ;
  const projection: Projection = {
    scale: pxPerYard,
    point: (x, z) => ({
      cx: (plan.bounds.maxX - x) * pxPerYard,
      cy: (plan.bounds.maxZ - z) * pxPerYard,
    }),
  };
  const staticGeometry = projectStaticGeometry(
    local,
    plan,
    projection,
    Math.ceil(spanX * pxPerYard),
    Math.ceil(spanZ * pxPerYard),
    `minimap:${pxPerYard}`,
  );
  const half = canvasSize / 2;
  const plateX = half - (plan.bounds.maxX - local.lx) * pxPerYard;
  const plateY = half - (plan.bounds.maxZ - local.lz) * pxPerYard;
  const markerProjection: Projection = {
    scale: pxPerYard,
    point: (x, z) => ({
      cx: half - (x - local.lx) * pxPerYard,
      cy: half - (z - local.lz) * pxPerYard,
    }),
  };
  const rim = half - MINIMAP_RIM_INSET;
  const rim2 = rim * rim;
  return {
    dungeonId: local.dungeonId,
    staticGeometry,
    plateX,
    plateY,
    markers: collectMarkers(world, local, markerProjection, (point) => {
      const dx = point.cx - half;
      const dy = point.cy - half;
      return dx * dx + dy * dy <= rim2;
    }),
  };
}

/** Whole current dungeon plan fitted uniformly into the square M-map. */
export function buildDungeonWorldMapModel(
  world: IWorld,
  canvasSize: number,
  pad: number,
): DungeonMapModel | null {
  return buildModel(
    world,
    (_local, plan) => {
      const spanX = plan.bounds.maxX - plan.bounds.minX;
      const spanZ = plan.bounds.maxZ - plan.bounds.minZ;
      const scale = Math.min((canvasSize - pad * 2) / spanX, (canvasSize - pad * 2) / spanZ);
      const ox = (canvasSize - spanX * scale) / 2;
      const oy = (canvasSize - spanZ * scale) / 2;
      return {
        scale,
        point: (x, z) => ({
          cx: ox + (plan.bounds.maxX - x) * scale,
          cy: oy + (plan.bounds.maxZ - z) * scale,
        }),
      };
    },
    () => (point) =>
      point.cx >= 0 && point.cx <= canvasSize && point.cy >= 0 && point.cy <= canvasSize,
    canvasSize,
    canvasSize,
    `world:${canvasSize}:${pad}`,
  );
}

interface MutableDungeonMapMarker {
  kind: DungeonMapMarker['kind'];
  cx: number;
  cy: number;
  angle: number;
  source: 'enemy' | 'object';
  templateId: string;
  aggro: boolean;
  boss: boolean;
  cls: string;
  dead: boolean;
}

/** High-water marker pool for the always-on minimap and open M-map paths. */
class DungeonMarkerBuffer {
  readonly markers: DungeonMapMarker[] = [];
  private readonly slots: MutableDungeonMapMarker[] = [];
  private count = 0;

  private next(kind: DungeonMapMarker['kind'], cx: number, cy: number): MutableDungeonMapMarker {
    let slot = this.slots[this.count];
    if (!slot) {
      slot = {
        kind,
        cx,
        cy,
        angle: 0,
        source: 'object',
        templateId: '',
        aggro: false,
        boss: false,
        cls: '',
        dead: false,
      };
      this.slots.push(slot);
    }
    slot.kind = kind;
    slot.cx = cx;
    slot.cy = cy;
    slot.angle = 0;
    slot.source = 'object';
    slot.templateId = '';
    slot.aggro = false;
    slot.boss = false;
    slot.cls = '';
    slot.dead = false;
    this.markers.push(slot as unknown as DungeonMapMarker);
    this.count++;
    return slot;
  }

  collect(
    world: IWorld,
    frame: NonNullable<ReturnType<typeof dungeonInstanceAt>>,
    baseX: number,
    baseY: number,
    scale: number,
    canvasSize: number,
    circular: boolean,
    rim2: number,
  ): readonly DungeonMapMarker[] {
    this.count = 0;
    this.markers.length = 0;
    const player = world.player;
    const half = canvasSize / 2;

    for (const entity of world.entities.values()) {
      if (entity.id === player.id) continue;
      const markerRadius = entity.kind === 'npc' ? NPC_INTEREST_RADIUS : PLAYER_INTEREST_RADIUS;
      const playerDx = entity.pos.x - player.pos.x;
      const playerDz = entity.pos.z - player.pos.z;
      if (playerDx * playerDx + playerDz * playerDz > markerRadius * markerRadius) continue;
      const cx = baseX - (entity.pos.x - frame.ox) * scale;
      const cy = baseY - (entity.pos.z - frame.oz) * scale;
      if (circular) {
        const dx = cx - half;
        const dy = cy - half;
        if (dx * dx + dy * dy > rim2) continue;
      } else if (cx < 0 || cx > canvasSize || cy < 0 || cy > canvasSize) continue;

      if (entity.kind === 'object') {
        if (entity.templateId === IGNIVAR_GATE_LOCKED_TEMPLATE) {
          this.next('gate', cx, cy);
        } else if (entity.templateId === 'dungeon_exit' || entity.templateId === 'dungeon_door') {
          this.next('exit', cx, cy);
        } else if (entity.lootable) {
          this.next('loot', cx, cy).source = 'object';
        }
        continue;
      }
      if (entity.kind === 'npc') {
        this.next('npc', cx, cy).templateId = entity.templateId;
        continue;
      }
      if (entity.kind !== 'mob' || !entity.hostile) continue;
      if (entity.dead) {
        if (entity.lootable) this.next('loot', cx, cy).source = 'enemy';
        continue;
      }
      const marker = this.next('mob', cx, cy);
      marker.templateId = entity.templateId;
      marker.aggro = entity.aggroTargetId === player.id;
      marker.boss = MOBS[entity.templateId]?.boss === true;
    }

    const party = world.partyInfo;
    if (party) {
      for (const member of party.members) {
        if (member.pid === player.id) continue;
        const cx = baseX - (member.x - frame.ox) * scale;
        const cy = baseY - (member.z - frame.oz) * scale;
        if (circular) {
          const dx = cx - half;
          const dy = cy - half;
          if (dx * dx + dy * dy > rim2) continue;
        } else if (cx < 0 || cx > canvasSize || cy < 0 || cy > canvasSize) continue;
        const marker = this.next('party', cx, cy);
        marker.cls = member.cls;
        marker.dead = member.dead !== 0;
      }
    }

    const playerCx = baseX - (player.pos.x - frame.ox) * scale;
    const playerCy = baseY - (player.pos.z - frame.oz) * scale;
    this.next('player', playerCx, playerCy).angle = -player.facing;
    return this.markers;
  }
}

/**
 * Stateful allocation-light adapter for the HUD hot paths. Static projection is
 * rebuilt only when layout/scale changes; steady ticks mutate one model and a
 * high-water marker pool in place.
 */
export class DungeonMapViewCore {
  private readonly minimapMarkers = new DungeonMarkerBuffer();
  private readonly worldMarkers = new DungeonMarkerBuffer();
  private minimapModel: DungeonMinimapPaintModel | null = null;
  private worldModel: DungeonMapModel | null = null;
  private minimapLayout: DungeonLayout | null = null;
  private minimapScale = Number.NaN;
  private worldLayout: DungeonLayout | null = null;
  private worldSize = Number.NaN;
  private worldPad = Number.NaN;

  minimap(world: IWorld, canvasSize: number, pxPerYard: number): DungeonMinimapPaintModel | null {
    const player = world.player;
    const frame = dungeonInstanceAt(player.pos.x, player.pos.z);
    if (!frame || hasDedicatedCastleMap(frame.interior)) return null;
    const plan = planFor(frame.layout);
    if (
      !this.minimapModel ||
      this.minimapLayout !== frame.layout ||
      this.minimapScale !== pxPerYard
    ) {
      const cold = buildDungeonMinimapPaintModel(world, canvasSize, pxPerYard);
      if (!cold) return null;
      if (!this.minimapModel) {
        this.minimapModel = {
          dungeonId: frame.dungeonId,
          staticGeometry: cold.staticGeometry,
          plateX: 0,
          plateY: 0,
          markers: this.minimapMarkers.markers,
        };
      } else {
        this.minimapModel.staticGeometry = cold.staticGeometry;
      }
      this.minimapLayout = frame.layout;
      this.minimapScale = pxPerYard;
    }

    const half = canvasSize / 2;
    const lx = player.pos.x - frame.ox;
    const lz = player.pos.z - frame.oz;
    const rim = half - MINIMAP_RIM_INSET;
    this.minimapModel.dungeonId = frame.dungeonId;
    this.minimapModel.plateX = half - (plan.bounds.maxX - lx) * pxPerYard;
    this.minimapModel.plateY = half - (plan.bounds.maxZ - lz) * pxPerYard;
    this.minimapMarkers.collect(
      world,
      frame,
      half + lx * pxPerYard,
      half + lz * pxPerYard,
      pxPerYard,
      canvasSize,
      true,
      rim * rim,
    );
    return this.minimapModel;
  }

  worldMap(world: IWorld, canvasSize: number, pad: number): DungeonMapModel | null {
    const player = world.player;
    const frame = dungeonInstanceAt(player.pos.x, player.pos.z);
    if (!frame || hasDedicatedCastleMap(frame.interior)) return null;
    const plan = planFor(frame.layout);
    if (
      !this.worldModel ||
      this.worldLayout !== frame.layout ||
      this.worldSize !== canvasSize ||
      this.worldPad !== pad
    ) {
      const cold = buildDungeonWorldMapModel(world, canvasSize, pad);
      if (!cold) return null;
      if (!this.worldModel) {
        this.worldModel = { ...cold, markers: this.worldMarkers.markers };
      } else {
        this.worldModel.sourceLayout = cold.sourceLayout;
        this.worldModel.canvasWidth = cold.canvasWidth;
        this.worldModel.canvasHeight = cold.canvasHeight;
        this.worldModel.bounds = cold.bounds;
        this.worldModel.floors = cold.floors;
        this.worldModel.walls = cold.walls;
        this.worldModel.doors = cold.doors;
        this.worldModel.obstacles = cold.obstacles;
        this.worldModel.dais = cold.dais;
        this.worldModel.staticGeometry = cold.staticGeometry;
      }
      this.worldLayout = frame.layout;
      this.worldSize = canvasSize;
      this.worldPad = pad;
    }

    const spanX = plan.bounds.maxX - plan.bounds.minX;
    const spanZ = plan.bounds.maxZ - plan.bounds.minZ;
    const scale = Math.min((canvasSize - pad * 2) / spanX, (canvasSize - pad * 2) / spanZ);
    const ox = (canvasSize - spanX * scale) / 2;
    const oy = (canvasSize - spanZ * scale) / 2;
    this.worldModel.dungeonId = frame.dungeonId;
    this.worldMarkers.collect(
      world,
      frame,
      ox + plan.bounds.maxX * scale,
      oy + plan.bounds.maxZ * scale,
      scale,
      canvasSize,
      false,
      0,
    );
    return this.worldModel;
  }
}
