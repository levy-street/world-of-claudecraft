// Cached Canvas-2D painter for the procedural Rift schematic. Immutable floor
// geometry rasterizes once per descriptor/surface. Every redraw then performs one
// background blit plus honest mirrored live overlays; no plan spawn/object is used.

import type { IWorld } from '../../../world_api';
import {
  EMPTY_MAP_MARKER_ART,
  MAP_MARKER_SIZES,
  type MapMarkerArt,
  mapMarkerSizeForSemantic,
  semanticMapMarkerArt,
} from '../../map_marker_icon_art';
import type { MapMarkerProfile } from '../../map_marker_profile_core';
import type { PainterHostWriters } from '../../painter_host';
import { TextSpriteCache } from '../../text_sprite_cache';
import {
  createRiftMapView,
  type RiftMapModel,
  type RiftMapPoint,
  type RiftMapPolygon,
  type RiftMapPrimitive,
  type RiftObjectMarker,
} from './rift_map_core';

const MINIMAP_CLIP_INSET = 2;
// Keep the complete largest compact route/reward raster inside the circular
// clip even when its world position is an accessible floor-plan corner.
const MINIMAP_MAX_MARKER_HALF = MAP_MARKER_SIZES.minimapNavigationCompact / 2;
const MINIMAP_PAD = MINIMAP_CLIP_INSET + Math.ceil(MINIMAP_MAX_MARKER_HALF * Math.SQRT2);
const WORLD_MAP_PAD_RATIO = 0.06;
const STATIC_WALL_WIDTH = 2;
const STATIC_DASH_LENGTH = 5;
const STATIC_DASH_GAP = 4;
const FULL_CIRCLE = Math.PI * 2;
const DEATH_ZONE_CORE_RATIO = 0.55;
const DEATH_ZONE_SWEEP_START = -Math.PI / 2;
const SEMANTIC_CORE_RATIO = 0.42;

interface RiftDynamicGeometry {
  readonly mobRadius: number;
  readonly mobAggroRadius: number;
  readonly objectRadius: number;
  readonly partyRadius: number;
  readonly corpseRadius: number;
  readonly playerTip: number;
  readonly playerHalfWidth: number;
  readonly playerBase: number;
  readonly dynamicOutlineWidth: number;
  readonly deathZoneLineWidth: number;
}

/** Frozen backing-space geometry selected once per redraw. Compact canvases
 * are CSS-scaled down on touch layouts, so their live marks need extra size
 * and weight just like the pre-rasterized marker art. */
const RIFT_DYNAMIC_GEOMETRY = Object.freeze({
  minimap: Object.freeze({
    standard: Object.freeze({
      mobRadius: 2.5,
      mobAggroRadius: 3.375,
      objectRadius: 6,
      partyRadius: 4,
      corpseRadius: 4,
      playerTip: 6,
      playerHalfWidth: 3.6,
      playerBase: 4.8,
      dynamicOutlineWidth: 1.5,
      deathZoneLineWidth: 2,
    }),
    compact: Object.freeze({
      mobRadius: 3.5,
      mobAggroRadius: 5,
      objectRadius: 8,
      partyRadius: 5.5,
      corpseRadius: 5.5,
      playerTip: 9,
      playerHalfWidth: 5.4,
      playerBase: 7.2,
      dynamicOutlineWidth: 2,
      deathZoneLineWidth: 3,
    }),
  }),
  map: Object.freeze({
    standard: Object.freeze({
      mobRadius: 3.5,
      mobAggroRadius: 4.725,
      objectRadius: 8,
      partyRadius: 5,
      corpseRadius: 5,
      playerTip: 8,
      playerHalfWidth: 4.8,
      playerBase: 6.4,
      dynamicOutlineWidth: 1.5,
      deathZoneLineWidth: 2,
    }),
    compact: Object.freeze({
      mobRadius: 5,
      mobAggroRadius: 7,
      objectRadius: 11,
      partyRadius: 7,
      corpseRadius: 7,
      playerTip: 12,
      playerHalfWidth: 7.2,
      playerBase: 9.6,
      dynamicOutlineWidth: 2.25,
      deathZoneLineWidth: 3,
    }),
  }),
} as const satisfies Readonly<
  Record<'minimap' | 'map', Readonly<Record<MapMarkerProfile, Readonly<RiftDynamicGeometry>>>>
>);

