// Canvas-2D painter for the Gravemarch battleground minimap + world-map
// schematic (cloned from delve_map_painter.ts, the delve-map precedent).
//
// The imperative half of the pure-core + painter split: the pure geometry
// lives in battleground_map_view.ts; this module turns that model into actual
// canvas draws for the two surfaces (the ~10Hz circular minimap and the
// world-map window), which share their structure but differ in size, pad,
// circular clip, marker sizes, and where the area label goes.
//
// WRITE-ELISION BOUNDARY: the schematic itself is Canvas-2D and a 2D context
// cannot be elided, so the canvas draws are NOT routed through the
// write-elision facet. The ONLY DOM write the painter makes is the minimap
// '#zone-label' text ("The Gravemarch"), which IS routed through the facet's
// setText. The world map paints its title onto the canvas instead.
//
// NO-MAGIC-VALUES: a 2D context cannot read CSS vars, so the painter resolves
// the --color-bg-* / --color-delve-* / --color-map-* tokens via
// getComputedStyle ONCE per redraw (cached for the frame, never per-marker);
// every other literal (pad, radius, marker size, line width, font) is a named
// constant.

import type { IWorld } from '../world_api';
import {
  type BgMapModel,
  type BgMapStatic,
  bgMapModel,
  bgMapStatic,
} from './battleground_map_view';
import { t } from './i18n';
import type { PainterHostWriters } from './painter_host';

// Minimap surface: the fixed circular minimap.
const MINIMAP_PAD = 8;
const MINIMAP_CLIP_INSET = 2; // clip radius = size / 2 - inset
const MINIMAP_STRUCT_R = 3.5;
const MINIMAP_ALLY_R = 3;
const MINIMAP_KNELL_R = 3;
const MINIMAP_ARROW_SIZE_RATIO = 0.045; // of canvas size, floor 5px
const MINIMAP_ROAD_WIDTH = 2;
const MINIMAP_WALL_WIDTH = 1.5;

// World-map surface: the dynamically-sized rectangular map canvas.
const WORLD_MAP_PAD_RATIO = 0.06;
const WORLD_MAP_STRUCT_R = 6;
const WORLD_MAP_ALLY_R = 5;
const WORLD_MAP_KNELL_R = 5;
const WORLD_MAP_ROAD_WIDTH = 4;
const WORLD_MAP_WALL_WIDTH = 2.5;
const WORLD_MAP_TITLE_FONT = 'bold 14px Georgia';
const WORLD_MAP_TITLE_TOP = 6; // px from the canvas top
const WORLD_MAP_TITLE_OUTLINE_WIDTH = 3;

// Shared stroke details.
const FIELD_OUTLINE_WIDTH = 1.5;
const CHAPEL_RING_WIDTH = 1.5;
const STRUCT_OUTLINE_WIDTH = 1.5;
const DEAD_STRUCT_STROKE_WIDTH = 1.5;
const ARROW_HALF_WIDTH_RATIO = 0.6;
const ARROW_BASE_RATIO = 0.8;
const ARROW_OUTLINE_WIDTH = 1.5;
const MIN_ARROW_SIZE = 5;

// The design tokens the painter resolves once per redraw (tokens.css). The
// delve label/outline and the overworld ally-friend green are reused where the
// concept matches; only the team + field colors are battleground-specific.
const BG_COLOR_TOKENS = {
  teamA: '--color-bg-team-a',
  teamB: '--color-bg-team-b',
  ground: '--color-bg-map-ground',
  road: '--color-bg-map-road',
  wall: '--color-bg-map-wall',
  chapel: '--color-bg-map-chapel',
  knell: '--color-bg-map-knell',
  ally: '--color-map-ally-friend',
  label: '--color-delve-label',
  outline: '--color-delve-outline',
  player: '--color-map-player',
} as const;

type BgColors = Record<keyof typeof BG_COLOR_TOKENS, string>;

/**
 * Owns painting the battleground schematic onto the minimap and world-map
 * canvases. One instance is built by Hud with the write-elision facet (for the
 * '#zone-label' text); it caches the static background per surface, keyed by
 * canvas size (the layout is constant).
 */
export class BattlegroundMapPainter {
  private minimapBg: HTMLCanvasElement | null = null;
  private minimapBgSig = '';
  private worldMapBg: HTMLCanvasElement | null = null;
  private worldMapBgSig = '';

