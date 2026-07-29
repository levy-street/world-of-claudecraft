// World Market instanced listings (#1165 completion): a signed / enchanted /
// masterwork copy that is NOT transfer-locked lists as itself (single-copy),
// and its payload survives every arm of the listing lifecycle byte-equal:
// escrow, browse (trimmed display), buy, cancel, expiry return, collect, and
// the JSONB save/load round trip. Armed (bindOnTrade) and bound (boundTo)
// copies are refused with the localized denial; the plain fungible path stays
// byte-identical. Probes the REAL Sim delegates plus the mocked-db GameServer
// wire (the market_query_game.test.ts harness).

import { describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
  setCharacterHotbarLayout: vi.fn(async () => {}),
}));

import { GameServer } from '../server/game';
import { Sim } from '../src/sim/sim';
import type { Entity, ItemInstancePayload, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const BOOTS = 'oiled_boots'; // armor, stack 1
const HIDE = 'pristine_hide'; // junk rare material, stack 20
const SCALE = 'mudfin_scale'; // filler

const makeWorld = () => new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });

function merchant(sim: Sim): Entity {
  for (const e of sim.entities.values()) if (e.templateId === 'the_merchant') return e;
  throw new Error('the Merchant was not spawned');
}

function standAtMerchant(sim: Sim, pid: number): void {
  const m = merchant(sim);
  const e = sim.entities.get(pid);
  if (!e) throw new Error('missing player');
  e.pos.x = m.pos.x;
  e.pos.z = m.pos.z;
  e.pos.y = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

function metaOf(sim: Sim, pid: number) {
  const r = sim.ctx.resolve(pid);
  if (!r) throw new Error('no player meta');
  return r.meta;
}

function slotsOf(sim: Sim, pid: number, itemId: string) {
  return metaOf(sim, pid).inventory.filter((s) => s.itemId === itemId);
}

function errorTexts(events: SimEvent[]): string[] {
  return events.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text);
}

function playerListings(sim: Sim) {
  return sim.marketListings.filter((l) => !l.house);
}

const ENCHANTED: ItemInstancePayload = {
  enchant: 'ench_stat_str',
  rolled: { stats: { str: 2 } },
};
const SIGNED: ItemInstancePayload = { signer: 'Lister' };
const ARMED: ItemInstancePayload = { bindOnTrade: true };
const STAMPED: ItemInstancePayload = { bindOnTrade: true, boundTo: 999 };
const CHARGED: ItemInstancePayload = { signer: 'Lister', charges: { zap: 2 } };

function marketSetup() {
  const sim = makeWorld();
  const pid = sim.addPlayer('warrior', 'Lister');
  standAtMerchant(sim, pid);
  sim.players.get(pid)!.copper = 100000;
  sim.drainEvents();
  return { sim, pid };
}

describe('marketListInstance: escrow', () => {
  it('lists the exact instanced copy (count 1) and leaves the plain stack alone', () => {
    const { sim, pid } = marketSetup();
    sim.addItem(BOOTS, 1, pid);
    sim.addItemInstance(BOOTS, { ...ENCHANTED, rolled: { stats: { str: 2 } } }, pid);
    sim.marketListInstance(BOOTS, 500, ENCHANTED, pid);
    expect(errorTexts(sim.drainEvents())).toHaveLength(0);
    const mine = playerListings(sim);
    expect(mine).toHaveLength(1);
    expect(mine[0].count).toBe(1);
    expect(mine[0].price).toBe(500);
    expect(mine[0].instance).toEqual(ENCHANTED);
    const left = slotsOf(sim, pid, BOOTS);
    expect(left).toHaveLength(1);
    expect(left[0].instance).toBeUndefined();
  });

  it('refuses an armed (bindOnTrade) copy with the localized bound denial, no escrow', () => {
    const { sim, pid } = marketSetup();
    sim.addItemInstance(HIDE, { ...ARMED }, pid);
    sim.marketListInstance(HIDE, 100, ARMED, pid);
    expect(errorTexts(sim.drainEvents())).toContain('That item is bound and cannot be listed.');
    expect(playerListings(sim)).toHaveLength(0);
    expect(slotsOf(sim, pid, HIDE)[0].instance).toEqual(ARMED);
  });

  it('refuses a stamped (boundTo) copy identically', () => {
    const { sim, pid } = marketSetup();
    sim.addItemInstance(HIDE, { ...STAMPED }, pid);
    sim.marketListInstance(HIDE, 100, STAMPED, pid);
    expect(errorTexts(sim.drainEvents())).toContain('That item is bound and cannot be listed.');
    expect(playerListings(sim)).toHaveLength(0);
    expect(slotsOf(sim, pid, HIDE)[0].instance).toEqual(STAMPED);
  });

  it('refuses a payload the player does not hold, distinct from the bound denial', () => {
    const { sim, pid } = marketSetup();
    sim.addItemInstance(HIDE, { signer: 'SomeoneElse' }, pid);
    sim.marketListInstance(HIDE, 100, SIGNED, pid);
    expect(errorTexts(sim.drainEvents())).toContain('You do not have that many to sell.');
    expect(playerListings(sim)).toHaveLength(0);
  });
});

