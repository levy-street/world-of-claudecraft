import { describe, expect, it, vi } from 'vitest';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { IGNIVAR_MOLTEN_ASSEMBLY_ID } from '../src/sim/ignivar_raid_ids';
import type { IWorld } from '../src/world_api';

const calls = vi.hoisted(() => ({
  dungeonMinimap: vi.fn(),
  dungeonWorld: vi.fn(),
  lastKeepMinimap: vi.fn(),
  lastKeepWorld: vi.fn(),
  dawnholdMinimap: vi.fn(),
  dawnholdWorld: vi.fn(),
  atlasMinimap: vi.fn(),
  atlasGone: vi.fn(),
  atlasPaints: true,
}));

vi.mock('../src/ui/dungeon_map_painter', () => ({
  MINIMAP_BASE_SCALE: 1.7,
  dungeonTitleWithDifficulty: (id: string) => `${id} title`,
  DungeonMapPainter: class {
    paintMinimap(...args: unknown[]): void {
      calls.dungeonMinimap(...args);
    }
    paintWorldMap(...args: unknown[]): unknown {
      calls.dungeonWorld(...args);
      return { model: { markers: [] }, title: 'Dungeon title' };
    }
  },
}));

vi.mock('../src/ui/lastkeep_map_painter', () => {
  const dawnholdSpec = { id: 'dawnhold' };
  return {
    DAWNHOLD_MAP_PAINTER_SPEC: dawnholdSpec,
    LastKeepMapPainter: class {
      private readonly dawnhold: boolean;
      constructor(_writers: unknown, _classColor: unknown, spec?: unknown) {
        this.dawnhold = spec === dawnholdSpec;
      }
      paintMinimap(...args: unknown[]): void {
        (this.dawnhold ? calls.dawnholdMinimap : calls.lastKeepMinimap)(...args);
      }
      paintWorldMap(...args: unknown[]): string {
        (this.dawnhold ? calls.dawnholdWorld : calls.lastKeepWorld)(...args);
        return this.dawnhold ? 'Dawnhold title' : 'Last Keep title';
      }
    },
  };
});

vi.mock('../src/ui/hud/raid_atlas', () => ({
  hasRaidAtlas: (id: string) => id === 'smith_heart',
  RaidAtlasController: class {
    paintMinimap(...args: unknown[]): boolean {
      calls.atlasMinimap(...args);
      return calls.atlasPaints;
    }
    hide(): void {}
    tick(): void {}
    minimapGone(): void {
      calls.atlasGone();
    }
    minimapTap(): boolean {
      return true;
    }
  },
}));

import { InteriorMapController } from '../src/ui/interior_map_controller';

function worldIn(dungeonId: string): IWorld {
  const origin = instanceOrigin(DUNGEONS[dungeonId].index, 0);
  const player = {
    id: 1,
    kind: 'player',
    templateId: 'warrior',
    name: 'Mapper',
    pos: { x: origin.x, y: 0, z: origin.z },
    facing: 0,
  };
  return {
    player,
    entities: new Map([[player.id, player]]),
    partyInfo: null,
    riftFloor: null,
    delveRun: null,
  } as unknown as IWorld;
}

function worldAtInterior(interior: string): IWorld {
  const entry = Object.entries(DUNGEONS).find(([, dungeon]) => dungeon.interior === interior);
  if (!entry) throw new Error(`missing ${interior} dungeon fixture`);
  return worldIn(entry[0]);
}

