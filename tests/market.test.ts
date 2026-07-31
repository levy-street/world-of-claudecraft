import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { MARKET_PLAYER_LISTING_ID_BASE } from '../src/sim/market_listing_ids';
import type { MarketQuery } from '../src/sim/market_query';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

type MarketInfo = NonNullable<ReturnType<Sim['marketInfoFor']>>;
type MarketListing = Sim['marketListings'][number];

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

// A full browse query with sensible defaults; tests vary only what they care about.
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

function entityOf(sim: Sim, pid: number): Entity {
  const entity = sim.entities.get(pid);
  if (!entity) throw new Error(`missing entity ${pid}`);
  return entity;
}

function playerOf(sim: Sim, pid: number) {
  const player = sim.players.get(pid);
  if (!player) throw new Error(`missing player ${pid}`);
  return player;
}

function marketInfo(sim: Sim, pid: number): MarketInfo {
  const info = sim.marketInfoFor(pid);
  if (!info) throw new Error(`missing market info for ${pid}`);
  return info;
}

function listingBy(
  sim: Sim,
  predicate: (listing: MarketListing) => boolean,
  label: string,
): MarketListing {
  const listing = sim.marketListings.find(predicate);
  if (!listing) throw new Error(`missing market listing: ${label}`);
  return listing;
}

// stand a player right on the Merchant so the proximity gate passes
function standAtMerchant(sim: Sim, pid: number) {
  const m = merchant(sim);
  const e = entityOf(sim, pid);
  e.pos.x = m.pos.x;
  e.pos.z = m.pos.z;
  e.pos.y = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = entityOf(sim, pid);
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function copperOf(sim: Sim, pid: number): number {
  return playerOf(sim, pid).copper;
}

function errorsSince(sim: Sim): string[] {
  return sim.events.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text);
}

