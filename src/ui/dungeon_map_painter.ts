// Canvas painter for authoritative dungeon floor plans. The pure
// model in dungeon_map_view.ts owns every projected room, wall, doorway,
// obstacle, and marker; this adapter only resolves design tokens and strokes
// the shared model onto the minimap and M-map canvases.

import type { IWorld } from '../world_api';
import {
  type DungeonMapMarker,
  type DungeonMapModel,
  type DungeonMapPolygon,
  type DungeonMapStaticGeometry,
  DungeonMapViewCore,
} from './dungeon_map_view';
import { dungeonDisplayName } from './entity_i18n';
import type { PainterHostWriters } from './painter_host';

const FULL_CIRCLE = Math.PI * 2;
const OPAQUE = 1;

const MINIMAP_CLIP_INSET = 2;
const MINIMAP_BASE_SCALE = 1.7;
const WORLD_MAP_PAD_RATIO = 0.06;

const FLOOR_ALPHA = 0.92;
const DAIS_ALPHA = 0.8;
const OBSTACLE_ALPHA = 0.82;
const DOOR_ALPHA = 0.68;

const MINIMAP_MARKER_RADIUS = 3.5;
const MINIMAP_BOSS_RADIUS = 5.5;
const MINIMAP_PARTY_RADIUS = 4;
const MINIMAP_OUTLINE_WIDTH = 1.5;
const MINIMAP_ARROW_TIP_Y = -7;
const MINIMAP_ARROW_HALF_X = 4.5;
const MINIMAP_ARROW_BASE_Y = 5.5;

const WORLD_MAP_MARKER_RADIUS = 5;
const WORLD_MAP_BOSS_RADIUS = 7;
const WORLD_MAP_PARTY_RADIUS = 5;
const WORLD_MAP_OUTLINE_WIDTH = 2;
const WORLD_MAP_ARROW_TIP_Y = -10;
const WORLD_MAP_ARROW_HALF_X = 6.5;
const WORLD_MAP_ARROW_BASE_Y = 8;
const WORLD_MAP_TITLE_FONT = 'bold 14px Georgia';
const WORLD_MAP_TITLE_TOP = 6;
const WORLD_MAP_TITLE_OUTLINE_WIDTH = 3;

const DUNGEON_MAP_COLOR_TOKENS = {
  backdrop: '--color-delve-room',
  floor: '--color-border-showcase',
  wall: '--color-map-castle-wall',
  door: '--color-map-ping',
  dais: '--color-map-region-current-fill',
  obstacle: '--color-map-building-outline',
  label: '--color-delve-label',
  player: '--color-minimap-player',
  outline: '--color-minimap-outline',
  portal: '--color-minimap-portal',
  loot: '--color-minimap-object-loot',
  npc: '--color-map-label',
  mob: '--color-minimap-mob',
  mobAggro: '--color-minimap-mob-aggro',
  partyDead: '--color-minimap-party-dead',
} as const;

type DungeonMapColors = Record<keyof typeof DUNGEON_MAP_COLOR_TOKENS, string>;

interface MarkerMetrics {
  radius: number;
  bossRadius: number;
  partyRadius: number;
  outlineWidth: number;
  arrowTipY: number;
  arrowHalfX: number;
  arrowBaseY: number;
}

export interface PaintedDungeonWorldMap {
  model: DungeonMapModel;
  title: string;
}

const MINIMAP_MARKER_METRICS: MarkerMetrics = {
  radius: MINIMAP_MARKER_RADIUS,
  bossRadius: MINIMAP_BOSS_RADIUS,
  partyRadius: MINIMAP_PARTY_RADIUS,
  outlineWidth: MINIMAP_OUTLINE_WIDTH,
  arrowTipY: MINIMAP_ARROW_TIP_Y,
  arrowHalfX: MINIMAP_ARROW_HALF_X,
  arrowBaseY: MINIMAP_ARROW_BASE_Y,
};

const WORLD_MAP_MARKER_METRICS: MarkerMetrics = {
  radius: WORLD_MAP_MARKER_RADIUS,
  bossRadius: WORLD_MAP_BOSS_RADIUS,
  partyRadius: WORLD_MAP_PARTY_RADIUS,
  outlineWidth: WORLD_MAP_OUTLINE_WIDTH,
  arrowTipY: WORLD_MAP_ARROW_TIP_Y,
  arrowHalfX: WORLD_MAP_ARROW_HALF_X,
  arrowBaseY: WORLD_MAP_ARROW_BASE_Y,
};

