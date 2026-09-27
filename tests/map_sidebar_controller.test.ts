// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NPCS, QUESTS, zoneAt } from '../src/sim/data';
import type { QuestProgress, WorldQuestProgress } from '../src/sim/types';
import { worldQuestCycleForResetDay } from '../src/sim/world_quest_rotation';
import { activeWorldQuestsForCycle } from '../src/sim/world_quests';
import { MapSidebarController } from '../src/ui/map_sidebar_controller';
import { QuestTrackingState } from '../src/ui/quest_tracking_core';
import type { IWorld } from '../src/world_api';

/** An in-memory Storage stand-in, so the rail's tracking set never reaches (or
 *  leaks into) the shared per-character rows. */
function fakeStorage() {
  const rows = new Map<string, string>();
  return {
    rows,
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
  };
}

/** The rail collapse's settings port (the quest-tracker test's fake, mirrored):
 *  a real available/collapsed/setCollapsed loop over a local flag, so a test
 *  can drive the toggle exactly like the real optionsHooks-backed one does. */
function fakeSettings() {
  let collapsed = false;
  return {
    available: vi.fn(() => true),
    collapsed: vi.fn(() => collapsed),
    setCollapsed: vi.fn((next: boolean) => {
      collapsed = next;
    }),
  };
}

function makeHarness(alsoTracked: readonly string[] = []) {
  const root = document.createElement('aside');
  document.body.appendChild(root);
  const giver = NPCS[QUESTS.q_wolves.giverNpcId];
  const quest: QuestProgress = { questId: 'q_wolves', counts: [2], state: 'active' };
  const log = new Map<string, QuestProgress>([['q_wolves', quest]]);
  for (const questId of alsoTracked) {
    log.set(questId, { questId, counts: [0], state: 'active' });
  }
  const world = {
    cfg: { playerClass: 'warrior' },
    player: { name: 'Adventurer', pos: { x: giver.pos.x, y: 0, z: giver.pos.z } },
    questLog: log,
    questState: () => 'unavailable',
  } as unknown as IWorld;
  const click = vi.fn();
  const onRepaintMap = vi.fn();
  const onShowRoute = vi.fn();
  const storage = fakeStorage();
  const tracking = new QuestTrackingState(storage);
  const settings = fakeSettings();
  const controller = new MapSidebarController({
    root: () => root,
    click,
    onRepaintMap,
    onShowRoute,
    tracking,
    settings,
  });
  controller.update(world, zoneAt(giver.pos.x, giver.pos.z));
  return { root, controller, click, onRepaintMap, onShowRoute, world, tracking, storage, settings };
}

