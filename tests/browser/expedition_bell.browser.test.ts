import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { FocusManager } from '../../src/ui/focus_manager';
import { createFinderSurfaces } from '../../src/ui/hud/expeditions/finder_surfaces';
import { makeWriterFacet } from '../../src/ui/painter_host';
import { makeWindowFocus } from '../../src/ui/window_focus';
import type { IWorld } from '../../src/world_api';
import { axeSeriousViolations, cleanup, host } from './_harness';

function control<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`Missing control: ${selector}`);
  return node;
}
function setup() {
  const ui = host('ui', '');
  const rail = document.createElement('div');
  rail.id = 'side-buttons';
  rail.innerHTML =
    '<button type="button" id="expedition-bell" class="micro-btn ui-icon-btn ui-icon-btn--micro"></button>';
  ui.append(rail);
  const root = host('dungeon-finder-window');
  ui.append(root);
  root.style.display = 'none';
  const world = {
    playerId: 1,
    player: { level: 20, name: 'Recruiter', inCombat: false },
    cfg: { playerClass: 'paladin' },
    talentRole: 'healer',
    talentSpec: 'holy',
    partyInfo: null,
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
    dungeonFinderBoard: [
      {
        id: 7,
        activityId: 'gravewyrm_sanctum_normal',
        leaderName: 'Mira',
        tags: [],
        size: 1,
        capacity: 5,
        needed: { tank: 0, healer: 1, dps: 3 },
        members: [{ cls: 'warrior', level: 20, role: 'tank' }],
      },
    ],
    dungeonFinderApply: vi.fn(),
    dungeonFinderSetRoles: vi.fn(),
    dungeonFinderListingCreate: vi.fn(),
    dungeonFinderExpeditionConfigure: vi.fn(),
  };
  const focus = new FocusManager();
  const surfaces = createFinderSurfaces({
    world: () => world as unknown as IWorld,
    root: (selector) => control(document, selector),
    focus: (selector) => makeWindowFocus(focus, () => control(document, selector)),
    closeOthers: () => {},
    hideTooltip: () => {},
    showOnMap: () => {},
    openFinder: vi.fn(),
    maskPlayerText: (value) => value,
    inspectPlayer: vi.fn(),
    presentation: {
      itemIcon: () => '',
      itemTooltip: () => '',
      moneyHtml: () => '',
      attachTooltip: () => {},
    },
    writers: makeWriterFacet(
      new Map(),
      new Map(),
      new Map(),
      new Map(),
      () => {},
      () => {},
    ),
  });
  surfaces.expeditions.render();
  let launcher = control<HTMLButtonElement>(ui, '#expedition-bell');
  if (document.body.classList.contains('mobile-touch')) {
    // The desktop rail is hidden on touch. This is the existing Groups entry
    // after opening More, whose full bootstrap is covered by the real HUD tour.
    launcher = document.createElement('button');
    launcher.id = 'mobile-dfinder';
    launcher.className = 'ui-btn';
    launcher.textContent = 'Groups';
    launcher.addEventListener('click', () => surfaces.window.open());
    ui.append(launcher);
  }
  return { root, world, surfaces, bell: launcher };
}
afterEach(() => {
  cleanup();
  document.body.classList.remove('mobile-touch', 'game-active');
});
describe('one Groups window from the HUD launchers', () => {
  it.each([
    [1280, 800],
    [390, 844],
    [844, 390],
  ])('opens the same accessible board at %sx%s', async (width, height) => {
    await page.viewport(width, height);
    document.body.classList.add('game-active');
    if (width < 900) document.body.classList.add('mobile-touch');
    const { root, bell, world, surfaces } = setup();
    expect(root.style.display).toBe('none');
    expect(document.getElementById('expedition-panel')).toBeNull();
    expect(document.querySelectorAll('#side-buttons #expedition-bell')).toHaveLength(1);
    expect(document.getElementById('expedition-hud')).toBeNull();
    bell.focus();
    await userEvent.keyboard('{Enter}');
    expect(root.style.display).toBe('flex');
    expect(root.querySelector('#dfinder-title')?.textContent).toBe('Groups');
    expect(root.querySelectorAll('[data-apply="7"]')).toHaveLength(1);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(await axeSeriousViolations(root)).toEqual([]);
    const rect = root.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(innerWidth + 1);
    await userEvent.click(control(root, '[data-apply="7"]'));
    expect(world.dungeonFinderApply).toHaveBeenCalledWith(7);
    surfaces.window.close();
    await expect.poll(() => document.activeElement).toBe(bell);
  });
  it('opens browse after creation and never dismisses Groups from an outside click', async () => {
    await page.viewport(1280, 800);
    const { root, bell, surfaces } = setup();
    await userEvent.click(bell);
    await userEvent.click(control(root, '[data-start-create]'));
    expect(root.querySelector('.df-create')).not.toBeNull();
    expect(root.querySelector('.df-board-listings')).toBeNull();
    await userEvent.click(bell);
    expect(root.querySelector('.df-create')).toBeNull();
    expect(root.querySelector('.df-board-listings')).not.toBeNull();
    const other = document.createElement('button');
    other.textContent = 'Other game window';
    other.style.cssText = 'position:fixed;right:0;bottom:0;z-index:9999';
    document.body.append(other);
    await userEvent.click(other);
    expect(surfaces.window.isOpen).toBe(true);
    await userEvent.click(control(root, '[data-close]'));
    expect(surfaces.window.isOpen).toBe(false);
  });
  it.each([
    [1280, 800],
    [390, 844],
    [844, 390],
  ])('keeps own expedition and requests in Groups at %sx%s', async (width, height) => {
    await page.viewport(width, height);
    document.body.classList.add('game-active');
    if (width < 900) document.body.classList.add('mobile-touch');
    const { root, world, surfaces, bell } = setup();
    const travel = vi.fn();
    const respond = vi.fn();
    Object.assign(world, {
      partyInfo: {
        leader: 1,
        members: [{ pid: 1, name: 'Recruiter', cls: 'paladin', level: 20, role: 'healer' }],
      },
      dungeonFinderExpeditionTravel: travel,
      dungeonFinderApplicationRespond: respond,
    });
    Object.assign(world.dungeonFinderInfo, {
      expedition: {
        exitId: 20,
        activityId: 'gravewyrm_sanctum_normal',
        dungeonId: 'gravewyrm_sanctum',
        leaderPid: 1,
        isLeader: true,
        isInside: false,
        canTravel: true,
        open: true,
        bossesDefeated: 1,
        bossesTotal: 3,
      },
      myListing: {
        id: 8,
        activityId: 'gravewyrm_sanctum_normal',
        tags: [],
        applicants: [
          { pid: 9, name: 'NewFriend', cls: 'mage', level: 20, roles: ['dps'], remaining: 100 },
        ],
        details: { purpose: 'clear', note: '' },
      },
    });
    await userEvent.click(bell);
    expect(root.querySelector('.df-current-group')).not.toBeNull();
    expect(document.querySelectorAll('[data-appacc="9"]')).toHaveLength(1);
    expect(root.querySelectorAll('.df-board-listings')).toHaveLength(1);
    await userEvent.click(control(root, '[data-group-action="travel"]'));
    expect(travel).toHaveBeenCalledOnce();
    await userEvent.click(control(root, '[data-appacc="9"]'));
    expect(respond).toHaveBeenCalledWith(9, true);
    expect(root.querySelector('[data-group-disclosure], [data-reward]')).toBeNull();
    surfaces.window.render();
    expect(root.querySelector('[data-group-sound]')).not.toBeNull();
    expect(await axeSeriousViolations(root)).toEqual([]);
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
  });
});
