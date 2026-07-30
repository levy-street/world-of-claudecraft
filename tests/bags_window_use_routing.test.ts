// @vitest-environment jsdom
// The bags 'use' click routing (#2343): drives the REAL BagsWindow against a
// jsdom container (the bags_window_instance_marker.test.ts fixture idiom) and
// pins the behavior the source pin in bags_window.test.ts can only anchor
// textually: a click on a usable item tries the gathering-tool hook first, a
// consumed use never reaches world.useItem, and a declined use (a non-tool,
// or the hook unwired on this host) falls back to exactly one plain useItem.
import { describe, expect, it } from 'vitest';
import type { InvSlot, ItemDef } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import type { IWorld } from '../src/world_api';

function harness(
  inventory: InvSlot[],
  useGatherTool: (item: ItemDef) => boolean,
): { root: HTMLElement; usedItems: string[]; gatherToolCalls: ItemDef[] } {
  const usedItems: string[] = [];
  const gatherToolCalls: ItemDef[] = [];
  const world = {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
    useItem: (itemId: string) => {
      usedItems.push(itemId);
    },
  } as unknown as IWorld;
  const root = document.createElement('div');
  document.body.appendChild(root);
  const noop = (): void => {};
  const deps: BagsWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: noop,
    root: () => root,
    world: () => world,
    wocBalanceHtml: () => '',
    claudiumLauncherHtml: () => '',
    openClaudium: noop,
    openWallet: noop,
    hideTooltip: noop,
    consumePeek: () => false,
    cancelPetFeed: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    renderCharIfOpen: noop,
    vendorOpen: () => false,
    tradeOpen: () => false,
    isMarketSell: () => false,
    isMailAttach: () => false,
    isBankOpen: () => false,
    pendingPetFeed: () => false,
    closeVendor: noop,
    closeBank: noop,
    onClosed: noop,
    addItemToTrade: noop,
    stageMarketSell: noop,
    stageMailParcel: noop,
    insertItemChatLink: noop,
    showError: noop,
    setPendingPetFeed: noop,
    resetPetBarSig: noop,
    isHotbarItemId: () => false,
    useGatherTool: (item) => {
      gatherToolCalls.push(item);
      return useGatherTool(item);
    },
    setDragAction: noop,
    clearActionDropTargets: noop,
    dragState: new ItemDragState(),
    isTouchHud: () => false,
    markEquipDropTargets: noop,
    dropOnEquipSlot: noop,
    openItemActionMenu: noop,
  };
  new BagsWindow(deps).render();
  return { root, usedItems, gatherToolCalls };
}

function clickFirstCell(root: HTMLElement): void {
  const cell = root.querySelector('button.bag-item');
  expect(cell).not.toBeNull();
  cell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('bags use-click gathering-tool routing (#2343)', () => {
  it('a consumed gathering-tool use never falls back to world.useItem', () => {
    const { root, usedItems, gatherToolCalls } = harness(
      [{ itemId: 'copper_mining_pick', count: 1 }],
      () => true,
    );
    clickFirstCell(root);
    expect(gatherToolCalls.map((i) => i.id)).toEqual(['copper_mining_pick']);
    expect(usedItems).toEqual([]);
  });

  it('a declined use falls back to exactly one plain world.useItem', () => {
    const { root, usedItems, gatherToolCalls } = harness(
      [{ itemId: 'copper_mining_pick', count: 1 }],
      () => false,
    );
    clickFirstCell(root);
    expect(gatherToolCalls).toHaveLength(1);
    expect(usedItems).toEqual(['copper_mining_pick']);
  });

  it('a plain consumable also rides the hook-then-fallback path (the non-tool arm)', () => {
    const { root, usedItems, gatherToolCalls } = harness(
      [{ itemId: 'baked_bread', count: 1 }],
      () => false,
    );
    clickFirstCell(root);
    expect(gatherToolCalls.map((i) => i.id)).toEqual(['baked_bread']);
    expect(usedItems).toEqual(['baked_bread']);
  });
});
