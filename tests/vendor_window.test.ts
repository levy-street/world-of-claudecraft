// @vitest-environment jsdom
//
// Behavioral guards for the vendor window painter (the pure sellable/buyback
// decisions are unit-tested in vendor_view.test.ts). These render the real DOM
// through the shared window-frame builder and assert: the frame chrome is stamped
// with the Browse / Sell / Buyback tab rail, the body uses the .list-rows /
// .item-cell grammar per active tab, interpolated item names pass through esc(),
// empty states render, buy/sell/sell-junk/buyback route through the injected deps,
// tab activation fires onTabChange, and the close control routes to onClose.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ItemDef } from '../src/sim/types';
import type { VendorSellRow, VendorView } from '../src/ui/vendor_view';
import { renderVendorWindow, type VendorTab, type VendorWindowDeps } from '../src/ui/vendor_window';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';

// Force a controllable item name so the esc() path is testable without depending
// on the tEntity resolver internals.
vi.mock('../src/ui/entity_i18n', () => ({
  itemDisplayName: () => '<img src=x onerror=alert(1)>',
}));

function item(id: string, quality: ItemDef['quality'] = 'common'): ItemDef {
  return {
    id,
    name: id,
    quality,
    kind: 'junk',
    slot: 'trinket',
    sellValue: 3,
    buyValue: 5,
  } as unknown as ItemDef;
}

function fakeDeps(overrides: Partial<VendorWindowDeps> = {}): VendorWindowDeps {
  return {
    itemIcon: () => '<img class="item-icon" alt="">',
    moneyHtml: (copper: number) => `<span class="money-inline">${copper}</span>`,
    itemTooltip: () => '<div>tt</div>',
    attachTooltip: () => {},
    hideTooltip: () => {},
    onBuy: () => {},
    onBuyBack: () => {},
    onSellItem: () => {},
    confirmDialog: () => {},
    onSellJunk: () => {},
    onTabChange: () => {},
    onClose: () => {},
    sellJunk: { enabled: false, proceeds: 0 },
    ...overrides,
  };
}

const emptyView: VendorView = { goods: [], buyback: [] };

function render(
  el: HTMLElement,
  name: string,
  view: VendorView,
  deps: VendorWindowDeps,
  opts: { sellRows?: VendorSellRow[]; tab?: VendorTab } = {},
): void {
  renderVendorWindow(el, name, view, opts.sellRows ?? [], opts.tab ?? 'browse', deps);
}

function vendorEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'vendor-window';
  el.className = 'window panel';
  document.body.classList.add('vendor-open');
  return el;
}

// The touch-HUD test toggles body.mobile-touch; clear it so it never leaks into a
// later desktop-path assertion (the shared jsdom document.body persists).
afterEach(() => {
  document.body.classList.remove('mobile-touch');
});

describe('renderVendorWindow: frame adoption', () => {
  it('stamps the window-frame chrome on an INNER mount with titlebar, tab rail, body, close', () => {
    const el = vendorEl();
    render(el, 'Gorznak', emptyView, fakeDeps());
    // The shared root never carries builder state (the Heroic Quartermaster is
    // a second tenant of #vendor-window); the frame lives on an inner mount.
    expect(el.classList.contains('window-frame')).toBe(false);
    expect(el.hasAttribute('role')).toBe(false);
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('role')).toBe('dialog');
    expect(frame?.getAttribute('aria-labelledby')).toBe('vendor-window-title');
    expect(frame?.querySelector('.window-titlebar')).not.toBeNull();
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('[data-window-close]')).not.toBeNull();
    // The three vendor tabs: Browse (buy) / Sell / Buyback.
    const tabs = frame?.querySelectorAll<HTMLElement>('.tab-rail [data-window-tab]');
    expect(Array.from(tabs ?? []).map((tsb) => tsb.dataset.windowTab)).toEqual([
      'browse',
      'sell',
      'buyback',
    ]);
    // No footer: the bulk sell-junk action lives inside the Sell tab body.
    expect(frame?.querySelector('.window-footer')).toBeNull();
    // Browse is the default active tab.
    expect(frame?.querySelector('[data-window-tab="browse"]')?.getAttribute('aria-selected')).toBe(
      'true',
    );
    // The painter leaves the display to the stylesheet: no inline value.
    expect(el.style.display).toBe('');
  });

  it('sets the title to the merchant name (the frame builder cannot interpolate it)', () => {
    const el = vendorEl();
    render(el, 'Gorznak', emptyView, fakeDeps());
    expect(el.querySelector('.window-title')?.textContent).toContain('Gorznak');
  });

  it('reuses the frame on a second render instead of rebuilding it cold', () => {
    const el = vendorEl();
    render(el, 'V', emptyView, fakeDeps());
    const firstBody = el.querySelector('.window-body');
    render(el, 'V', emptyView, fakeDeps());
    expect(el.querySelector('.window-body')).toBe(firstBody);
    expect(el.querySelectorAll('.window-titlebar').length).toBe(1);
    expect(el.querySelectorAll('.tab-rail').length).toBe(1);
  });
});

