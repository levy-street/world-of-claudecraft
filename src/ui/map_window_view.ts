// Pure, host-agnostic draw model for the world-map window (overworld branch).
//
// The pure-core half of the pure-core + canvas-painter split (root CLAUDE.md
// Conventions; reference delve_map.ts / delve_map_painter.ts). It maps IWorld
// state plus the committed zone to a flat geometry model in canvas-pixel space:
// the background blit rect, the zoomed-detail overlay, and every label / portal /
// npc glyph / player arrow / ally dot / party dot / gather-node marker already
// projected to (mx, my). No DOM, no
// Three, no 2D context, no i18n, no color: the painter owns the context and
// resolves the --color-map-* tokens + the localized label text. The delve branch
// of the map is owned by delve_map_painter.ts; this core models only the
// overworld branch, plus the mode discriminator the painter switches on.
//
// DOM-free / i18n-free / deterministic so tests/map_window_view.test.ts can drive
// it directly with both a Sim-shaped and a ClientWorld-mirror-shaped IWorld stub.
// Markers carry the identity (zoneId / poiIndex / dungeonId / cls / nodeId)
// the painter needs to resolve their localized text, never the resolved string.

import type { GatheringProfessionId } from '../sim/content/professions';
import {
  DUNGEON_LIST,
  GATHER_NODES,
  isBgPos,
  isDelvePos,
  STRIP_MAX_X,
  STRIP_MIN_X,
  type ZoneDef,
} from '../sim/data';
import { NODE_HARVEST_TABLE } from '../sim/professions/gathering';
import { canGatherTier } from '../sim/professions/tools';
import {
  type MapQuestMarkerKind,
  type QuestObjectiveRef,
  questGiverNpcMarkers,
  questObjectiveAreas,
} from '../sim/quest_targets';
import type {
  BuildingDef,
  GatherNodeType,
  RiftTier,
  StationType,
  ZonePropsDef,
} from '../sim/types';
import type { Decoration } from '../sim/world';
import type { FriendInfo, IWorld } from '../world_api';
import { buildCastlePlanMarkers, type CastlePlanMarker } from './castle_plan_core';
import { dungeonMapActive } from './dungeon_map_view';
import { viewerUsableToolTier } from './gathering_view';
import { overworldDungeonPortals } from './map_dungeon_portals';
import type { MapMarkerProfile } from './map_marker_profile_core';
import {
  isNearbyLiveRiftZoneMapEntity,
  STABLE_MAP_NAVIGATION_LANDMARKS,
} from './map_navigation_landmarks_core';
import { questNumbersByLog } from './map_quest_list_view';

// World-map zoom band. zoom 1 = the whole current zone framed square;
// MAP_MAX_ZOOM is a close local view. The view scales uniformly between the two,
// centred on the player (or the pan target) and never escapes the current zone.
export const MAP_MAX_ZOOM = 6;
// Open with the complete current zone visible.
export const MAP_OPEN_ZOOM = 1;
// Below this visible span (world units across the view) the POI / NPC / ally
// labels draw; wider zone frames suppress them so the map is not a wall of
// overlapping text.
const LABEL_SPAN = 900;
// Below this visible span the zoomed-detail overlay (buildings + vegetation)
// draws (roughly a single realm in view).
const DETAIL_SPAN = 480;

// The zoomed-detail overlay only considers props/decorations within this many
// world units of the visible region, so a footprint half-off the edge still draws.
const DETAIL_VIEW_MARGIN = 6;
// Markers (POIs / portals / NPCs / allies) within this many world units of the
// visible region still draw, so a label anchored just off the edge is not clipped.
const MARKER_VIEW_MARGIN = 24;
// Marker radii in the detail overlay: a px floor plus a per-pixel-per-yard scale,
// so dots stay visible when zoomed out yet grow with the map (matches the inline
// site verbatim). ppu = pixels per world unit.
const ROCK_MIN_RADIUS = 1.2;
const ROCK_RADIUS_PPU = 0.5;
const FOLIAGE_MIN_RADIUS = 1.6;
const FOLIAGE_RADIUS_PPU = 0.8;
const PROP_MIN_RADIUS = 1.8;
const PROP_RADIUS_PPU = 0.7;
const CAMPFIRE_MIN_RADIUS = 1.4;
const CAMPFIRE_RADIUS_PPU = 0.5;

/** Which world-map surface a given world renders: the delve schematic (owned by
 *  delve_map_painter), the Thornhollow Fields battleground band (routed to the plain
 *  overworld surface: the band sits past WORLD_MAX_X, so the player/ally
 *  markers self-suppress; the minimap owns the in-band field raster), or the
 *  overworld map (this core). */
export type MapWindowMode = 'rift' | 'delve' | 'battleground' | 'dungeon' | 'overworld';

/** A map region in world coords, used with two meanings for spanX/spanZ. The
 *  internal `full` rect carries the current-zone square (its full spans). The
 *  returned model `view` (which Hud stores as mapView for the drag handler) keeps
 *  those FULL min/max bounds but carries the current ZOOMED spans (full span /
 *  zoom). So min/max are always the current-zone frame bounds; spanX/spanZ are the
 *  full square on `full` and the zoomed square on the returned `view`. */
