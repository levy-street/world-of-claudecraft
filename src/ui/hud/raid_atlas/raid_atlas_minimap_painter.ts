// The raid atlas drawn on the round minimap: the same illustrated page the
// M-map shows, cropped round the player at the minimap's own zoom, with the
// atlas's glyphs at minimap size (the gilded arrow, the boss medallions, the
// raid's class jewels, the portals, the player's pins) and the live marks the
// plain dungeon minimap always carried (hostile mobs, aggro, loot, shut gates),
// so swapping the art never hides anything a player acts on.
//
// Cost: the page is never re-rendered per paint. A paint blits the floor's
// prewarmed whole-page plate (raid_atlas_painter.ts owns it); once the view
// settles at a zoom the plate is too coarse for, ONE detail tile a few minimap
// diameters wide is rendered at device density and blitted until the player
// walks off it or the zoom changes (raid_atlas_minimap_core.ts decides). The
// rim shading is a layer cached per size. Text goes through the shared sprite
// cache, so steady paints never call a canvas text API. The caller skips the
// paint entirely while nothing changed (raidAtlasMinimapKey).

import type { DungeonMapMarker } from '../../dungeon_map_view';
import { t } from '../../i18n';
import { TextSpriteCache } from '../../text_sprite_cache';
import { pageSpan, toPage } from './raid_atlas_camera_core';
import {
  drawBossMedallion,
  drawEngagedPulse,
  drawMember,
  drawPin,
  drawPlayerArrow,
  drawPoi,
} from './raid_atlas_glyph_painter';
import {
  minimapBlit,
  minimapDetailTile,
  minimapRoomLabels,
  minimapScreen,
  minimapWantsDetail,
  type RaidAtlasRaster,
  rasterCovers,
  tileMatchesScale,
} from './raid_atlas_minimap_core';
import { paintRaidAtlasPage } from './raid_atlas_page_painter';
import { arrowScreenAngle } from './raid_atlas_painter';
import type { RaidAtlasColors, RaidAtlasFonts } from './raid_atlas_palette_core';
import type { RaidAtlasPin } from './raid_atlas_pins_core';
import { type RaidAtlasFloor, type RaidAtlasPlan, raidAtlasFloorAt } from './raid_atlas_plan_core';
import type { RaidAtlasFrame } from './raid_atlas_view';

const TAU = Math.PI * 2;
/** The disc's clip inset (the dungeon minimap's). */
const CLIP_INSET = 2;
/** Marks past this inset from the rim are left off (the ring covers them). */
const MARK_RIM_INSET = 5;
const ARROW_PX = 23;
const BOSS_R = 7;
/** A boss body within this many medallion radii of it reads as the medallion. */
const MEDALLION_COVER = 1.6;
const POI_R = 5;
const MEMBER_R = 3.4;
const PIN_PX = 13;
const MOB_R = 3.4;
const MOB_AGGRO_R = 4.2;
const MOB_BOSS_R = 5;
const LOOT_R = 3.6;
const GATE_HALF = 2.6;
const LABEL_PX = 9.5;
/** The rim's burnt shade: where it starts (share of the radius) and its depth. */
const SHADE_FROM = 0.62;
const SHADE_ALPHA = 0.9;

/** Everything one minimap paint needs. */
export interface RaidAtlasMinimapInput {
  plan: RaidAtlasPlan;
  floor: RaidAtlasFloor;
  frame: RaidAtlasFrame;
  /** The dungeon minimap's live marks, already in minimap px. */
  marks: readonly DungeonMapMarker[];
  pins: readonly RaidAtlasPin[];
  /** The player, instance-local (the view's centre). */
  lx: number;
  lz: number;
  /** CSS px of the square minimap, its zoom preset, its scale and backing density. */
  size: number;
  zoom: number;
  pxPerYard: number;
  dpr: number;
  /** The player stood still a moment: a detail tile may be rendered now. */
  settled: boolean;
  plate: HTMLCanvasElement | null;
  colors: RaidAtlasColors;
  fonts: RaidAtlasFonts;
  classColor(cls: string): string;
  /** Seconds, the frame clock (the engaged pulse). */
  clock: number;
}

