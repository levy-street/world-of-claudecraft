// The raid atlas's composing painter: one open map page drawn onto the
// atlas canvas, in three cached layers and one live one.
//
//   the page      the illustrated floor (raid_atlas_page_painter.ts): a whole-
//                 page plate rendered once per floor, blitted through the
//                 camera; once the view settles zoomed past the plate's
//                 resolution, a sharp render of just the view replaces it.
//   the marks     on top of the page and cached with it: the current area's
//                 glow, the portals, the boss medallions, the room names (at
//                 screen size, decluttered by zoom), the player's pins and
//                 the group's shared marks (the raid world markers).
//   the live      every frame: the raid's class jewels, a fighting boss's
//                 pulse, the gilded player arrow (smooth with facing).
//   the frame     cached per size: burnt edges, the gilded frame, the title
//                 cartouche, the compass rose and the scale bar.
//
// The 2D context cannot read a CSS custom property, so the palette and fonts
// are resolved ONCE per session (getComputedStyle) and kept. Text goes through
// the shared sprite cache (text_sprite_cache.ts) so steady frames never call a
// canvas text API; only the rarely rebuilt frame layer draws text directly.

import { formatNumber, t } from '../../i18n';
import { TextSpriteCache } from '../../text_sprite_cache';
import { raidAtlasBossFaces } from './raid_atlas_boss_core';
import {
  pageSpan,
  pageToScreen,
  type RaidAtlasView,
  toPage,
  viewScale,
} from './raid_atlas_camera_core';
import {
  drawBurntEdges,
  drawCartouche,
  drawCompassRose,
  drawEngagedPulse,
  drawFrame,
  drawMember,
  drawPin,
  drawPlayerArrow,
  drawPoi,
  drawSharedMark,
} from './raid_atlas_glyph_painter';
import { paintRaidAtlasPage } from './raid_atlas_page_painter';
import {
  RAID_ATLAS_COLOR_TOKENS,
  RAID_ATLAS_FONT_TOKENS,
  type RaidAtlasColors,
  type RaidAtlasFonts,
} from './raid_atlas_palette_core';
import type { RaidAtlasPin } from './raid_atlas_pins_core';
import {
  type RaidAtlasArea,
  type RaidAtlasFloor,
  type RaidAtlasPlan,
  raidAtlasAreaAt,
  raidAtlasFloorAt as raidAtlasFloorOf,
} from './raid_atlas_plan_core';
import { drawBossHoverHalo, drawBossPortraitMedallion } from './raid_atlas_portrait_glyph';
import type { RaidAtlasFaceSource } from './raid_atlas_portraits';
import { type RaidAtlasSharedMark, sharedMarksKey } from './raid_atlas_shared_marks_core';
import type { RaidAtlasFrame } from './raid_atlas_view';

/** The whole-page plate's long side, device px. */
const PLATE_PX = 2048;
/** Past this oversampling of the plate a settled view renders sharp. */
const DETAIL_AT = 1.2;
/** The frame's dark band as a share of the canvas side. */
const FRAME_BAND = 0.024;
const ARROW_PX = 34;
const MEMBER_PX = 6;
/** A boss medallion's radius at home zoom (it carries the boss's face, so it
 *  is the largest mark on the page). */
const BOSS_PX = 19;
const PIN_PX = 26;
/** A shared mark's token radius at home zoom (CSS px). */
export const RAID_ATLAS_SHARED_MARK_PX = 12;
const POI_PX = 9;
/** Minor room names appear once a yard spans this many CSS px. */
const MINOR_LABEL_SCALE = 1.45;
/** Boss names appear under their medallion from this scale. */
const BOSS_NAME_SCALE = 1.15;

/** Everything one paint needs. */
export interface RaidAtlasPaintInput {
  plan: RaidAtlasPlan;
  floor: RaidAtlasFloor;
  view: RaidAtlasView;
  /** CSS px of the square canvas, and its device pixel ratio. */
  side: number;
  dpr: number;
  frame: RaidAtlasFrame;
  pins: readonly RaidAtlasPin[];
  selectedPin: number | null;
  /** The group's shared marks (every floor; the page draws its own). */
  sharedMarks: readonly RaidAtlasSharedMark[];
  /** The view is at rest (no glide, no finger down): render sharp. */
  settled: boolean;
  title: string;
  subtitle: string;
  bossName(mobId: string): string;
  classColor(cls: string): string;
  /** Seconds, the frame clock (only the engaged pulse reads it). */
  clock: number;
  /** The bosses' faces (busts that have not landed draw the crest). */
  faces: RaidAtlasFaceSource;
  /** The encounter whose pin is hovered or focused (its halo), or null. */
  hoverBoss: string | null;
}

