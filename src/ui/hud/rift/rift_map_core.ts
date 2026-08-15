// Pure geometry and live-marker model for the procedural Rift map surfaces.
//
// A RiftFloorView is the complete client-visible geometry descriptor: the same
// generateRiftFloor() seam already used by the renderer recreates the immutable
// floor plan without adding sim or wire state. Static primitives are rebuilt only
// when descriptor/content/size changes. Live overlays come exclusively from the
// mirrored IWorld roster; generated spawn/object plans are deliberately ignored so
// an online client never learns off-interest readiness or enemy positions.

import {
  DUNGEON_END_WALL_HW,
  DUNGEON_WALL_X,
  type DungeonLayout,
  PILLAR_COLLIDER_R,
  TOMB_HD,
  TOMB_HW,
} from '../../../sim/dungeon_layout';
import { authoredWallSegments, doorRampHalf } from '../../../sim/rift/authored';
import { generateRiftFloor } from '../../../sim/rift/rift_gen';
import type { RiftFloorPlan } from '../../../sim/rift/types';
import type { RiftTier } from '../../../sim/types';
import type { IWorld, RiftFloorView } from '../../../world_api';
import { isLiveMapEntityDisclosed } from '../../map_entity_disclosure_core';
import {
  classifyMapObjectMarker,
  type MapMarkerSemantic,
  type MapMarkerSemanticEntity,
  mapMarkerSemanticLayer,
} from '../../map_marker_semantics_core';

const MIN_SPAN = 1;
const RIFT_SEMANTIC_CACHE_LIMIT = 32;
const RIFT_SEMANTIC_CONTEXT = Object.freeze({ delveRun: null });

export interface RiftMapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type RiftMapFit = 'rect' | 'circle';

export interface RiftMapTransform extends RiftMapBounds {
  fit: RiftMapFit;
  scale: number;
  left: number;
  top: number;
  canvasSize: number;
  pad: number;
}

export interface RiftMapPoint {
  cx: number;
  cy: number;
}

export interface RiftMapPolygon {
  kind: 'polygon';
  role: 'floor';
  points: RiftMapPoint[];
}

