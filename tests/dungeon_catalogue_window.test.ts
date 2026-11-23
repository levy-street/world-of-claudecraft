// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DELVE_LIST } from '../src/sim/data';
import { DungeonFinderWindow } from '../src/ui/dungeon_finder_window';
import type { IWorld } from '../src/world_api';

vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));

function control<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing control: ${selector}`);
  return element;
}

function setup() {
  const root = document.createElement('div');
  root.id = 'dungeon-finder-window';
  document.body.append(root);
  const world = {
    partyInfo: null,
    player: { level: 20 },
    playerId: 1,
    cfg: { playerClass: 'paladin' },
    talentRole: 'healer',
    talentSpec: 'holy',
    dungeonFinderBoard: [],
    raidLockouts: () => [],
    dungeonFinderInfo: {
      roles: ['healer'],
      eligibleRoles: ['healer'],
      cooldown: 0,
      queue: null,
      proposal: null,
      myListing: null,
      myApplication: null,
    },
    dungeonFinderQueueJoin: vi.fn(),
    dungeonFinderListingCreate: vi.fn(),
    dungeonFinderSetRoles: vi.fn(),
  };
  const showOnMap = vi.fn();
  const window = new DungeonFinderWindow({
    root: () => root,
    world: () => world as unknown as IWorld,
    closeOthers: vi.fn(),
    captureFocus: () => null,
    restoreFocus: vi.fn(),
    hideTooltip: vi.fn(),
    showOnMap,
    itemIcon: () => '',
    itemTooltip: () => '',
    moneyHtml: () => '',
    attachTooltip: vi.fn(),
  });
  window.open('catalogue');
  const click = (selector: string) => control<HTMLButtonElement>(root, selector).click();
  return { root, world, window, showOnMap, click };
}

describe('adventure guide window', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  it('shows the level range once and a distinct unavailable status for an out-of-range adventure', () => {
    const { root } = setup();
    const row = control(root, '[data-row="hollow_crypt_normal"]');
    expect(row.querySelector('.df-row-meta')?.textContent).toContain('7 to 10');
    expect(row.textContent?.match(/7 to 10/g)).toHaveLength(1);
    expect(row.querySelector('.df-blocked')?.textContent).toBe('Outside your level range');
  });
  it('keeps boss guides collapsed until requested and preserves them across loot-filter rebuilds', () => {
    const { root, click, world, window } = setup();
    expect(root.querySelector('.df-mechanics')).toBeNull();
    const guide = control<HTMLDetailsElement>(root, '[data-encounter-guide]');
    const key = guide.dataset.encounterGuide;
    expect(guide.open).toBe(false);
    expect(guide.querySelector('summary')?.textContent).toContain('Show Guide');
    guide.open = true;
    const classes = control<HTMLSelectElement>(root, '[data-loot-class]');
    classes.value = 'warrior';
    classes.dispatchEvent(new Event('change'));
    const next = control<HTMLDetailsElement>(root, `[data-encounter-guide="${key}"]`);
    expect(next.open).toBe(true);
    const summary = control<HTMLElement>(next, 'summary');
    summary.focus();
    world.player.level = 19;
    window.render();
    expect(document.activeElement).toBe(root.querySelector(`[data-guide-toggle="${key}"]`));
    expect(control<HTMLDetailsElement>(root, `[data-encounter-guide="${key}"]`).open).toBe(true);
    click('[data-category="raids"]');
    for (const details of root.querySelectorAll<HTMLDetailsElement>('[data-encounter-guide]')) {
      expect(details.open).toBe(false);
    }
  });
  it('defaults loot to the actual viewer and resets incompatible spec choices after a class switch', () => {
    const { root, world } = setup();
    expect(root.querySelector<HTMLSelectElement>('[data-loot-class]')?.value).toBe('paladin');
    expect(root.querySelector<HTMLSelectElement>('[data-loot-spec]')?.value).toBe('holy');
    const classes = control<HTMLSelectElement>(root, '[data-loot-class]');
    classes.focus();
    classes.value = 'warrior';
    classes.dispatchEvent(new Event('change'));
    const specs = control<HTMLSelectElement>(root, '[data-loot-spec]');
    expect(specs.value).toBe('');
    expect([...specs.options].map((o) => o.value)).toEqual(['', 'arms', 'fury', 'prot']);
    expect(document.activeElement).toBe(root.querySelector('[data-loot-class]'));
    expect(world.cfg.playerClass).toBe('paladin');
    expect(world.dungeonFinderQueueJoin).not.toHaveBeenCalled();
    expect(world.dungeonFinderSetRoles).not.toHaveBeenCalled();
  });
  it('exposes every genuine delve with its map action but no matchmaking action', () => {
    const { root, window, click, showOnMap } = setup();
    for (const delve of DELVE_LIST) {
      window.open('catalogue');
      click('[data-category="delves"]');
      expect(root.querySelectorAll('[data-row]').length).toBe(DELVE_LIST.length);
      click(`[data-row="delve:${delve.id}"]`);
      expect(root.querySelector('[data-guide-group]')).toBeNull();
      click('[data-showmap]');
      expect(showOnMap).toHaveBeenLastCalledWith(delve.doorPos.x, delve.doorPos.z);
    }
  });
  it('preserves search focus and cursor on repaint, escapes input, and offers an empty-state reset', () => {
    const { root, click } = setup();
    const search = control<HTMLInputElement>(root, '[data-guide-search]');
    search.focus();
    search.value = '<img src=x>';
    search.setSelectionRange(4, 4);
    search.dispatchEvent(new Event('input'));
    const next = control<HTMLInputElement>(root, '[data-guide-search]');
    expect(next).toBe(document.activeElement);
    expect(next.selectionStart).toBe(4);
    expect(next.value).toBe('<img src=x>');
    expect(root.querySelector('img[src="x"]')).toBeNull();
    expect(root.querySelectorAll('[data-row]').length).toBe(0);
    click('[data-guide-reset]');
    expect(root.querySelectorAll('[data-row]').length).toBeGreaterThan(0);
  });
  it('retains queue and board reachability and performs no DOM queries or writes on identical frames', () => {
    const { root, window, click } = setup();
    const write = vi.spyOn(root, 'innerHTML', 'set');
    const query = vi.spyOn(root, 'querySelector');
    window.render();
    window.render();
    expect(write).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    window.open('queue');
    expect(root.querySelectorAll('[data-role]').length).toBe(3);
    click('[data-tab="board"]');
    expect(root.querySelector('[data-start-create]')).not.toBeNull();
  });
  it('keeps premade controls mounted while an invisible applicant countdown ticks, but refreshes changed applicants', () => {
    const { root, world, window } = setup();
    const applicant = {
      pid: 2,
      name: 'Mira',
      cls: 'priest' as const,
      level: 20,
      roles: ['healer' as const],
      remaining: 120,
    };
    const listing = {
      id: 1,
      activityId: 'hollow_crypt_normal',
      tags: [],
      applicants: [applicant],
    };
    Object.assign(world.dungeonFinderInfo, { myListing: listing });
    window.open('board');
    const accept = control<HTMLButtonElement>(root, '[data-appacc="2"]');
    accept.focus();
    const body = control<HTMLElement>(root, '.df-body');
    body.scrollTop = 80;
    const write = vi.spyOn(root, 'innerHTML', 'set');
    for (let remaining = 119; remaining >= 116; remaining--) {
      // Online snapshots replace the objects as well as the clock values.
      Object.assign(world.dungeonFinderInfo, {
        myListing: { ...listing, applicants: [{ ...applicant, remaining }] },
      });
      window.render();
    }
    expect(write).not.toHaveBeenCalled();
    expect(root.querySelector('[data-appacc="2"]')).toBe(accept);
    expect(document.activeElement).toBe(accept);
    expect(root.querySelector('.df-body')?.scrollTop).toBe(80);
    Object.assign(world.dungeonFinderInfo, {
      myListing: { ...listing, applicants: [{ ...applicant, name: 'New name' }] },
    });
    window.render();
    expect(write).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain('New name');
    Object.assign(world.dungeonFinderInfo, { myListing: { ...listing, applicants: [] } });
    window.render();
    expect(write).toHaveBeenCalledTimes(2);
    expect(root.querySelector('[data-appacc="2"]')).toBeNull();
  });
});
