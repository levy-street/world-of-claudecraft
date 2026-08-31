// @vitest-environment happy-dom
// The vendor right-click "Sell all (N)" menu row (new-player-first-hour doc,
// section 6): drives the REAL BagsWindow against a jsdom container (the
// bags_window_use_routing.test.ts fixture idiom) and pins the wiring the pure
// bag_item_context_menu.test.ts core cannot reach on its own: a plain
// right-click at an open vendor opens the item menu with every copy of the
// clicked item held across the bags, Ctrl/Meta right-click keeps its existing
// instant split-stack-sell shortcut untouched, and an item the vendor refuses
// (noVendorSell) never grows a sell affordance the sim would refuse.
import { describe, expect, it } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import type { IWorld } from '../src/world_api';

interface MenuCall {
  itemId: string;
  vendorSellCount: number | undefined;
  runSellAll: (() => void) | undefined;
}

function harness(
  inventory: InvSlot[],
  sellItem: (itemId: string, count?: number) => void = () => {},
): { root: HTMLElement; menuCalls: MenuCall[] } {
  document.body.innerHTML = '<div id="prompt-stack"></div>';
  const menuCalls: MenuCall[] = [];
  const world = {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
    sellItem,
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
    vendorOpen: () => true,
    tradeOpen: () => false,
    isMarketSell: () => false,
    isMailAttach: () => false,
    isBankOpen: () => false,
    isPersonalBankTab: () => false,
    isGuildBankTab: () => false,
    pendingPetFeed: () => false,
    closeVendor: noop,
    closeBank: noop,
    onClosed: noop,
    confirmVendorSell: () => true,
    isVaultBankTab: () => false,
    addItemToTrade: noop,
    stageMarketSell: noop,
    stageMailParcel: noop,
    insertItemChatLink: noop,
    showError: noop,
    setPendingPetFeed: noop,
    resetPetBarSig: noop,
    isHotbarItemId: () => false,
    useGatherTool: () => false,
    setDragAction: noop,
    clearActionDropTargets: noop,
    dragState: new ItemDragState(),
    isTouchHud: () => false,
    markEquipDropTargets: noop,
    dropOnEquipSlot: noop,
    dropOnActionSlot: noop,
    dropOnActionRingSlot: noop,
    openItemActionMenu: (
      _def,
      itemId,
      _slotIndex,
      _x,
      _y,
      _runDefault,
      _instance,
      vendorSellCount,
      runSellAll,
    ) => {
      menuCalls.push({ itemId, vendorSellCount, runSellAll });
    },
  };
  new BagsWindow(deps).render();
  return { root, menuCalls };
}

function rightClickFirstCell(root: HTMLElement, modifiers: { ctrlKey?: boolean } = {}): void {
  const cell = root.querySelector('button.bag-item');
  expect(cell).not.toBeNull();
  cell?.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...modifiers }),
  );
}

function quantityPrompt(): HTMLElement | null {
  return document.querySelector('.sell-quantity-prompt');
}

function confirmQuantityPrompt(): void {
  const button = quantityPrompt()?.querySelector('button.btn');
  expect(button, 'no quantity prompt confirm button').toBeTruthy();
  (button as HTMLElement).click();
}