describe('InteriorMapController', () => {
  it.each(['hollow_crypt', IGNIVAR_MOLTEN_ASSEMBLY_ID])(
    'routes generic interior %s through the dungeon painter',
    (dungeonId) => {
      const controller = new InteriorMapController({} as never, () => '#fff');
      const world = worldIn(dungeonId);
      const ctx = {} as CanvasRenderingContext2D;
      const label = {} as HTMLElement;
      expect(controller.paintMinimap(ctx, world, label, 162, 1.25)).toBe(true);
      expect(controller.paintWorldMap(ctx, world, 560)).toEqual({
        model: { markers: [] },
        title: 'Dungeon title',
      });
      expect(calls.dungeonMinimap).toHaveBeenCalledWith(ctx, world, label, 162, 1.25);
      // The anchor defaults to the local player's own position.
      expect(calls.dungeonWorld).toHaveBeenCalledWith(ctx, world, 560, world.player.pos);
    },
  );

  it('draws the dungeon a PARTY MEMBER stands in when the anchor is theirs, not the viewer', () => {
    const controller = new InteriorMapController({} as never, () => '#fff');
    const ctx = {} as CanvasRenderingContext2D;
    const outside = worldIn('hollow_crypt');
    (outside.player as { pos: { x: number; y: number; z: number } }).pos = { x: 0, y: 0, z: 0 };
    expect(controller.paintWorldMap(ctx, outside, 560)).toBeNull();
    const origin = instanceOrigin(DUNGEONS.hollow_crypt.index, 3);
    const anchor = { x: origin.x + 2, z: origin.z - 1 };
    expect(controller.paintWorldMap(ctx, outside, 560, anchor)).toEqual({
      model: { markers: [] },
      title: 'Dungeon title',
    });
    expect(calls.dungeonWorld).toHaveBeenLastCalledWith(ctx, outside, 560, anchor);
    const keep = instanceOrigin(DUNGEONS.the_last_keep.index, 0);
    expect(controller.paintWorldMap(ctx, outside, 560, { x: keep.x, z: keep.z })).toEqual({
      model: null,
      title: 'Last Keep title',
    });
  });

  it('preserves the dedicated Last Keep and Dawnhold map painters', () => {
    const controller = new InteriorMapController({} as never, () => '#fff');
    const ctx = {} as CanvasRenderingContext2D;
    const label = {} as HTMLElement;
    const lastKeep = worldAtInterior('lastkeep');
    const dawnhold = worldAtInterior('dawnhold');

    expect(controller.paintMinimap(ctx, lastKeep, label, 162, 1.25)).toBe(true);
    expect(controller.paintMinimap(ctx, dawnhold, label, 162, 1.25)).toBe(true);
    expect(controller.paintWorldMap(ctx, lastKeep, 560)).toEqual({
      title: 'Last Keep title',
      model: null,
    });
    expect(controller.paintWorldMap(ctx, dawnhold, 560)).toEqual({
      title: 'Dawnhold title',
      model: null,
    });
    expect(calls.dungeonWorld).not.toHaveBeenCalledWith(ctx, lastKeep, 560, lastKeep.player.pos);
    expect(calls.lastKeepMinimap).toHaveBeenCalledWith(ctx, lastKeep, label, 162, 1.25);
    expect(calls.dawnholdMinimap).toHaveBeenCalledWith(ctx, dawnhold, label, 162, 1.25);
    expect(calls.lastKeepWorld).toHaveBeenCalledWith(ctx, lastKeep, 560, lastKeep.player.pos);
    expect(calls.dawnholdWorld).toHaveBeenCalledWith(ctx, dawnhold, 560, dawnhold.player.pos);
  });

  it('paints a raid with an atlas through the atlas minimap, falling back to the plan', () => {
    const setText = vi.fn();
    const controller = new InteriorMapController(
      { setText } as never,
      () => '#fff',
      () => false,
    );
    const world = worldIn('smith_heart');
    const ctx = {} as CanvasRenderingContext2D;
    const label = {} as HTMLElement;
    calls.atlasPaints = true;
    calls.dungeonMinimap.mockClear();
    expect(controller.paintMinimap(ctx, world, label, 162, 2)).toBe(true);
    const [actx, aworld, anchor, size, zoom, scale] = calls.atlasMinimap.mock.lastCall ?? [];
    expect([actx, aworld, size, zoom, scale]).toEqual([ctx, world, 162, 2, 1.7 * 2]);
    expect((anchor as { dungeonId: string }).dungeonId).toBe('smith_heart');
    expect(setText).toHaveBeenCalledWith(label, 'smith_heart title');
    expect(calls.dungeonMinimap).not.toHaveBeenCalled();
    // Before the atlas can draw (its stylesheet not landed), the plain plan does.
    calls.atlasPaints = false;
    expect(controller.paintMinimap(ctx, world, label, 162, 2)).toBe(true);
    expect(calls.dungeonMinimap).toHaveBeenCalledWith(ctx, world, label, 162, 2);
    calls.atlasPaints = true;
  });

  it('never asks the atlas to paint a dungeon that has none', () => {
    const controller = new InteriorMapController(
      {} as never,
      () => '#fff',
      () => false,
    );
    calls.atlasMinimap.mockClear();
    const world = worldIn('hollow_crypt');
    const ctx = {} as CanvasRenderingContext2D;
    expect(controller.paintMinimap(ctx, world, {} as HTMLElement, 162, 1)).toBe(true);
    expect(calls.atlasMinimap).not.toHaveBeenCalled();
    expect(calls.dungeonMinimap).toHaveBeenLastCalledWith(ctx, world, {}, 162, 1);
  });
});
