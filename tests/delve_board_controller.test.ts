// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DELVES, ITEMS } from '../src/sim/data';
import type { FocusTrapHandle } from '../src/ui/focus_manager';
import { DelveBoardController } from '../src/ui/hud/delve/delve_board_controller';
import type { IWorld } from '../src/world_api';

const shopItemId = Object.keys(ITEMS)[0];
if (!shopItemId) throw new Error('delve shop item fixture not found');

function makeHarness(validNpc = true) {
  document.body.innerHTML = '';
  const panel = document.createElement('div');
  panel.id = 'delve-board';
  panel.style.display = 'none';
  document.body.appendChild(panel);
  const delve = DELVES.collapsed_reliquary;
  const entities = new Map([
    [
      7,
      validNpc
        ? { id: 7, kind: 'npc', templateId: delve.boardNpcId }
        : { id: 7, kind: 'mob', templateId: 'wolf' },
    ],
  ]);
  const enterDelve = vi.fn();
  const companionUpgrade = vi.fn();
  const delveBuyShopItem = vi.fn();
  const delveShopOffers = vi.fn(() => [
    {
      itemId: shopItemId,
      marks: 2,
      unlocked: true,
      requiresHeroicClear: false,
      requiresClears: 0,
    },
  ]);
  const world = {
    entities,
    player: { level: delve.minLevel, name: 'BoardTester' },
    partyInfo: null,
    delveMarks: 10,
    companionUpgrades: {},
    delveShopOffers,
    delveBuyShopItem,
    companionUpgrade,
    enterDelve,
  } as unknown as IWorld;
  const focusFirst = vi.fn();
  const release = vi.fn();
  const trap: FocusTrapHandle = { focusFirst, release };
  const openFocusTrap = vi.fn(() => trap);
  const closeOtherWindows = vi.fn();
  const hideTooltip = vi.fn();
  const preloadInterior = vi.fn();
  const controller = new DelveBoardController({
    element: panel,
    world: () => world,
    openFocusTrap,
    closeOtherWindows,
    hideTooltip,
    attachTooltip: () => {},
    itemIcon: () => '<span class="item-icon"></span>',
    itemTooltip: () => '',
    delveName: () => 'The Test Reliquary',
    preloadInterior,
  });
  return {
    controller,
    panel,
    entities,
    enterDelve,
    companionUpgrade,
    delveBuyShopItem,
    delveShopOffers,
    preloadInterior,
    focusFirst,
    release,
    openFocusTrap,
    closeOtherWindows,
    hideTooltip,
  };
}

describe('DelveBoardController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('rejects entities that are not a matching board NPC', () => {
    const test = makeHarness(false);

    test.controller.open(7);

    expect(test.controller.isOpen).toBe(false);
    expect(test.panel.style.display).toBe('none');
    expect(test.openFocusTrap).not.toHaveBeenCalled();
  });

  it('opens one focused board lifetime and renders authoritative requirements', () => {
    const test = makeHarness();

    test.controller.open(7);
    test.controller.open(7);

    expect(test.controller.isOpen).toBe(true);
    expect(test.panel.style.display).toBe('block');
    expect(test.panel.innerHTML).toContain('The Test Reliquary');
    expect(test.closeOtherWindows).toHaveBeenCalledWith('#delve-board');
    expect(test.openFocusTrap).toHaveBeenCalledTimes(1);
    expect(test.focusFirst).toHaveBeenCalledWith('.delve-enter-btn');
  });

  it('sends the selected heroic tier through IWorld and preloads the same interior event', () => {
    const test = makeHarness();
    test.controller.open(7);

    test.panel.querySelector<HTMLButtonElement>('[data-tier-pick="heroic"]')?.click();
    test.panel.querySelector<HTMLButtonElement>('[data-delve-enter]')?.click();

    expect(test.enterDelve).toHaveBeenCalledWith('collapsed_reliquary', 'heroic');
    expect(test.preloadInterior).toHaveBeenCalledWith({
      type: 'delveEntered',
      delveId: 'collapsed_reliquary',
      tierId: 'heroic',
    });
    expect(test.controller.isOpen).toBe(false);
    expect(test.release).toHaveBeenCalledWith(true);
  });

  it('routes companion upgrades and shop purchases through IWorld', () => {
    const test = makeHarness();
    test.controller.open(7);

    test.panel.querySelector<HTMLButtonElement>('[data-companion-upgrade]')?.click();
    expect(test.companionUpgrade).toHaveBeenCalledWith('companion_tessa');

    test.panel.querySelector<HTMLButtonElement>('[data-board-tab="shop"]')?.click();
    expect(test.delveShopOffers).toHaveBeenCalledWith('collapsed_reliquary');
    test.panel.querySelector<HTMLButtonElement>(`[data-buy="${shopItemId}"]`)?.click();
    expect(test.delveBuyShopItem).toHaveBeenCalledWith('collapsed_reliquary', shopItemId);
  });

  it('closes and restores focus if the authoritative NPC disappears', () => {
    const test = makeHarness();
    test.controller.open(7);
    test.entities.delete(7);

    test.controller.render();

    expect(test.controller.isOpen).toBe(false);
    expect(test.panel.style.display).toBe('none');
    expect(test.hideTooltip).toHaveBeenCalled();
    expect(test.release).toHaveBeenCalledWith(true);
  });
});
