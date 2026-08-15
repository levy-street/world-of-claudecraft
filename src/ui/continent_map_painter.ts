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
//
// ZONE WASH, NOT ZONE RECTANGLES. A zone's world bounds are a rectangle, but
// drawing that rectangle turned the plate into a grid of boxes and made the hover
// highlight a box over the sea. Instead the hovered (and the current) zone is
// washed through the LAND MASK built from the plate itself
// (continent_land_mask.ts), faded out near its own bounds, so the highlight
// follows the coastline, skips the lakes and rivers, and softens the one edge
// that is genuinely straight: the border it shares with the next zone. No plate,
// no mask: the wash degrades to the flat rectangle fill, which is still the only
// affordance available without art.

import type { IWorld } from '../world_api';
import { loadContinentArt } from './continent_art';
import { buildLandMaskCanvas } from './continent_land_mask';
import {
  buildContinentMapModel,
  CONTINENT_FALLBACK_ASPECT,
  type ContinentMapModel,
  type ContinentRect,
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
// Zone wash: how far it fades in from the zone's own bounds, as a fraction of the
// zone's shorter side, with a floor so a thin band still fades. The fade is what
// keeps the border two zones share from reading as the drawn straight line it
// geometrically is.
const WASH_FEATHER_FRACTION = 0.14;
const WASH_FEATHER_MIN_PX = 6;
// Alpha-ramp endpoints for that fade. These are MASK stops, not themeable colors:
// the ramp composites destination-in, so only its alpha is ever read and the RGB
// it carries never reaches a pixel.
const MASK_STOP_OPAQUE = 'white';
const MASK_STOP_CLEAR = 'transparent';
// Cached finished washes. Above the two one frame can ask for (the current zone
// and the hovered one), so moving the cursor between zones cannot evict either.
const WASH_CACHE_LIMIT = 3;
// Drop shadow that seats the plate on the backdrop. SHADOW_NONE is the canvas
// "no shadow" sentinel, not a themeable color: every 2D context spells a disabled
// shadow as fully transparent black.
const PLATE_SHADOW_BLUR = 18;
const SHADOW_NONE = 'transparent';
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
  regionHoverFill: '--color-map-region-hover-fill',
  regionCurrentFill: '--color-map-region-current-fill',
  regionCurrentLabel: '--color-map-region-current-label',
  backdropDim: '--color-map-continent-backdrop-dim',
  plateShadow: '--color-map-continent-plate-shadow',
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
  // The land mask built from the plate, and whether that build has been attempted
  // (it is one-shot: a null mask after an attempt means the flat fallback wash,
  // never a rebuild per redraw).
  private mask: HTMLCanvasElement | null = null;
  private maskBuilt = false;
  // Finished washes, cached per zone + token + geometry and blitted on later
  // redraws (the offscreen-background-cache technique in src/ui/CLAUDE.md): the
  // composite is several full-surface passes, and the overview redraws on the
  // mediumHud band while it is open, so recompositing an unchanged wash four
  // times a second is the cost this avoids. Least-recently-used eviction past
  // WASH_CACHE_LIMIT, which is above the two a single frame can ask for (the
  // current zone and the hovered one) so neither evicts the other.
  private readonly washes = new Map<string, HTMLCanvasElement>();

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

  /** Build the land mask once the plate has decoded. One attempt per session: the
   *  plate is static, and a mask that could not be built (no context, a tainted
   *  canvas) will not build on the next redraw either. */
  private ensureMask(): HTMLCanvasElement | null {
    if (this.maskBuilt) return this.mask;
    if (this.artState !== 'ready' || !this.art) return null;
    this.maskBuilt = true;
    this.mask = buildLandMaskCanvas(this.art, this.art.naturalWidth, this.art.naturalHeight);
    return this.mask;
  }

  /**
   * The letterbox beside the plate: OPEN WATER, deepening toward the window edge.
   *
   * The flat token fill alone met the plate's painted sea at a visible seam, and
   * carrying the plate's own edge pixels outward (the first attempt) dragged
   * coastline into the margin, which reads as land outside the world. So the
   * margin stays pure sea: the ocean token, darkened by a gradient that is clear
   * where it meets the plate and full at the window edge, which is what open
   * water away from any coast actually does.
   */
  private paintLetterbox(
    ctx: CanvasRenderingContext2D,
    image: ContinentRect,
    S: number,
    dim: string,
  ): void {
    const right = image.mx + image.w;
    const bottom = image.my + image.h;
    if (image.mx > 0) {
      const left = ctx.createLinearGradient(0, 0, image.mx, 0);
      left.addColorStop(0, dim);
      left.addColorStop(1, MASK_STOP_CLEAR);
      ctx.fillStyle = left;
      ctx.fillRect(0, 0, image.mx, S);
      const far = ctx.createLinearGradient(right, 0, S, 0);
      far.addColorStop(0, MASK_STOP_CLEAR);
      far.addColorStop(1, dim);
      ctx.fillStyle = far;
      ctx.fillRect(right, 0, S - right, S);
    }
    if (image.my > 0) {
      const top = ctx.createLinearGradient(0, 0, 0, image.my);
      top.addColorStop(0, dim);
      top.addColorStop(1, MASK_STOP_CLEAR);
      ctx.fillStyle = top;
      ctx.fillRect(0, 0, S, image.my);
      const low = ctx.createLinearGradient(0, bottom, 0, S);
      low.addColorStop(0, MASK_STOP_CLEAR);
      low.addColorStop(1, dim);
      ctx.fillStyle = low;
      ctx.fillRect(0, bottom, S, S - bottom);
    }
  }

  /** Take the cached wash for this key, refreshing its recency, or null. */
  private cachedWash(key: string): HTMLCanvasElement | null {
    const hit = this.washes.get(key);
    if (!hit) return null;
    this.washes.delete(key); // re-insert so the live pair stays the most recent
    this.washes.set(key, hit);
    return hit;
  }

  /** Store a freshly composited wash, evicting the least recently used past the cap. */
  private storeWash(key: string, canvas: HTMLCanvasElement): void {
    this.washes.set(key, canvas);
    while (this.washes.size > WASH_CACHE_LIMIT) {
      const oldest = this.washes.keys().next();
      if (oldest.done) break;
      this.washes.delete(oldest.value);
    }
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
    // Open ocean under everything (the only backdrop available with no plate),
    // then the plate's own sea carried out into the letterbox, then the plate
    // itself. Regions, labels and the player marker draw on top.
    ctx.fillStyle = colors.ocean;
    ctx.fillRect(0, 0, S, S);
    if (this.artState === 'ready' && this.art) {
      this.paintLetterbox(ctx, model.image, S, colors.backdropDim);
      ctx.imageSmoothingEnabled = true;
      // A soft drop shadow seats the plate on that surround, so the boundary
      // reads as depth rather than as two flat fills meeting.
      ctx.shadowColor = colors.plateShadow;
      ctx.shadowBlur = PLATE_SHADOW_BLUR;
      ctx.drawImage(this.art, model.image.mx, model.image.my, model.image.w, model.image.h);
      ctx.shadowColor = SHADOW_NONE;
      ctx.shadowBlur = 0;
    }

    // Zone highlights, and deliberately no borders: the zone the player stands in
    // carries a permanent quiet wash and the hovered one a brighter wash on top,
    // both masked to the painted land. Hovering your own zone draws the hover
    // alone rather than stacking the two.
    const hovered = model.regions.find((r) => r.isHovered);
    const current = model.regions.find((r) => r.isCurrent && !r.isHovered);
    if (current) this.wash(ctx, model.image, current, S, colors.regionCurrentFill);
    if (hovered) this.wash(ctx, model.image, hovered, S, colors.regionHoverFill);

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
    // The zone the player stands in is the one the borders used to call out; its
    // label carries that job now, so the "where am I" read survives their removal.
    ctx.fillStyle = region.isCurrent ? colors.regionCurrentLabel : colors.label;
    ctx.strokeText(text, region.labelX, region.labelY);
    ctx.fillText(text, region.labelX, region.labelY);
  }

  /**
   * Wash one zone in `fill`, masked to the painted land and faded out toward the
   * zone's own bounds, then blit it over the art in a single draw. The composite
   * (mask in, tint through it, two feather ramps) happens once per zone + token +
   * geometry and is cached; a redraw with the same hover state blits and nothing
   * more, which is what keeps the mediumHud cadence cheap.
   *
   * Falls back to a flat rectangle fill when there is no mask (no plate, no 2D
   * context, or a cross-origin plate that tainted the mask canvas), so the
   * highlight is never simply absent.
   */
  private wash(
    ctx: CanvasRenderingContext2D,
    image: ContinentRect,
    region: ContinentZoneRegion,
    S: number,
    fill: string,
  ): void {
    const mask = this.ensureMask();
    const rect = region.rect;
    if (!mask) {
      ctx.fillStyle = fill;
      ctx.fillRect(rect.mx, rect.my, rect.w, rect.h);
      return;
    }
    // Geometry is in the key as well as the zone: the same zone lands on a
    // different rect when the canvas or the plate's fitted box changes.
    const key = `${region.zoneId}|${fill}|${S}|${image.mx},${image.my},${image.w},${image.h}`;
    const cached = this.cachedWash(key);
    if (cached) {
      ctx.drawImage(cached, 0, 0);
      return;
    }
    const surface = document.createElement('canvas');
    surface.width = S;
    surface.height = S;
    const sctx = surface.getContext('2d');
    if (!sctx) {
      ctx.fillStyle = fill;
      ctx.fillRect(rect.mx, rect.my, rect.w, rect.h);
      return;
    }
    // The land mask, positioned exactly like the plate it was built from.
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(mask, image.mx, image.my, image.w, image.h);
    // Tint it: source-in keeps the mask's alpha and takes the token's color and
    // its own alpha, so the token alone decides how strong the wash reads.
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = fill;
    sctx.fillRect(0, 0, S, S);
    // Confine it to this zone, fading over the feather band on all four sides.
    // Two destination-in ramps multiply into a soft-edged rectangle; outside the
    // ramps the end stop is transparent, which clears the rest of the surface.
    sctx.globalCompositeOperation = 'destination-in';
    const feather = Math.max(WASH_FEATHER_MIN_PX, Math.min(rect.w, rect.h) * WASH_FEATHER_FRACTION);
    sctx.fillStyle = this.featherRamp(sctx, rect.mx, rect.w, feather, false);
    sctx.fillRect(0, 0, S, S);
    sctx.fillStyle = this.featherRamp(sctx, rect.my, rect.h, feather, true);
    sctx.fillRect(0, 0, S, S);
    this.storeWash(key, surface);
    ctx.drawImage(surface, 0, 0);
  }

  /** One axis of the feathered-rectangle mask: clear at the zone's edge, opaque a
   *  feather inside it. A band narrower than two feathers collapses to a single
   *  opaque midpoint rather than inverting. */
  private featherRamp(
    ctx: CanvasRenderingContext2D,
    start: number,
    size: number,
    feather: number,
    vertical: boolean,
  ): CanvasGradient {
    const end = start + size;
    const grad = vertical
      ? ctx.createLinearGradient(0, start, 0, end)
      : ctx.createLinearGradient(start, 0, end, 0);
    const ramp = size > 0 ? Math.min(0.5, feather / size) : 0.5;
    grad.addColorStop(0, MASK_STOP_CLEAR);
    grad.addColorStop(ramp, MASK_STOP_OPAQUE);
    grad.addColorStop(1 - ramp, MASK_STOP_OPAQUE);
    grad.addColorStop(1, MASK_STOP_CLEAR);
    return grad;
  }
}
