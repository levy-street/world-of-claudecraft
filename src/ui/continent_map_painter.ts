// Canvas-2D painter for the world map's CONTINENT overview level.
//
// The imperative half of the pure-core + painter split: the pure geometry lives
// in continent_map_view.ts (buildContinentMapModel, unit-tested there); this
// module turns that flat draw model into canvas draws. It owns the 2D context,
// the decoded continent art plate, and the localized labels + color resolution.
// Hud routes here from updateMapWindow when the map level is 'continent'; the
// per-zone overworld branch stays in map_window_painter.ts.
//
// CADENCE: like the per-zone map, the continent redraws while open from
// hud.update()'s mediumHud band, so the art plate simply appears on the next
// redraw after it decodes (no repaint callback needed).
//
// NO-MAGIC-VALUES: a 2D context cannot read CSS vars, so the painter resolves the
// --color-map-* tokens via getComputedStyle ONCE per redraw (cached for the
// frame, never per-region); every other literal (font, radius, line width) is a
// named constant.

import type { IWorld } from '../world_api';
import { loadContinentArt } from './continent_art';
import {
  buildContinentMapModel,
  CONTINENT_FALLBACK_ASPECT,
  type ContinentMapModel,
  type ContinentZoneRegion,
} from './continent_map_view';
import { zoneDisplayName } from './entity_i18n';
import { t } from './i18n';

// Typography (Georgia, matching the per-zone map painter).
const TITLE_FONT = 'bold 16px Georgia';
const TITLE_BASELINE_Y = 20; // px from the canvas top
const LABEL_FONT = 'bold 12px Georgia';
const LABEL_HOVER_FONT = 'bold 13px Georgia';
const LABEL_LINE_WIDTH = 3; // text outline width
// Zone region rectangles.
const REGION_LINE_WIDTH = 1.5;
const REGION_HOVER_LINE_WIDTH = 2.5;
const REGION_CURRENT_LINE_WIDTH = 2.5;
// "You are here" marker: a filled dot inside a steady ring (no animation).
const HERE_DOT_RADIUS = 3.5;
const HERE_RING_RADIUS = 6.5;
const HERE_RING_LINE_WIDTH = 2;
// Party member dots (issue 2652): smaller than the player's own dot and with a
// thinner outline, so self stays the emphasized marker at a glance.
const PARTY_DOT_RADIUS = 3;
const PARTY_DOT_LINE_WIDTH = 1.5;

// The --color-map-* design tokens the painter resolves once per redraw. The
// label/outline/player group is shared with the per-zone map painter; the ocean
// and region groups are this level's own (the continent ocean is a wide visible
// letterbox beside the plate, so it tracks the plate art, not the zone map's
// off-map backdrop).
const CONTINENT_COLOR_TOKENS = {
  ocean: '--color-map-continent-ocean',
  label: '--color-map-label',
  outline: '--color-map-outline',
  player: '--color-map-player',
  partyDead: '--color-map-party-dead',
  regionStroke: '--color-map-region-stroke',
  regionHoverFill: '--color-map-region-hover-fill',
  regionHoverStroke: '--color-map-region-hover-stroke',
  regionCurrentStroke: '--color-map-region-current-stroke',
} as const;

type ContinentColors = Record<keyof typeof CONTINENT_COLOR_TOKENS, string>;

export interface ContinentPaintOptions {
  /** The square map-canvas side in px. */
  canvasSize: number;
  /** The zone id under the cursor, or null (drives the hover highlight). */
  hoveredZoneId: string | null;
}

export interface ContinentPaintResult {
  /** The painted zone regions, for Hud's hover/click hit-test (continentZoneAt). */
  regions: ContinentZoneRegion[];
}

/**
 * Owns painting the continent overview onto the map-window canvas. One instance
 * is built by Hud; it loads the art plate once and reuses it across redraws.
 */
export class ContinentMapPainter {
  private art: HTMLImageElement | null = null;
  private artState: 'idle' | 'loading' | 'ready' | 'missing' = 'idle';

  /** classColor resolves a party member's class to its display color (issue
   *  2652), the same resolver Hud threads into MinimapPainter / DelveMapPainter
   *  / MapWindowPainter, so a member reads as the same color on every surface. */
  constructor(private readonly classColor: (cls: string) => string) {}

  private ensureArt(): void {
    if (this.artState !== 'idle') return;
    this.artState = 'loading';
    loadContinentArt(
      (img) => {
        this.art = img;
        this.artState = 'ready';
      },
      () => {
        this.artState = 'missing';
      },
    );
  }

  private resolveColors(): ContinentColors {
    const cs = getComputedStyle(document.documentElement);
    const read = (token: string): string => cs.getPropertyValue(token).trim();
    const colors = {} as ContinentColors;
    for (const key of Object.keys(
      CONTINENT_COLOR_TOKENS,
    ) as (keyof typeof CONTINENT_COLOR_TOKENS)[]) {
      colors[key] = read(CONTINENT_COLOR_TOKENS[key]);
    }
    return colors;
  }

