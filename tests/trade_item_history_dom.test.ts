// @vitest-environment happy-dom

// Item history in the trade window (src/ui/hud/woc_trade/woc_trade_controller.ts):
// a tracked copy on EITHER side of the table offers its history, through the
// visible button beside the row and a desktop right-click on the row. The
// counterparty's copy reaches the dialog as the public projection, so no
// character id (and no guid) is ever handed to it; an untracked copy offers
// nothing; and closing the trade closes the prompt with it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { InvSlot, ItemProvenance } from '../src/sim/types';
import { itemDisplayName } from '../src/ui/entity_i18n';
import {
  WocTradeController,
  type WocTradeControllerDeps,
} from '../src/ui/hud/woc_trade/woc_trade_controller';
import {
  closeItemHistoryDialog,
  ItemHistoryDialog,
  type ItemHistoryDialogOptions,
} from '../src/ui/item_history_dialog';
import type { IWorld } from '../src/world_api';

const GUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const PARENT = '9b2d1e7a-1c3f-4a5b-8d6e-7f8091a2b3c4';

// Real merged-table ids, derived so a content rename cannot rot this suite
// into the unknown-id row (which renders no tooltip and no history).
const gearId = Object.keys(ITEMS).find(
  (id) => ITEMS[id].quality === 'epic' && ITEMS[id].kind === 'weapon',
) as string;
const plainId = Object.keys(ITEMS).find(
  (id) => id !== gearId && ITEMS[id].kind === 'weapon',
) as string;
const gearName = itemDisplayName(ITEMS[gearId]);

function provenance(by: string, byId: number, hand: string, handId: number): ItemProvenance {
  return {
    at: Date.UTC(2026, 8, 30),
    by,
    byId,
    source: 'mob:forest_wolf',
    derivedFrom: PARENT,
    owners: [{ at: Date.UTC(2026, 9, 1), by: hand, byId: handId }],
    transfers: 1,
  };
}

const mine = provenance('Aldric', 11, 'Aldric2', 12);
const theirs = provenance('Mallory', 501, 'Bree', 502);

interface TradeInfoFixture {
  otherName: string;
  myOffer: { items: InvSlot[]; copper: number };
  theirOffer: { items: InvSlot[]; copper: number };
  myAccepted: boolean;
  theirAccepted: boolean;
}

function rig(myItems: InvSlot[], theirItems: InvSlot[]) {
  document.body.innerHTML =
    '<div id="trade-window" class="window" style="display:none"></div><div id="bags" style="display:none"></div><div id="prompt-stack"></div>';
  const state: { info: TradeInfoFixture | null } = {
    info: {
      otherName: 'Bree',
      myOffer: { items: myItems, copper: 0 },
      theirOffer: { items: theirItems, copper: 0 },
      myAccepted: false,
      theirAccepted: false,
    },
  };
  const world = {
    get tradeInfo() {
      return state.info;
    },
    inventory: [],
    tradeConfirm: () => {},
    tradeCancel: () => {},
    tradeClose: () => {},
    tradeSetOffer: () => {},
  } as unknown as IWorld;
  let staged = { items: [] as InvSlot[], copper: 0 };
  const deps: WocTradeControllerDeps = {
    world: () => world,
    marketHooks: () => null,
    staged: () => staged,
    setStaged: (next) => {
      staged = next;
    },
    pushTradeOffer: () => {},
    refreshWocBalance: () => {},
    log: () => {},
    itemIcon: () => '<span class="icon"></span>',
    attachTooltip: () => {},
    itemTooltip: () => '',
    renderBags: () => {},
  };
  const controller = new WocTradeController(deps);
  controller.updateTradeWindow();
  const el = document.getElementById('trade-window') as HTMLElement;
  return { controller, state, el };
}

const myCol = (el: HTMLElement) => el.querySelector('.trade-col:first-child') as HTMLElement;
const theirCol = (el: HTMLElement) => el.querySelector('.trade-col:last-child') as HTMLElement;
const historyButtons = (col: HTMLElement) =>
  col.querySelectorAll<HTMLButtonElement>('.item-history-action');

afterEach(() => {
  closeItemHistoryDialog(false);
  vi.restoreAllMocks();
  document.body.className = '';
  document.body.innerHTML = '';
});