export interface MapViewRect {
  spanX: number;
  spanZ: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A zone POI label: canvas position + the identity the painter localizes. */
export interface MapPoiMarker {
  mx: number;
  my: number;
  zoneId: string;
  poiIndex: number;
}

/** A dungeon entrance portal: canvas position + the dungeon id to localize. */
export interface MapPortalMarker {
  mx: number;
  my: number;
  dungeonId: string;
}

/** One quest carried by a map quest-giver glyph, for its hover tooltip:
 *  'ready' (the '?' state), 'available' (first-offer gold '!'), 'repeat'
 *  (completed-repeatable blue '!'), or 'cooldown' (a work order inside its
 *  cadence window, the dimmed '!'). The type is the four-member
 *  MapQuestMarkerKind, so consumers see only drawable kinds; the tooltip
 *  tag table switches exhaustively over them (the painter resolves glyph
 *  and color by comparison). */
export interface MapNpcQuestRef {
  questId: string;
  kind: MapQuestMarkerKind;
}

/** A quest-giver glyph: `kind` is the strongest state present under the
 *  shared quest_marker_kind fold ('?' turn-in ready wins over every '!'
 *  variant). Carries the quest identities behind the glyph so the hover
 *  tooltip can resolve their localized titles + level requirements (this
 *  core stays i18n-free). */
export interface MapNpcMarker {
  mx: number;
  my: number;
  kind: MapQuestMarkerKind;
  quests: MapNpcQuestRef[];
}

/** The glyph hit radius for the map hover tooltip, in canvas px: the '?'/'!'
 *  glyphs draw at a ~15px font, and a touch of slack keeps the hover forgiving. */
export const MAP_NPC_GLYPH_HIT_RADIUS = 10;

/** Hit radius for a zone-map gather node icon (ready radius ~5px plus slack for
 *  the type silhouette and soft glow). Same nearest-wins rule as NPC glyphs. */
export const MAP_GATHER_NODE_HIT_RADIUS = 10;

/** Hit radius for a crafting-station badge on the zone map. */
export const MAP_STATION_HIT_RADIUS = 10;

/** Hit radius for a civic-service badge on the zone map. */
export const MAP_SERVICE_HIT_RADIUS = 10;

/** Navigation paintings are larger than resource/service badges and remain
 * comfortably hoverable across their full keyed silhouette. */
export const MAP_NAVIGATION_HIT_RADIUS = 15;

/** Minimum physical radius for a stationary touch on a point marker. The
 * caller converts this CSS-pixel value into canvas backing pixels. */
export const MAP_TOUCH_POINT_HIT_RADIUS_CSS_PX = 20;

/** Responsive placement budget for stable landmark badges. Compact touch HUDs
 * need extra backing-space separation because CSS scales the map canvas down;
 * gathering nodes are never routed through this allocator and remain at their
 * exact authored projections. */
export const MAP_LANDMARK_PLACEMENT_BY_PROFILE = Object.freeze({
  standard: Object.freeze({ separation: 24, edgeInset: 12 }),
  compact: Object.freeze({ separation: 34, edgeInset: 17 }),
} as const satisfies Readonly<
  Record<MapMarkerProfile, Readonly<{ separation: number; edgeInset: number }>>
>);

/** Compatibility name for consumers that mean the standard desktop profile. */
export const MAP_LANDMARK_SEPARATION = MAP_LANDMARK_PLACEMENT_BY_PROFILE.standard.separation;

/** Compatibility name retained for station consumers of the original rule. */
export const MAP_STATION_NPC_SEPARATION = MAP_LANDMARK_SEPARATION;

const MAP_LANDMARK_PLACEMENT_STEPS = 48;

/** Hard bound on how far the de-overlap allocator may move a landmark badge
 *  from its authored projection, in WORLD yards. The separation rule works in
 *  constant canvas pixels while the view's scale varies 6x with zoom, so at
 *  the full-zone frame an unbounded search could carry a badge tens of yards
 *  from the thing it marks (the Eastbrook toolworks badge landed on a player
 *  26 yards away). Inside the cap badges still spread; past it they stay put
 *  and overlap honestly. */
export const MAP_LANDMARK_MAX_NUDGE_YD = 4;
const MAP_LANDMARK_DIRECTION_X = Object.freeze([
  1,
  Math.SQRT1_2,
  0,
  -Math.SQRT1_2,
  -1,
  -Math.SQRT1_2,
  0,
  Math.SQRT1_2,
] as const);
const MAP_LANDMARK_DIRECTION_Y = Object.freeze([
  0,
  Math.SQRT1_2,
  1,
  Math.SQRT1_2,
  0,
  -Math.SQRT1_2,
  -1,
  -Math.SQRT1_2,
] as const);

/** The nearest quest-giver glyph within the hit radius of a canvas point, or
 *  null. Nearest (not first) so two adjacent givers resolve intuitively. */
export function npcMarkerAt(
  npcs: readonly MapNpcMarker[],
  mx: number,
  my: number,
): MapNpcMarker | null {
  let best: MapNpcMarker | null = null;
  let bestD2 = MAP_NPC_GLYPH_HIT_RADIUS * MAP_NPC_GLYPH_HIT_RADIUS;
  for (const n of npcs) {
    const dx = mx - n.mx;
    const dy = my - n.my;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = n;
    }
  }
  return best;
}

/** A gatherable world node on the zone map (ore / wood / herb). Positions come
 *  from static content (never entities), so the online interest radius never
 *  hides a far-away vein. `ready` / `locked` mirror the minimap's two
 *  dimensions (per-viewer respawn + wield-filtered tool tier) so both surfaces
 *  agree. Actionable info on every graphics tier (fairness: never preset-gated).
 *  Distinct from quest-objective gather blobs in quest_targets: those cluster
 *  only active-quest collect targets; this layer marks every node in the zone. */
export interface MapGatherNodeMarker {
  mx: number;
  my: number;
  /** Authored content id; the hover tooltip reuses buildGatherNodeTooltip. */
  nodeId: string;
  type: GatherNodeType;
  ready: boolean;
  locked: boolean;
}

/** The nearest gather-node marker within the hit radius of a canvas point, or
 *  null. Nearest (not first) so a tight resource field resolves to the closest
 *  icon under the cursor. */
export function gatherNodeMarkerAt(
  nodes: readonly MapGatherNodeMarker[],
  mx: number,
  my: number,
): MapGatherNodeMarker | null {
  let best: MapGatherNodeMarker | null = null;
  let bestD2 = MAP_GATHER_NODE_HIT_RADIUS * MAP_GATHER_NODE_HIT_RADIUS;
  for (const n of nodes) {
    const dx = mx - n.mx;
    const dy = my - n.my;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = n;
    }
  }
  return best;
}

/** A crafting station on the zone map. The badge can be displaced a few
 * canvas pixels from its exact projection to keep a nearby quest glyph clear;
 * stationId/type remain the authoritative content identity for its tooltip. */
export interface MapStationMarker {
  mx: number;
  my: number;
  stationId: string;
  type: StationType;
}

/** The nearest crafting-station badge within its hit radius, or null. */
export function stationMarkerAt(
  stations: readonly MapStationMarker[],
  mx: number,
  my: number,
): MapStationMarker | null {
  let best: MapStationMarker | null = null;
  let bestD2 = MAP_STATION_HIT_RADIUS * MAP_STATION_HIT_RADIUS;
  for (const station of stations) {
    const dx = mx - station.mx;
    const dy = my - station.my;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = station;
    }
  }
  return best;
}

/** A static mailbox or interactive noticeboard on the zone map. Positions
 * come from the injected active-world services snapshot, never live entities. */
export interface MapServiceMarker {
  mx: number;
  my: number;
  kind: 'mailbox' | 'noticeboard';
}