/** A boss medallion's radius (CSS px) on a canvas of `side` at `zoom`: the
 *  marks layer paints it and the controller's hit test reads it. */
export function raidAtlasBossRadius(side: number, zoom: number): number {
  const unit = side < 420 ? 0.82 : 1;
  return BOSS_PX * unit * Math.min(1.35, 1 + (zoom - 1) * 0.06);
}

interface Layer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  key: string;
}

function makeLayer(): Layer | null {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx, key: '' } : null;
}

function sizeLayer(layer: Layer, w: number, h: number): void {
  if (layer.canvas.width !== w) layer.canvas.width = w;
  if (layer.canvas.height !== h) layer.canvas.height = h;
}

/** The screen rotation of the arrow for a sim facing (0 = +z = up the page;
 *  the page mirrors x, so a turn toward +x turns the arrow left). */
export function arrowScreenAngle(facing: number): number {
  return -facing;
}

export class RaidAtlasPainter {
  private colors: RaidAtlasColors | null = null;
  private fonts: RaidAtlasFonts | null = null;
  private readonly plates = new Map<string, Layer>();
  private page: Layer | null = null;
  private frameLayer: Layer | null = null;
  private readonly labels = new TextSpriteCache(256);
  private readonly areaPaths = new Map<string, Path2D>();

  private palette(): { colors: RaidAtlasColors; fonts: RaidAtlasFonts } {
    if (this.colors && this.fonts) return { colors: this.colors, fonts: this.fonts };
    const styles = getComputedStyle(document.documentElement);
    const colors = {} as RaidAtlasColors;
    for (const key of Object.keys(RAID_ATLAS_COLOR_TOKENS) as (keyof RaidAtlasColors)[])
      colors[key] = styles.getPropertyValue(RAID_ATLAS_COLOR_TOKENS[key]).trim();
    const fonts = {} as RaidAtlasFonts;
    for (const key of Object.keys(RAID_ATLAS_FONT_TOKENS) as (keyof RaidAtlasFonts)[])
      fonts[key] = styles.getPropertyValue(RAID_ATLAS_FONT_TOKENS[key]).trim() || 'serif';
    // Keep only a resolved palette (a sheet still loading reads empty).
    if (colors.ink) {
      this.colors = colors;
      this.fonts = fonts;
    }
    return { colors, fonts };
  }

  /** The whole-page plate of a floor (rendered on first use, then kept). */
  private plate(plan: RaidAtlasPlan, floor: RaidAtlasFloor, colors: RaidAtlasColors): Layer | null {
    const cached = this.plates.get(floor.id);
    if (cached) return cached;
    const layer = makeLayer();
    if (!layer) return null;
    sizeLayer(layer, PLATE_PX, PLATE_PX);
    const k = PLATE_PX / pageSpan(floor.bounds);
    paintRaidAtlasPage(layer.ctx, plan, floor, colors, { k, offU: 0, offV: 0 }, PLATE_PX, PLATE_PX);
    this.plates.set(floor.id, layer);
    return layer;
  }

  /** The resolved palette, or null before the stylesheet has landed. */
  resolvedColors(): RaidAtlasColors | null {
    const { colors } = this.palette();
    return colors.ink ? colors : null;
  }

  /** The resolved fonts, or null before the stylesheet has landed. */
  resolvedFonts(): RaidAtlasFonts | null {
    const { colors, fonts } = this.palette();
    return colors.ink ? fonts : null;
  }

  /** A floor's whole-page plate (the minimap crops it), rendered on first
   *  use; null before the stylesheet has landed. */
  plateCanvas(plan: RaidAtlasPlan, floor: RaidAtlasFloor): HTMLCanvasElement | null {
    const { colors } = this.palette();
    if (!colors.ink) return null;
    return this.plate(plan, floor, colors)?.canvas ?? null;
  }

  /** Warm a floor's plate ahead of the first open (one floor per call). */
  prewarm(plan: RaidAtlasPlan, floor: RaidAtlasFloor): boolean {
    if (this.plates.has(floor.id)) return false;
    const { colors } = this.palette();
    if (!colors.ink) return false;
    this.plate(plan, floor, colors);
    return true;
  }

