// Canvas-2D painter for the painted atlas levels of the world map (the WoW
// style zoom-out views: the Breach region and the world of Valdris).
//
// The imperative half of the pure-core + painter split: geometry, hit areas
// and navigation rules live in map_atlas_view.ts (unit-tested); this module
// turns the flat AtlasModel into canvas draws. Hud owns the level state, the
// art Image cache and the pointer events; the procedural zone level stays with
// map_window_painter.ts, so the three map surfaces never duplicate a draw.
//
// NO-MAGIC-VALUES: the region accents and chrome colors resolve from
// --color-map-* tokens via getComputedStyle ONCE per redraw; every other
// literal (fonts, alphas, widths, offsets) is a named constant.

import { zoneDisplayName } from './entity_i18n';
import { t } from './i18n';
import type { AtlasAccent, AtlasModel } from './map_atlas_view';

const TITLE_FONT = 'bold 16px Georgia';
const TITLE_BASELINE_Y = 20;
const LABEL_FONT = 'bold 13px Georgia';
const LEVEL_FONT = 'bold 11px Georgia';
const LABEL_LINE_WIDTH = 3;
const LEVEL_OFFSET_Y = 14; // level band drawn this many px under the name
const SHAPE_LINE_WIDTH = 2;
const SHAPE_FILL_ALPHA = 0.1;
const SHAPE_FILL_ALPHA_HOVER = 0.3;
const SHAPE_FILL_ALPHA_HERE = 0.18;
const HERE_DOT_RADIUS = 5;
const HERE_DOT_OFFSET_Y = -26; // the "you are here" dot floats above the label
const HINT_FONT = 'bold 11px Georgia';
const HINT_MARGIN_Y = 8; // px from the canvas bottom

// Region accents + chrome, resolved once per redraw (a 2D context cannot read
// CSS vars any other way).
const ATLAS_COLOR_TOKENS = {
  kael: '--color-map-accent-kael',
  veth: '--color-map-accent-veth',
  ossara: '--color-map-accent-ossara',
  war: '--color-map-accent-war',
  landing: '--color-map-accent-landing',
  contested: '--color-map-accent-contested',
  label: '--color-map-label',
  outline: '--color-map-outline',
  player: '--color-map-player',
} as const;

type AtlasColors = Record<keyof typeof ATLAS_COLOR_TOKENS, string>;

/** Painter deps Hud injects: the loaded (or still-loading) level art. */
export interface AtlasPaintOptions {
  model: AtlasModel;
  /** The level's painted art, or null while it still loads (shapes + labels
   *  draw either way, so the map stays navigable). */
  image: HTMLImageElement | null;
  canvasW: number;
  canvasH: number;
}

/** Titles for the two group shapes that are not a single zone. */
function nodeTitle(nodeId: string, zoneId: string | null): string {
  if (zoneId) return zoneDisplayName(zoneId);
  return nodeId === 'landing' ? t('hudChrome.map.theLanding') : t('hudChrome.map.theBreachRing');
}

export class MapAtlasPainter {
  private resolveColors(): AtlasColors {
    const cs = getComputedStyle(document.documentElement);
    const colors = {} as AtlasColors;
    for (const key of Object.keys(ATLAS_COLOR_TOKENS) as (keyof typeof ATLAS_COLOR_TOKENS)[]) {
      colors[key] = cs.getPropertyValue(ATLAS_COLOR_TOKENS[key]).trim();
    }
    return colors;
  }

  paint(ctx: CanvasRenderingContext2D, opts: AtlasPaintOptions): void {
    const { model, image, canvasW, canvasH } = opts;
    const colors = this.resolveColors();
    const accent = (a: AtlasAccent): string => colors[a];

    ctx.clearRect(0, 0, canvasW, canvasH);
    if (image) {
      ctx.drawImage(image, model.fit.dx, model.fit.dy, model.fit.dw, model.fit.dh);
    }

    // region silhouettes: translucent fill + accent stroke; hover brightens,
    // the player's region keeps a steady stronger fill
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const shape of model.shapes) {
      const path = new Path2D();
      for (const ring of shape.paths) {
        if (ring.length === 0) continue;
        path.moveTo(ring[0].mx, ring[0].my);
        for (let i = 1; i < ring.length; i++) path.lineTo(ring[i].mx, ring[i].my);
        path.closePath();
      }
      ctx.globalAlpha = shape.hover
        ? SHAPE_FILL_ALPHA_HOVER
        : shape.playerHere
          ? SHAPE_FILL_ALPHA_HERE
          : SHAPE_FILL_ALPHA;
      ctx.fillStyle = accent(shape.accent);
      ctx.fill(path);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent(shape.accent);
      ctx.lineWidth = shape.hover || shape.playerHere ? SHAPE_LINE_WIDTH + 1 : SHAPE_LINE_WIDTH;
      ctx.stroke(path);
    }

    // labels: outlined region name + its level band
    ctx.textAlign = 'center';
    ctx.lineWidth = LABEL_LINE_WIDTH;
    ctx.strokeStyle = colors.outline;
    for (const label of model.labels) {
      const title = nodeTitle(label.nodeId, label.zoneId);
      ctx.font = LABEL_FONT;
      ctx.strokeText(title, label.mx, label.my);
      ctx.fillStyle = colors.label;
      ctx.fillText(title, label.mx, label.my);
      const band = t('hudChrome.map.levelBand', { min: String(label.min), max: String(label.max) });
      ctx.font = LEVEL_FONT;
      ctx.strokeText(band, label.mx, label.my + LEVEL_OFFSET_Y);
      ctx.fillText(band, label.mx, label.my + LEVEL_OFFSET_Y);
      if (label.playerHere) {
        ctx.beginPath();
        ctx.arc(label.mx, label.my + HERE_DOT_OFFSET_Y, HERE_DOT_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = colors.player;
        ctx.fill();
        ctx.stroke();
      }
    }

    // on-canvas level title (the world map has no DOM zone label) + the
    // navigation hint along the bottom edge
    const title =
      model.level === 'world' ? t('hudChrome.map.worldTitle') : t('hudChrome.map.theBreachRing');
    ctx.font = TITLE_FONT;
    ctx.strokeStyle = colors.outline;
    ctx.strokeText(title, canvasW / 2, TITLE_BASELINE_Y);
    ctx.fillStyle = colors.label;
    ctx.fillText(title, canvasW / 2, TITLE_BASELINE_Y);
    const hint =
      model.level === 'world' ? t('hudChrome.map.clickHint') : t('hudChrome.map.backHint');
    ctx.font = HINT_FONT;
    ctx.strokeText(hint, canvasW / 2, canvasH - HINT_MARGIN_Y);
    ctx.fillText(hint, canvasW / 2, canvasH - HINT_MARGIN_Y);
  }
}