/** A stable route or a nearby live Rift entrance on the zone map. Static
 * identities come from authored content; Rift name/rank come only from a live
 * entity inside the host-fair disclosure range. */
export type MapNavigationMarker =
  | {
      kind: 'delve-entrance';
      mx: number;
      my: number;
      delveId: string;
    }
  | {
      kind: 'world-passage';
      mx: number;
      my: number;
      portalId: string;
      destinationZoneId: string;
    }
  | {
      kind: 'rift-entrance';
      mx: number;
      my: number;
      name: string;
      rank: RiftTier | null;
    };

/** The nearest civic-service badge within its hit radius, or null. */
export function serviceMarkerAt(
  services: readonly MapServiceMarker[],
  mx: number,
  my: number,
): MapServiceMarker | null {
  let best: MapServiceMarker | null = null;
  let bestD2 = MAP_SERVICE_HIT_RADIUS * MAP_SERVICE_HIT_RADIUS;
  for (const service of services) {
    const dx = mx - service.mx;
    const dy = my - service.my;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = service;
    }
  }
  return best;
}

export type MapPointMarkerHit =
  | { kind: 'npc'; marker: MapNpcMarker; distance2: number }
  | { kind: 'navigation'; marker: MapNavigationMarker; distance2: number }
  | { kind: 'station'; marker: MapStationMarker; distance2: number }
  | { kind: 'service'; marker: MapServiceMarker; distance2: number }
  | { kind: 'gather'; marker: MapGatherNodeMarker; distance2: number };

type MapPointMarker =
  | MapNpcMarker
  | MapNavigationMarker
  | MapStationMarker
  | MapServiceMarker
  | MapGatherNodeMarker;

const MAP_POINT_HIT_TIE_PRIORITY: Readonly<Record<MapPointMarkerHit['kind'], number>> = {
  npc: 0,
  navigation: 1,
  station: 2,
  service: 3,
  gather: 4,
};

function mapPointHitBefore(a: MapPointMarkerHit, b: MapPointMarkerHit): boolean {
  return (
    a.distance2 < b.distance2 ||
    (a.distance2 === b.distance2 &&
      MAP_POINT_HIT_TIE_PRIORITY[a.kind] < MAP_POINT_HIT_TIE_PRIORITY[b.kind])
  );
}

function writeMapPointHit(
  hits: MapPointMarkerHit[],
  index: number,
  kind: MapPointMarkerHit['kind'],
  marker: MapPointMarker,
  distance2: number,
): MapPointMarkerHit {
  let hit = hits[index];
  if (!hit) {
    hit = { kind, marker, distance2 } as MapPointMarkerHit;
    hits.push(hit);
    return hit;
  }
  const mutable = hit as {
    kind: MapPointMarkerHit['kind'];
    marker: MapPointMarker;
    distance2: number;
  };
  mutable.kind = kind;
  mutable.marker = marker;
  mutable.distance2 = distance2;
  return hit;
}

function insertMapPointHit(
  hits: MapPointMarkerHit[],
  hit: MapPointMarkerHit,
  activeCount: number,
): void {
  let index = activeCount;
  while (index > 0 && mapPointHitBefore(hit, hits[index - 1])) index--;
  for (let shift = activeCount; shift > index; shift--) hits[shift] = hits[shift - 1];
  hits[index] = hit;
}

function appendMapPointHits(
  hits: MapPointMarkerHit[],
  activeCount: number,
  kind: MapPointMarkerHit['kind'],
  markers: readonly { mx: number; my: number }[],
  mx: number,
  my: number,
  hitRadius2: number,
): number {
  for (const marker of markers) {
    const dx = mx - marker.mx;
    const dy = my - marker.my;
    const distance2 = dx * dx + dy * dy;
    if (distance2 > hitRadius2) continue;
    const hit = writeMapPointHit(hits, activeCount, kind, marker as MapPointMarker, distance2);
    insertMapPointHit(hits, hit, activeCount);
    activeCount++;
  }
  return activeCount;
}

/** Fill a reusable hit-slot pool and return its active prefix length. Slots at
 * or above the returned count are retained only as future capacity. */
export function mapPointMarkerHitsInto(
  npcs: readonly MapNpcMarker[],
  navigation: readonly MapNavigationMarker[],
  services: readonly MapServiceMarker[],
  stations: readonly MapStationMarker[],
  gatherNodes: readonly MapGatherNodeMarker[],
  mx: number,
  my: number,
  radius: number,
  output: MapPointMarkerHit[],
): number {
  let activeCount = 0;
  const radius2 = Math.max(0, radius) ** 2;
  activeCount = appendMapPointHits(output, activeCount, 'npc', npcs, mx, my, radius2);
  activeCount = appendMapPointHits(
    output,
    activeCount,
    'navigation',
    navigation,
    mx,
    my,
    Math.max(Math.max(0, radius), MAP_NAVIGATION_HIT_RADIUS) ** 2,
  );
  activeCount = appendMapPointHits(output, activeCount, 'station', stations, mx, my, radius2);
  activeCount = appendMapPointHits(output, activeCount, 'service', services, mx, my, radius2);
  activeCount = appendMapPointHits(output, activeCount, 'gather', gatherNodes, mx, my, radius2);
  return activeCount;
}

/** Every point-marker candidate inside a shared radius, nearest first. This is
 * the convenient cold-path wrapper around mapPointMarkerHitsInto. Exact-distance
 * ties follow visual top order. */
export function mapPointMarkerHits(
  npcs: readonly MapNpcMarker[],
  navigation: readonly MapNavigationMarker[],
  services: readonly MapServiceMarker[],
  stations: readonly MapStationMarker[],
  gatherNodes: readonly MapGatherNodeMarker[],
  mx: number,
  my: number,
  radius: number,
): MapPointMarkerHit[] {
  const output: MapPointMarkerHit[] = [];
  const activeCount = mapPointMarkerHitsInto(
    npcs,
    navigation,
    services,
    stations,
    gatherNodes,
    mx,
    my,
    radius,
    output,
  );
  output.length = activeCount;
  return output;
}

interface MapLandmarkPosition {
  mx: number;
  my: number;
}

function landmarkPositionClears(
  x: number,
  y: number,
  npcs: readonly MapNpcMarker[],
  landmarks: readonly MapLandmarkPosition[],
  minDistance2: number,
): boolean {
  for (const npc of npcs) {
    const dx = x - npc.mx;
    const dy = y - npc.my;
    if (dx * dx + dy * dy < minDistance2) return false;
  }
  for (const landmark of landmarks) {
    const dx = x - landmark.mx;
    const dy = y - landmark.my;
    if (dx * dx + dy * dy < minDistance2) return false;
  }
  return true;
}

