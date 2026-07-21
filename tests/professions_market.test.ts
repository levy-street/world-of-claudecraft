// Issue #1146: World Market integration for gathered and crafted items.
//
// Gathered materials, crafted items, and tools produced by the professions
// system (#1122/#1127 crafting + gathering, #1123/#1135 tool tiers) are all
// plain ItemDef-backed item ids: `InvSlot` (src/sim/types.ts) carries only
// `itemId`/`count`, no instance payload, so there is no fungible-vs-instanced
// split to worry about here (that would only matter if a crafted item ever
// stamped an instance payload; nothing in this repo does that today). This
// suite proves profession items ride the EXISTING generic market.ts path
// (marketList/marketBuy/marketCancel/loadMarket) with no special-casing, and
// reuses the market.test.ts persistence-round-trip and
// save_character_and_market.test.ts atomic-write patterns for a profession
// item, so the historical market bugs (realm scoping #946, save-on-leave
// torn writes #957, unknown-item-drop-on-load) stay covered for this content
// too.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
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

function marketSellerKey(pid: number): string {
  return String(pid);
}

describe('World Market integration: profession items (#1146)', () => {
  it('lists a gathered material fully and sells it: no dupe, no loss', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Gatherer');
    const buyer = sim.addPlayer('mage', 'Buyer');
    standAtMerchant(sim, seller);
    standAtMerchant(sim, buyer);
    sim.addItem('bone_fragments', 5, seller);
    sim.players.get(buyer)!.copper = 1000;
    sim.events.length = 0;

    // list the WHOLE stack (the fully-listed case the acceptance criteria calls out)
    sim.marketList('bone_fragments', 5, 200, seller);
    expect(errorsSince(sim)).toEqual([]);
    expect(sim.countItem('bone_fragments', seller)).toBe(0); // fully escrowed, none left behind

    const listing = sim.marketListings.find(
      (l) => l.sellerKey === marketSellerKey(seller) && l.itemId === 'bone_fragments',
    )!;
    expect(listing.count).toBe(5);
    sim.events.length = 0;

    sim.marketBuy(listing.id, buyer);

    expect(errorsSince(sim)).toEqual([]);
    expect(copperOf(sim, buyer)).toBe(800);
    expect(sim.countItem('bone_fragments', buyer)).toBe(5); // exact quantity, no dupe/loss
    expect(sim.countItem('bone_fragments', seller)).toBe(0); // seller keeps none
    expect(sim.marketListings.some((l) => l.id === listing.id)).toBe(false);
    // 5% cut: seller is owed 190, waiting to be collected (no coin created or destroyed)
    const info = sim.marketInfoFor(seller)!;
    expect(info.collectionCopper).toBe(190);
  });

  it('lists a crafted/vendor gathering tool and buys it: no dupe, no loss', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Toolsmith');
    const buyer = sim.addPlayer('rogue', 'Buyer');
    standAtMerchant(sim, seller);
    standAtMerchant(sim, buyer);
    sim.addItem('copper_mining_pick', 1, seller);
    sim.players.get(buyer)!.copper = 500;
    sim.events.length = 0;

    sim.marketList('copper_mining_pick', 1, 90, seller);
    expect(errorsSince(sim)).toEqual([]);
    expect(sim.countItem('copper_mining_pick', seller)).toBe(0);

    const listing = sim.marketListings.find(
      (l) => l.sellerKey === marketSellerKey(seller) && l.itemId === 'copper_mining_pick',
    )!;
    sim.events.length = 0;

    sim.marketBuy(listing.id, buyer);

    expect(errorsSince(sim)).toEqual([]);
    expect(copperOf(sim, buyer)).toBe(410);
    expect(sim.countItem('copper_mining_pick', buyer)).toBe(1);
    expect(sim.countItem('copper_mining_pick', seller)).toBe(0);
    expect(sim.marketListings.some((l) => l.id === listing.id)).toBe(false);
  });

  it('lists a crafted weapon from the recipe path and reclaims it (escrow round trip)', () => {
    const sim = makeWorld();
    const crafter = sim.addPlayer('warrior', 'Crafter');
    standAtMerchant(sim, crafter);
    sim.addItem('eastbrook_arming_sword', 1, crafter);
    sim.events.length = 0;

    sim.marketList('eastbrook_arming_sword', 1, 500, crafter);
    expect(errorsSince(sim)).toEqual([]);
    expect(sim.countItem('eastbrook_arming_sword', crafter)).toBe(0);

    const listing = sim.marketListings.find(
      (l) => l.sellerKey === marketSellerKey(crafter) && l.itemId === 'eastbrook_arming_sword',
    )!;
    sim.marketCancel(listing.id, crafter);

    expect(sim.countItem('eastbrook_arming_sword', crafter)).toBe(1); // no dupe, no loss
    expect(sim.marketListings.some((l) => l.id === listing.id)).toBe(false);
  });

  it('survives a save/load round-trip with a mix of gathered, crafted, and tool items', () => {
    // Profession-item variant of the existing market.test.ts persistence test.
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    const buyer = sim.addPlayer('mage', 'Buyer');
    standAtMerchant(sim, seller);
    standAtMerchant(sim, buyer);
    sim.addItem('bone_fragments', 4, seller);
    sim.addItem('copper_mining_pick', 1, seller);
    sim.addItem('eastbrook_wool_trousers', 1, seller);
    sim.players.get(buyer)!.copper = 2000;

    sim.marketList('bone_fragments', 2, 100, seller); // sells -> collection gold
    sim.marketList('copper_mining_pick', 1, 90, seller); // stays listed
    sim.marketList('eastbrook_wool_trousers', 1, 400, seller); // stays listed
    sim.marketBuy(
      sim.marketListings.find(
        (l) => l.sellerKey === marketSellerKey(seller) && l.itemId === 'bone_fragments',
      )!.id,
      buyer,
    );

    const save = sim.serializeMarket();
    const stillListed = save.listings.filter((l) => l.sellerKey === marketSellerKey(seller));
    expect(stillListed.length).toBe(2); // the two unsold profession listings

    const sim2 = makeWorld();
    const houseBefore = sim2.marketListings.length;
    sim2.loadMarket(save);

    const loadedTool = sim2.marketListings.find((l) => l.itemId === 'copper_mining_pick');
    const loadedGear = sim2.marketListings.find((l) => l.itemId === 'eastbrook_wool_trousers');
    expect(loadedTool).toMatchObject({ sellerKey: marketSellerKey(seller), count: 1, price: 90 });
    expect(loadedGear).toMatchObject({ sellerKey: marketSellerKey(seller), count: 1, price: 400 });
    // house stock reseeded exactly once, never duplicated from the save
    expect(sim2.marketListings.filter((l) => l.house).length).toBe(houseBefore);
    // the material sale proceeds carried across (100 - 5% = 95)
    // reach into the private collection map: sim2 has no live player for the seller pid,
    // so the public marketInfoFor cannot resolve the key here.
    const col = (
      sim2.market as unknown as { marketCollections: Map<string, { copper: number }> }
    ).marketCollections.get(marketSellerKey(seller));
    expect(col?.copper).toBe(95);

    // buyer can still collect their bought material, and quantities stay exact
    expect(sim.countItem('bone_fragments', buyer)).toBe(2);
    expect(sim.countItem('bone_fragments', seller)).toBe(2); // 4 - 2 listed
  });
});

