// Canvas-2D painter for The Last Keep interior map (minimap + world-map window).
//
// The imperative half of the pure-core + painter split: the pure geometry
// (story selection, plate blit rects, projected markers, the baked-plate SVG
// source) lives in lastkeep_map_view.ts; this module turns that model into
// canvas draws for the two surfaces, exactly the DelveMapPainter shape. Hud
// picks the branch with lastKeepMapActive and routes both surfaces here, so
// the overworld painters never learn about the keep.
//
// PLATES: each story blits its baked public/map_bg/lastkeep_<story>.webp
// (scripts/build_lastkeep_map.mjs). If a plate fails to load the painter falls
// back to rasterizing the SAME SVG the baker encoded (a data: URL of
// lastKeepPlanSvg), so the map renders identically either way.
//
// WRITE-ELISION BOUNDARY: the map is Canvas-2D and a 2D context cannot be
// elided, so the canvas draws are NOT routed through the write-elision facet.
// The ONLY DOM write the painter makes is the minimap '#zone-label' text,
// which IS routed through the facet's setText. The world map paints its title
// onto the canvas instead (it has no DOM zone label).
//
// NO-MAGIC-VALUES (canvas sub-rule): a 2D context cannot read CSS vars, so
// the painter resolves the shared `--color-minimap-*` / `--color-delve-*`
// tokens via getComputedStyle and caches them (static :root tokens, one
// resolve per session, the MinimapPainter pattern). Every other literal
// (marker radii, arrow geometry, fonts, line widths) is a named constant.

import type { IWorld } from '../world_api';
import { dungeonDisplayName } from './entity_i18n';
import { type TranslationKey, t } from './i18n';
import {
  buildDawnholdMinimapModel,
  buildDawnholdWorldMapModel,
  buildLastKeepMinimapModel,
  buildLastKeepWorldMapModel,
  type DawnholdStoryId,
  dawnholdPlanSvg,
  type LastKeepMapModel,
  type LastKeepStoryId,
  lastKeepPlanSvg,
} from './lastkeep_map_view';
import type { PainterHostWriters } from './painter_host';

const FULL_CIRCLE = Math.PI * 2;

// Minimap surface (the fixed 162px circular minimap).
const MINIMAP_CLIP_INSET = 2; // clip radius = size / 2 - inset
// Historical overworld base scale (px per yard at zoom 1); the keep reuses it
// so the minimap zoom control behaves identically inside and out.
const MINIMAP_BASE_SCALE = 1.7;
const MINIMAP_PARTY_RADIUS = 4;
const MINIMAP_MARKER_DOT_RADIUS = 3.5;
const MINIMAP_OUTLINE_WIDTH = 1.5;
// The player facing arrow (the overworld minimap's exact geometry).
const MINIMAP_ARROW_TIP_Y = -7;
const MINIMAP_ARROW_HALF_X = 4.5;
const MINIMAP_ARROW_BASE_Y = 5.5;
const MINIMAP_ARROW_OUTLINE_WIDTH = 1;

// World-map surface (the square #map-canvas).
const WORLD_MAP_PAD_RATIO = 0.06;
const WORLD_MAP_PARTY_RADIUS = 5;
const WORLD_MAP_MARKER_DOT_RADIUS = 5;
const WORLD_MAP_OUTLINE_WIDTH = 2;
const WORLD_MAP_ARROW_TIP_Y = -10;
const WORLD_MAP_ARROW_HALF_X = 6.5;
const WORLD_MAP_ARROW_BASE_Y = 8;
const WORLD_MAP_TITLE_FONT = 'bold 14px Georgia';
const WORLD_MAP_TITLE_TOP = 6; // px from the canvas top
const WORLD_MAP_TITLE_OUTLINE_WIDTH = 3;

// Shared design tokens the painter resolves once (static :root tokens). The
// marker colors reuse the minimap set; the backdrop + title reuse the delve
// interior set so the keep sits in the same visual family as other interiors.
const LASTKEEP_COLOR_TOKENS = {
  backdrop: '--color-delve-room',
  label: '--color-delve-label',
  player: '--color-minimap-player',
  outline: '--color-minimap-outline',
  exit: '--color-minimap-portal',
  loot: '--color-minimap-object-loot',
  partyDead: '--color-minimap-party-dead',
} as const;

type LastKeepColors = Record<keyof typeof LASTKEEP_COLOR_TOKENS, string>;

type PlateState = HTMLImageElement | 'loading';