describe('renderVendorWindow: move / resize / fit parity with the World Market', () => {
  it('makes the frame titlebar a drag handle the Hud recognizes, but never the close button', () => {
    const el = vendorEl();
    render(el, 'Gorznak', emptyView, fakeDeps());
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar');
    const title = el.querySelector<HTMLElement>('.window-title');
    const closeBtn = el.querySelector<HTMLElement>('[data-window-close]');
    expect(titlebar).not.toBeNull();
    expect(isWindowDragHandle(titlebar as HTMLElement, el)).toBe(true);
    expect(isWindowDragHandle(title as HTMLElement, el)).toBe(true);
    expect(isWindowDragHandle(closeBtn as HTMLElement, el)).toBe(false);
  });

  it('frames a bounded flex column: pinned titlebar, then the tab rail, then a scrollable body', () => {
    const el = vendorEl();
    render(el, 'V', emptyView, fakeDeps());
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    const order = Array.from(frame?.children ?? []).map((c) => (c as HTMLElement).className);
    expect(order).toEqual(['window-titlebar', 'tab-rail', 'window-body']);
    expect(frame?.querySelectorAll('.window-body').length).toBe(1);
  });

  it('never bakes an inline display, so the stylesheet tracks body.mobile-touch flips live', () => {
    const desktop = vendorEl();
    // Simulate a reopen: closeVendor left inline display:none behind.
    desktop.style.display = 'none';
    render(desktop, 'V', emptyView, fakeDeps());
    expect(desktop.style.display).toBe('');
    document.body.classList.add('mobile-touch');
    const mobile = vendorEl();
    mobile.style.display = 'none';
    render(mobile, 'V', emptyView, fakeDeps());
    expect(mobile.style.display).toBe('');
    document.body.classList.remove('mobile-touch');
    expect(mobile.style.display).toBe('');
    expect(desktop.style.display).toBe('');
  });

  it('refuses the titlebar drag on the touch HUD (the dock must never be dragged apart)', () => {
    const el = vendorEl();
    render(el, 'V', emptyView, fakeDeps());
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    document.body.classList.add('mobile-touch');
    expect(isWindowDragHandle(titlebar, el)).toBe(false);
    document.body.classList.remove('mobile-touch');
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
  });
});

