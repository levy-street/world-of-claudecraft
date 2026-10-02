import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIRE_AND_FLY_DUNGEON_ID } from '../src/sim/content/fire_and_fly_arena';
import {
  TURRET_SCENARIO_HARD,
  TURRET_SCENARIO_INTRODUCTION,
  TURRET_SCENARIO_STANDARD,
} from '../src/sim/content/fire_and_fly_scenarios';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { IGNIVAR_MOLTEN_ASSEMBLY_ID } from '../src/sim/ignivar_raid_ids';
import { createTurretDefense } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { turretSessionView } from '../src/sim/turret_defense_session';
import type { TurretScenarioDef } from '../src/sim/types';
import { DungeonMapPainter } from '../src/ui/dungeon_map_painter';
import { dungeonDisplayName } from '../src/ui/entity_i18n';
import { setLanguage } from '../src/ui/i18n';
import { makeWriterFacet, type PainterHostWriters } from '../src/ui/painter_host';
import type { IWorld } from '../src/world_api';
import type { TurretSessionView } from '../src/world_api/vehicles';

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

function seatView(scenario: TurretScenarioDef): TurretSessionView {
  return turretSessionView({
    kind: 'turret',
    origin: { x: 0, y: 0, z: 0 },
    defense: createTurretDefense(resolveTurretPlan(scenario), { x: 0, z: 0 }, 9, 100),
    priorMountKey: '',
    returnTo: { x: 0, y: 0, z: 0, facing: 0 },
    feedback: [],
    nextFeedbackSeq: 1,
  });
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

  describe('in the Fire and Fly arena', () => {
    function arenaRig() {
      setLanguage('en');
      const writes = vi.fn();
      const writers = makeWriterFacet(
        new Map(),
        new WeakMap(),
        new WeakMap(),
        new WeakMap(),
        writes,
        () => {},
      );
      const painter = new DungeonMapPainter(writers, (cls) => `class:${cls}`);
      const label = { textContent: '' } as HTMLElement;
      const world = worldIn(FIRE_AND_FLY_DUNGEON_ID) as IWorld & {
        turretSession: TurretSessionView | null;
      };
      const paint = () =>
        painter.paintMinimap(
          new RecordingContext() as unknown as CanvasRenderingContext2D,
          world,
          label,
          162,
          1,
        );
      return { writes, label, world, paint };
    }

    it.each([
      [TURRET_SCENARIO_INTRODUCTION, "Recruit's Trial"],
      [TURRET_SCENARIO_STANDARD, 'Standing Watch'],
      [TURRET_SCENARIO_HARD, "Veterans' Test"],
    ] as const)("labels the minimap with the %# seat's trial", (scenario, name) => {
      const { label, world, paint } = arenaRig();
      world.turretSession = seatView(scenario);
      paint();
      expect(label.textContent).toBe(name);
    });

    it('keeps the arena name outside a session, and writes the label only on change', () => {
      const { writes, label, world, paint } = arenaRig();
      world.turretSession = null;
      paint();
      expect(label.textContent).toBe(dungeonDisplayName(FIRE_AND_FLY_DUNGEON_ID));
      expect(writes).toHaveBeenCalledTimes(1);
      writes.mockClear();
      for (let i = 0; i < 5; i++) paint();
      expect(writes).not.toHaveBeenCalled();
      world.turretSession = seatView(TURRET_SCENARIO_HARD);
      paint();
      paint();
      expect(label.textContent).toBe("Veterans' Test");
      expect(writes).toHaveBeenCalledTimes(1);
      writes.mockClear();
      world.turretSession = null;
      paint();
      expect(label.textContent).toBe('Fire and Fly');
      expect(writes).toHaveBeenCalledTimes(1);
    });
  });
});
