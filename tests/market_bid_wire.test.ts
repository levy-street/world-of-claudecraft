import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed (the snapshots.test.ts mock
// surface): the wire dispatch + snapshot mirror for market_bid is under test,
// not persistence.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
}));

import { GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';

// The market_bid wire round-trip (the auction-house extension of IWorldMarket):
// dispatch validation, escrow, outbid refund + the structured marketOutbid event,
// and the wire mirror (currentBid/minNextBid/myBid) on MarketListingView. The
// list/buy/cancel/collect wire paths are covered elsewhere (tests/market.test.ts,
// tests/market_auction.test.ts, tests/snapshots.test.ts); this file is scoped to
// the one new command, following the bank_wire.test.ts / loot_roll_wire.test.ts
// dispatch-through-GameServer pattern.

function fakeWs() {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) } };
}
function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) if (sent[i].t === 'snap') return sent[i];
  return null;
}
function eventsOf(sent: any[]): any[] {
  return sent.flatMap((msg) => (msg.t === 'events' ? msg.list : []));
}
function bareClient(pid: number): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass: 'warrior' };
  c.entities = new Map();
  c.playerId = pid;
  c.moveInput = {};
  c.inventory = [];
  c.vendorBuyback = [];
  c.equipment = {};
  c.accountCosmetics = { completedQuestIds: [], mechChromaIds: [] };
  c.copper = 0;
  c.xp = 0;
  c.known = [];
  c.questLog = new Map();
  c.questsDone = new Set();
  c.pendingQuestCommands = new Map();
  c.partyInfo = null;
  c.tradeInfo = null;
  c.duelInfo = null;
  c.lastSnapAt = 0;
  c.snapInterval = 50;
  c.missingSince = new Map();
  c.mouselookFacing = null;
  c.markers = {};
  return c;
}

function joinAt(server: GameServer, fw: ReturnType<typeof fakeWs>, acct: number, name: string) {
  const s = server.join(fw.ws as any, acct, acct, name, 'warrior', null) as any;
  if ('error' in s) throw new Error(s.error);
  s.blockListLoaded = true;
  return s;
}

function send(server: GameServer, session: any, msg: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...msg }));
}

// One server tick: run the sim and route the resulting events to sessions,
// exactly like the 50 ms loop does (the block_invites.test.ts idiom). Dispatch
// alone only mutates the sim; events reach fw.sent only after a route.
function route(server: GameServer): void {
  (server as any).routeEvents(server.sim.tick());
}

// Relocate the first Merchant NPC onto the player (the snapshots.test.ts /
// bank_wire.test.ts idiom): nearMerchant is a dist2d check.
function bringMerchantToPlayer(sim: any, pid: number): any {
  const merchant = sim.entities.get(sim.market.merchantIds[0]);
  const p = sim.entities.get(pid);
  merchant.pos = { ...p.pos };
  merchant.prevPos = { ...merchant.pos };
  return merchant;
}

