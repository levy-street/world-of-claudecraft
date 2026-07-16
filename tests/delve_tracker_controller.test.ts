import { describe, expect, it, vi } from 'vitest';
import { DelveTrackerController } from '../src/ui/hud/delve/delve_tracker_controller';
import type { DelveRunInfo, IWorld } from '../src/world_api';

function trackerElement() {
  let html = '';
  let writes = 0;
  const element = {
    style: { display: '' },
    get innerHTML() {
      return html;
    },
    set innerHTML(value: string) {
      html = value;
      writes++;
    },
    querySelectorAll: () => [],
  } as unknown as HTMLElement;
  return { element, writes: () => writes };
}

function run(overrides: Partial<DelveRunInfo> = {}): DelveRunInfo {
  return {
    delveId: 'collapsed_reliquary',
    tierId: 'normal',
    slot: 0,
    origin: { x: 0, z: 0 },
    moduleIndex: 0,
    moduleCount: 2,
    modules: ['reliquary_sunken_ossuary', 'reliquary_finale'],
    objective: { kind: 'kill_boss', counts: [0], complete: false },
    affixes: [],
    completed: false,
    exitPortalOpen: false,
    bountiful: false,
    rite: null,
    ...overrides,
  };
}

describe('DelveTrackerController', () => {
  it('hides and clears stale tracker content when the authoritative run ends', () => {
    const tracker = trackerElement();
    tracker.element.innerHTML = 'stale';
    const closeRitePanel = vi.fn();
    const world = { delveRun: null, delveMarks: 0 } as Pick<IWorld, 'delveRun' | 'delveMarks'>;
    const controller = new DelveTrackerController({
      element: tracker.element,
      world: () => world,
      delveName: () => 'Test Delve',
      mobName: () => 'Test Boss',
      attachTooltip: () => {},
      closeRitePanel,
    });

    controller.update();

    expect(tracker.element.style.display).toBe('none');
    expect(tracker.element.innerHTML).toBe('');
    expect(closeRitePanel).toHaveBeenCalledWith(false);
  });

  it('elides identical paints and repaints when authoritative marks change', () => {
    const tracker = trackerElement();
    const world = { delveRun: run(), delveMarks: 3 } as Pick<IWorld, 'delveRun' | 'delveMarks'>;
    const controller = new DelveTrackerController({
      element: tracker.element,
      world: () => world,
      delveName: () => 'Test Delve',
      mobName: () => 'Test Boss',
      attachTooltip: () => {},
      closeRitePanel: () => {},
    });

    controller.update();
    controller.update();
    expect(tracker.writes()).toBe(1);
    expect(tracker.element.innerHTML).toContain('Test Delve');

    world.delveMarks = 4;
    controller.update();
    expect(tracker.writes()).toBe(2);
  });

  it('closes the rite chooser as soon as the mirrored phase advances', () => {
    const tracker = trackerElement();
    const closeRitePanel = vi.fn();
    const world = {
      delveRun: run({ rite: { phase: 'playback', current: 0, total: 3 } }),
      delveMarks: 0,
    } as Pick<IWorld, 'delveRun' | 'delveMarks'>;
    const controller = new DelveTrackerController({
      element: tracker.element,
      world: () => world,
      delveName: () => 'Test Delve',
      mobName: () => 'Test Boss',
      attachTooltip: () => {},
      closeRitePanel,
    });

    controller.update();

    expect(closeRitePanel).toHaveBeenCalledWith(false);
  });
});
