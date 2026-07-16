// Auction lots on the World Market: whole-lot bid sales with an optional buyout,
// escrowed bids, outbid refunds through the collection box, expiry settlement to
// the winner, and Merchant letters for offline parties. Real Sim instances (the
// market.test.ts fixture pattern); zero rng, integer copper throughout.
import { describe, expect, it, vi } from 'vitest';
import { AUCTION_LETTERS } from '../src/sim/content/letters';
import { marketMinNextBid } from '../src/sim/market';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function merchant(sim: Sim): Entity {
  for (const e of sim.entities.values()) if (e.templateId === 'the_merchant') return e;
  throw new Error('the Merchant was not spawned');
}

function standAtMerchant(sim: Sim, pid: number) {
  const m = merchant(sim);
  const e = sim.entities.get(pid)!;
  e.pos.x = m.pos.x;
  e.pos.z = m.pos.z;
  e.pos.y = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function copperOf(sim: Sim, pid: number): number {
  return sim.players.get(pid)!.copper;
}

function errorsSince(sim: Sim): string[] {
  return sim.events.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text);
}

function eventsOf<T extends SimEvent['type']>(sim: Sim, type: T) {
  return sim.events.filter((e) => e.type === type) as Extract<SimEvent, { type: T }>[];
}

function marketSellerKey(pid: number): string {
  return String(pid);
}

function collectionCopper(sim: Sim, key: string): number {
  const map = (sim.market as unknown as { marketCollections: Map<string, { copper: number }> })
    .marketCollections;
  return map.get(key)?.copper ?? 0;
}

// Stand a seller at the Merchant with `count` wolf fangs (sellValue 4 -> deposit
// 0, so auction copper flows stay exact) and post an auction lot.
function postAuction(
  sim: Sim,
  opts: { count?: number; startingBid?: number; buyoutPrice?: number } = {},
): { seller: number; listingId: number } {
  const seller = sim.addPlayer('warrior', 'Seller');
  standAtMerchant(sim, seller);
  const count = opts.count ?? 2;
  sim.addItem('wolf_fang', count, seller);
  sim.marketList('wolf_fang', count, 0, seller, {
    auction: { startingBid: opts.startingBid ?? 100, buyoutPrice: opts.buyoutPrice },
  });
  const listing = sim.marketListings.find((l) => l.sellerKey === marketSellerKey(seller));
  if (!listing) throw new Error('auction lot was not created');
  return { seller, listingId: listing.id };
}

function addBidder(sim: Sim, name: string, copper: number): number {
  const pid = sim.addPlayer('mage', name);
  standAtMerchant(sim, pid);
  sim.players.get(pid)!.copper = copper;
  return pid;
}

describe('World Market auctions: listing', () => {
  it('posts a whole-lot auction with startingBid/buyout and emits the Posted line', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 2, seller);
    sim.events.length = 0;

    sim.marketList('wolf_fang', 2, 0, seller, {
      auction: { startingBid: 100, buyoutPrice: 500 },
      durationHours: 24,
    });

    expect(errorsSince(sim)).toEqual([]);
    const l = sim.marketListings.find((x) => x.sellerKey === marketSellerKey(seller))!;
    expect(l).toMatchObject({
      kind: 'auction',
      count: 2,
      startingBid: 100,
      buyoutPrice: 500,
      price: 100, // the starting bid doubles as the sort/readout price
      durationSeconds: 24 * 3600,
    });
    expect(l.pricePerUnit).toBeUndefined(); // auctions are whole-lot
    expect(l.bid).toBeUndefined();
    const loots = eventsOf(sim, 'loot').map((e) => e.text);
    expect(loots).toContain('Posted Cracked Wolf Fang x2 for auction (starting bid 1s).');
  });

  it('refuses a starting bid under 1 copper', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 1, seller);
    sim.events.length = 0;

    sim.marketList('wolf_fang', 1, 0, seller, { auction: { startingBid: 0 } });

    expect(errorsSince(sim)).toEqual(['Name a starting bid of at least 1 copper.']);
    expect(sim.countItem('wolf_fang', seller)).toBe(1);
  });

  it('refuses a buyout that does not beat the starting bid', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 1, seller);
    sim.events.length = 0;

    sim.marketList('wolf_fang', 1, 0, seller, { auction: { startingBid: 100, buyoutPrice: 100 } });

    expect(errorsSince(sim)).toEqual(['The buyout must beat the starting bid.']);
    expect(sim.countItem('wolf_fang', seller)).toBe(1);
  });
});

