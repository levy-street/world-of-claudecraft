// Multi-currency listing denominations on the World Market (AH-P4): rails
// gating, the WOC whole-lot ask, the pending external-purchase lock and its
// server-called lifecycle (complete/fail), persistence round-trips, and the
// monotonic purchase sequence. Real Sim instances with an injected tradeRails
// view (the trade_settlement.test.ts fixture pattern); zero rng, integer math,
// and no WOC arithmetic anywhere (amounts stay opaque strings).
import { describe, expect, it, vi } from 'vitest';
import { AUCTION_LETTERS } from '../src/sim/content/letters';
import { MARKET_MAX_CLAUDIUM_PRICE } from '../src/sim/market';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent, TradeRailsView } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

interface RailsOpts {
  claudium?: boolean;
  balance?: number;
  woc?: boolean;
  linked?: boolean;
}

function makeWorld(rails?: RailsOpts): Sim {
  const view: TradeRailsView = {
    claudium: { available: rails?.claudium ?? false, balance: rails?.balance ?? 0 },
    woc: { available: rails?.woc ?? false, linked: rails?.linked ?? false },
  };
  return new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    ...(rails ? { tradeRails: () => view } : {}),
  });
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

function errorsSince(sim: Sim): string[] {
  return sim.events.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text);
}

function eventsOf<T extends SimEvent['type']>(sim: Sim, type: T) {
  return sim.events.filter((e) => e.type === type) as Extract<SimEvent, { type: T }>[];
}

function marketSellerKey(pid: number): string {
  return String(pid);
}

function collections(sim: Sim) {
  return (
    sim.market as unknown as {
      marketCollections: Map<
        string,
        { copper: number; items: { itemId: string; count: number }[] }
      >;
    }
  ).marketCollections;
}

// A seller at the Merchant with `count` bone fragments (sellValue 7 -> a real
// 4c/unit deposit at 48h) listed in `denom`; returns the seller + listing id.
function listExternal(
  sim: Sim,
  denom: 'claudium' | 'woc',
  opts: { count?: number; pricePerUnit?: number; priceWoc?: string } = {},
): { seller: number; listingId: number } {
  const seller = sim.addPlayer('warrior', 'Seller');
  standAtMerchant(sim, seller);
  const count = opts.count ?? 2;
  sim.addItem('bone_fragments', count, seller);
  sim.players.get(seller)!.copper = 1000;
  sim.marketList('bone_fragments', count, opts.pricePerUnit ?? 10, seller, {
    denom,
    priceWoc: opts.priceWoc ?? (denom === 'woc' ? '1.5' : undefined),
  });
  const listing = sim.marketListings.find((l) => l.sellerKey === marketSellerKey(seller));
  if (!listing) throw new Error(`no ${denom} listing was created: ${errorsSince(sim).join('; ')}`);
  return { seller, listingId: listing.id };
}

function addBuyer(sim: Sim, name: string): number {
  const pid = sim.addPlayer('mage', name);
  standAtMerchant(sim, pid);
  sim.players.get(pid)!.copper = 1000;
  return pid;
}

