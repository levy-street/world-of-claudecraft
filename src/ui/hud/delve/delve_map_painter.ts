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

import { DELVE_MODULE_LAYOUTS, type DelveModuleId } from '../../../sim/delve_layout';
import type { DelveRunInfo, IWorld } from '../../../world_api';
import { tEntity } from '../../entity_i18n';
import { type TranslationKey, t } from '../../i18n';
import { isLiveMapEntityDisclosed } from '../../map_entity_disclosure_core';
import {
  EMPTY_MAP_MARKER_ART,
  MAP_MARKER_SIZES,
  type MapMarkerArt,
  mapMarkerSizeForSemantic,
  semanticMapMarkerArt,
} from '../../map_marker_icon_art';
import type { MapMarkerProfile } from '../../map_marker_profile_core';
import {
  classifyMapObjectMarker,
  type MapMarkerSemantic,
  mapMarkerSemanticLayer,
} from '../../map_marker_semantics_core';
import type { PainterHostWriters } from '../../painter_host';
import { TextSpriteCache } from '../../text_sprite_cache';
import {
  type DelveMapFit,
  delveAreaLabel,
  delveCurrentModuleOrigin,
  delveLocalToCanvas,
  delveSchematicPlayer,
  delveSchematicStatic,
  playerDelveLocal,
  type SchematicArrow,
  type SchematicPrimitive,
} from './delve_map';

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

// Minimap surface: a fixed 162px circular minimap. Padding protects the full
// largest compact route/reward raster at an accessible module corner.
const MINIMAP_CLIP_INSET = 2; // clip radius = size / 2 - inset
const MINIMAP_MAX_MARKER_HALF = MAP_MARKER_SIZES.minimapNavigationCompact / 2;
const MINIMAP_PAD = MINIMAP_CLIP_INSET + Math.ceil(MINIMAP_MAX_MARKER_HALF * Math.SQRT2);

// World-map surface: the dynamically-sized rectangular map canvas.
const WORLD_MAP_PAD_RATIO = 0.06;

interface DelveDynamicGeometry {
  readonly mobSize: number;
  readonly objectRadius: number;
  readonly partyRadius: number;
  readonly partyOutlineWidth: number;
  readonly arrowScale: number;
  readonly arrowOutlineWidth: number;
}

/** Frozen backing-space geometry selected once per redraw. Compact touch HUDs
 * scale the canvas down in CSS, so live markers need the same compensation as
 * their exact-size art counterparts. */
const DELVE_DYNAMIC_GEOMETRY = Object.freeze({
  minimap: Object.freeze({
    standard: Object.freeze({
      mobSize: 3,
      objectRadius: 6,
      partyRadius: 4,
      partyOutlineWidth: 1.5,
      arrowScale: 1,
      arrowOutlineWidth: 1.5,
    }),
    compact: Object.freeze({
      mobSize: 4.5,
      objectRadius: 8,
      partyRadius: 5.5,
      partyOutlineWidth: 2,
      arrowScale: 1.35,
      arrowOutlineWidth: 2,
    }),
  }),
  map: Object.freeze({
    standard: Object.freeze({
      mobSize: 4,
      objectRadius: 8,
      partyRadius: 5,
      partyOutlineWidth: 2,
      arrowScale: 1,
      arrowOutlineWidth: 2,
    }),
    compact: Object.freeze({
      mobSize: 6,
      objectRadius: 11,
      partyRadius: 7,
      partyOutlineWidth: 3,
      arrowScale: 1.35,
      arrowOutlineWidth: 3,
    }),
  }),
} as const satisfies Readonly<
  Record<'minimap' | 'map', Readonly<Record<MapMarkerProfile, Readonly<DelveDynamicGeometry>>>>
>);

