// @vitest-environment happy-dom
//
// The bags focus-restore ladder (the phase 13 QA hand-off): the window
// rebuilds whole on the same onInventoryChanged hook the vendor does and
// used to drop keyboard focus to <body> every time a stack changed. Drives
// the REAL BagsWindow (the bags_window_use_routing harness idiom): exact
// identity first, then the same grid slot walking outward, then Close.

import { describe, expect, it } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import type { IWorld } from '../src/world_api';

function harness(inventory: InvSlot[]): { root: HTMLElement; w: BagsWindow; inv: InvSlot[] } {
  const world = {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
    useItem: () => {},
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
    isGuildBankTab: () => false,
    dropOnActionSlot: noop,
    dropOnActionRingSlot: noop,
    openItemActionMenu: noop,
  };
  const w = new BagsWindow(deps);
  w.render();
  return { root, w, inv: inventory };
}

function focusRow(root: HTMLElement, key: string): void {
  const rows = [...root.querySelectorAll<HTMLElement>('[data-focus-key]')];
  const row = rows.find((node) => node.dataset.focusKey === key);
  expect(row, `missing focus key ${key}`).toBeTruthy();
  row?.focus();
  expect(document.activeElement).toBe(row);
}

function activeKey(): string | undefined {
  return (document.activeElement as HTMLElement | null)?.dataset.focusKey;
}

describe('bags window focus restore (the vendor ladder pattern)', () => {
  it('the exact stack keeps focus across a rebuild', () => {
    const { root, w } = harness([
      { itemId: 'wolf_fang', count: 2 },
      { itemId: 'baked_bread', count: 1 },
    ]);
    // Ordinal keys (the phase 14 QA): the bread is the FIRST baked_bread,
    // whatever its raw inventory index.
    focusRow(root, 'bag:baked_bread:0');
    w.render();
    expect(activeKey()).toBe('bag:baked_bread:0');
  });

  it('a consumed stack lands the same slot (the next item), never <body>', () => {
    const inv: InvSlot[] = [
      { itemId: 'wolf_fang', count: 1 },
      { itemId: 'baked_bread', count: 1 },
      { itemId: 'wolf_fang', count: 3 },
    ];
    const { root, w } = harness(inv);
    focusRow(root, 'bag:baked_bread:0');
    // The focused stack is consumed (the sim removed it); the rebuild must
    // land the SAME slot, which now holds the next stack (the second
    // wolf_fang, ordinal 1).
    inv.splice(1, 1);
    w.render();
    expect(document.activeElement).not.toBe(document.body);
    expect(activeKey()).toBe('bag:wolf_fang:1');
  });

  it('consuming an earlier different-item stack keeps focus on the SAME stack, not its key-heir', () => {
    // The ordinal-key improvement pinned by ELEMENT identity, not by key
    // string (a key-equality assertion passes under raw index keys too,
    // because the neighbor stack inherits the stale key and answers to it).
    // Under index keys the bread's removal shifted the focused stack's key
    // onto its neighbor and the exact rung landed one stack over even
    // though the focused stack survived; the ordinal key is stable, so the
    // SAME element keeps focus.
    const inv: InvSlot[] = [
      { itemId: 'baked_bread', count: 1 },
      { itemId: 'wolf_fang', count: 1 },
      { itemId: 'wolf_fang', count: 3 },
    ];
    const { root, w } = harness(inv);
    const fangRows = () => [
      ...root.querySelectorAll<HTMLElement>('.bag-grid [data-focus-key^="bag:wolf_fang"]'),
    ];
    // Focus the FIRST wolf_fang by position: key-independent, so this arm
    // decides between key schemes instead of assuming one.
    fangRows()[0].focus();
    expect(document.activeElement).toBe(fangRows()[0]);
    inv.splice(0, 1);
    w.render();
    expect(document.activeElement).toBe(fangRows()[0]);
    expect(activeKey()).toBe('bag:wolf_fang:0');
  });

  it('the sort select carries a focus key and survives its own rebuild', () => {
    // The one filter-bar control the ladder missed (the phase 14 QA): its
    // change handler rebuilds the window, and keyless it fell to <body>.
    const { root, w } = harness([{ itemId: 'wolf_fang', count: 1 }]);
    const sort = root.querySelector<HTMLElement>('[data-focus-key="bag-sort"]');
    expect(sort).toBeTruthy();
    sort?.focus();
    w.render();
    expect(activeKey()).toBe('bag-sort');
  });

  it('the last stack falls to Close, and non-grid controls restore exactly', () => {
    const inv: InvSlot[] = [{ itemId: 'wolf_fang', count: 1 }];
    const { root, w } = harness(inv);
    focusRow(root, 'bag:wolf_fang:0');
    inv.length = 0;
    w.render();
    expect(activeKey()).toBe('close');
    // A non-grid control (the close button itself) restores by identity too.
    w.render();
    expect(activeKey()).toBe('close');
  });
});