describe('World Market auctions: bidding', () => {
  it('escrows the full bid, records the bidder, and confirms with the Bid placed line', () => {
    const sim = makeWorld();
    const { listingId } = postAuction(sim, { startingBid: 100 });
    const bidder = addBidder(sim, 'Bidder', 1000);
    sim.events.length = 0;

    sim.marketBid(listingId, 120, bidder);

    expect(errorsSince(sim)).toEqual([]);
    expect(copperOf(sim, bidder)).toBe(880); // full escrow, immediately
    const l = sim.marketListings.find((x) => x.id === listingId)!;
    expect(l.bid).toEqual({
      amount: 120,
      bidderKey: marketSellerKey(bidder),
      bidderName: 'Bidder',
    });
    const loots = eventsOf(sim, 'loot').map((e) => e.text);
    expect(loots).toContain('Bid placed: 1s 20c on Cracked Wolf Fang.');
  });

  it('walks the minNextBid ladder: startingBid first, then a 5% (min 1c) raise', () => {
    const sim = makeWorld();
    const { listingId } = postAuction(sim, { startingBid: 100 });
    const a = addBidder(sim, 'Alpha', 1000);
    const b = addBidder(sim, 'Beta', 1000);
    const listing = () => sim.marketListings.find((x) => x.id === listingId)!;

    expect(marketMinNextBid(listing())).toBe(100);
    sim.events.length = 0;
    sim.marketBid(listingId, 99, a); // under the opening ask
    expect(errorsSince(sim)).toEqual(['Bid at least 1s.']);

    sim.marketBid(listingId, 100, a);
    expect(marketMinNextBid(listing())).toBe(105); // 100 + max(1, floor(5))

    sim.events.length = 0;
    sim.marketBid(listingId, 104, b);
    expect(errorsSince(sim)).toEqual(['Bid at least 1s 5c.']);
    sim.marketBid(listingId, 105, b);
    expect(listing().bid?.amount).toBe(105);

    // small-bid ladder: the raise never rounds down to zero
    const sim2 = makeWorld();
    const p2 = postAuction(sim2, { startingBid: 5 });
    const c = addBidder(sim2, 'Gamma', 100);
    sim2.marketBid(p2.listingId, 5, c);
    expect(marketMinNextBid(sim2.marketListings.find((x) => x.id === p2.listingId)!)).toBe(6);
  });

  it('refunds the outbid escrow to the collection box and emits marketOutbid online', () => {
    const sim = makeWorld();
    const { listingId } = postAuction(sim, { startingBid: 100 });
    const a = addBidder(sim, 'Alpha', 1000);
    const b = addBidder(sim, 'Beta', 1000);
    sim.marketBid(listingId, 100, a);
    sim.events.length = 0;

    sim.marketBid(listingId, 110, b);

    expect(errorsSince(sim)).toEqual([]);
    expect(copperOf(sim, a)).toBe(900); // the purse is NOT topped up directly
    expect(collectionCopper(sim, marketSellerKey(a))).toBe(100); // refund waits at the Merchant
    expect(copperOf(sim, b)).toBe(890);
    const outbid = eventsOf(sim, 'marketOutbid');
    expect(outbid).toHaveLength(1);
    expect(outbid[0]).toMatchObject({
      listingId,
      itemId: 'wolf_fang',
      refund: 100,
      pid: a,
    });
  });

  it('refuses the seller, the standing high bidder, non-auction lots, and short purses', () => {
    const sim = makeWorld();
    const { seller, listingId } = postAuction(sim, { startingBid: 100 });
    const bidder = addBidder(sim, 'Bidder', 1000);
    sim.players.get(seller)!.copper = 1000;

    sim.events.length = 0;
    sim.marketBid(listingId, 100, seller);
    expect(errorsSince(sim)).toEqual(['You cannot bid on your own lot.']);

    sim.marketBid(listingId, 100, bidder);
    sim.events.length = 0;
    sim.marketBid(listingId, 200, bidder);
    expect(errorsSince(sim)).toEqual(['You are already the high bidder.']);

    const poor = addBidder(sim, 'Poor', 10);
    sim.events.length = 0;
    sim.marketBid(listingId, 105, poor);
    expect(errorsSince(sim)).toEqual(['You cannot afford that.']);
    expect(copperOf(sim, poor)).toBe(10);

    // a fixed listing takes no bids
    const house = sim.marketListings.find((l) => l.house)!;
    sim.events.length = 0;
    sim.marketBid(house.id, 99999, bidder);
    expect(errorsSince(sim)).toEqual(['That lot is not up for auction.']);
  });
});

