// @vitest-environment happy-dom
//
// A STALE bag click must refuse, never guess. The bags grid is painted from a
// snapshot of the inventory, and online a snapshot can replace the whole array
// between the paint and the click; the DOM row then carries a slot object that
// is no longer in the live bags, and bagStackIndex answers -1.
//
// Two paths used to swallow that. The action arms resolved the copy through
// copyRefFor and, on -1, dispatched the command ID-ONLY, which runs the sim's
// newest-match walk and spends an id-MATE the player never clicked. The action
// menu's lock/unlock row forwarded the raw menu-open index, which after a shift
// either names nothing (silently, since the Sim delegate drops setItemLocked's
// result) or names a live cell holding a different copy of the same id.
//
// Both now re-resolve and refuse with the sim's own not-held line, the direction
// the destroy menu's fail-closed -1 and the discard prompt's
// re-resolve-then-refuse already settled. These drive the REAL window and the
// REAL menu (the bags_vendor_sell_confirm.test.ts fixture idiom).

import { beforeEach, describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { InvSlot, ItemDef } from '../src/sim/types';
import { BagItemActionMenu, type BagMenuTarget } from '../src/ui/bag_item_action_menu';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import { tSim } from '../src/ui/sim_i18n';
import type { IWorld } from '../src/world_api';

/** A consumable whose plain click is a `use`. */
const usableId = Object.keys(ITEMS).find((id) => ITEMS[id].kind === 'potion') as string;

interface Harness {
  root: HTMLElement;
  calls: string[];
  errors: string[];
  inventory: InvSlot[];
}

function harness(inventory: InvSlot[]): Harness {
  document.body.innerHTML = '<div id="prompt-stack"></div>';
  const calls: string[] = [];
  const errors: string[] = [];
  const sink =
    (name: string) =>
    (...a: unknown[]) =>
      calls.push(
        `${name}:${a
          .filter((x) => x !== undefined)
          .map((x) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x)))
          .join(',')}`,
      );
  const world = {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
    useItem: sink('useItem'),
    equipBag: sink('equipBag'),
    feedPet: sink('feedPet'),
    sellItem: sink('sellItem'),
    discardItem: sink('discardItem'),
    bankSocketBag: sink('bankSocketBag'),
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
    isBankOpen: () => false,
    isPersonalBankTab: () => false,
    isGuildBankTab: () => false,
    isVaultBankTab: () => false,
    pendingPetFeed: () => false,
    closeVendor: noop,
    closeBank: noop,
    onClosed: noop,
    addItemToTrade: noop,
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
    markEquipDropTargets: noop,
    dropOnEquipSlot: noop,
    dropOnActionSlot: noop,
    dropOnActionRingSlot: noop,
    openItemActionMenu: noop,
  };
  new BagsWindow(deps).render();
  return { root, calls, errors, inventory };
}

function clickFirstCell(root: HTMLElement): void {
  const cell = root.querySelector<HTMLElement>('button.bag-item');
  expect(cell, 'no bag cell was painted').toBeTruthy();
  cell?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** Replace every slot object with an EQUAL-LOOKING fresh one, exactly what an
 *  online snapshot does: the bags read identically, but the objects the painted
 *  rows captured are no longer in the array. */
function replaceWithFreshObjects(inventory: InvSlot[]): void {
  const fresh = inventory.map((slot) => ({ ...slot }));
  inventory.splice(0, inventory.length, ...fresh);
}

describe('a stale bag click refuses instead of spending an id-mate', () => {
  it('a live click still dispatches, naming the clicked cell', () => {
    // The control arm: without it every refusal below would also pass on a
    // window that dispatches nothing at all.
    const h = harness([{ itemId: usableId, count: 1 }]);
    clickFirstCell(h.root);
    // The command names the CELL and, beside it, the COPY: the ordinal-plus-
    // count anchor the server re-derives against its own bags
    // (src/sim/item_copy_anchor.ts), so a lagging mirror cannot land this on
    // the id-mate next door.
    expect(h.calls).toEqual([
      `useItem:${usableId},{"slotIndex":0,"anchor":{"ordinal":0,"count":1}}`,
    ]);
    expect(h.errors).toEqual([]);
  });

  it('a stale click sends NOTHING and voices the not-held line', () => {
    // Two copies of one id: the id-only fallback would happily spend the other.
    const h = harness([
      { itemId: usableId, count: 1 },
      { itemId: usableId, count: 1 },
    ]);
    replaceWithFreshObjects(h.inventory);
    clickFirstCell(h.root);
    expect(h.calls).toEqual([]);
    expect(h.errors).toEqual([tSim('error.noItem')]);
  });

  it('a stale click refuses even when the item is genuinely still held', () => {
    // The honest scope, stated so it is not read as a bug later: online,
    // ClientWorld replaces the inventory array on any inventory-carrying
    // snapshot, so a click racing one refuses although the copy is right
    // there. That is the destroy prompt's own known trade, and it is the safe
    // side: retry-once beats spending the wrong copy.
    const h = harness([{ itemId: usableId, count: 1 }]);
    replaceWithFreshObjects(h.inventory);
    expect(h.inventory).toHaveLength(1);
    clickFirstCell(h.root);
    expect(h.calls).toEqual([]);
    expect(h.errors).toEqual([tSim('error.noItem')]);
  });
});

describe('the action menu lock/unlock row re-resolves at action time', () => {
  let calls: string[];
  let refusals: number;
  let afterActions: number;
  let inventory: InvSlot[];
  let activate: ((act: string) => void) | null;

  function menuFor(def: ItemDef): BagItemActionMenu {
    return new BagItemActionMenu({
      world: () =>
        ({
          inventory,
          equipment: {},
          equipmentInstances: {},
          countItem: () => 0,
          setItemLocked: (itemId: string, locked: boolean, target: { slotIndex: number }) => {
            calls.push(`setItemLocked:${itemId},${locked},${target.slotIndex}`);
          },
        }) as unknown as IWorld,
      ctxMenu: {
        element: () => {
          const el = document.createElement('div');
          document.body.appendChild(el);
          return el;
        },
        place: () => {},
        bind: (onActivate) => {
          activate = onActivate;
        },
      },
      confirmDialog: () => {},
      slotName: () => 'Finger',
      isMobileLayout: () => false,
      afterAction: () => {
        afterActions += 1;
      },
    });
  }

  function target(slot: InvSlot | undefined, index: number): BagMenuTarget {
    return {
      index,
      slot,
      refuseNotHeld: () => {
        refusals += 1;
      },
    };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    calls = [];
    refusals = 0;
    afterActions = 0;
    activate = null;
  });

  it('locks the clicked copy at its LIVE index after a shift, not its menu-open one', () => {
    const first: InvSlot = { itemId: usableId, count: 1 };
    const clicked: InvSlot = { itemId: usableId, count: 1, instance: { locked: undefined } };
    inventory = [clicked, first];
    const menu = menuFor(ITEMS[usableId]);
    menu.open(ITEMS[usableId], usableId, target(clicked, 0), 5, 5, () => {});
    // A snapshot reorders the bags between the menu opening and the row click.
    inventory.reverse();
    expect(activate).not.toBeNull();
    activate?.('lock');
    expect(calls).toEqual([`setItemLocked:${usableId},true,1`]);
    expect(refusals).toBe(0);
    expect(afterActions).toBe(1);
  });

  it('refuses when the clicked copy has left the bags, sending no command', () => {
    const clicked: InvSlot = { itemId: usableId, count: 1 };
    inventory = [clicked, { itemId: usableId, count: 1 }];
    const menu = menuFor(ITEMS[usableId]);
    menu.open(ITEMS[usableId], usableId, target(clicked, 0), 5, 5, () => {});
    inventory.splice(0, 1); // the clicked copy is spent
    activate?.('unlock');
    // Index 0 still holds this id, so the raw forward would have flipped the
    // WRONG copy's lock and said nothing about it.
    expect(inventory[0].itemId).toBe(usableId);
    expect(calls).toEqual([]);
    expect(refusals).toBe(1);
    expect(afterActions).toBe(0);
  });

  it('a caller that names no slot keeps the raw-index behavior', () => {
    inventory = [{ itemId: usableId, count: 1 }];
    const menu = menuFor(ITEMS[usableId]);
    menu.open(ITEMS[usableId], usableId, target(undefined, 0), 5, 5, () => {});
    activate?.('lock');
    expect(calls).toEqual([`setItemLocked:${usableId},true,0`]);
    expect(refusals).toBe(0);
  });

  it('a caller that names no slot and carries the stale -1 refuses', () => {
    inventory = [{ itemId: usableId, count: 1 }];
    const menu = menuFor(ITEMS[usableId]);
    menu.open(ITEMS[usableId], usableId, target(undefined, -1), 5, 5, () => {});
    activate?.('lock');
    expect(calls).toEqual([]);
    expect(refusals).toBe(1);
  });
});
