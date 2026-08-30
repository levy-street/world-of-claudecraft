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
}));

vi.mock('../src/ui/dungeon_map_painter', () => ({
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
      expect(controller.paintDungeonWorldMap(ctx, world, 560)).toEqual({
        model: { markers: [] },
        title: 'Dungeon title',
      });
      expect(calls.dungeonMinimap).toHaveBeenCalledWith(ctx, world, label, 162, 1.25);
      expect(calls.dungeonWorld).toHaveBeenCalledWith(ctx, world, 560);
    },
  );

  it('preserves the dedicated Last Keep and Dawnhold map painters', () => {
    const controller = new InteriorMapController({} as never, () => '#fff');
    const ctx = {} as CanvasRenderingContext2D;
    const label = {} as HTMLElement;
    const lastKeep = worldAtInterior('lastkeep');
    const dawnhold = worldAtInterior('dawnhold');

    expect(controller.paintMinimap(ctx, lastKeep, label, 162, 1.25)).toBe(true);
    expect(controller.paintMinimap(ctx, dawnhold, label, 162, 1.25)).toBe(true);
    expect(controller.paintDungeonWorldMap(ctx, lastKeep, 560)).toBeNull();
    expect(controller.paintDungeonWorldMap(ctx, dawnhold, 560)).toBeNull();
    expect(controller.paintCastleWorldMap(ctx, lastKeep, 560)).toBe('Last Keep title');
    expect(controller.paintCastleWorldMap(ctx, dawnhold, 560)).toBe('Dawnhold title');
    expect(calls.lastKeepMinimap).toHaveBeenCalledWith(ctx, lastKeep, label, 162, 1.25);
    expect(calls.dawnholdMinimap).toHaveBeenCalledWith(ctx, dawnhold, label, 162, 1.25);
    expect(calls.lastKeepWorld).toHaveBeenCalledWith(ctx, lastKeep, 560);
    expect(calls.dawnholdWorld).toHaveBeenCalledWith(ctx, dawnhold, 560);
  });
});