describe('bags_window vendor right-click menu (Sell all)', () => {
  it('plain right-click opens the item menu with every copy of the item held across the bags', () => {
    const { root, menuCalls } = harness([
      { itemId: 'baked_bread', count: 5 },
      { itemId: 'baked_bread', count: 3 },
    ]);
    rightClickFirstCell(root);
    expect(menuCalls).toHaveLength(1);
    expect(menuCalls[0].itemId).toBe('baked_bread');
    expect(menuCalls[0].vendorSellCount).toBe(8);
    expect(menuCalls[0].runSellAll).toEqual(expect.any(Function));
  });

  it('a single held copy still opens the menu (Sell all only appears above 1, in the pure core)', () => {
    const { root, menuCalls } = harness([{ itemId: 'baked_bread', count: 1 }]);
    rightClickFirstCell(root);
    expect(menuCalls).toHaveLength(1);
    expect(menuCalls[0].itemId).toBe('baked_bread');
    expect(menuCalls[0].vendorSellCount).toBe(1);
    expect(menuCalls[0].runSellAll).toEqual(expect.any(Function));
  });

  it('an item the vendor refuses (noVendorSell) never opens the menu on a plain right-click', () => {
    const { root, menuCalls } = harness([{ itemId: 'reins_valorsteed', count: 1 }]);
    rightClickFirstCell(root);
    expect(menuCalls).toEqual([]);
  });

  it('Sell all on common+ stacks opens the existing quantity prompt before selling', () => {
    const sold: Array<[string, number | undefined]> = [];
    const { root, menuCalls } = harness(
      [
        { itemId: 'baked_bread', count: 5 },
        { itemId: 'baked_bread', count: 3 },
      ],
      (itemId, count) => sold.push([itemId, count]),
    );
    rightClickFirstCell(root);
    menuCalls[0].runSellAll?.();
    expect(sold).toEqual([]);
    const prompt = quantityPrompt();
    expect(prompt).not.toBeNull();
    expect(prompt?.querySelector<HTMLInputElement>('input.prompt-number')?.value).toBe('8');
    confirmQuantityPrompt();
    expect(sold).toEqual([['baked_bread', 8]]);
  });

  it('Sell all on a poor stack with an instanced copy opens the quantity prompt first', () => {
    const sold: Array<[string, number | undefined]> = [];
    const { root, menuCalls } = harness(
      [
        { itemId: 'tangled_weed', count: 1 },
        { itemId: 'tangled_weed', count: 1, instance: { signer: 'Ayla' } },
      ],
      (itemId, count) => sold.push([itemId, count]),
    );
    rightClickFirstCell(root);
    menuCalls[0].runSellAll?.();
    expect(sold).toEqual([]);
    expect(quantityPrompt()).not.toBeNull();
  });

  it('Sell all on a poor stack with a crafted marker opens the quantity prompt first', () => {
    const sold: Array<[string, number | undefined]> = [];
    const { root, menuCalls } = harness(
      [
        { itemId: 'tangled_weed', count: 1 },
        { itemId: 'tangled_weed', count: 1, craftedRecipeId: 'recipe_tangled_weed' },
      ],
      (itemId, count) => sold.push([itemId, count]),
    );
    rightClickFirstCell(root);
    menuCalls[0].runSellAll?.();
    expect(sold).toEqual([]);
    expect(quantityPrompt()).not.toBeNull();
  });

  it('Sell all still directly sells when every held copy is true vendor junk', () => {
    const sold: Array<[string, number | undefined]> = [];
    const { root, menuCalls } = harness(
      [
        { itemId: 'tangled_weed', count: 3 },
        { itemId: 'tangled_weed', count: 2 },
      ],
      (itemId, count) => sold.push([itemId, count]),
    );
    rightClickFirstCell(root);
    menuCalls[0].runSellAll?.();
    expect(quantityPrompt()).toBeNull();
    expect(sold).toEqual([['tangled_weed', 5]]);
  });

  it('Ctrl+right-click keeps its direct split-stack sell shortcut, not the menu', () => {
    // True junk (poor quality, no instance payload) is the one case
    // sellBagItem's ctrl arm still sells instantly with no confirm
    // (vendorSellIsInstant, bags_view.ts): a common+ item now routes ctrl
    // through the same confirm gate release/v0.41.0 carries (issue #3547),
    // covered by tests/bags_vendor_sell_confirm.test.ts, not here.
    const sold: Array<[string, number | undefined]> = [];
    const { root, menuCalls } = harness([{ itemId: 'tangled_weed', count: 5 }], (itemId, count) =>
      sold.push([itemId, count]),
    );
    rightClickFirstCell(root, { ctrlKey: true });
    expect(menuCalls).toEqual([]);
    expect(sold).toEqual([['tangled_weed', 5]]);
  });
});