/** The per-castle pieces the shared painter composes: which dungeon names the
 * title, which baked plates to blit (and the matching SVG fallback source),
 * the title/story t() key prefix, and the two pure-core model builders. */
export interface CastleMapPainterSpec {
  dungeonId: string;
  /** public/map_bg/<plateBase>_<story>.webp */
  plateBase: string;
  /** hudChrome.<titlePrefix>.title + hudChrome.<titlePrefix>.story.<id> */
  titlePrefix: string;
  planSvg: (storyId: string) => string;
  buildMinimap: (world: IWorld, size: number, pxPerYard: number) => LastKeepMapModel | null;
  buildWorldMap: (world: IWorld, size: number, pad: number) => LastKeepMapModel | null;
}

export const LASTKEEP_MAP_PAINTER_SPEC: CastleMapPainterSpec = {
  dungeonId: 'the_last_keep',
  plateBase: 'lastkeep',
  titlePrefix: 'lastkeepMap',
  planSvg: (storyId) => lastKeepPlanSvg(storyId as LastKeepStoryId),
  buildMinimap: buildLastKeepMinimapModel,
  buildWorldMap: buildLastKeepWorldMapModel,
};

export const DAWNHOLD_MAP_PAINTER_SPEC: CastleMapPainterSpec = {
  dungeonId: 'dawnhold_castle',
  plateBase: 'dawnhold',
  titlePrefix: 'dawnholdMap',
  planSvg: (storyId) => dawnholdPlanSvg(storyId as DawnholdStoryId),
  buildMinimap: buildDawnholdMinimapModel,
  buildWorldMap: buildDawnholdWorldMapModel,
};

/**
 * Owns painting a castle floor plan onto the minimap and world-map canvases.
 * One instance per castle is built by Hud with the write-elision facet (for
 * '#zone-label') and the class-color resolver (party discs), the
 * DelveMapPainter shape. Defaults to The Last Keep's spec.
 */
