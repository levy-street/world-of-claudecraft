import { describe, expect, it } from 'vitest';
import type { MarketQuery } from '../src/sim/market_query';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

// A full browse query with sensible defaults; tests vary only what they care about.
function q(search = '', extra: Partial<MarketQuery> = {}): MarketQuery {
  return { search, itemType: 'all', subtype: 'all', rarity: 'all', page: 0, ...extra };
}

function merchant(sim: Sim): Entity {
  for (const e of sim.entities.values()) if (e.templateId === 'the_merchant') return e;
  throw new Error('the Merchant was not spawned');
}

// stand a player right on the Merchant so the proximity gate passes
function standAtMerchant(sim: Sim, pid: number) {
  const m = merchant(sim);
  const e = sim.entities.get(pid)!;
  e.pos.x = m.pos.x;
  e.pos.z = m.pos.z;
  e.pos.y = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function copperOf(sim: Sim, pid: number): number {
  return sim.players.get(pid)!.copper;
}

function errorsSince(sim: Sim): string[] {
  return sim.events.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text);
}

function renameLiveCharacter(sim: Sim, pid: number, name: string) {
  sim.players.get(pid)!.name = name;
  sim.entities.get(pid)!.name = name;
}

function marketSellerKey(pid: number): string {
  return String(pid);
}

