import { beforeEach, describe, expect, it, vi } from 'vitest';

// Postgres is mocked (hoisted above the server/game import), the
// bank_ledger.test.ts idiom, so GameServer runs with no live DB and the
// fire-and-forget market tracker writers are spies we can assert against.
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
  insertBankLedgerRow: vi.fn(async () => {}),
}));
vi.mock('../server/market_tracker_db', () => ({
  MARKET_TRACKER_SCHEMA: '',
  insertMarketSaleRow: vi.fn(async () => {}),
  insertMarketListingSnapshotRows: vi.fn(async () => {}),
  pruneMarketListingSnapshots: vi.fn(async () => 0),
  anonymizeMarketSalesForCharacter: vi.fn(async () => {}),
  reconcileMarketSalesCharacterIds: vi.fn(async () => {}),
  loadActiveMarketAlerts: vi.fn(async () => []),
  markMarketAlertTriggered: vi.fn(async () => {}),
}));

import { GameServer } from '../server/game';
import {
  captureMarketBuy,
  diffMarketBuy,
  evaluateMarketAlerts,
  marketTrackerIdle,
  recordMarketBuy,
  recordMarketListingSnapshot,
  snapshotMarketListings,
} from '../server/market_tracker';
import {
  insertMarketListingSnapshotRows,
  insertMarketSaleRow,
  loadActiveMarketAlerts,
  markMarketAlertTriggered,
} from '../server/market_tracker_db';
import { REALM } from '../server/realm';
import type { MarketListing } from '../src/sim/market';
import { groundHeight } from '../src/sim/world';

const saleInsertMock = vi.mocked(insertMarketSaleRow);
const snapshotInsertMock = vi.mocked(insertMarketListingSnapshotRows);

// A minimal player listing; tests vary only what they care about.
function listing(over: Partial<MarketListing> = {}): MarketListing {
  return {
    id: 1000,
    sellerKey: '42',
    sellerName: 'Sellera',
    itemId: 'wolf_fang',
    count: 5,
    price: 1000,
    expiresAt: 999999,
    house: false,
    ...over,
  };
}

const BUYER = { characterId: 43, accountId: 8 };

describe('captureMarketBuy (pure)', () => {
  it('copies the listing fields by value before the book mutates', () => {
    const book = [listing()];
    const cap = captureMarketBuy(book, 1000, 250);
    expect(cap).toEqual({
      listing: {
        id: 1000,
        sellerKey: '42',
        itemId: 'wolf_fang',
        count: 5,
        price: 1000,
        house: false,
        instanced: false,
        craftedRecipeId: null,
      },
      buyerCopperBefore: 250,
    });
    // The capture must survive a splice of the book row (a completed sale).
    book.length = 0;
    expect(cap.listing?.itemId).toBe('wolf_fang');
  });

  it('flags an instanced listing and carries crafted provenance', () => {
    const cap = captureMarketBuy(
      [
        listing({
          instance: { signer: 'Vaulta' } as MarketListing['instance'],
          count: 1,
        }),
        listing({ id: 1001, craftedRecipeId: 'smelt_bronze' }),
      ],
      1000,
      50,
    );
    expect(cap.listing?.instanced).toBe(true);
    const crafted = captureMarketBuy(
      [listing({ id: 1001, craftedRecipeId: 'smelt_bronze' })],
      1001,
      50,
    );
    expect(crafted.listing?.craftedRecipeId).toBe('smelt_bronze');
  });

  it('an unknown listing id captures a null listing', () => {
    expect(captureMarketBuy([listing()], 9999, 50).listing).toBeNull();
  });
});