export class LastKeepMapPainter {
  // Decoded story plates. An entry is the image once it is safe to draw
  // (loaded), 'loading' while the webp (or its SVG fallback) decodes.
  private readonly plates = new Map<string, PlateState>();
  private colors: LastKeepColors | null = null;

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly classColor: (cls: string) => string,
    private readonly spec: CastleMapPainterSpec = LASTKEEP_MAP_PAINTER_SPEC,
  ) {}

  /** Resolve the color tokens in one getComputedStyle pass and cache them
   *  (static :root tokens; the MinimapPainter caching rule). */
  private resolveColors(): LastKeepColors {
    if (this.colors) return this.colors;
    const cs = getComputedStyle(document.documentElement);
    const colors = {} as LastKeepColors;
    for (const key of Object.keys(
      LASTKEEP_COLOR_TOKENS,
    ) as (keyof typeof LASTKEEP_COLOR_TOKENS)[]) {
      colors[key] = cs.getPropertyValue(LASTKEEP_COLOR_TOKENS[key]).trim();
    }
    if (colors.player) this.colors = colors;
    return colors;
  }

  /** The decoded plate for a story, or null while it loads. First call kicks
   *  off the webp decode; a load error swaps in the SVG-source data URL, so
   *  the plan still renders (identical vector source) without the file. */
  private plateFor(storyId: string): HTMLImageElement | null {
    const state = this.plates.get(storyId);
    if (state instanceof HTMLImageElement) return state;
    if (state === 'loading') return null;
    const img = new Image();
    this.plates.set(storyId, 'loading');
    img.onload = () => {
      this.plates.set(storyId, img);
    };
    img.onerror = () => {
      img.onerror = null; // the data URL cannot fail; never loop
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(this.spec.planSvg(storyId))}`;
    };
    img.src = `/map_bg/${this.spec.plateBase}_${storyId}.webp`;
    return null;
  }

  /** The localized "Castle: Story" title for a story. */
  private title(storyId: string): string {
    return t(`hudChrome.${this.spec.titlePrefix}.title` as TranslationKey, {
      keep: dungeonDisplayName(this.spec.dungeonId),
      story: t(`hudChrome.${this.spec.titlePrefix}.story.${storyId}` as TranslationKey),
    });
  }

  private drawMarkers(
    ctx: CanvasRenderingContext2D,
    model: LastKeepMapModel,
    colors: LastKeepColors,
    dotRadius: number,
    partyRadius: number,
    outlineWidth: number,
    arrowTipY: number,
    arrowHalfX: number,
    arrowBaseY: number,
    arrowOutlineWidth: number,
  ): void {
    for (const m of model.markers) {
      switch (m.kind) {
        case 'exit':
        case 'loot':
          ctx.fillStyle = m.kind === 'exit' ? colors.exit : colors.loot;
          ctx.strokeStyle = colors.outline;
          ctx.lineWidth = outlineWidth;
          ctx.beginPath();
          ctx.arc(m.cx, m.cy, dotRadius, 0, FULL_CIRCLE);
          ctx.fill();
          ctx.stroke();
          break;
        case 'party':
          ctx.fillStyle = m.dead ? colors.partyDead : this.classColor(m.cls);
          ctx.strokeStyle = colors.outline;
          ctx.lineWidth = outlineWidth;
          ctx.beginPath();
          ctx.arc(m.cx, m.cy, partyRadius, 0, FULL_CIRCLE);
          ctx.fill();
          ctx.stroke();
          break;
        case 'player':
          ctx.save();
          ctx.translate(m.cx, m.cy);
          ctx.rotate(m.angle);
          ctx.fillStyle = colors.player;
          ctx.strokeStyle = colors.outline;
          ctx.lineWidth = arrowOutlineWidth;
          ctx.beginPath();
          ctx.moveTo(0, arrowTipY);
          ctx.lineTo(arrowHalfX, arrowBaseY);
          ctx.lineTo(-arrowHalfX, arrowBaseY);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          break;
      }
    }
  }

  /**
   * Minimap render: backdrop, the player-centered story plate, markers, and
   * the '#zone-label' story title through the write-elision facet. `zoom` is
   * the shared minimap zoom multiplier.
   */
  paintMinimap(
    ctx: CanvasRenderingContext2D,
    world: IWorld,
    zoneLabelEl: HTMLElement,
    size: number,
    zoom: number,
  ): void {
    const model = this.spec.buildMinimap(world, size, MINIMAP_BASE_SCALE * zoom);
    if (!model) return;
    this.writers.setText(zoneLabelEl, this.title(model.storyId));
    const colors = this.resolveColors();
    const plate = this.plateFor(model.storyId);

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - MINIMAP_CLIP_INSET, 0, FULL_CIRCLE);
    ctx.clip();
    ctx.fillStyle = colors.backdrop;
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    if (plate) ctx.drawImage(plate, model.plate.dx, model.plate.dy, model.plate.dw, model.plate.dh);
    this.drawMarkers(
      ctx,
      model,
      colors,
      MINIMAP_MARKER_DOT_RADIUS,
      MINIMAP_PARTY_RADIUS,
      MINIMAP_OUTLINE_WIDTH,
      MINIMAP_ARROW_TIP_Y,
      MINIMAP_ARROW_HALF_X,
      MINIMAP_ARROW_BASE_Y,
      MINIMAP_ARROW_OUTLINE_WIDTH,
    );
    ctx.restore();
  }

  /**
   * World-map render: the whole keep framed on the square canvas, markers,
   * and the story title drawn ON the canvas (the world map has no DOM zone
   * label). Returns the localized title so Hud can reuse it for '#map-summary'.
   */
  paintWorldMap(ctx: CanvasRenderingContext2D, world: IWorld, size: number): string {
    const pad = Math.round(size * WORLD_MAP_PAD_RATIO);
    const model = this.spec.buildWorldMap(world, size, pad);
    if (!model) return '';
    const colors = this.resolveColors();
    const plate = this.plateFor(model.storyId);
    const title = this.title(model.storyId);

    ctx.fillStyle = colors.backdrop;
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    if (plate) ctx.drawImage(plate, model.plate.dx, model.plate.dy, model.plate.dw, model.plate.dh);
    this.drawMarkers(
      ctx,
      model,
      colors,
      WORLD_MAP_MARKER_DOT_RADIUS,
      WORLD_MAP_PARTY_RADIUS,
      WORLD_MAP_OUTLINE_WIDTH,
      WORLD_MAP_ARROW_TIP_Y,
      WORLD_MAP_ARROW_HALF_X,
      WORLD_MAP_ARROW_BASE_Y,
      MINIMAP_ARROW_OUTLINE_WIDTH,
    );

    ctx.font = WORLD_MAP_TITLE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = WORLD_MAP_TITLE_OUTLINE_WIDTH;
    ctx.fillStyle = colors.label;
    ctx.strokeText(title, size / 2, WORLD_MAP_TITLE_TOP);
    ctx.fillText(title, size / 2, WORLD_MAP_TITLE_TOP);
    ctx.textBaseline = 'alphabetic';
    return title;
  }
}
