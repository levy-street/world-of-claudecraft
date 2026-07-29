// The World Market browse read's sorted-book memo and browse-revision signal
// (the tick-budget fix: rebuilding filter+sort of the whole book per viewer per
// tick was the production broadcast hot spot). Pins three claims:
//   1. filtering the memoized sorted book yields the EXACT sequence the old
//      filter-then-sort pipeline produced (an independent oracle, not a copy);
//   2. the sort really is memoized: the sorted rows are reference-stable across
//      reads and viewers until the book changes, and rebuild after;
//   3. every wire-reachable mutating verb advances the browse revision the
//      server gate polls (list, list-instance, buy, cancel, collect, expiry,
//      rekey, purge, load), so a rebuild-only-on-change gate can never serve a
//      stale view.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { MarketQuery } from '../src/sim/market_query';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

type MarketListing = Sim['marketListings'][number];

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function q(search = '', extra: Partial<MarketQuery> = {}): MarketQuery {
  return {
    search,
    itemType: 'all',
    subtype: 'all',
    armorClass: 'all',
    primaryStat: 'all',
    rarity: 'all',
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

// The PRE-FIX browse pipeline, reimplemented as the ordering oracle: filter the
// raw (unsorted) book, then sort the matches name-then-price with the same
// localeCompare comparator marketInfoFor used before the memo.
function oldPipelineIds(sim: Sim, matches: (l: MarketListing) => boolean): number[] {
  return sim.marketListings
    .filter(matches)
    .sort((a, b) => {
      const na = ITEMS[a.itemId]?.name ?? a.itemId;
      const nb = ITEMS[b.itemId]?.name ?? b.itemId;
      return na.localeCompare(nb) || a.price - b.price;
    })
    .map((l) => l.id);
}

function sortedRowsRef(sim: Sim): MarketListing[] {
  // biome-ignore lint/suspicious/noExplicitAny: reaching the private memo is the point of these pins
  return (sim as any).market.sortedBook();
}

describe('World Market sorted-book memo', () => {
  it('yields the exact sequence the old filter-then-sort pipeline produced', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 3, seller);
    sim.addItem('bone_fragments', 2, seller);
    // Distinct prices so the price tie-break inside one name is exercised too.
    sim.marketList('wolf_fang', 1, 300, seller);
    sim.marketList('wolf_fang', 1, 100, seller);
    sim.marketList('wolf_fang', 1, 200, seller);
    sim.marketList('bone_fragments', 2, 150, seller);

    const viewer = sim.addPlayer('mage', 'Viewer');
    standAtMerchant(sim, viewer);

    // Unfiltered: the viewer owns nothing, so the wired page IS the sorted
    // others sequence (house stock included), exactly the old pipeline's order.
    const all = marketInfo(sim, viewer);
    expect(all.totalCount).toBe(sim.marketListings.length);
    expect(all.listings.map((l) => l.id)).toEqual(oldPipelineIds(sim, () => true));

    // Filtered: same claim on a narrowed book.
    sim.marketSearch(q('wolf'), viewer);
    const filtered = marketInfo(sim, viewer);
    expect(filtered.listings.length).toBeGreaterThan(0);
    expect(filtered.listings.map((l) => l.id)).toEqual(
      oldPipelineIds(sim, (l) =>
        (ITEMS[l.itemId]?.name ?? l.itemId).toLowerCase().includes('wolf'),
      ),
    );

    // The seller's own goods still lead their view, page order preserved.
    const mineFirst = marketInfo(sim, seller);
    const mineIds = sim.marketListings
      .filter((l) => !l.house && l.sellerKey === String(seller))
      .map((l) => l.id);
    expect(mineFirst.listings.slice(0, mineIds.length).every((l) => l.mine)).toBe(true);
  });

  it('resolves full ties (same name, same price) by book order, like the old pipeline', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 2, seller);
    sim.addItem('bone_fragments', 1, seller);
    // Two wolf_fang rows at the IDENTICAL price, separated by another row in
    // book order: the order between them is decided purely by sort stability
    // relative to the original index, the one input class the commute argument
    // hinges on.
    sim.marketList('wolf_fang', 1, 100, seller);
    sim.marketList('bone_fragments', 1, 100, seller);
    sim.marketList('wolf_fang', 1, 100, seller);
    const viewer = sim.addPlayer('mage', 'Viewer');
    standAtMerchant(sim, viewer);
    sim.marketSearch(q('wolf'), viewer);
    const ids = marketInfo(sim, viewer).listings.map((l) => l.id);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(
      oldPipelineIds(sim, (l) =>
        (ITEMS[l.itemId]?.name ?? l.itemId).toLowerCase().includes('wolf'),
      ),
    );
  });

  it('memoizes the sort across reads and viewers, and rebuilds when the book changes', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Alta');
    const b = sim.addPlayer('mage', 'Bruna');
    standAtMerchant(sim, a);
    standAtMerchant(sim, b);

    marketInfo(sim, a);
    const rows1 = sortedRowsRef(sim);
    marketInfo(sim, a);
    marketInfo(sim, b);
    expect(sortedRowsRef(sim)).toBe(rows1);

    sim.addItem('wolf_fang', 1, a);
    sim.marketList('wolf_fang', 1, 100, a);
    marketInfo(sim, a);
    const rows2 = sortedRowsRef(sim);
    expect(rows2).not.toBe(rows1);
    expect(rows2.length).toBe(rows1.length + 1);
  });

  it('serves a fresh view when tests mutate the listings array directly (length guard)', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Alta');
    standAtMerchant(sim, a);
    const before = marketInfo(sim, a).totalCount;
    // Direct push, no bump site: the memo's length guard must still invalidate.
    sim.marketListings.push({
      id: 999_999,
      sellerKey: 'someone-else',
      sellerName: 'Someone',
      itemId: 'wolf_fang',
      count: 1,
      price: 123,
      expiresAt: Number.POSITIVE_INFINITY,
      house: false,
    });
    expect(marketInfo(sim, a).totalCount).toBe(before + 1);
  });
});

