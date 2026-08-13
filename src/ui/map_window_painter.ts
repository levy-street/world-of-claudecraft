// Canvas-2D painter for the world-map window (overworld branch).
//
// The imperative half of the pure-core + painter split: the pure geometry lives
// in map_window_view.ts (buildOverworldMapModel, unit-tested there); this module
// turns that flat draw model into actual canvas draws. It owns the 2D context, the
// cached current-zone decorations, and the localized text + color resolution. The
// delve branch of the map is owned by delve_map_painter.ts; Hud picks the
// branch with mapWindowMode and only routes the overworld branch here, so the two
// painters never duplicate each other's marker drawing.
//
// CADENCE (preserved from the inline site): the map redraws while open from
// hud.update()'s mediumHud band (>=250ms) behind the `display === 'block'` guard,
// blitting the cached terrain background (Hud-owned, prewarmed) each redraw. Hud
// also redraws it out of band on open, on zoom, on the Dungeon Finder's "Show on
// Map", and once per drag-pan pointermove, which is UNTHROTTLED (no rAF coalesce,
// no dirty check). Mobile pinch-zoom repaints just as often through its own
// pointermove listener on the same canvas, which routes via map_pinch_zoom's
// onZoom into zoomMap. So a drag or a pinch repaints at the pointer-event rate,
// and reading this painter as a cold ~4Hz on-open path holds only while nobody is
// touching the map. This painter does not change any of those call sites or the
// cadence; it only owns the draw.
//
// TEXT: every label draws as a cached offscreen sprite (text_sprite_cache), never
// through the canvas text API. Each canvas text entry point re-resolves font state
// against the document, so a per-item text loop costs in proportion to how dirty
// the style tree is; hoisting `ctx.font` above the loop does NOT fix that, and only
// leaving the text API does (the measured numbers and the mechanism live in the
// text_sprite_cache header and src/ui/CLAUDE.md). Quest markers now bypass text
// entirely through generated exact-size rasters. This painter's actual labels are
// localized, open-ended strings (dungeon and POI names, player names), which is why
// the cache it holds is measured, bounded and evicting.
//
// The seven per-redraw TextSpriteStyle literals below are deliberate: they close
// over the colors resolved for THIS redraw, so they cannot be module constants,
// and seven object literals plus one key string per label is far less work than
// the text API they replace. Do not trade them for a color-diffing memo.
//
// NO-MAGIC-VALUES: a 2D context cannot read CSS vars, so the
// painter resolves the `--color-map-*` tokens via getComputedStyle ONCE per redraw
// (cached for the frame, never per-marker); every other literal (font, radius,
// line width, label offset, triangle geometry) is a named constant.

import { getActiveWorldContent, type ZoneDef } from '../sim/data';
import type { GatherNodeType, RiftTier } from '../sim/types';
import { type Decoration, generateDecorationsInBounds } from '../sim/world';
import type { IWorld } from '../world_api';
import { dungeonDisplayName, riftFloorLabel, zoneDisplayName, zonePoiLabel } from './entity_i18n';
import { formatNumber } from './i18n';
import {
  EMPTY_MAP_MARKER_ART,
  gatherMarkerArtId,
  MAP_MARKER_SIZES,
  type MapMarkerArt,
  type MapMarkerArtId,
  mapMarkerSizeForSemantic,
  type QuestMarkerArtKind,
  questMarkerArtId,
  semanticMapMarkerArt,
  stationMarkerArtId,
} from './map_marker_icon_art';
import type { MapMarkerProfile } from './map_marker_profile_core';
import {
  buildOverworldMapModel,
  type MapAllyMarker,
  type MapDetail,
  type MapGatherNodeMarker,
  type MapNavigationMarker,
  type MapNpcMarker,
  type MapPartyMarker,
  type MapPlayerMarker,
  type MapPoiMarker,
  type MapPortalMarker,
  type MapQuestAreaMarker,
  type MapServiceMarker,
  type MapStationMarker,
  type MapViewRect,
  type OverworldMapModel,
} from './map_window_view';
import { TextSpriteCache, type TextSpriteStyle } from './text_sprite_cache';

