// @vitest-environment jsdom
// The Other characters bank tab no longer repeats the player's bags under the
// selected bank: a click on the docked bags window sends the stack there. This
// pins the pure ladder arms (action, hover hint, unknown cell, destroy), the
// deposit-target gate, and the real BagsWindow dispatch.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { InvSlot } from '../src/sim/types';
import { accountBankDepositTarget } from '../src/ui/account_bank_view';
import {
  type BagMode,
  bagDestroyAction,
  bagItemAction,
  bagTooltipHintKey,
  bagUnknownAction,
} from '../src/ui/bags_view';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { t } from '../src/ui/i18n';
import { ItemDragState } from '../src/ui/item_drag_state';
import type { IWorld } from '../src/world_api';
import type { AccountBankInfo, BankInfo } from '../src/world_api/bank';

const plainId = Object.keys(ITEMS).find((id) => {
  const d = ITEMS[id];
  return !d.soulbound && !d.noMarketList && d.kind !== 'quest' && d.kind !== 'bag' && !d.use;
}) as string;
const questId = Object.keys(ITEMS).find((id) => ITEMS[id].kind === 'quest') as string;
const soulboundId = Object.keys(ITEMS).find(
  (id) => ITEMS[id].soulbound && ITEMS[id].kind !== 'quest',
) as string;

const ACCOUNT_MODE: BagMode = {
  tradeOpen: false,
  mailAttach: false,
  marketSell: false,
  vendorOpen: false,
  bankOpen: true,
  bankDeposit: false,
  bankSocketable: false,
  guildBankDeposit: false,
  vaultDeposit: false,
  accountBankDeposit: true,
  petFeed: false,
};

describe('account bank deposit ladder (pure)', () => {
  it('deposits a movable stack and refuses quest, soulbound, bound and locked copies', () => {
    expect(bagItemAction(ITEMS[plainId], ACCOUNT_MODE)).toBe('accountBankDeposit');
    expect(bagItemAction(ITEMS[questId], ACCOUNT_MODE)).toBe('accountBankDepositBlocked');
    expect(bagItemAction(ITEMS[soulboundId], ACCOUNT_MODE)).toBe('accountBankDepositBlocked');
    expect(bagItemAction(ITEMS[plainId], ACCOUNT_MODE, { boundTo: 7 })).toBe(
      'accountBankDepositBlocked',
    );
    expect(bagItemAction(ITEMS[plainId], ACCOUNT_MODE, { locked: true })).toBe(
      'accountBankDepositBlocked',
    );
  });

  it('previews the same outcome on hover', () => {
    expect(bagTooltipHintKey(ITEMS[plainId], ACCOUNT_MODE)).toBe(
      'hudChrome.bank.accountDepositHint',
    );
    expect(bagTooltipHintKey(ITEMS[questId], ACCOUNT_MODE)).toBe('hudChrome.bank.accountBound');
  });

  it('offers nothing on a def-less cell and keeps destroy inert', () => {
    expect(bagUnknownAction(ACCOUNT_MODE)).toBe('none');
    expect(bagDestroyAction(ITEMS[plainId], { ...ACCOUNT_MODE, bankOpen: false })).toBe('none');
  });

  it('falls to the no-target rung when the account bank is not armed', () => {
    expect(bagItemAction(ITEMS[plainId], { ...ACCOUNT_MODE, accountBankDeposit: false })).toBe(
      'bankDepositBlockedNoTarget',
    );
  });
});

describe('accountBankDepositTarget', () => {
  const info = (over: Partial<AccountBankInfo>): AccountBankInfo => ({
    characters: [{ characterId: 2, name: 'Alt' }],
    selectedCharacterId: 2,
    bank: { slots: [] } as unknown as BankInfo,
    ...over,
  });
  it('names the selected character only while its bank is on screen', () => {
    expect(accountBankDepositTarget(info({}), true)).toBe(2);
    expect(accountBankDepositTarget(info({}), false)).toBeNull();
    expect(accountBankDepositTarget(info({ bank: null }), true)).toBeNull();
    expect(accountBankDepositTarget(info({ selectedCharacterId: null, bank: null }), true)).toBe(
      null,
    );
    expect(accountBankDepositTarget(null, true)).toBeNull();
  });
});

function harness(inventory: InvSlot[], target: number | null) {
  document.body.innerHTML = '<div id="prompt-stack"></div>';
  const calls: unknown[][] = [];
  const errors: string[] = [];
  const other: string[] = [];
  const sink = (name: string) => () => other.push(name);
  const world = {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
    bankInfo: null,
    accountBankTransfer: (...a: unknown[]) => calls.push(a),
    bankDeposit: sink('bankDeposit'),
    bankSocketBag: sink('bankSocketBag'),
    guildBankDeposit: sink('guildBankDeposit'),
    vaultDeposit: sink('vaultDeposit'),
    useItem: sink('useItem'),
    equipBag: sink('equipBag'),
    unequipBag: sink('unequipBag'),
    discardItem: sink('discardItem'),
    feedPet: sink('feedPet'),
    sellItem: sink('sellItem'),
    moveInventoryItem: sink('moveInventoryItem'),
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
    isBankOpen: () => true,
    isPersonalBankTab: () => false,
    isGuildBankTab: () => false,
    isVaultBankTab: () => false,
    accountBankDepositTarget: () => target,
    pendingPetFeed: () => false,
    closeVendor: noop,
    closeBank: noop,
    onClosed: noop,
    addItemToTrade: noop,
    tradeOfferHeadroom: () => 0,
    stageMarketSell: noop,
    stageMailParcel: noop,
    insertItemChatLink: noop,
    showError: (text: string) => errors.push(text),
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
  return { root, calls, errors, other };
}

function clickCellFor(root: HTMLElement, itemId: string): void {
  const cell = Array.from(root.querySelectorAll<HTMLElement>('button.bag-item')).find((c) =>
    c.getAttribute('aria-label')?.includes(ITEMS[itemId].name),
  );
  expect(cell, `no bag cell for ${itemId}`).toBeTruthy();
  cell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('bags click on the Other characters tab (real BagsWindow)', () => {
  it('sends the whole clicked stack, by reference index, to the selected character', () => {
    const h = harness(
      [
        { itemId: questId, count: 1 },
        { itemId: plainId, count: 3 },
      ],
      2,
    );
    clickCellFor(h.root, plainId);
    expect(h.calls).toEqual([[2, 'deposit', 1, 3, { itemId: plainId, count: 3 }]]);
    expect(h.other).toEqual([]);
  });

  it('refuses a quest item with the cross-character line and sends nothing', () => {
    const h = harness([{ itemId: questId, count: 1 }], 2);
    clickCellFor(h.root, questId);
    expect(h.calls).toEqual([]);
    expect(h.other).toEqual([]);
    expect(h.errors).toEqual([t('hudChrome.bank.accountBound')]);
  });

  it('deposits nowhere while the selected bank is still loading', () => {
    const h = harness([{ itemId: plainId, count: 1 }], null);
    clickCellFor(h.root, plainId);
    expect(h.calls).toEqual([]);
    expect(h.other).toEqual([]);
    expect(h.errors).toEqual([t('hudChrome.bank.cannotDepositNow')]);
  });
});