  /** Paint the continent overview for one redraw and report the zone regions. */
  paintContinent(
    ctx: CanvasRenderingContext2D,
    world: IWorld,
    opts: ContinentPaintOptions,
  ): ContinentPaintResult {
    this.ensureArt();
    const contentAspect =
      this.art && this.art.naturalHeight > 0
        ? this.art.naturalWidth / this.art.naturalHeight
        : CONTINENT_FALLBACK_ASPECT;
    const model = buildContinentMapModel({
      world,
      canvasSize: opts.canvasSize,
      contentAspect,
      hoveredZoneId: opts.hoveredZoneId,
    });
    const colors = this.resolveColors();
    this.draw(ctx, model, opts.canvasSize, colors);
    return { regions: model.regions };
  }

  private draw(
    ctx: CanvasRenderingContext2D,
    model: ContinentMapModel,
    S: number,
    colors: ContinentColors,
  ): void {
    // Open ocean under everything, then the continent art (if decoded) fitted to
    // the model's dest rect. Regions, labels and the player marker draw on top.
    ctx.fillStyle = colors.ocean;
    ctx.fillRect(0, 0, S, S);
    if (this.artState === 'ready' && this.art) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.art, model.image.mx, model.image.my, model.image.w, model.image.h);
    }

    // Zone regions: a light border on every zone, a translucent fill + brighter
    // border on the hovered zone, and a distinct border on the current zone.
    for (const region of model.regions) {
      const { rect } = region;
      if (region.isHovered) {
        ctx.fillStyle = colors.regionHoverFill;
        ctx.fillRect(rect.mx, rect.my, rect.w, rect.h);
      }
      ctx.lineWidth = region.isHovered
        ? REGION_HOVER_LINE_WIDTH
        : region.isCurrent
          ? REGION_CURRENT_LINE_WIDTH
          : REGION_LINE_WIDTH;
      ctx.strokeStyle = region.isHovered
        ? colors.regionHoverStroke
        : region.isCurrent
          ? colors.regionCurrentStroke
          : colors.regionStroke;
      ctx.strokeRect(rect.mx, rect.my, rect.w, rect.h);
    }

    // Zone name labels: outlined for legibility over the art, hovered one lifted
    // to the top with the larger font. Loop-invariant text state is set per label
    // only where it changes (font differs for the hovered entry).
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = LABEL_LINE_WIDTH;
    for (const region of model.regions) {
      if (region.isHovered) continue; // drawn last, on top
      ctx.font = LABEL_FONT;
      this.label(ctx, region, colors);
    }
    const hovered = model.regions.find((r) => r.isHovered);
    if (hovered) {
      ctx.font = LABEL_HOVER_FONT;
      this.label(ctx, hovered, colors);
    }

    // Party members (issue 2652): one class-colored dot per member (the dead
    // token for a fallen one), drawn BEFORE the player marker so self always
    // reads on top when the group is stacked together. No name labels here: the
    // zone cells are already full of their own labels at this scale, so naming
    // members stays the per-zone map's job (see ContinentPartyMarker).
    if (model.party.length > 0) {
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = PARTY_DOT_LINE_WIDTH;
      for (const member of model.party) {
        ctx.fillStyle = member.dead ? colors.partyDead : this.classColor(member.cls);
        ctx.beginPath();
        ctx.arc(member.mx, member.my, PARTY_DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // "You are here": a filled dot in a ring at the player's projected position.
    if (model.player) {
      ctx.fillStyle = colors.player;
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = HERE_RING_LINE_WIDTH;
      ctx.beginPath();
      ctx.arc(model.player.mx, model.player.my, HERE_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(model.player.mx, model.player.my, HERE_RING_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Overview title (drawn on-canvas; the map window has no DOM title).
    ctx.font = TITLE_FONT;
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = LABEL_LINE_WIDTH;
    ctx.strokeStyle = colors.outline;
    ctx.fillStyle = colors.label;
    const title = t('hudChrome.continentMap.title');
    ctx.strokeText(title, S / 2, TITLE_BASELINE_Y);
    ctx.fillText(title, S / 2, TITLE_BASELINE_Y);
  }

  private label(
    ctx: CanvasRenderingContext2D,
    region: ContinentZoneRegion,
    colors: ContinentColors,
  ): void {
    const text = zoneDisplayName(region.zoneId);
    ctx.strokeStyle = colors.outline;
    ctx.fillStyle = colors.label;
    ctx.strokeText(text, region.labelX, region.labelY);
    ctx.fillText(text, region.labelX, region.labelY);
  }
}
