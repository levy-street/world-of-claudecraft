// Pure, host-agnostic draw model for the world-map window (overworld branch).
//
// The pure-core half of the pure-core + canvas-painter split (root CLAUDE.md
// Conventions; reference delve_map.ts / delve_map_painter.ts). It maps IWorld
// state plus the committed zone to a flat geometry model in canvas-pixel space:
// the background blit rect, the zoomed-detail overlay, and every label / portal /
// npc glyph / player arrow / ally dot / party dot already projected to (mx, my). No DOM, no
// Three, no 2D context, no i18n, no color: the painter owns the context and
// resolves the --color-map-* tokens + the localized label text. The delve branch
// of the map is owned by delve_map_painter.ts; this core models only the
// overworld branch, plus the mode discriminator the painter switches on.
//
// DOM-free / i18n-free / deterministic so tests/map_window_view.test.ts can drive
// it directly with both a Sim-shaped and a ClientWorld-mirror-shaped IWorld stub.
// Markers carry the identity (zoneId / poiIndex / dungeonId / cls)
// the painter needs to resolve their localized text, never the resolved string.

import {
  DUNGEON_LIST,
  isDelvePos,
  QUESTS,
  STRIP_MAX_X,
  STRIP_MIN_X,
  type ZoneDef,
} from '../sim/data';
import { type QuestObjectiveRef, questObjectiveAreas } from '../sim/quest_targets';
import { type BuildingDef, isQuestTurnInNpc, type ZonePropsDef } from '../sim/types';
import type { Decoration } from '../sim/world';
import type { FriendInfo, IWorld } from '../world_api';
import { overworldDungeonPortals } from './map_dungeon_portals';
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
 *  delve_map_painter) or the overworld map (this core). */
export type MapWindowMode = 'delve' | 'overworld';

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

/** One quest carried by a map quest-giver glyph, for its hover tooltip. */
export interface MapNpcQuestRef {
  questId: string;
  /** true = ready to turn in (the '?' state); false = available to pick up. */
  ready: boolean;
}

/** A quest-giver glyph: '?' (turn-in ready) wins over '!' (available). Carries
 *  the quest identities behind the glyph so the hover tooltip can resolve
 *  their localized titles + level requirements (this core stays i18n-free). */
export interface MapNpcMarker {
  mx: number;
  my: number;
  ready: boolean;
  quests: MapNpcQuestRef[];
}

/** The glyph hit radius for the map hover tooltip, in canvas px: the '?'/'!'
 *  glyphs draw at a ~15px font, and a touch of slack keeps the hover forgiving. */
export const MAP_NPC_GLYPH_HIT_RADIUS = 10;

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
export function questAreaObjectivesAt(
  areas: readonly MapQuestAreaMarker[],
  mx: number,
  my: number,
): QuestObjectiveRef[] {
  const refs: QuestObjectiveRef[] = [];
  const seen = new Set<string>();
  for (const a of areas) {
    const dx = mx - a.mx;
    const dy = my - a.my;
    if (dx * dx + dy * dy > a.radius * a.radius) continue;
    for (const ref of a.objectives) {
      const key = `${ref.questId}#${ref.objectiveIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(ref);
    }
  }
  return refs;
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
   *  background into it (+X is map-left, +Z map-down) over an ocean fill. */
  region: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** The committed zone id (the painter localizes the on-canvas title + summary). */
  zoneId: string;
  pois: MapPoiMarker[];
  portals: MapPortalMarker[];
  npcs: MapNpcMarker[];
  questAreas: MapQuestAreaMarker[];
  player: MapPlayerMarker | null;
  allies: MapAllyMarker[];
  /** Party members other than self, live world position (issue 2652). Empty
   *  solo or with no party formed. */
  party: MapPartyMarker[];
  /** The zoomed-detail overlay, or null below MAP_DETAIL_ZOOM. */
  detail: MapDetail | null;
  /** Canvas-space "Show on Map" highlight, or null when absent / out of view. */
  ping: { mx: number; my: number } | null;
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
}

/** Which world-map surface this world renders. Delve when the player stands in a
 *  delve band and a run is active (matches the inline guard); overworld otherwise. */
export function mapWindowMode(world: IWorld): MapWindowMode {
  return isDelvePos(world.player.pos.x) && world.delveRun ? 'delve' : 'overworld';
}

/**
 * Build the overworld map draw model. Reads only IWorld members (player /
 * entities / socialInfo / questState / questLog) plus the committed zone and
 * shared world content (zone bounds, dungeon portals, camps, props,
 * decorations), so the offline Sim and the online ClientWorld mirror produce
 * identical output. Every
 * position is projected to canvas pixels here; the painter only resolves colors +
 * localized text and strokes.
 */
export function buildOverworldMapModel(input: OverworldMapInput): OverworldMapModel {
  const { world, props, zone, zoom, center, canvasSize: S, decorations } = input;
  const p = world.player;

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

  // +X is map-left (east = -X); +Z is map-down.
  const toMap = (x: number, z: number): { mx: number; my: number } => ({
    mx: ((region.maxX - x) / spanX) * S,
    my: ((region.maxZ - z) / spanZ) * S,
  });
  const inView = (x: number, z: number): boolean =>
    x >= region.minX - MARKER_VIEW_MARGIN &&
    x <= region.maxX + MARKER_VIEW_MARGIN &&
    z >= region.minZ - MARKER_VIEW_MARGIN &&
    z <= region.maxZ + MARKER_VIEW_MARGIN;
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

  // Quest-giver glyphs show at every zoom (actionable markers, unlike the
  // zoom-gated zone/POI text labels), culled to the visible map rect.
  const npcs: MapNpcMarker[] = [];
  for (const e of world.entities.values()) {
    if (e.kind !== 'npc') continue;
    if (!inZone(e.pos.x, e.pos.z) || !inView(e.pos.x, e.pos.z)) continue;
    const avail = e.questIds.filter(
      (q) => QUESTS[q].giverNpcId === e.templateId && world.questState(q) === 'available',
    );
    const readyQuests = e.questIds.filter(
      (q) => isQuestTurnInNpc(QUESTS[q], e.templateId) && world.questState(q) === 'ready',
    );
    if (avail.length > 0 || readyQuests.length > 0) {
      const { mx, my } = toMap(e.pos.x, e.pos.z);
      npcs.push({
        mx,
        my,
        ready: readyQuests.length > 0,
        // turn-ins first: the '?' state wins the glyph, so its quests lead the tooltip
        quests: [
          ...readyQuests.map((questId) => ({ questId, ready: true })),
          ...avail.map((questId) => ({ questId, ready: false })),
        ],
      });
    }
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
    npcs,
    questAreas,
    player,
    allies,
    party,
    detail,
    ping,
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
