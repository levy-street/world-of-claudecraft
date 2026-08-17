// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
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

  it('renders the exact Delve Mark painting in the tracker balance row', () => {
    const element = document.createElement('div');
    const world = {
      delveRun: run(),
      delveMarks: 41,
    } as Pick<IWorld, 'delveRun' | 'delveMarks'>;
    const controller = new DelveTrackerController({
      element,
      world: () => world,
      delveName: () => 'Test Delve',
      mobName: () => 'Test Boss',
      attachTooltip: () => {},
      closeRitePanel: () => {},
    });

    controller.update();

    const marksRows = [...element.querySelectorAll<HTMLElement>('.dt-obj')].filter((row) =>
      row.querySelector('img.currency-delve_mark'),
    );
    expect(marksRows).toHaveLength(1);
    expect(marksRows[0].textContent).toContain('41');
    const image = marksRows[0].querySelector<HTMLImageElement>('img');
    expect({
      className: image?.className,
      src: image?.getAttribute('src'),
      alt: image?.getAttribute('alt'),
      draggable: image?.getAttribute('draggable'),
    }).toEqual({
      className: 'currency-inline currency-delve_mark',
      src: '/ui/currency/delve_mark.webp',
      alt: '',
      draggable: 'false',
    });
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

  it('renders implemented affixes with their exact painted identities', () => {
    const tracker = trackerElement();
    const world = {
      delveRun: run({ affixes: ['high_water', 'lively_choir', 'belligerent_dead'] }),
      delveMarks: 0,
    } as Pick<IWorld, 'delveRun' | 'delveMarks'>;
    const controller = new DelveTrackerController({
      element: tracker.element,
      world: () => world,
      delveName: () => 'Test Delve',
      mobName: () => 'Test Boss',
      attachTooltip: () => {},
      closeRitePanel: () => {},
    });

    controller.update();

    expect(tracker.element.innerHTML).toContain('/ui/delve-affixes/high_water.webp');
    expect(tracker.element.innerHTML).toContain('/ui/delve-affixes/lively_choir.webp');
    expect(tracker.element.innerHTML).toContain('/ui/delve-affixes/belligerent_dead.webp');
    expect(tracker.element.innerHTML).not.toContain('background:#888');
  });

  it('replaces a failed affix image with its distinct accessible color fallback', () => {
    const element = document.createElement('div');
    const attachTooltip = vi.fn();
    const world = {
      delveRun: run({ affixes: ['high_water'] }),
      delveMarks: 0,
    } as Pick<IWorld, 'delveRun' | 'delveMarks'>;
    const controller = new DelveTrackerController({
      element,
      world: () => world,
      delveName: () => 'Test Delve',
      mobName: () => 'Test Boss',
      attachTooltip,
      closeRitePanel: () => {},
    });

    controller.update();

    const image = element.querySelector<HTMLImageElement>('img.dt-affix-icon');
    expect(image?.src).toContain('/ui/delve-affixes/high_water.webp');
    image?.dispatchEvent(new Event('error'));
    const fallback = element.querySelector<HTMLElement>('span.dt-affix-icon');
    expect(fallback?.style.background).toBe('#2f718c');
    expect(fallback?.getAttribute('role')).toBe('img');
    expect(fallback?.tabIndex).toBe(0);
    expect(fallback?.getAttribute('aria-label')).toBeTruthy();
    expect(attachTooltip).toHaveBeenCalledTimes(2);
  });

  it('keeps an accessible neutral fallback for an unknown mixed-release affix', () => {
    const element = document.createElement('div');
    const attachTooltip = vi.fn();
    const world = {
      delveRun: run({ affixes: ['future_affix'] }),
      delveMarks: 0,
    } as Pick<IWorld, 'delveRun' | 'delveMarks'>;
    const controller = new DelveTrackerController({
      element,
      world: () => world,
      delveName: () => 'Test Delve',
      mobName: () => 'Test Boss',
      attachTooltip,
      closeRitePanel: () => {},
    });

    controller.update();

    expect(element.querySelector('img.dt-affix-icon')).toBeNull();
    const fallback = element.querySelector<HTMLElement>('span.dt-affix-icon');
    expect(fallback?.style.background).toBe('#888');
    expect(fallback?.getAttribute('role')).toBe('img');
    expect(fallback?.tabIndex).toBe(0);
    expect(fallback?.getAttribute('aria-label')).toBe('future_affix');
    expect(attachTooltip).toHaveBeenCalledTimes(1);
  });

  it('keeps every focusable touch affix at the 40px target floor', () => {
    const css = readFileSync('src/styles/hud.mobile.css', 'utf8');
    const rule = css.match(/body\.mobile-touch #delve-tracker \.dt-affix-icon \{([^}]+)\}/)?.[1];
    expect(rule).toContain('width: 40px;');
    expect(rule).toContain('height: 40px;');
  });
});
