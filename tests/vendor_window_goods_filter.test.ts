// @vitest-environment jsdom
// The shop's tabs, search and slot headings through the REAL vendor painter:
// tabs appear only when the stock can fill them, a tab survives the
// buy-driven rebuild, search typing refills the grid without rebuilding the
// box, and opening a different vendor starts on All again.
import { afterEach, describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { VENDOR_SEARCH_MIN_GOODS } from '../src/ui/hud/vendor/vendor_goods_filter_core';
import type { VendorGoodsRow, VendorView } from '../src/ui/hud/vendor/vendor_view';
import { renderVendorWindow, type VendorWindowDeps } from '../src/ui/hud/vendor/vendor_window';

afterEach(() => {
  document.body.innerHTML = '';
});

const row = (itemId: string): VendorGoodsRow => ({
  itemId,
  item: ITEMS[itemId],
  price: { copper: 10, honor: 0 },
  quantity: 1,
  affordable: true,
  requirementUnmet: false,
});

const view = (ids: string[]): VendorView => ({
  goods: ids.map(row),
  buyback: [],
  honorBalance: 0,
  hasHonorGoods: false,
  multiple: 1,
});

const deps = (): VendorWindowDeps => ({
  itemIcon: () => '<img>',
  moneyHtml: (copper) => `${copper}c`,
  itemTooltip: () => '<div></div>',
  attachTooltip: () => {},
  hideTooltip: () => {},
  onBuy: () => {},
  onQtyChange: () => {},
  buyCustomMax: () => 0,
  onBuyBack: () => {},
  onSellJunk: () => {},
  onClose: () => {},
  sellJunk: { enabled: false, proceeds: 0 },
});

const shown = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLElement>('[data-grid="goods"] > .vendor-item')].map(
    (b) => b.dataset.coachItem,
  );
const captions = (el: HTMLElement) =>
  [...el.querySelectorAll('.vendor-goods-caption')].map((c) => c.textContent);
const chip = (el: HTMLElement, cat: string) =>
  el.querySelector<HTMLButtonElement>(`[data-focus-key="vchip:${cat}"]`);

const QM = ['baked_bread', 'worn_sword', 'recruit_tunic', 'minor_healing_potion', 'homespun_hood'];

describe('vendor goods tabs', () => {
  it('a one-kind shop shows no tabs and no search, exactly as before', () => {
    const el = document.createElement('div');
    renderVendorWindow(el, 'Baker', view(['baked_bread', 'minor_healing_potion']), deps());
    expect(el.querySelector('.vendor-filter-bar')).toBeNull();
    expect(shown(el)).toEqual(['baked_bread', 'minor_healing_potion']);
  });

  it('a mixed shop shows only the tabs it can fill, with real labels', () => {
    const el = document.createElement('div');
    renderVendorWindow(el, 'Quartermaster', view(QM), deps());
    const labels = [...el.querySelectorAll('.vendor-chips .bag-chip')].map((c) => c.textContent);
    expect(labels).toEqual(['All', 'Weapons', 'Armor', 'Consumables']);
    expect(chip(el, 'all')?.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('.vendor-chips')?.getAttribute('aria-label')).toBe('Filter goods');
  });

  it('a tab narrows the goods, adds slot headings, and survives the buy rebuild', () => {
    const el = document.createElement('div');
    renderVendorWindow(el, 'Quartermaster', view(QM), deps());
    chip(el, 'armor')?.click();
    expect(shown(el)).toEqual(['homespun_hood', 'recruit_tunic']);
    expect(captions(el)).toEqual(['Helmet', 'Chest']);
    expect(chip(el, 'armor')?.getAttribute('aria-pressed')).toBe('true');
    // Hud re-renders after every purchase with a fresh view of the same shop.
    renderVendorWindow(el, 'Quartermaster', view(QM), deps());
    expect(shown(el)).toEqual(['homespun_hood', 'recruit_tunic']);
  });

  it('a different vendor starts on All', () => {
    const el = document.createElement('div');
    renderVendorWindow(el, 'Quartermaster', view(QM), deps());
    chip(el, 'armor')?.click();
    renderVendorWindow(el, 'Provisioner', view(QM), deps());
    expect(chip(el, 'all')?.getAttribute('aria-pressed')).toBe('true');
    expect(shown(el)).toHaveLength(QM.length);
  });
});

describe('vendor goods search', () => {
  const big = () =>
    view(
      Array.from({ length: VENDOR_SEARCH_MIN_GOODS }, (_, i) =>
        i === 4 ? 'rusty_dagger' : i % 2 ? 'baked_bread' : 'minor_healing_potion',
      ),
    );

  it('appears only on a long stock and filters as you type without rebuilding the box', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    renderVendorWindow(el, 'Trader', view(QM), deps());
    expect(el.querySelector('.vendor-search')).toBeNull();
    renderVendorWindow(el, 'Trader', big(), deps());
    const box = el.querySelector<HTMLInputElement>('.vendor-search');
    expect(box?.getAttribute('aria-label')).toBe("Search this vendor's goods");
    box?.focus();
    if (box) box.value = 'dagger';
    box?.dispatchEvent(new Event('input'));
    expect(shown(el)).toEqual(['rusty_dagger']);
    // Same element, still focused: the keystroke refilled only the grid.
    expect(el.querySelector('.vendor-search')).toBe(box);
    expect(document.activeElement).toBe(box);
    if (box) box.value = 'zzz';
    box?.dispatchEvent(new Event('input'));
    expect(shown(el)).toEqual([]);
    expect(el.querySelector('.vendor-goods-none')?.textContent).toBe('No goods match');
  });
});