function placeLandmarkBadge(
  mx: number,
  my: number,
  npcs: readonly MapNpcMarker[],
  landmarks: readonly MapLandmarkPosition[],
  canvasSize: number,
  placement: Readonly<{ separation: number; edgeInset: number }>,
  maxNudgeRadius: number = MAP_LANDMARK_PLACEMENT_STEPS,
): { mx: number; my: number } {
  const max = canvasSize - placement.edgeInset;
  const minDistance2 = placement.separation * placement.separation;
  const inside = mx >= placement.edgeInset && mx <= max && my >= placement.edgeInset && my <= max;
  if (inside && landmarkPositionClears(mx, my, npcs, landmarks, minDistance2)) {
    return { mx, my };
  }
  const stepLimit = Math.min(MAP_LANDMARK_PLACEMENT_STEPS, Math.max(1, Math.round(maxNudgeRadius)));
  for (let step = 1; step <= stepLimit; step++) {
    const radius = step;
    for (let angleIndex = 0; angleIndex < 8; angleIndex++) {
      const candidateX = mx + MAP_LANDMARK_DIRECTION_X[angleIndex] * radius;
      const candidateY = my + MAP_LANDMARK_DIRECTION_Y[angleIndex] * radius;
      if (
        candidateX >= placement.edgeInset &&
        candidateX <= max &&
        candidateY >= placement.edgeInset &&
        candidateY <= max &&
        landmarkPositionClears(candidateX, candidateY, npcs, landmarks, minDistance2)
      ) {
        return { mx: candidateX, my: candidateY };
      }
    }
  }

  // No clear spot inside the nudge cap: keep the badge at its authored
  // projection (edge-clamped). An overlapping badge at its true position
  // beats a clear badge that lies about where the thing is.
  return {
    mx: Math.max(placement.edgeInset, Math.min(canvasSize - placement.edgeInset, mx)),
    my: Math.max(placement.edgeInset, Math.min(canvasSize - placement.edgeInset, my)),
  };
}

/** A translucent active-quest objective area (the classic quest-POI blob):
 *  canvas-pixel center + radius over where the objective's targets live, plus
 *  the objective identities it stands for (the hover tooltip resolves their
 *  localized labels + live counts; this core stays i18n-free). */
export interface MapQuestAreaMarker {
  mx: number;
  my: number;
  radius: number;
  objectives: QuestObjectiveRef[];
  /** Distinct 1-based quest numbers (acceptance order) of the objectives
   *  here, ascending: the painter draws one numbered badge per entry, and the
   *  same numbers head the map's quest side list. */
  numbers: number[];
}

/** The distinct objectives under a canvas point, across every quest area that
 *  contains it (overlapping blobs merge into one tooltip). Pure hit-test the
 *  hover handler calls with the last painted model's areas. */
export function questAreaObjectivesAtInto(
  areas: readonly MapQuestAreaMarker[],
  mx: number,
  my: number,
  output: QuestObjectiveRef[],
): number {
  let activeCount = 0;
  for (const a of areas) {
    const dx = mx - a.mx;
    const dy = my - a.my;
    if (dx * dx + dy * dy > a.radius * a.radius) continue;
    for (const ref of a.objectives) {
      let duplicate = false;
      for (let i = 0; i < activeCount; i++) {
        const accepted = output[i];
        if (accepted.questId === ref.questId && accepted.objectiveIndex === ref.objectiveIndex) {
          duplicate = true;
          break;
        }
      }
      if (duplicate) continue;
      output[activeCount++] = ref;
    }
  }
  return activeCount;
}

/** Convenient cold-path wrapper for callers that need an exact-length array. */
export function questAreaObjectivesAt(
  areas: readonly MapQuestAreaMarker[],
  mx: number,
  my: number,
): QuestObjectiveRef[] {
  const output: QuestObjectiveRef[] = [];
  output.length = questAreaObjectivesAtInto(areas, mx, my, output);
  return output;
}

/** The local player's facing arrow (canvas rotation matches -facing). */
export interface MapPlayerMarker {
  mx: number;
  my: number;
  angle: number;
}

/** An online ally dot: friends win ties over guild members (dedup by id). */
export interface MapAllyMarker {
  mx: number;
  my: number;
  name: string;
  kind: 'friend' | 'guild';
}

/** A party member dot (issue 2652): identity only, the class color and the
 *  dead-state token are resolved by the painter, matching this file's stated
 *  convention for every other marker. Works offline and online (both worlds
 *  populate `partyInfo.members[].x/z/cls/dead` identically). */
export interface MapPartyMarker {
  mx: number;
  my: number;
  name: string;
  cls: string;
  dead: boolean;
}

/** A vegetation dot in the detail overlay (rock vs pine/oak foliage). */
export interface MapDecorationMarker {
  mx: number;
  my: number;
  kind: 'rock' | 'tree' | 'oak';
  radius: number;
}

/** A building footprint in the detail overlay: four rotated, projected corners. */
export interface MapBuildingMarker {
  /** Authored placement id, or null for legacy records without one. */
  id: string | null;
  points: { mx: number; my: number }[];
  kind: 'armoury' | 'chapel' | 'inn' | 'house' | 'wall';
}

/** The map reads a building by SILHOUETTE, not by its content kind: the Veiled
 *  Hollow set draws as the ordinary town shapes it stands in for. Total by
 *  construction, so a new BuildingDef kind must pick its footprint here rather
 *  than falling through to a default. */
const MAP_MARKER_KIND: Readonly<Record<BuildingDef['kind'], MapBuildingMarker['kind']>> = {
  house: 'house',
  inn: 'inn',
  chapel: 'chapel',
  hollowHouse: 'house',
  hollowInn: 'inn',
  hollowChapel: 'chapel',
  hollowSmith: 'house',
  hollowMarket: 'house',
};

/** Resolve a map footprint independently from a building's gameplay kind. The
 *  Grand Armoury keeps the replaced inn lot's rest semantics, but must read as
 *  the civic landmark on the map. */
export function mapBuildingMarkerKind(building: {
  kind: BuildingDef['kind'];
  landmark?: 'eastbrook_grand_armoury';
}): MapBuildingMarker['kind'] {
  return building.landmark === 'eastbrook_grand_armoury'
    ? 'armoury'
    : MAP_MARKER_KIND[building.kind];
}

