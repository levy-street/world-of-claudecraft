// Canvas-2D painter for the delve minimap + world-map schematic.
//
// The imperative half of the pure-core + painter split: the pure geometry lives in
// delve_map.ts (delveSchematicStatic / delveSchematicPlayer / delveLocalToCanvas /
// delveAreaLabel, all unit-tested there); this module turns that data into actual
// canvas draws and dedupes the two formerly-inline delve render sites in hud.ts
// (the ~10Hz circular minimap and the world-map window), which shared their
// structure but differed in size, pad, circular clip, marker sizes, line widths,
// and where the area label goes.
//
// WRITE-ELISION BOUNDARY: the schematic itself is Canvas-2D
// and a 2D context cannot be elided, so the painter's canvas draws are NOT routed
// through the write-elision facet. The ONLY DOM write the painter makes is the
// minimap '#zone-label' text, which IS routed through the facet's setText. The
// world map paints its title onto the canvas instead, so it makes no DOM write.
//
// NO-MAGIC-VALUES: a 2D context cannot read CSS vars, so the
// painter resolves the `--color-delve-*` tokens via getComputedStyle ONCE per
// redraw (cached for the frame, never per-marker); every other literal (pad,
// radius, marker size, line width, font) is a named constant.

import { DELVE_MODULE_LAYOUTS, type DelveModuleId } from '../sim/delve_layout';
import type { DelveRunInfo, IWorld } from '../world_api';
import {
  delveAreaLabel,
  delveLocalToCanvas,
  delveSchematicPlayer,
  delveSchematicStatic,
  playerDelveLocal,
  type SchematicArrow,
  type SchematicPrimitive,
} from './delve_map';
import { tEntity } from './entity_i18n';
import { type TranslationKey, t } from './i18n';
import type { PainterHostWriters } from './painter_host';

// Fallback module id when a run has no module at the current index (matches the
// inline sites' fallback, and the layout lookup below falls back to it too).
const DEFAULT_DELVE_MODULE: DelveModuleId = 'reliquary_sunken_ossuary';

// Default stroke width when a schematic primitive omits one (Canvas default is 1).
const DEFAULT_STROKE_WIDTH = 1;
// The static-schematic 'N' exit glyph keeps a dark outline 2px wide.
const SCHEMATIC_TEXT_OUTLINE_WIDTH = 2;
// Player-arrow triangle proportions (relative to the core's arrow size).
const ARROW_HALF_WIDTH_RATIO = 0.6;
const ARROW_BASE_RATIO = 0.8;

// Minimap surface: a fixed 162px circular minimap.
const MINIMAP_PAD = 8;
const MINIMAP_CLIP_INSET = 2; // clip radius = size / 2 - inset
const MINIMAP_MOB_SIZE = 3; // square marker side, px
const MINIMAP_PARTY_RADIUS = 4;
const MINIMAP_PARTY_OUTLINE_WIDTH = 1.5;
const MINIMAP_ARROW_OUTLINE_WIDTH = 1.5;

// World-map surface: the dynamically-sized rectangular map canvas.
const WORLD_MAP_PAD_RATIO = 0.06;
const WORLD_MAP_MOB_SIZE = 4;
const WORLD_MAP_PARTY_RADIUS = 5;
const WORLD_MAP_PARTY_OUTLINE_WIDTH = 2;
const WORLD_MAP_ARROW_OUTLINE_WIDTH = 2;
const WORLD_MAP_TITLE_FONT = 'bold 14px Georgia';
const WORLD_MAP_TITLE_TOP = 6; // px from the canvas top
const WORLD_MAP_TITLE_OUTLINE_WIDTH = 3;

// The `--color-delve-*` design tokens the painter resolves once per redraw. These
// mirror the colors the two inline delve render sites used verbatim.
const DELVE_COLOR_TOKENS = {
  room: '--color-delve-room',
  mob: '--color-delve-mob',
  mobAggro: '--color-delve-mob-aggro',
  partyDead: '--color-delve-party-dead',
  label: '--color-delve-label',
  outline: '--color-delve-outline',
} as const;

interface DelveColors {
  room: string;
  mob: string;
  mobAggro: string;
  partyDead: string;
  label: string;
  outline: string;
}

/** A hostile mob dot: canvas position + whether it is aggroed on the player. */
export interface DelveMobMarker {
  cx: number;
  cy: number;
  aggro: boolean;
}