describe('renderVendorWindow: shared-root handoff to the heroic vendor', () => {
  // The Heroic Quartermaster paints the same #vendor-window root with a plain
  // innerHTML replacement (renderHeroicVendorWindow's contract); model that.
  function heroicPaint(root: HTMLElement): void {
    root.innerHTML =
      '<div class="panel-title"><span>Quartermaster</span></div>' +
      '<button type="button" class="vendor-item">offer</button>';
    root.style.display = 'block';
  }

  it('leaves the root pristine after open + close, so a heroic open renders as fresh', () => {
    const el = vendorEl();
    const pristineAttrs = el.getAttributeNames().sort();
    const view: VendorView = {
      goods: [{ itemId: 'blade', item: item('blade'), price: 5, quantity: 1 }],
      buyback: [],
    };
    render(el, 'V', view, fakeDeps());

    expect(el.className).toBe('window panel');
    expect(el.getAttributeNames().sort()).toEqual(pristineAttrs);

    el.style.display = 'none';
    expect(el.className).toBe('window panel');
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('aria-labelledby')).toBe(false);
    expect(el.hasAttribute('aria-modal')).toBe(false);

    heroicPaint(el);
    const fresh = document.createElement('div');
    fresh.id = 'vendor-window';
    fresh.className = 'window panel';
    heroicPaint(fresh);
    expect(el.outerHTML).toBe(fresh.outerHTML);
    expect(el.querySelector('.window-frame')).toBeNull();
  });

  it('rebuilds the frame cold after heroic content replaced the mount', () => {
    const el = vendorEl();
    render(el, 'V', emptyView, fakeDeps());
    heroicPaint(el);
    render(el, 'V', emptyView, fakeDeps());
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('.tab-rail')).not.toBeNull();
    expect(el.children.length).toBe(1);
    expect(el.querySelector('.panel-title')).toBeNull();
  });
});

describe('renderVendorWindow: Browse tab', () => {
  it('renders goods as .list-rows / .item-cell with a rarity border and the money price', () => {
    const el = vendorEl();
    const moneyHtml = vi.fn((copper: number) => `<span class="money-inline">${copper}</span>`);
    const view: VendorView = {
      goods: [{ itemId: 'blade', item: item('blade', 'rare'), price: 25, quantity: 5 }],
      buyback: [],
    };
    render(el, 'V', view, fakeDeps({ moneyHtml }), { tab: 'browse' });
    expect(el.querySelector('.window-body .list-rows')).not.toBeNull();
    const cell = el.querySelector<HTMLElement>('.item-cell');
    expect(cell?.getAttribute('data-quality')).toBe('rare');
    expect(cell?.querySelector('.item-cell-count')?.textContent).toBe('5');
    expect(moneyHtml).toHaveBeenCalledWith(25);
    expect(el.querySelector('.vendor-row')?.getAttribute('aria-label')).toContain('Buy');
  });

  it('renders the empty-state for empty stock', () => {
    const el = vendorEl();
    render(el, 'V', emptyView, fakeDeps(), { tab: 'browse' });
    expect(el.querySelector('.window-body .empty-state')).not.toBeNull();
  });

  it('escapes interpolated item names through esc() (no live injection)', () => {
    const el = vendorEl();
    const view: VendorView = {
      goods: [{ itemId: 'evil', item: item('evil'), price: 5, quantity: 1 }],
      buyback: [],
    };
    render(el, 'V', view, fakeDeps(), { tab: 'browse' });
    const name = el.querySelector('.vendor-row-name');
    expect(name?.querySelector('img')).toBeNull();
    expect(name?.innerHTML).toContain('&lt;img');
  });

  it('fires onBuy through the injected deps', () => {
    const el = vendorEl();
    const onBuy = vi.fn();
    const view: VendorView = {
      goods: [{ itemId: 'blade', item: item('blade'), price: 5, quantity: 1 }],
      buyback: [],
    };
    render(el, 'V', view, fakeDeps({ onBuy }), { tab: 'browse' });
    el.querySelector<HTMLButtonElement>('.vendor-row')?.click();
    expect(onBuy).toHaveBeenCalledWith('blade');
  });
});

