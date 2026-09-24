// @vitest-environment happy-dom
// The bag cell's item-cooldown curtain (the faction quartermaster goods in
// ITEM_BASE_COOLDOWNS, plus the firebottle) against the REAL BagsWindow (the
// bags_window_unknown_cell.test.ts fixture idiom). Pins that an item with a
// running cooldown paints the curtain seeded from the player's timer, that an
// idle one does not, and that an ordinary stack never reads world.player (the
// many stub worlds in the other bags_window suites carry no player at all).
import { describe, expect, it } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import type { IWorld } from '../src/world_api';

function render(inventory: InvSlot[], player?: unknown): HTMLElement {
  const world = {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
    bankInfo: { slots: [], capacity: 8 },
    ...(player ? { player } : {}),
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
    isPersonalBankTab: () => false,
    pendingPetFeed: () => false,
    closeVendor: noop,
    closeBank: noop,
    onClosed: noop,
    addItemToTrade: noop,
    tradeOfferHeadroom: () => 0,
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
    sellConfirmPolicy: () => ({ enabled: true, minQualityRank: 1 }),
    markEquipDropTargets: noop,
    dropOnEquipSlot: noop,
    isGuildBankTab: () => false,
    isVaultBankTab: () => false,
    dropOnActionSlot: noop,
    dropOnActionRingSlot: noop,
    openItemActionMenu: noop,
  };
  new BagsWindow(deps).render();
  return root;
}

const curtains = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.bag-cd-curtain')];

describe('the bag item-cooldown curtain', () => {
  it('paints a curtain seeded from the remaining seconds while the cooldown runs', () => {
    const player = { cooldowns: new Map([['allied_hearthstone', 450]]), firebottleCdRemaining: 0 };
    const root = render([{ itemId: 'allied_hearthstone', count: 1 }], player);
    const [curtain] = curtains(root);
    expect(curtains(root)).toHaveLength(1);
    // 450 of the 900 second base cooldown remains: half the sweep.
    expect(curtain.style.getPropertyValue('--cd-start')).toBe('50%');
    expect(curtain.style.getPropertyValue('--cd-dur')).toBe('450s');
  });

  it('paints nothing when the item is off cooldown', () => {
    const player = { cooldowns: new Map(), firebottleCdRemaining: 0 };
    const root = render([{ itemId: 'allied_hearthstone', count: 1 }], player);
    expect(curtains(root)).toHaveLength(0);
  });

  it('an ordinary stack renders without reading world.player', () => {
    const root = render([{ itemId: 'copper_ore', count: 5 }]);
    expect(root.querySelector('button.bag-item')).not.toBeNull();
    expect(curtains(root)).toHaveLength(0);
  });
});
