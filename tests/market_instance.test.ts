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
  insertBankLedgerRows: vi.fn(async () => {}),
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
// The signed-material filler this file used to pack bags with is gone: signed
// material now shares one stack, so it could never reach the slot cap. The
// non-material SWORD below is the replacement.

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

// A legacy `signer` is no longer a payload field on a MATERIAL: it projects
// into the row's source buckets. This reads them, so the ownership assertions
// below still pin the exact units they always did, at their new home.
type SourceCarrier = {
  materialSources?: readonly { source: { signer?: string }; count: number }[];
};

/** signer -> unit count over a row's buckets; unrecorded units key as `-`. */
function signerCounts(row: SourceCarrier | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const bucket of row?.materialSources ?? []) {
    const key = bucket.source.signer ?? '-';
    out[key] = (out[key] ?? 0) + bucket.count;
  }
  return out;
}

// Non-material controls: a stackable food and an unstackable weapon, so the
// cases that must prove nothing changed outside the material taxonomy can.
const BREAD = 'baked_bread';
const SWORD = 'worn_sword';

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

  /** Fill every remaining backpack slot with copies that really occupy one slot
   *  each. Deliberately a NON-material unstackable: filling with signed
   *  material would now share one stack and never reach the cap. */
  function fillBackpack(sim: Sim, pid: number): void {
    const meta = metaOf(sim, pid);
    while (meta.inventory.length < 16) sim.addItem(SWORD, 1, pid);
  }

  it('buy capacity-models a MATERIAL through the shared stack: a compatible stack IS room', () => {
    // This case used to prove "plain-stack room is not instanced room". For a
    // material that is exactly the distinction the shared-stack rule removes: a
    // Lister-signed unit and an unrecorded unit are compatible, so the plain
    // hide stack really does have room and the buy really does land. The two
    // controls below keep the original claim where it still holds.
    const { sim, pid } = marketSetup();
    const buyer = sim.addPlayer('mage', 'Buyer');
    standAtMerchant(sim, buyer);
    sim.players.get(buyer)!.copper = 100000;
    sim.addItemInstance(HIDE, { ...SIGNED }, pid);
    sim.marketListInstance(HIDE, 100, SIGNED, pid);
    const id = playerListings(sim)[0].id;
    const buyerMeta = metaOf(sim, buyer);
    buyerMeta.inventory.length = 0;
    sim.addItem(HIDE, 1, buyer);
    fillBackpack(sim, buyer);
    expect(buyerMeta.inventory).toHaveLength(16);

    sim.drainEvents();
    sim.marketBuy(id, buyer);

    expect(errorTexts(sim.drainEvents())).toHaveLength(0);
    expect(playerListings(sim)).toHaveLength(0);
    // No new slot, and the unit arrived with its owner intact.
    expect(buyerMeta.inventory).toHaveLength(16);
    const hide = slotsOf(sim, buyer, HIDE);
    expect(hide).toHaveLength(1);
    expect(hide[0].count).toBe(2);
    expect(signerCounts(hide[0])).toEqual({ '-': 1, Lister: 1 });
  });

  it('buy still refuses an ENCHANTED copy with no slot for it', () => {
    // The control that keeps the original capacity claim: an enchanted payload
    // is not compatible with a plain stack, so it needs a free slot whatever
    // its source says, and the buyer is not charged when it cannot land.
    const { sim, pid } = marketSetup();
    const buyer = sim.addPlayer('mage', 'Buyer');
    standAtMerchant(sim, buyer);
    sim.players.get(buyer)!.copper = 100000;
    sim.addItemInstance(HIDE, { ...ENCHANTED }, pid);
    sim.marketListInstance(HIDE, 100, ENCHANTED, pid);
    const id = playerListings(sim)[0].id;
    const buyerMeta = metaOf(sim, buyer);
    buyerMeta.inventory.length = 0;
    sim.addItem(HIDE, 1, buyer);
    fillBackpack(sim, buyer);

    sim.drainEvents();
    sim.marketBuy(id, buyer);
    expect(errorTexts(sim.drainEvents())).toContain('Your bags are full.');
    expect(playerListings(sim)).toHaveLength(1);
    expect(sim.players.get(buyer)!.copper).toBe(100000);

    // Free a slot and the same buy lands with its payload intact.
    buyerMeta.inventory.pop();
    sim.marketBuy(id, buyer);
    expect(errorTexts(sim.drainEvents())).toHaveLength(0);
    const got = slotsOf(sim, buyer, HIDE).filter((s) => s.instance?.enchant);
    expect(got).toHaveLength(1);
    expect(got[0].instance).toEqual(ENCHANTED);
  });

  it('buy capacity for a NON-material is unchanged: plain room is not instanced room', () => {
    // The taxonomy control: outside materials the old model holds exactly.
    const { sim, pid } = marketSetup();
    const buyer = sim.addPlayer('mage', 'Buyer');
    standAtMerchant(sim, buyer);
    sim.players.get(buyer)!.copper = 100000;
    sim.addItemInstance(BREAD, { ...SIGNED }, pid);
    sim.marketListInstance(BREAD, 100, SIGNED, pid);
    const id = playerListings(sim)[0].id;
    const buyerMeta = metaOf(sim, buyer);
    buyerMeta.inventory.length = 0;
    sim.addItem(BREAD, 1, buyer);
    fillBackpack(sim, buyer);

    sim.drainEvents();
    sim.marketBuy(id, buyer);
    expect(errorTexts(sim.drainEvents())).toContain('Your bags are full.');
    expect(sim.players.get(buyer)!.copper).toBe(100000);

    // A byte-equal signed stack with room IS instanced room, as it always was.
    const plainIdx = buyerMeta.inventory.findIndex((s) => s.itemId === BREAD && !s.instance);
    buyerMeta.inventory[plainIdx] = { itemId: BREAD, count: 1, instance: { ...SIGNED } };
    sim.marketBuy(id, buyer);
    expect(errorTexts(sim.drainEvents())).toHaveLength(0);
    const merged = slotsOf(sim, buyer, BREAD).filter((s) => s.instance);
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
    // Keyed on the listed COUNT, not on payload presence: a material's payload
    // may now be emptied by the signature moving into its bucket, so `instance`
    // no longer separates the two rows.
    const instanced = rows.find((l) => l.count === 1);
    const plain = rows.find((l) => l.count === 3);
    // Trimmed, same two claims: the signature still reaches the client for the
    // maker's mark (in the source bucket now), and charges STILL never wire.
    expect(signerCounts(instanced as SourceCarrier)).toEqual({ Lister: 1 });
    expect(instanced?.instance?.charges).toBeUndefined();
    expect(instanced?.instance?.signer).toBeUndefined();
    // The plain row carries no instance key (wire byte-identity) and states the
    // provenance of the three units it really holds.
    expect(plain !== undefined && 'instance' in plain).toBe(false);
    expect(signerCounts(plain as SourceCarrier)).toEqual({ '-': 3 });
    // The book itself keeps the FULL payload for delivery: charges intact, and
    // the signature still Lister's.
    const booked = playerListings(sim).find((l) => l.count === 1);
    expect(booked?.instance).toEqual({ charges: { zap: 2 } });
    expect(signerCounts(booked as SourceCarrier)).toEqual({ Lister: 1 });
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
    const plainRow = save.listings.find((l: { itemId: string }) => l.itemId === HIDE);
    // The persisted shape gains exactly ONE key on a material row, and it is
    // the provenance of the units listed. No payload key appears, which is the
    // claim: a plain listing is still plain.
    expect(Object.keys(plainRow).sort()).toEqual([
      'count',
      'id',
      'itemId',
      'materialSources',
      'price',
      'secondsLeft',
      'sellerKey',
      'sellerName',
    ]);
    expect(plainRow.materialSources).toEqual([{ source: {}, count: 3 }]);
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

  it('clamps a legacy signed material listing before it can mint copies on reclaim', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Lister');
    standAtMerchant(sim, pid);
    sim.loadMarket({
      listings: [
        {
          id: 900,
          sellerKey: String(pid),
          sellerName: 'Lister',
          itemId: HIDE,
          count: 500,
          price: 100,
          secondsLeft: 1000,
          instance: { signer: 'Ana' },
        },
      ],
      collections: [],
      nextListingId: 901,
    });

    const listing = playerListings(sim)[0];
    expect(listing.count).toBe(1);
    expect(listing.instance).toBeUndefined();
    expect(signerCounts(listing)).toEqual({ Ana: 1 });

    sim.marketCancel(listing.id, pid);
    const reclaimed = slotsOf(sim, pid, HIDE);
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0].count).toBe(1);
    expect(signerCounts(reclaimed[0])).toEqual({ Ana: 1 });
  });

  it('preserves a validated explicit material composition above one copy on load', () => {
    const sim = makeWorld();
    sim.loadMarket({
      listings: [
        {
          id: 901,
          sellerKey: '7',
          sellerName: 'Lister',
          itemId: HIDE,
          count: 5,
          price: 100,
          secondsLeft: 1000,
          instance: { enchant: 'ench_stat_str' },
          materialSources: [{ source: { signer: 'Ana' }, count: 5 }],
        },
      ],
      collections: [],
      nextListingId: 902,
    });

    const listing = playerListings(sim)[0];
    expect(listing.count).toBe(5);
    expect(listing.instance).toEqual({ enchant: 'ench_stat_str' });
    expect(signerCounts(listing)).toEqual({ Ana: 5 });
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
    // Every field of a pre-payload row survives untouched. A MATERIAL row also
    // states the provenance those units always had and nobody recorded: three
    // unrecorded units listed, two in the collection, exactly the counts held.
    // The projection is additive and lossless, so the rows are asserted whole.
    expect(reserialized.listings).toEqual([
      { ...oldSave.listings[0], materialSources: [{ source: {}, count: 3 }] },
    ]);
    expect(reserialized.collections).toEqual([
      {
        ...oldSave.collections[0],
        items: [{ itemId: HIDE, count: 2, materialSources: [{ source: {}, count: 2 }] }],
      },
    ]);
    // Nothing invented: no gatherer and no signature on a save that had none.
    expect(signerCounts(reserialized.listings[0])).toEqual({ '-': 3 });
  });

  it('a NON-material v0.31 save round-trips byte-identically, source list and all', () => {
    // The control for the projection above: outside the material taxonomy a
    // pre-payload save is still byte-for-byte what it was, with no new key.
    const oldSave = {
      listings: [
        {
          id: 1002,
          sellerKey: '7',
          sellerName: 'Old Seller',
          itemId: BREAD,
          count: 3,
          price: 250,
          secondsLeft: 1000,
        },
      ],
      collections: [{ key: '7', copper: 120, items: [{ itemId: BREAD, count: 2 }] }],
      nextListingId: 1003,
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
    // survives plain with its count, and a material states that count's
    // provenance as the unrecorded units it always was.
    const coll = out.collections.find((c: { key: string }) => c.key === '7');
    expect(coll.items[0]).toEqual({
      itemId: HIDE,
      count: 2,
      materialSources: [{ source: {}, count: 2 }],
    });
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
    // The rename follows the signature into its new home: the owner's escrowed
    // unit re-keys in the SOURCE bucket, one unit each, and the stranger's
    // listing is untouched. Renaming the OWNED scope only is the whole claim,
    // and no gatherer snapshot is rewritten by it.
    expect(signerCounts(own)).toEqual({ Newname: 1 });
    expect(signerCounts(foreign), 'a stranger listing is foreign-held').toEqual({ Oldname: 1 });
    expect(own.instance?.signer).toBeUndefined();
    const coll = out.collections.find((c: { key: string }) => c.key === '77');
    expect(signerCounts(coll.items[0])).toEqual({ Newname: 1 });
  });

  it('a maximally instanced seller book serializes inside a stated byte budget', () => {
    // 12 fully-instanced listings (the per-seller cap) with worst-case-ish
    // payloads must stay small: a future ItemInstancePayload field that
    // inflates every persisted row should fail here, not a production autosave.
    //
    // The signer is the LONGEST LEGAL one (MAX_CRAFTED_BY_LENGTH, which is the
    // 16-character ceiling server/auth.ts enforces on a real character name),
    // not an arbitrarily long string. A 24-character signer is data no account
    // can produce, the shared source model refuses it outright, and measuring a
    // shape that cannot exist told us nothing about a real autosave.
    const MAX_LEGAL_SIGNER = 'A'.repeat(16);
    const { sim, pid } = marketSetup();
    for (let i = 0; i < 12; i++) {
      const payload: ItemInstancePayload = {
        signer: MAX_LEGAL_SIGNER,
        enchant: 'enchant_feet_agility',
        rolled: { quality: 'epic', stats: { str: 9, agi: 9, sta: 9, int: 9, spi: 9 } },
      };
      sim.addItemInstance(HIDE, payload, pid);
      sim.marketListInstance(HIDE, 100, payload, pid);
    }
    expect(playerListings(sim)).toHaveLength(12);
    // The persisted row now also carries the unit's exact source, so the shape
    // being measured is payload PLUS composition. The budget below is the
    // pre-source number and is deliberately NOT raised here: if it fails, the
    // maintainer re-measures the real worst case and states the new number with
    // its decomposition, rather than a worker widening it to whatever passed.
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