const RIFT_MAP_TEXT_STYLE = Object.freeze({
  standard: Object.freeze({
    font: 'bold 14px Georgia',
    baselineY: 18,
    outlineWidth: 3,
  }),
  compact: Object.freeze({
    font: 'bold 21px Georgia',
    baselineY: 27,
    outlineWidth: 4.5,
  }),
} as const satisfies Readonly<
  Record<MapMarkerProfile, Readonly<{ font: string; baselineY: number; outlineWidth: number }>>
>);

const RIFT_COLOR_TOKENS = {
  room: '--color-delve-room',
  label: '--color-delve-label',
  outline: '--color-delve-outline',
  mob: '--color-delve-mob',
  mobAggro: '--color-delve-mob-aggro',
  partyDead: '--color-delve-party-dead',
  player: '--color-minimap-player',
  reward: '--color-minimap-object-loot',
  active: '--color-minimap-gather-ready',
  inactive: '--color-minimap-gather-cooldown',
  corpse: '--color-minimap-corpse',
} as const;

type RiftColors = Record<keyof typeof RIFT_COLOR_TOKENS, string>;

interface SurfaceCache {
  key: string;
  canvas: HTMLCanvasElement | null;
}

function appendPolygonPath(ctx: CanvasRenderingContext2D, polygon: RiftMapPolygon): void {
  const first = polygon.points[0];
  if (!first) return;
  ctx.moveTo(first.cx, first.cy);
  for (let index = 1; index < polygon.points.length; index++) {
    const point = polygon.points[index];
    ctx.lineTo(point.cx, point.cy);
  }
  ctx.closePath();
}

/** Append one primitive's geometry to the current path. */
function appendPrimitivePath(ctx: CanvasRenderingContext2D, primitive: RiftMapPrimitive): void {
  switch (primitive.kind) {
    case 'polygon':
      appendPolygonPath(ctx, primitive);
      return;
    case 'rect':
      ctx.rect(primitive.x, primitive.y, primitive.w, primitive.h);
      return;
    case 'circle':
      ctx.ellipse(primitive.cx, primitive.cy, primitive.rx, primitive.ry, 0, 0, FULL_CIRCLE);
      return;
    case 'line':
      ctx.moveTo(primitive.x1, primitive.y1);
      ctx.lineTo(primitive.x2, primitive.y2);
  }
}

function drawCheck(ctx: CanvasRenderingContext2D, point: RiftMapPoint, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(point.cx - radius * 0.48, point.cy);
  ctx.lineTo(point.cx - radius * 0.12, point.cy + radius * 0.38);
  ctx.lineTo(point.cx + radius * 0.52, point.cy - radius * 0.42);
  ctx.stroke();
}

