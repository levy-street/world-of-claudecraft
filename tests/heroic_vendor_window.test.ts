// @vitest-environment jsdom
//
// Behavioral guards for the Heroic Quartermaster window painter after its shared
// window-frame builder migration (the deferred vendor-pilot follow-up). These
// render the real DOM and assert: the frame is stamped on a `.heroic-shop`
// wrapper (NOT a copper-style direct-child frame), the shared #vendor-window root
// stays pristine, the body uses the AAA .vendor-row / .item-cell grammar (the
// legacy .vendor-item markup is retired here), the titlebar is a drag handle but
// the close is not, buy/close route through the injected deps, and, load-bearing,
// the two-tenant handoff cold-rebuilds each side's frame so they never share one.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ItemDef } from '../src/sim/types';
import type { HeroicShopView } from '../src/ui/heroic_vendor_view';
import {
  type HeroicVendorWindowDeps,
  renderHeroicVendorWindow,
} from '../src/ui/heroic_vendor_window';
import { renderVendorWindow, type VendorWindowDeps } from '../src/ui/vendor_window';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';

// Force a controllable item name so the esc() path is testable without depending
// on the tEntity resolver internals (shared by both painters below).
vi.mock('../src/ui/entity_i18n', () => ({
  itemDisplayName: () => '<img src=x onerror=alert(1)>',
}));

function item(id: string, quality: ItemDef['quality'] = 'epic'): ItemDef {
  return {
    id,
    name: id,
    quality,
    kind: 'trinket',
    slot: 'ring',
    sellValue: 3,
    buyValue: 5,
  } as unknown as ItemDef;
}

function heroicView(): HeroicShopView {
  return {
    balance: 12,
    rows: [
      { itemId: 'ring1', item: item('ring1', 'epic'), marks: 12, affordable: true },
      { itemId: 'neck1', item: item('neck1', 'epic'), marks: 16, affordable: false },
    ],
  };
}

function fakeHeroicDeps(overrides: Partial<HeroicVendorWindowDeps> = {}): HeroicVendorWindowDeps {
  return {
    itemIcon: () => '<img class="item-icon" alt="">',
    moneyHtml: (copper: number) => `<span class="money-inline">${copper}</span>`,
    itemTooltip: () => '<div>tt</div>',
    attachTooltip: () => {},
    hideTooltip: () => {},
    onBuy: () => {},
    onClose: () => {},
    ...overrides,
  };
}

function fakeVendorDeps(overrides: Partial<VendorWindowDeps> = {}): VendorWindowDeps {
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

// The copper vendor is a tabbed window; the heroic tenant is tab-less. Painting
// the copper vendor needs its full signature (view + sellRows + activeTab + deps).
function renderCopper(el: HTMLElement, name: string, deps: VendorWindowDeps): void {
  renderVendorWindow(el, name, { goods: [], buyback: [] }, [], 'browse', deps);
}

function vendorEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'vendor-window';
  el.className = 'window panel';
  return el;
}

afterEach(() => {
  document.body.classList.remove('vendor-open', 'mobile-touch');
});

describe('renderHeroicVendorWindow: frame adoption on a wrapper mount', () => {
  it('stamps the frame inside a .heroic-shop wrapper, never a copper direct-child frame', () => {
    const el = vendorEl();
    renderHeroicVendorWindow(el, 'Quartermaster', heroicView(), fakeHeroicDeps());
    // The frame nests one level deeper than the copper vendor's direct-child mount
    // so copper's `:scope > .window-frame` reuse rule cannot ever match it.
    expect(el.querySelector(':scope > .window-frame')).toBeNull();
    const wrapper = el.querySelector<HTMLElement>(':scope > .heroic-shop');
    expect(wrapper).not.toBeNull();
    const frame = wrapper?.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('role')).toBe('dialog');
    expect(frame?.querySelector('.window-titlebar')).not.toBeNull();
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('[data-window-close]')).not.toBeNull();
  });

  it('leaves the shared #vendor-window root pristine (no builder class/role/aria)', () => {
    const el = vendorEl();
    renderHeroicVendorWindow(el, 'Q', heroicView(), fakeHeroicDeps());
    expect(el.className).toBe('window panel');
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('aria-labelledby')).toBe(false);
    expect(el.hasAttribute('aria-modal')).toBe(false);
  });

  it('sets the title to the merchant name (the builder cannot interpolate it)', () => {
    const el = vendorEl();
    renderHeroicVendorWindow(el, 'Yusuf', heroicView(), fakeHeroicDeps());
    expect(el.querySelector('.window-title')?.textContent).toContain('Yusuf');
  });

  it('reuses the heroic frame on a second render instead of rebuilding cold', () => {
    const el = vendorEl();
    renderHeroicVendorWindow(el, 'Q', heroicView(), fakeHeroicDeps());
    const firstBody = el.querySelector('.window-body');
    renderHeroicVendorWindow(el, 'Q', heroicView(), fakeHeroicDeps());
    expect(el.querySelector('.window-body')).toBe(firstBody);
    expect(el.querySelectorAll('.window-titlebar').length).toBe(1);
    expect(el.querySelectorAll('.heroic-shop').length).toBe(1);
  });
});

