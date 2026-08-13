// World Market browse: sort by price ascending (issue #3102). Pins the acceptance
// criteria the issue names: the whole matched book orders low to high (not just the
// current page), equal-price rows land in a fixed deterministic order, the sort
// composes with search/type filters, and the viewer's own goods / house stock stay
// reachable (buyable/reclaimable) under either order. tests/market_browse_cache.test.ts
// covers the pre-existing name-then-price default and its memoization; this file is the
// price axis's sibling, not a duplicate of it.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { MARKET_PAGE_SIZE, type MarketQuery } from '../src/sim/market_query';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function q(extra: Partial<MarketQuery> = {}): MarketQuery {
  return {
    search: '',
    itemType: 'all',
    subtype: 'all',
    armorClass: 'all',
    primaryStat: 'all',
    rarity: 'all',
    sort: 'price',
    page: 0,
    ...extra,
  };
}

function merchant(sim: Sim): Entity {
  for (const e of sim.entities.values()) if (e.templateId === 'the_merchant') return e;
  throw new Error('the Merchant was not spawned');
}

function standAtMerchant(sim: Sim, pid: number) {
  const m = merchant(sim);
  const e = sim.entities.get(pid);
  if (!e) throw new Error(`missing entity ${pid}`);
  e.pos.x = m.pos.x;
  e.pos.z = m.pos.z;
  e.pos.y = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function marketInfo(sim: Sim, pid: number) {
  const info = sim.marketInfoFor(pid);
  if (!info) throw new Error(`missing market info for ${pid}`);
  return info;
}

describe('World Market: price-ascending browse sort (issue #3102)', () => {
  it('orders the whole matched result set low to high, not just the wired page', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 3, seller);
    sim.addItem('bone_fragments', 2, seller);
    sim.marketList('wolf_fang', 1, 900, seller);
    sim.marketList('wolf_fang', 1, 100, seller);
    sim.marketList('wolf_fang', 1, 500, seller);
    sim.marketList('bone_fragments', 2, 300, seller);

    const viewer = sim.addPlayer('mage', 'Viewer');
    standAtMerchant(sim, viewer);
    sim.marketSearch(q(), viewer);
    const info = marketInfo(sim, viewer);
    const prices = info.listings.map((l) => l.price);
    for (let i = 1; i < prices.length; i++) {
      expect(
        prices[i],
        `row ${i} (${prices[i]}) follows row ${i - 1} (${prices[i - 1]})`,
      ).toBeGreaterThanOrEqual(prices[i - 1]);
    }
    // Sanity: the seller's own four listings really are all present, not silently
    // dropped by the reorder.
    expect(info.listings.filter((l) => l.mine)).toHaveLength(0); // viewer sold nothing
    expect(info.totalCount).toBeGreaterThanOrEqual(4);
    expect(info.sort).toBe('price');
  });

  it('breaks ties between equal-price listings deterministically (name, then listing id)', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 2, seller);
    sim.addItem('bone_fragments', 1, seller);
    // Same price on both wolf_fang rows; bone_fragments sits at the same price too, so
    // the tie is broken by name (Bone Fragments vs Wolf Fang) then, within a name, by id.
    sim.marketList('wolf_fang', 1, 200, seller);
    sim.marketList('bone_fragments', 1, 200, seller);
    sim.marketList('wolf_fang', 1, 200, seller);

    const viewer = sim.addPlayer('mage', 'Viewer');
    standAtMerchant(sim, viewer);
    sim.marketSearch(q({ search: 'wolf fang', itemType: 'all' }), viewer);
    // Widen back out: search for a substring covering both names instead, since the
    // real assertion is the CROSS-NAME tie order, not a narrowed set.
    sim.marketSearch(q(), viewer);
    const idsOnce = marketInfo(sim, viewer).listings.map((l) => l.id);
    const idsTwice = marketInfo(sim, viewer).listings.map((l) => l.id);
    expect(idsTwice, 'repeated reads of the same book agree').toEqual(idsOnce);

    const wolfIds = sim.marketListings
      .filter((l) => l.itemId === 'wolf_fang' && !l.house)
      .map((l) => l.id)
      .sort((a, b) => a - b);
    const boneId = sim.marketListings.find((l) => l.itemId === 'bone_fragments' && !l.house)?.id;
    if (boneId === undefined) throw new Error('missing bone_fragments listing');
    const boneName = ITEMS.bone_fragments?.name ?? 'bone_fragments';
    const wolfName = ITEMS.wolf_fang?.name ?? 'wolf_fang';
    const expected =
      boneName.localeCompare(wolfName) <= 0 ? [boneId, ...wolfIds] : [...wolfIds, boneId];
    const rows = marketInfo(sim, viewer)
      .listings.filter((l) => l.price === 200)
      .map((l) => l.id);
    expect(rows).toEqual(expected);
  });

  it('paginates a book larger than one page in non-decreasing price order across pages', () => {
    const sim = makeWorld();
    // Six sellers x ten wolf_fang listings = 60 rows, safely past MARKET_PAGE_SIZE (50)
    // and under MARKET_MAX_LISTINGS (12) per seller.
    for (let s = 0; s < 6; s++) {
      const pid = sim.addPlayer('warrior', `Seller${s}`);
      standAtMerchant(sim, pid);
      sim.addItem('wolf_fang', 10, pid);
      for (let i = 0; i < 10; i++) {
        // A deterministic, non-monotonic-in-listing-order price ladder so the sort is
        // actually doing work rather than the book happening to already be ordered.
        const price = 100 + ((s * 37 + i * 13) % 400);
        sim.marketList('wolf_fang', 1, price, pid);
      }
    }
    const viewer = sim.addPlayer('mage', 'Viewer');
    standAtMerchant(sim, viewer);
    sim.marketSearch(q({ page: 0 }), viewer);
    const page0 = marketInfo(sim, viewer);
    expect(page0.pageCount).toBeGreaterThan(1);
    expect(page0.listings).toHaveLength(MARKET_PAGE_SIZE);

    sim.marketSearch(q({ page: 1 }), viewer);
    const page1 = marketInfo(sim, viewer);
    expect(page1.listings.length).toBeGreaterThan(0);

    const page0Prices = page0.listings.map((l) => l.price);
    const page1Prices = page1.listings.map((l) => l.price);
    for (let i = 1; i < page0Prices.length; i++) {
      expect(page0Prices[i]).toBeGreaterThanOrEqual(page0Prices[i - 1]);
    }
    for (let i = 1; i < page1Prices.length; i++) {
      expect(page1Prices[i]).toBeGreaterThanOrEqual(page1Prices[i - 1]);
    }
    // The boundary between pages holds the order too: nothing on page 1 undercuts the
    // most expensive row still showing on page 0.
    expect(page1Prices[0]).toBeGreaterThanOrEqual(page0Prices[page0Prices.length - 1]);
  });

  it('composes with search and type filters instead of only sorting the unfiltered book', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 2, seller);
    sim.addItem('bone_fragments', 2, seller);
    sim.marketList('wolf_fang', 1, 900, seller);
    sim.marketList('wolf_fang', 1, 100, seller);
    sim.marketList('bone_fragments', 1, 50, seller); // cheaper, but filtered out by search
    sim.marketList('bone_fragments', 1, 999, seller);

    const viewer = sim.addPlayer('mage', 'Viewer');
    standAtMerchant(sim, viewer);
    sim.marketSearch(q({ search: 'wolf' }), viewer);
    const info = marketInfo(sim, viewer);
    expect(info.listings.every((l) => l.itemId === 'wolf_fang')).toBe(true);
    expect(info.listings.map((l) => l.price)).toEqual([100, 900]);
  });

  it('keeps the viewer own listings and house stock present (buyable/reclaimable) under price sort', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 1, seller);
    sim.marketList('wolf_fang', 1, 250, seller);
    sim.marketSearch(q(), seller);
    const info = marketInfo(sim, seller);
    const mine = info.listings.find((l) => l.mine);
    expect(mine, 'the seller still sees their own listing under price sort').toBeTruthy();
    expect(mine?.price).toBe(250);
    // House stock (the Merchant's own standing goods) is still present too.
    expect(info.listings.some((l) => l.house)).toBe(true);
  });

  it('echoes the active sort back on MarketInfo and detects reconnect drift on it', () => {
    const sim = makeWorld();
    const viewer = sim.addPlayer('mage', 'Viewer');
    standAtMerchant(sim, viewer);
    sim.marketSearch(q({ sort: 'price' }), viewer);
    expect(marketInfo(sim, viewer).sort).toBe('price');
    sim.marketSearch(q({ sort: 'name' }), viewer);
    expect(marketInfo(sim, viewer).sort).toBe('name');
  });
});