  constructor(private readonly writers: PainterHostWriters) {}

  /** Read the color tokens in one getComputedStyle pass (never per-marker). */
  private resolveColors(): BgColors {
    const cs = getComputedStyle(document.documentElement);
    const read = (token: string): string => cs.getPropertyValue(token).trim();
    const out = {} as BgColors;
    for (const key of Object.keys(BG_COLOR_TOKENS) as (keyof typeof BG_COLOR_TOKENS)[]) {
      out[key] = read(BG_COLOR_TOKENS[key]);
    }
    return out;
  }

  /** Render the static field (ground, roads, walls, chapel) to an offscreen
   *  canvas. Road/wall stroke widths come from the surface (minimap vs map). */
  private buildStaticBg(
    statics: BgMapStatic,
    size: number,
    colors: BgColors,
    roadWidth: number,
    wallWidth: number,
  ): HTMLCanvasElement {
    const bg = document.createElement('canvas');
    bg.width = size;
    bg.height = size;
    const ctx = bg.getContext('2d');
    if (!ctx) return bg;
    // Field footprint.
    ctx.fillStyle = colors.ground;
    ctx.fillRect(statics.field.x, statics.field.y, statics.field.w, statics.field.h);
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = FIELD_OUTLINE_WIDTH;
    ctx.strokeRect(statics.field.x, statics.field.y, statics.field.w, statics.field.h);
    // The two roads.
    ctx.strokeStyle = colors.road;
    ctx.lineWidth = roadWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const road of statics.roads) {
      if (!road.length) continue;
      ctx.beginPath();
      ctx.moveTo(road[0].cx, road[0].cy);
      for (let i = 1; i < road.length; i++) ctx.lineTo(road[i].cx, road[i].cy);
      ctx.stroke();
    }
    // Base walls.
    ctx.strokeStyle = colors.wall;
    ctx.lineWidth = wallWidth;
    for (const w of statics.walls) {
      ctx.beginPath();
      ctx.moveTo(w.x1, w.y1);
      ctx.lineTo(w.x2, w.y2);
      ctx.stroke();
    }
    // The center bell-chapel ring.
    ctx.strokeStyle = colors.chapel;
    ctx.lineWidth = CHAPEL_RING_WIDTH;
    ctx.beginPath();
    ctx.arc(statics.chapel.cx, statics.chapel.cy, statics.chapel.r, 0, Math.PI * 2);
    ctx.stroke();
    return bg;
  }

  /** Team structures: filled while alive, hollow once destroyed. Warstones are
   *  diamonds, Bulwarks squares, so the two read apart without color. */
  private drawStructures(
    ctx: CanvasRenderingContext2D,
    model: BgMapModel,
    r: number,
    colors: BgColors,
  ): void {
    for (const s of model.structures) {
      const color = s.team === 'A' ? colors.teamA : colors.teamB;
      ctx.beginPath();
      if (s.kind === 'warstone') {
        ctx.moveTo(s.cx, s.cy - r * 1.3);
        ctx.lineTo(s.cx + r, s.cy);
        ctx.lineTo(s.cx, s.cy + r * 1.3);
        ctx.lineTo(s.cx - r, s.cy);
        ctx.closePath();
      } else {
        ctx.rect(s.cx - r, s.cy - r, r * 2, r * 2);
      }
      if (s.alive) {
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = colors.outline;
        ctx.lineWidth = STRUCT_OUTLINE_WIDTH;
        ctx.stroke();
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = DEAD_STRUCT_STROKE_WIDTH;
        ctx.stroke();
      }
    }
  }

  private drawAllies(
    ctx: CanvasRenderingContext2D,
    model: BgMapModel,
    r: number,
    colors: BgColors,
  ): void {
    ctx.fillStyle = colors.ally;
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = STRUCT_OUTLINE_WIDTH;
    for (const a of model.allies) {
      ctx.beginPath();
      ctx.arc(a.cx, a.cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawKnell(
    ctx: CanvasRenderingContext2D,
    model: BgMapModel,
    r: number,
    colors: BgColors,
  ): void {
    const k = model.knell;
    if (!k) return;
    ctx.beginPath();
    ctx.arc(k.cx, k.cy, r, 0, Math.PI * 2);
    if (k.alive) {
      ctx.fillStyle = colors.knell;
      ctx.fill();
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = STRUCT_OUTLINE_WIDTH;
      ctx.stroke();
    } else {
      ctx.strokeStyle = colors.knell;
      ctx.lineWidth = DEAD_STRUCT_STROKE_WIDTH;
      ctx.stroke();
    }
  }

  private drawPlayerArrow(
    ctx: CanvasRenderingContext2D,
    model: BgMapModel,
    size: number,
    colors: BgColors,
  ): void {
    const arrowSize = Math.max(MIN_ARROW_SIZE, size * MINIMAP_ARROW_SIZE_RATIO);
    ctx.save();
    ctx.translate(model.player.cx, model.player.cy);
    ctx.rotate(model.player.angle);
    ctx.fillStyle = colors.player;
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = ARROW_OUTLINE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(0, -arrowSize);
    ctx.lineTo(arrowSize * ARROW_HALF_WIDTH_RATIO, arrowSize * ARROW_BASE_RATIO);
    ctx.lineTo(-arrowSize * ARROW_HALF_WIDTH_RATIO, arrowSize * ARROW_BASE_RATIO);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Minimap battleground render: schematic + live overlay in the circular
   *  minimap; the '#zone-label' text goes through the write-elision facet. */
  paintMinimap(
    ctx: CanvasRenderingContext2D,
    world: IWorld,
    zoneLabelEl: HTMLElement,
    size: number,
  ): void {
    const colors = this.resolveColors();
    const statics = bgMapStatic(size, MINIMAP_PAD);
    const model = bgMapModel(world, statics, size, MINIMAP_PAD);
    if (!model) return;
    // The one DOM write, routed through the write-elision facet.
    this.writers.setText(zoneLabelEl, t('hudChrome.bg.zoneName'));

    if (!this.minimapBg || this.minimapBgSig !== statics.sizeSig) {
      this.minimapBg = this.buildStaticBg(
        statics,
        size,
        colors,
        MINIMAP_ROAD_WIDTH,
        MINIMAP_WALL_WIDTH,
      );
      this.minimapBgSig = statics.sizeSig;
    }

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - MINIMAP_CLIP_INSET, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.minimapBg, 0, 0);
    this.drawStructures(ctx, model, MINIMAP_STRUCT_R, colors);
    this.drawAllies(ctx, model, MINIMAP_ALLY_R, colors);
    this.drawKnell(ctx, model, MINIMAP_KNELL_R, colors);
    this.drawPlayerArrow(ctx, model, size, colors);
    ctx.restore();
  }

  /** World-map battleground render: the same schematic + overlay in the map
   *  window, with the area title drawn ON the canvas (no DOM zone label). */
  paintWorldMap(ctx: CanvasRenderingContext2D, world: IWorld, size: number): void {
    const colors = this.resolveColors();
    const pad = Math.round(size * WORLD_MAP_PAD_RATIO);
    const statics = bgMapStatic(size, pad);
    const model = bgMapModel(world, statics, size, pad);
    if (!model) return;

    if (!this.worldMapBg || this.worldMapBgSig !== statics.sizeSig) {
      this.worldMapBg = this.buildStaticBg(
        statics,
        size,
        colors,
        WORLD_MAP_ROAD_WIDTH,
        WORLD_MAP_WALL_WIDTH,
      );
      this.worldMapBgSig = statics.sizeSig;
    }

    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.worldMapBg, 0, 0);
    this.drawStructures(ctx, model, WORLD_MAP_STRUCT_R, colors);
    this.drawAllies(ctx, model, WORLD_MAP_ALLY_R, colors);
    this.drawKnell(ctx, model, WORLD_MAP_KNELL_R, colors);
    this.drawPlayerArrow(ctx, model, size, colors);

    ctx.font = WORLD_MAP_TITLE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = WORLD_MAP_TITLE_OUTLINE_WIDTH;
    ctx.fillStyle = colors.label;
    const label = t('hudChrome.bg.zoneName');
    ctx.strokeText(label, size / 2, WORLD_MAP_TITLE_TOP);
    ctx.fillText(label, size / 2, WORLD_MAP_TITLE_TOP);
    ctx.textBaseline = 'alphabetic';
  }
}
