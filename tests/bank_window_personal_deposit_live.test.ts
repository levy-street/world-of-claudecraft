// @vitest-environment happy-dom
//
// The Personal tab's Deposit All button reads the CARRIED bags for its enabled
// state, but the bank's refresh signature had no bag term for that tab (the
// vault pane's twin button had one), so looting a material under an open bank
// left the button stale-disabled until unrelated bank data moved. Drives the
// REAL BankWindow (the bank_window_search_reset harness) against a stubbed
// IWorld bank mirror and a swappable inventory.

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { isMaterialItem } from '../src/sim/material_taxonomy';
import type { InvSlot } from '../src/sim/types';
import { BankWindow, type BankWindowDeps } from '../src/ui/bank_window';
import type { BankInfo, IWorld } from '../src/world_api';

const MATERIAL = 'copper_ore';
const NOT_MATERIAL = 'worn_sword';

function bankInfo(): BankInfo {
  return {
    slots: [],
    capacity: 12,
    purchasedSlots: 0,
    bonusSlots: 0,
    nextExpansionCost: 1000,
    bonusSources: [],
    socketsUnlocked: 0,
    socketBags: [null, null, null, null],
    nextSocketCost: 1000000,
    generalCapacity: 12,
    materialsCapacity: 0,
    generalUsed: 0,
    materialsUsed: 0,
  };
}

function harness(): { root: HTMLElement; w: BankWindow; world: { inventory: InvSlot[] } } {
  const world = {
    bankInfo: bankInfo() as BankInfo | null,
    inventory: [] as InvSlot[],
    bankDeposit: () => {},
    bankWithdraw: () => {},
    bankBuySlots: () => {},
  };
  const root = document.createElement('div');
  document.body.appendChild(root);
  const noop = (): void => {};
  const deps: BankWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: noop,
    root: () => root,
    world: () => world as unknown as IWorld,
    closeOthers: noop,
    hideTooltip: noop,
    consumePeek: () => false,
    captureFocus: () => null,
    restoreFocus: noop,
    onClosed: noop,
    onInventoryChanged: noop,
  };
  return { root, w: new BankWindow(deps), world };
}

const depositAll = (root: HTMLElement): HTMLButtonElement | null =>
  root.querySelector<HTMLButtonElement>('.bank-deposit-all');

describe('bank_window: the Personal tab Deposit All button follows the carried bags', () => {
  it('uses a real material and a real non-material (fixture guard)', () => {
    expect(isMaterialItem(ITEMS[MATERIAL])).toBe(true);
    expect(isMaterialItem(ITEMS[NOT_MATERIAL])).toBe(false);
  });

  it('enables once a material is looted under the open pane, and disables when it leaves', () => {
    const { root, w, world } = harness();
    w.open();
    w.refreshIfChanged();
    expect(depositAll(root)?.disabled).toBe(true);

    world.inventory = [{ itemId: MATERIAL, count: 3 }];
    w.refreshIfChanged();
    expect(depositAll(root)?.disabled).toBe(false);

    world.inventory = [];
    w.refreshIfChanged();
    expect(depositAll(root)?.disabled).toBe(true);
  });

  it('does not repaint for bag churn that leaves depositability unchanged', () => {
    const { root, w, world } = harness();
    world.inventory = [{ itemId: MATERIAL, count: 3 }];
    w.open();
    w.refreshIfChanged();
    const before = depositAll(root);
    world.inventory = [
      { itemId: MATERIAL, count: 5 },
      { itemId: NOT_MATERIAL, count: 1 },
    ];
    w.refreshIfChanged();
    w.refreshIfChanged();
    expect(depositAll(root)).toBe(before);
  });
});