describe('diffMarketBuy (pure)', () => {
  it('a purse debited by exactly the price is a sale', () => {
    const cap = captureMarketBuy([listing()], 1000, 5000);
    expect(diffMarketBuy(BUYER, cap, 4000)).toEqual({
      realm: REALM,
      listingId: 1000,
      itemId: 'wolf_fang',
      quantity: 5,
      totalPriceCopper: 1000,
      house: false,
      instanced: false,
      craftedRecipeId: null,
      buyerCharacterId: 43,
      buyerAccountId: 8,
      sellerCharacterId: 42,
    });
  });

  it('an unchanged or wrongly-changed purse is a refusal', () => {
    const cap = captureMarketBuy([listing()], 1000, 5000);
    expect(diffMarketBuy(BUYER, cap, 5000)).toBeNull();
    expect(diffMarketBuy(BUYER, cap, 4500)).toBeNull();
  });

  it('a null purse read on either side records nothing', () => {
    expect(diffMarketBuy(BUYER, captureMarketBuy([listing()], 1000, null), 4000)).toBeNull();
    expect(diffMarketBuy(BUYER, captureMarketBuy([listing()], 1000, 5000), null)).toBeNull();
  });

  it('a house sale carries house TRUE and a null seller', () => {
    const cap = captureMarketBuy(
      [listing({ id: 3, sellerKey: '', house: true, price: 700 })],
      3,
      1000,
    );
    const row = diffMarketBuy(BUYER, cap, 300);
    expect(row?.house).toBe(true);
    expect(row?.sellerCharacterId).toBeNull();
  });

  it('a legacy name-keyed sellerKey maps to a null seller id, digits map through', () => {
    const named = captureMarketBuy([listing({ sellerKey: 'Sellera' })], 1000, 5000);
    expect(diffMarketBuy(BUYER, named, 4000)?.sellerCharacterId).toBeNull();
    const mixed = captureMarketBuy([listing({ sellerKey: '12abc' })], 1000, 5000);
    expect(diffMarketBuy(BUYER, mixed, 4000)?.sellerCharacterId).toBeNull();
  });

  it('a numeric sellerKey past the INT column range maps to a null seller id', () => {
    // 2^31 and up would overflow the INT column and fail the whole insert,
    // silently dropping the sale row; the candidate is clamped out instead.
    const huge = captureMarketBuy([listing({ sellerKey: '2147483648' })], 1000, 5000);
    expect(diffMarketBuy(BUYER, huge, 4000)?.sellerCharacterId).toBeNull();
    const max = captureMarketBuy([listing({ sellerKey: '2147483647' })], 1000, 5000);
    expect(diffMarketBuy(BUYER, max, 4000)?.sellerCharacterId).toBe(2147483647);
  });
});

describe('snapshotMarketListings (pure)', () => {
  it('excludes house rows and aggregates per item', () => {
    const rows = snapshotMarketListings([
      listing({ id: 1, itemId: 'wolf_fang', count: 5, price: 1000 }),
      listing({ id: 2, itemId: 'wolf_fang', count: 2, price: 500 }),
      listing({ id: 3, itemId: 'roasted_boar', count: 5, price: 700, house: true, sellerKey: '' }),
      listing({ id: 4, itemId: 'spring_water', count: 1, price: 40 }),
    ]);
    expect(rows).toHaveLength(2);
    const fang = rows.find((r) => r.itemId === 'wolf_fang');
    // 1000/5 = 200c a unit beats 500/2 = 250c a unit.
    expect(fang).toEqual({
      realm: REALM,
      itemId: 'wolf_fang',
      listingCount: 2,
      totalQuantity: 7,
      lowestAskTotalCopper: 1000,
      lowestAskQuantity: 5,
    });
  });

  it('a unit-price tie prefers the smaller stack (the cheaper way in)', () => {
    const rows = snapshotMarketListings([
      listing({ id: 1, count: 10, price: 1000 }),
      listing({ id: 2, count: 2, price: 200 }),
    ]);
    expect(rows[0].lowestAskTotalCopper).toBe(200);
    expect(rows[0].lowestAskQuantity).toBe(2);
  });

  it('skips corrupt rows rather than poisoning the aggregate', () => {
    const rows = snapshotMarketListings([
      listing({ id: 1, price: Number.NaN }),
      listing({ id: 2, count: 0 }),
    ]);
    expect(rows).toEqual([]);
  });
});