describe('marketBuy / marketCancel: the payload crosses intact', () => {
  it('buy delivers the byte-equal payload and pays the seller less the cut', () => {
    const { sim, pid } = marketSetup();
    const buyer = sim.addPlayer('mage', 'Buyer');
    standAtMerchant(sim, buyer);
    sim.players.get(buyer)!.copper = 100000;
    sim.addItemInstance(BOOTS, { ...ENCHANTED, rolled: { stats: { str: 2 } } }, pid);
    sim.marketListInstance(BOOTS, 1000, ENCHANTED, pid);
    const id = playerListings(sim)[0].id;
    sim.drainEvents();
    sim.marketBuy(id, buyer);
    expect(errorTexts(sim.drainEvents())).toHaveLength(0);
    const got = slotsOf(sim, buyer, BOOTS);
    expect(got).toHaveLength(1);
    expect(got[0].instance).toEqual(ENCHANTED);
    expect(playerListings(sim)).toHaveLength(0);
    expect(sim.players.get(buyer)!.copper).toBe(100000 - 1000);
    // Proceeds (less the 5% cut) wait in the seller's collection.
    sim.marketCollect(pid);
    expect(sim.players.get(pid)!.copper).toBe(100000 + 950);
  });

  it('buy capacity-models the payload: plain-stack room is not instanced room', () => {
    const { sim, pid } = marketSetup();
    const buyer = sim.addPlayer('mage', 'Buyer');
    standAtMerchant(sim, buyer);
    sim.players.get(buyer)!.copper = 100000;
    sim.addItemInstance(HIDE, { ...SIGNED }, pid);
    sim.marketListInstance(HIDE, 100, SIGNED, pid);
    const id = playerListings(sim)[0].id;
    // Fill the buyer's 16 slots; one is a PLAIN hide stack with room. A plain
    // grant would top it up, but the signed copy needs its own slot: refuse.
    const buyerMeta = metaOf(sim, buyer);
    buyerMeta.inventory.length = 0;
    sim.addItem(HIDE, 1, buyer);
    while (buyerMeta.inventory.length < 16) {
      sim.addItemInstance(SCALE, { signer: `F${buyerMeta.inventory.length}` }, buyer);
    }
    sim.drainEvents();
    sim.marketBuy(id, buyer);
    expect(errorTexts(sim.drainEvents())).toContain('Your bags are full.');
    expect(playerListings(sim)).toHaveLength(1);
    expect(sim.players.get(buyer)!.copper).toBe(100000);
    // A byte-equal signed stack with room IS instanced room: the buy lands.
    const plainIdx = buyerMeta.inventory.findIndex((s) => s.itemId === HIDE && !s.instance);
    buyerMeta.inventory[plainIdx] = { itemId: HIDE, count: 1, instance: { ...SIGNED } };
    sim.marketBuy(id, buyer);
    expect(errorTexts(sim.drainEvents())).toHaveLength(0);
    const merged = slotsOf(sim, buyer, HIDE).filter((s) => s.instance);
    expect(merged).toHaveLength(1);
    expect(merged[0].count).toBe(2);
    expect(merged[0].instance).toEqual(SIGNED);
  });

  it('cancel returns the exact payload to the seller', () => {
    const { sim, pid } = marketSetup();
    sim.addItemInstance(BOOTS, { ...ENCHANTED, rolled: { stats: { str: 2 } } }, pid);
    sim.marketListInstance(BOOTS, 500, ENCHANTED, pid);
    const id = playerListings(sim)[0].id;
    sim.drainEvents();
    sim.marketCancel(id, pid);
    expect(errorTexts(sim.drainEvents())).toHaveLength(0);
    expect(playerListings(sim)).toHaveLength(0);
    const back = slotsOf(sim, pid, BOOTS);
    expect(back).toHaveLength(1);
    expect(back[0].instance).toEqual(ENCHANTED);
  });
});

