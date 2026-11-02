import { describe, expect, it, vi } from 'vitest';
import { GOURDLIGHT_PUMPKINS } from '../src/sim/content/gourdlight_pumpkins';
import { QuestTrackerController } from '../src/ui/hud/quest/quest_tracker_controller';
import { makeWriterFacet } from '../src/ui/painter_host';
import { QuestTrackingState } from '../src/ui/quest_tracking_core';
import type { IWorld } from '../src/world_api';

describe('Haunted Pumpkin tracker integration', () => {
  it('shows without quests, elides unchanged HTML, and removes on event end', () => {
    const first = GOURDLIGHT_PUMPKINS[0];
    const world = {
      cfg: { playerClass: 'warrior' },
      player: { name: 'Explorer', pos: { x: first.x, y: 0, z: first.z } },
      questLog: new Map(),
      worldQuestLog: new Map(),
      activeSeasonalEvent: 'gourdlight_eve' as string | null,
      hauntedPumpkinsFound: [] as string[],
    };
    let html = '';
    const paint = vi.fn((value: string) => {
      html = value;
    });
    const element = {
      set innerHTML(value: string) {
        paint(value);
      },
    } as HTMLElement;
    const controller = new QuestTrackerController({
      writers: makeWriterFacet(
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        () => {},
        () => {},
      ),
      world: () => world as unknown as IWorld,
      element,
      document: {} as Document,
      settings: { available: () => false, collapsed: () => false, setCollapsed: () => {} },
      tracking: new QuestTrackingState({ getItem: () => null, setItem: () => {} }),
      questTitle: () => '',
      objectiveLabel: () => '',
      click: () => {},
    });
    controller.update(0);
    expect(html).toContain('Haunted Pumpkins');
    expect(html).toContain('World: 0/');
    expect(html).not.toContain('data-quest=');
    expect(html).not.toContain('qt-num');
    const paints = paint.mock.calls.length;
    controller.update(1);
    expect(paint).toHaveBeenCalledTimes(paints);
    world.hauntedPumpkinsFound = [first.id];
    controller.update(2);
    expect(html).toContain('World: 1/');
    world.activeSeasonalEvent = null;
    controller.update(3);
    expect(html).not.toContain('Haunted Pumpkins');
  });
});