describe('World Market browse revision (the server rebuild gate signal)', () => {
  it('is null away from the Merchant and a number beside one', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Alta');
    expect(sim.marketBrowseRevFor(a)).toBeNull();
    standAtMerchant(sim, a);
    expect(sim.marketBrowseRevFor(a)).toBeTypeOf('number');
  });

  it('holds steady across idle ticks and advances on every wire-visible verb', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    const buyer = sim.addPlayer('mage', 'Buyer');
    standAtMerchant(sim, seller);
    standAtMerchant(sim, buyer);
    sim.addItem('wolf_fang', 2, seller);
    const buyerMeta = sim.players.get(buyer);
    if (!buyerMeta) throw new Error('missing buyer meta');
    buyerMeta.copper = 100_000;

    const at = () => {
      const rev = sim.marketBrowseRevFor(seller);
      if (rev === null) throw new Error('seller left the Merchant');
      return rev;
    };

    // Idle ticks (which run the once-a-second updateMarket sweep) move nothing.
    const idle = at();
    for (let i = 0; i < 40; i++) sim.tick();
    expect(at()).toBe(idle);

    // list
    let rev = at();
    sim.marketList('wolf_fang', 1, 100, seller);
    expect(at()).toBeGreaterThan(rev);

    // buy (a player listing: the row leaves the book, proceeds credit the seller)
    rev = at();
    const mine = sim.marketListings.find((l) => !l.house && l.sellerKey === String(seller));
    if (!mine) throw new Error('missing seller listing');
    sim.marketBuy(mine.id, buyer);
    expect(at()).toBeGreaterThan(rev);

    // collect (the seller takes the proceeds the buy just credited)
    rev = at();
    sim.marketCollect(seller);
    expect(at()).toBeGreaterThan(rev);

    // cancel (list again, then reclaim)
    sim.marketList('wolf_fang', 1, 100, seller);
    rev = at();
    const relisted = sim.marketListings.find((l) => !l.house && l.sellerKey === String(seller));
    if (!relisted) throw new Error('missing relisted row');
    sim.marketCancel(relisted.id, seller);
    expect(at()).toBeGreaterThan(rev);

    // expiry (the once-a-second sweep returns the row to the collection)
    sim.addItem('wolf_fang', 1, seller);
    sim.marketList('wolf_fang', 1, 100, seller);
    const expiring = sim.marketListings.find((l) => !l.house && l.sellerKey === String(seller));
    if (!expiring) throw new Error('missing expiring row');
    expiring.expiresAt = 0;
    rev = at();
    for (let i = 0; i < 21; i++) sim.tick();
    expect(at()).toBeGreaterThan(rev);
    expect(sim.marketListings.some((l) => l.id === expiring.id)).toBe(false);
  });

  it('advances on the remaining wire-reachable verbs: list-instance, rekey, purge, load', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);

    const at = () => {
      const rev = sim.marketBrowseRevFor(seller);
      if (rev === null) throw new Error('seller left the Merchant');
      return rev;
    };

    // list-instance (its own push site, independent of marketList's)
    sim.addItem('oiled_boots', 1, seller);
    sim.addItemInstance('oiled_boots', { enchant: 'ench_stat_str' }, seller);
    let rev = at();
    sim.marketListInstance('oiled_boots', 500, { enchant: 'ench_stat_str' }, seller);
    expect(at()).toBeGreaterThan(rev);
    expect(sim.marketListings.some((l) => l.instance !== undefined)).toBe(true);

    // rekey (in-place sellerName edits the memo's length guard cannot see)
    rev = at();
    sim.rekeyMarketSeller(seller, 'Seller', 'Renamed');
    expect(at()).toBeGreaterThan(rev);
    expect(sim.marketListings.some((l) => l.sellerName === 'Renamed')).toBe(true);

    // purge (removes the seller's rows and collection)
    rev = at();
    sim.purgeMarketSeller(seller, 'Renamed');
    expect(at()).toBeGreaterThan(rev);
    expect(sim.marketListings.some((l) => !l.house)).toBe(false);

    // load (rebuilds the whole book)
    rev = at();
    sim.loadMarket({ listings: [], collections: [], nextListingId: 1_000_000 });
    expect(at()).toBeGreaterThan(rev);
  });

  it('a viewer browsing right after a buy sees the row gone (no stale memo end to end)', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    const buyer = sim.addPlayer('mage', 'Buyer');
    standAtMerchant(sim, seller);
    standAtMerchant(sim, buyer);
    sim.addItem('wolf_fang', 1, seller);
    sim.marketList('wolf_fang', 1, 100, seller);
    const buyerMeta = sim.players.get(buyer);
    if (!buyerMeta) throw new Error('missing buyer meta');
    buyerMeta.copper = 1_000;

    const listed = sim.marketListings.find((l) => !l.house && l.itemId === 'wolf_fang');
    if (!listed) throw new Error('missing listing');
    // Warm the memo with a browse, then buy, then browse again.
    expect(marketInfo(sim, buyer).listings.some((l) => l.id === listed.id)).toBe(true);
    sim.marketBuy(listed.id, buyer);
    expect(marketInfo(sim, buyer).listings.some((l) => l.id === listed.id)).toBe(false);
  });
});