describe('map sidebar controller', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the complete atlas rail from the current world', () => {
    const test = makeHarness();
    expect(test.root.querySelectorAll('[data-map-filter]')).toHaveLength(5);
    expect(test.root.querySelector('[data-map-quest="q_wolves"]')).not.toBeNull();
    expect(test.root.querySelector('[data-map-route]')).not.toBeNull();
    expect(test.root.querySelectorAll('.map-atlas-legend > span')).toHaveLength(5);
    expect(test.root.textContent).toContain('Tracked quests');
    expect(test.root.textContent).toContain('Available nearby');
  });

  it('publishes filter changes and the selected quest route', () => {
    const test = makeHarness();
    test.root.querySelector<HTMLElement>('[data-map-filter="services"]')?.click();
    expect(test.onRepaintMap).toHaveBeenCalled();
    expect(test.controller.filterState()).toMatchObject({ services: false, quests: true });

    test.root.querySelector<HTMLElement>('[data-map-route]')?.click();
    expect(test.onShowRoute).toHaveBeenCalledWith(expect.objectContaining({ questId: 'q_wolves' }));
    expect(test.controller.shownRoute()).toMatchObject({ questId: 'q_wolves' });
    expect(test.root.querySelector('[data-map-route]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the toggled filter chip focused across the rail swap', () => {
    const test = makeHarness();
    const chip = test.root.querySelector<HTMLElement>('[data-map-filter="services"]');
    chip?.focus();
    expect(document.activeElement).toBe(chip);

    chip?.click();

    const repainted = test.root.querySelector<HTMLElement>('[data-map-filter="services"]');
    expect(repainted).not.toBe(chip);
    expect(document.activeElement).toBe(repainted);
    expect(repainted?.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the selected quest row focused across the rail swap', () => {
    const test = makeHarness(['q_boars']);
    const row = test.root.querySelector<HTMLElement>('[data-map-quest="q_boars"]');
    row?.focus();

    row?.click();

    const repainted = test.root.querySelector<HTMLElement>('[data-map-quest="q_boars"]');
    expect(repainted).not.toBe(row);
    expect(document.activeElement).toBe(repainted);
    expect(repainted?.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the Show Route button focused after it publishes a route', () => {
    const test = makeHarness();
    const route = test.root.querySelector<HTMLElement>('[data-map-route]');
    route?.focus();

    route?.click();

    const repainted = test.root.querySelector<HTMLElement>('[data-map-route]');
    expect(repainted).not.toBe(route);
    expect(document.activeElement).toBe(repainted);
  });

  it('leaves focus alone when it was never inside the rail', () => {
    const test = makeHarness();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    test.root.querySelector<HTMLElement>('[data-map-filter="services"]')?.click();

    expect(document.activeElement).toBe(outside);
  });

  it('untracks a quest for real: the row LEAVES the rail, the quest is not abandoned', () => {
    const test = makeHarness();
    const abandonQuest = vi.fn();
    Object.assign(test.world, { abandonQuest });
    expect(test.root.querySelector('[data-map-quest="q_wolves"]')).not.toBeNull();

    test.root.querySelector<HTMLElement>('[data-map-untrack]')?.click();
    test.controller.update(test.world, zoneAt(test.world.player.pos.x, test.world.player.pos.z));

    // The regression this covers: the control used to clear the local selection
    // only, leaving the same quest listed under "Tracked quests".
    expect(test.root.querySelector('[data-map-quest="q_wolves"]')).toBeNull();
    expect(test.root.textContent).toContain('No tracked quests');
    expect(test.tracking.isTracked('q_wolves')).toBe(false);
    expect(test.controller.shownRoute()).toBeNull();
    expect(test.onRepaintMap).toHaveBeenCalled();
    // Presentation only: the sim's quest log is untouched.
    expect(abandonQuest).not.toHaveBeenCalled();
    expect(test.world.questLog.has('q_wolves')).toBe(true);
    expect(test.root.querySelector('[data-map-untrack]')?.hasAttribute('disabled')).toBe(true);
  });

  it('persists the untracked quest per character and reloads it on the next session', () => {
    const test = makeHarness();
    test.root.querySelector<HTMLElement>('[data-map-untrack]')?.click();

    const reloaded = new QuestTrackingState(test.storage);
    reloaded.useCharacter('warrior', 'Adventurer');
    expect(reloaded.isTracked('q_wolves')).toBe(false);

    // Another character on the same browser starts fully tracked.
    const other = new QuestTrackingState(test.storage);
    other.useCharacter('mage', 'Someone');
    expect(other.isTracked('q_wolves')).toBe(true);
  });

  it('re-tracking (the quest log toggle) brings the row back to the rail', () => {
    const test = makeHarness();
    test.root.querySelector<HTMLElement>('[data-map-untrack]')?.click();
    expect(test.root.querySelector('[data-map-quest="q_wolves"]')).toBeNull();

    test.tracking.setTracked('q_wolves', true);
    test.controller.update(test.world, zoneAt(test.world.player.pos.x, test.world.player.pos.z));

    // The rail's repaint signature carries the tracking revision, so nothing else
    // has to move for the row to come back.
    expect(test.root.querySelector('[data-map-quest="q_wolves"]')).not.toBeNull();
  });
});

describe('map sidebar controller: rail collapse toggle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the toggle expanded by default, with the body it controls present', () => {
    const test = makeHarness();
    const toggle = test.root.querySelector<HTMLElement>('[data-map-sidebar-toggle]');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle?.getAttribute('aria-controls')).toBe('map-atlas-body');
    expect(test.root.querySelector('#map-atlas-body')).not.toBeNull();
    expect(test.root.classList.contains('is-collapsed')).toBe(false);
  });

  it('collapses on click: the root gains is-collapsed, the toggle flips, and the choice persists', () => {
    const test = makeHarness();

    test.root.querySelector<HTMLElement>('[data-map-sidebar-toggle]')?.click();

    expect(test.settings.setCollapsed).toHaveBeenCalledWith(true);
    expect(test.root.classList.contains('is-collapsed')).toBe(true);
    const toggle = test.root.querySelector<HTMLElement>('[data-map-sidebar-toggle]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    // The body stays in the DOM (CSS hides it): the button's aria-controls
    // keeps naming a real element instead of an id that vanished.
    expect(test.root.querySelector('#map-atlas-body')).not.toBeNull();
  });

  it('expands again on a second click', () => {
    const test = makeHarness();
    test.root.querySelector<HTMLElement>('[data-map-sidebar-toggle]')?.click();

    test.root.querySelector<HTMLElement>('[data-map-sidebar-toggle]')?.click();

    expect(test.settings.setCollapsed).toHaveBeenLastCalledWith(false);
    expect(test.root.classList.contains('is-collapsed')).toBe(false);
    expect(
      test.root.querySelector('[data-map-sidebar-toggle]')?.getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('keeps the toggle focused across the rail swap', () => {
    const test = makeHarness();
    const toggle = test.root.querySelector<HTMLElement>('[data-map-sidebar-toggle]');
    toggle?.focus();
    expect(document.activeElement).toBe(toggle);

    toggle?.click();

    const repainted = test.root.querySelector<HTMLElement>('[data-map-sidebar-toggle]');
    expect(repainted).not.toBe(toggle);
    expect(document.activeElement).toBe(repainted);
  });

  it('is a no-op while the settings port is unavailable (before Hud.attachOptions runs)', () => {
    const test = makeHarness();
    test.settings.available.mockReturnValue(false);

    test.root.querySelector<HTMLElement>('[data-map-sidebar-toggle]')?.click();

    expect(test.settings.setCollapsed).not.toHaveBeenCalled();
    expect(test.root.classList.contains('is-collapsed')).toBe(false);
  });

  it('opens already collapsed when the persisted setting says so', () => {
    const root = document.createElement('aside');
    document.body.appendChild(root);
    const giver = NPCS[QUESTS.q_wolves.giverNpcId];
    const world = {
      cfg: { playerClass: 'warrior' },
      player: { name: 'Adventurer', pos: { x: giver.pos.x, y: 0, z: giver.pos.z } },
      questLog: new Map<string, QuestProgress>(),
      questState: () => 'unavailable',
    } as unknown as IWorld;
    const settings = fakeSettings();
    settings.setCollapsed(true);
    const controller = new MapSidebarController({
      root: () => root,
      click: vi.fn(),
      onRepaintMap: vi.fn(),
      onShowRoute: vi.fn(),
      tracking: new QuestTrackingState(fakeStorage()),
      settings,
    });

    controller.update(world, zoneAt(giver.pos.x, giver.pos.z));

    expect(root.classList.contains('is-collapsed')).toBe(true);
    expect(root.querySelector('[data-map-sidebar-toggle]')?.getAttribute('aria-expanded')).toBe(
      'false',
    );
  });
});

// The headerless map window has exactly ONE drag surface: the --window-pad band
// around its two panes (Hud.isWindowDragHandle returns true only for
// `target === win`). Both panes are absolutely positioned, and an absolutely
// positioned child resolves against the PADDING box, so an `inset: 0` pane
// covers that band and the window stops being draggable at all. jsdom has no
// layout, so this reads the shipped declarations instead of a computed rect.
describe('map sidebar controller: the world-quest section', () => {
  function makeWorldQuestHarness(
    log: Array<[string, WorldQuestProgress['state']]> = [],
    canReroll: () => { canReroll: boolean; reason?: string } = () => ({ canReroll: true }),
  ) {
    const root = document.createElement('aside');
    document.body.appendChild(root);
    const giver = NPCS[QUESTS.q_wolves.giverNpcId];
    const cycle = worldQuestCycleForResetDay('2026-08-31');
    const rerollWorldQuest = vi.fn(() => true);
    const world = {
      cfg: { playerClass: 'warrior' },
      player: { name: 'Adventurer', level: 20, pos: { x: giver.pos.x, y: 0, z: giver.pos.z } },
      questLog: new Map(),
      questState: () => 'unavailable',
      worldQuestCycle: cycle,
      worldQuestLog: new Map(
        log.map(([questId, state]) => [questId, { questId, count: 0, state }]),
      ),
      worldQuestExpiresAtMs: 10_000,
      canRerollWorldQuest: canReroll,
      rerollWorldQuest,
    } as unknown as IWorld;
    let selected: string | null = null;
    const confirmDialog = vi.fn();
    const onRepaintMap = vi.fn();
    const controller = new MapSidebarController({
      root: () => root,
      click: vi.fn(),
      onRepaintMap,
      onShowRoute: vi.fn(),
      settings: fakeSettings(),
      tracking: new QuestTrackingState(fakeStorage()),
      worldQuests: {
        selectedId: () => selected,
        select: (questId) => {
          selected = questId;
        },
        confirmDialog,
        nowMs: () => 4_000,
      },
    });
    controller.update(world, zoneAt(giver.pos.x, giver.pos.z));
    return {
      root,
      controller,
      world,
      confirmDialog,
      onRepaintMap,
      rerollWorldQuest,
      cycle,
      selectedId: () => selected,
    };
  }

  it('renders the day board with its count and a disabled Replace button until a row is selected', () => {
    const board = activeWorldQuestsForCycle(worldQuestCycleForResetDay('2026-08-31'));
    const { root } = makeWorldQuestHarness([[board[0].id, 'completed']]);
    const rows = root.querySelectorAll<HTMLElement>('[data-map-wq]');
    expect(rows.length).toBe(board.length);
    expect(root.querySelector('.map-atlas-wq-count')?.textContent).toBe(`1 / ${board.length}`);
    expect(root.querySelector('.map-atlas-wq.is-completed')).not.toBeNull();
    const button = root.querySelector<HTMLButtonElement>('[data-map-wq-reroll]');
    expect(button?.disabled).toBe(true);
  });

  it('selecting a row shares the selection with the map and repaints it', () => {
    const { root, onRepaintMap, selectedId } = makeWorldQuestHarness();
    const first = root.querySelector<HTMLElement>('[data-map-wq]');
    const questId = first?.dataset.mapWq ?? '';
    first?.click();
    expect(selectedId()).toBe(questId);
    expect(onRepaintMap).toHaveBeenCalled();
    expect(root.querySelector('.map-atlas-wq.is-selected')?.getAttribute('data-map-wq')).toBe(
      questId,
    );
    expect(root.querySelector<HTMLButtonElement>('[data-map-wq-reroll]')?.disabled).toBe(false);
    // The same row again clears the selection.
    root.querySelector<HTMLElement>('[data-map-wq]')?.click();
    expect(selectedId()).toBeNull();
  });

  it('Replace never reaches the world without the confirm dialog; confirming rerolls and clears the selection', () => {
    const { root, confirmDialog, rerollWorldQuest, selectedId } = makeWorldQuestHarness();
    root.querySelector<HTMLElement>('[data-map-wq]')?.click();
    const questId = selectedId();
    root.querySelector<HTMLElement>('[data-map-wq-reroll]')?.click();
    expect(rerollWorldQuest).not.toHaveBeenCalled();
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    const onOk = confirmDialog.mock.calls[0][4] as () => void;
    onOk();
    expect(rerollWorldQuest).toHaveBeenCalledWith(questId);
    expect(selectedId()).toBeNull();
  });

  it('a refused reroll keeps the button disabled and names the reason by identity', () => {
    const { root } = makeWorldQuestHarness([], () => ({
      canReroll: false,
      reason: 'Daily world quest reroll already used today.',
    }));
    root.querySelector<HTMLElement>('[data-map-wq]')?.click();
    expect(root.querySelector<HTMLButtonElement>('[data-map-wq-reroll]')?.disabled).toBe(true);
    expect(root.querySelector('.map-atlas-wq-note')?.textContent).toBe('Replacement used today');
  });

  it('a host without world quests omits the section entirely', () => {
    const { root } = makeHarness();
    expect(root.querySelector('.map-atlas-wq-section')).toBeNull();
  });
});

describe('map window: the pad band stays the drag handle', () => {
  // join(__dirname, ...) rather than an import.meta URL: the DOM environment
  // rewrites import.meta.url to an http scheme (the bags-window precedent).
  const indexHtml = readFileSync(join(__dirname, '../index.html'), 'utf8');
  const componentsCss = readFileSync(join(__dirname, '../src/styles/components.css'), 'utf8');

  /** The body of the rule whose whole selector text is exactly `selector`. */
  function ruleBody(css: string, selector: string): string {
    const at = css.indexOf(`\n  ${selector} {`);
    expect(at, `components.css declares no rule for ${selector}`).toBeGreaterThan(-1);
    const open = css.indexOf('{', at);
    return css.slice(open + 1, css.indexOf('}', open));
  }

  function inset(selector: string): string {
    const body = ruleBody(componentsCss, selector);
    const match = body.match(/(?:^|[;{])\s*inset:([^;]*)/);
    expect(match, `${selector} declares no inset`).not.toBeNull();
    return (match?.[1] ?? '').replace(/\s+/g, ' ').trim();
  }

  it('mounts both panes as absolutely positioned direct children of #map-window', () => {
    document.body.innerHTML = '';
    const at = indexHtml.indexOf('<div id="map-window"');
    expect(at).toBeGreaterThan(-1);
    const host = document.createElement('div');
    host.innerHTML = indexHtml.slice(at, indexHtml.indexOf('<div id="arena-window"', at));
    document.body.appendChild(host);
    const win = document.getElementById('map-window');
    expect(win).not.toBeNull();
    expect(win?.querySelector(':scope > .map-atlas-sidebar')).not.toBeNull();
    expect(win?.querySelector(':scope > .map-atlas-stage')).not.toBeNull();
    for (const selector of ['.map-atlas-sidebar', '.map-atlas-stage']) {
      expect(ruleBody(componentsCss, selector)).toContain('position: absolute');
    }
  });

  it('insets the rail by the pad on the three edges it touches', () => {
    const value = inset('.map-atlas-sidebar');
    expect(value).toBe('var(--window-pad) auto var(--window-pad) var(--window-pad)');
    expect(value.startsWith('0')).toBe(false);
  });

  it('insets the stage by the pad, its left edge past the rail and the gutter', () => {
    const value = inset('.map-atlas-stage');
    // top / right / bottom are the bare pad; left clears the 300px rail + 12px gutter.
    expect(value).toBe(
      'var(--window-pad) var(--window-pad) var(--window-pad) calc(var(--window-pad) + 300px + 12px)',
    );
    expect(value).not.toContain(' 312px');
  });

  it('keeps the pad when the empty rail collapses and the stage takes the window', () => {
    const value = inset(
      'body:not(.mobile-touch) #map-window:has(> .map-atlas-sidebar:empty) .map-atlas-stage',
    );
    expect(value).toBe('var(--window-pad)');
    expect(value).not.toBe('0');
  });
});

describe('map sidebar controller: walking cadence', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /** The offers list is the only part of the rail that moves with the player, so
   *  it needs live offers to be worth measuring (the default harness has none). */
  function walkingHarness() {
    const root = document.createElement('aside');
    document.body.appendChild(root);
    const giver = NPCS[QUESTS.q_wolves.giverNpcId];
    const world = {
      cfg: { playerClass: 'warrior' },
      player: { name: 'Adventurer', pos: { x: giver.pos.x, y: 0, z: giver.pos.z } },
      questLog: new Map<string, QuestProgress>([
        ['q_wolves', { questId: 'q_wolves', counts: [2], state: 'active' }],
      ]),
      questState: () => 'available',
    } as unknown as IWorld;
    const controller = new MapSidebarController({
      root: () => root,
      click: vi.fn(),
      onRepaintMap: vi.fn(),
      onShowRoute: vi.fn(),
      tracking: new QuestTrackingState(fakeStorage()),
      settings: fakeSettings(),
    });
    const zone = zoneAt(giver.pos.x, giver.pos.z);
    const writes = { count: 0 };
    let descriptor: PropertyDescriptor | undefined;
    for (
      let proto = Object.getPrototypeOf(root);
      proto && !descriptor;
      proto = Object.getPrototypeOf(proto)
    ) {
      descriptor = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
    }
    if (!descriptor?.set) throw new Error('no innerHTML accessor to count writes through');
    const innerHtml = descriptor;
    Object.defineProperty(root, 'innerHTML', {
      configurable: true,
      get: () => innerHtml.get?.call(root),
      set: (value: string) => {
        writes.count += 1;
        innerHtml.set?.call(root, value);
      },
    });
    const walk = (dx: number) => {
      world.player.pos.x = giver.pos.x + dx;
      controller.update(world, zone);
    };
    return { root, walk, writes };
  }

  it('repaints nothing while the player walks a few yards', () => {
    const test = walkingHarness();
    test.walk(0);
    expect(test.writes.count, 'the first update paints the rail').toBe(1);
    expect(test.root.querySelectorAll('.map-atlas-nearby-row').length).toBeGreaterThan(0);
    const painted = test.root.firstElementChild;

    test.walk(3);

    // A live distance moved every tick, so the rail used to rebuild its whole
    // subtree four times a second while the player walked.
    expect(test.writes.count).toBe(1);
    expect(test.root.firstElementChild).toBe(painted);
  });

  it('repaints once the offers list actually reads differently', () => {
    const test = walkingHarness();
    test.walk(0);
    const painted = test.root.firstElementChild;
    const before = test.root.querySelector('.map-atlas-nearby-row')?.textContent;

    test.walk(30);

    expect(test.writes.count).toBe(2);
    expect(test.root.firstElementChild).not.toBe(painted);
    expect(test.root.querySelector('.map-atlas-nearby-row')?.textContent).not.toBe(before);
  });
});