describe('World Market denominations: rails gating at list time', () => {
  it('offline (no tradeRails injected) refuses both external denominations', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 2, seller);
    sim.events.length = 0;

    sim.marketList('wolf_fang', 1, 10, seller, { denom: 'claudium' });
    sim.marketList('wolf_fang', 1, 0, seller, { denom: 'woc', priceWoc: '1' });

    expect(errorsSince(sim)).toEqual([
      'Claudium listings are not available.',
      'Link a wallet to list for WOC.',
    ]);
    expect(sim.countItem('wolf_fang', seller)).toBe(2); // nothing escrowed
  });

  it('woc listing requires a LINKED wallet, not just the rail flag', () => {
    const sim = makeWorld({ woc: true, linked: false });
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 1, seller);
    sim.events.length = 0;

    sim.marketList('wolf_fang', 1, 0, seller, { denom: 'woc', priceWoc: '1' });

    expect(errorsSince(sim)).toEqual(['Link a wallet to list for WOC.']);
  });

  it('refuses an auction in any external denomination (bids take gold only)', () => {
    const sim = makeWorld({ claudium: true, balance: 1000, woc: true, linked: true });
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('wolf_fang', 1, seller);
    sim.events.length = 0;

    sim.marketList('wolf_fang', 1, 0, seller, {
      denom: 'claudium',
      auction: { startingBid: 100 },
    });
    sim.marketList('wolf_fang', 1, 0, seller, {
      denom: 'woc',
      priceWoc: '1',
      auction: { startingBid: 100 },
    });

    expect(errorsSince(sim)).toEqual(['Bids take gold only.', 'Bids take gold only.']);
    expect(sim.countItem('wolf_fang', seller)).toBe(1);
  });

  it('lists claudium per-unit (ceiling-clamped) and woc whole-lot (normalized ask); copper deposit charged for both', () => {
    const sim = makeWorld({ claudium: true, balance: 1000, woc: true, linked: true });
    const cl = listExternal(sim, 'claudium', { pricePerUnit: MARKET_MAX_CLAUDIUM_PRICE + 5 });
    const clRow = sim.marketListings.find((l) => l.id === cl.listingId)!;
    expect(clRow).toMatchObject({
      denom: 'claudium',
      kind: 'fixed',
      pricePerUnit: MARKET_MAX_CLAUDIUM_PRICE, // clamped, never refused
      price: MARKET_MAX_CLAUDIUM_PRICE * 2,
    });
    // the listing deposit stays COPPER for every denomination: 2 x 4c at 48h
    expect(sim.players.get(cl.seller)!.copper).toBe(1000 - 8);

    const woc = listExternal(sim, 'woc', { priceWoc: '01.50' });
    const wocRow = sim.marketListings.find((l) => l.id === woc.listingId)!;
    expect(wocRow).toMatchObject({ denom: 'woc', kind: 'fixed', price: 0, priceWoc: '1.5' });
    expect(wocRow.pricePerUnit).toBeUndefined(); // whole-lot only

    sim.events.length = 0;
    const bad = sim.addPlayer('warrior', 'BadAsk');
    standAtMerchant(sim, bad);
    sim.addItem('wolf_fang', 1, bad);
    sim.marketList('wolf_fang', 1, 0, bad, { denom: 'woc', priceWoc: 'not-a-number' });
    expect(errorsSince(sim)).toEqual(['Name a valid WOC price.']);
  });
});

describe('World Market denominations: external purchase start (marketBuy)', () => {
  it('claudium buy locks the lot and emits the server-only marketPurchaseStart with exact cost', () => {
    const sim = makeWorld({ claudium: true, balance: 1000, woc: true, linked: true });
    const { listingId } = listExternal(sim, 'claudium', { count: 3, pricePerUnit: 10 });
    const buyer = addBuyer(sim, 'Buyer');
    sim.events.length = 0;

    sim.marketBuy(listingId, 2, buyer);

    expect(errorsSince(sim)).toEqual([]);
    expect(sim.players.get(buyer)!.copper).toBe(1000); // no copper moves
    const listing = sim.marketListings.find((l) => l.id === listingId)!;
    expect(listing.pending).toMatchObject({
      buyerKey: marketSellerKey(buyer),
      buyerName: 'Buyer',
      quantity: 2,
      purchaseSeq: 1,
    });
    const starts = eventsOf(sim, 'marketPurchaseStart');
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      listingId,
      denom: 'claudium',
      buyerPid: buyer,
      buyerKey: marketSellerKey(buyer),
      quantity: 2,
      costClaudium: 20,
    });
  });

  it('claudium buy pre-checks the cached balance; woc buy requires the buyer link and is whole-lot', () => {
    const sim = makeWorld({ claudium: true, balance: 5, woc: true, linked: true });
    const { listingId } = listExternal(sim, 'claudium', { count: 2, pricePerUnit: 10 });
    const buyer = addBuyer(sim, 'Buyer');
    sim.events.length = 0;
    sim.marketBuy(listingId, 2, buyer); // cost 20 > cached balance 5
    expect(errorsSince(sim)).toEqual(['You cannot afford that.']);

    const sim2 = makeWorld({ woc: true, linked: false });
    // seller side needs a linked view to list: fabricate the row directly
    const seller2 = sim2.addPlayer('warrior', 'Seller2');
    sim2.marketListings.push({
      id: 9001,
      sellerKey: 'ghost-7',
      sellerName: 'Ghostseller',
      itemId: 'wolf_fang',
      count: 2,
      price: 0,
      kind: 'fixed',
      durationSeconds: 3600,
      depositPerUnit: 0,
      expiresAt: sim2.time + 3600,
      house: false,
      denom: 'woc',
      priceWoc: '2',
    });
    void seller2;
    const buyer2 = addBuyer(sim2, 'Buyer2');
    sim2.events.length = 0;
    sim2.marketBuy(9001, undefined, buyer2);
    expect(
      sim2.events.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text),
    ).toEqual(['Link a wallet to pay with WOC.']);

    const sim3 = makeWorld({ woc: true, linked: true });
    const w3 = listExternal(sim3, 'woc', { count: 3, priceWoc: '2' });
    const buyer3 = addBuyer(sim3, 'Buyer3');
    sim3.events.length = 0;
    sim3.marketBuy(w3.listingId, 1, buyer3); // quantity ignored: whole lot
    const starts = sim3.events.filter((e) => e.type === 'marketPurchaseStart') as Extract<
      SimEvent,
      { type: 'marketPurchaseStart' }
    >[];
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ denom: 'woc', quantity: 3, costWoc: '2' });
  });
});