// Label / title typography (Georgia, matching the inline site verbatim).
const TITLE_FONT = 'bold 16px Georgia';
const TITLE_BASELINE_Y = 20; // px from the canvas top
const LABEL_FONT = 'bold 13px Georgia';
const LABEL_LINE_WIDTH = 3; // outline width shared by title / labels / markers
const PORTAL_NAME_FONT = 'bold 12px Georgia';
// Generated quest masters are exact-size blits in the normal path. These
// dimensions describe only the allocation-free procedural first-frame/error
// fallback; it retains state semantics without invoking the canvas text API.
const QUEST_FALLBACK_OUTLINE_WIDTH = 4;
const QUEST_FALLBACK_INK_WIDTH = 1.75;
const QUEST_FALLBACK_HALF = 5;
const QUEST_FALLBACK_DOT_RADIUS = 1.35;
const NAVIGATION_FALLBACK_RADIUS_RATIO = 0.33;
const NAVIGATION_FALLBACK_CORE_RATIO = 0.38;
const NAVIGATION_FALLBACK_PIP_RATIO = 0.13;
const NAVIGATION_FALLBACK_PIP_GAP_RATIO = 0.08;
const STANDARD_MARKER_PROFILE = (): MapMarkerProfile => 'standard';
const ALLY_FONT = 'bold 11px Georgia';
// Building footprint outline width in the detail overlay.
const BUILDING_LINE_WIDTH = 1;
// Dungeon Finder "Show on Map" highlight: a steady double ring (no animation,
// reduced-motion safe) around the pinged entrance.
// Active-quest objective area (the translucent quest-POI blob) ring width.
const QUEST_AREA_LINE_WIDTH = 2;
// The numbered quest badge on each area (the WoW-style gold circle whose
// number matches the map's quest side list, in acceptance order).
const QUEST_BADGE_RADIUS = 9;
const QUEST_BADGE_FONT = 'bold 12px Georgia';
const QUEST_BADGE_GAP = 2; // px between badges when one area serves two quests
const QUEST_BADGE_LINE_WIDTH = 1.5;
const QUEST_BADGE_TEXT_LIFT = 4; // px above the arc center to optically center digits
// Zone-map gathering fallbacks mirror the loader's cached state grammar while
// an image is loading or unavailable. The normal painted path is one blit.
const GATHER_READY_RADIUS_RATIO = 0.275;
const GATHER_COOLDOWN_RADIUS_RATIO = 0.222;
const GATHER_LINE_WIDTH = 1.5;
const GATHER_FALLBACK_ARC_EDGE_INSET = 3;
const GATHER_FALLBACK_ARC_DARK_WIDTH = 3;
const GATHER_FALLBACK_ARC_LIGHT_WIDTH = 1.5;
const GATHER_FALLBACK_ARC_START = (Math.PI * 5) / 12;
const GATHER_FALLBACK_ARC_END = GATHER_FALLBACK_ARC_START + (Math.PI * 5) / 3;
const GATHER_FALLBACK_LOCK_WIDTH_RATIO = 0.34;
const GATHER_FALLBACK_LOCK_MIN_WIDTH = 6;
const GATHER_FALLBACK_LOCK_HEIGHT_RATIO = 0.58;
const GATHER_FALLBACK_LOCK_MIN_HEIGHT = 4;
const GATHER_FALLBACK_LOCK_EDGE_INSET = 2;
const GATHER_FALLBACK_LOCK_SHACKLE_RATIO = 0.28;
const GATHER_FALLBACK_LOCK_SHACKLE_DARK_WIDTH = 3;
const GATHER_FALLBACK_LOCK_SHACKLE_TOP_WIDTH = 1.4;
interface MapPaintGeometry {
  readonly markerOutlineWidth: number;
  readonly titleFont: string;
  readonly titleBaselineY: number;
  readonly labelFont: string;
  readonly textOutlineWidth: number;
  readonly portalNameFont: string;
  readonly allyFont: string;
  readonly questBadgeRadius: number;
  readonly questBadgeFont: string;
  readonly questBadgeGap: number;
  readonly questBadgeLineWidth: number;
  readonly questBadgeTextLift: number;
  readonly liveOutlineWidth: number;
  readonly allyDotRadius: number;
  readonly allyNameOffsetY: number;
  readonly playerArrowTipY: number;
  readonly playerArrowHalfWidth: number;
  readonly playerArrowBaseY: number;
  readonly portalDotRadius: number;
  readonly portalNameOffsetY: number;
  readonly pingRadiusInner: number;
  readonly pingRadiusOuter: number;
  readonly pingLineWidth: number;
  readonly gatherGlowExtra: number;
  readonly gatherFallbackScale: number;
}

/** Frozen responsive geometry selected once per redraw. The compact canvas is
 * subsequently CSS-scaled on touch HUDs, so its backing-space primitives need
 * more weight to retain the same physical clarity. */
const MAP_PAINT_GEOMETRY = Object.freeze({
  standard: Object.freeze({
    markerOutlineWidth: GATHER_LINE_WIDTH,
    titleFont: TITLE_FONT,
    titleBaselineY: TITLE_BASELINE_Y,
    labelFont: LABEL_FONT,
    textOutlineWidth: LABEL_LINE_WIDTH,
    portalNameFont: PORTAL_NAME_FONT,
    allyFont: ALLY_FONT,
    questBadgeRadius: QUEST_BADGE_RADIUS,
    questBadgeFont: QUEST_BADGE_FONT,
    questBadgeGap: QUEST_BADGE_GAP,
    questBadgeLineWidth: QUEST_BADGE_LINE_WIDTH,
    questBadgeTextLift: QUEST_BADGE_TEXT_LIFT,
    liveOutlineWidth: LABEL_LINE_WIDTH,
    allyDotRadius: 4,
    allyNameOffsetY: 8,
    playerArrowTipY: -7,
    playerArrowHalfWidth: 5,
    playerArrowBaseY: 6,
    portalDotRadius: 5,
    portalNameOffsetY: 12,
    pingRadiusInner: 12,
    pingRadiusOuter: 17,
    pingLineWidth: 3,
    gatherGlowExtra: 4,
    gatherFallbackScale: 1,
  }),
  compact: Object.freeze({
    markerOutlineWidth: 2,
    titleFont: 'bold 24px Georgia',
    titleBaselineY: 30,
    labelFont: 'bold 20px Georgia',
    textOutlineWidth: 4.5,
    portalNameFont: 'bold 18px Georgia',
    allyFont: 'bold 16px Georgia',
    questBadgeRadius: 13.5,
    questBadgeFont: 'bold 18px Georgia',
    questBadgeGap: 3,
    questBadgeLineWidth: 2.25,
    questBadgeTextLift: 6,
    liveOutlineWidth: 4,
    allyDotRadius: 6,
    allyNameOffsetY: 12,
    playerArrowTipY: -10.5,
    playerArrowHalfWidth: 7.5,
    playerArrowBaseY: 9,
    portalDotRadius: 7.5,
    portalNameOffsetY: 17,
    pingRadiusInner: 17,
    pingRadiusOuter: 23,
    pingLineWidth: 4,
    gatherGlowExtra: 6,
    gatherFallbackScale: 1.4,
  }),
} as const satisfies Readonly<Record<MapMarkerProfile, Readonly<MapPaintGeometry>>>);
// Herb clover: three petal offsets as fractions of radius (equilateral).
const HERB_PETAL_OFFSET = 0.55;
const HERB_PETAL_SCALE = 0.55;
// Wood pine: tip / base / trunk proportions of the ready radius. The trunk
// hangs from the crown base line on both sides (symmetric outline).
const WOOD_TIP_Y = -1;
const WOOD_BASE_Y = 0.55;
const WOOD_HALF_WIDTH = 0.85;
const WOOD_TRUNK_HALF = 0.22;
const WOOD_TRUNK_BOTTOM = 1.05;
// Ore hexagon: flat-top, radius is the vertex distance from center.
const ORE_HEX_SIDES = 6;