describe('trade window item history', () => {
  it('offers the history button on a tracked copy on both sides, never on an untracked one', () => {
    const { el } = rig(
      [
        { itemId: gearId, count: 1, instance: { guid: GUID, provenance: mine } },
        { itemId: plainId, count: 1 },
      ],
      [
        { itemId: plainId, count: 1, instance: { signer: 'Bree' } },
        { itemId: gearId, count: 1, instance: { guid: GUID, provenance: theirs } },
      ],
    );
    const mineButtons = historyButtons(myCol(el));
    const theirButtons = historyButtons(theirCol(el));
    expect(mineButtons).toHaveLength(1);
    expect(theirButtons).toHaveLength(1);
    // Each button sits beside ITS tracked row, in the shared row-plus-action wrapper.
    for (const button of [mineButtons[0], theirButtons[0]]) {
      const wrapper = button.parentElement as HTMLElement;
      expect(wrapper.classList.contains('material-source-item-trade')).toBe(true);
      expect(wrapper.querySelector('.trade-item')?.textContent).toContain(ITEMS[gearId].name);
      expect(button.textContent).toBe('Item history');
      expect(button.getAttribute('aria-label')).toBe(`Item history for ${gearName}`);
      expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    }
    // No item ID anywhere in the window.
    expect(el.innerHTML).not.toContain(GUID);
  });

  it('opens the counterparty history as the public view: no byId and no guid reach the dialog', () => {
    const open = vi.spyOn(ItemHistoryDialog.prototype, 'open');
    const { el } = rig(
      [],
      [{ itemId: gearId, count: 1, instance: { guid: GUID, provenance: theirs } }],
    );
    historyButtons(theirCol(el))[0].click();
    expect(open).toHaveBeenCalledTimes(1);
    const options = open.mock.calls[0][0] as ItemHistoryDialogOptions;
    expect(options.itemName).toBe(gearName);
    expect(options.provenance).toEqual({
      at: theirs.at,
      by: 'Mallory',
      source: 'mob:forest_wolf',
      owners: [{ at: Date.UTC(2026, 9, 1), by: 'Bree' }],
      transfers: 1,
    });
    const passed = JSON.stringify(options.provenance);
    expect(passed).not.toContain('byId');
    expect(passed).not.toContain(GUID);
    expect(passed).not.toContain(PARENT);
    // The dialog renders the path the copy took, inside the shared prompt stack.
    const dialog = document.getElementById('item-history-dialog') as HTMLElement;
    expect(dialog.closest('#prompt-stack')).not.toBeNull();
    expect(dialog.textContent).toContain(`${gearName}: history`);
    expect(dialog.textContent).toContain('Looted by Mallory on ');
    expect(dialog.textContent).toContain('Passed to Bree on ');
    expect(dialog.innerHTML).not.toContain(GUID);
    expect(el.inert).toBe(true);
  });

  it('opens the viewer own copy with its own record', () => {
    const open = vi.spyOn(ItemHistoryDialog.prototype, 'open');
    const { el } = rig(
      [{ itemId: gearId, count: 1, instance: { guid: GUID, provenance: mine } }],
      [],
    );
    historyButtons(myCol(el))[0].click();
    const options = open.mock.calls[0][0] as ItemHistoryDialogOptions;
    expect(options.provenance).toBe(mine);
    const dialog = document.getElementById('item-history-dialog') as HTMLElement;
    expect(dialog.textContent).toContain('Looted by Aldric on ');
    expect(dialog.textContent).toContain('Passed to Aldric2 on ');
    // The button click opened the history, not the own row's remove prompt.
    expect(document.querySelector('.trade-remove-prompt')).toBeNull();
  });

  it('a desktop right-click on the counterparty row opens the public view; a touch long-press does not', () => {
    const open = vi.spyOn(ItemHistoryDialog.prototype, 'open');
    const { el } = rig(
      [],
      [{ itemId: gearId, count: 1, instance: { guid: GUID, provenance: theirs } }],
    );
    const row = theirCol(el).querySelector('.trade-item') as HTMLElement;
    const touch = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    Object.defineProperty(touch, 'pointerType', { value: 'touch' });
    row.dispatchEvent(touch);
    expect(open).not.toHaveBeenCalled();
    expect(touch.defaultPrevented).toBe(false);

    const click = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    Object.defineProperty(click, 'pointerType', { value: 'mouse' });
    row.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    const options = open.mock.calls[0][0] as ItemHistoryDialogOptions;
    expect(JSON.stringify(options.provenance)).not.toContain('byId');
    expect(options.opener).toBe(row);
  });

  it('an untracked row wires no right-click door', () => {
    const open = vi.spyOn(ItemHistoryDialog.prototype, 'open');
    const { el } = rig([], [{ itemId: plainId, count: 1 }]);
    const row = theirCol(el).querySelector('.trade-item') as HTMLElement;
    const click = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    row.dispatchEvent(click);
    expect(open).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(false);
    expect(historyButtons(theirCol(el))).toHaveLength(0);
  });

  it('closing the trade closes the history prompt and clears inert', () => {
    const { controller, state, el } = rig(
      [],
      [{ itemId: gearId, count: 1, instance: { guid: GUID, provenance: theirs } }],
    );
    historyButtons(theirCol(el))[0].click();
    expect(document.getElementById('item-history-dialog')).not.toBeNull();
    state.info = null;
    controller.updateTradeWindow();
    expect(document.getElementById('item-history-dialog')).toBeNull();
    expect(el.inert).toBe(false);
  });
});