describe('World Market auctions: buyout', () => {
  it('refuses a direct buy of a bid-only lot', () => {
    const sim = makeWorld();
    const { listingId } = postAuction(sim, { startingBid: 100 }); // no buyout
    const buyer = addBidder(sim, 'Buyer', 1000);
    sim.events.length = 0;

    sim.marketBuy(listingId, undefined, buyer);

    expect(errorsSince(sim)).toEqual(['That lot takes bids only.']);
    expect(copperOf(sim, buyer)).toBe(1000);
    expect(sim.marketListings.some((l) => l.id === listingId)).toBe(true);
  });

  it('settles a direct buyout: whole lot, cut + deposit-free proceeds, standing bid refunded', () => {
    const sim = makeWorld();
    const { seller, listingId } = postAuction(sim, {
      count: 2,
      startingBid: 100,
      buyoutPrice: 400,
    });
    const bidder = addBidder(sim, 'Bidder', 1000);
    const buyer = addBidder(sim, 'Buyer', 1000);
    sim.marketBid(listingId, 100, bidder);
    sim.events.length = 0;

    sim.marketBuy(listingId, undefined, buyer);

    expect(errorsSince(sim)).toEqual([]);
    expect(copperOf(sim, buyer)).toBe(600);
    expect(sim.countItem('wolf_fang', buyer)).toBe(2);
    expect(sim.marketListings.some((l) => l.id === listingId)).toBe(false);
    // the outbid escrow went to the bidder's box, with the event
    expect(collectionCopper(sim, marketSellerKey(bidder))).toBe(100);
    expect(eventsOf(sim, 'marketOutbid')).toHaveLength(1);
    // the seller got floor(400 * 0.95) = 380 plus a 0 deposit refund, and the event
    expect(collectionCopper(sim, marketSellerKey(seller))).toBe(380);
    const sold = eventsOf(sim, 'marketSold');
    expect(sold).toHaveLength(1);
    expect(sold[0]).toMatchObject({ listingId, itemId: 'wolf_fang', count: 2, proceeds: 380 });
    // the buyer got the classic Bought line for the whole lot
    const loots = eventsOf(sim, 'loot').map((e) => e.text);
    expect(loots).toContain('Bought Cracked Wolf Fang x2 for 4s.');
  });

  it('treats a bid at or above the buyout as an instant purchase AT the buyout price', () => {
    const sim = makeWorld();
    const { seller, listingId } = postAuction(sim, { startingBid: 100, buyoutPrice: 300 });
    const bidder = addBidder(sim, 'Bidder', 1000);
    sim.events.length = 0;

    sim.marketBid(listingId, 350, bidder); // over the buyout: pays 300, not 350

    expect(errorsSince(sim)).toEqual([]);
    expect(copperOf(sim, bidder)).toBe(700);
    expect(sim.countItem('wolf_fang', bidder)).toBe(2);
    expect(sim.marketListings.some((l) => l.id === listingId)).toBe(false);
    expect(collectionCopper(sim, marketSellerKey(seller))).toBe(285); // floor(300 * 0.95)
  });
});

