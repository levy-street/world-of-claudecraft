// @vitest-environment happy-dom
// The destroy-quantity prompt's default (new-player-first-hour doc, section
// 6): drives the REAL BagsWindow against a jsdom container (the
// bags_window_use_routing.test.ts fixture idiom) to pin that clicking an
// inert quest stack (discardQuest) pre-fills the destroy prompt's quantity
// input with the FULL held count, not 1, while leaving it editable (max stays
// the same held count, so a player who wants fewer can still type it).
import { describe, expect, it } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import type { IWorld } from '../src/world_api';

function harness(inventory: InvSlot[]): { root: HTMLElement } {
  const world = {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
  } as unknown as IWorld;
  const root = document.createElement('div');
  document.body.appendChild(root);
  // showDiscardItemPrompt appends into #prompt-stack (bags_window.ts), a
  // sibling the bags window itself does not render.
  const promptStack = document.createElement('div');
  promptStack.id = 'prompt-stack';
  document.body.appendChild(promptStack);
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
    openItemActionMenu: noop,
  };
  new BagsWindow(deps).render();
  return { root };
}

function clickFirstCell(root: HTMLElement): void {
  const cell = root.querySelector('button.bag-item');
  expect(cell).not.toBeNull();
  cell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('bags_window destroy prompt default quantity', () => {
  it('pre-fills the full held count for a multi-count inert quest stack', () => {
    const { root } = harness([{ itemId: 'boar_hide', count: 4 }]);
    clickFirstCell(root);
    const input = document.querySelector<HTMLInputElement>(
      '.discard-item-prompt input.prompt-number',
    );
    expect(input).not.toBeNull();
    expect(input?.value).toBe('4');
    expect(input?.max).toBe('4');
  });

  it('a single-copy stack shows no quantity input at all (nothing to edit)', () => {
    const { root } = harness([{ itemId: 'boar_hide', count: 1 }]);
    clickFirstCell(root);
    const input = document.querySelector('.discard-item-prompt input.prompt-number');
    expect(input).toBeNull();
  });
});
