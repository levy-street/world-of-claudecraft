// @vitest-environment happy-dom
//
// Item history in the guild bank (src/ui/guild_bank_window.ts): any member,
// officer or read-only, can open a tracked pooled copy's history. The guild's
// copy is someone else's hand, so the dialog always receives the public
// projection (no character id, no guid). Desktop reaches it by right-click /
// Context Menu key on the focusable cell; the touch layout adds the visible
// button under the cell. An untracked copy, and a dormant slot whose payload
// was degraded to publicInstanceView (so it carries no record), offer
// nothing. Drives the REAL BankWindow with its composed GuildBankTab pane
// (the guild_bank_window_instance_marker.test.ts harness idiom).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { InvSlot, ItemProvenance } from '../src/sim/types';
import { BankWindow, type BankWindowDeps } from '../src/ui/bank_window';
import { itemDisplayName } from '../src/ui/entity_i18n';
import {
  closeItemHistoryDialog,
  ItemHistoryDialog,
  type ItemHistoryDialogOptions,
} from '../src/ui/item_history_dialog';
import type { BankInfo, GuildBankInfo, GuildBankLogView, IWorld } from '../src/world_api';

const GUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const PARENT = '9b2d1e7a-1c3f-4a5b-8d6e-7f8091a2b3c4';

// Real merged-table ids: a plain tradeable def (never dormant) and a
// soulbound def (dormant in the guild bank).
const plainId = Object.keys(ITEMS).find((id) => {
  const d = ITEMS[id];
  return !d.soulbound && !d.noMarketList && d.kind !== 'quest';
}) as string;
const soulboundId = Object.keys(ITEMS).find(
  (id) => ITEMS[id].soulbound && ITEMS[id].kind !== 'quest',
) as string;
const plainName = itemDisplayName(ITEMS[plainId]);

const provenance: ItemProvenance = {
  at: Date.UTC(2026, 8, 30),
  by: 'Alice',
  byId: 101,
  source: 'mob:forest_wolf',
  derivedFrom: PARENT,
  owners: [{ at: Date.UTC(2026, 9, 1), by: 'Bob', byId: 202 }],
  transfers: 1,
};

function harness(slots: InvSlot[], canEdit = true): { root: HTMLElement; bank: BankWindow } {
  document.body.innerHTML = '<div id="prompt-stack"></div>';
  const root = document.createElement('div');
  root.id = 'bank-window';
  root.className = 'window';
  document.body.appendChild(root);
  const personal: BankInfo = {
    slots: [],
    capacity: 24,
    purchasedSlots: 0,
    bonusSlots: 0,
    nextExpansionCost: 500,
    bonusSources: [],
    socketsUnlocked: 0,
    socketBags: [null, null, null, null],
    nextSocketCost: 1000000,
    generalCapacity: 24,
    materialsCapacity: 0,
    generalUsed: 0,
    materialsUsed: 0,
  };
  const guild: GuildBankInfo = {
    treasury: 60_000,
    slots,
    capacity: 12,
    purchasedSlots: 24,
    nextExpansionPrice: null,
    canEdit,
  };
  const world = {
    bankInfo: personal,
    guildBankInfo: guild,
    inventory: [] as InvSlot[],
    copper: 5_000,
    logView: {
      state: 'loading',
      kind: 'all',
      entries: [],
      more: false,
      olderPending: false,
    } as GuildBankLogView,
    guildBankLog: () => world.logView,
    guildBankLogOlder: () => {},
    bankDeposit: () => {},
    bankWithdraw: () => {},
    bankBuySlots: () => {},
    guildBankDepositGold: () => {},
    guildBankWithdrawGold: () => {},
    guildBankDeposit: () => {},
    guildBankWithdraw: () => {},
    guildBankBuySlots: () => {},
  };
  const noop = (): void => {};
  const deps: BankWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: (c: number) => `<span class="money-inline">${c}</span>`,
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
  const bank = new BankWindow(deps);
  bank.open();
  (root.querySelector('.bank-tab[data-tab="guild"]') as HTMLElement).click();
  return { root, bank };
}

const cellsOf = (root: HTMLElement) =>
  root.querySelectorAll<HTMLElement>('.bank-grid .bank-item:not(.empty)');

function rightClick(el: HTMLElement, pointerType?: string): MouseEvent {
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  if (pointerType !== undefined) Object.defineProperty(ev, 'pointerType', { value: pointerType });
  el.dispatchEvent(ev);
  return ev;
}

function expectPublicView(options: ItemHistoryDialogOptions): void {
  expect(options.itemName).toBe(plainName);
  expect(options.provenance).toEqual({
    at: provenance.at,
    by: 'Alice',
    source: 'mob:forest_wolf',
    owners: [{ at: Date.UTC(2026, 9, 1), by: 'Bob' }],
    transfers: 1,
  });
  const passed = JSON.stringify(options.provenance);
  expect(passed).not.toContain('byId');
  expect(passed).not.toContain(GUID);
  expect(passed).not.toContain(PARENT);
}