function drawPolygon(ctx: CanvasRenderingContext2D, polygon: DungeonMapPolygon): void {
  const first = polygon.points[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first.cx, first.cy);
  for (let i = 1; i < polygon.points.length; i++) {
    const point = polygon.points[i];
    ctx.lineTo(point.cx, point.cy);
  }
  ctx.closePath();
}

/** One painter instance is shared by both map surfaces through Hud. */
export class DungeonMapPainter {
  private colors: DungeonMapColors | null = null;
  private readonly staticPlates = new WeakMap<DungeonMapStaticGeometry, HTMLCanvasElement>();
  private readonly view = new DungeonMapViewCore();
  private paintedWorldMap: PaintedDungeonWorldMap | null = null;

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly classColor: (cls: string) => string,
  ) {}

  private resolveColors(): DungeonMapColors {
    if (this.colors) return this.colors;
    const styles = getComputedStyle(document.documentElement);
    const colors = {} as DungeonMapColors;
    for (const key of Object.keys(
      DUNGEON_MAP_COLOR_TOKENS,
    ) as (keyof typeof DUNGEON_MAP_COLOR_TOKENS)[]) {
      colors[key] = styles.getPropertyValue(DUNGEON_MAP_COLOR_TOKENS[key]).trim();
    }
    if (colors.player) this.colors = colors;
    return colors;
  }

  private drawStaticPlan(
    ctx: CanvasRenderingContext2D,
    model: DungeonMapStaticGeometry,
    colors: DungeonMapColors,
    metrics: MarkerMetrics,
  ): void {
    ctx.globalAlpha = FLOOR_ALPHA;
    ctx.fillStyle = colors.floor;
    for (const floor of model.floors) {
      drawPolygon(ctx, floor);
      ctx.fill();
    }

    if (model.dais) {
      ctx.globalAlpha = DAIS_ALPHA;
      ctx.fillStyle = colors.dais;
      ctx.strokeStyle = colors.wall;
      ctx.lineWidth = metrics.outlineWidth;
      ctx.beginPath();
      ctx.arc(model.dais.cx, model.dais.cy, model.dais.r, 0, FULL_CIRCLE);
      ctx.fill();
      ctx.stroke();
    }

    ctx.globalAlpha = OBSTACLE_ALPHA;
    ctx.fillStyle = colors.obstacle;
    ctx.strokeStyle = colors.wall;
    ctx.lineWidth = metrics.outlineWidth;
    for (const obstacle of model.obstacles) {
      ctx.beginPath();
      ctx.arc(obstacle.cx, obstacle.cy, obstacle.r, 0, FULL_CIRCLE);
      ctx.fill();
      ctx.stroke();
    }

    ctx.globalAlpha = OPAQUE;
    ctx.strokeStyle = colors.wall;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const wall of model.walls) {
      ctx.lineWidth = wall.width;
      ctx.beginPath();
      ctx.moveTo(wall.a.cx, wall.a.cy);
      ctx.lineTo(wall.b.cx, wall.b.cy);
      ctx.stroke();
    }

    ctx.globalAlpha = DOOR_ALPHA;
    ctx.fillStyle = colors.door;
    for (const door of model.doors) {
      drawPolygon(ctx, door);
      ctx.fill();
    }
    ctx.globalAlpha = OPAQUE;
  }

  private staticPlate(
    model: DungeonMapStaticGeometry,
    colors: DungeonMapColors,
    metrics: MarkerMetrics,
  ): HTMLCanvasElement {
    const cached = this.staticPlates.get(model);
    if (cached) return cached;
    const plate = document.createElement('canvas');
    plate.width = model.canvasWidth;
    plate.height = model.canvasHeight;
    const plateCtx = plate.getContext('2d');
    if (plateCtx) {
      plateCtx.fillStyle = colors.backdrop;
      plateCtx.fillRect(0, 0, plate.width, plate.height);
      this.drawStaticPlan(plateCtx, model, colors, metrics);
    }
    this.staticPlates.set(model, plate);
    return plate;
  }

  private drawMarkers(
    ctx: CanvasRenderingContext2D,
    markers: readonly DungeonMapMarker[],
    colors: DungeonMapColors,
    metrics: MarkerMetrics,
  ): void {
    for (const marker of markers) {
      if (marker.kind === 'player') {
        ctx.save();
        ctx.translate(marker.cx, marker.cy);
        ctx.rotate(marker.angle);
        ctx.fillStyle = colors.player;
        ctx.strokeStyle = colors.outline;
        ctx.lineWidth = metrics.outlineWidth;
        ctx.beginPath();
        ctx.moveTo(0, metrics.arrowTipY);
        ctx.lineTo(metrics.arrowHalfX, metrics.arrowBaseY);
        ctx.lineTo(-metrics.arrowHalfX, metrics.arrowBaseY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        continue;
      }

      const radius =
        marker.kind === 'mob' && marker.boss
          ? metrics.bossRadius
          : marker.kind === 'party'
            ? metrics.partyRadius
            : metrics.radius;
      ctx.fillStyle = this.markerColor(marker, colors);
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = metrics.outlineWidth;
      ctx.beginPath();
      if (marker.kind === 'mob') {
        ctx.moveTo(marker.cx, marker.cy - radius);
        ctx.lineTo(marker.cx + radius, marker.cy);
        ctx.lineTo(marker.cx, marker.cy + radius);
        ctx.lineTo(marker.cx - radius, marker.cy);
        ctx.closePath();
      } else {
        ctx.arc(marker.cx, marker.cy, radius, 0, FULL_CIRCLE);
      }
      ctx.fill();
      ctx.stroke();
    }
  }

  private markerColor(
    marker: Exclude<DungeonMapMarker, { kind: 'player' }>,
    colors: DungeonMapColors,
  ): string {
    switch (marker.kind) {
      case 'exit':
      case 'gate':
        return colors.portal;
      case 'loot':
        return colors.loot;
      case 'npc':
        return colors.npc;
      case 'mob':
        return marker.aggro ? colors.mobAggro : colors.mob;
      case 'party':
        return marker.dead ? colors.partyDead : this.classColor(marker.cls);
    }
  }

  paintMinimap(
    ctx: CanvasRenderingContext2D,
    world: IWorld,
    zoneLabelEl: HTMLElement,
    size: number,
    zoom: number,
  ): void {
    const model = this.view.minimap(world, size, MINIMAP_BASE_SCALE * zoom);
    if (!model) return;
    this.writers.setText(zoneLabelEl, dungeonDisplayName(model.dungeonId));
    const colors = this.resolveColors();

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - MINIMAP_CLIP_INSET, 0, FULL_CIRCLE);
    ctx.clip();
    ctx.fillStyle = colors.backdrop;
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(
      this.staticPlate(model.staticGeometry, colors, MINIMAP_MARKER_METRICS),
      model.plateX,
      model.plateY,
    );
    this.drawMarkers(ctx, model.markers, colors, MINIMAP_MARKER_METRICS);
    ctx.restore();
  }

  paintWorldMap(
    ctx: CanvasRenderingContext2D,
    world: IWorld,
    size: number,
  ): PaintedDungeonWorldMap | null {
    const pad = Math.round(size * WORLD_MAP_PAD_RATIO);
    const model = this.view.worldMap(world, size, pad);
    if (!model) return null;
    const colors = this.resolveColors();
    const title = dungeonDisplayName(model.dungeonId);

    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.staticPlate(model.staticGeometry, colors, WORLD_MAP_MARKER_METRICS), 0, 0);
    this.drawMarkers(ctx, model.markers, colors, WORLD_MAP_MARKER_METRICS);

    ctx.font = WORLD_MAP_TITLE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = WORLD_MAP_TITLE_OUTLINE_WIDTH;
    ctx.fillStyle = colors.label;
    ctx.strokeText(title, size / 2, WORLD_MAP_TITLE_TOP);
    ctx.fillText(title, size / 2, WORLD_MAP_TITLE_TOP);
    ctx.textBaseline = 'alphabetic';
    if (!this.paintedWorldMap) this.paintedWorldMap = { model, title };
    else {
      this.paintedWorldMap.model = model;
      this.paintedWorldMap.title = title;
    }
    return this.paintedWorldMap;
  }
}