describe('expiry and collect: the return flight keeps the payload', () => {
  it('an expired instanced listing waits in the collection with its payload and collects intact', () => {
    const { sim, pid } = marketSetup();
    sim.addItemInstance(BOOTS, { ...ENCHANTED, rolled: { stats: { str: 2 } } }, pid);
    sim.marketListInstance(BOOTS, 500, ENCHANTED, pid);
    const listing = playerListings(sim)[0];
    listing.expiresAt = sim.time - 1;
    for (let i = 0; i < 20; i++) sim.tick();
    expect(playerListings(sim)).toHaveLength(0);
    const info = sim.marketInfoFor(pid);
    expect(info?.collectionItems).toHaveLength(1);
    expect(info?.collectionItems[0].instance).toEqual(ENCHANTED);
    sim.drainEvents();
    sim.marketCollect(pid);
    expect(errorTexts(sim.drainEvents())).toHaveLength(0);
    const back = slotsOf(sim, pid, BOOTS);
    expect(back).toHaveLength(1);
    expect(back[0].instance).toEqual(ENCHANTED);
  });
});

describe('browse rows: the display payload is trimmed to the public allowlist', () => {
  it('wires signer/enchant/rolled and never charges; plain rows carry no instance key', () => {
    const { sim, pid } = marketSetup();
    sim.addItemInstance(HIDE, { ...CHARGED, charges: { zap: 2 } }, pid);
    sim.marketListInstance(HIDE, 100, CHARGED, pid);
    sim.addItem(HIDE, 3, pid);
    sim.marketList(HIDE, 3, 100, pid);
    const info = sim.marketInfoFor(pid);
    const rows = info!.listings.filter((l) => l.mine);
    expect(rows).toHaveLength(2);
    const instanced = rows.find((l) => l.instance);
    const plain = rows.find((l) => !l.instance);
    // Trimmed: the signature survives for the maker's mark, charges never wire.
    expect(instanced?.instance).toEqual({ signer: 'Lister' });
    expect(instanced?.count).toBe(1);
    // The plain row must not even carry the key (wire byte-identity).
    expect(plain !== undefined && 'instance' in plain).toBe(false);
    // The book itself keeps the FULL payload for delivery.
    expect(playerListings(sim).find((l) => l.instance)?.instance).toEqual(CHARGED);
  });

  it('trims boundTo/bindOnTrade from a payload that was bound AFTER listing-time checks', () => {
    // Defence in depth for the projection itself: hand-write a locked payload
    // into the book (no live path mints one) and confirm the wire never shows
    // the lock fields.
    const { sim, pid } = marketSetup();
    sim.marketListings.push({
      id: 900001,
      sellerKey: String(pid),
      sellerName: 'Lister',
      itemId: HIDE,
      count: 1,
      price: 100,
      expiresAt: sim.time + 1000,
      house: false,
      instance: { signer: 'Lister', bindOnTrade: true, boundTo: 7 },
    });
    const row = sim.marketInfoFor(pid)!.listings.find((l) => l.instance);
    expect(row?.instance).toEqual({ signer: 'Lister' });
  });
});