/** Allocation-free procedural semantic fallback used until generated art is ready. */
function drawSemanticFallback(
  ctx: CanvasRenderingContext2D,
  marker: RiftObjectMarker,
  radius: number,
  outlineWidth: number,
  colors: RiftColors,
): void {
  const semantic = marker.semantic;
  const core = radius * SEMANTIC_CORE_RATIO;
  ctx.lineWidth = outlineWidth;
  ctx.strokeStyle = colors.outline;
  ctx.fillStyle = colors.reward;
  if (semantic.kind === 'rift-descent') {
    ctx.beginPath();
    ctx.moveTo(marker.cx, marker.cy + radius);
    ctx.lineTo(marker.cx + radius, marker.cy - radius);
    ctx.lineTo(marker.cx - radius, marker.cy - radius);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    return;
  }
  if (semantic.kind === 'rift-return') {
    ctx.beginPath();
    ctx.arc(marker.cx, marker.cy, radius, 0, FULL_CIRCLE);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(marker.cx + core, marker.cy - core);
    ctx.lineTo(marker.cx - core, marker.cy);
    ctx.lineTo(marker.cx + core, marker.cy + core);
    ctx.stroke();
    return;
  }
  if (semantic.kind === 'rift-reward') {
    ctx.fillStyle = semantic.state === 'opened' ? colors.inactive : colors.reward;
    ctx.fillRect(marker.cx - radius, marker.cy - radius * 0.7, radius * 2, radius * 1.4);
    ctx.strokeRect(marker.cx - radius, marker.cy - radius * 0.7, radius * 2, radius * 1.4);
    if (semantic.state === 'opened') drawCheck(ctx, marker, radius);
    else if (semantic.state === 'jammed') {
      ctx.beginPath();
      ctx.moveTo(marker.cx - core, marker.cy - core);
      ctx.lineTo(marker.cx + core, marker.cy + core);
      ctx.moveTo(marker.cx + core, marker.cy - core);
      ctx.lineTo(marker.cx - core, marker.cy + core);
      ctx.stroke();
    } else if (semantic.state === 'locked') {
      ctx.beginPath();
      ctx.arc(marker.cx, marker.cy - core * 0.25, core, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = colors.outline;
      ctx.fillRect(marker.cx - core, marker.cy, core * 2, core * 1.35);
    }
    return;
  }
  const active =
    semantic.state === 'lit' ||
    semantic.state === 'placed' ||
    semantic.state === 'open' ||
    semantic.state === 'on' ||
    semantic.state === 'active';
  ctx.fillStyle =
    semantic.state === 'hazard' ? colors.mobAggro : active ? colors.active : colors.inactive;
  switch (semantic.mechanic) {
    case 'pylon':
    case 'roller':
      ctx.beginPath();
      ctx.moveTo(marker.cx, marker.cy - radius);
      ctx.lineTo(marker.cx + radius, marker.cy + radius);
      ctx.lineTo(marker.cx - radius, marker.cy + radius);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'sequence-rune':
      ctx.beginPath();
      ctx.moveTo(marker.cx, marker.cy - radius);
      ctx.lineTo(marker.cx + radius, marker.cy);
      ctx.lineTo(marker.cx, marker.cy + radius);
      ctx.lineTo(marker.cx - radius, marker.cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'ice-goal':
    case 'boulder-pad':
      ctx.beginPath();
      ctx.arc(marker.cx, marker.cy, radius, 0, FULL_CIRCLE);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(marker.cx, marker.cy, core, 0, FULL_CIRCLE);
      ctx.fill();
      break;
    case 'gate':
      ctx.beginPath();
      ctx.arc(marker.cx, marker.cy, radius, Math.PI, FULL_CIRCLE);
      ctx.lineTo(marker.cx + radius, marker.cy + radius);
      ctx.lineTo(marker.cx - radius, marker.cy + radius);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'switch':
      ctx.fillRect(marker.cx - radius * 0.7, marker.cy - radius * 0.7, radius * 1.4, radius * 1.4);
      ctx.strokeRect(
        marker.cx - radius * 0.7,
        marker.cy - radius * 0.7,
        radius * 1.4,
        radius * 1.4,
      );
      break;
    case 'boulder':
    case 'orb':
      ctx.beginPath();
      ctx.arc(marker.cx, marker.cy, radius, 0, FULL_CIRCLE);
      ctx.fill();
      ctx.stroke();
      break;
  }
  ctx.strokeStyle = colors.outline;
  if (semantic.state === 'placed' || semantic.state === 'on') drawCheck(ctx, marker, radius);
  else if (semantic.state === 'sealed') {
    ctx.beginPath();
    ctx.moveTo(marker.cx - core, marker.cy - core);
    ctx.lineTo(marker.cx + core, marker.cy + core);
    ctx.moveTo(marker.cx + core, marker.cy - core);
    ctx.lineTo(marker.cx - core, marker.cy + core);
    ctx.stroke();
  } else if (semantic.state === 'lit' || semantic.state === 'active') {
    ctx.beginPath();
    ctx.moveTo(marker.cx - core, marker.cy);
    ctx.lineTo(marker.cx + core, marker.cy);
    ctx.moveTo(marker.cx, marker.cy - core);
    ctx.lineTo(marker.cx, marker.cy + core);
    ctx.stroke();
  } else if (semantic.state === 'hazard') {
    ctx.beginPath();
    ctx.moveTo(marker.cx, marker.cy - core);
    ctx.lineTo(marker.cx, marker.cy + core * 0.25);
    ctx.stroke();
    ctx.fillStyle = colors.outline;
    ctx.beginPath();
    ctx.arc(marker.cx, marker.cy + core, Math.max(1, core * 0.2), 0, FULL_CIRCLE);
    ctx.fill();
  }
}

export class RiftMapPainter {
  private readonly minimapView = createRiftMapView('circle');
  private readonly worldMapView = createRiftMapView();
  private readonly minimapCache: SurfaceCache = { key: '', canvas: null };
  private readonly worldMapCache: SurfaceCache = { key: '', canvas: null };
  private readonly titleSprites = new TextSpriteCache(8);
  private colors: RiftColors | null = null;

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly classColor: (cls: string) => string,
    private readonly areaLabel: (name: string, rank: string | null) => string,
    private readonly markerArt: MapMarkerArt = EMPTY_MAP_MARKER_ART,
    private readonly markerProfile: () => MapMarkerProfile = () => 'standard',
  ) {}

  /** Only title sprites carry localized content; static geometry stays valid. */
  relocalize(): void {
    this.titleSprites.clear();
  }

  private resolveColors(): RiftColors {
    if (this.colors) return this.colors;
    const styles = getComputedStyle(document.documentElement);
    const read = (token: string): string => styles.getPropertyValue(token).trim();
    const colors = {} as RiftColors;
    for (const key of Object.keys(RIFT_COLOR_TOKENS) as (keyof typeof RIFT_COLOR_TOKENS)[])
      colors[key] = read(RIFT_COLOR_TOKENS[key]);
    this.colors = colors;
    return colors;
  }

  private buildStatic(model: RiftMapModel, size: number, colors: RiftColors): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    ctx.fillStyle = colors.room;
    ctx.beginPath();
    for (const outline of model.staticGeometry.walkable) appendPolygonPath(ctx, outline);
    ctx.fill();

    // Environmental mechanics are clipped to the actual walkable union.
    ctx.save();
    ctx.beginPath();
    for (const outline of model.staticGeometry.walkable) appendPolygonPath(ctx, outline);
    ctx.clip();
    for (const primitive of model.staticGeometry.clipped) {
      ctx.beginPath();
      appendPrimitivePath(ctx, primitive);
      if (primitive.role === 'hazard') ctx.fillStyle = colors.mobAggro;
      else if (primitive.role === 'ice') ctx.fillStyle = colors.corpse;
      else if (primitive.role === 'roller-lane') {
        ctx.strokeStyle = colors.mobAggro;
        ctx.lineWidth = STATIC_WALL_WIDTH;
        ctx.setLineDash([STATIC_DASH_LENGTH, STATIC_DASH_GAP]);
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      } else if (primitive.role === 'dais') {
        // The dais raises walkable ground and deliberately has no collider.
        // A restrained ring communicates elevation without claiming an
        // obstacle or hiding live boss/navigation markers inside it.
        ctx.strokeStyle = colors.inactive;
        ctx.lineWidth = STATIC_WALL_WIDTH;
        ctx.stroke();
        continue;
      } else ctx.fillStyle = colors.inactive;
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = colors.label;
    ctx.fillStyle = colors.inactive;
    ctx.lineWidth = STATIC_WALL_WIDTH;
    for (const primitive of model.staticGeometry.structures) {
      ctx.beginPath();
      appendPrimitivePath(ctx, primitive);
      if (primitive.role === 'wall' || primitive.role === 'illusion-wall') {
        // An illusion wall looks solid in the world. Cartography must preserve
        // that appearance and never advertise the hidden traversability.
        ctx.stroke();
      } else if (primitive.role === 'entry') {
        ctx.stroke();
      } else {
        ctx.fill();
        ctx.stroke();
      }
    }
    return canvas;
  }

  private staticBackground(
    model: RiftMapModel,
    size: number,
    colors: RiftColors,
    cache: SurfaceCache,
  ): HTMLCanvasElement {
    const key = `${model.staticKey}:${size}:${model.transform.pad}:${model.transform.fit}`;
    if (!cache.canvas || cache.key !== key) {
      cache.canvas = this.buildStatic(model, size, colors);
      cache.key = key;
    }
    return cache.canvas;
  }

  private drawObjectArt(
    ctx: CanvasRenderingContext2D,
    marker: RiftObjectMarker,
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

  private drawDynamic(
    ctx: CanvasRenderingContext2D,
    model: RiftMapModel,
    surface: 'minimap' | 'map',
    colors: RiftColors,
    profile: MapMarkerProfile,
  ): void {
    const geometry = RIFT_DYNAMIC_GEOMETRY[surface][profile];
    const compact = profile === 'compact';
    ctx.lineWidth = geometry.dynamicOutlineWidth;
    ctx.strokeStyle = colors.outline;
    for (const zone of model.deathZones) {
      ctx.strokeStyle = colors.mobAggro;
      ctx.lineWidth = geometry.deathZoneLineWidth;
      ctx.beginPath();
      ctx.arc(zone.cx, zone.cy, zone.radius, 0, FULL_CIRCLE);
      ctx.stroke();
      const remaining = Math.max(0, Math.min(1, zone.remaining / Math.max(0.001, zone.total)));
      ctx.beginPath();
      ctx.arc(
        zone.cx,
        zone.cy,
        zone.radius * DEATH_ZONE_CORE_RATIO,
        DEATH_ZONE_SWEEP_START,
        DEATH_ZONE_SWEEP_START + FULL_CIRCLE * remaining,
      );
      ctx.stroke();
    }
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = geometry.dynamicOutlineWidth;
    for (const mob of model.mobs) {
      ctx.fillStyle =
        mob.state === 'loot' ? colors.reward : mob.aggro ? colors.mobAggro : colors.mob;
      ctx.beginPath();
      if (mob.aggro) {
        ctx.moveTo(mob.cx, mob.cy - geometry.mobAggroRadius);
        ctx.lineTo(mob.cx + geometry.mobAggroRadius, mob.cy);
        ctx.lineTo(mob.cx, mob.cy + geometry.mobAggroRadius);
        ctx.lineTo(mob.cx - geometry.mobAggroRadius, mob.cy);
        ctx.closePath();
      } else ctx.arc(mob.cx, mob.cy, geometry.mobRadius, 0, FULL_CIRCLE);
      ctx.fill();
      ctx.stroke();
    }
    for (const object of model.objects) {
      if (!this.drawObjectArt(ctx, object, surface, compact))
        drawSemanticFallback(
          ctx,
          object,
          geometry.objectRadius,
          geometry.dynamicOutlineWidth,
          colors,
        );
    }
    for (const member of model.party) {
      ctx.fillStyle = member.dead ? colors.partyDead : this.classColor(member.cls);
      ctx.strokeStyle = colors.outline;
      ctx.beginPath();
      ctx.arc(member.cx, member.cy, geometry.partyRadius, 0, FULL_CIRCLE);
      ctx.fill();
      ctx.stroke();
      if (member.dead) {
        ctx.beginPath();
        ctx.moveTo(member.cx - geometry.partyRadius * 0.5, member.cy - geometry.partyRadius * 0.5);
        ctx.lineTo(member.cx + geometry.partyRadius * 0.5, member.cy + geometry.partyRadius * 0.5);
        ctx.moveTo(member.cx + geometry.partyRadius * 0.5, member.cy - geometry.partyRadius * 0.5);
        ctx.lineTo(member.cx - geometry.partyRadius * 0.5, member.cy + geometry.partyRadius * 0.5);
        ctx.stroke();
      }
    }
    if (model.corpse) {
      ctx.fillStyle = colors.corpse;
      ctx.beginPath();
      ctx.arc(model.corpse.cx, model.corpse.cy, geometry.corpseRadius, 0, FULL_CIRCLE);
      ctx.fill();
      ctx.stroke();
    }
    const player = model.player;
    ctx.save();
    ctx.translate(player.cx, player.cy);
    ctx.rotate(player.angle);
    ctx.fillStyle = colors.player;
    ctx.strokeStyle = colors.outline;
    ctx.beginPath();
    ctx.moveTo(0, -geometry.playerTip);
    ctx.lineTo(geometry.playerHalfWidth, geometry.playerBase);
    ctx.lineTo(-geometry.playerHalfWidth, geometry.playerBase);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  paintMinimap(
    ctx: CanvasRenderingContext2D,
    world: IWorld,
    zoneLabelEl: HTMLElement,
    size: number,
  ): RiftMapModel | null {
    const floor = world.riftFloor;
    if (!floor) return null;
    const label = this.areaLabel(floor.name, floor.tier);
    const model = this.minimapView.build(world, size, MINIMAP_PAD, label);
    if (!model) return null;
    this.writers.setText(zoneLabelEl, label);
    const colors = this.resolveColors();
    const background = this.staticBackground(model, size, colors, this.minimapCache);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - MINIMAP_CLIP_INSET, 0, FULL_CIRCLE);
    ctx.clip();
    ctx.drawImage(background, 0, 0);
    const profile = this.markerProfile();
    this.drawDynamic(ctx, model, 'minimap', colors, profile);
    ctx.restore();
    return model;
  }

  paintWorldMap(ctx: CanvasRenderingContext2D, world: IWorld, size: number): RiftMapModel | null {
    const floor = world.riftFloor;
    if (!floor) return null;
    const label = this.areaLabel(floor.name, floor.tier);
    const pad = Math.round(size * WORLD_MAP_PAD_RATIO);
    const model = this.worldMapView.build(world, size, pad, label);
    if (!model) return null;
    const colors = this.resolveColors();
    const background = this.staticBackground(model, size, colors, this.worldMapCache);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(background, 0, 0);
    const profile = this.markerProfile();
    const textStyle = RIFT_MAP_TEXT_STYLE[profile];
    this.drawDynamic(ctx, model, 'map', colors, profile);
    this.titleSprites.beginRedraw();
    this.titleSprites.draw(ctx, label, size / 2, textStyle.baselineY, {
      font: textStyle.font,
      fill: colors.label,
      stroke: colors.outline,
      lineWidth: textStyle.outlineWidth,
    });
    return model;
  }
}
