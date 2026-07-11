// @vitest-environment jsdom
//
// Behavioral guards for the bank window's AAA window-frame + grammar adoption (the
// pure slot/action decisions are unit-tested in bank_view.test.ts, and the
// source-level pins live in bank_window.test.ts). These render the real DOM through
// the shared window-frame builder and assert: the frame chrome is stamped on an
// INNER mount (the #bank-window root stays pristine .window.panel so the 50/50
// docking CSS keeps matching by id), the frame IS the dialog, the slot grid uses the
// .item-cell / data-quality grammar, the filter is a .filter-row / .chip /
// .search-field header, the buy-slots row sits in the sticky .window-footer, the
// deposit-all stays a toolbar action, empty states use .empty-state, and the
// titlebar is a Hud-recognized drag handle (never the close, never on the touch dock).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { BankWindow, type BankWindowDeps } from '../src/ui/bank_window';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';
import type { BankInfo, IWorld } from '../src/world_api';

vi.mock('../src/ui/entity_i18n', () => ({
  itemDisplayName: () => '<img src=x onerror=alert(1)>',
}));
// The bank open() plays a cue; jsdom has no WebAudio, so stub the module.
vi.mock('../src/game/audio', () => ({
  audio: { bagOpen: () => {}, click: () => {}, coin: () => {} },
}));

const REAL_ITEM_ID = 'worn_sword';
const REAL_ITEM_QUALITY = ITEMS[REAL_ITEM_ID]?.quality ?? 'common';

function bankInfo(slots: BankInfo['slots'], overrides: Partial<BankInfo> = {}): BankInfo {
  return {
    slots,
    capacity: 24,
    purchasedSlots: 0,
    bonusSlots: 0,
    nextExpansionCost: 100,
    bonusSources: [],
    ...overrides,
  };
}

function fakeWorld(info: BankInfo | null): IWorld {
  return { bankInfo: info, inventory: [] } as unknown as IWorld;
}

function fakeDeps(world: IWorld, overrides: Partial<BankWindowDeps> = {}): BankWindowDeps {
  const el = document.getElementById('bank-window') as HTMLElement;
  return {
    itemIcon: () => '<img class="item-icon" alt="">',
    moneyHtml: (copper: number) => `<span class="money-inline">${copper}</span>`,
    itemTooltip: () => '<div>tt</div>',
    attachTooltip: () => {},
    root: () => el,
    world: () => world,
    closeOthers: () => {},
    hideTooltip: () => {},
    consumePeek: () => false,
    captureFocus: () => null,
    restoreFocus: () => {},
    onClosed: () => {},
    onInventoryChanged: () => {},
    ...overrides,
  };
}

function bankEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'bank-window';
  el.className = 'window panel';
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.classList.remove('mobile-touch');
  document.body.classList.remove('bank-open');
  document.body.innerHTML = '';
});

describe('BankWindow: frame adoption', () => {
  it('stamps the window-frame chrome on an INNER mount, leaving #bank-window pristine', () => {
    const el = bankEl();
    new BankWindow(fakeDeps(fakeWorld(bankInfo([{ itemId: REAL_ITEM_ID, count: 5 }])))).render();
    expect(el.className).toBe('window panel');
    expect(el.hasAttribute('role')).toBe(false);
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    // The frame IS the dialog (no separate markDialogRoot on the root).
    expect(frame?.getAttribute('role')).toBe('dialog');
    expect(frame?.getAttribute('aria-labelledby')).toBe('bank-window-title');
    expect(frame?.querySelector('.window-titlebar')).not.toBeNull();
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('.window-footer')).not.toBeNull();
    expect(frame?.querySelector('[data-window-close]')).not.toBeNull();
  });

  it('carries the Gilded Strongbox subtitle in the frame title', () => {
    const el = bankEl();
    new BankWindow(fakeDeps(fakeWorld(bankInfo([{ itemId: REAL_ITEM_ID, count: 1 }])))).render();
    expect(el.querySelector('.window-title .panel-subtitle')).not.toBeNull();
  });

  it('frames a bounded flex column: pinned titlebar, scrollable body, sticky footer', () => {
    const el = bankEl();
    new BankWindow(fakeDeps(fakeWorld(bankInfo([{ itemId: REAL_ITEM_ID, count: 1 }])))).render();
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    const order = Array.from(frame?.children ?? []).map((c) => (c as HTMLElement).className);
    expect(order).toEqual(['window-titlebar', 'window-body', 'window-footer']);
  });

  it('bakes no inline geometry, so the body.bank-open 50/50 dock (by id) still wins', () => {
    const el = bankEl();
    document.body.classList.add('bank-open');
    new BankWindow(fakeDeps(fakeWorld(bankInfo([{ itemId: REAL_ITEM_ID, count: 1 }])))).render();
    expect(el.style.left).toBe('');
    expect(el.style.top).toBe('');
    expect(el.style.transform).toBe('');
    expect(el.dataset.windowMoved).toBeUndefined();
  });
});

