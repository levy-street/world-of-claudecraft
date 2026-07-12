// @vitest-environment jsdom
//
// Behavioral guards for the bags window's AAA window-frame + grammar adoption (the
// pure click/tooltip/grid decisions are unit-tested in bags_view.test.ts, and the
// source-level pins live in bags_window.test.ts). These render the real DOM through
// the shared window-frame builder and assert: the frame chrome is stamped on an
// INNER mount (the #bags root stays pristine .window.panel so the cluster docking
// CSS keeps matching by id), the slot grid uses the .item-cell / data-quality
// grammar, the filter is a .filter-row / .chip / .search-field header, empty states
// use .empty-state, the titlebar is a Hud-recognized drag handle (never the close,
// and never on the touch dock), and item names never inject live markup.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { InvSlot } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';
import type { IWorld } from '../src/world_api';

// A controllable, hostile item name so the no-injection path is testable without the
// tEntity resolver internals (the vendor test precedent).
vi.mock('../src/ui/entity_i18n', () => ({
  itemDisplayName: () => '<img src=x onerror=alert(1)>',
}));

// buildBagBar draws the backpack icon via iconDataUrl (a 2D canvas), which jsdom
// cannot provide; stub it (the bag-bar visual is out of scope for the frame guards).
vi.mock('../src/ui/icons', () => ({
  iconDataUrl: () => 'data:image/png;base64,',
}));

const REAL_ITEM_ID = 'worn_sword';
const REAL_ITEM_QUALITY = ITEMS[REAL_ITEM_ID]?.quality ?? 'common';

function fakeWorld(inventory: InvSlot[], overrides: Partial<IWorld> = {}): IWorld {
  return {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 20,
    copper: 1234,
    ...overrides,
  } as unknown as IWorld;
}

function fakeDeps(world: IWorld, overrides: Partial<BagsWindowDeps> = {}): BagsWindowDeps {
  const el = document.getElementById('bags') as HTMLElement;
  return {
    itemIcon: () => '<img class="item-icon" alt="">',
    moneyHtml: (copper: number) => `<span class="money-inline">${copper}</span>`,
    itemTooltip: () => '<div>tt</div>',
    attachTooltip: () => {},
    root: () => el,
    world: () => world,
    wocBalanceHtml: () => '',
    hideTooltip: () => {},
    consumePeek: () => false,
    cancelPetFeed: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    renderCharIfOpen: () => {},
    vendorOpen: () => false,
    tradeOpen: () => false,
    isMarketSell: () => false,
    isMailAttach: () => false,
    isBankOpen: () => false,
    pendingPetFeed: () => false,
    closeVendor: () => {},
    closeBank: () => {},
    onClosed: () => {},
    addItemToTrade: () => {},
    stageMarketSell: () => {},
    stageMailParcel: () => {},
    insertItemChatLink: () => {},
    showError: () => {},
    setPendingPetFeed: () => {},
    resetPetBarSig: () => {},
    isHotbarItemId: () => false,
    setDragAction: () => {},
    clearActionDropTargets: () => {},
    ...overrides,
  };
}

function bagsEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'bags';
  el.className = 'window panel';
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.classList.remove('mobile-touch');
  document.body.innerHTML = '';
});

describe('BagsWindow: frame adoption', () => {
  it('stamps the window-frame chrome on an INNER mount, leaving #bags pristine', () => {
    const el = bagsEl();
    const world = fakeWorld([]);
    new BagsWindow(fakeDeps(world)).render();
    // The shared root never carries builder state; the frame lives on an inner mount.
    expect(el.className).toBe('window panel');
    expect(el.hasAttribute('role')).toBe(false);
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('role')).toBe('dialog');
    expect(frame?.getAttribute('aria-labelledby')).toBe('bags-title');
    expect(frame?.querySelector('.window-titlebar')).not.toBeNull();
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('[data-window-close]')).not.toBeNull();
    // The money readout lives in the frame's PINNED footer, never the
    // scrollable body: as the body's last child the touch sheet pushed it
    // below the fold and the coin purse was invisible on a phone.
    const footer = frame?.querySelector('.window-footer');
    expect(footer).not.toBeNull();
    expect(footer?.querySelector('.money')).not.toBeNull();
    expect(frame?.querySelector('.window-body .money')).toBeNull();
  });

  it('bakes no inline geometry, so the cluster docking CSS (by #bags id) still wins', () => {
    // The painter must not write left/top/transform on the root: an inline value
    // would beat body.vendor-open / body.bank-open docking (inline > any layered
    // rule) for the rest of the session. Standalone AND vendor-open both stay clean.
    const el = bagsEl();
    new BagsWindow(fakeDeps(fakeWorld([]))).render();
    expect(el.style.left).toBe('');
    expect(el.style.top).toBe('');
    expect(el.style.transform).toBe('');
    expect(el.dataset.windowMoved).toBeUndefined();

    document.body.classList.add('vendor-open');
    new BagsWindow(fakeDeps(fakeWorld([]), { vendorOpen: () => true })).render();
    expect(el.style.left).toBe('');
    expect(el.style.transform).toBe('');
    document.body.classList.remove('vendor-open');
  });

  it('frames a bounded flex column: titlebar, scrollable body, pinned money footer', () => {
    const el = bagsEl();
    new BagsWindow(fakeDeps(fakeWorld([]))).render();
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    const order = Array.from(frame?.children ?? []).map((c) => (c as HTMLElement).className);
    expect(order).toEqual(['window-titlebar', 'window-body', 'window-footer']);
    expect(frame?.querySelectorAll('.window-body').length).toBe(1);
  });

  it('reuses the .bag-grid inside the frame body across a re-render', () => {
    const el = bagsEl();
    const win = new BagsWindow(fakeDeps(fakeWorld([])));
    win.render();
    win.render();
    // The grid is rebuilt each render (cold path), but always exactly one, inside body.
    expect(el.querySelectorAll('.window-body .bag-grid').length).toBe(1);
    expect(el.querySelectorAll('.window-titlebar').length).toBe(1);
  });
});