function pathQuestFallback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: QuestMarkerArtKind,
  scale: number,
): void {
  const half = QUEST_FALLBACK_HALF * scale;
  ctx.beginPath();
  switch (kind) {
    case 'available':
      ctx.moveTo(x, y - half);
      ctx.lineTo(x, y + scale);
      return;
    case 'ready':
      ctx.arc(x - scale * 0.35, y - scale * 1.5, scale * 3, Math.PI, Math.PI * 2.1);
      ctx.lineTo(x + scale * 0.35, y + scale);
      return;
    case 'repeat':
      ctx.moveTo(x, y - half * 0.55);
      ctx.lineTo(x, y + scale);
      ctx.moveTo(x + half, y + scale * 0.25);
      ctx.lineTo(x + half, y - half);
      ctx.lineTo(x - half * 0.55, y - half);
      ctx.moveTo(x - half * 0.55, y - half);
      ctx.lineTo(x + scale * 0.45, y - half - scale * 1.35);
      ctx.moveTo(x - half * 0.55, y - half);
      ctx.lineTo(x + scale * 0.45, y - half + scale * 1.35);
      return;
    case 'cooldown':
      ctx.moveTo(x - half, y - half);
      ctx.lineTo(x + half, y - half);
      ctx.lineTo(x - half, y + half);
      ctx.lineTo(x + half, y + half);
      return;
  }
}

