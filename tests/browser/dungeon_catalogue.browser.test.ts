import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { DELVE_LIST } from '../../src/sim/data';
import { DungeonFinderWindow } from '../../src/ui/dungeon_finder_window';
import { FocusManager } from '../../src/ui/focus_manager';
import { t } from '../../src/ui/i18n';
import type { IWorld } from '../../src/world_api';
import { axeSeriousViolations, cleanup, formatViolations, host } from './_harness';

function control<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing control: ${selector}`);
  return element;
}

function setup(tab: 'catalogue' | 'board' = 'catalogue') {
  const root = host('dungeon-finder-window');
  root.style.display = 'none';
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
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    hideTooltip: () => {},
    showOnMap,
    itemIcon: () => '',
    itemTooltip: () => '',
    moneyHtml: () => '',
    attachTooltip: () => {},
  });
  window.open(tab);
  return { root, world, window, showOnMap };
}

afterEach(() => {
  cleanup();
  document.body.classList.remove('mobile-touch', 'game-active');
});

describe('Adventure Guide in a real browser', () => {
  it('keeps focused group creation reachable without guide navigation on a phone', async () => {
    await page.viewport(390, 844);
    document.body.classList.add('mobile-touch', 'game-active');
    const { root } = setup('board');
    expect(root.querySelector('.df-tabs')).toBeNull();
    expect(root.querySelector('[data-tab="catalogue"]')).toBeNull();
    expect(root.querySelector('.df-create')).toBeNull();
    const create = control<HTMLButtonElement>(root, '[data-start-create]');
    expect(create.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
    create.focus();
    await userEvent.keyboard('{Enter}');
    expect(root.querySelector('.df-create')).not.toBeNull();
    expect(root.querySelector('.df-board-listings')).toBeNull();
    expect(root.querySelector('#dfinder-title')?.textContent).toBe('Create Group');
    const kind = control<HTMLSelectElement>(root, '[data-create-kind]');
    expect(Number.parseFloat(getComputedStyle(kind).fontSize)).toBeGreaterThanOrEqual(16);
    expect(kind.value).toBe('dungeon');
    kind.value = 'raid';
    kind.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root.querySelector('[data-createopt="gravewyrm_sanctum_normal"]')).toBeNull();
    expect(root.querySelector('[data-createopt="nythraxis_boss_arena_normal"]')).not.toBeNull();
    expect(root.querySelectorAll('[data-create-role]')).toHaveLength(3);
    const healer = control<HTMLButtonElement>(root, '[data-create-role="healer"]');
    healer.focus();
    await userEvent.keyboard('{Enter}');
    expect(control(root, '[data-create-role="healer"]').getAttribute('aria-pressed')).toBe('true');
    const formViolations = await axeSeriousViolations(root);
    expect(formViolations, formatViolations(formViolations)).toEqual([]);
    const publish = control<HTMLButtonElement>(root, '[data-act="create"]');
    expect(publish.getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight);
    control<HTMLElement>(root, '.df-create-tags').scrollIntoView({ block: 'end' });
    expect(publish.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    expect(publish.getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight);
    await userEvent.click(control(root, '[data-cancel-create]'));
    expect(root.querySelector('.df-create')).toBeNull();
    expect(root.querySelector('.df-board-shell')).not.toBeNull();
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
    const violations = await axeSeriousViolations(root);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it('opens a detailed boss guide by keyboard without showing mechanic chips', async () => {
    await page.viewport(1440, 1000);
    const { root } = setup();
    await userEvent.click(control(root, '[data-category="raids"]'));
    await userEvent.click(control(root, '[data-row="ignivar_raid_arena_normal"]'));
    expect(root.querySelector('.df-mechanics')).toBeNull();
    const guide = control<HTMLDetailsElement>(root, '[data-encounter-guide]');
    const summary = control<HTMLElement>(guide, 'summary');
    const trap = new FocusManager().open({ root: () => root });
    try {
      control<HTMLElement>(root, '[data-loot-spec]').focus();
      await userEvent.keyboard('{Tab}');
      expect(document.activeElement).toBe(summary);
    } finally {
      trap.release(false);
    }
    expect(guide.open).toBe(false);
    expect(getComputedStyle(control(guide, '.df-guide-hide')).display).toBe('none');
    summary.focus();
    await userEvent.keyboard('{Enter}');
    expect(guide.open).toBe(true);
    expect(getComputedStyle(control(guide, '.df-guide-show')).display).toBe('none');
    expect(guide.querySelectorAll('.df-encounter-guide-phase').length).toBeGreaterThan(1);
    expect(guide.querySelectorAll('.df-encounter-guide-response').length).toBeGreaterThan(3);
    await page.viewport(390, 844);
    document.body.classList.add('mobile-touch');
    expect(guide.scrollWidth).toBeLessThanOrEqual(guide.clientWidth);
    expect(control(guide, '.df-guide-content').getBoundingClientRect().width).toBeGreaterThan(250);
    await userEvent.keyboard('{Enter}');
    expect(guide.open).toBe(false);
  });

  it('keeps a resized desktop catalogue readable and supports returning to its list', async () => {
    await page.viewport(1440, 1000);
    const { root } = setup();
    root.style.width = '640px';
    const rail = () => control<HTMLElement>(root, '.df-rail');
    const detail = () => control<HTMLElement>(root, '.df-detail');
    expect(getComputedStyle(detail()).display).toBe('none');
    await userEvent.click(control(root, '[data-row]'));
    expect(getComputedStyle(rail()).display).toBe('none');
    expect(getComputedStyle(detail()).display).not.toBe('none');
    expect(detail().scrollWidth).toBeLessThanOrEqual(detail().clientWidth);
    await userEvent.click(control(root, '[data-back]'));
    expect(getComputedStyle(rail()).display).not.toBe('none');
    expect(getComputedStyle(detail()).display).toBe('none');
  });

  it('keeps board content fully opaque after a structural update', async () => {
    await page.viewport(1440, 1000);
    const { root, world, window } = setup();
    await userEvent.click(control(root, '[data-tab="board"]'));
    world.player.level = 19;
    window.render();
    const board = control(root, '.df-board-shell');
    expect(getComputedStyle(board).opacity).toBe('1');
    expect(board.getAnimations()).toHaveLength(0);
  });

  it('lets an Arms warrior select Tank without changing talents or the loot specialization', async () => {
    await page.viewport(1440, 1000);
    const { root, world, window } = setup();
    const setSpec = vi.fn();
    const applyTalents = vi.fn();
    Object.assign(world, { setSpec, applyTalents, talentSpec: 'arms', talentRole: 'dps' });
    world.cfg.playerClass = 'warrior';
    world.dungeonFinderInfo.roles = ['dps'];
    world.dungeonFinderInfo.eligibleRoles = ['tank', 'dps'];
    window.render();
    const lootBefore = [...root.querySelectorAll<HTMLElement>('[data-df-item]')].map(
      (node) => node.dataset.dfItem,
    );
    expect(control<HTMLSelectElement>(root, '[data-loot-spec]').value).toBe('arms');
    window.open('queue');
    const tank = control<HTMLButtonElement>(root, '[data-role="tank"]');
    expect(tank.disabled).toBe(false);
    expect(control<HTMLButtonElement>(root, '[data-role="dps"]').disabled).toBe(false);
    expect(control<HTMLButtonElement>(root, '[data-role="healer"]').disabled).toBe(true);
    await userEvent.click(tank);
    expect(world.dungeonFinderSetRoles).toHaveBeenCalledExactlyOnceWith(['tank', 'dps']);
    expect(setSpec).not.toHaveBeenCalled();
    expect(applyTalents).not.toHaveBeenCalled();
    expect(world.talentSpec).toBe('arms');
    expect(world.talentRole).toBe('dps');
    world.dungeonFinderInfo.roles = ['tank', 'dps'];
    window.render();
    expect(control(root, '[data-role="tank"]').getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(control(root, '[data-tab="board"]'));
    window.open('catalogue');
    expect(control<HTMLSelectElement>(root, '[data-loot-spec]').value).toBe('arms');
    expect(
      [...root.querySelectorAll<HTMLElement>('[data-df-item]')].map((node) => node.dataset.dfItem),
    ).toEqual(lootBefore);
  });
  it('preserves the focused search caret and exposes class/spec previews without gameplay commands', async () => {
    await page.viewport(1440, 1000);
    const { root, world } = setup();
    expect(control<HTMLSelectElement>(root, '[data-loot-class]').value).toBe('paladin');
    expect(control<HTMLSelectElement>(root, '[data-loot-spec]').value).toBe('holy');
    const classes = control<HTMLSelectElement>(root, '[data-loot-class]');
    classes.focus();
    classes.value = 'warrior';
    classes.dispatchEvent(new Event('change', { bubbles: true }));
    const specs = control<HTMLSelectElement>(root, '[data-loot-spec]');
    expect(specs.value).toBe('');
    expect([...specs.options].map((option) => option.value)).toEqual(['', 'arms', 'fury', 'prot']);
    expect(document.activeElement).toBe(control(root, '[data-loot-class]'));
    const search = control<HTMLInputElement>(root, '[data-guide-search]');
    await userEvent.click(search);
    search.value = 'Hollow';
    search.setSelectionRange(3, 3);
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const current = control<HTMLInputElement>(root, '[data-guide-search]');
    expect(document.activeElement).toBe(current);
    expect(current.selectionStart).toBe(3);
    expect(root.querySelectorAll('[data-row]').length).toBeGreaterThan(0);
    expect(world.dungeonFinderQueueJoin).not.toHaveBeenCalled();
    expect(world.dungeonFinderSetRoles).not.toHaveBeenCalled();
    const violations = await axeSeriousViolations(root);
    expect(violations, formatViolations(violations)).toEqual([]);
  });
  it('keeps every real delve browseable, map-enabled and outside the automatic queue', async () => {
    await page.viewport(1440, 1000);
    const { root, window, showOnMap } = setup();
    await userEvent.click(control(root, '[data-category="raids"]'));
    expect(root.querySelectorAll('[data-row]').length).toBeGreaterThan(0);
    for (const delve of DELVE_LIST) {
      window.open('catalogue');
      await userEvent.click(control(root, '[data-category="delves"]'));
      expect(root.querySelectorAll('[data-row]').length).toBe(DELVE_LIST.length);
      await userEvent.click(control(root, `[data-row="delve:${delve.id}"]`));
      expect(root.querySelector('[data-guide-group]')).toBeNull();
      expect(root.textContent).toContain(t('hudChrome.adventureGuide.delveTravel'));
      const violations = await axeSeriousViolations(root);
      expect(violations, formatViolations(violations)).toEqual([]);
      await userEvent.click(control(root, '[data-showmap]'));
      expect(showOnMap).toHaveBeenLastCalledWith(delve.doorPos.x, delve.doorPos.z);
    }
  });
  it('fits a landscape phone and preserves 40px actions through mobile list/detail navigation', async () => {
    await page.viewport(844, 390);
    document.body.classList.add('mobile-touch', 'game-active');
    const { root } = setup();
    const bounds = root.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(innerWidth);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(innerHeight);
    for (const button of root.querySelectorAll<HTMLButtonElement>('button')) {
      if (button.getClientRects().length === 0) continue;
      const rect = button.getBoundingClientRect();
      expect(rect.height, button.outerHTML).toBeGreaterThanOrEqual(40);
      expect(rect.width, button.outerHTML).toBeGreaterThanOrEqual(40);
    }
    const row = control<HTMLButtonElement>(root, '[data-row]');
    row.focus();
    await userEvent.click(row);
    expect(getComputedStyle(control(root, '.df-rail')).display).toBe('none');
    const back = control<HTMLButtonElement>(root, '[data-back]');
    expect(back.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
    expect(
      control<HTMLSelectElement>(root, '[data-loot-class]').getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(40);
    const violations = await axeSeriousViolations(root);
    expect(violations, formatViolations(violations)).toEqual([]);
    await userEvent.click(back);
    expect(getComputedStyle(control(root, '.df-detail')).display).toBe('none');
  });
});