describe('BagsWindow: drag / fit parity with the World Market', () => {
  it('makes the titlebar a drag handle the Hud recognizes, but never the close button', () => {
    const el = bagsEl();
    new BagsWindow(fakeDeps(fakeWorld([]))).render();
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    const title = el.querySelector<HTMLElement>('.window-title') as HTMLElement;
    const closeBtn = el.querySelector<HTMLElement>('[data-window-close]') as HTMLElement;
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
    expect(isWindowDragHandle(title, el)).toBe(true);
    expect(isWindowDragHandle(closeBtn, el)).toBe(false);
  });

  it('refuses the titlebar drag on the touch HUD (the docked cluster must never drag apart)', () => {
    const el = bagsEl();
    new BagsWindow(fakeDeps(fakeWorld([]))).render();
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    document.body.classList.add('mobile-touch');
    expect(isWindowDragHandle(titlebar, el)).toBe(false);
    document.body.classList.remove('mobile-touch');
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
  });
});

describe('BagsWindow: body grammar', () => {
  it('renders slot cells as .item-cell with the rarity data-quality and a count corner', () => {
    const el = bagsEl();
    const world = fakeWorld([{ itemId: REAL_ITEM_ID, count: 3 }]);
    new BagsWindow(fakeDeps(world)).render();
    const cell = el.querySelector<HTMLElement>('.window-body .bag-grid .item-cell');
    expect(cell).not.toBeNull();
    expect(cell?.getAttribute('data-quality')).toBe(REAL_ITEM_QUALITY);
    expect(cell?.querySelector('.item-cell-count')?.textContent).toContain('3');
  });

  it('renders the filter header as .filter-row / .chip / .search-field', () => {
    const el = bagsEl();
    const world = fakeWorld([{ itemId: REAL_ITEM_ID, count: 1 }]);
    new BagsWindow(fakeDeps(world)).render();
    expect(el.querySelector('.window-body .filter-row')).not.toBeNull();
    expect(el.querySelectorAll('.window-body .filter-row .chip').length).toBeGreaterThan(0);
    expect(el.querySelector('.window-body .search-field input')).not.toBeNull();
  });

  it('renders the empty-state grammar for an empty bag', () => {
    const el = bagsEl();
    new BagsWindow(fakeDeps(fakeWorld([], { bagCapacity: 0 }))).render();
    expect(el.querySelector('.window-body .empty-state')).not.toBeNull();
  });

  it('never injects a live item name (the name reaches only the escaped aria-label)', () => {
    const el = bagsEl();
    const world = fakeWorld([{ itemId: REAL_ITEM_ID, count: 1 }]);
    new BagsWindow(fakeDeps(world)).render();
    const cell = el.querySelector<HTMLElement>('.bag-grid .item-cell');
    // The hostile name only lands in the aria-label (setAttribute is inherently
    // escaped); no onerror <img> is parsed into the DOM from it.
    expect(cell?.getAttribute('aria-label')).toContain('<img src=x onerror=alert(1)>');
    expect(el.querySelector('img[onerror]')).toBeNull();
  });
});

describe('BagsWindow: close routing', () => {
  it('routes the frame close through onClose to the injected close teardown', () => {
    const el = bagsEl();
    el.style.display = 'flex';
    const onClosed = vi.fn();
    new BagsWindow(fakeDeps(fakeWorld([]), { onClosed })).render();
    el.querySelector<HTMLElement>('[data-window-close]')?.click();
    // close() hides the window and fires the onClosed teardown hook.
    expect(el.style.display).toBe('none');
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('on touch with the bank docked, the close closes the whole cluster (not just bags)', () => {
    const el = bagsEl();
    el.style.display = 'flex';
    document.body.classList.add('mobile-touch');
    const closeBank = vi.fn();
    new BagsWindow(fakeDeps(fakeWorld([]), { isBankOpen: () => true, closeBank })).render();
    el.querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(closeBank).toHaveBeenCalledTimes(1);
    // The cluster close is delegated: bags itself is not independently hidden here.
    expect(el.style.display).toBe('flex');
  });
});