describe('renderVendorWindow: Sell tab', () => {
  // Plain fungible stack (no instance): sells immediately, never behind a confirm.
  const sellRows: VendorSellRow[] = [
    { itemId: 'cloth', item: item('cloth'), count: 5, unitPrice: 3, total: 15, instanced: false },
  ];
  // Rolled/instance-bearing stack: gated behind a confirm before it can sell.
  const instancedRows: VendorSellRow[] = [
    {
      itemId: 'sword',
      item: item('sword'),
      count: 2,
      unitPrice: 500,
      total: 1000,
      instanced: true,
    },
  ];

  it('renders the bulk sell-junk primary action then the sellable rows', () => {
    const el = vendorEl();
    render(el, 'V', emptyView, fakeDeps({ sellJunk: { enabled: true, proceeds: 12 } }), {
      tab: 'sell',
      sellRows,
    });
    const junkBtn = el.querySelector<HTMLButtonElement>('.window-body .btn.is-primary.vendor-sell');
    expect(junkBtn).not.toBeNull();
    expect(junkBtn?.disabled).toBe(false);
    const row = el.querySelector<HTMLButtonElement>('.list-rows .vendor-row');
    expect(row).not.toBeNull();
    expect(el.querySelector('.item-cell-count')?.textContent).toBe('5');
    expect(row?.getAttribute('aria-label')).toContain('Sell');
  });

  it('sells a plain fungible stack immediately through onSellItem, with NO confirm', () => {
    const el = vendorEl();
    const onSellItem = vi.fn();
    const confirmDialog = vi.fn();
    render(el, 'V', emptyView, fakeDeps({ onSellItem, confirmDialog }), { tab: 'sell', sellRows });
    el.querySelector<HTMLButtonElement>('.list-rows .vendor-row')?.click();
    // Byte-identical dispatch (itemId + count), and no friction on normal selling.
    expect(onSellItem).toHaveBeenCalledWith('cloth', 5);
    expect(confirmDialog).not.toHaveBeenCalled();
  });

  it('gates an instance-bearing (rolled) row behind a confirm before selling', () => {
    const el = vendorEl();
    const onSellItem = vi.fn();
    const confirmDialog = vi.fn();
    render(el, 'V', emptyView, fakeDeps({ onSellItem, confirmDialog }), {
      tab: 'sell',
      sellRows: instancedRows,
    });
    el.querySelector<HTMLButtonElement>('.list-rows .vendor-row')?.click();
    // The click routes through the confirm, NOT straight to the sale.
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(onSellItem).not.toHaveBeenCalled();
    // The confirm body warns about the unrecoverable rolled stats.
    const [, body] = confirmDialog.mock.calls[0];
    expect(body).toContain('buyback');
    // Accepting the confirm (its onOk, the 5th arg) sells the whole rolled stack.
    const onOk = confirmDialog.mock.calls[0][4] as () => void;
    onOk();
    expect(onSellItem).toHaveBeenCalledWith('sword', 2);
  });

  it('fires onSellJunk from the bulk action', () => {
    const el = vendorEl();
    const onSellJunk = vi.fn();
    render(el, 'V', emptyView, fakeDeps({ onSellJunk, sellJunk: { enabled: true, proceeds: 9 } }), {
      tab: 'sell',
      sellRows,
    });
    el.querySelector<HTMLButtonElement>('.vendor-sell')?.click();
    expect(onSellJunk).toHaveBeenCalledTimes(1);
  });

  it('renders only the empty-state when nothing is sellable (no dead sell-junk row)', () => {
    const el = vendorEl();
    render(el, 'V', emptyView, fakeDeps(), { tab: 'sell', sellRows: [] });
    expect(el.querySelector('.window-body .empty-state')).not.toBeNull();
    expect(el.querySelector('.vendor-sell')).toBeNull();
  });

  it('escapes interpolated sell item names through esc() (no live injection)', () => {
    const el = vendorEl();
    render(el, 'V', emptyView, fakeDeps(), { tab: 'sell', sellRows });
    const name = el.querySelector('.list-rows .vendor-row-name');
    expect(name?.querySelector('img')).toBeNull();
    expect(name?.innerHTML).toContain('&lt;img');
  });
});