/** State-distinct fallback at full caller alpha; never allocates or draws text. */
function drawQuestFallback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: QuestMarkerArtKind,
  ink: string,
  outline: string,
  scale: number,
): void {
  ctx.strokeStyle = outline;
  ctx.lineWidth = QUEST_FALLBACK_OUTLINE_WIDTH * scale;
  pathQuestFallback(ctx, x, y, kind, scale);
  ctx.stroke();
  ctx.strokeStyle = ink;
  ctx.lineWidth = QUEST_FALLBACK_INK_WIDTH * scale;
  pathQuestFallback(ctx, x, y, kind, scale);
  ctx.stroke();
  if (kind === 'cooldown') return;
  const dotY = y + QUEST_FALLBACK_HALF * scale;
  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.arc(x, dotY, QUEST_FALLBACK_DOT_RADIUS * scale * 1.75, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(x, dotY, QUEST_FALLBACK_DOT_RADIUS * scale, 0, Math.PI * 2);
  ctx.fill();
}

// The `--color-map-*` design tokens the painter resolves once per redraw. These
// mirror the colors the inline overworld-map render used verbatim. Exported so the
// suite pins EVERY entry against tokens.css (the minimap table's rationale; a missing
// declaration resolves '' and the mark draws in default ink).
export const MAP_COLOR_TOKENS = {
  ocean: '--color-map-ocean',
  label: '--color-map-label',
  outline: '--color-map-outline',
  portalDot: '--color-map-portal-dot',
  portalLabel: '--color-map-portal-label',
  ping: '--color-map-ping',
  npcQuest: '--color-map-npc-quest',
  npcQuestRepeat: '--color-map-npc-quest-repeat',
  questAreaFill: '--color-map-quest-area-fill',
  questAreaStroke: '--color-map-quest-area-stroke',
  questBadgeFill: '--color-map-quest-badge-fill',
  questBadgeText: '--color-map-quest-badge-text',
  player: '--color-map-player',
  allyFriend: '--color-map-ally-friend',
  allyGuild: '--color-map-ally-guild',
  partyDead: '--color-map-party-dead',
  rock: '--color-map-rock',
  tree: '--color-map-tree',
  oak: '--color-map-oak',
  buildingOutline: '--color-map-building-outline',
  buildingArmoury: '--color-map-building-armoury',
  buildingChapel: '--color-map-building-chapel',
  buildingInn: '--color-map-building-inn',
  buildingHouse: '--color-map-building-house',
  well: '--color-map-well',
  stall: '--color-map-stall',
  tent: '--color-map-tent',
  mine: '--color-map-mine',
  graveyard: '--color-map-graveyard',
  mudhut: '--color-map-mudhut',
  campfire: '--color-map-campfire',
  gatherOreReady: '--color-map-gather-ore-ready',
  gatherOreCooldown: '--color-map-gather-ore-cooldown',
  gatherOreGlow: '--color-map-gather-ore-glow',
  gatherWoodReady: '--color-map-gather-wood-ready',
  gatherWoodCooldown: '--color-map-gather-wood-cooldown',
  gatherWoodGlow: '--color-map-gather-wood-glow',
  gatherHerbReady: '--color-map-gather-herb-ready',
  gatherHerbCooldown: '--color-map-gather-herb-cooldown',
  gatherHerbGlow: '--color-map-gather-herb-glow',
  gatherLocked: '--color-map-gather-locked',
} as const;

type MapColors = Record<keyof typeof MAP_COLOR_TOKENS, string>;

function navigationRankCount(rank: RiftTier | null): number {
  switch (rank) {
    case 'C':
      return 1;
    case 'B':
      return 2;
    case 'A':
      return 3;
    case 'S':
      return 4;
    default:
      return 0;
  }
}

/** First-frame/error fallback for generated navigation art. Each route keeps a
 * distinct silhouette and Rift rank keeps a non-color pip count. */
function drawMapNavigationFallback(
  ctx: CanvasRenderingContext2D,
  marker: MapNavigationMarker,
  size: number,
  colors: MapColors,
  geometry: Readonly<MapPaintGeometry>,
): void {
  const radius = size * NAVIGATION_FALLBACK_RADIUS_RATIO;
  const core = radius * NAVIGATION_FALLBACK_CORE_RATIO;
  ctx.fillStyle = colors.portalDot;
  ctx.strokeStyle = colors.outline;
  ctx.lineWidth = geometry.markerOutlineWidth;
  if (marker.kind === 'delve-entrance') {
    ctx.beginPath();
    ctx.arc(marker.mx, marker.my, radius, Math.PI, Math.PI * 2);
    ctx.lineTo(marker.mx + radius, marker.my + radius);
    ctx.lineTo(marker.mx - radius, marker.my + radius);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = colors.outline;
    ctx.fillRect(marker.mx - core, marker.my, core * 2, radius);
    return;
  }
  if (marker.kind === 'world-passage') {
    ctx.beginPath();
    ctx.moveTo(marker.mx - radius, marker.my - radius);
    ctx.lineTo(marker.mx, marker.my);
    ctx.lineTo(marker.mx - radius, marker.my + radius);
    ctx.closePath();
    ctx.moveTo(marker.mx + radius, marker.my - radius);
    ctx.lineTo(marker.mx, marker.my);
    ctx.lineTo(marker.mx + radius, marker.my + radius);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.arc(marker.mx, marker.my, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colors.outline;
  ctx.beginPath();
  ctx.arc(marker.mx, marker.my, core, 0, Math.PI * 2);
  ctx.fill();
  const count = navigationRankCount(marker.rank);
  if (count === 0) return;
  const pip = Math.max(1, size * NAVIGATION_FALLBACK_PIP_RATIO);
  const gap = size * NAVIGATION_FALLBACK_PIP_GAP_RATIO;
  const width = count * pip + (count - 1) * gap;
  let x = marker.mx - width / 2;
  ctx.fillStyle = colors.player;
  for (let i = 0; i < count; i++) {
    ctx.fillRect(x, marker.my + radius * 0.58, pip, pip);
    x += pip + gap;
  }
}

/** The current zone's cached map background plus the world rect it covers. */
export interface MapZoneBg {
  canvas: HTMLCanvasElement;
  region: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** Inputs for one overworld redraw. The cached terrain bg + the committed zone
 *  are Hud-owned (Hud keys the bg cache by zone); the painter owns the
 *  decorations. Only the committed zone background can reach the painter. */
export interface MapPaintOptions {
  zone: ZoneDef;
  zoneBg: MapZoneBg;
  /** The square map-canvas side in px. */
  canvasSize: number;
  zoom: number;
  center: { x: number; z: number } | null;
  /** Dungeon Finder "Show on Map" highlight in world coords, or null. */
  ping?: { x: number; z: number } | null;
}

/** What the painter reports back so Hud can update its drag state + cursor,
 *  plus the painted quest areas for the hover tooltip's hit-test. */
export interface MapPaintResult {
  view: MapViewRect;
  cursor: 'grab' | 'default';
  questAreas: MapQuestAreaMarker[];
  /** The quest-giver markers of this paint, for the hover tooltip's hit-test. */
  npcs: MapNpcMarker[];
  /** The gather-node icons of this paint, for the hover tooltip's hit-test. */
  gatherNodes: MapGatherNodeMarker[];
  /** The crafting-station badges of this paint, for hover/tap hit-testing. */
  stations: MapStationMarker[];
  /** The civic-service badges of this paint, for hover/tap hit-testing. */
  services: MapServiceMarker[];
  /** Stable route badges and host-fair nearby Rift entrances for hit-testing. */
  navigation: MapNavigationMarker[];
  /** Direct references to the already-painted live/landmark model for a11y output. */
  player: MapPlayerMarker | null;
  allies: MapAllyMarker[];
  party: MapPartyMarker[];
  portals: MapPortalMarker[];
  pois: MapPoiMarker[];
}

/**
 * Owns painting the overworld map onto the map-window canvas. One instance is
 * built by Hud; it caches decorations per zone and reuses them across redraws.
 */
export class MapWindowPainter {
  private decorationsByZone = new Map<string, Decoration[]>();
  // Every on-canvas label, rasterized once per (font, fill, outline, text) and
  // blitted thereafter. Held on the instance (Hud builds one painter and keeps
  // it) so the sprites survive across redraws; it trims itself back to its
  // budget at each redraw boundary.
  private readonly labels = new TextSpriteCache();

  /** classColor resolves a party member's class to its display color (issue
   *  2652), the same resolver Hud already threads into MinimapPainter /
   *  DelveMapPainter. */
  constructor(
    private readonly classColor: (cls: string) => string,
    private readonly markerArt: MapMarkerArt = EMPTY_MAP_MARKER_ART,
    private readonly markerProfile: () => MapMarkerProfile = STANDARD_MARKER_PROFILE,
  ) {}

  /** Drop the cached label sprites on a language switch: every label re-resolves
   *  to a new string, so the old rasters can never be reused and would only sit
   *  in the budget until eviction worked them out. Hud calls this from its
   *  woc:languagechange handler, like the other in-place relocalizers. */
  relocalize(): void {
    this.labels.clear();
  }

  /** Read the map color tokens in one getComputedStyle pass (a 2D
   *  context can only read a CSS var this way; never per-marker). */
  private resolveColors(): MapColors {
    const cs = getComputedStyle(document.documentElement);
    const read = (token: string): string => cs.getPropertyValue(token).trim();
    const colors = {} as MapColors;
    for (const key of Object.keys(MAP_COLOR_TOKENS) as (keyof typeof MAP_COLOR_TOKENS)[]) {
      colors[key] = read(MAP_COLOR_TOKENS[key]);
    }
    return colors;
  }

  /** Paint the overworld map for one redraw and report the view rect + cursor. */
  paintOverworld(
    ctx: CanvasRenderingContext2D,
    world: IWorld,
    opts: MapPaintOptions,
  ): MapPaintResult {
    let decorations = this.decorationsByZone.get(opts.zone.id);
    if (!decorations) {
      decorations = generateDecorationsInBounds(world.cfg.seed, opts.zoneBg.region);
      this.decorationsByZone.set(opts.zone.id, decorations);
    }
    const activeWorld = getActiveWorldContent();
    // Resolve responsive state once. Both pure placement and painted geometry
    // consume the same profile for this complete redraw.
    const profile = this.markerProfile();
    const model = buildOverworldMapModel({
      world,
      props: activeWorld.props,
      zone: opts.zone,
      zoom: opts.zoom,
      center: opts.center,
      canvasSize: opts.canvasSize,
      decorations,
      ping: opts.ping ?? null,
      markerProfile: profile,
    });
    const colors = this.resolveColors();
    this.draw(ctx, model, opts.zoneBg, opts.canvasSize, colors, profile);
    return {
      view: model.view,
      cursor: model.cursor,
      questAreas: model.questAreas,
      npcs: model.npcs,
      gatherNodes: model.gatherNodes,
      stations: model.stations,
      services: model.services,
      navigation: model.navigation,
      player: model.player,
      allies: model.allies,
      party: model.party,
      portals: model.portals,
      pois: model.pois,
    };
  }

  private draw(
    ctx: CanvasRenderingContext2D,
    model: OverworldMapModel,
    zoneBg: MapZoneBg,
    S: number,
    colors: MapColors,
    profile: MapMarkerProfile,
  ): void {
    // Reclaim any label sprites the last redraws left over the budget, before
    // this redraw asks for its own (never mid-redraw: see text_sprite_cache).
    this.labels.beginRedraw();
    const geometry = MAP_PAINT_GEOMETRY[profile];

    // Open ocean under everything, then composite only the current zone's cached
    // terrain at its world position (+X is map-left, +Z map-up; R61: maxZ
    // lands at the bitmap top, see the destY math below).
    // Smoothing stays ON for the scaled terrain blit, which is exactly why every
    // label blit below rounds its destination.
    const r = model.region;
    const spanX = r.maxX - r.minX;
    const spanZ = r.maxZ - r.minZ;
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = colors.ocean;
    ctx.fillRect(0, 0, S, S);
    {
      const b = zoneBg.region;
      const destX = ((r.maxX - b.maxX) / spanX) * S;
      const destY = ((r.maxZ - b.maxZ) / spanZ) * S;
      const destW = ((b.maxX - b.minX) / spanX) * S;
      const destH = ((b.maxZ - b.minZ) / spanZ) * S;
      ctx.drawImage(zoneBg.canvas, destX, destY, destW, destH);
    }

    if (model.detail) this.drawDetail(ctx, model.detail, colors);

    // Active-quest objective areas: translucent blue blobs (classic quest-POI
    // style) over where each objective's targets live, drawn under the title /
    // POI / quest-marker layers so their text and symbols stay readable on top.
    if (model.questAreas.length > 0) {
      ctx.fillStyle = colors.questAreaFill;
      ctx.strokeStyle = colors.questAreaStroke;
      ctx.lineWidth = QUEST_AREA_LINE_WIDTH;
      for (const area of model.questAreas) {
        ctx.beginPath();
        ctx.arc(area.mx, area.my, area.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      // Numbered badges: one gold circle per quest served by the area, its
      // number matching the quest side list (acceptance order). Centered on
      // the blob, laid out side by side when one camp serves several quests.
      ctx.lineWidth = geometry.questBadgeLineWidth;
      ctx.strokeStyle = colors.outline;
      ctx.fillStyle = colors.questBadgeFill;
      // The one label on the map with no outline: it sits on its own gold disc.
      const badgeNumber: TextSpriteStyle = {
        font: geometry.questBadgeFont,
        fill: colors.questBadgeText,
      };
      for (const area of model.questAreas) {
        const n = area.numbers.length;
        for (let i = 0; i < n; i++) {
          const bx =
            area.mx + (i - (n - 1) / 2) * (geometry.questBadgeRadius * 2 + geometry.questBadgeGap);
          ctx.beginPath();
          ctx.arc(bx, area.my, geometry.questBadgeRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          this.labels.draw(
            ctx,
            formatNumber(area.numbers[i], { maximumFractionDigits: 0 }),
            bx,
            area.my + geometry.questBadgeTextLift,
            badgeNumber,
          );
        }
      }
    }

    // Gather nodes: profession-colored type silhouettes over the quest-area
    // blobs (a resource field still reads inside a blue objective region) but
    // under the zone title, POI labels, portals, and quest markers, so label
    // text and quest / dungeon chrome stay readable on top.
    // Tier-identical (fairness): never preset- or governor-gated.
    if (model.gatherNodes.length > 0) {
      this.drawGatherNodes(ctx, model.gatherNodes, colors, profile, geometry);
    }

    // Stable civic services share the same painted micro-icon family as the
    // minimap. The pure model has already displaced badges away from quest
    // masters and every other landmark; quest art still draws later and wins
    // any unforeseen custom-content collision. Tier-identical and allocation-free.
    for (const service of model.services) {
      const sizeId = profile === 'compact' ? 'mapServiceCompact' : 'mapService';
      const size = MAP_MARKER_SIZES[sizeId];
      const sprite = this.markerArt.sprite(`service-${service.kind}`, sizeId);
      if (sprite) {
        ctx.drawImage(sprite, Math.round(service.mx - size / 2), Math.round(service.my - size / 2));
      } else if (service.kind === 'mailbox') {
        const radius = size / 3;
        ctx.fillStyle = colors.stall;
        ctx.strokeStyle = colors.outline;
        ctx.lineWidth = geometry.markerOutlineWidth;
        ctx.beginPath();
        ctx.moveTo(service.mx, service.my - radius);
        ctx.lineTo(service.mx + radius, service.my);
        ctx.lineTo(service.mx, service.my + radius);
        ctx.lineTo(service.mx - radius, service.my);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        const halfWidth = size * 0.375;
        const halfHeight = size * 0.22;
        ctx.fillStyle = colors.stall;
        ctx.strokeStyle = colors.outline;
        ctx.lineWidth = geometry.markerOutlineWidth;
        ctx.beginPath();
        ctx.moveTo(service.mx - halfWidth, service.my - halfHeight);
        ctx.lineTo(service.mx + halfWidth, service.my - halfHeight);
        ctx.lineTo(service.mx + halfWidth, service.my + halfHeight);
        ctx.lineTo(service.mx - halfWidth, service.my + halfHeight);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // Stable crafting identities use the same collision-safe landmark layer.
    for (const station of model.stations) {
      const sizeId = profile === 'compact' ? 'mapStationCompact' : 'mapStation';
      const size = MAP_MARKER_SIZES[sizeId];
      const sprite = this.markerArt.sprite(stationMarkerArtId(station.type), sizeId);
      if (sprite) {
        ctx.drawImage(sprite, Math.round(station.mx - size / 2), Math.round(station.my - size / 2));
      } else {
        const radius = size / 3;
        ctx.fillStyle = colors.stall;
        ctx.strokeStyle = colors.outline;
        ctx.lineWidth = geometry.markerOutlineWidth;
        ctx.beginPath();
        ctx.moveTo(station.mx, station.my - radius);
        ctx.lineTo(station.mx + radius, station.my);
        ctx.lineTo(station.mx, station.my + radius);
        ctx.lineTo(station.mx - radius, station.my);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // Zone title (drawn on-canvas; the world map has no DOM zone label). Inside
    // a rift, show the generated floor name + rank instead of the overworld
    // zone, mirroring minimap_painter's zone-label override.
    const title = model.rift
      ? riftFloorLabel(model.rift.name, model.rift.rank)
      : zoneDisplayName(model.zoneId);
    this.labels.draw(ctx, title, S / 2, geometry.titleBaselineY, {
      font: geometry.titleFont,
      fill: colors.label,
      stroke: colors.outline,
      lineWidth: geometry.textOutlineWidth,
    });

    // POI labels (the title's outline + label color, one size down).
    const poiLabel: TextSpriteStyle = {
      font: geometry.labelFont,
      fill: colors.label,
      stroke: colors.outline,
      lineWidth: geometry.textOutlineWidth,
    };
    for (const poi of model.pois) {
      this.labels.draw(ctx, zonePoiLabel(poi.zoneId, poi.poiIndex), poi.mx, poi.my, poiLabel);
    }

    // Dungeon entrance portals: a purple dot plus the dungeon name above it. The
    // dot's own outline is the label outline at the label width, which the title
    // block used to leave behind on ctx; it is named here instead.
    ctx.fillStyle = colors.portalDot;
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = geometry.textOutlineWidth;
    const portalName: TextSpriteStyle = {
      font: geometry.portalNameFont,
      fill: colors.portalLabel,
      stroke: colors.outline,
      lineWidth: geometry.textOutlineWidth,
    };
    for (const portal of model.portals) {
      const sizeId = profile === 'compact' ? 'mapDungeonCompact' : 'mapDungeon';
      const size = MAP_MARKER_SIZES[sizeId];
      const sprite = this.markerArt.sprite('dungeon-entrance', sizeId);
      if (sprite) {
        ctx.drawImage(sprite, Math.round(portal.mx - size / 2), Math.round(portal.my - size / 2));
      } else {
        ctx.beginPath();
        ctx.arc(portal.mx, portal.my, geometry.portalDotRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      this.labels.draw(
        ctx,
        dungeonDisplayName(portal.dungeonId),
        portal.mx,
        portal.my - geometry.portalNameOffsetY,
        portalName,
      );
    }

    // Stable route sites and nearby live Rift entrances use icon-only badges.
    // Long labels would collide with POIs at the full-zone scale; hover/tap owns
    // the localized name while this high-salience layer stays immediately legible.
    for (const marker of model.navigation) {
      const artId: MapMarkerArtId =
        marker.kind === 'delve-entrance'
          ? 'delve-entrance'
          : marker.kind === 'world-passage'
            ? 'world-passage'
            : 'rift-entrance';
      let sizeId: keyof typeof MAP_MARKER_SIZES =
        profile === 'compact' ? 'mapNavigationCompact' : 'mapNavigation';
      if (marker.kind === 'rift-entrance') {
        const art = semanticMapMarkerArt({ kind: 'rift-entrance', rank: marker.rank });
        if (art) sizeId = mapMarkerSizeForSemantic('map', profile === 'compact', art);
      }
      const size = MAP_MARKER_SIZES[sizeId];
      const sprite = this.markerArt.sprite(artId, sizeId);
      if (sprite) {
        ctx.drawImage(sprite, Math.round(marker.mx - size / 2), Math.round(marker.my - size / 2));
      } else {
        drawMapNavigationFallback(ctx, marker, size, colors, geometry);
      }
    }

    // Dungeon Finder "Show on Map" highlight: a steady double ring around the
    // pinged entrance (drawn over the portal dot; no animation by design).
    if (model.ping) {
      ctx.strokeStyle = colors.ping;
      ctx.lineWidth = geometry.pingLineWidth;
      ctx.beginPath();
      ctx.arc(model.ping.mx, model.ping.my, geometry.pingRadiusInner, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(model.ping.mx, model.ping.my, geometry.pingRadiusOuter, 0, Math.PI * 2);
      ctx.stroke();
      // Restore BOTH stroke settings, not just the width. Leaving the ping color
      // behind tinted every later outline on this canvas (the player arrow, and
      // the quest-giver marks before they became sprites) for as long as a
      // "Show on Map" ping was live.
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = geometry.textOutlineWidth;
    }

    // Quest-giver art is one exact-size blit per marker. Available, ready,
    // repeat, and cooldown each own both a punctuation/state cue and a distinct
    // silhouette; cooldown stays at full caller alpha so "not ready yet" never
    // disappears into terrain. The profile is resolved once for this redraw,
    // outside the marker loop, and compact art survives the HUD's CSS scale.
    for (const npc of model.npcs) {
      const cooldown = npc.kind === 'cooldown';
      const sizeId = cooldown
        ? profile === 'compact'
          ? 'mapQuestCooldownCompact'
          : 'mapQuestCooldown'
        : profile === 'compact'
          ? 'mapQuestCompact'
          : 'mapQuest';
      const size = MAP_MARKER_SIZES[sizeId];
      const sprite = this.markerArt.sprite(questMarkerArtId(npc.kind), sizeId);
      if (sprite) {
        ctx.drawImage(sprite, Math.round(npc.mx - size / 2), Math.round(npc.my - size / 2));
      } else {
        const ink = cooldown
          ? colors.gatherOreCooldown
          : npc.kind === 'repeat'
            ? colors.npcQuestRepeat
            : colors.npcQuest;
        drawQuestFallback(
          ctx,
          npc.mx,
          npc.my,
          npc.kind,
          ink,
          colors.outline,
          size / MAP_MARKER_SIZES.mapQuest,
        );
      }
    }

    // Local player facing arrow.
    if (model.player) {
      ctx.save();
      ctx.translate(model.player.mx, model.player.my);
      ctx.rotate(model.player.angle); // matches the flipped map (see toMap)
      ctx.fillStyle = colors.player;
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = geometry.liveOutlineWidth;
      ctx.beginPath();
      ctx.moveTo(0, geometry.playerArrowTipY);
      ctx.lineTo(geometry.playerArrowHalfWidth, geometry.playerArrowBaseY);
      ctx.lineTo(-geometry.playerArrowHalfWidth, geometry.playerArrowBaseY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Online allies: friends green, guild members blue (model dedups + orders).
    if (model.allies.length > 0) {
      ctx.lineWidth = geometry.liveOutlineWidth;
      ctx.strokeStyle = colors.outline;
      // Two name styles, one per ally color; the dot keeps the same color.
      const friendName: TextSpriteStyle = {
        font: geometry.allyFont,
        fill: colors.allyFriend,
        stroke: colors.outline,
        lineWidth: geometry.liveOutlineWidth,
      };
      const guildName: TextSpriteStyle = { ...friendName, fill: colors.allyGuild };
      for (const ally of model.allies) {
        const friend = ally.kind === 'friend';
        ctx.fillStyle = friend ? colors.allyFriend : colors.allyGuild;
        ctx.beginPath();
        ctx.arc(ally.mx, ally.my, geometry.allyDotRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        this.labels.draw(
          ctx,
          ally.name,
          ally.mx,
          ally.my - geometry.allyNameOffsetY,
          friend ? friendName : guildName,
        );
      }
    }

    // Party members (issue 2652): the same dot + name-label family as the
    // online allies above, class-colored (or the dead token for a fallen
    // member) instead of friend/guild, so they read as visually distinct from
    // both the ally dots and the white player arrow.
    if (model.party.length > 0) {
      ctx.lineWidth = geometry.liveOutlineWidth;
      ctx.strokeStyle = colors.outline;
      const partyName: TextSpriteStyle = {
        font: geometry.allyFont,
        fill: colors.partyDead,
        stroke: colors.outline,
        lineWidth: geometry.liveOutlineWidth,
      };
      for (const member of model.party) {
        const color = member.dead ? colors.partyDead : this.classColor(member.cls);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(member.mx, member.my, geometry.allyDotRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        partyName.fill = color;
        this.labels.draw(
          ctx,
          member.name,
          member.mx,
          member.my - geometry.allyNameOffsetY,
          partyName,
        );
      }
    }
  }

  /** Profession-colored ready icons and neutral-gray exhausted icons. Four
   *  cached variants preserve availability and tool lock independently. */
  private drawGatherNodes(
    ctx: CanvasRenderingContext2D,
    nodes: readonly MapGatherNodeMarker[],
    colors: MapColors,
    profile: MapMarkerProfile,
    geometry: Readonly<MapPaintGeometry>,
  ): void {
    ctx.lineWidth = geometry.markerOutlineWidth;
    ctx.strokeStyle = colors.outline;
    for (const node of nodes) {
      const sizeId = node.ready
        ? node.locked
          ? profile === 'compact'
            ? 'mapGatherReadyLockedCompact'
            : 'mapGatherReadyLocked'
          : profile === 'compact'
            ? 'mapGatherReadyCompact'
            : 'mapGatherReady'
        : node.locked
          ? profile === 'compact'
            ? 'mapGatherCooldownLockedCompact'
            : 'mapGatherCooldownLocked'
          : profile === 'compact'
            ? 'mapGatherCooldownCompact'
            : 'mapGatherCooldown';
      const sprite = this.markerArt.sprite(gatherMarkerArtId(node.type), sizeId);
      const size = MAP_MARKER_SIZES[sizeId];
      if (sprite) {
        ctx.drawImage(sprite, Math.round(node.mx - size / 2), Math.round(node.my - size / 2));
      } else {
        const radius =
          size * (node.ready ? GATHER_READY_RADIUS_RATIO : GATHER_COOLDOWN_RADIUS_RATIO);
        if (node.ready && !node.locked) {
          ctx.fillStyle = gatherGlowColor(colors, node.type);
          ctx.beginPath();
          ctx.arc(node.mx, node.my, radius + geometry.gatherGlowExtra, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = node.ready
          ? gatherReadyColor(colors, node.type)
          : gatherCooldownColor(colors, node.type);
        pathGatherSilhouette(ctx, node.mx, node.my, radius, node.type);
        ctx.fill();
        ctx.stroke();
        if (!node.ready) {
          drawGatherCooldownFallbackArc(
            ctx,
            node.mx,
            node.my,
            size,
            gatherCooldownColor(colors, node.type),
            colors.outline,
            geometry.gatherFallbackScale,
          );
        }
        if (node.locked) {
          drawGatherLockFallback(
            ctx,
            node.mx,
            node.my,
            size,
            colors.gatherLocked,
            gatherReadyColor(colors, node.type),
            colors.outline,
            geometry.gatherFallbackScale,
          );
        }
      }
    }
  }

  // Buildings + vegetation overlay for the zoomed-in map, drawn in the same order
  // as the inline site (vegetation, then building footprints, then prop dots).
  private drawDetail(ctx: CanvasRenderingContext2D, detail: MapDetail, colors: MapColors): void {
    for (const d of detail.decorations) {
      ctx.fillStyle =
        d.kind === 'rock' ? colors.rock : d.kind === 'tree' ? colors.tree : colors.oak;
      ctx.beginPath();
      ctx.arc(d.mx, d.my, d.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.lineWidth = BUILDING_LINE_WIDTH;
    ctx.strokeStyle = colors.buildingOutline;
    for (const b of detail.buildings) {
      ctx.fillStyle =
        b.kind === 'armoury'
          ? colors.buildingArmoury
          : b.kind === 'chapel'
            ? colors.buildingChapel
            : b.kind === 'inn'
              ? colors.buildingInn
              : colors.buildingHouse;
      ctx.beginPath();
      ctx.moveTo(b.points[0].mx, b.points[0].my);
      for (let i = 1; i < b.points.length; i++) ctx.lineTo(b.points[i].mx, b.points[i].my);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    for (const prop of detail.props) {
      ctx.fillStyle = colors[prop.kind];
      ctx.beginPath();
      ctx.arc(prop.mx, prop.my, prop.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function gatherReadyColor(colors: MapColors, type: GatherNodeType): string {
  if (type === 'ore') return colors.gatherOreReady;
  if (type === 'wood') return colors.gatherWoodReady;
  return colors.gatherHerbReady;
}

function gatherCooldownColor(colors: MapColors, type: GatherNodeType): string {
  if (type === 'ore') return colors.gatherOreCooldown;
  if (type === 'wood') return colors.gatherWoodCooldown;
  return colors.gatherHerbCooldown;
}

function gatherGlowColor(colors: MapColors, type: GatherNodeType): string {
  if (type === 'ore') return colors.gatherOreGlow;
  if (type === 'wood') return colors.gatherWoodGlow;
  return colors.gatherHerbGlow;
}

function drawGatherCooldownFallbackArc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  neutral: string,
  outline: string,
  scale: number,
): void {
  const radius = size / 2 - GATHER_FALLBACK_ARC_EDGE_INSET * scale;
  const previousLineCap = ctx.lineCap;
  ctx.lineCap = 'round';
  ctx.strokeStyle = outline;
  ctx.lineWidth = GATHER_FALLBACK_ARC_DARK_WIDTH * scale;
  ctx.beginPath();
  ctx.arc(x, y, radius, GATHER_FALLBACK_ARC_START, GATHER_FALLBACK_ARC_END);
  ctx.stroke();
  ctx.strokeStyle = neutral;
  ctx.lineWidth = GATHER_FALLBACK_ARC_LIGHT_WIDTH * scale;
  ctx.beginPath();
  ctx.arc(x, y, radius, GATHER_FALLBACK_ARC_START, GATHER_FALLBACK_ARC_END);
  ctx.stroke();
  ctx.lineCap = previousLineCap;
}

function drawGatherLockFallback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  bronze: string,
  highlight: string,
  outline: string,
  scale: number,
): void {
  const width = Math.max(
    GATHER_FALLBACK_LOCK_MIN_WIDTH * scale,
    Math.round(size * GATHER_FALLBACK_LOCK_WIDTH_RATIO),
  );
  const bodyHeight = Math.max(
    GATHER_FALLBACK_LOCK_MIN_HEIGHT * scale,
    Math.round(width * GATHER_FALLBACK_LOCK_HEIGHT_RATIO),
  );
  const left = x + size / 2 - width - GATHER_FALLBACK_LOCK_EDGE_INSET * scale;
  const top = y + size / 2 - bodyHeight - GATHER_FALLBACK_LOCK_EDGE_INSET * scale;
  const shackleX = left + width / 2;
  const shackleRadius = width * GATHER_FALLBACK_LOCK_SHACKLE_RATIO;
  const border = Math.ceil(scale);

  const previousLineCap = ctx.lineCap;
  ctx.lineCap = 'round';
  ctx.strokeStyle = outline;
  ctx.lineWidth = GATHER_FALLBACK_LOCK_SHACKLE_DARK_WIDTH * scale;
  ctx.beginPath();
  ctx.arc(shackleX, top + 0.5 * scale, shackleRadius, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = bronze;
  ctx.lineWidth = GATHER_FALLBACK_LOCK_SHACKLE_TOP_WIDTH * scale;
  ctx.beginPath();
  ctx.arc(shackleX, top + 0.5 * scale, shackleRadius, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = outline;
  ctx.fillRect(left - border, top - border, width + border * 2, bodyHeight + border * 2);
  ctx.fillStyle = bronze;
  ctx.fillRect(left, top, width, bodyHeight);
  ctx.fillStyle = highlight;
  ctx.fillRect(left + border, top + border, Math.max(1, width - border * 2), border);
  ctx.fillStyle = outline;
  ctx.fillRect(
    Math.round(shackleX) - border,
    top + border * 2,
    border * 2,
    Math.max(1, bodyHeight - border * 2),
  );
  ctx.lineCap = previousLineCap;
}

/** Type-distinct silhouette path (fill + optional stroke by the caller).
 *  Ore = flat-top hexagon (mineral facet), wood = pine + trunk, herb = three
 *  petal clover. All closed paths centred on (mx, my). */
function pathGatherSilhouette(
  ctx: CanvasRenderingContext2D,
  mx: number,
  my: number,
  radius: number,
  type: GatherNodeType,
): void {
  ctx.beginPath();
  if (type === 'ore') {
    // Flat-top hex: start at the right vertex, step 60 degrees.
    for (let i = 0; i < ORE_HEX_SIDES; i++) {
      const a = (Math.PI / 3) * i;
      const x = mx + radius * Math.cos(a);
      const y = my + radius * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    return;
  }
  if (type === 'wood') {
    // Pine crown triangle + short trunk (reads as a tree at 5px radius).
    // One closed path (no ctx.rect): the fake 2D context in the painter suite
    // only stubs path primitives the rest of the map uses.
    const trunkHalf = radius * WOOD_TRUNK_HALF;
    const crownBase = my + radius * WOOD_BASE_Y;
    const trunkBottom = my + radius * WOOD_TRUNK_BOTTOM;
    ctx.moveTo(mx, my + radius * WOOD_TIP_Y);
    ctx.lineTo(mx + radius * WOOD_HALF_WIDTH, crownBase);
    ctx.lineTo(mx + trunkHalf, crownBase);
    ctx.lineTo(mx + trunkHalf, trunkBottom);
    ctx.lineTo(mx - trunkHalf, trunkBottom);
    ctx.lineTo(mx - trunkHalf, crownBase);
    ctx.lineTo(mx - radius * WOOD_HALF_WIDTH, crownBase);
    ctx.closePath();
    return;
  }
  // Herb: three petals around the center (clover), classic herbalism mark.
  const petalR = radius * HERB_PETAL_SCALE;
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
    const cx = mx + radius * HERB_PETAL_OFFSET * Math.cos(a);
    const cy = my + radius * HERB_PETAL_OFFSET * Math.sin(a);
    ctx.moveTo(cx + petalR, cy);
    ctx.arc(cx, cy, petalR, 0, Math.PI * 2);
  }
}