  private areaPath(plan: RaidAtlasPlan, floor: RaidAtlasFloor, area: RaidAtlasArea): Path2D {
    const key = `${floor.id}:${area}`;
    const cached = this.areaPaths.get(key);
    if (cached) return cached;
    const path = new Path2D();
    for (const si of floor.surfaces) {
      const s = plan.field.surfaces[si];
      let cx = 0;
      let cz = 0;
      for (const p of s.points) {
        cx += p[0];
        cz += p[1];
      }
      const n = Math.max(1, s.points.length);
      if (raidAtlasAreaAt(cx / n, cz / n) !== area) continue;
      s.points.forEach((p, i) => {
        if (i === 0) path.moveTo(p[0], p[1]);
        else path.lineTo(p[0], p[1]);
      });
      path.closePath();
    }
    this.areaPaths.set(key, path);
    return path;
  }

  private pageKey(input: RaidAtlasPaintInput, sharp: boolean): string {
    const v = input.view;
    const f = input.frame;
    const bosses = f.bosses.map((b) => b.state[0]).join('');
    const pins = input.pins.map((p) => `${p.id}${p.icon[0]}${p.color[0]}`).join('.');
    return [
      input.floor.id,
      v.zoom.toFixed(4),
      v.cu.toFixed(2),
      v.cv.toFixed(2),
      input.side,
      input.dpr,
      sharp ? 1 : 0,
      f.playerArea ?? '-',
      bosses,
      pins,
      input.selectedPin ?? '-',
      sharedMarksKey(input.sharedMarks),
      input.faces.version,
    ].join('|');
  }