describe('World Market auctions: expiry settlement', () => {
  it('settles an expired lot with a bid: goods to the winner box, proceeds + deposit to the seller box', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    // bone_fragments carry a real deposit (sellValue 7 -> 4/unit at 48h)
    sim.addItem('bone_fragments', 2, seller);
    sim.players.get(seller)!.copper = 8;
    sim.marketList('bone_fragments', 2, 0, seller, { auction: { startingBid: 100 } });
    expect(copperOf(sim, seller)).toBe(0); // deposit staked
    const listing = sim.marketListings.find((l) => l.sellerKey === marketSellerKey(seller))!;
    const winner = addBidder(sim, 'Winner', 1000);
    sim.marketBid(listing.id, 150, winner);
    listing.expiresAt = sim.time - 1;
    sim.events.length = 0;
    // tick() drains the event queue each call: accumulate the sweep's output
    const ticked: SimEvent[] = [];
    for (let i = 0; i < 20; i++) ticked.push(...sim.tick());
    sim.events.push(...ticked);

    expect(sim.marketListings.some((l) => l.id === listing.id)).toBe(false);
    // winner: escrow already paid, the lot waits in their box
    expect(copperOf(sim, winner)).toBe(850);
    const winnerCol = (
      sim.market as unknown as {
        marketCollections: Map<string, { copper: number; items: { itemId: string }[] }>;
      }
    ).marketCollections.get(marketSellerKey(winner))!;
    expect(winnerCol.items).toEqual([{ itemId: 'bone_fragments', count: 2 }]);
    // seller: floor(150 * 0.95) = 142 plus the full 8 deposit back
    expect(collectionCopper(sim, marketSellerKey(seller))).toBe(142 + 8);
    // both online parties got their structured events
    const won = eventsOf(sim, 'marketWon');
    expect(won).toHaveLength(1);
    expect(won[0]).toMatchObject({
      listingId: listing.id,
      itemId: 'bone_fragments',
      count: 2,
      paid: 150,
      pid: winner,
    });
    const sold = eventsOf(sim, 'marketSold');
    expect(sold).toHaveLength(1);
    expect(sold[0]).toMatchObject({ listingId: listing.id, proceeds: 142, pid: seller });
    // CONSERVATION: 8 (deposit) + 1000 (winner) entered; the 8 cut is the only sink.
    const total =
      copperOf(sim, seller) +
      copperOf(sim, winner) +
      collectionCopper(sim, marketSellerKey(seller)) +
      collectionCopper(sim, marketSellerKey(winner));
    expect(total).toBe(8 + 1000 - 8); // cut = 150 - 142
  });

  it('returns an expired no-bid lot to the seller with the legacy log line plus marketExpired', () => {
    const sim = makeWorld();
    const { seller, listingId } = postAuction(sim, { startingBid: 100 });
    const listing = sim.marketListings.find((l) => l.id === listingId)!;
    listing.expiresAt = sim.time - 1;
    sim.events.length = 0;
    // tick() drains the event queue each call: accumulate the sweep's output
    const ticked: SimEvent[] = [];
    for (let i = 0; i < 20; i++) ticked.push(...sim.tick());
    sim.events.push(...ticked);

    expect(sim.marketListings.some((l) => l.id === listingId)).toBe(false);
    const info = sim.marketInfoFor(seller)!;
    expect(info.collectionItems).toEqual([{ itemId: 'wolf_fang', count: 2 }]);
    expect(info.collectionCopper).toBe(0);
    // the pre-auction expiry log stays byte-identical, the structured event rides after it
    const logs = sim.events
      .filter((e) => e.type === 'log')
      .map((e) => (e as { text: string }).text);
    expect(logs).toContain(
      'Your market listing of Cracked Wolf Fang expired and waits at the Merchant.',
    );
    const expired = eventsOf(sim, 'marketExpired');
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({ listingId, itemId: 'wolf_fang', count: 2, pid: seller });
  });

  it('lets the seller cancel a lot with a live bid: the bidder is made whole', () => {
    const sim = makeWorld();
    const { seller, listingId } = postAuction(sim, { startingBid: 100 });
    const bidder = addBidder(sim, 'Bidder', 1000);
    sim.marketBid(listingId, 130, bidder);
    sim.events.length = 0;

    sim.marketCancel(listingId, seller);

    expect(errorsSince(sim)).toEqual([]);
    expect(sim.countItem('wolf_fang', seller)).toBe(2); // goods back in bags
    expect(collectionCopper(sim, marketSellerKey(bidder))).toBe(130); // escrow refunded
    expect(eventsOf(sim, 'marketOutbid')).toHaveLength(1);
    const loots = eventsOf(sim, 'loot').map((e) => e.text);
    expect(loots).toContain('Reclaimed Cracked Wolf Fang x2 from the market.');
  });
});