interface Tile {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  raster: RaidAtlasRaster;
  floor: string;
}

export class RaidAtlasMinimapPainter {
  private tile: Tile | null = null;
  private shade: HTMLCanvasElement | null = null;
  private shadeKey = '';
  private readonly labels = new TextSpriteCache(32);

  /** Paint the atlas minimap onto `ctx` (CSS-px transform, `size` square). */
  paint(ctx: CanvasRenderingContext2D, input: RaidAtlasMinimapInput): void {
    const { floor, size, colors: c } = input;
    const half = size / 2;
    const { u, v } = toPage(floor.bounds, input.lx, input.lz);
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(half, half, half - CLIP_INSET, 0, TAU);
    ctx.clip();
    ctx.fillStyle = c.parchment;
    ctx.fillRect(0, 0, size, size);
    this.paintGround(ctx, input, u, v);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = SHADE_ALPHA;
    ctx.drawImage(this.shadeLayer(input), 0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    this.paintRimLines(ctx, size, c);
    this.paintMarks(ctx, input, u, v);
    ctx.restore();
  }

  /** The page under the view: the sharp tile when it holds the view, else
   *  the plate (rendering a tile first when the view has settled). */
  private paintGround(
    ctx: CanvasRenderingContext2D,
    input: RaidAtlasMinimapInput,
    u: number,
    v: number,
  ): void {
    const { floor, size, pxPerYard, dpr, plate } = input;
    const plateK = plate ? plate.width / pageSpan(floor.bounds) : 0;
    const detail = !plate || minimapWantsDetail(pxPerYard, dpr, plateK);
    if (detail) {
      if (!this.tileHolds(floor.id, u, v, size, pxPerYard, dpr) && (input.settled || !plate)) {
        this.renderTile(input, u, v);
      }
      const tile = this.tile;
      if (tile && this.tileHolds(floor.id, u, v, size, pxPerYard, dpr)) {
        blit(ctx, tile.canvas, tile.raster, u, v, size, pxPerYard);
        return;
      }
    }
    if (plate) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const raster = { k: plateK, offU: 0, offV: 0, w: plate.width, h: plate.height };
      blit(ctx, plate, raster, u, v, size, pxPerYard);
    }
  }

  private tileHolds(
    floor: string,
    u: number,
    v: number,
    size: number,
    pxPerYard: number,
    dpr: number,
  ): boolean {
    const tile = this.tile;
    return (
      tile !== null &&
      tile.floor === floor &&
      tileMatchesScale(tile.raster, pxPerYard, dpr) &&
      rasterCovers(tile.raster, u, v, size, pxPerYard)
    );
  }