const DELVE_MAP_TEXT_STYLE = Object.freeze({
  standard: Object.freeze({ font: 'bold 14px Georgia', baselineY: 18, outlineWidth: 3 }),
  compact: Object.freeze({ font: 'bold 21px Georgia', baselineY: 27, outlineWidth: 4.5 }),
} as const satisfies Readonly<
  Record<MapMarkerProfile, Readonly<{ font: string; baselineY: number; outlineWidth: number }>>
>);

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

export type DelveMapSemantic = Extract<
  MapMarkerSemantic,
  { kind: 'delve-passage' | 'delve-surface' | 'delve-reward' }
>;

/** One live delve reward/navigation object projected into schematic space. */
export interface DelveObjectMarker {
  cx: number;
  cy: number;
  semantic: DelveMapSemantic;
}

/** Everything the painter draws for one delve frame, derived purely from IWorld.
 *  No DOM, no i18n, no color resolution: positions + the static schematic + the
 *  composed area label, so a Vitest can drive it directly and assert parity. */
export interface DelveDrawModel {
  /** Module layout id, the static-background cache key. */
  layoutId: string;
  /** Static room geometry. Navigation is exclusively a live object overlay. */
  schematic: SchematicPrimitive[];
  /** Hostile mob dots inside the canvas bounds. */
  mobs: DelveMobMarker[];
  /** Reward objects, painted after ordinary dynamics. */
  rewards: DelveObjectMarker[];
  /** Passage and surface routes, painted above rewards. */
  navigation: DelveObjectMarker[];
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
  fit: DelveMapFit = 'rect',
): DelveDrawModel | null {
  const run = world.delveRun;
  if (!run) return null;
  const p = world.player;
  const modId = run.modules[run.moduleIndex];
  const layoutId = (modId ?? DEFAULT_DELVE_MODULE) as DelveModuleId;
  const layout = DELVE_MODULE_LAYOUTS[layoutId] ?? DELVE_MODULE_LAYOUTS[DEFAULT_DELVE_MODULE];
  const moduleOrigin = delveCurrentModuleOrigin(run);

  const schematic = delveSchematicStatic(layout, canvasSize, pad, northLabel, fit);

  const mobs: DelveMobMarker[] = [];
  const rewards: DelveObjectMarker[] = [];
  const navigation: DelveObjectMarker[] = [];
  const companionId = world.companionState?.entityId;
  for (const e of world.entities.values()) {
    if (e.id === p.id || e.id === companionId) continue;
    if (!isLiveMapEntityDisclosed(p.pos.x, p.pos.z, e.pos.x, e.pos.z)) continue;
    let semantic: DelveObjectMarker['semantic'] | null = null;
    if (e.kind === 'object') {
      const classified = classifyMapObjectMarker(e, { delveRun: run });
      if (
        classified &&
        (classified.kind === 'delve-passage' ||
          classified.kind === 'delve-surface' ||
          classified.kind === 'delve-reward')
      )
        semantic = classified;
      else continue;
    } else if (!(e.kind === 'mob' && e.hostile && !e.dead)) {
      continue;
    }
    const { cx, cy } = delveLocalToCanvas(
      e.pos.x - moduleOrigin.x,
      e.pos.z - moduleOrigin.z,
      layout,
      canvasSize,
      pad,
      fit,
    );
    if (cx < 0 || cx > canvasSize || cy < 0 || cy > canvasSize) continue;
    if (!semantic) mobs.push({ cx, cy, aggro: e.aggroTargetId === p.id });
    else {
      const marker: DelveObjectMarker = { cx, cy, semantic };
      if (mapMarkerSemanticLayer(semantic) === 'reward') rewards.push(marker);
      else navigation.push(marker);
    }
  }

  const party: DelvePartyMarker[] = [];
  const partyInfo = world.partyInfo;
  if (partyInfo) {
    for (const m of partyInfo.members) {
      if (m.pid === p.id) continue;
      const { cx, cy } = delveLocalToCanvas(
        m.x - moduleOrigin.x,
        m.z - moduleOrigin.z,
        layout,
        canvasSize,
        pad,
        fit,
      );
      if (cx < 0 || cx > canvasSize || cy < 0 || cy > canvasSize) continue;
      party.push({ cx, cy, dead: m.dead, cls: m.cls });
    }
  }

  const { localX, localZ } = playerDelveLocal(p.pos.x, p.pos.z, moduleOrigin);
  const player = delveSchematicPlayer(localX, localZ, p.facing, layout, canvasSize, pad, fit);

  return {
    layoutId,
    schematic,
    mobs,
    rewards,
    navigation,
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
  private minimapBgKey = '';
  private worldMapBg: HTMLCanvasElement | null = null;
  private worldMapBgKey = '';
  private readonly titleSprites = new TextSpriteCache(8);

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly classColor: (cls: string) => string,
    private readonly markerArt: MapMarkerArt = EMPTY_MAP_MARKER_ART,
    private readonly markerProfile: () => MapMarkerProfile = () => 'standard',
  ) {}

  /** Drop the cached static-schematic backgrounds on a language switch: the
   *  baked compass-north glyph (northLabel, resolved from `hudChrome.compass.N`)
   *  is drawn INTO the cached canvas, so it never re-resolves on its own like a
   *  write-elided string would. Cleared rather than cleared-and-rebuilt so the
   *  next paint rebuilds through the ordinary cache-miss path (same idiom as
   *  MapWindowPainter.relocalize, its sibling in the write-elision writeup).
   *  Hud calls this from its woc:languagechange fan-out, alongside
   *  mapPainter.relocalize(). */
  relocalize(): void {
    this.minimapBg = null;
    this.minimapBgKey = '';
    this.worldMapBg = null;
    this.worldMapBgKey = '';
    this.titleSprites.clear();
  }

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
    // True-scale pools/islands can bleed past the walkable boundary (they do in
    // the world too, under walls); prims flagged clipToOutline paint only inside
    // the module's outline polygon.
    let outlinePath: Path2D | null = null;
    for (const prim of prims) {
      if (prim.kind === 'polygon' && prim.isOutline && prim.points.length) {
        outlinePath = new Path2D();
        outlinePath.moveTo(prim.points[0].cx, prim.points[0].cy);
        for (let i = 1; i < prim.points.length; i++)
          outlinePath.lineTo(prim.points[i].cx, prim.points[i].cy);
        outlinePath.closePath();
        break;
      }
    }
    for (const prim of prims) {
      ctx.save();
      if ((prim.kind === 'circle' || prim.kind === 'rect') && prim.clipToOutline && outlinePath) {
        ctx.clip(outlinePath);
      }
      if (prim.kind === 'circle') {
        ctx.beginPath();
        // ry makes it an ellipse (anisotropic schematic space); equal radii is
        // exactly the old arc.
        ctx.ellipse(prim.cx, prim.cy, prim.r, prim.ry ?? prim.r, 0, 0, Math.PI * 2);
        ctx.fillStyle = prim.fill;
        ctx.fill();
        if (prim.stroke) {
          ctx.strokeStyle = prim.stroke;
          ctx.lineWidth = prim.strokeWidth ?? DEFAULT_STROKE_WIDTH;
          ctx.stroke();
        }
      } else if (prim.kind === 'polygon') {
        if (prim.points.length) {
          ctx.beginPath();
          ctx.moveTo(prim.points[0].cx, prim.points[0].cy);
          for (let i = 1; i < prim.points.length; i++)
            ctx.lineTo(prim.points[i].cx, prim.points[i].cy);
          ctx.closePath();
          ctx.fillStyle = prim.fill;
          ctx.fill();
          if (prim.stroke) {
            ctx.strokeStyle = prim.stroke;
            ctx.lineWidth = prim.strokeWidth ?? DEFAULT_STROKE_WIDTH;
            ctx.stroke();
          }
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

  /** Generated markers use the same Hud-owned bounded cache as the overworld
   * painters. A successful path is one lookup and one whole-pixel blit. */
  private drawSemanticArt(
    ctx: CanvasRenderingContext2D,
    marker: DelveObjectMarker,
    surface: 'minimap' | 'map',
    compact: boolean,
  ): boolean {
    const art = semanticMapMarkerArt(marker.semantic);
    if (!art) return false;
    const sizeId = mapMarkerSizeForSemantic(surface, compact, art);
    const sprite = this.markerArt.sprite(art.id, sizeId);
    if (!sprite) return false;
    const size = MAP_MARKER_SIZES[sizeId];
    ctx.drawImage(sprite, Math.round(marker.cx - size / 2), Math.round(marker.cy - size / 2));
    return true;
  }

  /** Allocation-free procedural reward fallbacks. Cache and reliquary keep
   * different silhouettes; the centre mark carries state independently of hue. */
  private drawRewards(
    ctx: CanvasRenderingContext2D,
    rewards: DelveObjectMarker[],
    radius: number,
    outlineWidth: number,
    colors: DelveColors,
    surface: 'minimap' | 'map',
    compact: boolean,
  ): void {
    for (const marker of rewards) {
      if (this.drawSemanticArt(ctx, marker, surface, compact)) continue;
      const semantic = marker.semantic;
      if (semantic.kind !== 'delve-reward') continue;
      const opened = semantic.state === 'opened';
      ctx.fillStyle = opened
        ? colors.partyDead
        : semantic.state === 'active'
          ? colors.mobAggro
          : colors.label;
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = outlineWidth;
      ctx.beginPath();
      if (semantic.reward === 'reliquary') {
        ctx.moveTo(marker.cx, marker.cy - radius);
        ctx.lineTo(marker.cx + radius, marker.cy);
        ctx.lineTo(marker.cx, marker.cy + radius);
        ctx.lineTo(marker.cx - radius, marker.cy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(marker.cx - radius, marker.cy - radius, radius * 2, radius * 2);
        ctx.strokeRect(marker.cx - radius, marker.cy - radius, radius * 2, radius * 2);
      }
      // Bountiful is an outer halo, never a fill-color-only distinction.
      if (semantic.bountiful) {
        ctx.beginPath();
        ctx.arc(marker.cx, marker.cy, radius + outlineWidth * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = colors.outline;
      if (semantic.state === 'locked') {
        const lockHalf = radius * 0.32;
        ctx.beginPath();
        ctx.arc(marker.cx, marker.cy - lockHalf * 0.45, lockHalf, Math.PI, 0);
        ctx.stroke();
        ctx.fillStyle = colors.outline;
        ctx.fillRect(
          marker.cx - lockHalf,
          marker.cy - lockHalf * 0.1,
          lockHalf * 2,
          lockHalf * 1.5,
        );
      } else if (semantic.state === 'opened') {
        ctx.beginPath();
        ctx.moveTo(marker.cx - radius * 0.45, marker.cy);
        ctx.lineTo(marker.cx - radius * 0.1, marker.cy + radius * 0.35);
        ctx.lineTo(marker.cx + radius * 0.5, marker.cy - radius * 0.4);
        ctx.stroke();
      } else if (semantic.state === 'ready') {
        ctx.beginPath();
        ctx.moveTo(marker.cx, marker.cy - radius * 0.55);
        ctx.lineTo(marker.cx, marker.cy + radius * 0.55);
        ctx.moveTo(marker.cx - radius * 0.55, marker.cy);
        ctx.lineTo(marker.cx + radius * 0.55, marker.cy);
        ctx.stroke();
      } else {
        // Active rite: opposing chevrons read as a sequence in progress.
        ctx.beginPath();
        ctx.moveTo(marker.cx - radius * 0.35, marker.cy - radius * 0.45);
        ctx.lineTo(marker.cx + radius * 0.35, marker.cy);
        ctx.lineTo(marker.cx - radius * 0.35, marker.cy + radius * 0.45);
        ctx.stroke();
      }
    }
  }

  /** Allocation-free navigation fallbacks. Sealed passages carry an X; open
   * passages carry a forward arrow, and surface stairs use their own silhouette. */
  private drawNavigation(
    ctx: CanvasRenderingContext2D,
    navigation: DelveObjectMarker[],
    radius: number,
    outlineWidth: number,
    colors: DelveColors,
    surface: 'minimap' | 'map',
    compact: boolean,
  ): void {
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = outlineWidth;
    for (const marker of navigation) {
      if (this.drawSemanticArt(ctx, marker, surface, compact)) continue;
      const semantic = marker.semantic;
      ctx.fillStyle =
        semantic.kind === 'delve-passage' && semantic.state === 'sealed'
          ? colors.partyDead
          : colors.label;
      if (semantic.kind === 'delve-surface') {
        // Three stair treads plus an upward arrow.
        ctx.beginPath();
        ctx.moveTo(marker.cx - radius, marker.cy + radius * 0.65);
        ctx.lineTo(marker.cx + radius, marker.cy + radius * 0.65);
        ctx.moveTo(marker.cx - radius * 0.7, marker.cy + radius * 0.25);
        ctx.lineTo(marker.cx + radius * 0.7, marker.cy + radius * 0.25);
        ctx.moveTo(marker.cx - radius * 0.4, marker.cy - radius * 0.15);
        ctx.lineTo(marker.cx + radius * 0.4, marker.cy - radius * 0.15);
        ctx.moveTo(marker.cx, marker.cy - radius);
        ctx.lineTo(marker.cx, marker.cy - radius * 0.15);
        ctx.moveTo(marker.cx, marker.cy - radius);
        ctx.lineTo(marker.cx - radius * 0.32, marker.cy - radius * 0.62);
        ctx.moveTo(marker.cx, marker.cy - radius);
        ctx.lineTo(marker.cx + radius * 0.32, marker.cy - radius * 0.62);
        ctx.stroke();
        continue;
      }
      // Passage arch silhouette.
      ctx.beginPath();
      ctx.arc(marker.cx, marker.cy, radius, Math.PI, 0);
      ctx.lineTo(marker.cx + radius, marker.cy + radius);
      ctx.lineTo(marker.cx - radius, marker.cy + radius);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (semantic.state === 'sealed') {
        ctx.beginPath();
        ctx.moveTo(marker.cx - radius * 0.45, marker.cy - radius * 0.3);
        ctx.lineTo(marker.cx + radius * 0.45, marker.cy + radius * 0.5);
        ctx.moveTo(marker.cx + radius * 0.45, marker.cy - radius * 0.3);
        ctx.lineTo(marker.cx - radius * 0.45, marker.cy + radius * 0.5);
        ctx.stroke();
      } else {
        ctx.fillStyle = colors.outline;
        ctx.beginPath();
        ctx.moveTo(marker.cx, marker.cy - radius * 0.45);
        ctx.lineTo(marker.cx + radius * 0.4, marker.cy + radius * 0.3);
        ctx.lineTo(marker.cx - radius * 0.4, marker.cy + radius * 0.3);
        ctx.closePath();
        ctx.fill();
      }
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
    scale: number,
  ): void {
    const size = arrow.size * scale;
    ctx.save();
    ctx.translate(arrow.cx, arrow.cy);
    ctx.rotate(arrow.angle);
    ctx.fillStyle = arrow.fill;
    ctx.strokeStyle = arrow.stroke;
    ctx.lineWidth = outlineWidth;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * ARROW_HALF_WIDTH_RATIO, size * ARROW_BASE_RATIO);
    ctx.lineTo(-size * ARROW_HALF_WIDTH_RATIO, size * ARROW_BASE_RATIO);
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
      'circle',
    );
    if (!model) return;
    // The one DOM write this Canvas pilot routes through the write-elision facet.
    this.writers.setText(zoneLabelEl, model.areaLabel);
    const colors = this.resolveColors();
    const profile = this.markerProfile();
    const geometry = DELVE_DYNAMIC_GEOMETRY.minimap[profile];
    const compact = profile === 'compact';

    const bgKey = `${model.layoutId}:${size}:${MINIMAP_PAD}:circle`;
    if (!this.minimapBg || this.minimapBgKey !== bgKey) {
      this.minimapBg = this.buildSchematicBg(model.schematic, size, colors);
      this.minimapBgKey = bgKey;
    }

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - MINIMAP_CLIP_INSET, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.minimapBg, 0, 0);
    this.drawMobs(ctx, model.mobs, geometry.mobSize, colors);
    this.drawRewards(
      ctx,
      model.rewards,
      geometry.objectRadius,
      geometry.partyOutlineWidth,
      colors,
      'minimap',
      compact,
    );
    this.drawNavigation(
      ctx,
      model.navigation,
      geometry.objectRadius,
      geometry.partyOutlineWidth,
      colors,
      'minimap',
      compact,
    );
    this.drawParty(ctx, model.party, geometry.partyRadius, geometry.partyOutlineWidth, colors);
    this.drawPlayerArrow(ctx, model.player, geometry.arrowOutlineWidth, geometry.arrowScale);
    ctx.restore();
  }

  /** World-map delve render: the same static schematic + overlay, painted into the
   *  rectangular map canvas, with the area label drawn ON the canvas (no DOM
   *  label). Caller passes the map ctx, the world, and the canvas size. */
  paintWorldMapDelve(
    ctx: CanvasRenderingContext2D,
    world: IWorld,
    size: number,
  ): DelveDrawModel | null {
    const run = world.delveRun;
    if (!run) return null;
    const { delveName, moduleName } = this.resolveNames(run);
    const pad = Math.round(size * WORLD_MAP_PAD_RATIO);
    const model = delveDrawModel(world, size, pad, delveName, moduleName, t('hudChrome.compass.N'));
    if (!model) return null;
    const colors = this.resolveColors();
    const profile = this.markerProfile();
    const geometry = DELVE_DYNAMIC_GEOMETRY.map[profile];
    const textStyle = DELVE_MAP_TEXT_STYLE[profile];
    const compact = profile === 'compact';

    const bgKey = `${model.layoutId}:${size}:${pad}:rect`;
    if (!this.worldMapBg || this.worldMapBgKey !== bgKey) {
      this.worldMapBg = this.buildSchematicBg(model.schematic, size, colors);
      this.worldMapBgKey = bgKey;
    }

    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.worldMapBg, 0, 0);
    this.drawMobs(ctx, model.mobs, geometry.mobSize, colors);
    this.drawRewards(
      ctx,
      model.rewards,
      geometry.objectRadius,
      geometry.partyOutlineWidth,
      colors,
      'map',
      compact,
    );
    this.drawNavigation(
      ctx,
      model.navigation,
      geometry.objectRadius,
      geometry.partyOutlineWidth,
      colors,
      'map',
      compact,
    );
    this.drawParty(ctx, model.party, geometry.partyRadius, geometry.partyOutlineWidth, colors);
    this.drawPlayerArrow(ctx, model.player, geometry.arrowOutlineWidth, geometry.arrowScale);

    // The world map has no DOM zone label. Rasterize this localized title once,
    // then use a single whole-pixel blit on every drag/pinch redraw.
    this.titleSprites.beginRedraw();
    this.titleSprites.draw(ctx, model.areaLabel, size / 2, textStyle.baselineY, {
      font: textStyle.font,
      fill: colors.label,
      stroke: colors.outline,
      lineWidth: textStyle.outlineWidth,
    });
    return model;
  }
}