describe('the World Market — the Merchant', () => {
  it('spawns a single Merchant who keeps standing house stock', () => {
    const sim = makeWorld();
    const merchants = [...sim.entities.values()].filter((e) => e.templateId === 'the_merchant');
    expect(merchants.length).toBe(1);
    const house = sim.marketListings.filter((l) => l.house);
    expect(house.length).toBeGreaterThan(0);
    expect(house.every((l) => l.expiresAt === Infinity && l.sellerKey === '')).toBe(true);
  });

  it('browse filter narrows listings by item name and reports the full match count', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 1, seller);
    sim.addItem('bone_fragments', 1, seller);
    sim.marketList('wolf_fang', 1, 100, seller);
    sim.marketList('bone_fragments', 1, 100, seller);

    const all = sim.marketInfoFor(seller)!;
    expect(all.filter).toBe('');
    expect(all.totalCount).toBe(all.listings.length);
    expect(all.listings.some((l) => l.itemId === 'wolf_fang')).toBe(true);
    expect(all.listings.some((l) => l.itemId === 'bone_fragments')).toBe(true);

    // A substring of the Wolf Fang name must hide every non-matching listing.
    sim.marketSearch(q('wolf'), seller);
    const filtered = sim.marketInfoFor(seller)!;
    expect(filtered.filter).toBe('wolf');
    expect(filtered.listings.length).toBeGreaterThan(0);
    expect(filtered.listings.every((l) => l.itemId === 'wolf_fang')).toBe(true);
    expect(filtered.totalCount).toBe(filtered.listings.length);

    // A no-match query yields an empty list (the UI shows the "no matches" copy).
    sim.marketSearch(q('zzzznomatch'), seller);
    expect(sim.marketInfoFor(seller)!.listings.length).toBe(0);

    // Clearing the filter restores the full, unfiltered view.
    sim.marketSearch(q(''), seller);
    expect(sim.marketInfoFor(seller)!.totalCount).toBe(all.totalCount);
  });

  it('paginates other sellers server-side, keeping the viewer own listings on every page', () => {
    const sim = makeWorld();
    const viewer = sim.addPlayer('warrior', 'Viewer');
    standAtMerchant(sim, viewer);
    const book = sim.market.marketListings;
    book.length = 0; // drop the seeded house stock so the page math is exact

    // 60 other sellers' listings of one item: same name, so they sort by price, which
    // puts the 50 cheapest on page 0 and the last 10 on page 1.
    for (let i = 0; i < 60; i++) {
      book.push({
        id: 100 + i,
        sellerKey: 'rival',
        sellerName: 'Rival',
        itemId: 'bone_fragments',
        count: 1,
        price: 100 + i,
        expiresAt: Number.POSITIVE_INFINITY,
        house: false,
      });
    }
    // One listing owned by the viewer (their stable seller key), which must ride on top
    // of every page for quick reclaim rather than sorting off into the pages of others.
    book.push({
      id: 1,
      sellerKey: marketSellerKey(viewer),
      sellerName: 'Viewer',
      itemId: 'wolf_fang',
      count: 1,
      price: 500,
      expiresAt: Number.POSITIVE_INFINITY,
      house: false,
    });

    const p0 = sim.marketInfoFor(viewer)!;
    expect(p0.page).toBe(0);
    expect(p0.pageCount).toBe(2); // 60 others / 50 per page
    expect(p0.totalCount).toBe(61); // 60 others + 1 own (the full match count)
    const othersP0 = p0.listings.filter((l) => !l.mine);
    expect(othersP0).toHaveLength(50);
    expect(othersP0[0].price).toBe(100); // sorted by price within the same item name
    expect(p0.listings.some((l) => l.mine && l.itemId === 'wolf_fang')).toBe(true);

    // Page 1: the viewer own listing still rides on top; only the last 10 others remain.
    sim.marketSearch(q('', { page: 1 }), viewer);
    const p1 = sim.marketInfoFor(viewer)!;
    expect(p1.page).toBe(1);
    expect(p1.listings.filter((l) => !l.mine)).toHaveLength(10);
    expect(p1.listings.some((l) => l.mine && l.itemId === 'wolf_fang')).toBe(true);

    // An out-of-range page clamps to the last page.
    sim.marketSearch(q('', { page: 99 }), viewer);
    expect(sim.marketInfoFor(viewer)!.page).toBe(1);
  });

  it("lists a stack from a seller's bags into escrow", () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 3, seller);
    sim.events.length = 0;

    sim.marketList('wolf_fang', 2, 100, seller);

    expect(errorsSince(sim)).toEqual([]);
    expect(sim.countItem('wolf_fang', seller)).toBe(1); // 2 escrowed
    const mine = sim.marketListings.filter((l) => l.sellerKey === marketSellerKey(seller));
    expect(mine.length).toBe(1);
    expect(mine[0]).toMatchObject({ itemId: 'wolf_fang', count: 2, price: 100, house: false });
    expect(Number.isFinite(mine[0].expiresAt)).toBe(true);
  });

  it('completes a sale: coin and goods move, seller keeps proceeds less the cut', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    const buyer = sim.addPlayer('mage', 'Buyer');
    standAtMerchant(sim, seller);
    standAtMerchant(sim, buyer);
    sim.addItem('wolf_fang', 2, seller);
    sim.players.get(buyer)!.copper = 1000;
    sim.marketList('wolf_fang', 2, 100, seller);
    const listing = sim.marketListings.find((l) => l.sellerKey === marketSellerKey(seller))!;
    sim.events.length = 0;

    sim.marketBuy(listing.id, buyer);

    expect(errorsSince(sim)).toEqual([]);
    expect(copperOf(sim, buyer)).toBe(900);
    expect(sim.countItem('wolf_fang', buyer)).toBe(2);
    expect(sim.marketListings.some((l) => l.id === listing.id)).toBe(false);
    // 5% cut: seller is owed 95, waiting to be collected
    const info = sim.marketInfoFor(seller)!;
    expect(info.collectionCopper).toBe(95);
  });

  it("collecting moves waiting gold into the seller's purse", () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    const buyer = sim.addPlayer('mage', 'Buyer');
    standAtMerchant(sim, seller);
    standAtMerchant(sim, buyer);
    sim.addItem('wolf_fang', 1, seller);
    sim.players.get(buyer)!.copper = 500;
    sim.marketList('wolf_fang', 1, 200, seller);
    sim.marketBuy(
      sim.marketListings.find((l) => l.sellerKey === marketSellerKey(seller))!.id,
      buyer,
    );
    expect(copperOf(sim, seller)).toBe(0);

    sim.marketCollect(seller);

    expect(copperOf(sim, seller)).toBe(190); // 200 - 5%
    expect(sim.marketInfoFor(seller)!.collectionCopper).toBe(0);
  });

  it('forbids buying your own listing, but lets you reclaim it', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 1, seller);
    sim.players.get(seller)!.copper = 10000;
    sim.marketList('wolf_fang', 1, 100, seller);
    const listing = sim.marketListings.find((l) => l.sellerKey === marketSellerKey(seller))!;
    sim.events.length = 0;

    sim.marketBuy(listing.id, seller);
    expect(errorsSince(sim).join(' ')).toMatch(/your own listing/i);
    expect(copperOf(sim, seller)).toBe(10000); // unchanged

    sim.marketCancel(listing.id, seller);
    expect(sim.countItem('wolf_fang', seller)).toBe(1); // back in bags
    expect(sim.marketListings.some((l) => l.id === listing.id)).toBe(false);
  });

  it('keeps listings owned by the same character after a rename', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 1, seller);
    sim.players.get(seller)!.copper = 10000;
    sim.marketList('wolf_fang', 1, 100, seller);
    const listing = sim.marketListings.find((l) => !l.house && l.itemId === 'wolf_fang')!;

    renameLiveCharacter(sim, seller, 'Renamed');

    const info = sim.marketInfoFor(seller)!;
    expect(info.myListingCount).toBe(1);
    expect(info.listings.find((l) => l.id === listing.id)?.mine).toBe(true);

    sim.events.length = 0;
    sim.marketBuy(listing.id, seller);
    expect(errorsSince(sim).join(' ')).toMatch(/your own listing/i);
    expect(copperOf(sim, seller)).toBe(10000);

    sim.marketCancel(listing.id, seller);
    expect(sim.countItem('wolf_fang', seller)).toBe(1);
  });

  it('keeps sale proceeds collectible by the same character after a rename', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    const buyer = sim.addPlayer('mage', 'Buyer');
    standAtMerchant(sim, seller);
    standAtMerchant(sim, buyer);
    sim.addItem('wolf_fang', 1, seller);
    sim.players.get(buyer)!.copper = 500;
    sim.marketList('wolf_fang', 1, 200, seller);
    const listing = sim.marketListings.find((l) => !l.house && l.itemId === 'wolf_fang')!;

    renameLiveCharacter(sim, seller, 'Renamed');
    sim.marketBuy(listing.id, buyer);
    expect(sim.marketInfoFor(seller)!.collectionCopper).toBe(190);

    sim.marketCollect(seller);

    expect(copperOf(sim, seller)).toBe(190);
    expect(sim.marketInfoFor(seller)!.collectionCopper).toBe(0);
  });

  it('rekeys legacy name-bound market state during a forced rename', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller', { characterId: 77 });
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 1, seller);
    sim.marketList('wolf_fang', 1, 200, seller);
    const listing = sim.marketListings.find((l) => !l.house && l.itemId === 'wolf_fang')!;
    listing.sellerKey = 'Seller';
    listing.sellerName = 'Seller';
    const internals = sim.market as unknown as {
      marketCollections: Map<string, { copper: number; items: [] }>;
    };
    internals.marketCollections.set('Seller', { copper: 95, items: [] });

    expect(sim.rekeyMarketSeller(77, 'Seller', 'Renamed')).toBe(true);
    renameLiveCharacter(sim, seller, 'Renamed');

    expect(listing).toMatchObject({ sellerKey: '77', sellerName: 'Renamed' });
    expect(sim.marketInfoFor(seller)!.myListingCount).toBe(1);
    expect(sim.marketInfoFor(seller)!.collectionCopper).toBe(95);
  });

  it('rejects a purchase the buyer cannot afford', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    const buyer = sim.addPlayer('mage', 'Buyer');
    standAtMerchant(sim, seller);
    standAtMerchant(sim, buyer);
    sim.addItem('wolf_fang', 1, seller);
    sim.players.get(buyer)!.copper = 50;
    sim.marketList('wolf_fang', 1, 100, seller);
    const listing = sim.marketListings.find((l) => l.sellerKey === marketSellerKey(seller))!;
    sim.events.length = 0;

    sim.marketBuy(listing.id, buyer);
    expect(errorsSince(sim).join(' ')).toMatch(/afford/i);
    expect(copperOf(sim, buyer)).toBe(50);
    expect(sim.marketListings.some((l) => l.id === listing.id)).toBe(true);
  });

  it('buying house stock never depletes it and pays no one', () => {
    const sim = makeWorld();
    const buyer = sim.addPlayer('mage', 'Buyer');
    standAtMerchant(sim, buyer);
    const house = sim.marketListings.find((l) => l.house)!;
    sim.players.get(buyer)!.copper = house.price + 1000;
    sim.marketBuy(house.id, buyer);
    // the listing is still on the board and the buyer received the goods
    expect(sim.marketListings.some((l) => l.id === house.id)).toBe(true);
    expect(sim.countItem(house.itemId, buyer)).toBeGreaterThanOrEqual(house.count);
    expect(copperOf(sim, buyer)).toBe(1000);
  });

  it("returns expired listings to the seller's collection", () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 1, seller);
    sim.marketList('wolf_fang', 1, 100, seller);
    const listing = sim.marketListings.find((l) => l.sellerKey === marketSellerKey(seller))!;
    listing.expiresAt = sim.time - 1; // force it past due
    for (let i = 0; i < 20; i++) sim.tick(); // updateMarket runs once a second

    expect(sim.marketListings.some((l) => l.id === listing.id)).toBe(false);
    const info = sim.marketInfoFor(seller)!;
    expect(info.collectionItems).toEqual([{ itemId: 'wolf_fang', count: 1 }]);
  });

  it('refuses to deal with anyone who is not standing at the Merchant', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    teleport(sim, seller, 200, 200);
    sim.addItem('wolf_fang', 1, seller);
    sim.events.length = 0;

    sim.marketList('wolf_fang', 1, 100, seller);
    expect(errorsSince(sim).join(' ')).toMatch(/Merchant/i);
    expect(sim.countItem('wolf_fang', seller)).toBe(1); // nothing escrowed
    expect(sim.marketListings.some((l) => l.sellerKey === marketSellerKey(seller))).toBe(false);
    expect(sim.marketInfoFor(seller)).toBeNull(); // not streamed when far
  });

  it('rejects a non-finite count without escrowing goods or listing them', () => {
    for (const badCount of [NaN, Infinity, -Infinity]) {
      const sim = makeWorld();
      const seller = sim.addPlayer('warrior', 'Seller');
      standAtMerchant(sim, seller);
      sim.addItem('wolf_fang', 3, seller);
      sim.events.length = 0;

      sim.marketList('wolf_fang', badCount, 100, seller);

      // an error is surfaced, nothing is escrowed, and no listing is created
      expect(errorsSince(sim).length).toBeGreaterThan(0);
      expect(sim.countItem('wolf_fang', seller)).toBe(3); // nothing removed
      expect(sim.marketListings.some((l) => l.sellerKey === marketSellerKey(seller))).toBe(false);
    }
  });

  it('will not broker quest items', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('boar_hide', 1, seller); // a quest item
    sim.events.length = 0;
    sim.marketList('boar_hide', 1, 100, seller);
    expect(errorsSince(sim).join(' ')).toMatch(/quest items/i);
    expect(sim.marketListings.some((l) => l.sellerKey === marketSellerKey(seller))).toBe(false);
  });

  it('will not broker items flagged as unsafe for the market', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('alien_armor_plate', 1, seller);
    sim.events.length = 0;

    sim.marketList('alien_armor_plate', 1, 100, seller);

    expect(errorsSince(sim).join(' ')).toMatch(/cannot be listed on the World Market/i);
    expect(sim.countItem('alien_armor_plate', seller)).toBe(1);
    expect(sim.marketListings.some((l) => l.sellerKey === marketSellerKey(seller))).toBe(false);
  });

  it('caps how many listings one seller may keep', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 20, seller);
    for (let i = 0; i < 12; i++) sim.marketList('wolf_fang', 1, 10, seller);
    expect(sim.marketInfoFor(seller)!.myListingCount).toBe(12);
    sim.events.length = 0;
    sim.marketList('wolf_fang', 1, 10, seller); // one too many
    expect(errorsSince(sim).join(' ')).toMatch(/at most/i);
    expect(sim.marketListings.filter((l) => l.sellerKey === marketSellerKey(seller)).length).toBe(
      12,
    );
  });

  it('survives a save/load round-trip (persistence)', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    const buyer = sim.addPlayer('mage', 'Buyer');
    standAtMerchant(sim, seller);
    standAtMerchant(sim, buyer);
    sim.addItem('wolf_fang', 3, seller);
    sim.players.get(buyer)!.copper = 1000;
    sim.marketList('wolf_fang', 1, 300, seller); // this one will sell -> collection gold
    sim.marketList('wolf_fang', 2, 150, seller); // this one stays listed
    sim.marketBuy(
      sim.marketListings.find((l) => l.sellerKey === marketSellerKey(seller) && l.count === 1)!.id,
      buyer,
    );

    const save = sim.serializeMarket();
    expect(save.listings.length).toBe(1); // only the unsold player listing (house excluded)
    expect(save.listings[0].secondsLeft).toBeGreaterThan(0);

    const sim2 = makeWorld();
    const houseBefore = sim2.marketListings.length;
    sim2.loadMarket(save);

    const loaded = sim2.marketListings.filter((l) => !l.house);
    expect(loaded.length).toBe(1);
    expect(loaded[0]).toMatchObject({
      sellerKey: marketSellerKey(seller),
      itemId: 'wolf_fang',
      count: 2,
      price: 150,
    });
    expect(Number.isFinite(loaded[0].expiresAt)).toBe(true);
    // house stock is reseeded, not duplicated from the save
    expect(sim2.marketListings.filter((l) => l.house).length).toBe(houseBefore);
    // the waiting sale proceeds came across too
    const col = (
      sim2.market as unknown as { marketCollections: Map<string, { copper: number }> }
    ).marketCollections.get(marketSellerKey(seller));
    expect(col?.copper).toBe(285); // 300 - 5%
    // new listings keep climbing past the loaded ids
    const seller2 = sim2.addPlayer('warrior', 'Seller');
    standAtMerchant(sim2, seller2);
    sim2.addItem('bone_fragments', 1, seller2);
    sim2.marketList('bone_fragments', 1, 50, seller2);
    const ids = sim2.marketListings.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length); // no id collisions
  });

  it('keeps listings and collection items whose item id is no longer known', () => {
    // A content edit (rename/retire/typo of an item id) must NOT vaporize every
    // in-flight copy of that item sitting on the market at the next restart.
    // The character load path keeps unknown ids verbatim as dormant data; the
    // market must do the same so a re-added or corrected id rehydrates later.
    const save = {
      listings: [
        {
          id: 7,
          sellerKey: '12',
          sellerName: 'Seller',
          itemId: 'retired_relic', // not in ITEMS
          count: 2,
          price: 300,
          secondsLeft: 600,
        },
      ],
      collections: [
        {
          key: '12',
          copper: 50,
          items: [
            { itemId: 'wolf_fang', count: 1 }, // still known
            { itemId: 'removed_widget', count: 3 }, // not in ITEMS
          ],
        },
      ],
      nextListingId: 8,
    };

    const sim = makeWorld();
    sim.loadMarket(save);

    // the unknown-id listing survived the load, escrowed goods intact
    const loaded = sim.marketListings.filter((l) => !l.house);
    expect(loaded.length).toBe(1);
    expect(loaded[0]).toMatchObject({ itemId: 'retired_relic', count: 2, price: 300 });

    // the unknown-id collection item survived alongside the known one, and it
    // round-trips back out so it is not lost on the next save either (asserted
    // via the public serialize path, since the collection map is Market-private)
    const out = sim.serializeMarket();
    expect(out.listings.find((l) => l.itemId === 'retired_relic')).toBeTruthy();
    expect(
      out.collections
        .find((c) => c.key === '12')
        ?.items.map((s) => s.itemId)
        .sort(),
    ).toEqual(['removed_widget', 'wolf_fang']);
  });

  it('always wires a seller their own listings even when the market overflows the wire cap', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);

    // The seller fills all 12 of their slots. Their item name ('wolf_fang')
    // sorts late in the alphabet on purpose.
    sim.addItem('wolf_fang', 12, seller);
    for (let i = 0; i < 12; i++) sim.marketList('wolf_fang', 1, 100 + i, seller);

    // Flood the shared market with 200 other-seller listings whose names sort
    // first, pushing the seller's own goods well past MARKET_WIRE_LIMIT (120).
    const internals = sim.market as unknown as {
      marketListings: Array<Record<string, unknown>>;
      nextListingId: number;
    };
    for (let i = 0; i < 200; i++) {
      internals.marketListings.push({
        id: internals.nextListingId++,
        sellerKey: `Other${i}`,
        sellerName: `Other${i}`,
        itemId: 'aaa_filler',
        count: 1,
        price: 50,
        expiresAt: sim.time + 1000,
        house: false,
      });
    }

    const info = sim.marketInfoFor(seller)!;
    // The "X / 12" slot count the SELL tab shows.
    expect(info.myListingCount).toBe(12);
    // Every one of the seller's own listings must be present in the wired set,
    // so the count never claims more than the player can actually see.
    const mineWired = info.listings.filter((l) => l.mine).length;
    expect(mineWired).toBe(info.myListingCount);
    // The wire cap is still respected overall.
    expect(info.listings.length).toBeLessThanOrEqual(120);
  });
});