  /** Paint the page and its marks into the page layer (when its key moved). */
  private paintPage(
    input: RaidAtlasPaintInput,
    colors: RaidAtlasColors,
    fonts: RaidAtlasFonts,
  ): Layer | null {
    this.page ??= makeLayer();
    const layer = this.page;
    if (!layer) return null;
    const { plan, floor, view, side, dpr } = input;
    const span = pageSpan(floor.bounds);
    const s = viewScale(view, span, side);
    const plateK = PLATE_PX / span;
    const sharp = input.settled && s * dpr > plateK * DETAIL_AT;
    const key = this.pageKey(input, sharp);
    if (layer.key === key) return layer;
    layer.key = key;
    const W = Math.round(side * dpr);
    sizeLayer(layer, W, W);
    const ctx = layer.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    // Top-left page point of the view.
    const offU = view.cu - side / 2 / s;
    const offV = view.cv - side / 2 / s;
    if (sharp) {
      paintRaidAtlasPage(ctx, plan, floor, colors, { k: s * dpr, offU, offV }, W, W);
    } else {
      const plate = this.plate(plan, floor, colors);
      if (plate) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const srcSide = (side / s) * plateK;
        ctx.drawImage(plate.canvas, offU * plateK, offV * plateK, srcSide, srcSide, 0, 0, W, W);
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBurntEdges(ctx, colors, side);
    this.paintMarks(ctx, input, colors, fonts, s, span);
    return layer;
  }

  private paintMarks(
    ctx: CanvasRenderingContext2D,
    input: RaidAtlasPaintInput,
    colors: RaidAtlasColors,
    fonts: RaidAtlasFonts,
    s: number,
    span: number,
  ): void {
    const { plan, floor, view, side, dpr, frame } = input;
    const at = (x: number, z: number) => {
      const p = toPage(floor.bounds, x, z);
      return pageToScreen(view, span, side, p.u, p.v);
    };
    // The current area's glow.
    if (frame.playerArea && frame.playerFloor === floor.id) {
      const path = this.areaPath(plan, floor, frame.playerArea);
      const b = floor.bounds;
      const offU = view.cu - side / 2 / s;
      const offV = view.cv - side / 2 / s;
      ctx.save();
      ctx.setTransform(
        -s * dpr,
        0,
        0,
        -s * dpr,
        s * dpr * (b.maxX - offU),
        s * dpr * (b.maxZ - offV),
      );
      ctx.lineJoin = 'round';
      ctx.strokeStyle = colors.glow;
      ctx.shadowColor = colors.glow;
      ctx.shadowBlur = 10 * dpr;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2.6 / s;
      ctx.stroke(path);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = colors.glow;
      ctx.fill(path);
      ctx.restore();
    }
    const small = side < 420;
    const unit = small ? 0.82 : 1;
    // Portals and the entrance.
    // The Heart's exit opens only once the final boss has fallen.
    const finalDown = frame.bosses.some((b) => b.boss.id === 'final' && b.state === 'dead');
    for (const poi of plan.pois) {
      if (poi.floor !== floor.id || (poi.kind === 'exit' && !finalDown)) continue;
      const p = at(poi.x, poi.z);
      drawPoi(ctx, colors, poi.kind, p.sx, p.sy, POI_PX * unit);
    }
    // Room names.
    this.labels.setPixelRatio(dpr);
    this.labels.beginRedraw();
    const grow = Math.min(1.3, 1 + (view.zoom - 1) * 0.08);
    const majorPx = Math.round((small ? 11 : 14) * grow);
    const minorPx = Math.round((small ? 9.5 : 11.5) * grow);
    const major = {
      font: `600 ${majorPx}px ${fonts.display}`,
      fill: colors.ink,
      stroke: colors.parchmentLight,
      lineWidth: 4,
      roundJoin: true,
    };
    const minor = {
      font: `italic 600 ${minorPx}px ${fonts.serif}`,
      fill: colors.inkSoft,
      stroke: colors.parchmentLight,
      lineWidth: 3.5,
      roundJoin: true,
    };
    for (const room of floor.rooms) {
      if (room.rank === 'minor' && s < MINOR_LABEL_SCALE) continue;
      const p = at(room.x, room.z);
      // A name that would sit under the frame band is left off (it reappears as
      // the view brings its room in).
      const edge = Math.max(7, side * FRAME_BAND) + 10;
      if (p.sx < -80 || p.sx > side + 80 || p.sy < edge || p.sy > side - edge) continue;
      this.labels.draw(
        ctx,
        t(room.labelKey as never),
        p.sx,
        p.sy,
        room.rank === 'major' ? major : minor,
      );
    }
    // Boss medallions (and their names, zoomed in).
    const bossR = raidAtlasBossRadius(side, view.zoom);
    const bossName = {
      font: `600 ${Math.round((small ? 9.5 : 11) * grow)}px ${fonts.serif}`,
      fill: colors.boss,
      stroke: colors.parchmentLight,
      lineWidth: 3.5,
      roundJoin: true,
    };
    for (const mark of frame.bosses) {
      if (mark.boss.floor !== floor.id) continue;
      const p = at(mark.boss.x, mark.boss.z);
      const [lead, partner] = raidAtlasBossFaces(mark.boss);
      drawBossPortraitMedallion(
        ctx,
        colors,
        p.sx,
        p.sy,
        bossR,
        mark.state,
        input.faces.face(lead),
        partner === undefined ? undefined : input.faces.face(partner),
      );
      if (s >= BOSS_NAME_SCALE) {
        const style = mark.state === 'dead' ? { ...bossName, fill: colors.dead } : bossName;
        this.labels.draw(
          ctx,
          input.bossName(mark.boss.mobId),
          p.sx,
          p.sy + bossR + bossName.lineWidth + 9,
          style,
        );
      }
    }
    // The player's pins.
    for (const pin of input.pins) {
      if (pin.floor !== floor.id) continue;
      const p = at(pin.x, pin.z);
      drawPin(
        ctx,
        colors,
        p.sx,
        p.sy,
        PIN_PX * unit,
        pin.icon,
        pin.color,
        pin.id === input.selectedPin,
      );
    }
    // The group's shared marks, over the pins: they are the raid's call.
    for (const mark of input.sharedMarks) {
      if (mark.floor !== floor.id) continue;
      const p = at(mark.x, mark.z);
      drawSharedMark(ctx, colors, p.sx, p.sy, RAID_ATLAS_SHARED_MARK_PX * unit, mark.symbol);
    }
  }

  private paintFrame(
    input: RaidAtlasPaintInput,
    colors: RaidAtlasColors,
    fonts: RaidAtlasFonts,
  ): Layer | null {
    this.frameLayer ??= makeLayer();
    const layer = this.frameLayer;
    if (!layer) return null;
    const { side, dpr } = input;
    const span = pageSpan(input.floor.bounds);
    const s = viewScale(input.view, span, side);
    const bar = scaleBarYards(s, side);
    const key = [side, dpr, input.title, input.subtitle, bar].join('|');
    if (layer.key === key) return layer;
    layer.key = key;
    const W = Math.round(side * dpr);
    sizeLayer(layer, W, W);
    const ctx = layer.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, W);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const band = Math.max(7, side * FRAME_BAND);
    drawFrame(ctx, colors, side, band);
    const small = side < 420;
    // A touch-sized face has no room for the cartouche, the rose or the scale
    // bar: the chrome's own controls fill its edges (the minimap names the raid).
    if (small) return layer;
    drawCartouche(
      ctx,
      colors,
      side,
      band + 6,
      input.title,
      input.subtitle,
      `600 ${small ? 13 : 17}px ${fonts.display}`,
      `italic ${small ? 10 : 12}px ${fonts.serif}`,
    );
    const roseR = small ? 18 : 30;
    drawCompassRose(
      ctx,
      colors,
      band + roseR + 10,
      side - band - roseR - 10,
      roseR,
      t('hudChrome.raidAtlas.north'),
      `700 ${small ? 10 : 13}px ${fonts.display}`,
    );
    // The scale bar.
    // The scale bar stands over the compass rose, clear of the tool row.
    const len = bar * s;
    const x0 = band + 14;
    const y0 = side - band - roseR * 2 - 44;
    ctx.save();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = colors.ink;
    ctx.fillStyle = colors.ink;
    for (let i = 0; i < 4; i++) {
      const seg = len / 4;
      ctx.globalAlpha = i % 2 === 0 ? 0.85 : 0.2;
      ctx.fillRect(x0 + seg * i, y0 - 4, seg, 4);
    }
    ctx.globalAlpha = 0.9;
    ctx.strokeRect(x0, y0 - 4, len, 4);
    ctx.font = `italic ${small ? 9 : 11}px ${fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = colors.parchmentLight;
    const label = t('hudChrome.raidAtlas.scale', { yards: formatNumber(bar) });
    ctx.strokeText(label, x0, y0 - 7);
    ctx.fillText(label, x0, y0 - 7);
    ctx.restore();
    return layer;
  }

  /** Paint one frame of the atlas onto `ctx` (its canvas `side * dpr` px). */
  paint(ctx: CanvasRenderingContext2D, input: RaidAtlasPaintInput): void {
    const { colors, fonts } = this.palette();
    if (!colors.ink) return;
    const page = this.paintPage(input, colors, fonts);
    const frameLayer = this.paintFrame(input, colors, fonts);
    const W = Math.round(input.side * input.dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    if (page) ctx.drawImage(page.canvas, 0, 0, W, W);
    ctx.setTransform(input.dpr, 0, 0, input.dpr, 0, 0);
    this.paintLive(ctx, input, colors);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (frameLayer) ctx.drawImage(frameLayer.canvas, 0, 0, W, W);
  }

  private paintLive(
    ctx: CanvasRenderingContext2D,
    input: RaidAtlasPaintInput,
    colors: RaidAtlasColors,
  ): void {
    const { floor, view, side, frame } = input;
    const span = pageSpan(floor.bounds);
    const at = (x: number, z: number) => {
      const p = toPage(floor.bounds, x, z);
      return pageToScreen(view, span, side, p.u, p.v);
    };
    const unit = side < 420 ? 0.85 : 1;
    const phase = (input.clock * 0.8) % 1;
    const bossR = raidAtlasBossRadius(side, view.zoom);
    for (const mark of frame.bosses) {
      if (mark.boss.floor !== floor.id) continue;
      if (mark.state !== 'engaged' && mark.boss.id !== input.hoverBoss) continue;
      const p = at(mark.boss.x, mark.boss.z);
      if (mark.boss.id === input.hoverBoss) drawBossHoverHalo(ctx, colors, p.sx, p.sy, bossR);
      if (mark.state === 'engaged') drawEngagedPulse(ctx, colors, p.sx, p.sy, bossR, phase);
    }
    for (const m of frame.members) {
      if (raidAtlasFloorOf(m.x, m.z) !== floor.id) continue;
      const p = at(m.x, m.z);
      drawMember(ctx, colors, p.sx, p.sy, MEMBER_PX * unit, input.classColor(m.cls), m.dead);
    }
    if (frame.player && frame.playerFloor === floor.id) {
      const p = at(frame.player.x, frame.player.z);
      const grow = Math.min(1.3, 1 + (view.zoom - 1) * 0.07);
      drawPlayerArrow(
        ctx,
        colors,
        p.sx,
        p.sy,
        arrowScreenAngle(frame.player.facing),
        ARROW_PX * unit * grow,
      );
    }
  }
}

/** The scale bar's length in yards: a round number about a fifth of the view. */
export function scaleBarYards(pxPerYard: number, side: number): number {
  const target = (side * 0.18) / Math.max(1e-6, pxPerYard);
  for (const n of [5, 10, 20, 25, 50, 100, 200]) if (n >= target) return n;
  return 200;
}