export interface RiftMapRect {
  kind: 'rect';
  role:
    | 'wall-stub'
    | 'illusion-wall'
    | 'tomb'
    | 'ice'
    | 'platform'
    | 'platform-ramp'
    | 'raised-room'
    | 'lift-ramp';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RiftMapCircle {
  kind: 'circle';
  role: 'pillar' | 'decor' | 'dais' | 'hazard' | 'entry';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface RiftMapLine {
  kind: 'line';
  role: 'wall' | 'roller-lane';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type RiftMapPrimitive = RiftMapPolygon | RiftMapRect | RiftMapCircle | RiftMapLine;

export interface RiftStaticGeometry {
  /** One or more same-winding paths. Painters combine them into a union clip. */
  walkable: RiftMapPolygon[];
  /** Floor furniture and wall runs, painted without the walkable clip. */
  structures: RiftMapPrimitive[];
  /** Environmental overlays that must be intersected with `walkable`. */
  clipped: RiftMapPrimitive[];
}

export type RiftObjectSemantic = Exclude<
  MapMarkerSemantic,
  { kind: 'dungeon' | 'rift-entrance' | 'delve-passage' | 'delve-surface' | 'delve-reward' }
>;

export interface RiftMobMarker extends RiftMapPoint {
  state: 'hostile' | 'loot';
  aggro: boolean;
}

export interface RiftObjectMarker extends RiftMapPoint {
  semantic: RiftObjectSemantic;
}

export interface RiftPartyMarker extends RiftMapPoint {
  cls: string;
  dead: boolean;
}

export interface RiftDeathZoneMarker extends RiftMapPoint {
  radius: number;
  remaining: number;
  total: number;
}

export interface RiftPlayerMarker extends RiftMapPoint {
  angle: number;
}

export interface RiftMapModel {
  staticKey: string;
  staticGeometry: RiftStaticGeometry;
  transform: RiftMapTransform;
  mobs: RiftMobMarker[];
  objects: RiftObjectMarker[];
  party: RiftPartyMarker[];
  deathZones: RiftDeathZoneMarker[];
  corpse: RiftMapPoint | null;
  player: RiftPlayerMarker;
  areaLabel: string;
}

export interface RiftMapView {
  build(world: IWorld, canvasSize: number, pad: number, areaLabel: string): RiftMapModel | null;
}

/** Immutable static-raster identity. Runtime instance id is intentionally absent. */
export function riftFloorMapKey(view: RiftFloorView): string {
  return `rift-map-v1:${view.seed >>> 0}:${Math.round(view.baseLevel)}:${view.floorIndex}:${view.contentHash}`;
}

/** Bounds of the exact active shell, including its wall centre lines. */
export function riftLayoutBounds(layout: DungeonLayout): RiftMapBounds {
  if (layout.rooms?.length) {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const room of layout.rooms) {
      minX = Math.min(minX, room.x0);
      maxX = Math.max(maxX, room.x1);
      minZ = Math.min(minZ, room.z0);
      maxZ = Math.max(maxZ, room.z1);
    }
    return { minX, maxX, minZ, maxZ };
  }
  if (layout.shellPolygon?.length) {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const point of layout.shellPolygon) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
    return { minX, maxX, minZ, maxZ };
  }
  const wallX = Math.max(layout.wallX ?? DUNGEON_WALL_X, layout.endWallHw ?? DUNGEON_END_WALL_HW);
  return { minX: -wallX, maxX: wallX, minZ: layout.zMin, maxZ: layout.zMax };
}

/** Aspect-preserving projection with centered letterboxing. Rectangular map
 * windows fit against their padded square. Circular minimaps fit the complete
 * bounds rectangle inside a padded radius, so an accessible corner cannot be
 * projected behind the disc clip. */
export function riftMapTransform(
  bounds: RiftMapBounds,
  canvasSize: number,
  pad: number,
  fit: RiftMapFit = 'rect',
): RiftMapTransform {
  const spanX = Math.max(MIN_SPAN, bounds.maxX - bounds.minX);
  const spanZ = Math.max(MIN_SPAN, bounds.maxZ - bounds.minZ);
  const usable = Math.max(MIN_SPAN, canvasSize - pad * 2);
  const scale =
    fit === 'circle'
      ? Math.max(MIN_SPAN, canvasSize / 2 - pad) / Math.hypot(spanX / 2, spanZ / 2)
      : Math.min(usable / spanX, usable / spanZ);
  return {
    ...bounds,
    fit,
    scale,
    left: (canvasSize - spanX * scale) / 2,
    top: (canvasSize - spanZ * scale) / 2,
    canvasSize,
    pad,
  };
}

/** Established cartography axes: +X left, +Z up. */
export function riftLocalToCanvas(
  localX: number,
  localZ: number,
  transform: RiftMapTransform,
): RiftMapPoint {
  return {
    cx: riftLocalCanvasX(localX, transform),
    cy: riftLocalCanvasY(localZ, transform),
  };
}

function riftLocalCanvasX(localX: number, transform: RiftMapTransform): number {
  return transform.left + (transform.maxX - localX) * transform.scale;
}

function riftLocalCanvasY(localZ: number, transform: RiftMapTransform): number {
  return transform.top + (transform.maxZ - localZ) * transform.scale;
}

function polygon(
  points: readonly { x: number; z: number }[],
  transform: RiftMapTransform,
): RiftMapPolygon {
  return {
    kind: 'polygon',
    role: 'floor',
    points: points.map((point) => riftLocalToCanvas(point.x, point.z, transform)),
  };
}

function rect(
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  role: RiftMapRect['role'],
  transform: RiftMapTransform,
): RiftMapRect {
  const a = riftLocalToCanvas(x0, z0, transform);
  const b = riftLocalToCanvas(x1, z1, transform);
  return {
    kind: 'rect',
    role,
    x: Math.min(a.cx, b.cx),
    y: Math.min(a.cy, b.cy),
    w: Math.abs(a.cx - b.cx),
    h: Math.abs(a.cy - b.cy),
  };
}

function circle(
  x: number,
  z: number,
  rx: number,
  rz: number,
  role: RiftMapCircle['role'],
  transform: RiftMapTransform,
): RiftMapCircle {
  const center = riftLocalToCanvas(x, z, transform);
  return {
    kind: 'circle',
    role,
    ...center,
    rx: Math.max(0.75, rx * transform.scale),
    ry: Math.max(0.75, rz * transform.scale),
  };
}

function line(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  role: RiftMapLine['role'],
  transform: RiftMapTransform,
): RiftMapLine {
  const a = riftLocalToCanvas(x1, z1, transform);
  const b = riftLocalToCanvas(x2, z2, transform);
  return { kind: 'line', role, x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy };
}

function rectWalkable(layout: DungeonLayout, transform: RiftMapTransform): RiftMapPolygon {
  const halfX = layout.floorHalfX ?? (layout.wallX ?? DUNGEON_WALL_X) - 1;
  return polygon(
    [
      { x: -halfX, z: layout.zMin },
      { x: halfX, z: layout.zMin },
      { x: halfX, z: layout.zMax },
      { x: -halfX, z: layout.zMax },
    ],
    transform,
  );
}

/** Build the immutable one-floor schematic. No plan spawn/object is exposed. */
export function buildRiftStaticGeometry(
  floor: RiftFloorPlan,
  transform: RiftMapTransform,
): RiftStaticGeometry {
  const { layout } = floor;
  const walkable: RiftMapPolygon[] = [];
  const structures: RiftMapPrimitive[] = [];
  const clipped: RiftMapPrimitive[] = [];

  if (layout.rooms?.length) {
    for (const room of layout.rooms) {
      const roomPoly = polygon(
        [
          { x: room.x0, z: room.z0 },
          { x: room.x1, z: room.z0 },
          { x: room.x1, z: room.z1 },
          { x: room.x0, z: room.z1 },
        ],
        transform,
      );
      walkable.push(roomPoly);
      if ((room.lift ?? 0) > 0)
        clipped.push(rect(room.x0, room.x1, room.z0, room.z1, 'raised-room', transform));
    }
    for (const segment of authoredWallSegments(layout.rooms, layout.doors ?? [])) {
      structures.push(
        segment.axis === 'x'
          ? line(segment.a, segment.fixed, segment.b, segment.fixed, 'wall', transform)
          : line(segment.fixed, segment.a, segment.fixed, segment.b, 'wall', transform),
      );
    }
    // Doorways that join different lift bands are actual stairs/ramps in the renderer.
    for (const door of layout.doors ?? []) {
      const south = layout.rooms.find(
        (room) => room.z1 === door.z && door.x >= room.x0 && door.x <= room.x1,
      );
      const north = layout.rooms.find(
        (room) => room.z0 === door.z && door.x >= room.x0 && door.x <= room.x1,
      );
      if (south && north && (south.lift ?? 0) !== (north.lift ?? 0)) {
        const half = doorRampHalf(door.hd, (north.lift ?? 0) - (south.lift ?? 0));
        clipped.push(
          rect(
            door.x - door.hw,
            door.x + door.hw,
            door.z - half,
            door.z + half,
            'lift-ramp',
            transform,
          ),
        );
        continue;
      }
      const west = layout.rooms.find(
        (room) => room.x1 === door.x && door.z >= room.z0 && door.z <= room.z1,
      );
      const east = layout.rooms.find(
        (room) => room.x0 === door.x && door.z >= room.z0 && door.z <= room.z1,
      );
      if (west && east && (west.lift ?? 0) !== (east.lift ?? 0)) {
        const half = doorRampHalf(door.hw, (east.lift ?? 0) - (west.lift ?? 0));
        clipped.push(
          rect(
            door.x - half,
            door.x + half,
            door.z - door.hd,
            door.z + door.hd,
            'lift-ramp',
            transform,
          ),
        );
      }
    }
  } else if (layout.shellPolygon?.length) {
    walkable.push(polygon(layout.shellPolygon, transform));
    for (let index = 0; index < layout.shellPolygon.length; index++) {
      const a = layout.shellPolygon[index];
      const b = layout.shellPolygon[(index + 1) % layout.shellPolygon.length];
      structures.push(line(a.x, a.z, b.x, b.z, 'wall', transform));
    }
  } else {
    walkable.push(rectWalkable(layout, transform));
    const wallX = layout.wallX ?? DUNGEON_WALL_X;
    const endWallHw = layout.endWallHw ?? DUNGEON_END_WALL_HW;
    structures.push(
      line(-wallX, layout.zMin, -wallX, layout.zMax, 'wall', transform),
      line(wallX, layout.zMin, wallX, layout.zMax, 'wall', transform),
      line(-endWallHw, layout.zMin, endWallHw, layout.zMin, 'wall', transform),
      line(-endWallHw, layout.zMax, endWallHw, layout.zMax, 'wall', transform),
    );
  }

  for (const stub of layout.stubs)
    structures.push(
      rect(
        stub.x - stub.hw,
        stub.x + stub.hw,
        stub.z - stub.hd,
        stub.z + stub.hd,
        'wall-stub',
        transform,
      ),
    );
  for (const stub of layout.illusionWalls ?? [])
    structures.push(
      rect(
        stub.x - stub.hw,
        stub.x + stub.hw,
        stub.z - stub.hd,
        stub.z + stub.hd,
        'illusion-wall',
        transform,
      ),
    );
  for (const pillar of layout.pillars)
    structures.push(
      circle(pillar.x, pillar.z, PILLAR_COLLIDER_R, PILLAR_COLLIDER_R, 'pillar', transform),
    );
  for (const tomb of layout.tombs)
    structures.push(
      rect(
        tomb.x - TOMB_HW,
        tomb.x + TOMB_HW,
        tomb.z - TOMB_HD,
        tomb.z + TOMB_HD,
        'tomb',
        transform,
      ),
    );
  // Only collision-backed decor belongs to the navigation schematic. Purely
  // visual rugs/sigils must not masquerade as blocked ground.
  for (const decor of layout.decor ?? []) {
    if (decor.r !== undefined && decor.r > 0)
      structures.push(circle(decor.x, decor.z, decor.r, decor.r, 'decor', transform));
  }
  for (const clutter of layout.clutter ?? [])
    structures.push(circle(clutter.x, clutter.z, 0.8, 0.8, 'decor', transform));
  // The boss dais is a walkable elevation with no collider. Keep it in the
  // clipped floor-accent layer so cartography never presents it as blocked
  // furniture merely because the renderer raises the ground there.
  clipped.push(
    circle(layout.dais.x, layout.dais.z, layout.dais.r, layout.dais.r, 'dais', transform),
  );
  structures.push(circle(floor.entry.x, floor.entry.z, 1.25, 1.25, 'entry', transform));

  for (const hazard of floor.hazards)
    clipped.push(
      circle(hazard.x, hazard.z, hazard.rx ?? hazard.r, hazard.rz ?? hazard.r, 'hazard', transform),
    );
  if (floor.iceZone) {
    const ice = floor.iceZone;
    clipped.push(
      rect(ice.x - ice.hw, ice.x + ice.hw, ice.z - ice.hd, ice.z + ice.hd, 'ice', transform),
    );
  }
  if (floor.platform) {
    clipped.push(
      rect(
        transform.minX,
        transform.maxX,
        floor.platform.rampZ1,
        transform.maxZ,
        'platform',
        transform,
      ),
      rect(
        transform.minX,
        transform.maxX,
        floor.platform.rampZ0,
        floor.platform.rampZ1,
        'platform-ramp',
        transform,
      ),
    );
  }
  for (const roller of floor.rollers)
    clipped.push(line(roller.x, roller.z0, roller.x, roller.z1, 'roller-lane', transform));

  return { walkable, structures, clipped };
}

function isInsideCanvas(cx: number, cy: number, canvasSize: number): boolean {
  return cx >= 0 && cx <= canvasSize && cy >= 0 && cy <= canvasSize;
}

function isRiftObjectSemantic(semantic: MapMarkerSemantic | null): semantic is RiftObjectSemantic {
  return (
    semantic?.kind === 'rift-descent' ||
    semantic?.kind === 'rift-return' ||
    semantic?.kind === 'rift-reward' ||
    semantic?.kind === 'rift-mechanic'
  );
}

function cachedRiftObjectSemantic(
  entity: MapMarkerSemanticEntity,
  semanticCache: Map<string, MapMarkerSemantic | null>,
  riftExitCache: Map<RiftTier | null, MapMarkerSemantic | null>,
): RiftObjectSemantic | null {
  if (entity.templateId === 'rift_exit') {
    const rank = entity.riftTier ?? null;
    const cached = riftExitCache.get(rank);
    if (cached !== undefined) return isRiftObjectSemantic(cached) ? cached : null;
    const classified = classifyMapObjectMarker(entity, RIFT_SEMANTIC_CONTEXT);
    if (riftExitCache.size >= RIFT_SEMANTIC_CACHE_LIMIT) riftExitCache.clear();
    riftExitCache.set(rank, classified);
    return isRiftObjectSemantic(classified) ? classified : null;
  }

  const cached = semanticCache.get(entity.templateId);
  if (cached !== undefined) return isRiftObjectSemantic(cached) ? cached : null;
  const classified = classifyMapObjectMarker(entity, RIFT_SEMANTIC_CONTEXT);
  if (semanticCache.size >= RIFT_SEMANTIC_CACHE_LIMIT) semanticCache.clear();
  semanticCache.set(entity.templateId, classified);
  return isRiftObjectSemantic(classified) ? classified : null;
}

function writeMobMarker(
  slots: RiftMobMarker[],
  index: number,
  cx: number,
  cy: number,
  state: RiftMobMarker['state'],
  aggro: boolean,
): RiftMobMarker {
  let marker = slots[index];
  if (!marker) {
    marker = { cx, cy, state, aggro };
    slots[index] = marker;
    return marker;
  }
  marker.cx = cx;
  marker.cy = cy;
  marker.state = state;
  marker.aggro = aggro;
  return marker;
}

function writeObjectMarker(
  slots: RiftObjectMarker[],
  index: number,
  cx: number,
  cy: number,
  semantic: RiftObjectSemantic,
): RiftObjectMarker {
  let marker = slots[index];
  if (!marker) {
    marker = { cx, cy, semantic };
    slots[index] = marker;
    return marker;
  }
  marker.cx = cx;
  marker.cy = cy;
  marker.semantic = semantic;
  return marker;
}

function writePartyMarker(
  slots: RiftPartyMarker[],
  index: number,
  cx: number,
  cy: number,
  cls: string,
  dead: boolean,
): RiftPartyMarker {
  let marker = slots[index];
  if (!marker) {
    marker = { cx, cy, cls, dead };
    slots[index] = marker;
    return marker;
  }
  marker.cx = cx;
  marker.cy = cy;
  marker.cls = cls;
  marker.dead = dead;
  return marker;
}

function writeDeathZoneMarker(
  slots: RiftDeathZoneMarker[],
  index: number,
  cx: number,
  cy: number,
  radius: number,
  remaining: number,
  total: number,
): RiftDeathZoneMarker {
  let marker = slots[index];
  if (!marker) {
    marker = { cx, cy, radius, remaining, total };
    slots[index] = marker;
    return marker;
  }
  marker.cx = cx;
  marker.cy = cy;
  marker.radius = radius;
  marker.remaining = remaining;
  marker.total = total;
  return marker;
}

/** Reused dynamic model for both minimap and M-map surfaces. */
export function createRiftMapView(fit: RiftMapFit = 'rect'): RiftMapView {
  const mobs: RiftMobMarker[] = [];
  const objects: RiftObjectMarker[] = [];
  const party: RiftPartyMarker[] = [];
  const deathZones: RiftDeathZoneMarker[] = [];
  // Active arrays retain their public identity while these private high-water
  // pools retain each accepted marker slot across rebuilds and empty frames.
  const mobSlots: RiftMobMarker[] = [];
  const mechanicObjectSlots: RiftObjectMarker[] = [];
  const rewardObjectSlots: RiftObjectMarker[] = [];
  const navigationObjectSlots: RiftObjectMarker[] = [];
  const partySlots: RiftPartyMarker[] = [];
  const deathZoneSlots: RiftDeathZoneMarker[] = [];
  const semanticCache = new Map<string, MapMarkerSemantic | null>();
  const riftExitCache = new Map<RiftTier | null, MapMarkerSemantic | null>();
  const playerMarker: RiftPlayerMarker = { cx: 0, cy: 0, angle: 0 };
  let corpseMarker: RiftMapPoint | null = null;
  let model: RiftMapModel | null = null;
  let staticSurfaceKey = '';

  return {
    build(world, canvasSize, pad, areaLabel): RiftMapModel | null {
      mobs.length = 0;
      objects.length = 0;
      party.length = 0;
      deathZones.length = 0;
      const view = world.riftFloor;
      if (!view) return null;

      const floorKey = riftFloorMapKey(view);
      const nextSurfaceKey = `${floorKey}:${canvasSize}:${pad}:${fit}`;
      if (!model || staticSurfaceKey !== nextSurfaceKey) {
        const floor = generateRiftFloor(view.seed, view.baseLevel, view.floorIndex, view.upgrade);
        const transform = riftMapTransform(riftLayoutBounds(floor.layout), canvasSize, pad, fit);
        const staticGeometry = buildRiftStaticGeometry(floor, transform);
        if (!model) {
          model = {
            staticKey: floorKey,
            staticGeometry,
            transform,
            mobs,
            objects,
            party,
            deathZones,
            corpse: null,
            player: playerMarker,
            areaLabel,
          };
        } else {
          model.staticGeometry = staticGeometry;
          model.transform = transform;
        }
        staticSurfaceKey = nextSurfaceKey;
      }

      model.staticKey = floorKey;
      model.areaLabel = areaLabel;
      model.corpse = null;
      const transform = model.transform;
      const origin = view.origin;
      const player = world.player;
      const companionId = world.companionState?.entityId;
      let mechanicObjectCount = 0;
      let rewardObjectCount = 0;
      let navigationObjectCount = 0;

      for (const entity of world.entities.values()) {
        if (entity.id === player.id || entity.id === companionId) continue;
        if (!isLiveMapEntityDisclosed(player.pos.x, player.pos.z, entity.pos.x, entity.pos.z))
          continue;
        let semantic: RiftObjectSemantic | null = null;
        if (entity.kind === 'object') {
          semantic = cachedRiftObjectSemantic(entity, semanticCache, riftExitCache);
          if (!semantic) continue;
        } else if (
          !(entity.kind === 'mob' && entity.hostile && (!entity.dead || entity.lootable))
        ) {
          continue;
        }
        // Project to primitives first so an off-canvas candidate never consumes
        // or allocates a marker slot.
        const cx = riftLocalCanvasX(entity.pos.x - origin.x, transform);
        const cy = riftLocalCanvasY(entity.pos.z - origin.z, transform);
        if (!isInsideCanvas(cx, cy, canvasSize)) continue;
        if (!semantic) {
          if (entity.hostile && !entity.dead) {
            const index = mobs.length;
            mobs[index] = writeMobMarker(
              mobSlots,
              index,
              cx,
              cy,
              'hostile',
              entity.aggroTargetId === player.id,
            );
          } else if (entity.hostile && entity.lootable) {
            const index = mobs.length;
            mobs[index] = writeMobMarker(mobSlots, index, cx, cy, 'loot', false);
          }
          continue;
        }
        const layer = mapMarkerSemanticLayer(semantic);
        if (layer === 'mechanic') {
          writeObjectMarker(mechanicObjectSlots, mechanicObjectCount++, cx, cy, semantic);
        } else if (layer === 'reward') {
          writeObjectMarker(rewardObjectSlots, rewardObjectCount++, cx, cy, semantic);
        } else {
          writeObjectMarker(navigationObjectSlots, navigationObjectCount++, cx, cy, semantic);
        }
      }

      // Stable semantic z-order without a per-redraw sort: mechanics, then
      // rewards, then the route the party must be able to find above both.
      for (let index = 0; index < mechanicObjectCount; index++)
        objects.push(mechanicObjectSlots[index]);
      for (let index = 0; index < rewardObjectCount; index++)
        objects.push(rewardObjectSlots[index]);
      for (let index = 0; index < navigationObjectCount; index++)
        objects.push(navigationObjectSlots[index]);

      const partyMembers = world.partyInfo?.members;
      if (partyMembers) {
        for (const member of partyMembers) {
          if (member.pid === player.id) continue;
          const cx = riftLocalCanvasX(member.x - origin.x, transform);
          const cy = riftLocalCanvasY(member.z - origin.z, transform);
          if (!isInsideCanvas(cx, cy, canvasSize)) continue;
          const index = party.length;
          party[index] = writePartyMarker(partySlots, index, cx, cy, member.cls, member.dead !== 0);
        }
      }

      for (const zone of world.riftBossDeathZones()) {
        if (!isLiveMapEntityDisclosed(player.pos.x, player.pos.z, zone.x, zone.z)) continue;
        const cx = riftLocalCanvasX(zone.x - origin.x, transform);
        const cy = riftLocalCanvasY(zone.z - origin.z, transform);
        if (!isInsideCanvas(cx, cy, canvasSize)) continue;
        const index = deathZones.length;
        deathZones[index] = writeDeathZoneMarker(
          deathZoneSlots,
          index,
          cx,
          cy,
          zone.radius * transform.scale,
          zone.remaining,
          zone.total,
        );
      }

      if (player.ghost && player.corpsePos) {
        const cx = riftLocalCanvasX(player.corpsePos.x - origin.x, transform);
        const cy = riftLocalCanvasY(player.corpsePos.z - origin.z, transform);
        if (isInsideCanvas(cx, cy, canvasSize)) {
          if (!corpseMarker) corpseMarker = { cx, cy };
          else {
            corpseMarker.cx = cx;
            corpseMarker.cy = cy;
          }
          model.corpse = corpseMarker;
        }
      }
      model.player.cx = riftLocalCanvasX(player.pos.x - origin.x, transform);
      model.player.cy = riftLocalCanvasY(player.pos.z - origin.z, transform);
      model.player.angle = -player.facing;
      return model;
    },
  };
}
