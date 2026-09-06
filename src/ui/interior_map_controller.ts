// Thin router for walk-in interior maps. Hud owns the frame loop and canvases;
// this controller owns which floor-plan painter handles a world position,
// keeping that branch family out of the coordinator. The minimap always follows
// the local player; the world map takes an explicit anchor so the HUD can draw
// the dungeon or castle a PARTY MEMBER stands in while the viewer is outside
// (map_surface_core.ts resolves that anchor from the roster).

import type { IWorld } from '../world_api';
import { DungeonMapPainter } from './dungeon_map_painter';
import {
  type DungeonMapModel,
  dungeonMapActive,
  dungeonMapLocal,
  type MapAnchor,
} from './dungeon_map_view';
import { DAWNHOLD_MAP_PAINTER_SPEC, LastKeepMapPainter } from './lastkeep_map_painter';
import {
  dawnholdLocal,
  dawnholdMapActive,
  lastKeepLocal,
  lastKeepMapActive,
} from './lastkeep_map_view';
import type { PainterHostWriters } from './painter_host';

/** One world-map paint: the localized title for '#map-summary' plus the dungeon
 *  draw model for marker semantics (null for the castle plates, which carry no
 *  hit-testable marker model). */
export interface PaintedInteriorWorldMap {
  title: string;
  model: DungeonMapModel | null;
}

export class InteriorMapController {
  private readonly dungeon: DungeonMapPainter;
  private readonly lastKeep: LastKeepMapPainter;
  private readonly dawnhold: LastKeepMapPainter;

  constructor(writers: PainterHostWriters, classColor: (cls: string) => string) {
    this.dungeon = new DungeonMapPainter(writers, classColor);
    this.lastKeep = new LastKeepMapPainter(writers, classColor);
    this.dawnhold = new LastKeepMapPainter(writers, classColor, DAWNHOLD_MAP_PAINTER_SPEC);
  }

  paintMinimap(
    ctx: CanvasRenderingContext2D,
    world: IWorld,
    zoneLabelEl: HTMLElement,
    size: number,
    zoom: number,
  ): boolean {
    if (dungeonMapActive(world)) {
      this.dungeon.paintMinimap(ctx, world, zoneLabelEl, size, zoom);
      return true;
    }
    if (lastKeepMapActive(world)) {
      this.lastKeep.paintMinimap(ctx, world, zoneLabelEl, size, zoom);
      return true;
    }
    if (dawnholdMapActive(world)) {
      this.dawnhold.paintMinimap(ctx, world, zoneLabelEl, size, zoom);
      return true;
    }
    return false;
  }

  /** Paint the floor plan of the instance at `anchor` (the local player's
   *  position by default). Null when that position is not inside a dungeon or
   *  castle interior. */
  paintWorldMap(
    ctx: CanvasRenderingContext2D,
    world: IWorld,
    size: number,
    anchor: MapAnchor = world.player.pos,
  ): PaintedInteriorWorldMap | null {
    if (dungeonMapLocal(anchor.x, anchor.z)) {
      const painted = this.dungeon.paintWorldMap(ctx, world, size, anchor);
      return painted ? { title: painted.title, model: painted.model } : null;
    }
    if (lastKeepLocal(anchor.x, anchor.z)) {
      return { title: this.lastKeep.paintWorldMap(ctx, world, size, anchor), model: null };
    }
    if (dawnholdLocal(anchor.x, anchor.z)) {
      return { title: this.dawnhold.paintWorldMap(ctx, world, size, anchor), model: null };
    }
    return null;
  }
}
