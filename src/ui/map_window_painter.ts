// Canvas-2D painter for the world-map window (overworld branch).
//
// The imperative half of the pure-core + painter split: the pure geometry lives
// in map_window_view.ts (buildOverworldMapModel, unit-tested there); this module
// turns that flat draw model into actual canvas draws. It owns the 2D context, the
// cached whole-world decorations, and the localized text + color resolution. The
// delve branch of the map is owned by delve_map_painter.ts; Hud picks the
// branch with mapWindowMode and only routes the overworld branch here, so the two
// painters never duplicate each other's marker drawing.
//
// CADENCE (preserved from the inline site): the map redraws while open from
// hud.update()'s mediumHud band (>=250ms) behind the `display === 'block'` guard,
// blitting the cached terrain background (Hud-owned, prewarmed) each redraw. This
// painter does not change that call site or cadence; it only owns the draw.
//
// NO-MAGIC-VALUES: a 2D context cannot read CSS vars, so the
// painter resolves the `--color-map-*` tokens via getComputedStyle ONCE per redraw
// (cached for the frame, never per-marker); every other literal (font, radius,
// line width, label offset, triangle geometry) is a named constant.

import type { ZoneDef } from '../sim/data';
import { type Decoration, generateDecorations } from '../sim/world';
import type { IWorld } from '../world_api';
import { dungeonDisplayName, zoneDisplayName, zonePoiLabel } from './entity_i18n';
import {
  buildOverworldMapModel,
  type MapDetail,
  type MapViewRect,
  type OverworldMapModel,
} from './map_window_view';

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
const NPC_GLYPH_AVAILABLE = '!'; // a quest is available
const ALLY_FONT = 'bold 11px Georgia';
const ALLY_DOT_RADIUS = 4;
const ALLY_NAME_OFFSET_Y = 8; // name drawn this many px above the dot
// The player facing-arrow triangle (canvas-local, drawn under a -facing rotation).
const PLAYER_ARROW_TIP_Y = -7;
const PLAYER_ARROW_HALF_WIDTH = 5;
const PLAYER_ARROW_BASE_Y = 6;
// Building footprint outline width in the detail overlay.
const BUILDING_LINE_WIDTH = 1;

// The `--color-map-*` design tokens the painter resolves once per redraw. These
// mirror the colors the inline overworld-map render used verbatim.
const MAP_COLOR_TOKENS = {
  label: '--color-map-label',
  outline: '--color-map-outline',
  portalDot: '--color-map-portal-dot',
  portalLabel: '--color-map-portal-label',
  npcQuest: '--color-map-npc-quest',
  player: '--color-map-player',
  allyFriend: '--color-map-ally-friend',
  allyGuild: '--color-map-ally-guild',
  rock: '--color-map-rock',
  tree: '--color-map-tree',
  oak: '--color-map-oak',
  buildingOutline: '--color-map-building-outline',
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
} as const;

type MapColors = Record<keyof typeof MAP_COLOR_TOKENS, string>;

/** Inputs for one overworld redraw. The cached terrain bg + the committed zone are
 *  Hud-owned (Hud keys the bg cache by zone); the painter owns the decorations. */
export interface MapPaintOptions {
  zone: ZoneDef;
  /** The cached terrain background canvas for the committed zone. */
  bg: HTMLCanvasElement;
  /** The square map-canvas side in px. */
  canvasSize: number;
  zoom: number;
  center: { x: number; z: number } | null;
}

/** What the painter reports back so Hud can update its drag state + cursor. */
export interface MapPaintResult {
  view: MapViewRect;
  cursor: 'grab' | 'default';
}

/**
 * Owns painting the overworld map onto the map-window canvas. One instance is
 * built by Hud; it caches the whole-world decorations once (generated from the
 * seed) and reuses them across redraws.
 */