describe('World Market auctions: offline Merchant letters', () => {
  it('mails an offline outbid bidder instead of emitting an event', () => {
    const sim = makeWorld();
    const { listingId } = postAuction(sim, { startingBid: 100 });
    const listing = sim.marketListings.find((l) => l.id === listingId)!;
    // a standing bid whose owner is no longer online (no player has this key)
    listing.bid = { amount: 100, bidderKey: 'ghost-9', bidderName: 'Ghost' };
    const rival = addBidder(sim, 'Rival', 1000);
    const sendLetter = vi.spyOn(sim.postOffice, 'sendLetter');
    sim.events.length = 0;

    sim.marketBid(listingId, 110, rival);

    expect(collectionCopper(sim, 'ghost-9')).toBe(100);
    expect(eventsOf(sim, 'marketOutbid')).toHaveLength(0); // nobody online to tell
    expect(sendLetter).toHaveBeenCalledTimes(1);
    expect(sendLetter).toHaveBeenCalledWith('ghost-9', 'Ghost', AUCTION_LETTERS.outbid, 'system');
  });

  it('mails the offline seller and offline winner on expiry settlement', () => {
    const sim = makeWorld();
    const bidder = addBidder(sim, 'Bidder', 1000);
    // an auction lot whose seller is offline (key matches no live player)
    sim.marketListings.push({
      id: 9001,
      sellerKey: 'ghost-7',
      sellerName: 'Ghostseller',
      itemId: 'wolf_fang',
      count: 1,
      price: 50,
      kind: 'auction',
      startingBid: 50,
      durationSeconds: 3600,
      depositPerUnit: 0,
      expiresAt: sim.time + 3600,
      house: false,
    });
    sim.marketBid(9001, 60, bidder);
    const listing = sim.marketListings.find((l) => l.id === 9001)!;
    // the winner logs off before the hammer falls
    listing.bid = { ...listing.bid!, bidderKey: 'ghost-9', bidderName: 'Ghostwinner' };
    listing.expiresAt = sim.time - 1;
    const sendLetter = vi.spyOn(sim.postOffice, 'sendLetter');
    for (let i = 0; i < 20; i++) sim.tick();

    expect(sendLetter).toHaveBeenCalledWith(
      'ghost-9',
      'Ghostwinner',
      AUCTION_LETTERS.won,
      'system',
    );
    expect(sendLetter).toHaveBeenCalledWith(
      'ghost-7',
      'Ghostseller',
      AUCTION_LETTERS.sold,
      'system',
    );
  });

  it('mails the offline seller when a no-bid listing expires', () => {
    const sim = makeWorld();
    sim.addPlayer('warrior', 'Somebody'); // keeps the world ticking with a live player
    sim.marketListings.push({
      id: 9002,
      sellerKey: 'ghost-7',
      sellerName: 'Ghostseller',
      itemId: 'wolf_fang',
      count: 1,
      price: 50,
      kind: 'fixed',
      pricePerUnit: 50,
      durationSeconds: 3600,
      depositPerUnit: 0,
      expiresAt: sim.time - 1,
      house: false,
    });
    const sendLetter = vi.spyOn(sim.postOffice, 'sendLetter');
    for (let i = 0; i < 20; i++) sim.tick();

    expect(sendLetter).toHaveBeenCalledWith(
      'ghost-7',
      'Ghostseller',
      AUCTION_LETTERS.expired,
      'system',
    );
  });
});