describe('World Market: a now-soulbound listing is returned to the seller', () => {
  it('moves a soulbound listing off the book and into the seller collection on load', () => {
    const sim = makeWorld();
    const sellerKey = 'char:99';
    // A save from BEFORE heroic_mark became soulbound can still hold a listing of
    // it (the list-time gate only blocks NEW listings). loadMarket must not keep a
    // soulbound item on the market; it returns it to the seller's collection.
    const save = {
      listings: [
        {
          id: 1,
          sellerKey,
          sellerName: 'Ada',
          itemId: 'heroic_mark',
          count: 3,
          price: 100,
          secondsLeft: 1000,
        },
        {
          id: 2,
          sellerKey,
          sellerName: 'Ada',
          itemId: 'wolf_fang',
          count: 1,
          price: 50,
          secondsLeft: 1000,
        },
      ],
      collections: [],
      nextListingId: 3,
    };
    sim.market.loadMarket(save as never);

    const listed = sim.market.marketListings.filter((l) => !l.house).map((l) => l.itemId);
    expect(listed).not.toContain('heroic_mark'); // the soulbound listing is gone
    expect(listed).toContain('wolf_fang'); // a tradable listing stays

    const collections = (
      sim.market as unknown as {
        marketCollections: Map<string, { items: { itemId: string; count: number }[] }>;
      }
    ).marketCollections;
    const coll = collections.get(sellerKey);
    expect(coll?.items.some((s) => s.itemId === 'heroic_mark' && s.count === 3)).toBe(true);
  });
});
