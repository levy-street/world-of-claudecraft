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
// text_sprite_cache header and src/ui/CLAUDE.md). minimap_painter does the same for
// its three fixed NPC glyphs. This painter's labels are localized, open-ended
// strings (dungeon and POI names, player names), which is why the cache it holds is
// measured, bounded and evicting rather than a fixed per-glyph table.
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
import type { GatherNodeType } from '../sim/types';
import { type Decoration, generateDecorationsInBounds } from '../sim/world';
import type { IWorld } from '../world_api';
import { dungeonDisplayName, riftFloorLabel, zoneDisplayName, zonePoiLabel } from './entity_i18n';
import { formatNumber } from './i18n';
import {
  buildOverworldMapModel,
  type MapDetail,
  type MapGatherNodeMarker,
  type MapNpcMarker,
  type MapQuestAreaMarker,
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
const PORTAL_DOT_RADIUS = 5;
const PORTAL_NAME_OFFSET_Y = 9; // name drawn this many px above the dot
const NPC_GLYPH_FONT = 'bold 15px Georgia';
const NPC_GLYPH_READY = '?'; // a turn-in is ready
const NPC_GLYPH_AVAILABLE = '!'; // a quest is available (gold, blue, or dimmed by kind)
// The cooldown variant's dim: the repeat-blue '!' drawn at this globalAlpha (a
// work order inside its cadence window, marked where the NPC previously showed
// nothing). Applied around the sprite blit, so the label cache keeps one
// raster per (glyph, style); matches the minimap's NPC_GLYPH_COOLDOWN_ALPHA
// and .np-marker.cooldown's opacity so all three surfaces dim identically.
const NPC_GLYPH_COOLDOWN_ALPHA = 0.55;
const ALLY_FONT = 'bold 11px Georgia';
const ALLY_DOT_RADIUS = 4;
const ALLY_NAME_OFFSET_Y = 8; // name drawn this many px above the dot
// The player facing-arrow triangle (canvas-local, drawn under a -facing rotation).
const PLAYER_ARROW_TIP_Y = -7;
const PLAYER_ARROW_HALF_WIDTH = 5;
const PLAYER_ARROW_BASE_Y = 6;
// Building footprint outline width in the detail overlay.
const BUILDING_LINE_WIDTH = 1;
// Dungeon Finder "Show on Map" highlight: a steady double ring (no animation,
// reduced-motion safe) around the pinged entrance.
const PING_RADIUS_INNER = 9;
const PING_RADIUS_OUTER = 14;
const PING_LINE_WIDTH = 3;
// Active-quest objective area (the translucent quest-POI blob) ring width.
const QUEST_AREA_LINE_WIDTH = 2;
// The numbered quest badge on each area (the WoW-style gold circle whose
// number matches the map's quest side list, in acceptance order).
const QUEST_BADGE_RADIUS = 9;
const QUEST_BADGE_FONT = 'bold 12px Georgia';
const QUEST_BADGE_GAP = 2; // px between badges when one area serves two quests
const QUEST_BADGE_LINE_WIDTH = 1.5;
const QUEST_BADGE_TEXT_LIFT = 4; // px above the arc center to optically center digits
// Zone-map gather nodes: type-distinct silhouettes (ore hex, wood pine, herb
// clover) larger than the minimap disc so they read at the full-zone frame,
// with a soft ready glow under unlocked harvestable icons (classic resource
// map cue). Cooldown keeps the same silhouette at a smaller radius without
// the glow. Locked reuses the minimap's diagonal strike through the icon.
const GATHER_READY_RADIUS = 5.5;
const GATHER_COOLDOWN_RADIUS = 4;
const GATHER_GLOW_EXTRA = 4;
const GATHER_LINE_WIDTH = 1.5;
const GATHER_LOCK_OVERREACH = 1.75;
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
  /** The quest-giver glyphs of this paint, for the hover tooltip's hit-test. */
  npcs: MapNpcMarker[];
  /** The gather-node icons of this paint, for the hover tooltip's hit-test. */
  gatherNodes: MapGatherNodeMarker[];
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
  constructor(private readonly classColor: (cls: string) => string) {}

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
    const model = buildOverworldMapModel({
      world,
      props: getActiveWorldContent().props,
      zone: opts.zone,
      zoom: opts.zoom,
      center: opts.center,
      canvasSize: opts.canvasSize,
      decorations,
      ping: opts.ping ?? null,
    });
    const colors = this.resolveColors();
    this.draw(ctx, model, opts.zoneBg, opts.canvasSize, colors);
    return {
      view: model.view,
      cursor: model.cursor,
      questAreas: model.questAreas,
      npcs: model.npcs,
      gatherNodes: model.gatherNodes,
    };
  }

  private draw(
    ctx: CanvasRenderingContext2D,
    model: OverworldMapModel,
    zoneBg: MapZoneBg,
    S: number,
    colors: MapColors,
  ): void {
    // Reclaim any label sprites the last redraws left over the budget, before
    // this redraw asks for its own (never mid-redraw: see text_sprite_cache).
    this.labels.beginRedraw();

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
    // POI / glyph layers so their text stays readable on top.
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
      ctx.lineWidth = QUEST_BADGE_LINE_WIDTH;
      ctx.strokeStyle = colors.outline;
      ctx.fillStyle = colors.questBadgeFill;
      // The one label on the map with no outline: it sits on its own gold disc.
      const badgeNumber: TextSpriteStyle = {
        font: QUEST_BADGE_FONT,
        fill: colors.questBadgeText,
      };
      for (const area of model.questAreas) {
        const n = area.numbers.length;
        for (let i = 0; i < n; i++) {
          const bx = area.mx + (i - (n - 1) / 2) * (QUEST_BADGE_RADIUS * 2 + QUEST_BADGE_GAP);
          ctx.beginPath();
          ctx.arc(bx, area.my, QUEST_BADGE_RADIUS, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          this.labels.draw(
            ctx,
            formatNumber(area.numbers[i], { maximumFractionDigits: 0 }),
            bx,
            area.my + QUEST_BADGE_TEXT_LIFT,
            badgeNumber,
          );
        }
      }
    }

    // Gather nodes: profession-colored type silhouettes over the quest-area
    // blobs (a resource field still reads inside a blue objective region) but
    // under the zone title, POI labels, portals, and quest glyphs, so label
    // text and quest / dungeon chrome stay readable on top.
    // Tier-identical (fairness): never preset- or governor-gated.
    if (model.gatherNodes.length > 0) {
      this.drawGatherNodes(ctx, model.gatherNodes, colors);
    }

    // Zone title (drawn on-canvas; the world map has no DOM zone label). Inside
    // a rift, show the generated floor name + rank instead of the overworld
    // zone, mirroring minimap_painter's zone-label override.
    const title = model.rift
      ? riftFloorLabel(model.rift.name, model.rift.rank)
      : zoneDisplayName(model.zoneId);
    this.labels.draw(ctx, title, S / 2, TITLE_BASELINE_Y, {
      font: TITLE_FONT,
      fill: colors.label,
      stroke: colors.outline,
      lineWidth: LABEL_LINE_WIDTH,
    });

    // POI labels (the title's outline + label color, one size down).
    const poiLabel: TextSpriteStyle = {
      font: LABEL_FONT,
      fill: colors.label,
      stroke: colors.outline,
      lineWidth: LABEL_LINE_WIDTH,
    };
    for (const poi of model.pois) {
      this.labels.draw(ctx, zonePoiLabel(poi.zoneId, poi.poiIndex), poi.mx, poi.my, poiLabel);
    }

    // Dungeon entrance portals: a purple dot plus the dungeon name above it. The
    // dot's own outline is the label outline at the label width, which the title
    // block used to leave behind on ctx; it is named here instead.
    ctx.fillStyle = colors.portalDot;
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = LABEL_LINE_WIDTH;
    const portalName: TextSpriteStyle = {
      font: PORTAL_NAME_FONT,
      fill: colors.portalLabel,
      stroke: colors.outline,
      lineWidth: LABEL_LINE_WIDTH,
    };
    for (const portal of model.portals) {
      ctx.beginPath();
      ctx.arc(portal.mx, portal.my, PORTAL_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      this.labels.draw(
        ctx,
        dungeonDisplayName(portal.dungeonId),
        portal.mx,
        portal.my - PORTAL_NAME_OFFSET_Y,
        portalName,
      );
    }

    // Dungeon Finder "Show on Map" highlight: a steady double ring around the
    // pinged entrance (drawn over the portal dot; no animation by design).
    if (model.ping) {
      ctx.strokeStyle = colors.ping;
      ctx.lineWidth = PING_LINE_WIDTH;
      ctx.beginPath();
      ctx.arc(model.ping.mx, model.ping.my, PING_RADIUS_INNER, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(model.ping.mx, model.ping.my, PING_RADIUS_OUTER, 0, Math.PI * 2);
      ctx.stroke();
      // Restore BOTH stroke settings, not just the width. Leaving the ping color
      // behind tinted every later outline on this canvas (the player arrow, and
      // the quest-giver glyphs before they became sprites) for as long as a
      // "Show on Map" ping was live.
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = LABEL_LINE_WIDTH;
    }

    // Quest-giver glyphs ('?' turn-in ready; '!' available in gold, repeat in
    // the rare blue, cooldown in the blue dimmed): at most three sprites for
    // the life of a resolved color set. The anchor is untouched, so the hover
    // hit-test (npcMarkerAt, over the same mx/my) still lines up with the
    // glyph. Never tier- or preset-gated: the marker is actionable info.
    const npcGlyph: TextSpriteStyle = {
      font: NPC_GLYPH_FONT,
      fill: colors.npcQuest,
      stroke: colors.outline,
      lineWidth: LABEL_LINE_WIDTH,
    };
    const npcGlyphRepeat: TextSpriteStyle = {
      font: NPC_GLYPH_FONT,
      fill: colors.npcQuestRepeat,
      stroke: colors.outline,
      lineWidth: LABEL_LINE_WIDTH,
    };
    for (const npc of model.npcs) {
      const glyph = npc.kind === 'ready' ? NPC_GLYPH_READY : NPC_GLYPH_AVAILABLE;
      const repeatColored = npc.kind === 'repeat' || npc.kind === 'cooldown';
      // Restore the PRIOR alpha, not a literal 1: nothing else dims this
      // context today, but a literal would hardcode that caller state.
      const priorAlpha = ctx.globalAlpha;
      if (npc.kind === 'cooldown') ctx.globalAlpha = NPC_GLYPH_COOLDOWN_ALPHA;
      this.labels.draw(ctx, glyph, npc.mx, npc.my, repeatColored ? npcGlyphRepeat : npcGlyph);
      if (npc.kind === 'cooldown') ctx.globalAlpha = priorAlpha;
    }

    // Local player facing arrow.
    if (model.player) {
      ctx.save();
      ctx.translate(model.player.mx, model.player.my);
      ctx.rotate(model.player.angle); // matches the flipped map (see toMap)
      ctx.fillStyle = colors.player;
      ctx.beginPath();
      ctx.moveTo(0, PLAYER_ARROW_TIP_Y);
      ctx.lineTo(PLAYER_ARROW_HALF_WIDTH, PLAYER_ARROW_BASE_Y);
      ctx.lineTo(-PLAYER_ARROW_HALF_WIDTH, PLAYER_ARROW_BASE_Y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Online allies: friends green, guild members blue (model dedups + orders).
    if (model.allies.length > 0) {
      ctx.lineWidth = LABEL_LINE_WIDTH;
      ctx.strokeStyle = colors.outline;
      // Two name styles, one per ally color; the dot keeps the same color.
      const friendName: TextSpriteStyle = {
        font: ALLY_FONT,
        fill: colors.allyFriend,
        stroke: colors.outline,
        lineWidth: LABEL_LINE_WIDTH,
      };
      const guildName: TextSpriteStyle = { ...friendName, fill: colors.allyGuild };
      for (const ally of model.allies) {
        const friend = ally.kind === 'friend';
        ctx.fillStyle = friend ? colors.allyFriend : colors.allyGuild;
        ctx.beginPath();
        ctx.arc(ally.mx, ally.my, ALLY_DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        this.labels.draw(
          ctx,
          ally.name,
          ally.mx,
          ally.my - ALLY_NAME_OFFSET_Y,
          friend ? friendName : guildName,
        );
      }
    }

    // Party members (issue 2652): the same dot + name-label family as the
    // online allies above, class-colored (or the dead token for a fallen
    // member) instead of friend/guild, so they read as visually distinct from
    // both the ally dots and the white player arrow.
    if (model.party.length > 0) {
      ctx.lineWidth = LABEL_LINE_WIDTH;
      ctx.strokeStyle = colors.outline;
      for (const member of model.party) {
        const color = member.dead ? colors.partyDead : this.classColor(member.cls);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(member.mx, member.my, ALLY_DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        this.labels.draw(ctx, member.name, member.mx, member.my - ALLY_NAME_OFFSET_Y, {
          font: ALLY_FONT,
          fill: color,
          stroke: colors.outline,
          lineWidth: LABEL_LINE_WIDTH,
        });
      }
    }
  }

  /** Profession-colored gather icons: ready glow + type silhouette + lock strike.
   *  Colors come from the once-per-redraw token table; geometry is named
   *  constants (no magic values). */
  private drawGatherNodes(
    ctx: CanvasRenderingContext2D,
    nodes: readonly MapGatherNodeMarker[],
    colors: MapColors,
  ): void {
    ctx.lineWidth = GATHER_LINE_WIDTH;
    ctx.strokeStyle = colors.outline;
    for (const node of nodes) {
      const radius = node.ready ? GATHER_READY_RADIUS : GATHER_COOLDOWN_RADIUS;
      const fill = node.locked
        ? colors.gatherLocked
        : node.ready
          ? gatherReadyColor(colors, node.type)
          : gatherCooldownColor(colors, node.type);
      // Soft halo under unlocked ready nodes only (the classic "this is up"
      // cue); cooldown and locked forgo the glow. Ready vs cooldown reads
      // through size, outline, and glow, never hue alone; a locked-but-ready
      // node keeps its outline stroke under the diagonal strike below
      // (DESIGN.md color independence).
      if (node.ready && !node.locked) {
        ctx.fillStyle = gatherGlowColor(colors, node.type);
        ctx.beginPath();
        ctx.arc(node.mx, node.my, radius + GATHER_GLOW_EXTRA, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = fill;
      pathGatherSilhouette(ctx, node.mx, node.my, radius, node.type);
      ctx.fill();
      if (node.ready) ctx.stroke();
      if (node.locked) {
        const reach = radius + GATHER_LOCK_OVERREACH;
        ctx.beginPath();
        ctx.moveTo(node.mx - reach, node.my + reach);
        ctx.lineTo(node.mx + reach, node.my - reach);
        ctx.stroke();
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