/** A small prop dot in the detail overlay (well / stall / tent / ...). */
export interface MapPropMarker {
  /** Authored placement id, or null for legacy records without one. */
  id: string | null;
  mx: number;
  my: number;
  kind: 'well' | 'stall' | 'tent' | 'mine' | 'graveyard' | 'mudhut' | 'campfire';
  radius: number;
}

/** The zoomed-detail overlay (only present at/above MAP_DETAIL_ZOOM). */
export interface MapDetail {
  decorations: MapDecorationMarker[];
  buildings: MapBuildingMarker[];
  props: MapPropMarker[];
}

/** Everything the painter draws for one overworld map frame, all in canvas-pixel
 *  space and derived purely from IWorld + the committed zone. */
export interface OverworldMapModel {
  /** The current-zone frame bounds + current zoomed spans (Hud's mapView). */
  view: MapViewRect;
  /** Drag cursor when zoomed past the full-zone view. */
  cursor: 'grab' | 'default';
  /** The visible world rect. The painter composites the current zone's cached
   *  background into it (+X is map-left, +Z map-up; R61) over an ocean fill. */
  region: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** The committed zone id (the painter localizes the on-canvas title + summary). */
  zoneId: string;
  pois: MapPoiMarker[];
  portals: MapPortalMarker[];
  /** Both castles' curtain plans, drawn at every zone zoom (see
   *  castle_plan_core: the walls are lift field, so the baked plate that
   *  paints from terrainHeight never shows them). */
  castles: CastlePlanMarker[];
  npcs: MapNpcMarker[];
  questAreas: MapQuestAreaMarker[];
  /** Gather nodes in the committed zone (all zoom levels). Empty only when
   *  the zone has no authored nodes in view. */
  gatherNodes: MapGatherNodeMarker[];
  /** Crafting stations in the committed zone, collision-safe beside quest masters. */
  stations: MapStationMarker[];
  /** Active-world mailboxes and noticeboards, collision-safe with other landmarks. */
  services: MapServiceMarker[];
  /** Collision-safe route badges and nearby live Rift entrances. */
  navigation: MapNavigationMarker[];
  player: MapPlayerMarker | null;
  allies: MapAllyMarker[];
  /** Party members other than self, live world position (issue 2652). Empty
   *  solo or with no party formed. */
  party: MapPartyMarker[];
  /** The zoomed-detail overlay, or null below MAP_DETAIL_ZOOM. */
  detail: MapDetail | null;
  /** Canvas-space "Show on Map" highlight, or null when absent / out of view. */
  ping: { mx: number; my: number } | null;
  /** When the player is inside a rift, its floor name + C/B/A/S rank (rank null
   *  for dev-portal runs), so the painter can show this instead of the
   *  overworld zone title. Mirrors MinimapModel.rift; null outside a rift. */
  rift: { name: string; rank: string | null } | null;
}

/** Inputs the painter feeds the builder each redraw. The cached terrain bg + the
 *  current-zone decorations are owned by the painter and passed in. */
export interface OverworldMapInput {
  world: IWorld;
  /** Active authored props, supplied by the host so custom-world playtests stay pure and exact. */
  props: ZonePropsDef;
  /** The committed zone (resolved by Hud, which also keys the cached bg by it). */
  zone: ZoneDef;
  /** Current world-map zoom (1 = whole zone). */
  zoom: number;
  /** Pan target in world coords, or null to follow the player. */
  center: { x: number; z: number } | null;
  /** The square map-canvas side in px. */
  canvasSize: number;
  /** The cached current-zone decorations. */
  decorations: readonly Decoration[];
  /** Dungeon Finder "Show on Map" highlight in world coords, or null. */
  ping?: { x: number; z: number } | null;
  /** Responsive marker profile, resolved once by the painter per redraw. */
  markerProfile?: MapMarkerProfile;
}

/** Which world-map surface this world renders. Delve when the player stands in a
 *  delve band and a run is active (matches the inline guard); overworld otherwise. */
export function mapWindowMode(world: IWorld): MapWindowMode {
  if (world.riftFloor) return 'rift';
  if (isBgPos(world.player.pos.x)) return 'battleground';
  if (dungeonMapActive(world)) return 'dungeon';
  return isDelvePos(world.player.pos.x) && world.delveRun ? 'delve' : 'overworld';
}

/**
 * Build the overworld map draw model. Reads only IWorld members (player /
 * socialInfo / questState / questLog) plus the committed zone and shared world
 * content (ZONES bounds, dungeon portals, camps, props, decorations, NPCS), so
 * the offline Sim and the online ClientWorld mirror produce identical output.
 * Every position is projected to canvas pixels here; the painter only resolves
 * colors + localized text and strokes.
 */