describe('World Market denominations: the pending lock', () => {
  function lockedWorld() {
    const sim = makeWorld({ claudium: true, balance: 1000, woc: true, linked: true });
    const { seller, listingId } = listExternal(sim, 'claudium', { count: 2, pricePerUnit: 10 });
    const buyer = addBuyer(sim, 'Buyer');
    sim.marketBuy(listingId, 2, buyer);
    expect(sim.marketListings.find((l) => l.id === listingId)?.pending).toBeTruthy();
    return { sim, seller, listingId, buyer };
  }

  it('refuses buy, bid, and the seller cancel while awaiting payment', () => {
    const { sim, seller, listingId } = lockedWorld();
    const rival = addBuyer(sim, 'Rival');
    sim.events.length = 0;

    sim.marketBuy(listingId, 1, rival);
    sim.marketBid(listingId, 100, rival);
    sim.marketCancel(listingId, seller);

    expect(errorsSince(sim)).toEqual([
      'That lot is awaiting payment.',
      'That lot is awaiting payment.',
      'That lot is awaiting payment.',
    ]);
    expect(sim.marketListings.some((l) => l.id === listingId)).toBe(true);
  });

  it('the expiry sweep skips a pending listing; it expires only after the pending clears', () => {
    const { sim, listingId } = lockedWorld();
    const listing = sim.marketListings.find((l) => l.id === listingId)!;
    listing.expiresAt = sim.time - 1;
    for (let i = 0; i < 20; i++) sim.tick();
    expect(sim.marketListings.some((l) => l.id === listingId)).toBe(true); // still locked

    sim.marketPendingFail(listingId);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(sim.marketListings.some((l) => l.id === listingId)).toBe(false); // now expired
  });
});

