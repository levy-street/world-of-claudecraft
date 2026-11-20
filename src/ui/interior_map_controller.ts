// Thin router for walk-in interior maps. Hud owns the frame loop and canvases;
// this controller owns which floor-plan painter handles a world position,
// keeping that branch family out of the coordinator. The minimap always follows
// the local player; the world map takes an explicit anchor so the HUD can draw
// the dungeon or castle a PARTY MEMBER stands in while the viewer is outside
// (map_surface_core.ts resolves that anchor from the roster).
//
// A raid with an illustrated atlas (src/ui/hud/raid_atlas/, the Smith's Heart
// pilot) draws its plan through the atlas instead of the plain floor plan; the
// atlas also rides the HUD's frame tick (`frame`) and paints the raid's
// minimap (the same illustrated page cropped round the player).

import { dungeonInstanceAt } from '../sim/dungeon_floor';
import type { IWorld } from '../world_api';
import {
  DungeonMapPainter,
  dungeonTitleWithDifficulty,
  MINIMAP_BASE_SCALE,
} from './dungeon_map_painter';
import {
  type DungeonMapModel,
  dungeonMapActive,
  dungeonMapLocal,
  type MapAnchor,
} from './dungeon_map_view';
import { hasRaidAtlas, type RaidAtlasAnchor, RaidAtlasController } from './hud/raid_atlas';
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
  private readonly atlas: RaidAtlasController | null;

  constructor(
    private readonly writers: PainterHostWriters,
    classColor: (cls: string) => string,
    planShown: (() => boolean) | null = null,
  ) {
    this.atlas = planShown ? new RaidAtlasController({ planShown, classColor }) : null;
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
      const anchor = this.atlas ? atlasAnchorAt(world.player.pos.x, world.player.pos.z) : null;
      if (
        anchor &&
        this.atlas?.paintMinimap(ctx, world, anchor, size, zoom, MINIMAP_BASE_SCALE * zoom)
      ) {
        this.writers.setText(zoneLabelEl, dungeonTitleWithDifficulty(anchor.dungeonId, world));
        return true;
      }
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
    const atlasAnchor = this.atlas ? atlasAnchorAt(anchor.x, anchor.z) : null;
    if (atlasAnchor && this.atlas) {
      const title = this.atlas.show(ctx.canvas, world, atlasAnchor);
      if (title !== null) return { title, model: null };
    }
    this.atlas?.hide();
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

  /** The HUD's frame tick (the raid atlas's glide and live layer). */
  frame(world: IWorld): void {
    this.atlas?.tick(world);
  }
}

/** The raid atlas anchor of a world point: its instance, when that instance's
 *  dungeon draws an atlas. */
function atlasAnchorAt(x: number, z: number): RaidAtlasAnchor | null {
  const local = dungeonMapLocal(x, z);
  if (!local || !hasRaidAtlas(local.dungeonId)) return null;
  const { originX, originZ } = local;
  return {
    dungeonId: local.dungeonId,
    originX,
    originZ,
    contains(px, pz) {
      const f = dungeonInstanceAt(px, pz);
      return f !== null && f.ox === originX && f.oz === originZ;
    },
  };
}