/** A party member disc: canvas position + dead flag (a number, like the wire) +
 *  class id (the alive color is resolved from class data at paint time). */
export interface DelvePartyMarker {
  cx: number;
  cy: number;
  dead: number;
  cls: string;
}

/** Everything the painter draws for one delve frame, derived purely from IWorld.
 *  No DOM, no i18n, no color resolution: positions + the static schematic + the
 *  composed area label, so a Vitest can drive it directly and assert parity. */
export interface DelveDrawModel {
  /** Module layout id, the static-background cache key. */
  layoutId: string;
  /** Static room schematic (floor / pillars / tombs / dais / exit + 'N' glyph). */
  schematic: SchematicPrimitive[];
  /** Hostile mob dots inside the canvas bounds. */
  mobs: DelveMobMarker[];
  /** Party member discs inside the canvas bounds (excluding the local player). */
  party: DelvePartyMarker[];
  /** The local player's facing arrow. */
  player: SchematicArrow;
  /** "Delve: Module" label (already localized via the names passed in). */
  areaLabel: string;
}

/**
 * Build the pure draw model from IWorld for one delve surface. Reads only IWorld
 * members (delveRun / entities / player / partyInfo), so the offline Sim and the
 * online ClientWorld mirror produce identical output. The
 * already-localized `delveName` / `moduleName` are passed in (the core stays
 * string-table-free, like delveAreaLabel). Returns null when not in a delve.
 */
export function delveDrawModel(
  world: IWorld,
  canvasSize: number,
  pad: number,
  delveName: string,
  moduleName: string,
  northLabel = 'N',
): DelveDrawModel | null {
  const run = world.delveRun;
  if (!run) return null;
  const p = world.player;
  const modId = run.modules[run.moduleIndex];
  const layoutId = (modId ?? DEFAULT_DELVE_MODULE) as DelveModuleId;
  const layout = DELVE_MODULE_LAYOUTS[layoutId] ?? DELVE_MODULE_LAYOUTS[DEFAULT_DELVE_MODULE];

  const schematic = delveSchematicStatic(layout, canvasSize, pad, northLabel);

  const mobs: DelveMobMarker[] = [];
  for (const e of world.entities.values()) {
    if (e.id === p.id) continue;
    if (e.kind !== 'mob' || e.dead) continue;
    const { cx, cy } = delveLocalToCanvas(
      e.pos.x - run.origin.x,
      e.pos.z - run.origin.z,
      layout,
      canvasSize,
      pad,
    );
    if (cx < 0 || cx > canvasSize || cy < 0 || cy > canvasSize) continue;
    mobs.push({ cx, cy, aggro: e.aggroTargetId === p.id });
  }

  const party: DelvePartyMarker[] = [];
  const partyInfo = world.partyInfo;
  if (partyInfo) {
    for (const m of partyInfo.members) {
      if (m.pid === p.id) continue;
      const { cx, cy } = delveLocalToCanvas(
        m.x - run.origin.x,
        m.z - run.origin.z,
        layout,
        canvasSize,
        pad,
      );
      if (cx < 0 || cx > canvasSize || cy < 0 || cy > canvasSize) continue;
      party.push({ cx, cy, dead: m.dead, cls: m.cls });
    }
  }

  const { localX, localZ } = playerDelveLocal(p.pos.x, p.pos.z, run.origin);
  const player = delveSchematicPlayer(localX, localZ, p.facing, layout, canvasSize, pad);

  return {
    layoutId,
    schematic,
    mobs,
    party,
    player,
    areaLabel: delveAreaLabel(delveName, moduleName),
  };
}

/**
 * Owns painting the delve schematic onto the minimap and world-map canvases. One
 * instance is built by Hud with the write-elision facet (for the '#zone-label'
 * text) and a class-color resolver (for party discs); it caches the static
 * background per surface, keyed by module id.
 */