describe('market_bid wire round-trip', () => {
  it('a market_bid command over the wire escrows the bid and the mirror carries currentBid/minNextBid/myBid', () => {
    const server = new GameServer();
    const fwSeller = fakeWs();
    const seller = joinAt(server, fwSeller, 1, 'Auctioneer');
    const fwBidder = fakeWs();
    const bidder = joinAt(server, fwBidder, 2, 'Bidder');
    const sim = server.sim as any;
    bringMerchantToPlayer(sim, seller.pid);
    bringMerchantToPlayer(sim, bidder.pid);
    sim.addItem('wolf_fang', 1, seller.pid);
    sim.players.get(bidder.pid).copper = 1000;

    send(server, seller, {
      cmd: 'market_list',
      item: 'wolf_fang',
      count: 1,
      price: 0,
      startingBid: 50,
    });
    const lot = sim.marketListings.find((l: any) => l.itemId === 'wolf_fang' && !l.house);
    expect(lot).toBeTruthy();

    send(server, bidder, { cmd: 'market_bid', id: lot.id, amount: 50 });
    expect(sim.players.get(bidder.pid).copper).toBe(950); // 1000 - 50, escrowed off the purse

    fwBidder.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap = lastSnap(fwBidder.sent);
    const wired = snap.self.market.listings.find((l: any) => l.itemId === 'wolf_fang');
    expect(wired.kind).toBe('auction');
    expect(wired.currentBid).toBe(50);
    expect(wired.myBid).toBe(true);
    expect(wired.mine).toBe(false);
    expect(wired.minNextBid).toBe(50 + Math.max(1, Math.floor(50 * 0.05))); // +5%

    const client = bareClient(bidder.pid);
    (client as any).applySnapshot(snap);
    const decoded = client.marketInfo?.listings.find((l: any) => l.itemId === 'wolf_fang');
    expect(decoded).toMatchObject({ currentBid: 50, myBid: true, kind: 'auction' });
  });

  it('a higher bid outbids the standing bidder: the loser is refunded to their collection and a marketOutbid event rides the wire', () => {
    const server = new GameServer();
    const fwSeller = fakeWs();
    const seller = joinAt(server, fwSeller, 1, 'Auctioneer2');
    const fwA = fakeWs();
    const bidderA = joinAt(server, fwA, 2, 'Alder');
    const fwB = fakeWs();
    const bidderB = joinAt(server, fwB, 3, 'Birch');
    const sim = server.sim as any;
    for (const s of [seller, bidderA, bidderB]) bringMerchantToPlayer(sim, s.pid);
    sim.addItem('wolf_fang', 1, seller.pid);
    sim.players.get(bidderA.pid).copper = 1000;
    sim.players.get(bidderB.pid).copper = 1000;

    send(server, seller, {
      cmd: 'market_list',
      item: 'wolf_fang',
      count: 1,
      price: 0,
      startingBid: 50,
    });
    const lot = sim.marketListings.find((l: any) => l.itemId === 'wolf_fang' && !l.house);

    fwA.sent.length = 0;
    send(server, bidderA, { cmd: 'market_bid', id: lot.id, amount: 50 });
    expect(sim.players.get(bidderA.pid).copper).toBe(950);

    send(server, bidderB, { cmd: 'market_bid', id: lot.id, amount: 100 });
    expect(sim.players.get(bidderB.pid).copper).toBe(900);
    // Bidder A's copper stays down: the refund lands in their COLLECTION, not
    // their purse, exactly like a sale proceeds (offline-safe by construction).
    expect(sim.players.get(bidderA.pid).copper).toBe(950);
    expect(sim.marketInfoFor(bidderA.pid).collectionCopper).toBe(50);

    // Route the sim's event queue to sessions (the 50ms-loop idiom) so the
    // structured marketOutbid event reaches bidder A's own wire.
    route(server);
    const outbidEvent = eventsOf(fwA.sent).find((e: any) => e.type === 'marketOutbid');
    expect(outbidEvent).toBeTruthy();
    expect(outbidEvent.refund).toBe(50);
    expect(outbidEvent.listingId).toBe(lot.id);

    // The wire mirror for bidder B (the new high bidder) shows myBid true; for
    // bidder A (outbid) it shows myBid false, still with the current 100 bid.
    // ONE broadcast reaches every session, so both must be read off it together
    // (a second broadcast with no further state change omits the unchanged
    // 'market' delta key entirely, per the maybe() contract).
    fwA.sent.length = 0;
    fwB.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snapB = lastSnap(fwB.sent);
    const wiredForB = snapB.self.market.listings.find((l: any) => l.itemId === 'wolf_fang');
    expect(wiredForB.currentBid).toBe(100);
    expect(wiredForB.myBid).toBe(true);

    const snapA = lastSnap(fwA.sent);
    const wiredForA = snapA.self.market.listings.find((l: any) => l.itemId === 'wolf_fang');
    expect(wiredForA.currentBid).toBe(100);
    expect(wiredForA.myBid).toBe(false);
  });

  it('server authority: malformed market_bid commands and guarded bids move nothing', () => {
    const server = new GameServer();
    const fwSeller = fakeWs();
    const seller = joinAt(server, fwSeller, 1, 'Auctioneer3');
    const fwBidder = fakeWs();
    const bidder = joinAt(server, fwBidder, 2, 'Cato');
    const sim = server.sim as any;
    bringMerchantToPlayer(sim, seller.pid);
    bringMerchantToPlayer(sim, bidder.pid);
    sim.addItem('wolf_fang', 1, seller.pid);
    sim.players.get(bidder.pid).copper = 1000;

    send(server, seller, {
      cmd: 'market_list',
      item: 'wolf_fang',
      count: 1,
      price: 0,
      startingBid: 50,
    });
    const lot = sim.marketListings.find((l: any) => l.itemId === 'wolf_fang' && !l.house);

    // Wrong-type id: dispatch validation (typeof msg.id === 'number') rejects it.
    send(server, bidder, { cmd: 'market_bid', id: 'first', amount: 50 });
    expect(sim.players.get(bidder.pid).copper).toBe(1000);

    // Wrong-type / non-finite amount: same rejection.
    send(server, bidder, { cmd: 'market_bid', id: lot.id, amount: 'fifty' });
    expect(sim.players.get(bidder.pid).copper).toBe(1000);
    send(server, bidder, { cmd: 'market_bid', id: lot.id, amount: Number.POSITIVE_INFINITY });
    expect(sim.players.get(bidder.pid).copper).toBe(1000);

    // The seller cannot bid on their own lot: the sim-level guard refuses it
    // (the dispatch validation passes; marketBid itself rejects).
    send(server, seller, { cmd: 'market_bid', id: lot.id, amount: 50 });
    expect(lot.bid).toBeUndefined();

    // A below-minimum bid is refused; nothing is escrowed.
    send(server, bidder, { cmd: 'market_bid', id: lot.id, amount: 10 });
    expect(sim.players.get(bidder.pid).copper).toBe(1000);
    expect(lot.bid).toBeUndefined();

    // A valid bid succeeds, then the SAME bidder trying to raise their own
    // standing bid is refused ("already the high bidder").
    send(server, bidder, { cmd: 'market_bid', id: lot.id, amount: 50 });
    expect(sim.players.get(bidder.pid).copper).toBe(950);
    send(server, bidder, { cmd: 'market_bid', id: lot.id, amount: 80 });
    expect(sim.players.get(bidder.pid).copper).toBe(950); // unchanged: refused
    expect(lot.bid.amount).toBe(50);
  });
});
