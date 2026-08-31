// Thin router for walk-in interior maps. Hud owns the frame loop and canvases;
// this controller owns which floor-plan painter handles the current IWorld
// position, keeping that branch family out of the coordinator.

import type { IWorld } from '../world_api';
import { DungeonMapPainter, type PaintedDungeonWorldMap } from './dungeon_map_painter';
import { dungeonMapActive } from './dungeon_map_view';
import { DAWNHOLD_MAP_PAINTER_SPEC, LastKeepMapPainter } from './lastkeep_map_painter';
import { dawnholdMapActive, lastKeepMapActive } from './lastkeep_map_view';
import type { PainterHostWriters } from './painter_host';

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

  paintDungeonWorldMap(
    ctx: CanvasRenderingContext2D,
    world: IWorld,
    size: number,
  ): PaintedDungeonWorldMap | null {
    return dungeonMapActive(world) ? this.dungeon.paintWorldMap(ctx, world, size) : null;
  }

  paintCastleWorldMap(ctx: CanvasRenderingContext2D, world: IWorld, size: number): string | null {
    if (lastKeepMapActive(world)) return this.lastKeep.paintWorldMap(ctx, world, size);
    if (dawnholdMapActive(world)) return this.dawnhold.paintWorldMap(ctx, world, size);
    return null;
  }
}