describe('BankWindow: drag / fit parity with the World Market', () => {
  it('makes the titlebar a drag handle the Hud recognizes, but never the close button', () => {
    const el = bankEl();
    new BankWindow(fakeDeps(fakeWorld(bankInfo([{ itemId: REAL_ITEM_ID, count: 1 }])))).render();
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    const closeBtn = el.querySelector<HTMLElement>('[data-window-close]') as HTMLElement;
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
    expect(isWindowDragHandle(closeBtn, el)).toBe(false);
  });

  it('refuses the titlebar drag on the touch HUD (the 50/50 dock must never drag apart)', () => {
    const el = bankEl();
    new BankWindow(fakeDeps(fakeWorld(bankInfo([{ itemId: REAL_ITEM_ID, count: 1 }])))).render();
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    document.body.classList.add('mobile-touch');
    expect(isWindowDragHandle(titlebar, el)).toBe(false);
    document.body.classList.remove('mobile-touch');
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
  });
});

describe('BankWindow: body grammar + footer', () => {
  it('renders slot cells as .item-cell with the rarity data-quality and a count corner', () => {
    const el = bankEl();
    new BankWindow(fakeDeps(fakeWorld(bankInfo([{ itemId: REAL_ITEM_ID, count: 5 }])))).render();
    const cell = el.querySelector<HTMLElement>('.window-body .bank-grid .item-cell');
    expect(cell).not.toBeNull();
    expect(cell?.getAttribute('data-quality')).toBe(REAL_ITEM_QUALITY);
    expect(cell?.querySelector('.item-cell-count')?.textContent).toContain('5');
  });

  it('renders the filter header as .filter-row / .chip / .search-field', () => {
    const el = bankEl();
    new BankWindow(fakeDeps(fakeWorld(bankInfo([{ itemId: REAL_ITEM_ID, count: 1 }])))).render();
    expect(el.querySelector('.window-body .filter-row')).not.toBeNull();
    expect(el.querySelectorAll('.window-body .filter-row .chip').length).toBeGreaterThan(0);
    expect(el.querySelector('.window-body .search-field input')).not.toBeNull();
  });

  it('puts the buy-slots row in the sticky footer, and keeps deposit-all a toolbar action', () => {
    const el = bankEl();
    new BankWindow(fakeDeps(fakeWorld(bankInfo([{ itemId: REAL_ITEM_ID, count: 1 }])))).render();
    // The bottom transactional action (buy slots) rides the footer.
    expect(el.querySelector('.window-footer .bank-buy-row')).not.toBeNull();
    // Deposit-all is a toolbar bulk action in the body, never the footer.
    expect(el.querySelector('.window-body .bag-filter-bar .bank-deposit-all')).not.toBeNull();
    expect(el.querySelector('.window-footer .bank-deposit-all')).toBeNull();
  });

  it('shows deposit-all over an empty bank (filter chips gated) with an empty-state grid', () => {
    const el = bankEl();
    new BankWindow(fakeDeps(fakeWorld(bankInfo([])))).render();
    expect(el.querySelector('.window-body .empty-state')).not.toBeNull();
    expect(el.querySelector('.window-body .bank-deposit-all')).not.toBeNull();
    // Empty bank drops the chip/search controls.
    expect(el.querySelector('.window-body .filter-row')).toBeNull();
    expect(el.querySelector('.window-body .search-field')).toBeNull();
  });

  it('renders the away empty-state when no banker is in reach (bankInfo null)', () => {
    const el = bankEl();
    new BankWindow(fakeDeps(fakeWorld(null))).render();
    expect(el.querySelector('.window-body .empty-state')).not.toBeNull();
    // No grid or buy row is built in the away state.
    expect(el.querySelector('.bank-grid')).toBeNull();
    expect(el.querySelector('.window-footer .bank-buy-row')).toBeNull();
  });
});

describe('BankWindow: close routing', () => {
  it('routes the frame close through onClose to close() (hide + onClosed teardown)', () => {
    const el = bankEl();
    const onClosed = vi.fn();
    const win = new BankWindow(
      fakeDeps(fakeWorld(bankInfo([{ itemId: REAL_ITEM_ID, count: 1 }])), { onClosed }),
    );
    win.open();
    expect(win.isOpen).toBe(true);
    el.querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(win.isOpen).toBe(false);
    expect(el.style.display).toBe('none');
    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});
