import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { IGNIVAR_MOLTEN_ASSEMBLY_ID } from '../src/sim/ignivar_raid_ids';
import { DungeonMapPainter } from '../src/ui/dungeon_map_painter';
import { dungeonDisplayName } from '../src/ui/entity_i18n';
import type { PainterHostWriters } from '../src/ui/painter_host';
import type { IWorld } from '../src/world_api';

class RecordingContext {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  globalAlpha = 1;
  font = '';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  lineCap: CanvasLineCap = 'butt';
  lineJoin: CanvasLineJoin = 'miter';
  draws = 0;
  texts: string[] = [];
  clearRect(): void {}
  fillRect(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  fill(): void {}
  stroke(): void {}
  arc(): void {}
  save(): void {}
  restore(): void {}
  clip(): void {}
  translate(): void {}
  rotate(): void {}
  drawImage(): void {
    this.draws++;
  }
  strokeText(text: string): void {
    this.texts.push(text);
  }
  fillText(text: string): void {
    this.texts.push(text);
  }
}

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

describe('DungeonMapPainter', () => {
  const setText = vi.fn();
  let createdContexts: RecordingContext[];

  beforeEach(() => {
    createdContexts = [];
    setText.mockClear();
    vi.stubGlobal('document', {
      documentElement: {},
      createElement: () => {
        const context = new RecordingContext();
        createdContexts.push(context);
        return { width: 0, height: 0, getContext: () => context };
      },
    });
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) => `paint:${name}`,
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(['hollow_crypt', IGNIVAR_MOLTEN_ASSEMBLY_ID])(
    'paints %s on the minimap and M-map with its localized title',
    (dungeonId) => {
      const painter = new DungeonMapPainter(
        { setText } as unknown as PainterHostWriters,
        (cls) => `class:${cls}`,
      );
      const minimap = new RecordingContext();
      const label = {} as HTMLElement;
      painter.paintMinimap(
        minimap as unknown as CanvasRenderingContext2D,
        worldIn(dungeonId),
        label,
        162,
        1,
      );
      expect(setText).toHaveBeenCalledWith(label, dungeonDisplayName(dungeonId));
      expect(minimap.draws).toBe(1);

      const map = new RecordingContext();
      const result = painter.paintWorldMap(
        map as unknown as CanvasRenderingContext2D,
        worldIn(dungeonId),
        560,
      );
      expect(result?.title).toBe(dungeonDisplayName(dungeonId));
      expect(map.draws).toBe(1);
      expect(map.texts).toEqual([result?.title, result?.title]);
      expect(createdContexts.length).toBeGreaterThan(0);
    },
  );
});