describe('evaluateMarketAlerts (pure)', () => {
  const rows = snapshotMarketListings([
    // wolf_fang: 1000 / 5 = 200c a unit.
    listing({ id: 1, itemId: 'wolf_fang', count: 5, price: 1000 }),
  ]);

  it('fires below/above against the cheapest unit ask, with the value carried', () => {
    const fired = evaluateMarketAlerts(
      [
        { id: 1, itemId: 'wolf_fang', direction: 'below', thresholdCopper: 250 },
        { id: 2, itemId: 'wolf_fang', direction: 'below', thresholdCopper: 150 },
        { id: 3, itemId: 'wolf_fang', direction: 'above', thresholdCopper: 150 },
        { id: 4, itemId: 'wolf_fang', direction: 'above', thresholdCopper: 250 },
      ],
      rows,
    );
    expect(fired).toEqual([
      { id: 1, valueCopper: 200 },
      { id: 3, valueCopper: 200 },
    ]);
  });

  it('an item with no listings fires nothing in either direction', () => {
    const fired = evaluateMarketAlerts(
      [
        { id: 1, itemId: 'spring_water', direction: 'below', thresholdCopper: 999999 },
        { id: 2, itemId: 'spring_water', direction: 'above', thresholdCopper: 1 },
      ],
      rows,
    );
    expect(fired).toEqual([]);
  });

  it('the threshold itself does not fire (strict comparison)', () => {
    const fired = evaluateMarketAlerts(
      [
        { id: 1, itemId: 'wolf_fang', direction: 'below', thresholdCopper: 200 },
        { id: 2, itemId: 'wolf_fang', direction: 'above', thresholdCopper: 200 },
      ],
      rows,
    );
    expect(fired).toEqual([]);
  });
});

// ── GameServer dispatch integration ───────────────────────────────────────────

function fakeWs() {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) } };
}

function join(
  server: GameServer,
  fw: ReturnType<typeof fakeWs>,
  accountId: number,
  characterId: number,
  name: string,
) {
  const s = server.join(fw.ws as any, accountId, characterId, name, 'warrior', null) as any;
  if ('error' in s) throw new Error(s.error);
  s.blockListLoaded = true;
  return s;
}

function send(server: GameServer, session: any, msg: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...msg }));
}