  private renderTile(input: RaidAtlasMinimapInput, u: number, v: number): void {
    const raster = minimapDetailTile(u, v, input.size, input.pxPerYard, input.dpr);
    if (!this.tile) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      this.tile = { canvas, ctx, raster, floor: input.floor.id };
    }
    const tile = this.tile;
    if (tile.canvas.width !== raster.w) tile.canvas.width = raster.w;
    if (tile.canvas.height !== raster.h) tile.canvas.height = raster.h;
    tile.raster = raster;
    tile.floor = input.floor.id;
    tile.ctx.setTransform(1, 0, 0, 1, 0, 0);
    paintRaidAtlasPage(
      tile.ctx,
      input.plan,
      input.floor,
      input.colors,
      { k: raster.k, offU: raster.offU, offV: raster.offV },
      raster.w,
      raster.h,
    );
  }

  /** The rim's burnt shade, cached per size: an opaque warm-white to umber
   *  ramp the paint multiplies over the page, so the edge tints like scorched
   *  parchment rather than greying under a veil. */
  private shadeLayer(input: RaidAtlasMinimapInput): HTMLCanvasElement {
    const { size, dpr, colors: c } = input;
    const key = `${size}|${dpr}|${c.goldWhite}|${c.stain}`;
    if (this.shade && this.shadeKey === key) return this.shade;
    const canvas = this.shade ?? document.createElement('canvas');
    this.shade = canvas;
    this.shadeKey = key;
    const W = Math.round(size * dpr);
    canvas.width = W;
    canvas.height = W;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const half = size / 2;
    const r = half - CLIP_INSET;
    const g = ctx.createRadialGradient(half, half, 0, half, half, r);
    g.addColorStop(0, c.goldWhite);
    g.addColorStop(SHADE_FROM, c.goldWhite);
    g.addColorStop(0.88, c.parchmentDark);
    g.addColorStop(1, c.stain);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return canvas;
  }

  /** A hair of dark ink just inside the gilded ring, and a gold glint inside it. */
  private paintRimLines(ctx: CanvasRenderingContext2D, size: number, c: RaidAtlasColors): void {
    const half = size / 2;
    const r = half - CLIP_INSET;
    ctx.beginPath();
    ctx.arc(half, half, r - 0.75, 0, TAU);
    ctx.strokeStyle = c.frameDark;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(half, half, r - 2.3, 0, TAU);
    ctx.strokeStyle = c.goldLight;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Is minimap point (sx, sy) on one of this page's boss medallions? */
  private onMedallion(
    input: RaidAtlasMinimapInput,
    sx: number,
    sy: number,
    at: (x: number, z: number) => { sx: number; sy: number },
  ): boolean {
    for (const mark of input.frame.bosses) {
      if (mark.boss.floor !== input.floor.id) continue;
      const p = at(mark.boss.x, mark.boss.z);
      if (Math.hypot(p.sx - sx, p.sy - sy) <= BOSS_R * MEDALLION_COVER) return true;
    }
    return false;
  }

  private paintMarks(
    ctx: CanvasRenderingContext2D,
    input: RaidAtlasMinimapInput,
    u: number,
    v: number,
  ): void {
    const { plan, floor, frame, size, pxPerYard, colors: c } = input;
    const half = size / 2;
    const reach = half - MARK_RIM_INSET;
    const at = (x: number, z: number) => {
      const p = toPage(floor.bounds, x, z);
      return minimapScreen(p.u, p.v, u, v, size, pxPerYard);
    };
    const inside = (sx: number, sy: number, pad: number) =>
      (sx - half) * (sx - half) + (sy - half) * (sy - half) <= (reach + pad) * (reach + pad);

    // Room names, close in only (they would crowd the marks further out).
    if (minimapRoomLabels(input.zoom) === 'major') {
      this.labels.setPixelRatio(input.dpr);
      this.labels.beginRedraw();
      const style = {
        font: `600 ${LABEL_PX}px ${input.fonts.display}`,
        fill: c.ink,
        stroke: c.parchmentLight,
        lineWidth: 3,
        roundJoin: true,
      };
      for (const room of floor.rooms) {
        if (room.rank !== 'major') continue;
        const p = at(room.x, room.z);
        if (!inside(p.sx, p.sy, -18)) continue;
        this.labels.draw(ctx, t(room.labelKey as never), p.sx, p.sy, style);
      }
    }

    // Portals and the entrance (the Heart's exit only once it stands open).
    const finalDown = frame.bosses.some((b) => b.boss.id === 'final' && b.state === 'dead');
    for (const poi of plan.pois) {
      if (poi.floor !== floor.id || (poi.kind === 'exit' && !finalDown)) continue;
      const p = at(poi.x, poi.z);
      if (inside(p.sx, p.sy, POI_R)) drawPoi(ctx, c, poi.kind, p.sx, p.sy, POI_R);
    }

    // Boss medallions: standing, fighting (with its pulse) or defeated.
    const phase = (input.clock * 0.8) % 1;
    for (const mark of frame.bosses) {
      if (mark.boss.floor !== floor.id) continue;
      const p = at(mark.boss.x, mark.boss.z);
      if (!inside(p.sx, p.sy, BOSS_R)) continue;
      if (mark.state === 'engaged') drawEngagedPulse(ctx, c, p.sx, p.sy, BOSS_R, phase);
      drawBossMedallion(ctx, c, p.sx, p.sy, BOSS_R, mark.state);
    }

    // The live marks the dungeon minimap always showed. A boss's own body
    // standing on its medallion is the medallion; once it moves off (a pull,
    // a knock) its mark shows where it really is.
    for (const m of input.marks) {
      if (!inside(m.cx, m.cy, 0)) continue;
      if (m.kind === 'mob') {
        if (m.boss && this.onMedallion(input, m.cx, m.cy, at)) continue;
        drawMob(ctx, c, m.cx, m.cy, m.boss ? MOB_BOSS_R : m.aggro ? MOB_AGGRO_R : MOB_R, m.aggro);
      } else if (m.kind === 'loot') {
        drawLoot(ctx, c, m.cx, m.cy, LOOT_R);
      } else if (m.kind === 'gate') {
        drawGate(ctx, c, m.cx, m.cy, GATE_HALF);
      }
    }

    // The player's pins.
    for (const pin of input.pins) {
      if (pin.floor !== floor.id) continue;
      const p = at(pin.x, pin.z);
      if (inside(p.sx, p.sy, PIN_PX * 0.5)) {
        drawPin(ctx, c, p.sx, p.sy, PIN_PX, pin.icon, pin.color, false);
      }
    }

    // The raid in class colours.
    for (const m of frame.members) {
      if (raidAtlasFloorAt(m.x, m.z) !== floor.id) continue;
      const p = at(m.x, m.z);
      if (inside(p.sx, p.sy, 0)) {
        drawMember(ctx, c, p.sx, p.sy, MEMBER_R, input.classColor(m.cls), m.dead);
      }
    }

    // The gilded arrow, always at the centre, on a soft pool of shade so the
    // gold stands off the parchment.
    if (frame.player) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(half, half, ARROW_PX * 0.42, 0, TAU);
      ctx.fillStyle = c.frameDark;
      ctx.shadowColor = c.frameDark;
      ctx.shadowBlur = ARROW_PX * 0.45;
      ctx.globalAlpha = 0.22;
      ctx.fill();
      ctx.restore();
      drawPlayerArrow(ctx, c, half, half, arrowScreenAngle(frame.player.facing), ARROW_PX);
    }
  }
}