describe('renderVendorWindow: Buyback tab', () => {
  it('renders the buyback rows and fires onBuyBack', () => {
    const el = vendorEl();
    const onBuyBack = vi.fn();
    const view: VendorView = {
      goods: [],
      buyback: [{ itemId: 'ring', item: item('ring'), count: 1, price: 3 }],
    };
    render(el, 'V', view, fakeDeps({ onBuyBack }), { tab: 'buyback' });
    const row = el.querySelector<HTMLButtonElement>('.list-rows .vendor-row');
    expect(row?.getAttribute('aria-label')).toContain('Buy back');
    row?.click();
    expect(onBuyBack).toHaveBeenCalledWith('ring');
  });

  it('renders the empty-state when no buyback slots remain', () => {
    const el = vendorEl();
    render(el, 'V', emptyView, fakeDeps(), { tab: 'buyback' });
    expect(el.querySelector('.window-body .empty-state')).not.toBeNull();
  });
});

describe('renderVendorWindow: tabs + close', () => {
  it('reflects the active tab in aria-selected + roving tabindex', () => {
    const el = vendorEl();
    render(el, 'V', emptyView, fakeDeps(), { tab: 'sell' });
    const sell = el.querySelector<HTMLElement>('[data-window-tab="sell"]');
    const browse = el.querySelector<HTMLElement>('[data-window-tab="browse"]');
    expect(sell?.getAttribute('aria-selected')).toBe('true');
    expect(sell?.tabIndex).toBe(0);
    expect(browse?.getAttribute('aria-selected')).toBe('false');
    expect(browse?.tabIndex).toBe(-1);
    // The body is the ACTIVE tab's panel, so the selected tab's aria-controls
    // always names a live node.
    expect(el.querySelector('.window-body')?.id).toBe(sell?.getAttribute('aria-controls'));
  });

  it('a Hud-driven tab switch against the REUSED frame re-points aria-controls + labelling', () => {
    const el = vendorEl();
    render(el, 'V', emptyView, fakeDeps(), { tab: 'browse' });
    // Hud repaint with a different active tab (the onTabChange round trip).
    render(el, 'V', emptyView, fakeDeps(), { tab: 'buyback' });
    const buyback = el.querySelector<HTMLElement>('[data-window-tab="buyback"]');
    const browse = el.querySelector<HTMLElement>('[data-window-tab="browse"]');
    const body = el.querySelector<HTMLElement>('.window-body');
    expect(buyback?.getAttribute('aria-controls')).toBe('vendor-window-panel-buyback');
    // Only the selected tab controls the body: an unselected tab's derived
    // panel id has no node, so keeping aria-controls there is a dangling idref.
    expect(browse?.hasAttribute('aria-controls')).toBe(false);
    expect(body?.id).toBe('vendor-window-panel-buyback');
    expect(body?.getAttribute('aria-labelledby')).toBe('vendor-window-tab-buyback');
  });

  it('restores the BODY scroll across a repaint (the desktop flex model scrolls the body)', () => {
    const el = vendorEl();
    const view: VendorView = {
      goods: [{ itemId: 'blade', item: item('blade'), price: 5, quantity: 1 }],
      buyback: [],
    };
    render(el, 'V', view, fakeDeps(), { tab: 'browse' });
    const body = el.querySelector<HTMLElement>('.window-body') as HTMLElement;
    // The desktop flex model scrolls .window-body, never the root: a buy repaint
    // must restore the list position or every purchase snaps the goods to top.
    body.scrollTop = 120;
    el.scrollTop = 0;
    render(el, 'V', view, fakeDeps(), { tab: 'browse' });
    expect(el.querySelector<HTMLElement>('.window-body')?.scrollTop).toBe(120);
  });

  it('fires onTabChange with the activated tab id', () => {
    const el = vendorEl();
    const onTabChange = vi.fn();
    render(el, 'V', emptyView, fakeDeps({ onTabChange }));
    el.querySelector<HTMLButtonElement>('[data-window-tab="sell"]')?.click();
    expect(onTabChange).toHaveBeenCalledWith('sell');
  });

  it('routes the close control to the injected onClose dep', () => {
    const el = vendorEl();
    const onClose = vi.fn();
    render(el, 'V', emptyView, fakeDeps({ onClose }));
    el.querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