// Save-on-leave regression (#957 pattern from tests/save_character_and_market.test.ts):
// the leave path must flush a character's bags AND the World Market row in ONE
// transaction, so a profession item escrowed into a listing right before an
// immediate disconnect can never be vaporized (write lands on characters but not
// world_state) or duplicated (write lands on world_state but the bag debit is lost).
const dbMock = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    return { query: dbMock.query, connect: dbMock.connect };
  },
}));

describe('save-on-leave atomicity for a profession-item listing (#1146)', () => {
  beforeEach(() => {
    dbMock.query.mockReset();
    dbMock.connect.mockReset();
  });

  it('writes the escrowed character bags and the market listing in one transaction', async () => {
    const { saveCharacterAndMarketState, openMarketWriteGate, closeMarketWriteGateForTests } =
      await import('../server/db');
    openMarketWriteGate();
    try {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: vi.fn(),
      };
      dbMock.connect.mockResolvedValueOnce(client as any);

      const sim = makeWorld();
      const seller = sim.addPlayer('warrior', 'Gatherer');
      standAtMerchant(sim, seller);
      sim.addItem('bone_fragments', 3, seller);
      sim.marketList('bone_fragments', 3, 150, seller); // escrows the whole stack right before "disconnect"

      const state = sim.serializeCharacter(seller);
      expect(state).not.toBeNull();
      const market = sim.serializeMarket();

      const mail = sim.serializeMail();
      await saveCharacterAndMarketState(1, sim.entities.get(seller)!.level, state!, market, mail);

      const sqls = client.query.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(sqls[0]).toMatch(/^BEGIN/);
      expect(sqls[sqls.length - 1]).toMatch(/^COMMIT/);
      expect(sqls.some((s: string) => /ROLLBACK/.test(s))).toBe(false);
      expect(sqls.some((s: string) => /UPDATE characters/i.test(s))).toBe(true);
      expect(sqls.some((s: string) => /world_state/i.test(s))).toBe(true);
      // both writes rode the SAME client, so a crash mid-write cannot leave one
      // half applied without the other (the escrow can never be torn).
      expect(dbMock.query).not.toHaveBeenCalled();
      expect(client.release).toHaveBeenCalled();
      // the escrowed material is out of bags and only present as a market listing
      expect((state as unknown as { inventory: { itemId: string }[] }).inventory ?? []).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ itemId: 'bone_fragments' })]),
      );
      expect(market.listings.some((l) => l.itemId === 'bone_fragments')).toBe(true);
    } finally {
      closeMarketWriteGateForTests();
    }
  });
});