describe('renderHeroicVendorWindow: body grammar + callbacks', () => {
  it('renders offers as .vendor-row / .item-cell (the legacy .vendor-item is retired here)', () => {
    const el = vendorEl();
    renderHeroicVendorWindow(el, 'Q', heroicView(), fakeHeroicDeps());
    expect(el.querySelector('.window-body .list-rows')).not.toBeNull();
    const rows = el.querySelectorAll<HTMLButtonElement>('.vendor-row');
    expect(rows.length).toBe(2);
    expect(el.querySelector('.item-cell')?.getAttribute('data-quality')).toBe('epic');
    expect(el.querySelector('.vendor-item'), 'legacy .vendor-item retired').toBeNull();
  });

  it('disables the unaffordable offer and marks its price', () => {
    const el = vendorEl();
    renderHeroicVendorWindow(el, 'Q', heroicView(), fakeHeroicDeps());
    const rows = el.querySelectorAll<HTMLButtonElement>('.vendor-row');
    expect(rows[0].disabled).toBe(false); // affordable
    expect(rows[1].disabled).toBe(true); // unaffordable
    expect(el.querySelector('.vendor-row-price.unaffordable')).not.toBeNull();
  });

  it('escapes the interpolated item name through esc() (no live injection)', () => {
    const el = vendorEl();
    renderHeroicVendorWindow(el, 'Q', heroicView(), fakeHeroicDeps());
    const name = el.querySelector('.vendor-row-name');
    expect(name?.querySelector('img')).toBeNull();
    expect(name?.innerHTML).toContain('&lt;img');
  });

  it('routes buy + close through the injected deps', () => {
    const el = vendorEl();
    const onBuy = vi.fn();
    const onClose = vi.fn();
    renderHeroicVendorWindow(el, 'Q', heroicView(), fakeHeroicDeps({ onBuy, onClose }));
    el.querySelectorAll<HTMLButtonElement>('.vendor-row')[0].click();
    el.querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(onBuy).toHaveBeenCalledWith('ring1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('renderHeroicVendorWindow: move / drag parity', () => {
  it('makes the frame titlebar a drag handle the Hud recognizes, but never the close', () => {
    const el = vendorEl();
    renderHeroicVendorWindow(el, 'Q', heroicView(), fakeHeroicDeps());
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    const closeBtn = el.querySelector<HTMLElement>('[data-window-close]') as HTMLElement;
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
    expect(isWindowDragHandle(closeBtn, el)).toBe(false);
  });
});

describe('two-tenant handoff: heroic and copper never share a frame', () => {
  it('a copper reopen after a heroic paint cold-rebuilds copper own frame (with its tab rail)', () => {
    const el = vendorEl();
    const heroicClose = vi.fn();
    const copperClose = vi.fn();
    document.body.classList.add('vendor-open');
    renderHeroicVendorWindow(el, 'Q', heroicView(), fakeHeroicDeps({ onClose: heroicClose }));
    // Direct copper-to-heroic-reverse handoff: openVendor renders the copper vendor
    // into the same root without any teardown of the heroic content.
    renderCopper(el, 'Gorznak', fakeVendorDeps({ onClose: copperClose }));
    // The heroic wrapper is gone; copper owns a fresh DIRECT-CHILD frame with the
    // Browse/Sell/Buyback tab rail (which a reused tab-less heroic frame would have
    // lacked).
    expect(el.querySelector(':scope > .heroic-shop')).toBeNull();
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    expect(frame?.querySelector('.tab-rail')).not.toBeNull();
    expect(el.children.length).toBe(1);
    // The close routes to copper (never the stale heroic handler a shared frame
    // would have kept wired).
    el.querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(copperClose).toHaveBeenCalledTimes(1);
    expect(heroicClose).not.toHaveBeenCalled();
  });

  it('a heroic reopen after a copper paint cold-rebuilds the heroic wrapper', () => {
    const el = vendorEl();
    document.body.classList.add('vendor-open');
    renderCopper(el, 'Gorznak', fakeVendorDeps());
    expect(el.querySelector(':scope > .window-frame')).not.toBeNull();
    renderHeroicVendorWindow(el, 'Q', heroicView(), fakeHeroicDeps());
    // Copper's direct-child frame is gone; heroic owns the wrapper mount again.
    expect(el.querySelector(':scope > .window-frame')).toBeNull();
    expect(el.querySelector(':scope > .heroic-shop > .window-frame')).not.toBeNull();
    expect(el.children.length).toBe(1);
  });
});
