// @vitest-environment happy-dom
// Drives the real bags painter through the player click that originally
// rejected every soulbound copy before the authoritative trade path could see
// its temporary bind-on-pickup party-trade marker (PR #3791): a still-live
// marker stages the copy, an expired one (by the host clock) shows the
// Soulbound refusal.
import { describe, expect, it } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import type { IWorld } from '../src/world_api';

function clickHarness(
  inventory: InvSlot[],
  partyTradeMsRemaining = 1,
): {
  root: HTMLElement;
  staged: string[];
  errors: string[];
} {
  document.body.innerHTML = '';
  const staged: string[] = [];
  const errors: string[] = [];
  const root = document.createElement('div');
  document.body.appendChild(root);
  const world = {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
    questLog: new Map(),
    partyTradeMsRemaining: () => partyTradeMsRemaining,
  } as unknown as IWorld;
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
    tradeOpen: () => true,
    isMarketSell: () => false,
    isMailAttach: () => false,
    isBankOpen: () => false,
    isPersonalBankTab: () => false,
    isGuildBankTab: () => false,
    isVaultBankTab: () => false,
    pendingPetFeed: () => false,
    closeVendor: noop,
    closeBank: noop,
    onClosed: noop,
    addItemToTrade: (itemId) => staged.push(itemId),
    stageMarketSell: noop,
    stageMailParcel: noop,
    insertItemChatLink: noop,
    showError: (message) => errors.push(message),
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
    dropOnActionSlot: noop,
    dropOnActionRingSlot: noop,
    openItemActionMenu: noop,
  };
  new BagsWindow(deps).render();
  return { root, staged, errors };
}

function clickFirstCell(root: HTMLElement): void {
  const cell = root.querySelector('button.bag-item');
  expect(cell).not.toBeNull();
  cell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const WINDOWED_SIGIL: InvSlot = {
  itemId: 'sigil_anvil_helmet',
  count: 1,
  instance: {
    partyTrade: { untilMs: 10_000, eligible: ['Alice', 'Bob'] },
  },
};

describe('bags party-trade click path', () => {
  it('stages a windowed soulbound sigil instead of showing the Soulbound refusal', () => {
    const { root, staged, errors } = clickHarness([WINDOWED_SIGIL]);

    clickFirstCell(root);

    expect(staged).toEqual(['sigil_anvil_helmet']);
    expect(errors).toEqual([]);
  });

  it('shows the Soulbound refusal after the host clock expires the same marker', () => {
    const { root, staged, errors } = clickHarness([WINDOWED_SIGIL], 0);

    clickFirstCell(root);

    expect(staged).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});