afterEach(() => {
  closeItemHistoryDialog(false);
  vi.restoreAllMocks();
  document.body.className = '';
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('guild bank item history', () => {
  it('a desktop right-click on a tracked cell opens the public view, with no extra button', () => {
    const open = vi.spyOn(ItemHistoryDialog.prototype, 'open');
    const { root } = harness([{ itemId: plainId, count: 1, instance: { guid: GUID, provenance } }]);
    const cell = cellsOf(root)[0];
    expect(root.querySelector('.item-history-action')).toBeNull();
    const ev = rightClick(cell, 'mouse');
    expect(ev.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    const options = open.mock.calls[0][0] as ItemHistoryDialogOptions;
    expectPublicView(options);
    expect(options.opener).toBe(cell);
    const dialog = document.getElementById('item-history-dialog') as HTMLElement;
    expect(dialog.textContent).toContain(`${plainName}: history`);
    expect(dialog.textContent).toContain('Looted by Alice on ');
    expect(dialog.textContent).toContain('Passed to Bob on ');
    expect(dialog.innerHTML).not.toContain(GUID);
    // Nothing the player can read names the copy's guid (the grid's
    // data-focus-key serializes the payload, which is not player text).
    expect(root.textContent).not.toContain(GUID);
    for (const el of root.querySelectorAll('[aria-label]')) {
      expect(el.getAttribute('aria-label')).not.toContain(GUID);
    }
    expect(root.inert).toBe(true);
  });

  it('the keyboard Context Menu key (no pointer type) opens it on desktop', () => {
    const open = vi.spyOn(ItemHistoryDialog.prototype, 'open');
    const { root } = harness([{ itemId: plainId, count: 1, instance: { guid: GUID, provenance } }]);
    rightClick(cellsOf(root)[0]);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('a read-only member can open it too', () => {
    const open = vi.spyOn(ItemHistoryDialog.prototype, 'open');
    const { root } = harness(
      [{ itemId: plainId, count: 1, instance: { guid: GUID, provenance } }],
      false,
    );
    const cell = cellsOf(root)[0];
    expect(cell.getAttribute('aria-disabled')).toBe('true');
    rightClick(cell, 'mouse');
    expect(open).toHaveBeenCalledTimes(1);
    expectPublicView(open.mock.calls[0][0] as ItemHistoryDialogOptions);
  });

  it('the touch layout shows the button under the cell; a long-press stays the peek', () => {
    document.body.className = 'mobile-touch';
    const open = vi.spyOn(ItemHistoryDialog.prototype, 'open');
    const { root } = harness([{ itemId: plainId, count: 1, instance: { guid: GUID, provenance } }]);
    const cell = cellsOf(root)[0];
    expect(rightClick(cell, 'touch').defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
    const buttons = root.querySelectorAll<HTMLButtonElement>('.item-history-action');
    expect(buttons).toHaveLength(1);
    const button = buttons[0];
    expect(button.parentElement?.classList.contains('material-source-item-cell')).toBe(true);
    expect(button.parentElement?.firstElementChild).toBe(cell);
    expect(button.textContent).toBe('Item history');
    expect(button.getAttribute('aria-label')).toBe(`Item history for ${plainName}`);
    button.click();
    expect(open).toHaveBeenCalledTimes(1);
    expectPublicView(open.mock.calls[0][0] as ItemHistoryDialogOptions);
  });

  it('an untracked copy and a dormant degraded slot offer nothing', () => {
    document.body.className = 'mobile-touch';
    const open = vi.spyOn(ItemHistoryDialog.prototype, 'open');
    const { root } = harness([
      { itemId: plainId, count: 1, instance: { signer: 'Alice' } },
      // A pipe-refused slot ships publicInstanceView: no guid, no provenance.
      { itemId: soulboundId, count: 1, instance: { signer: 'Alice' } },
      { itemId: plainId, count: 3 },
    ]);
    expect(root.querySelectorAll('.item-history-action')).toHaveLength(0);
    document.body.className = '';
    for (const cell of cellsOf(root)) {
      expect(rightClick(cell, 'mouse').defaultPrevented).toBe(false);
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('closing the bank closes the history prompt and clears inert', () => {
    const { root, bank } = harness([
      { itemId: plainId, count: 1, instance: { guid: GUID, provenance } },
    ]);
    rightClick(cellsOf(root)[0], 'mouse');
    expect(document.getElementById('item-history-dialog')).not.toBeNull();
    bank.close();
    expect(document.getElementById('item-history-dialog')).toBeNull();
    expect(root.inert).toBe(false);
  });
});