describe('World Market denominations: pending lifecycle (server-called)', () => {
  it('marketPendingComplete delivers to the buyer collection, refunds the copper deposit per unit, decrements, and notifies the online seller with denom detail', () => {
    const sim = makeWorld({ claudium: true, balance: 1000, woc: true, linked: true });
    const { seller, listingId } = listExternal(sim, 'claudium', { count: 3, pricePerUnit: 10 });
    const buyer = addBuyer(sim, 'Buyer');
    sim.marketBuy(listingId, 2, buyer);
    sim.events.length = 0;

    expect(sim.marketPendingComplete(listingId)).toBe(true);

    // goods to the BUYER'S COLLECTION BOX, never straight to bags
    expect(sim.countItem('bone_fragments', buyer)).toBe(0);
    expect(collections(sim).get(marketSellerKey(buyer))?.items).toEqual([
      { itemId: 'bone_fragments', count: 2 },
    ]);
    // seller: NO copper proceeds (paid externally), ONLY the 2 x 4c deposit back
    expect(collections(sim).get(marketSellerKey(seller))?.copper).toBe(8);
    const listing = sim.marketListings.find((l) => l.id === listingId)!;
    expect(listing.count).toBe(1);
    expect(listing.pending).toBeUndefined();
    expect(listing.price).toBe(10); // running per-unit total recomputed
    const sold = eventsOf(sim, 'marketSold');
    expect(sold).toHaveLength(1);
    expect(sold[0]).toMatchObject({
      listingId,
      itemId: 'bone_fragments',
      count: 2,
      proceeds: 0,
      denom: 'claudium',
      costClaudium: 20,
      pid: seller,
    });
  });

  it('marketPendingComplete letters an OFFLINE seller with the wallet/account letter, not the copper one', () => {
    const sim = makeWorld({ woc: true, linked: true });
    sim.addPlayer('warrior', 'Somebody'); // keep the world alive
    sim.marketListings.push({
      id: 9001,
      sellerKey: 'ghost-7',
      sellerName: 'Ghostseller',
      itemId: 'wolf_fang',
      count: 2,
      price: 0,
      kind: 'fixed',
      durationSeconds: 3600,
      depositPerUnit: 3,
      expiresAt: sim.time + 3600,
      house: false,
      denom: 'woc',
      priceWoc: '1.5',
      pending: {
        buyerKey: 'ghost-9',
        buyerName: 'Ghostbuyer',
        quantity: 2,
        startedAt: sim.time,
        purchaseSeq: 1,
      },
    });
    const sendLetter = vi.spyOn(sim.postOffice, 'sendLetter');

    expect(sim.marketPendingComplete(9001)).toBe(true);

    expect(sendLetter).toHaveBeenCalledTimes(1);
    expect(sendLetter).toHaveBeenCalledWith(
      'ghost-7',
      'Ghostseller',
      AUCTION_LETTERS.sold_wallet,
      'system',
    );
    // whole lot delivered + full per-unit deposit refund (2 x 3c)
    expect(collections(sim).get('ghost-9')?.items).toEqual([{ itemId: 'wolf_fang', count: 2 }]);
    expect(collections(sim).get('ghost-7')?.copper).toBe(6);
    expect(sim.marketListings.some((l) => l.id === 9001)).toBe(false); // spliced at 0
  });

  it('marketPendingFail unlocks the lot and tells the online buyer via marketPaymentExpired', () => {
    const sim = makeWorld({ claudium: true, balance: 1000 });
    const { listingId } = listExternal(sim, 'claudium', { count: 2, pricePerUnit: 10 });
    const buyer = addBuyer(sim, 'Buyer');
    sim.marketBuy(listingId, 1, buyer);
    sim.events.length = 0;

    expect(sim.marketPendingFail(listingId)).toBe(true);

    const listing = sim.marketListings.find((l) => l.id === listingId)!;
    expect(listing.pending).toBeUndefined();
    expect(listing.count).toBe(2); // nothing moved
    const expired = eventsOf(sim, 'marketPaymentExpired');
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({ listingId, itemId: 'bone_fragments', pid: buyer });
    // idempotent: a second fail is a no-op
    expect(sim.marketPendingFail(listingId)).toBe(false);
  });
});