describe('persistence: instanced listings and collections round-trip the JSONB save', () => {
  it('listing payload survives serialize -> JSON -> load byte-equal; plain rows unchanged', () => {
    const { sim, pid } = marketSetup();
    sim.addItemInstance(BOOTS, { ...ENCHANTED, rolled: { stats: { str: 2 } } }, pid);
    sim.marketListInstance(BOOTS, 500, ENCHANTED, pid);
    sim.addItem(HIDE, 3, pid);
    sim.marketList(HIDE, 3, 100, pid);
    const save = JSON.parse(JSON.stringify(sim.serializeMarket()));
    const plainRow = save.listings.find((l: { instance?: unknown }) => !l.instance);
    expect(Object.keys(plainRow).sort()).toEqual([
      'count',
      'id',
      'itemId',
      'price',
      'secondsLeft',
      'sellerKey',
      'sellerName',
    ]);
    const sim2 = makeWorld();
    sim2.loadMarket(save);
    const loaded = sim2.marketListings.filter((l) => !l.house);
    expect(loaded).toHaveLength(2);
    expect(loaded.find((l) => l.instance)?.instance).toEqual(ENCHANTED);
  });

  it('a tampered instanced listing count clamps to the single-copy contract on load', () => {
    const { sim, pid } = marketSetup();
    sim.addItemInstance(BOOTS, { ...ENCHANTED, rolled: { stats: { str: 2 } } }, pid);
    sim.marketListInstance(BOOTS, 500, ENCHANTED, pid);
    const save = JSON.parse(JSON.stringify(sim.serializeMarket()));
    save.listings[0].count = 5;
    const sim2 = makeWorld();
    sim2.loadMarket(save);
    expect(sim2.marketListings.filter((l) => !l.house)[0].count).toBe(1);
  });

  it('an instanced collection return survives the save round trip', () => {
    const { sim, pid } = marketSetup();
    sim.addItemInstance(BOOTS, { ...ENCHANTED, rolled: { stats: { str: 2 } } }, pid);
    sim.marketListInstance(BOOTS, 500, ENCHANTED, pid);
    playerListings(sim)[0].expiresAt = sim.time - 1;
    for (let i = 0; i < 20; i++) sim.tick();
    const save = JSON.parse(JSON.stringify(sim.serializeMarket()));
    const sim2 = makeWorld();
    sim2.loadMarket(save);
    const pid2 = sim2.addPlayer('warrior', 'Lister');
    standAtMerchant(sim2, pid2);
    const info = sim2.marketInfoFor(pid2);
    expect(info?.collectionItems).toHaveLength(1);
    expect(info?.collectionItems[0].instance).toEqual(ENCHANTED);
  });
});

describe('persistence: pre-payload saves and size bounds', () => {
  it('a v0.31-shape save (no instance keys) round-trips byte-identically', () => {
    const oldSave = {
      listings: [
        {
          id: 1000,
          sellerKey: '7',
          sellerName: 'Old Seller',
          itemId: HIDE,
          count: 3,
          price: 250,
          secondsLeft: 1000,
        },
      ],
      collections: [{ key: '7', copper: 120, items: [{ itemId: HIDE, count: 2 }] }],
      nextListingId: 1001,
    };
    const sim = makeWorld();
    sim.loadMarket(JSON.parse(JSON.stringify(oldSave)));
    const reserialized = JSON.parse(JSON.stringify(sim.serializeMarket()));
    expect(reserialized.listings).toEqual(oldSave.listings);
    expect(reserialized.collections).toEqual(oldSave.collections);
  });

  it('loadMarket runs the shared payload bound on listings AND collections', () => {
    // The listing arm used to bypass even sanitizeEscrowSlot; both routes now
    // bound on the real load path. A junk payload downgrades the row to
    // dormant plain data instead of riding every market save.
    const sim = makeWorld();
    sim.loadMarket(
      JSON.parse(
        JSON.stringify({
          listings: [
            {
              id: 900,
              sellerKey: 'k1',
              sellerName: 'Seller',
              itemId: HIDE,
              count: 500,
              price: 100,
              instance: { signer: 'x'.repeat(5000) },
              secondsLeft: 1000,
            },
          ],
          collections: [
            { key: '7', copper: 0, items: [{ itemId: HIDE, count: 2, instance: [1, 2, 3] }] },
          ],
          nextListingId: 1001,
        }),
      ),
    );
    const out = JSON.parse(JSON.stringify(sim.serializeMarket()));
    const listing = out.listings.find((l: { id: number }) => l.id === 900);
    expect(listing.itemId).toBe(HIDE);
    expect(listing.instance).toBeUndefined();
    // The single-copy clamp keys on the RAW row's instance: a bound-rejected
    // payload must not launder an inflated count through corrupt bytes (the
    // round 5 finder caught the clamp reading the bound's output).
    expect(listing.count).toBe(1);
    // The clone-mangled array instance dropped whole; the collection item
    // survives plain with its count.
    const coll = out.collections.find((c: { key: string }) => c.key === '7');
    expect(coll.items[0]).toEqual({ itemId: HIDE, count: 2 });
  });

  it('rekeyMarketSeller follows the escrowed payload signers too (the fix-round completion)', () => {
    // The ownership keys were rekeyed but the escrowed copies kept the dead
    // name, so a cancel or expiry handed back a copy whose discount no
    // longer answered to its owner. Foreign signers stay untouched (the
    // accepted craftedBy limitation).
    const sim = makeWorld();
    sim.loadMarket(
      JSON.parse(
        JSON.stringify({
          listings: [
            {
              id: 901,
              sellerKey: 'Oldname',
              sellerName: 'Oldname',
              itemId: HIDE,
              count: 1,
              price: 100,
              instance: { signer: 'Oldname' },
              secondsLeft: 1000,
            },
            {
              id: 902,
              sellerKey: 'Stranger',
              sellerName: 'Stranger',
              itemId: HIDE,
              count: 1,
              price: 100,
              instance: { signer: 'Oldname' },
              secondsLeft: 1000,
            },
          ],
          collections: [
            {
              key: '77',
              copper: 0,
              items: [{ itemId: HIDE, count: 1, instance: { signer: 'Oldname' } }],
            },
          ],
          nextListingId: 1001,
        }),
      ),
    );
    expect(sim.rekeyMarketSeller(77, 'Oldname', 'Newname')).toBe(true);
    const out = JSON.parse(JSON.stringify(sim.serializeMarket()));
    const own = out.listings.find((l: { id: number }) => l.id === 901);
    const foreign = out.listings.find((l: { id: number }) => l.id === 902);
    expect(own.sellerKey).toBe('77');
    expect(own.instance).toEqual({ signer: 'Newname' });
    expect(foreign.instance, 'a stranger listing is foreign-held').toEqual({ signer: 'Oldname' });
    const coll = out.collections.find((c: { key: string }) => c.key === '77');
    expect(coll.items[0].instance).toEqual({ signer: 'Newname' });
  });

  it('a maximally instanced seller book serializes inside a stated byte budget', () => {
    // 12 fully-instanced listings (the per-seller cap) with worst-case-ish
    // payloads must stay small: a future ItemInstancePayload field that
    // inflates every persisted row should fail here, not a production autosave.
    const { sim, pid } = marketSetup();
    for (let i = 0; i < 12; i++) {
      const payload: ItemInstancePayload = {
        signer: 'A'.repeat(24),
        enchant: 'enchant_feet_agility',
        rolled: { quality: 'epic', stats: { str: 9, agi: 9, sta: 9, int: 9, spi: 9 } },
      };
      sim.addItemInstance(HIDE, payload, pid);
      sim.marketListInstance(HIDE, 100, payload, pid);
    }
    expect(playerListings(sim)).toHaveLength(12);
    const bytes = JSON.stringify(sim.serializeMarket()).length;
    expect(bytes).toBeLessThan(8192);
  });
});

