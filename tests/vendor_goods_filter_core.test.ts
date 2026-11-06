// The shop's goods tabs, search and slot headings (vendor_goods_filter_core.ts):
// the bag window's categories and slot groups carried over to vendors. Real
// catalog ids, so the kind and slot facts come from shipped content.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import {
  buildVendorGoodsEntries,
  DEFAULT_VENDOR_GOODS_FILTER,
  effectiveVendorTab,
  VENDOR_SEARCH_MIN_GOODS,
  type VendorGoodsEntry,
  vendorGoodsSearchable,
  vendorGoodsTabs,
} from '../src/ui/hud/vendor/vendor_goods_filter_core';
import type { VendorGoodsRow } from '../src/ui/hud/vendor/vendor_view';

const row = (itemId: string, extra: Partial<VendorGoodsRow> = {}): VendorGoodsRow => ({
  itemId,
  item: ITEMS[itemId],
  price: { copper: 10, honor: 0 },
  quantity: 1,
  affordable: true,
  requirementUnmet: false,
  ...extra,
});
const nameOf = (r: VendorGoodsRow) => r.item.name;
const readout = (entries: VendorGoodsEntry[]) =>
  entries.map((e) => (e.kind === 'caption' ? `[${e.group}]` : e.row.itemId));

const mixed = (): VendorGoodsRow[] => [
  row('baked_bread'),
  row('worn_sword'),
  row('recruit_tunic'),
  row('minor_healing_potion'),
  row('homespun_hood'),
];

describe('vendorGoodsTabs', () => {
  it('offers All plus only the categories the stock can fill, in the bag rail order', () => {
    expect(vendorGoodsTabs(mixed())).toEqual(['all', 'weapon', 'armor', 'consumable']);
  });

  it('offers no tabs when the whole stock is one kind', () => {
    expect(vendorGoodsTabs([row('baked_bread'), row('minor_healing_potion')])).toEqual([]);
    expect(vendorGoodsTabs([])).toEqual([]);
  });

  it('never offers the copy-only Favorites and Junk tabs', () => {
    const tabs = vendorGoodsTabs([...mixed(), row('soggy_boot')]);
    expect(tabs).not.toContain('favourite');
    expect(tabs).not.toContain('junk');
  });
});

describe('buildVendorGoodsEntries', () => {
  it('All keeps the vendor order and adds no headings to a mixed stock', () => {
    expect(readout(buildVendorGoodsEntries(mixed(), DEFAULT_VENDOR_GOODS_FILTER, nameOf))).toEqual([
      'baked_bread',
      'worn_sword',
      'recruit_tunic',
      'minor_healing_potion',
      'homespun_hood',
    ]);
  });

  it('a tab narrows the list, and gear spread over two slots gets slot headings', () => {
    const armor = buildVendorGoodsEntries(mixed(), { category: 'armor', search: '' }, nameOf);
    expect(readout(armor)).toEqual(['[helmet]', 'homespun_hood', '[chest]', 'recruit_tunic']);
    const food = buildVendorGoodsEntries(mixed(), { category: 'consumable', search: '' }, nameOf);
    expect(readout(food)).toEqual(['baked_bread', 'minor_healing_potion']);
  });

  it('an all-gear shop gets slot headings on All, with no tab row needed', () => {
    const smith = [row('eastbrook_greatsword'), row('worn_sword'), row('rusty_dagger')];
    expect(vendorGoodsTabs(smith)).toEqual([]);
    expect(readout(buildVendorGoodsEntries(smith, DEFAULT_VENDOR_GOODS_FILTER, nameOf))).toEqual([
      '[onehand]',
      'worn_sword',
      'rusty_dagger',
      '[twohand]',
      'eastbrook_greatsword',
    ]);
  });

  it('one slot only, or a riding row among gear, gets no headings', () => {
    const one = [row('worn_sword'), row('rusty_dagger')];
    expect(readout(buildVendorGoodsEntries(one, DEFAULT_VENDOR_GOODS_FILTER, nameOf))).toEqual([
      'worn_sword',
      'rusty_dagger',
    ]);
    const riding = [row('worn_sword'), row('eastbrook_greatsword', { ridingRank: 1 })];
    expect(
      buildVendorGoodsEntries(riding, DEFAULT_VENDOR_GOODS_FILTER, nameOf).every(
        (e) => e.kind === 'row',
      ),
    ).toBe(true);
  });

  it('a remembered tab the stock no longer fills falls back to All', () => {
    const food = [row('baked_bread'), row('worn_sword')];
    const filter = { category: 'armor' as const, search: '' };
    expect(effectiveVendorTab(food, filter)).toBe('all');
    expect(readout(buildVendorGoodsEntries(food, filter, nameOf))).toEqual([
      'baked_bread',
      'worn_sword',
    ]);
  });

  it('search matches the shown name, and is ignored on a stock too short to show the box', () => {
    const many = Array.from({ length: VENDOR_SEARCH_MIN_GOODS }, (_, i) =>
      row(i === 3 ? 'rusty_dagger' : 'baked_bread'),
    );
    expect(vendorGoodsSearchable(many)).toBe(true);
    const hits = buildVendorGoodsEntries(many, { category: 'all', search: ' DAGGER ' }, nameOf);
    expect(readout(hits)).toEqual(['rusty_dagger']);
    // The resolver decides what is matched (the localized name the row shows).
    const byShownName = buildVendorGoodsEntries(many, { category: 'all', search: 'dolch' }, (r) =>
      r.itemId === 'rusty_dagger' ? 'Rostiger Dolch' : 'Brot',
    );
    expect(readout(byShownName)).toEqual(['rusty_dagger']);
    const short = mixed();
    expect(vendorGoodsSearchable(short)).toBe(false);
    expect(buildVendorGoodsEntries(short, { category: 'all', search: 'zzz' }, nameOf)).toHaveLength(
      5,
    );
  });
});