describe('World Market auctions: persistence', () => {
  it('round-trips every auction field including a live bid', () => {
    const sim = makeWorld();
    const { listingId } = postAuction(sim, { startingBid: 100, buyoutPrice: 500 });
    const bidder = addBidder(sim, 'Bidder', 1000);
    sim.marketBid(listingId, 120, bidder);

    const save = sim.serializeMarket();
    const row = save.listings.find((l) => l.itemId === 'wolf_fang')!;
    expect(row).toMatchObject({
      kind: 'auction',
      startingBid: 100,
      buyoutPrice: 500,
      depositPerUnit: 0,
      durationSeconds: 48 * 3600,
      bid: { amount: 120, bidderKey: marketSellerKey(bidder), bidderName: 'Bidder' },
    });

    const sim2 = makeWorld();
    sim2.loadMarket(save);
    const loaded = sim2.marketListings.find((l) => !l.house && l.itemId === 'wolf_fang')!;
    expect(loaded).toMatchObject({
      kind: 'auction',
      count: 2,
      startingBid: 100,
      buyoutPrice: 500,
      bid: { amount: 120, bidderKey: marketSellerKey(bidder), bidderName: 'Bidder' },
    });
    expect(loaded.pricePerUnit).toBeUndefined();
  });

  it('drops a corrupt bid shape on load without inventing escrow', () => {
    const base = {
      id: 1,
      sellerKey: 's1',
      sellerName: 'Seller',
      itemId: 'wolf_fang',
      count: 1,
      price: 100,
      secondsLeft: 600,
      kind: 'auction' as const,
      startingBid: 100,
    };
    const corruptBids = [
      { amount: 0, bidderKey: 'b', bidderName: 'B' }, // floored below 1
      { amount: Number.NaN, bidderKey: 'b', bidderName: 'B' },
      { amount: 100, bidderKey: '', bidderName: 'B' }, // empty key
      { amount: 100 } as never, // missing key entirely
    ];
    for (const [i, bid] of corruptBids.entries()) {
      const sim = makeWorld();
      sim.loadMarket({
        listings: [{ ...base, id: i + 1, bid }],
        collections: [],
        nextListingId: 10,
      });
      const loaded = sim.marketListings.find((l) => !l.house)!;
      expect(loaded.kind).toBe('auction');
      expect(loaded.bid, `corrupt bid #${i}`).toBeUndefined();
    }
  });

  it('drops a persisted buyout that no longer beats the starting bid', () => {
    const sim = makeWorld();
    sim.loadMarket({
      listings: [
        {
          id: 1,
          sellerKey: 's1',
          sellerName: 'Seller',
          itemId: 'wolf_fang',
          count: 1,
          price: 100,
          secondsLeft: 600,
          kind: 'auction',
          startingBid: 100,
          buyoutPrice: 90,
        },
      ],
      collections: [],
      nextListingId: 2,
    });
    const loaded = sim.marketListings.find((l) => !l.house)!;
    expect(loaded.startingBid).toBe(100);
    expect(loaded.buyoutPrice).toBeUndefined();
  });
});

describe('World Market auctions: the browse view', () => {
  it('wires currentBid, minNextBid, buyoutPrice, and the myBid flag', () => {
    const sim = makeWorld();
    const { listingId } = postAuction(sim, { startingBid: 100, buyoutPrice: 500 });
    const bidder = addBidder(sim, 'Bidder', 1000);
    const rival = addBidder(sim, 'Rival', 1000);
    sim.marketBid(listingId, 120, bidder);

    const forBidder = sim.marketInfoFor(bidder)!.listings.find((l) => l.id === listingId)!;
    expect(forBidder).toMatchObject({
      kind: 'auction',
      currentBid: 120,
      minNextBid: 126, // 120 + max(1, floor(6))
      buyoutPrice: 500,
      myBid: true,
    });
    expect(forBidder.secondsLeft).toBeGreaterThan(0);

    const forRival = sim.marketInfoFor(rival)!.listings.find((l) => l.id === listingId)!;
    expect(forRival.myBid).toBe(false);
    const house = sim.marketInfoFor(rival)!.listings.find((l) => l.house)!;
    expect(house.kind).toBe('fixed');
    expect(house.currentBid).toBeUndefined();
    expect(house.myBid).toBe(false);
  });
});