describe('World Market denominations: persistence', () => {
  it('round-trips denom, priceWoc, and the pending state (sinceSeconds idiom, attach fields verbatim)', () => {
    const sim = makeWorld({ woc: true, linked: true });
    const { listingId } = listExternal(sim, 'woc', { count: 2, priceWoc: '1.5' });
    const buyer = addBuyer(sim, 'Buyer');
    sim.marketBuy(listingId, undefined, buyer);
    expect(
      sim.marketPendingAttach(listingId, {
        reference: 'ref-1',
        buyerWallet: 'pk-buyer',
        sellerWallet: 'pk-seller',
        buyerAccountId: 501,
        sellerAccountId: 502,
      }),
    ).toBe(true);

    const save = sim.serializeMarket();
    const row = save.listings.find((l) => l.id === listingId)!;
    expect(row.denom).toBe('woc');
    expect(row.priceWoc).toBe('1.5');
    expect(row.pending).toMatchObject({
      buyerKey: marketSellerKey(buyer),
      buyerName: 'Buyer',
      quantity: 2,
      sinceSeconds: 0,
      purchaseSeq: 1,
      reference: 'ref-1',
      buyerWallet: 'pk-buyer',
      sellerWallet: 'pk-seller',
      buyerAccountId: 501,
      sellerAccountId: 502,
    });
    // copper rows persist NO denom key (absent -> copper on load)
    expect(save.listings.every((l) => l.denom === undefined || l.denom === 'woc')).toBe(true);

    const sim2 = makeWorld({ woc: true, linked: true });
    sim2.loadMarket(save);
    const loaded = sim2.marketListings.find((l) => l.id === listingId)!;
    expect(loaded).toMatchObject({ denom: 'woc', priceWoc: '1.5', count: 2 });
    expect(loaded.pending).toMatchObject({
      buyerKey: marketSellerKey(buyer),
      quantity: 2,
      purchaseSeq: 1,
      reference: 'ref-1',
      buyerWallet: 'pk-buyer',
      sellerWallet: 'pk-seller',
      buyerAccountId: 501,
      sellerAccountId: 502,
    });
    // and the orchestrator record view resolves it end to end
    const rec = sim2.marketPendingRecord(listingId)!;
    expect(rec).toMatchObject({ denom: 'woc', costWoc: '1.5', reference: 'ref-1' });
  });

  it('an old blob without denomination fields loads as copper rows', () => {
    const sim = makeWorld();
    sim.loadMarket({
      listings: [
        {
          id: 1,
          sellerKey: 's1',
          sellerName: 'Seller',
          itemId: 'wolf_fang',
          count: 2,
          price: 100,
          secondsLeft: 600,
        },
      ],
      collections: [],
      nextListingId: 5,
    });
    const loaded = sim.marketListings.find((l) => !l.house)!;
    expect(loaded.denom).toBe('copper');
    expect(loaded.priceWoc).toBeUndefined();
    expect(loaded.pending).toBeUndefined();
  });

  it('purchaseSeq stays monotonic across save/load (a dedupe key is never reissued)', () => {
    const sim = makeWorld({ claudium: true, balance: 1000 });
    const { listingId } = listExternal(sim, 'claudium', { count: 2, pricePerUnit: 10 });
    const buyer = addBuyer(sim, 'Buyer');
    sim.marketBuy(listingId, 1, buyer);
    expect(sim.marketPendingRecord(listingId)?.purchaseSeq).toBe(1);

    const save = sim.serializeMarket();
    expect(save.nextPurchaseSeq).toBe(2);

    const sim2 = makeWorld({ claudium: true, balance: 1000 });
    sim2.loadMarket(save);
    // the loaded pending clears (failed), then a NEW purchase must take seq >= 2
    sim2.marketPendingFail(listingId);
    // pad one pid so the fresh buyer never collides with the loaded sellerKey
    sim2.addPlayer('warrior', 'Pad');
    const buyer2 = addBuyer(sim2, 'Buyer2');
    sim2.marketBuy(listingId, 1, buyer2);
    expect(sim2.marketPendingRecord(listingId)?.purchaseSeq).toBe(2);

    // belt: even WITHOUT the persisted counter, a loaded pending's seq floors it
    const sim3 = makeWorld({ claudium: true, balance: 1000 });
    sim3.loadMarket({ ...save, nextPurchaseSeq: undefined });
    sim3.marketPendingFail(listingId);
    sim3.addPlayer('warrior', 'Pad');
    const buyer3 = addBuyer(sim3, 'Buyer3');
    sim3.marketBuy(listingId, 1, buyer3);
    expect(sim3.marketPendingRecord(listingId)?.purchaseSeq).toBe(2);
  });

  it('the browse view carries denom/priceWoc/pendingPayment and myPendingPurchase for the buyer', () => {
    const sim = makeWorld({ woc: true, linked: true });
    const { listingId } = listExternal(sim, 'woc', { count: 2, priceWoc: '1.5' });
    const buyer = addBuyer(sim, 'Buyer');
    sim.marketBuy(listingId, undefined, buyer);

    const info = sim.marketInfoFor(buyer)!;
    expect(info.rails).toEqual({ claudium: false, woc: true });
    const row = info.listings.find((l) => l.id === listingId)!;
    expect(row).toMatchObject({ denom: 'woc', priceWoc: '1.5', pendingPayment: true });
    expect(info.myPendingPurchase).toMatchObject({
      listingId,
      itemId: 'bone_fragments',
      quantity: 2,
      denom: 'woc',
      costWoc: '1.5',
    });
    expect(info.myPendingPurchase?.wocPay).toBeUndefined(); // server-only enrichment

    // a bystander sees the lock but never someone else's pending purchase
    const rival = addBuyer(sim, 'Rival');
    const rivalInfo = sim.marketInfoFor(rival)!;
    expect(rivalInfo.listings.find((l) => l.id === listingId)?.pendingPayment).toBe(true);
    expect(rivalInfo.myPendingPurchase).toBeUndefined();
  });
});