export function buildOverworldMapModel(input: OverworldMapInput): OverworldMapModel {
  const { world, props, zone, zoom, center, canvasSize: S, decorations } = input;
  const landmarkPlacement = MAP_LANDMARK_PLACEMENT_BY_PROFILE[input.markerProfile ?? 'standard'];
  const p = world.player;

  // Inside a rift the overworld zone (the current-zone frame below still keys
  // off `zone`, which the player's far-off rift x displaces past any real
  // band) is the wrong title; surface the generated rift floor name + rank
  // instead, mirroring minimap_markers.ts's identical override.
  const rf = world.riftFloor;
  const rift = rf ? { name: rf.name, rank: rf.tier } : null;

  // Frame only the committed zone. A square frame preserves world scale; a
  // rectangular zone therefore gets ocean letterboxing on its shorter axis,
  // never terrain or markers from a neighbouring zone.
  const zoneMinX = zone.xMin ?? STRIP_MIN_X;
  const zoneMaxX = zone.xMax ?? STRIP_MAX_X;
  const zoneCx = (zoneMinX + zoneMaxX) / 2;
  const zoneCz = (zone.zMin + zone.zMax) / 2;
  const fullSpan = Math.max(zoneMaxX - zoneMinX, zone.zMax - zone.zMin);
  const full: MapViewRect = {
    spanX: fullSpan,
    spanZ: fullSpan,
    minX: zoneCx - fullSpan / 2,
    maxX: zoneCx + fullSpan / 2,
    minZ: zoneCz - fullSpan / 2,
    maxZ: zoneCz + fullSpan / 2,
  };
  // Zoomed view: a smaller square centred on the player (or pan target), clamped
  // to the current-zone frame. zoom 1 = the whole zone square.
  const spanX = fullSpan / zoom;
  const spanZ = fullSpan / zoom;
  const baseX = center ? center.x : p.pos.x;
  const baseZ = center ? center.z : p.pos.z;
  const cx = Math.max(full.minX + spanX / 2, Math.min(full.maxX - spanX / 2, baseX));
  const cz = Math.max(full.minZ + spanZ / 2, Math.min(full.maxZ - spanZ / 2, baseZ));
  const region = {
    minX: cx - spanX / 2,
    maxX: cx + spanX / 2,
    minZ: cz - spanZ / 2,
    maxZ: cz + spanZ / 2,
  };

  // +X is map-left (east = -X); +Z is map-up (north = +Z): my shrinks as z
  // grows. This projection is the compass authority for player-facing
  // direction words (R61, docs/design/professions-tuning-packet-review.md);
  // the layout files' legacy +x=east names are raw coordinates, not compass.
  const toMap = (x: number, z: number): { mx: number; my: number } => ({
    mx: ((region.maxX - x) / spanX) * S,
    my: ((region.maxZ - z) / spanZ) * S,
  });
  // The de-overlap allocator's reach, converted to canvas pixels at the live
  // scale so a badge can never drift more than MAP_LANDMARK_MAX_NUDGE_YD from
  // what it marks (at zoom 1 the old constant-pixel search spanned 30 yards).
  const landmarkMaxNudge = Math.max(1, (MAP_LANDMARK_MAX_NUDGE_YD / spanX) * S);
  const inView = (x: number, z: number): boolean =>
    x >= region.minX - MARKER_VIEW_MARGIN &&
    x <= region.maxX + MARKER_VIEW_MARGIN &&
    z >= region.minZ - MARKER_VIEW_MARGIN &&
    z <= region.maxZ + MARKER_VIEW_MARGIN;
  // Stable painted landmarks are displaced by the collision allocator. They
  // must begin inside the actual viewport, otherwise an off-screen point that
  // merely enters the general marker margin can be clamped into a false badge
  // on the canvas edge.
  const inVisibleRegion = (x: number, z: number): boolean =>
    x >= region.minX && x <= region.maxX && z >= region.minZ && z <= region.maxZ;
  const inZone = (x: number, z: number): boolean =>
    x >= zoneMinX && x < zoneMaxX && z >= zone.zMin && z < zone.zMax;

  // Declutter: labels only draw when the current zone's visible span is narrow
  // enough; portals and the player remain visible at every zone scale.
  const labels = spanX < LABEL_SPAN;

  // Dungeon Finder "Show on Map" ping: a canvas-space highlight at an authored
  // entrance, drawn only while the point sits inside the painted region.
  const ping =
    input.ping &&
    input.ping.x >= region.minX &&
    input.ping.x <= region.maxX &&
    input.ping.z >= region.minZ &&
    input.ping.z <= region.maxZ
      ? toMap(input.ping.x, input.ping.z)
      : null;
  const detail =
    spanX < DETAIL_SPAN ? buildDetail(region, toMap, inZone, S / spanX, decorations, props) : null;

  // Only the committed zone contributes POIs, even where a rectangular zone's
  // square frame contains ocean beside its terrain plate.
  const pois: MapPoiMarker[] = [];
  if (labels) {
    for (let poiIndex = 0; poiIndex < zone.pois.length; poiIndex++) {
      const poi = zone.pois[poiIndex];
      // A hidden POI keeps its record and its deed mark, it just stops drawing
      // a label; the index is NOT skipped, because poi labels resolve through
      // POSITIONAL locale keys and renumbering would mistranslate every later
      // landmark in the zone.
      if (poi.hideOnMap) continue;
      if (!inView(poi.x, poi.z)) continue;
      const { mx, my } = toMap(poi.x, poi.z);
      pois.push({ mx, my, zoneId: zone.id, poiIndex });
    }
  }

  // Active-quest objective areas (the classic "your targets live here" blobs),
  // derived from the static content tables (camps / ground objects / NPCs), so
  // the online interest radius never hides a far-away camp. Culled to the visible
  // map rect (inView) like every other grid-map marker; radius scales with zoom.
  // Each area carries its quests' acceptance-order numbers for the badges.
  const questNumbers = questNumbersByLog(world.questLog);
  const questAreas: MapQuestAreaMarker[] = [];
  for (const area of questObjectiveAreas(world.questLog)) {
    if (!inZone(area.center.x, area.center.z) || !inView(area.center.x, area.center.z)) continue;
    const objectives = area.objectives;
    if (objectives.length === 0) continue;
    const numbers: number[] = [];
    for (const ref of objectives) {
      const n = questNumbers.get(ref.questId);
      if (n !== undefined && !numbers.includes(n)) numbers.push(n);
    }
    numbers.sort((a, b) => a - b);
    const { mx, my } = toMap(area.center.x, area.center.z);
    questAreas.push({ mx, my, radius: (area.radius / spanX) * S, objectives, numbers });
  }

  // Dungeon portals owned by the current zone (shown at every zoom).
  const portals: MapPortalMarker[] = [];
  for (const portal of overworldDungeonPortals(DUNGEON_LIST, zone.zMin, zone.zMax)) {
    if (!inZone(portal.x, portal.z) || !inView(portal.x, portal.z)) continue;
    const { mx, my } = toMap(portal.x, portal.z);
    portals.push({ mx, my, dungeonId: portal.id });
  }

  // Gather nodes (ore / wood / herb) for the committed zone: static content
  // positions, same ready/locked dimensions as the minimap. Zone-id filter
  // first so a pan across a neighbour never leaks foreign nodes; then inView
  // so a panned sub-rect only pays for what is on screen. Tool-tier memo is
  // per-build and per-profession (the minimap shape): empty inventory locks
  // every node, and a tool picked up between redraws re-resolves next paint.
  // Cap is tiny (at most six of each type per zone in content), so individual
  // markers stay cheap at every zoom, including the full-zone frame.
  const gatherNodes: MapGatherNodeMarker[] = [];
  let bestToolTiers: Map<GatheringProfessionId, number> | null = null;
  let proficiency: Readonly<Record<string, number>> | undefined;
  for (const node of GATHER_NODES) {
    if (node.zoneId !== zone.id) continue;
    if (!inView(node.pos.x, node.pos.z)) continue;
    bestToolTiers ??= new Map();
    const professionId = NODE_HARVEST_TABLE[node.type].professionId;
    let best = bestToolTiers.get(professionId);
    if (best === undefined) {
      proficiency ??= world.gatheringProficiency;
      best = viewerUsableToolTier(world, professionId, proficiency);
      bestToolTiers.set(professionId, best);
    }
    const { mx, my } = toMap(node.pos.x, node.pos.z);
    gatherNodes.push({
      mx,
      my,
      nodeId: node.id,
      type: node.type,
      ready: world.nodeHarvestableByMe(node.id),
      locked: !canGatherTier(best, node.tier),
    });
  }

  // The castle plans. Drawn like portals at every zone zoom rather than
  // behind the DETAIL_SPAN gate: a castle is the landmark you navigate by,
  // and the plate cannot show it at any zoom.
  const castles = buildCastlePlanMarkers(region, toMap);

  // Quest-giver glyphs, resolved from the static NPCS content table (like the
  // quest-area blobs above) rather than world.entities, so the online interest
  // radius never hides a distant giver's '!'/'?' glyph. questsDone and the
  // cadence-blocked set feed the shared quest_marker_kind rule (the repeat
  // and cooldown variants); both are IWorld members on both worlds, so the
  // offline map and the online mirror classify identically.
  const npcs: MapNpcMarker[] = [];
  const blocked = world.craftingIdentity?.cadenceBlockedQuests;
  const cadenceBlocked = blocked && blocked.length > 0 ? new Set(blocked) : undefined;
  for (const marker of questGiverNpcMarkers(
    (q) => world.questState(q),
    world.questsDone,
    cadenceBlocked,
  )) {
    if (!inZone(marker.pos.x, marker.pos.z) || !inView(marker.pos.x, marker.pos.z)) continue;
    const { mx, my } = toMap(marker.pos.x, marker.pos.z);
    npcs.push({ mx, my, kind: marker.kind, quests: marker.quests });
  }

  // Route-critical navigation is placed before services and stations, so those
  // lower layers clear it. Static delve doors and world passages are immutable
  // authored sites. Rift entrances are the exception: only live entities at or
  // inside 80 yards are disclosed, matching both hosts' world-visibility rule.
  const landmarks: MapLandmarkPosition[] = [];
  const navigation: MapNavigationMarker[] = [];
  const placeNavigation = (x: number, z: number): { mx: number; my: number } | null => {
    if (!inVisibleRegion(x, z)) return null;
    const projected = toMap(x, z);
    const placed = placeLandmarkBadge(
      projected.mx,
      projected.my,
      npcs,
      landmarks,
      S,
      landmarkPlacement,
      landmarkMaxNudge,
    );
    landmarks.push(placed);
    return placed;
  };
  for (const site of STABLE_MAP_NAVIGATION_LANDMARKS) {
    if (site.zoneId !== zone.id) continue;
    const placed = placeNavigation(site.x, site.z);
    if (!placed) continue;
    if (site.kind === 'delve-entrance') {
      navigation.push({
        kind: 'delve-entrance',
        mx: placed.mx,
        my: placed.my,
        delveId: site.id,
      });
    } else {
      navigation.push({
        kind: 'world-passage',
        mx: placed.mx,
        my: placed.my,
        portalId: site.id,
        destinationZoneId: site.destinationZoneId,
      });
    }
  }
  for (const entity of world.entities.values()) {
    if (!isNearbyLiveRiftZoneMapEntity(entity, p.pos)) continue;
    if (!inZone(entity.pos.x, entity.pos.z)) continue;
    const placed = placeNavigation(entity.pos.x, entity.pos.z);
    if (!placed) continue;
    navigation.push({
      kind: 'rift-entrance',
      mx: placed.mx,
      my: placed.my,
      name: entity.name,
      rank: entity.riftTier ?? null,
    });
  }

  // Stable civic landmarks come from IWorld's authored service snapshot, never
  // live entities (whose online interest scope would hide distant services).
  // Mailboxes precede noticeboards in their authored array order. Muster boards
  // are deliberately absent: they are non-interactive scenery, not a service.
  // Every accepted marker enters the shared placement list so later services
  // and stations clear it deterministically as well as every quest glyph.
  const services: MapServiceMarker[] = [];
  const appendService = (x: number, z: number, kind: MapServiceMarker['kind']): void => {
    if (!inZone(x, z) || !inVisibleRegion(x, z)) return;
    const projected = toMap(x, z);
    const placed = placeLandmarkBadge(
      projected.mx,
      projected.my,
      npcs,
      landmarks,
      S,
      landmarkPlacement,
      landmarkMaxNudge,
    );
    const marker: MapServiceMarker = { mx: placed.mx, my: placed.my, kind };
    services.push(marker);
    landmarks.push(marker);
  };
  for (const service of world.civicServicePlacements) {
    appendService(service.x, service.z, service.kind);
  }

  // Crafting stations come through IWorld so custom-map playtests never inherit
  // the built-in station table. Their masters are quest givers and stand only a
  // few yards away, which projects to 2 to 5px at the full-zone scale. The same
  // bounded radial allocation keeps each station clear of NPCs, civic services,
  // earlier stations, and the canvas edge, within the world-yard nudge cap;
  // clustered badges past the cap overlap at their true spots instead. At
  // closer zoom the authored distance exceeds the threshold and no nudge
  // occurs.
  const stations: MapStationMarker[] = [];
  for (const station of world.stationPlacements) {
    if (station.zoneId !== zone.id || !inVisibleRegion(station.pos.x, station.pos.z)) continue;
    const projected = toMap(station.pos.x, station.pos.z);
    const placed = placeLandmarkBadge(
      projected.mx,
      projected.my,
      npcs,
      landmarks,
      S,
      landmarkPlacement,
      landmarkMaxNudge,
    );
    const marker: MapStationMarker = {
      mx: placed.mx,
      my: placed.my,
      stationId: station.id,
      type: station.type,
    };
    stations.push(marker);
    landmarks.push(marker);
  }

  let player: MapPlayerMarker | null = null;
  if (inZone(p.pos.x, p.pos.z) && inView(p.pos.x, p.pos.z)) {
    const { mx, my } = toMap(p.pos.x, p.pos.z);
    player = { mx, my, angle: -p.facing };
  }

  // Party members (issue 2652): the minimap's already-consumed
  // partyInfo.members, projected the same way as every other in-zone marker.
  // Self is excluded (the player already has its own arrow); gated on `labels`
  // like the ally dots above, since a party marker also carries a name label.
  // Built before the ally loop so `partyNames` can gate it (see below).
  const party: MapPartyMarker[] = [];
  const partyNames = new Set<string>();
  const partyInfo = world.partyInfo;
  if (labels && partyInfo) {
    for (const m of partyInfo.members) {
      if (m.pid === p.id) continue;
      partyNames.add(m.name);
      if (!inZone(m.x, m.z) || !inView(m.x, m.z)) continue;
      const { mx, my } = toMap(m.x, m.z);
      party.push({ mx, my, name: m.name, cls: m.cls, dead: m.dead !== 0 });
    }
  }

  // Friends (green) and guild members (blue), plotted from the live positions the
  // server streams for online allies. socialInfo is null offline, so this is
  // online-only; friends are plotted first and win ties (dedup by id). A friend
  // or guildmate who is also a party member is skipped here: the party loop
  // above already draws them with their class color, matching how
  // minimap_markers.ts excludes partyPids from its entity loop to avoid the
  // same double dot.
  const allies: MapAllyMarker[] = [];
  const social = world.socialInfo;
  if (labels && social) {
    const selfName = p.name;
    const drawn = new Set<number>();
    const plotAlly = (m: FriendInfo, kind: 'friend' | 'guild'): void => {
      if (
        !m.online ||
        m.x === undefined ||
        m.z === undefined ||
        m.name === selfName ||
        drawn.has(m.id) ||
        partyNames.has(m.name)
      )
        return;
      if (!inZone(m.x, m.z) || !inView(m.x, m.z)) return;
      drawn.add(m.id);
      const { mx, my } = toMap(m.x, m.z);
      allies.push({ mx, my, name: m.name, kind });
    };
    for (const f of social.friends) plotAlly(f, 'friend');
    if (social.guild) for (const m of social.guild.members) plotAlly(m, 'guild');
  }

  return {
    view: { spanX, spanZ, minX: full.minX, maxX: full.maxX, minZ: full.minZ, maxZ: full.maxZ },
    cursor: zoom > 1 ? 'grab' : 'default',
    region: { minX: region.minX, maxX: region.maxX, minZ: region.minZ, maxZ: region.maxZ },
    zoneId: zone.id,
    pois,
    portals,
    castles,
    npcs,
    questAreas,
    gatherNodes,
    stations,
    services,
    navigation,
    player,
    allies,
    party,
    detail,
    ping,
    rift,
  };
}