function renameLiveCharacter(sim: Sim, pid: number, name: string) {
  playerOf(sim, pid).name = name;
  entityOf(sim, pid).name = name;
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

    const all = marketInfo(sim, seller);
    expect(all.filter).toBe('');
    expect(all.totalCount).toBe(all.listings.length);
    expect(all.listings.some((l) => l.itemId === 'wolf_fang')).toBe(true);
    expect(all.listings.some((l) => l.itemId === 'bone_fragments')).toBe(true);

    // A substring of the Wolf Fang name must hide every non-matching listing.
    sim.marketSearch(q('wolf'), seller);
    const filtered = marketInfo(sim, seller);
    expect(filtered.filter).toBe('wolf');
    expect(filtered.listings.length).toBeGreaterThan(0);
    expect(filtered.listings.every((l) => l.itemId === 'wolf_fang')).toBe(true);
    expect(filtered.totalCount).toBe(filtered.listings.length);

    // A no-match query yields an empty list (the UI shows the "no matches" copy).
    sim.marketSearch(q('zzzznomatch'), seller);
    expect(sim.marketInfoFor(seller)?.listings.length).toBe(0);

    // Clearing the filter restores the full, unfiltered view.
    sim.marketSearch(q(''), seller);
    expect(sim.marketInfoFor(seller)?.totalCount).toBe(all.totalCount);
  });

  // Issue #2416: the browse query echo. Before this fix, MarketInfo only echoed the
  // search text (`filter`); the client had no wire signal telling it whether the
  // type/subtype/armor-class/primary-stat/rarity filters it was showing still
  // matched what the server actually applied, so a fresh join silently desynced
  // them (see the reconnect test below).
  it('echoes every active filter axis on marketInfoFor, not just the search text', () => {
    const sim = makeWorld();
    const viewer = sim.addPlayer('warrior', 'Viewer');
    standAtMerchant(sim, viewer);

    sim.marketSearch(
      q('robe', {
        itemType: 'armor',
        subtype: 'chest',
        armorClass: 'cloth',
        primaryStat: 'int',
        rarity: 'rare',
      }),
      viewer,
    );

    const info = marketInfo(sim, viewer);
    expect(info.filter).toBe('robe');
    expect(info.itemType).toBe('armor');
    expect(info.subtype).toBe('chest');
    expect(info.armorClass).toBe('cloth');
    expect(info.primaryStat).toBe('int');
    expect(info.rarity).toBe('rare');
  });

  // Issue #2416: a fresh join (the server's linkdead grace expired before the socket
  // came back) never resumes the old session; it hands the reconnecting character a
  // brand-new PlayerMeta, whose marketQuery starts at defaultMarketQuery() same as any
  // new session. The echoed query on the next marketInfoFor is the ONLY signal a
  // reconnecting client has to notice its filter buttons no longer describe what the
  // server is actually browsing by.
  it('echoes the reset-to-default query after a fresh join, same as any new session', () => {
    const sim = makeWorld();
    const staleSession = sim.addPlayer('warrior', 'Viewer');
    standAtMerchant(sim, staleSession);
    sim.marketSearch(
      q('', { itemType: 'weapon', subtype: 'axe', primaryStat: 'str' }),
      staleSession,
    );
    expect(marketInfo(sim, staleSession).itemType).toBe('weapon');

    // The old session tears down (grace expired) and the reconnect lands as a fresh
    // join: a brand-new pid/meta for the same character, not a resume of the old one.
    sim.removePlayer(staleSession);
    const freshSession = sim.addPlayer('warrior', 'Viewer');
    standAtMerchant(sim, freshSession);

    const info = marketInfo(sim, freshSession);
    expect(info.itemType).toBe('all');
    expect(info.subtype).toBe('all');
    expect(info.armorClass).toBe('all');
    expect(info.primaryStat).toBe('all');
    expect(info.rarity).toBe('all');
  });

  it('applies armor class and dominant primary stat to the authoritative browse result', () => {
    const sim = makeWorld();
    const viewer = sim.addPlayer('warrior', 'Viewer');
    standAtMerchant(sim, viewer);
    const book = sim.market.marketListings;
    book.length = 0;
    for (const [id, itemId] of [
      [1, 'eastbrook_warded_leggings'],
      [2, 'sootscale_mantle'],
      [3, 'drowned_prayer_leggings'],
      [4, 'ironlink_legguards'],
    ] as const) {
      book.push({
        id,
        sellerKey: 'house',
        sellerName: 'Merchant',
        itemId,
        count: 1,
        price: 100,
        expiresAt: Number.POSITIVE_INFINITY,
        house: true,
      });
    }

    sim.marketSearch(
      q('', {
        itemType: 'armor',
        subtype: 'legs',
        armorClass: 'mail',
        primaryStat: 'int',
      }),
      viewer,
    );

    expect(sim.marketInfoFor(viewer)?.listings.map((listing) => listing.itemId)).toEqual([
      'eastbrook_warded_leggings',
    ]);
  });

  // Issue #2189: the authoritative browse is the path a real player hits, so the bag
  // category is pinned here too, not only against the pure predicate.
  it('applies the bag category and its capacity subtype to the authoritative browse result', () => {
    const sim = makeWorld();
    const viewer = sim.addPlayer('warrior', 'Viewer');
    standAtMerchant(sim, viewer);
    const book = sim.market.marketListings;
    book.length = 0;
    for (const [id, itemId] of [
      [1, 'linen_pouch'],
      [2, 'gravewoven_bag'],
      [3, 'bone_fragments'],
      [4, 'recruit_tunic'],
    ] as const) {
      book.push({
        id,
        sellerKey: 'house',
        sellerName: 'Merchant',
        itemId,
        count: 1,
        price: 100,
        expiresAt: Number.POSITIVE_INFINITY,
        house: true,
      });
    }

    // The browse sorts by display name, so "Gravewoven Bag" leads "Linen Pouch".
    sim.marketSearch(q('', { itemType: 'bag' }), viewer);
    expect(sim.marketInfoFor(viewer)?.listings.map((listing) => listing.itemId)).toEqual([
      'gravewoven_bag',
      'linen_pouch',
    ]);

    // gravewoven_bag is the 12-slot bag; the 6-slot Linen Pouch must drop out.
    sim.marketSearch(q('', { itemType: 'bag', subtype: '12' }), viewer);
    expect(sim.marketInfoFor(viewer)?.listings.map((listing) => listing.itemId)).toEqual([
      'gravewoven_bag',
    ]);
  });

  it('keeps the Merchant standing stock stocked with the vendor bags', () => {
    const sim = makeWorld();
    const viewer = sim.addPlayer('warrior', 'Viewer');
    standAtMerchant(sim, viewer);
    // A fresh world must not answer the new Bags category with an empty list.
    sim.marketSearch(q('', { itemType: 'bag' }), viewer);
    const listings = sim.marketInfoFor(viewer)?.listings ?? [];
    expect(listings.map((listing) => listing.itemId)).toEqual([
      'linen_pouch',
      'travelers_knapsack',
    ]);
    // At the vendor price, not an invented one: a house row cheaper than buyValue would
    // undercut the vendor selling the same bag, and house rows never deplete.
    expect(listings.map((listing) => listing.price)).toEqual([
      ITEMS.linen_pouch?.buyValue,
      ITEMS.travelers_knapsack?.buyValue,
    ]);
    expect(ITEMS.linen_pouch?.buyValue).toBeGreaterThan(0);
  });

  // House ids come off one counter in stock-array order, house rows are reseeded every
  // boot and never persisted, and market_buy carries only the listing id. So a row added
  // anywhere but the END renumbers every row after it, and a client holding a browse list
  // across a server restart could click Buy on an id that now means a different item.
  // This pins the two new bags as the LAST house rows, which is what makes that safe.
  it('appends new standing stock so existing house listing ids keep their goods', () => {
    const sim = makeWorld();
    const house = sim.market.marketListings.filter((listing) => listing.house);
    const bagIds = house
      .filter(
        (listing) => listing.itemId === 'linen_pouch' || listing.itemId === 'travelers_knapsack',
      )
      .map((listing) => listing.id);
    expect(bagIds).toHaveLength(2);
    // Non-vacuity: there is a substantial block of older stock they must sit behind.
    expect(house.length).toBeGreaterThan(10);
    const olderIds = house.filter((listing) => !bagIds.includes(listing.id)).map((l) => l.id);
    expect(Math.min(...bagIds)).toBeGreaterThan(Math.max(...olderIds));
    // And the whole block stays collision-free, which is what buy/cancel resolve on.
    const ids = house.map((listing) => listing.id);
    expect(new Set(ids).size).toBe(ids.length);
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

    const p0 = marketInfo(sim, viewer);
    expect(p0.page).toBe(0);
    expect(p0.pageCount).toBe(2); // 60 others / 50 per page
    expect(p0.totalCount).toBe(61); // 60 others + 1 own (the full match count)
    const othersP0 = p0.listings.filter((l) => !l.mine);
    expect(othersP0).toHaveLength(50);
    expect(othersP0[0].price).toBe(100); // sorted by price within the same item name
    expect(p0.listings.some((l) => l.mine && l.itemId === 'wolf_fang')).toBe(true);

    // Page 1: the viewer own listing still rides on top; only the last 10 others remain.
    sim.marketSearch(q('', { page: 1 }), viewer);
    const p1 = marketInfo(sim, viewer);
    expect(p1.page).toBe(1);
    expect(p1.listings.filter((l) => !l.mine)).toHaveLength(10);
    expect(p1.listings.some((l) => l.mine && l.itemId === 'wolf_fang')).toBe(true);

    // An out-of-range page clamps to the last page.
    sim.marketSearch(q('', { page: 99 }), viewer);
    expect(sim.marketInfoFor(viewer)?.page).toBe(1);
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
    playerOf(sim, buyer).copper = 1000;
    sim.marketList('wolf_fang', 2, 100, seller);
    const listing = listingBy(
      sim,
      (l) => l.sellerKey === marketSellerKey(seller),
      'seller listing',
    );
    sim.events.length = 0;

    sim.marketBuy(listing.id, buyer);

    expect(errorsSince(sim)).toEqual([]);
    expect(copperOf(sim, buyer)).toBe(900);
    expect(sim.countItem('wolf_fang', buyer)).toBe(2);
    expect(sim.marketListings.some((l) => l.id === listing.id)).toBe(false);
    // 5% cut: seller is owed 95, waiting to be collected
    const info = marketInfo(sim, seller);
    expect(info.collectionCopper).toBe(95);
  });

  it("collecting moves waiting gold into the seller's purse", () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    const buyer = sim.addPlayer('mage', 'Buyer');
    standAtMerchant(sim, seller);
    standAtMerchant(sim, buyer);
    sim.addItem('wolf_fang', 1, seller);
    playerOf(sim, buyer).copper = 500;
    sim.marketList('wolf_fang', 1, 200, seller);
    sim.marketBuy(
      listingBy(sim, (l) => l.sellerKey === marketSellerKey(seller), 'seller listing').id,
      buyer,
    );
    expect(copperOf(sim, seller)).toBe(0);

    sim.marketCollect(seller);

    expect(copperOf(sim, seller)).toBe(190); // 200 - 5%
    expect(sim.marketInfoFor(seller)?.collectionCopper).toBe(0);
  });

  it('forbids buying your own listing, but lets you reclaim it', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 1, seller);
    playerOf(sim, seller).copper = 10000;
    sim.marketList('wolf_fang', 1, 100, seller);
    const listing = listingBy(
      sim,
      (l) => l.sellerKey === marketSellerKey(seller),
      'seller listing',
    );
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
    playerOf(sim, seller).copper = 10000;
    sim.marketList('wolf_fang', 1, 100, seller);
    const listing = listingBy(
      sim,
      (l) => !l.house && l.itemId === 'wolf_fang',
      'wolf fang listing',
    );

    renameLiveCharacter(sim, seller, 'Renamed');

    const info = marketInfo(sim, seller);
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
    playerOf(sim, buyer).copper = 500;
    sim.marketList('wolf_fang', 1, 200, seller);
    const listing = listingBy(
      sim,
      (l) => !l.house && l.itemId === 'wolf_fang',
      'wolf fang listing',
    );

    renameLiveCharacter(sim, seller, 'Renamed');
    sim.marketBuy(listing.id, buyer);
    expect(sim.marketInfoFor(seller)?.collectionCopper).toBe(190);

    sim.marketCollect(seller);

    expect(copperOf(sim, seller)).toBe(190);
    expect(sim.marketInfoFor(seller)?.collectionCopper).toBe(0);
  });

  it('rekeys legacy name-bound market state during a forced rename', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller', { characterId: 77 });
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 1, seller);
    sim.marketList('wolf_fang', 1, 200, seller);
    const listing = listingBy(
      sim,
      (l) => !l.house && l.itemId === 'wolf_fang',
      'wolf fang listing',
    );
    listing.sellerKey = 'Seller';
    listing.sellerName = 'Seller';
    const internals = sim.market as unknown as {
      marketCollections: Map<string, { copper: number; items: [] }>;
    };
    internals.marketCollections.set('Seller', { copper: 95, items: [] });

    expect(sim.rekeyMarketSeller(77, 'Seller', 'Renamed')).toBe(true);
    renameLiveCharacter(sim, seller, 'Renamed');

    expect(listing).toMatchObject({ sellerKey: '77', sellerName: 'Renamed' });
    expect(sim.marketInfoFor(seller)?.myListingCount).toBe(1);
    expect(sim.marketInfoFor(seller)?.collectionCopper).toBe(95);
  });

  it('rejects a purchase the buyer cannot afford', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    const buyer = sim.addPlayer('mage', 'Buyer');
    standAtMerchant(sim, seller);
    standAtMerchant(sim, buyer);
    sim.addItem('wolf_fang', 1, seller);
    playerOf(sim, buyer).copper = 50;
    sim.marketList('wolf_fang', 1, 100, seller);
    const listing = listingBy(
      sim,
      (l) => l.sellerKey === marketSellerKey(seller),
      'seller listing',
    );
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
    const house = listingBy(sim, (l) => l.house, 'house listing');
    playerOf(sim, buyer).copper = house.price + 1000;
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
    const listing = listingBy(
      sim,
      (l) => l.sellerKey === marketSellerKey(seller),
      'seller listing',
    );
    listing.expiresAt = sim.time - 1; // force it past due
    for (let i = 0; i < 20; i++) sim.tick(); // updateMarket runs once a second

    expect(sim.marketListings.some((l) => l.id === listing.id)).toBe(false);
    const info = marketInfo(sim, seller);
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
    expect(sim.marketInfoFor(seller)?.myListingCount).toBe(12);
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
    playerOf(sim, buyer).copper = 1000;
    sim.marketList('wolf_fang', 1, 300, seller); // this one will sell -> collection gold
    sim.marketList('wolf_fang', 2, 150, seller); // this one stays listed
    sim.marketBuy(
      listingBy(
        sim,
        (l) => l.sellerKey === marketSellerKey(seller) && l.count === 1,
        'single-count seller listing',
      ).id,
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

  // ---------------------------------------------------------------------------
  // Listing-id bands (#2463). House stock is reseeded from the id counter every
  // boot and is never persisted; player listings are replayed from the save with
  // the ids an OLDER build issued them. Growing the stock table therefore used to
  // reissue ids the save still held, and the duplicate resolved to the house row.
  // ---------------------------------------------------------------------------

  it('reserves the low id band for house stock so growing it cannot reach player ids', () => {
    const sim = makeWorld();
    const house = sim.marketListings.filter((l) => l.house);
    expect(house.length).toBeGreaterThan(0);
    // every seeded row sits below the base, with room for the table to grow
    expect(Math.max(...house.map((l) => l.id))).toBeLessThan(MARKET_PLAYER_LISTING_ID_BASE);
    // and the room is real, not one row's worth: the stock table can grow to ten
    // times its current size and still not reach the player band. "Below the
    // base" alone would hold just as well with a base of house.length + 1, which
    // is the state #2463 was filed about.
    expect(house.length * 10).toBeLessThan(MARKET_PLAYER_LISTING_ID_BASE);

    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 2, seller);
    sim.marketList('wolf_fang', 1, 100, seller);
    sim.marketList('wolf_fang', 1, 120, seller);

    const mine = sim.marketListings.filter((l) => !l.house);
    expect(mine.length).toBe(2);
    expect(mine.every((l) => l.id >= MARKET_PLAYER_LISTING_ID_BASE)).toBe(true);
  });

  it('replays a healthy save with its listing ids untouched and resumes past it', () => {
    const sim = makeWorld();
    const row = (id: number) => ({
      id,
      sellerKey: 'legacy',
      sellerName: 'Legacy',
      itemId: 'wolf_fang',
      count: 1,
      price: 100,
      secondsLeft: 600,
    });
    // Off-sequence ids, the shape a live save takes once sales and expiries have
    // punched holes in it. They matter: an id the counter would have handed out
    // anyway cannot tell "kept verbatim" apart from "renumbered off the counter".
    sim.loadMarket({ listings: [row(1000), row(1007)], collections: [], nextListingId: 1008 });

    // no gratuitous renumbering: only a real collision reissues an id
    expect(sim.marketListings.filter((l) => !l.house).map((l) => l.id)).toEqual([1000, 1007]);

    // and the counter resumed past the whole save, so the next listing cannot reuse one
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 1, seller);
    sim.marketList('wolf_fang', 1, 50, seller);
    const fresh = listingBy(sim, (l) => l.sellerKey === marketSellerKey(seller), 'seller listing');
    expect(fresh.id).toBeGreaterThanOrEqual(1008);
    const ids = sim.marketListings.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reissues a persisted listing id the reseeded house band has taken', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    const buyer = sim.addPlayer('mage', 'Buyer');
    standAtMerchant(sim, seller);
    standAtMerchant(sim, buyer);
    playerOf(sim, buyer).copper = 1000;

    // A save written by a build whose stock table was smaller: this id was a
    // real player listing then and names a house row now.
    const houseIds = sim.marketListings.filter((l) => l.house).map((l) => l.id);
    const collidingId = houseIds[houseIds.length - 1];
    sim.loadMarket({
      listings: [
        {
          id: collidingId,
          sellerKey: marketSellerKey(seller),
          sellerName: 'Seller',
          itemId: 'wolf_fang',
          count: 2,
          price: 300,
          secondsLeft: 600,
        },
      ],
      collections: [],
      nextListingId: collidingId + 1,
    });

    const ids = sim.marketListings.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length); // one row per id
    const mine = listingBy(
      sim,
      (l) => !l.house && l.sellerKey === marketSellerKey(seller),
      'seller listing',
    );
    expect(mine.id).not.toBe(collidingId);
    expect(mine.id).toBeGreaterThanOrEqual(MARKET_PLAYER_LISTING_ID_BASE);
    // the id-resolving call sites now land on the PLAYER row, not a house row
    expect(sim.marketListings[sim.marketListings.findIndex((l) => l.id === mine.id)].house).toBe(
      false,
    );
    // and the house row that owns the old id is untouched
    expect(sim.marketListings.filter((l) => l.house).length).toBe(houseIds.length);
    expect(sim.marketListings.find((l) => l.id === collidingId)?.house).toBe(true);

    // buying the player row hands over the player's goods, consumes the row, and
    // pays the seller (the house arm paid no one and never depleted)
    sim.marketBuy(mine.id, buyer);
    expect(sim.countItem('wolf_fang', buyer)).toBe(2);
    expect(copperOf(sim, buyer)).toBe(700);
    expect(sim.marketListings.some((l) => l.id === mine.id)).toBe(false);
    expect(sim.marketInfoFor(seller)?.collectionCopper).toBe(285); // 300 - 5%
  });

  it('lets the owner reclaim a listing whose saved id the house band had taken', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);

    const houseIds = sim.marketListings.filter((l) => l.house).map((l) => l.id);
    const collidingId = houseIds[houseIds.length - 1];
    sim.loadMarket({
      listings: [
        {
          id: collidingId,
          sellerKey: marketSellerKey(seller),
          sellerName: 'Seller',
          itemId: 'wolf_fang',
          count: 2,
          price: 300,
          secondsLeft: 600,
        },
      ],
      collections: [],
      nextListingId: collidingId + 1,
    });

    const mine = listingBy(
      sim,
      (l) => !l.house && l.sellerKey === marketSellerKey(seller),
      'seller listing',
    );
    expect(sim.marketInfoFor(seller)?.myListingCount).toBe(1);
    sim.events.length = 0;

    sim.marketCancel(mine.id, seller);

    expect(errorsSince(sim)).toEqual([]); // no "That is not your listing"
    expect(sim.countItem('wolf_fang', seller)).toBe(2); // escrow came back
    expect(sim.marketListings.some((l) => l.id === mine.id)).toBe(false);
    expect(sim.marketListings.filter((l) => l.house).length).toBe(houseIds.length);
  });

  it('burns no listing ids on save rows it cannot replay at all', () => {
    // A row with no usable item id is dropped, so it must not consume a planned
    // id on the way out: the id plan has to describe what actually lands in the
    // book, or the boot log reports reissues for rows nobody ever sees and the
    // counter skips ids for no reason.
    const sim = makeWorld();
    const before = sim.serializeMarket().nextListingId;
    sim.loadMarket({
      listings: [
        // malformed id AND no item id: unusable on both counts
        { id: Number.NaN, sellerKey: '12', sellerName: 'Seller', count: 1, price: 10 },
        null,
      ],
      collections: [],
      nextListingId: 1,
    } as never);

    expect(sim.marketListings.filter((l) => !l.house).length).toBe(0);
    expect(sim.serializeMarket().nextListingId).toBe(before);
  });

  it('keeps listings and collection items whose item id is no longer known', () => {
    // A content edit (rename/retire/typo of an item id) must NOT vaporize every
    // in-flight copy of that item sitting on the market at the next restart.
    // The character load path keeps unknown ids verbatim as dormant data; the
    // market must do the same so a re-added or corrected id rehydrates later.
    const save = {
      listings: [
        {
          // A player-band id, so this case stays about the unknown ITEM id: an
          // id inside the reseeded house band would also be reissued by the
          // #2463 repair, which is a different test's charter.
          id: 1007,
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
      nextListingId: 1008,
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

    const info = marketInfo(sim, seller);
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
    // Player-band ids (>= MARKET_PLAYER_LISTING_ID_BASE): ids inside the
    // reseeded house band would be reissued by the #2463 repair, which would
    // leave this case quietly testing the reclaim over a renumbered book.
    const save = {
      listings: [
        {
          id: 1001,
          sellerKey,
          sellerName: 'Ada',
          itemId: 'heroic_mark',
          count: 3,
          price: 100,
          secondsLeft: 1000,
        },
        {
          id: 1002,
          sellerKey,
          sellerName: 'Ada',
          itemId: 'wolf_fang',
          count: 1,
          price: 50,
          secondsLeft: 1000,
        },
      ],
      collections: [],
      nextListingId: 1003,
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

// The always-streamed HUD indicator bit (the mailUnread pattern): true while
// ANY collection (sale gold or returned items) waits at the Merchant, with no
// proximity gate, so the minimap badge can light anywhere in the world.
describe('marketCollectPendingFor - the collect-indicator bit', () => {
  it('flips true when a sale credits the collection and false after collecting', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    const buyer = sim.addPlayer('mage', 'Buyer');
    standAtMerchant(sim, seller);
    standAtMerchant(sim, buyer);
    sim.addItem('wolf_fang', 1, seller);
    playerOf(sim, buyer).copper = 500;
    expect(sim.marketCollectPendingFor(seller)).toBe(false); // fresh seller: nothing waits

    sim.marketList('wolf_fang', 1, 200, seller);
    expect(sim.marketCollectPendingFor(seller)).toBe(false); // listed but unsold: still nothing

    sim.marketBuy(
      listingBy(sim, (l) => l.sellerKey === marketSellerKey(seller), 'seller listing').id,
      buyer,
    );
    expect(sim.marketCollectPendingFor(seller)).toBe(true);

    // no proximity gate: the bit stays readable far from the Merchant
    teleport(sim, seller, 200, 200);
    expect(sim.marketCollectPendingFor(seller)).toBe(true);

    standAtMerchant(sim, seller);
    sim.marketCollect(seller);
    expect(sim.marketCollectPendingFor(seller)).toBe(false);
  });

  it('an item-only collection (expired listing returned) also reads pending', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 1, seller);
    sim.marketList('wolf_fang', 1, 100, seller);
    expect(sim.marketCollectPendingFor(seller)).toBe(false);
    const listing = listingBy(
      sim,
      (l) => l.sellerKey === marketSellerKey(seller),
      'seller listing',
    );
    listing.expiresAt = sim.time - 1; // force it past due
    for (let i = 0; i < 20; i++) sim.tick(); // updateMarket runs once a second

    expect(sim.marketInfoFor(seller)?.collectionCopper).toBe(0);
    expect(sim.marketCollectPendingFor(seller)).toBe(true);
  });

  it('the marketCollectPending getter mirrors the primary player', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    expect(sim.marketCollectPending).toBe(false);
    const internals = sim.market as unknown as {
      marketCollections: Map<
        string,
        { copper: number; items: { itemId: string; count: number }[] }
      >;
    };
    internals.marketCollections.set(String(sim.playerId), { copper: 95, items: [] });
    expect(sim.marketCollectPending).toBe(true);
  });
});