function blit(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  raster: RaidAtlasRaster,
  u: number,
  v: number,
  size: number,
  pxPerYard: number,
): void {
  const b = minimapBlit(raster, u, v, size, pxPerYard);
  if (b) ctx.drawImage(source, b.sx, b.sy, b.sw, b.sh, b.dx, b.dy, b.dw, b.dh);
}

/** A hostile mob: a red inked diamond (one on you is larger, burns orange and
 *  wears a bright ring: silhouette, not hue alone). */
function drawMob(
  ctx: CanvasRenderingContext2D,
  c: RaidAtlasColors,
  x: number,
  y: number,
  r: number,
  aggro: boolean,
): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fillStyle = aggro ? c.bossEngaged : c.pinRed;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = c.frameDark;
  ctx.stroke();
  if (aggro) {
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = c.goldWhite;
    ctx.stroke();
  }
}

/** Lootable: a four-point gold spark. */
function drawLoot(
  ctx: CanvasRenderingContext2D,
  c: RaidAtlasColors,
  x: number,
  y: number,
  r: number,
): void {
  const s = r * 0.32;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + s, y - s);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x + s, y + s);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - s, y + s);
  ctx.lineTo(x - r, y);
  ctx.lineTo(x - s, y - s);
  ctx.closePath();
  ctx.fillStyle = c.goldLight;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = c.frameDark;
  ctx.stroke();
}

/** A shut gate: a dark bar with a gold keyline. */
function drawGate(
  ctx: CanvasRenderingContext2D,
  c: RaidAtlasColors,
  x: number,
  y: number,
  h: number,
): void {
  ctx.fillStyle = c.frameDark;
  ctx.fillRect(x - h, y - h, h * 2, h * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = c.gold;
  ctx.strokeRect(x - h, y - h, h * 2, h * 2);
}
