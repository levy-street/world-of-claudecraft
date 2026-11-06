// @vitest-environment jsdom
// The shop's tabs, search and slot headings through the REAL vendor painter:
// tabs appear only when the stock can fill them, a chip hands the change to Hud
// (which re-renders), a tab survives the buy-driven rebuild, search typing
// refills the grid without rebuilding the box, a rebuild mid-typing keeps the
// caret, and a fresh open starts on All with an empty search.
import { afterEach, describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { VENDOR_SEARCH_MIN_GOODS } from '../src/ui/hud/vendor/vendor_goods_filter_core';
import type { VendorGoodsRow, VendorView } from '../src/ui/hud/vendor/vendor_view';
import {
  renderVendorWindow,
  resetVendorGoodsFilter,
  type VendorWindowDeps,
} from '../src/ui/hud/vendor/vendor_window';

afterEach(() => {
  document.body.innerHTML = '';
});

const row = (itemId: string, extra: Partial<VendorGoodsRow> = {}): VendorGoodsRow => ({
  itemId,
  item: ITEMS[itemId],
  price: { copper: 10, honor: 0 },
  quantity: 1,
  affordable: true,
  requirementUnmet: false,
  ...extra,
});

const view = (rows: VendorGoodsRow[]): VendorView => ({
  goods: rows,
  buyback: [],
  honorBalance: 0,
  hasHonorGoods: false,
  multiple: 1,
});
const viewOf = (ids: string[]) => view(ids.map((id) => row(id)));

/** Render the way Hud does: onFilterChange re-runs the build and re-renders. */
function open(el: HTMLElement, vendor: string, v: VendorView): { filterChanges: number } {
  const counter = { filterChanges: 0 };
  const deps: VendorWindowDeps = {
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
    onFilterChange: () => {
      counter.filterChanges++;
      renderVendorWindow(el, vendor, v, deps);
    },
    onClose: () => {},
    sellJunk: { enabled: false, proceeds: 0 },
  };
  renderVendorWindow(el, vendor, v, deps);
  return counter;
}

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
    open(el, 'Baker', viewOf(['baked_bread', 'minor_healing_potion']));
    expect(el.querySelector('.vendor-filter-bar')).toBeNull();
    expect(shown(el)).toEqual(['baked_bread', 'minor_healing_potion']);
  });

  it('the stablemaster gets no tab row: riding lessons file under Mounts', () => {
    const el = document.createElement('div');
    open(
      el,
      'Stablemaster',
      view([row('riding_training', { ridingRank: 1 }), row('reins_valorsteed')]),
    );
    expect(ITEMS.riding_training.kind).toBe('tool');
    expect(el.querySelector('.vendor-filter-bar')).toBeNull();
  });

  it('a mixed shop shows only the tabs it can fill, with real labels', () => {
    const el = document.createElement('div');
    open(el, 'Quartermaster', viewOf(QM));
    const labels = [...el.querySelectorAll('.vendor-chips .bag-chip')].map((c) => c.textContent);
    expect(labels).toEqual(['All', 'Weapons', 'Armor', 'Consumables']);
    expect(chip(el, 'all')?.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('.vendor-chips')?.getAttribute('aria-label')).toBe('Filter goods');
  });

  it('a chip hands the change to Hud, narrows the goods, adds headings, and survives a rebuild', () => {
    const el = document.createElement('div');
    const counter = open(el, 'Quartermaster', viewOf(QM));
    chip(el, 'armor')?.click();
    expect(counter.filterChanges).toBe(1);
    expect(shown(el)).toEqual(['homespun_hood', 'recruit_tunic']);
    expect(captions(el)).toEqual(['Helmet', 'Chest']);
    expect(chip(el, 'armor')?.getAttribute('aria-pressed')).toBe('true');
    // Hud re-renders after every purchase with a fresh view of the same shop.
    open(el, 'Quartermaster', viewOf(QM));
    expect(shown(el)).toEqual(['homespun_hood', 'recruit_tunic']);
  });

  it('a fresh open (reset) or a different vendor starts on All', () => {
    const el = document.createElement('div');
    open(el, 'Quartermaster', viewOf(QM));
    chip(el, 'armor')?.click();
    open(el, 'Provisioner', viewOf(QM));
    expect(chip(el, 'all')?.getAttribute('aria-pressed')).toBe('true');
    chip(el, 'armor')?.click();
    resetVendorGoodsFilter(el);
    open(el, 'Provisioner', viewOf(QM));
    expect(chip(el, 'all')?.getAttribute('aria-pressed')).toBe('true');
    expect(shown(el)).toHaveLength(QM.length);
  });
});

describe('vendor goods search', () => {
  const big = () =>
    viewOf(
      Array.from({ length: VENDOR_SEARCH_MIN_GOODS }, (_, i) =>
        i === 4 ? 'rusty_dagger' : i % 2 ? 'baked_bread' : 'minor_healing_potion',
      ),
    );

  it('appears only on a long stock and filters as you type without rebuilding the box', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    open(el, 'Trader', viewOf(QM));
    expect(el.querySelector('.vendor-search')).toBeNull();
    open(el, 'Trader', big());
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

  it('a rebuild it did not start (an online purse echo) keeps the query, focus and caret', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    open(el, 'Trader', big());
    const box = el.querySelector<HTMLInputElement>('.vendor-search');
    box?.focus();
    if (box) box.value = 'dagg';
    box?.dispatchEvent(new Event('input'));
    box?.setSelectionRange(2, 2);
    open(el, 'Trader', big());
    const fresh = el.querySelector<HTMLInputElement>('.vendor-search');
    expect(fresh).not.toBe(box);
    expect(fresh?.value).toBe('dagg');
    expect(document.activeElement).toBe(fresh);
    expect(fresh?.selectionStart).toBe(2);
    expect(shown(el)).toEqual(['rusty_dagger']);
  });

  it('a fresh open clears the search', () => {
    const el = document.createElement('div');
    open(el, 'Trader', big());
    const box = el.querySelector<HTMLInputElement>('.vendor-search');
    if (box) box.value = 'dagger';
    box?.dispatchEvent(new Event('input'));
    resetVendorGoodsFilter(el);
    open(el, 'Trader', big());
    expect(el.querySelector<HTMLInputElement>('.vendor-search')?.value).toBe('');
    expect(shown(el)).toHaveLength(VENDOR_SEARCH_MIN_GOODS);
  });
});
