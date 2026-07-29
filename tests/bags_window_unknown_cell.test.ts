// @vitest-environment happy-dom
// The unknown (def-less) bag cell's click machinery, driven behaviorally
// against the REAL BagsWindow (the bags_window_use_routing.test.ts fixture
// idiom). The source pins in bags_window.test.ts anchor the onDrop ordering
// textually; these arms pin what a listener sweep cannot see: the deposit
// click fires, a stale suppression flag swallows exactly one tap, and a
// fresh press CLEARS a stale flag before its click (the known cell's
// pointerdown contract, mirrored here because this cell both sets the flag
// and can be its victim).
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { InvSlot } from '../src/sim/types';
import { bagItemAction, bagUnknownAction } from '../src/ui/bags_view';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import type { IWorld } from '../src/world_api';

const UNKNOWN_ID = 'future_expansion_item_x';
if (Object.hasOwn(ITEMS, UNKNOWN_ID)) throw new Error('fixture id exists in content');

function harness(inventory: InvSlot[]): {
  root: HTMLElement;
  window: BagsWindow;
  deposits: number[];
} {
  const deposits: number[] = [];
  const world = {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
    bankDeposit: (index: number) => {
      deposits.push(index);
    },
    bankInfo: { slots: [], capacity: 8 },
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
    isPersonalBankTab: () => true,
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
  const window = new BagsWindow(deps);
  window.render();
  return { root, window, deposits };
}

function unknownCell(root: HTMLElement): HTMLElement {
  const cell = root.querySelector('button.bag-item') as HTMLElement | null;
  expect(cell).not.toBeNull();
  if (!cell) throw new Error('no cell');
  return cell;
}

describe('the unknown bag cell deposit click, behaviorally', () => {
  it('a plain click with the bank open deposits the clicked slot by index', () => {
    const { root, deposits } = harness([{ itemId: UNKNOWN_ID, count: 3 }]);
    unknownCell(root).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(deposits).toEqual([0]);
  });

  it('a stale suppression flag swallows exactly one tap, and pointerdown clears it first', () => {
    const { root, window, deposits } = harness([{ itemId: UNKNOWN_ID, count: 3 }]);
    const flagged = window as unknown as { suppressNextClick: boolean };
    // The latch scenario: a touch drag set the flag but its synthetic click
    // never reached this row (release over another element, or the drop's
    // re-render destroyed the source row). Without the pointerdown reset the
    // next REAL tap is eaten; with it, the press clears the flag before its
    // own click and the deposit lands.
    flagged.suppressNextClick = true;
    const cell = unknownCell(root);
    cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(deposits).toEqual([0]);
    // And the flag still does its one real job: swallowing the synthetic
    // click that trails a drag, without pointerdown in between.
    flagged.suppressNextClick = true;
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(deposits).toEqual([0]);
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(deposits).toEqual([0, 0]);
  });

  it('a touch-sourced contextmenu is claimed for the peek (no native menu over the HUD)', () => {
    const { root } = harness([{ itemId: UNKNOWN_ID, count: 1 }]);
    const cell = unknownCell(root);
    const touch = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    Object.defineProperty(touch, 'pointerType', { value: 'touch' });
    cell.dispatchEvent(touch);
    expect(touch.defaultPrevented).toBe(true);
    const mouse = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    Object.defineProperty(mouse, 'pointerType', { value: 'mouse' });
    cell.dispatchEvent(mouse);
    expect(mouse.defaultPrevented).toBe(false);
  });
});

describe('the pristine grid branch, behaviorally', () => {
  it('renders a prototype-key slot as unknown (never a Function deref)', () => {
    // The one shape that distinguishes knownItemDef from a bare ITEMS read:
    // 'constructor' resolves truthy on a bare read and the known cell would
    // deref the Object function. The unknown arm's aria sentence is the
    // observable difference.
    const { root } = harness([{ itemId: 'constructor', count: 1 }]);
    const cell = unknownCell(root);
    expect(cell.getAttribute('aria-label') ?? '').toContain('Unknown item');
    expect(cell.getAttribute('aria-label') ?? '').toContain('constructor');
    expect(root.innerHTML).not.toContain('Object');
  });
});

describe('bagUnknownAction mirrors the bagItemAction ladder', () => {
  const MODES = {
    none: {
      tradeOpen: false,
      mailAttach: false,
      marketSell: false,
      vendorOpen: false,
      bankOpen: false,
      bankDeposit: false,
      guildBankDeposit: false,
      petFeed: false,
    },
  };

  it('deposits only with the bank open and no higher mode active', () => {
    expect(bagUnknownAction({ ...MODES.none, bankDeposit: true })).toBe('bankDeposit');
    expect(bagUnknownAction(MODES.none)).toBe('none');
  });

  it('an open bank with no deposit target offers nothing (the log view)', () => {
    // The unknown cell needs no no-target rung of its own: it has no use/equip
    // ladder below to fall into, so 'none' is already right. Pinned so the
    // asymmetry with bagItemAction (which DID need an explicit rung) is a
    // stated decision rather than an oversight nobody rechecks.
    expect(bagUnknownAction({ ...MODES.none, bankOpen: true })).toBe('none');
    // And the superset flag never suppresses an ARMED personal deposit.
    expect(bagUnknownAction({ ...MODES.none, bankOpen: true, bankDeposit: true })).toBe(
      'bankDeposit',
    );
  });

  it('offers NOTHING on the guild tab: an unknown copy could strand dormant', () => {
    // Fail closed, and pinned as its own rule rather than as a side effect of
    // the two bank modes being exclusive. A stale client cannot evaluate the
    // guild pipe's four refusal dimensions, and a refused copy sits dormant in
    // a shared book that no player action can clear.
    expect(bagUnknownAction({ ...MODES.none, guildBankDeposit: true })).toBe('none');
    // Even if a future mode build set both, the guild tab still wins as none.
    expect(bagUnknownAction({ ...MODES.none, guildBankDeposit: true, bankDeposit: true })).toBe(
      'none',
    );
  });

  it('every def-needing mode above the deposit in bagItemAction wins here as none', () => {
    // Derived from the ladder itself: any mode that outranks bankDeposit for
    // a KNOWN plain item must suppress the unknown cell's deposit, so a
    // ladder reorder or a new higher mode cannot silently diverge the two.
    const higher: (keyof typeof MODES.none)[] = [
      'tradeOpen',
      'mailAttach',
      'marketSell',
      'vendorOpen',
    ];
    const plainItem = { id: 'x', name: 'X', kind: 'junk' } as Parameters<typeof bagItemAction>[0];
    for (const mode of higher) {
      const withMode = { ...MODES.none, bankDeposit: true, [mode]: true };
      expect(bagItemAction(plainItem, withMode), mode).not.toBe('bankDeposit');
      expect(bagUnknownAction(withMode), mode).toBe('none');
    }
    // petFeed sits BELOW the deposit in the ladder, so it must NOT suppress.
    expect(bagUnknownAction({ ...MODES.none, bankDeposit: true, petFeed: true })).toBe(
      'bankDeposit',
    );
  });
});