// Buildings + vegetation overlay for the zoomed-in map, drawn from the same shared
// active authored props the renderer uses plus the cached decorations, so custom
// playtests and the built-in world stay exact. Only built at/above
// MAP_DETAIL_ZOOM. `ppu` is pixels per world unit (the X axis; footprints stay
// roughly to scale).
function buildDetail(
  region: { minX: number; maxX: number; minZ: number; maxZ: number },
  toMap: (x: number, z: number) => { mx: number; my: number },
  inZone: (x: number, z: number) => boolean,
  ppu: number,
  decorations: readonly Decoration[],
  authoredProps: ZonePropsDef,
): MapDetail {
  const inView = (x: number, z: number): boolean =>
    inZone(x, z) &&
    x >= region.minX - DETAIL_VIEW_MARGIN &&
    x <= region.maxX + DETAIL_VIEW_MARGIN &&
    z >= region.minZ - DETAIL_VIEW_MARGIN &&
    z <= region.maxZ + DETAIL_VIEW_MARGIN;

  const decoMarkers: MapDecorationMarker[] = [];
  for (const d of decorations) {
    if (!inView(d.x, d.z)) continue;
    const { mx, my } = toMap(d.x, d.z);
    if (d.kind === 'rock') {
      decoMarkers.push({
        mx,
        my,
        kind: 'rock',
        radius: Math.max(ROCK_MIN_RADIUS, ppu * ROCK_RADIUS_PPU),
      });
    } else {
      // pine ('tree') darker, oak lighter; same radius.
      decoMarkers.push({
        mx,
        my,
        kind: d.kind === 'tree' ? 'tree' : 'oak',
        radius: Math.max(FOLIAGE_MIN_RADIUS, ppu * FOLIAGE_RADIUS_PPU),
      });
    }
  }

  const buildings: MapBuildingMarker[] = [];
  const footprint = (
    placement: { id?: string; x: number; z: number; w: number; d: number; rot: number },
    kind: MapBuildingMarker['kind'],
  ): void => {
    if (!inView(placement.x, placement.z)) return;
    const c = Math.cos(placement.rot);
    const s = Math.sin(placement.rot);
    const corner = (dx: number, dz: number): { mx: number; my: number } =>
      toMap(placement.x + dx * c - dz * s, placement.z + dx * s + dz * c);
    const points = [
      corner(-placement.w / 2, -placement.d / 2),
      corner(placement.w / 2, -placement.d / 2),
      corner(placement.w / 2, placement.d / 2),
      corner(-placement.w / 2, placement.d / 2),
    ];
    buildings.push({ id: placement.id ?? null, points, kind });
  };
  for (const building of authoredProps.buildings) {
    footprint(building, mapBuildingMarkerKind(building));
  }
  // Walls are authored beside the active world's other static props. Treat each
  // wall OBB as a footprint so the map shows the exact live perimeter and custom
  // worlds neither inherit nor lose geometry through a built-in layout lookup.
  for (const wall of authoredProps.walls ?? []) {
    footprint(wall, 'wall');
  }

  const props: MapPropMarker[] = [];
  const dot = (
    id: string | undefined,
    x: number,
    z: number,
    kind: MapPropMarker['kind'],
    radius = Math.max(PROP_MIN_RADIUS, ppu * PROP_RADIUS_PPU),
  ): void => {
    if (!inView(x, z)) return;
    const { mx, my } = toMap(x, z);
    props.push({ id: id ?? null, mx, my, kind, radius });
  };
  for (const w of authoredProps.wells) dot(w.id, w.x, w.z, 'well');
  for (const st of authoredProps.stalls) dot(st.id, st.x, st.z, 'stall');
  for (const tn of authoredProps.tents) dot(undefined, tn.x, tn.z, 'tent');
  for (const m of authoredProps.mines) dot(undefined, m.x, m.z, 'mine');
  for (const g of authoredProps.graveyards) dot(undefined, g.x, g.z, 'graveyard');
  for (const [x, z] of authoredProps.mudHuts) dot(undefined, x, z, 'mudhut');
  for (const [x, z] of authoredProps.campfires)
    dot(undefined, x, z, 'campfire', Math.max(CAMPFIRE_MIN_RADIUS, ppu * CAMPFIRE_RADIUS_PPU));

  return { decorations: decoMarkers, buildings, props };
}