describe('wire: market_list_instance over the mocked-db GameServer', () => {
  function fakeWs() {
    const sent: { t: string; [k: string]: unknown }[] = [];
    return {
      sent,
      ws: { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) } as unknown as WebSocket,
    };
  }

  it('lists the payload-selected copy and streams the trimmed row back in the snapshot', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = server.join(fc.ws, 1, 1, 'Lister', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;
    const sim = server.sim;
    const pid = session.pid;
    standAtMerchant(sim, pid);
    sim.addItemInstance(BOOTS, { ...ENCHANTED, rolled: { stats: { str: 2 } } }, pid);

    server.handleMessage(
      session,
      JSON.stringify({
        t: 'cmd',
        cmd: 'market_list_instance',
        item: BOOTS,
        price: 500,
        instance: ENCHANTED,
      }),
    );
    const mine = sim.marketListings.filter((l) => !l.house);
    expect(mine).toHaveLength(1);
    // The book stores the copy the SIM removed from the bags, never the wire
    // object: escrow came out of the inventory slot.
    expect(mine[0].instance).toEqual(ENCHANTED);
    expect(slotsOf(sim, pid, BOOTS)).toHaveLength(0);

    (server as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();
    const snaps = fc.sent.filter((m) => m.t === 'snap');
    const last = snaps[snaps.length - 1] as unknown as {
      self?: { market?: { listings: { instance?: ItemInstancePayload }[] } };
    };
    const row = last.self?.market?.listings.find((l) => l.instance);
    expect(row?.instance).toEqual({ enchant: 'ench_stat_str', rolled: { stats: { str: 2 } } });
  });

  it('a wire payload the player does not hold escrows nothing and mints nothing', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = server.join(fc.ws, 1, 1, 'Lister', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;
    standAtMerchant(server.sim, session.pid);
    server.handleMessage(
      session,
      JSON.stringify({
        t: 'cmd',
        cmd: 'market_list_instance',
        item: BOOTS,
        price: 500,
        instance: { signer: 'Forged', enchant: 'ench_stat_str' },
      }),
    );
    expect(server.sim.marketListings.filter((l) => !l.house)).toHaveLength(0);
  });
});