export class DelveMapPainter {
  // Static-schematic backgrounds, one per surface (they size + pad differently),
  // rebuilt only when the player crosses into a different delve module.
  private minimapBg: HTMLCanvasElement | null = null;
  private minimapBgModuleId = '';
  private worldMapBg: HTMLCanvasElement | null = null;
  private worldMapBgModuleId = '';

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly classColor: (cls: string) => string,
  ) {}

  /** Resolve the player-facing delve + module names (the only i18n the painter
   *  does; the pure model takes them already localized). */
  private resolveNames(run: DelveRunInfo): { delveName: string; moduleName: string } {
    const modId = run.modules[run.moduleIndex];
    return {
      delveName: tEntity({ kind: 'delve', id: run.delveId, field: 'name' }),
      moduleName: modId ? t(`delveUi.moduleName.${modId}` as TranslationKey) : '',
    };
  }

  /** Read the six delve color tokens in one getComputedStyle pass (a 2D context
   *  can only read a CSS var this way; never per-marker). */
  private resolveColors(): DelveColors {
    const cs = getComputedStyle(document.documentElement);
    const read = (token: string): string => cs.getPropertyValue(token).trim();
    return {
      room: read(DELVE_COLOR_TOKENS.room),
      mob: read(DELVE_COLOR_TOKENS.mob),
      mobAggro: read(DELVE_COLOR_TOKENS.mobAggro),
      partyDead: read(DELVE_COLOR_TOKENS.partyDead),
      label: read(DELVE_COLOR_TOKENS.label),
      outline: read(DELVE_COLOR_TOKENS.outline),
    };
  }

  /** The single canvas drawer for the static schematic (absorbed from hud.ts's
   *  private drawSchematicPrimitives). delveSchematicStatic only emits circle /
   *  rect / text primitives; the live player arrow is drawn by drawPlayerArrow. */
  private drawSchematic(
    ctx: CanvasRenderingContext2D,
    prims: SchematicPrimitive[],
    outline: string,
  ): void {
    for (const prim of prims) {
      ctx.save();
      if (prim.kind === 'circle') {
        ctx.beginPath();
        ctx.arc(prim.cx, prim.cy, prim.r, 0, Math.PI * 2);
        ctx.fillStyle = prim.fill;
        ctx.fill();
        if (prim.stroke) {
          ctx.strokeStyle = prim.stroke;
          ctx.lineWidth = prim.strokeWidth ?? DEFAULT_STROKE_WIDTH;
          ctx.stroke();
        }
      } else if (prim.kind === 'rect') {
        ctx.fillStyle = prim.fill;
        ctx.fillRect(prim.x, prim.y, prim.w, prim.h);
        if (prim.stroke) {
          ctx.strokeStyle = prim.stroke;
          ctx.lineWidth = prim.strokeWidth ?? DEFAULT_STROKE_WIDTH;
          ctx.strokeRect(prim.x, prim.y, prim.w, prim.h);
        }
      } else if (prim.kind === 'text') {
        ctx.font = prim.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = prim.fill;
        ctx.strokeStyle = outline;
        ctx.lineWidth = SCHEMATIC_TEXT_OUTLINE_WIDTH;
        ctx.strokeText(prim.text, prim.cx, prim.cy);
        ctx.fillText(prim.text, prim.cx, prim.cy);
      }
      ctx.restore();
    }
  }

  /** Render the static schematic onto an offscreen canvas (cached per surface). */
  private buildSchematicBg(
    prims: SchematicPrimitive[],
    size: number,
    colors: DelveColors,
  ): HTMLCanvasElement {
    const bg = document.createElement('canvas');
    bg.width = size;
    bg.height = size;
    const bgCtx = bg.getContext('2d');
    if (!bgCtx) return bg;
    bgCtx.fillStyle = colors.room;
    bgCtx.fillRect(0, 0, size, size);
    this.drawSchematic(bgCtx, prims, colors.outline);
    return bg;
  }

  private drawMobs(
    ctx: CanvasRenderingContext2D,
    mobs: DelveMobMarker[],
    markerSize: number,
    colors: DelveColors,
  ): void {
    const half = markerSize / 2;
    for (const m of mobs) {
      ctx.fillStyle = m.aggro ? colors.mobAggro : colors.mob;
      ctx.fillRect(m.cx - half, m.cy - half, markerSize, markerSize);
    }
  }

  private drawParty(
    ctx: CanvasRenderingContext2D,
    party: DelvePartyMarker[],
    radius: number,
    outlineWidth: number,
    colors: DelveColors,
  ): void {
    for (const m of party) {
      ctx.fillStyle = m.dead ? colors.partyDead : this.classColor(m.cls);
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = outlineWidth;
      ctx.beginPath();
      ctx.arc(m.cx, m.cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawPlayerArrow(
    ctx: CanvasRenderingContext2D,
    arrow: SchematicArrow,
    outlineWidth: number,
  ): void {
    ctx.save();
    ctx.translate(arrow.cx, arrow.cy);
    ctx.rotate(arrow.angle);
    ctx.fillStyle = arrow.fill;
    ctx.strokeStyle = arrow.stroke;
    ctx.lineWidth = outlineWidth;
    ctx.beginPath();
    ctx.moveTo(0, -arrow.size);
    ctx.lineTo(arrow.size * ARROW_HALF_WIDTH_RATIO, arrow.size * ARROW_BASE_RATIO);
    ctx.lineTo(-arrow.size * ARROW_HALF_WIDTH_RATIO, arrow.size * ARROW_BASE_RATIO);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Minimap delve render: the static schematic plus the live mob / party / arrow
   *  overlay, painted into the circular minimap, with the '#zone-label' text
   *  written through the write-elision facet. Caller passes the minimap ctx, the
   *  world, the '#zone-label' element, and the fixed minimap size. */
  paintMinimapDelve(
    ctx: CanvasRenderingContext2D,
    world: IWorld,
    zoneLabelEl: HTMLElement,
    size: number,
  ): void {
    const run = world.delveRun;
    if (!run) return;
    const { delveName, moduleName } = this.resolveNames(run);
    const model = delveDrawModel(
      world,
      size,
      MINIMAP_PAD,
      delveName,
      moduleName,
      t('hudChrome.compass.N'),
    );
    if (!model) return;
    // The one DOM write this Canvas pilot routes through the write-elision facet.
    this.writers.setText(zoneLabelEl, model.areaLabel);
    const colors = this.resolveColors();

    if (!this.minimapBg || this.minimapBgModuleId !== model.layoutId) {
      this.minimapBg = this.buildSchematicBg(model.schematic, size, colors);
      this.minimapBgModuleId = model.layoutId;
    }

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - MINIMAP_CLIP_INSET, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.minimapBg, 0, 0);
    this.drawMobs(ctx, model.mobs, MINIMAP_MOB_SIZE, colors);
    this.drawParty(ctx, model.party, MINIMAP_PARTY_RADIUS, MINIMAP_PARTY_OUTLINE_WIDTH, colors);
    this.drawPlayerArrow(ctx, model.player, MINIMAP_ARROW_OUTLINE_WIDTH);
    ctx.restore();
  }

  /** World-map delve render: the same static schematic + overlay, painted into the
   *  rectangular map canvas, with the area label drawn ON the canvas (no DOM
   *  label). Caller passes the map ctx, the world, and the canvas size. */
  paintWorldMapDelve(ctx: CanvasRenderingContext2D, world: IWorld, size: number): void {
    const run = world.delveRun;
    if (!run) return;
    const { delveName, moduleName } = this.resolveNames(run);
    const pad = Math.round(size * WORLD_MAP_PAD_RATIO);
    const model = delveDrawModel(world, size, pad, delveName, moduleName, t('hudChrome.compass.N'));
    if (!model) return;
    const colors = this.resolveColors();

    if (!this.worldMapBg || this.worldMapBgModuleId !== model.layoutId) {
      this.worldMapBg = this.buildSchematicBg(model.schematic, size, colors);
      this.worldMapBgModuleId = model.layoutId;
    }

    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.worldMapBg, 0, 0);
    this.drawMobs(ctx, model.mobs, WORLD_MAP_MOB_SIZE, colors);
    this.drawParty(ctx, model.party, WORLD_MAP_PARTY_RADIUS, WORLD_MAP_PARTY_OUTLINE_WIDTH, colors);
    this.drawPlayerArrow(ctx, model.player, WORLD_MAP_ARROW_OUTLINE_WIDTH);

    // The world map has no DOM zone label, so the area title is drawn on-canvas.
    ctx.font = WORLD_MAP_TITLE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = WORLD_MAP_TITLE_OUTLINE_WIDTH;
    ctx.fillStyle = colors.label;
    ctx.strokeText(model.areaLabel, size / 2, WORLD_MAP_TITLE_TOP);
    ctx.fillText(model.areaLabel, size / 2, WORLD_MAP_TITLE_TOP);
    ctx.textBaseline = 'alphabetic';
  }
}