export class MapWindowPainter {
  // Cached trees/rocks for the whole world, generated once from the world seed
  // (matches the inline site's lazy this.mapDecorations cache).
  private decorations: Decoration[] | null = null;

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
    if (!this.decorations) this.decorations = generateDecorations(world.cfg.seed);
    const model = buildOverworldMapModel({
      world,
      zone: opts.zone,
      zoom: opts.zoom,
      center: opts.center,
      canvasSize: opts.canvasSize,
      decorations: this.decorations,
    });
    const colors = this.resolveColors();
    this.draw(ctx, model, opts.bg, opts.canvasSize, colors);
    return { view: model.view, cursor: model.cursor };
  }

  private draw(
    ctx: CanvasRenderingContext2D,
    model: OverworldMapModel,
    bg: HTMLCanvasElement,
    S: number,
    colors: MapColors,
  ): void {
    // Blit the matching sub-rect of the cached terrain (note: +X is map-left).
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      bg,
      model.blit.sxFrac * bg.width,
      model.blit.syFrac * bg.height,
      model.blit.swFrac * bg.width,
      model.blit.shFrac * bg.height,
      0,
      0,
      S,
      S,
    );

    if (model.detail) this.drawDetail(ctx, model.detail, colors);

    // Zone title (drawn on-canvas; the world map has no DOM zone label).
    ctx.font = TITLE_FONT;
    ctx.textAlign = 'center';
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = LABEL_LINE_WIDTH;
    ctx.fillStyle = colors.label;
    const zoneName = zoneDisplayName(model.zoneId);
    ctx.strokeText(zoneName, S / 2, TITLE_BASELINE_Y);
    ctx.fillText(zoneName, S / 2, TITLE_BASELINE_Y);

    // POI labels (outline + label color carried from the title).
    ctx.font = LABEL_FONT;
    for (const poi of model.pois) {
      const text = zonePoiLabel(poi.zoneId, poi.poiIndex);
      ctx.strokeText(text, poi.mx, poi.my);
      ctx.fillText(text, poi.mx, poi.my);
    }

    // Dungeon entrance portals: a purple dot plus the dungeon name above it.
    for (const portal of model.portals) {
      ctx.fillStyle = colors.portalDot;
      ctx.beginPath();
      ctx.arc(portal.mx, portal.my, PORTAL_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = colors.portalLabel;
      ctx.font = PORTAL_NAME_FONT;
      const dungeonName = dungeonDisplayName(portal.dungeonId);
      ctx.strokeText(dungeonName, portal.mx, portal.my - PORTAL_NAME_OFFSET_Y);
      ctx.fillText(dungeonName, portal.mx, portal.my - PORTAL_NAME_OFFSET_Y);
    }

    // Quest-giver glyphs ('?' turn-in ready, '!' available). Color + font are
    // loop-invariant, so set them once before the loop, not per glyph (assigning
    // ctx.font re-parses the font string each time). The next text-drawing layer
    // (allies) sets its own font/fillStyle, so the carried-over portal-name font
    // is never read by a draw in between (pixel-identical to the inline original).
    ctx.fillStyle = colors.npcQuest;
    ctx.font = NPC_GLYPH_FONT;
    for (const npc of model.npcs) {
      const glyph = npc.ready ? NPC_GLYPH_READY : NPC_GLYPH_AVAILABLE;
      ctx.strokeText(glyph, npc.mx, npc.my);
      ctx.fillText(glyph, npc.mx, npc.my);
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
      ctx.font = ALLY_FONT;
      ctx.textAlign = 'center';
      for (const ally of model.allies) {
        const color = ally.kind === 'friend' ? colors.allyFriend : colors.allyGuild;
        ctx.fillStyle = color;
        ctx.strokeStyle = colors.outline;
        ctx.beginPath();
        ctx.arc(ally.mx, ally.my, ALLY_DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.strokeText(ally.name, ally.mx, ally.my - ALLY_NAME_OFFSET_Y);
        ctx.fillText(ally.name, ally.mx, ally.my - ALLY_NAME_OFFSET_Y);
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
        b.kind === 'chapel'
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