function standAtMerchant(sim: any, pid: number): void {
  let merchant: any = null;
  for (const e of sim.entities.values()) if (e.templateId === 'the_merchant') merchant = e;
  if (!merchant) throw new Error('the Merchant was not spawned');
  const e = sim.entities.get(pid);
  e.pos.x = merchant.pos.x;
  e.pos.z = merchant.pos.z;
  e.pos.y = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

describe('market sale dispatch integration', () => {
  beforeEach(async () => {
    // Drain any pending writes from a prior test, then clear the call history
    // but keep the default async impl.
    await marketTrackerIdle();
    saleInsertMock.mockClear();
    snapshotInsertMock.mockClear();
  });

  it('a completed player sale writes exactly one row with the right fields', async () => {
    const server = new GameServer();
    const seller = join(server, fakeWs(), 7, 42, 'Sellera');
    const buyer = join(server, fakeWs(), 8, 43, 'Buyerb');
    const sim = server.sim as any;
    standAtMerchant(sim, seller.pid);
    standAtMerchant(sim, buyer.pid);
    sim.addItem('wolf_fang', 5, seller.pid);

    send(server, seller, { cmd: 'market_list', item: 'wolf_fang', count: 5, price: 1000 });
    const posted = sim.marketListings.find((l: any) => !l.house && l.itemId === 'wolf_fang');
    expect(posted).toBeTruthy();

    sim.players.get(buyer.pid).copper = 5000;
    send(server, buyer, { cmd: 'market_buy', id: posted.id });
    await marketTrackerIdle();

    expect(saleInsertMock).toHaveBeenCalledTimes(1);
    const [, row] = saleInsertMock.mock.calls[0];
    expect(row).toEqual({
      realm: REALM,
      listingId: posted.id,
      itemId: 'wolf_fang',
      quantity: 5,
      totalPriceCopper: 1000,
      house: false,
      instanced: false,
      craftedRecipeId: null,
      buyerCharacterId: 43,
      buyerAccountId: 8,
      sellerCharacterId: 42,
    });
  });

  it('a house purchase records a house row with a null seller', async () => {
    const server = new GameServer();
    const buyer = join(server, fakeWs(), 8, 43, 'Buyerb');
    const sim = server.sim as any;
    standAtMerchant(sim, buyer.pid);
    const house = sim.marketListings.find((l: any) => l.house);
    expect(house).toBeTruthy();

    sim.players.get(buyer.pid).copper = house.price + 100;
    send(server, buyer, { cmd: 'market_buy', id: house.id });
    await marketTrackerIdle();

    expect(saleInsertMock).toHaveBeenCalledTimes(1);
    const [, row] = saleInsertMock.mock.calls[0];
    expect(row).toMatchObject({
      listingId: house.id,
      itemId: house.itemId,
      quantity: house.count,
      totalPriceCopper: house.price,
      house: true,
      sellerCharacterId: null,
      buyerCharacterId: 43,
      buyerAccountId: 8,
    });
  });

  it('a refused buy (cannot afford) writes zero rows', async () => {
    const server = new GameServer();
    const buyer = join(server, fakeWs(), 8, 43, 'Buyerb');
    const sim = server.sim as any;
    standAtMerchant(sim, buyer.pid);
    const house = sim.marketListings.find((l: any) => l.house);

    sim.players.get(buyer.pid).copper = 0;
    send(server, buyer, { cmd: 'market_buy', id: house.id });
    await marketTrackerIdle();
    expect(saleInsertMock).not.toHaveBeenCalled();
  });

  it('a rejecting insert neither throws into dispatch nor stops the next sale writing', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const server = new GameServer();
    const buyer = join(server, fakeWs(), 8, 43, 'Buyerb');
    const sim = server.sim as any;
    standAtMerchant(sim, buyer.pid);
    const house = sim.marketListings.find((l: any) => l.house);
    sim.players.get(buyer.pid).copper = house.price * 3;

    saleInsertMock.mockRejectedValueOnce(new Error('tracker down'));
    expect(() => send(server, buyer, { cmd: 'market_buy', id: house.id })).not.toThrow();
    await marketTrackerIdle();

    send(server, buyer, { cmd: 'market_buy', id: house.id });
    await marketTrackerIdle();

    expect(saleInsertMock).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalledWith('market_tracker sale write failed:', expect.any(Error));
    errSpy.mockRestore();
  });

  it('recordMarketBuy and recordMarketListingSnapshot are fire-and-forget', async () => {
    expect(recordMarketBuy(BUYER, captureMarketBuy([listing()], 1000, 5000), 4000)).toBeUndefined();
    expect(recordMarketListingSnapshot([listing()])).toBeUndefined();
    await marketTrackerIdle();
    expect(saleInsertMock).toHaveBeenCalledTimes(1);
    expect(snapshotInsertMock).toHaveBeenCalledTimes(1);
    // One shared capture timestamp is passed alongside the rows.
    const [, rows, capturedAt] = snapshotInsertMock.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(capturedAt).toBeInstanceOf(Date);
  });

  it('an empty book snapshot writes nothing', async () => {
    recordMarketListingSnapshot([]);
    await marketTrackerIdle();
    expect(snapshotInsertMock).not.toHaveBeenCalled();
  });

  it('the snapshot tick evaluates alerts after the insert and marks the fired one', async () => {
    const loadAlerts = vi.mocked(loadActiveMarketAlerts);
    const markTriggered = vi.mocked(markMarketAlertTriggered);
    loadAlerts.mockResolvedValueOnce([
      { id: 7, itemId: 'wolf_fang', direction: 'below', thresholdCopper: 250 },
      { id: 8, itemId: 'wolf_fang', direction: 'below', thresholdCopper: 100 },
    ]);
    recordMarketListingSnapshot([listing({ itemId: 'wolf_fang', count: 5, price: 1000 })]);
    await marketTrackerIdle();
    expect(snapshotInsertMock).toHaveBeenCalledTimes(1);
    expect(markTriggered).toHaveBeenCalledTimes(1);
    expect(markTriggered).toHaveBeenCalledWith(expect.anything(), 7, 200);
  });
});
