// The buy-order board on the live Market (src/sim/market_orders.ts through
// Market.marketOrderPlace / marketOrderFill / marketOrderCancel): escrow, the
// immediate fill through the shared settlement, delivery into a buyer's
// collection, withdrawal, every refusal arm, the MarketInfo readout, the save
// round trip, and the rename / delete follow-through. The planner's own walk is
// pinned in tests/market_orders_plan.test.ts.
import { describe, expect, it } from 'vitest';
import { bagPools, canGrantCopies } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import { MARKET_CUT } from '../src/sim/market';
import {
  MARKET_MAX_ORDERS,
  MARKET_ORDER_DURATION,
  MARKET_ORDER_MAX_UNITS,
} from '../src/sim/market_orders';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const ORE = 'copper_ore';
const FANG = 'wolf_fang';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
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

function standAtMerchant(sim: Sim, pid: number) {
  const m = merchant(sim);
  const e = entityOf(sim, pid);
  e.pos.x = m.pos.x;
  e.pos.z = m.pos.z;
  e.pos.y = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function errors(sim: Sim): string[] {
  return sim.events.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text);
}

// The market's own loot lines plus the board's log notices; grantCopies'
// "You receive: ..." receipts ride alongside them and are pinned elsewhere.
function loot(sim: Sim, pid: number): string[] {
  return sim.events
    .filter((e) => (e.type === 'loot' || e.type === 'log') && (e as { pid?: number }).pid === pid)
    .map((e) => (e as { text: string }).text)
    .filter((text) => !text.startsWith('You receive: '));
}

function bagCount(sim: Sim, pid: number, itemId: string): number {
  return playerOf(sim, pid).inventory.reduce(
    (n, s) => n + (s.itemId === itemId && !s.instance ? s.count : 0),
    0,
  );
}

function player(sim: Sim, name: string, cls: 'warrior' | 'mage' = 'warrior', copper = 0): number {
  const pid = sim.addPlayer(cls, name);
  standAtMerchant(sim, pid);
  playerOf(sim, pid).copper = copper;
  return pid;
}

function info(sim: Sim, pid: number) {
  const i = sim.marketInfoFor(pid);
  if (!i) throw new Error('no market info');
  return i;
}

describe('marketOrderPlace', () => {
  it('escrows count times bid, opens the order, and shows it first in the readout', () => {
    const sim = makeWorld();
    const buyer = player(sim, 'Buyer', 'mage', 10_000);
    sim.events.length = 0;
    sim.marketOrderPlace(ORE, 5, 30, buyer);
    expect(errors(sim)).toEqual([]);
    expect(playerOf(sim, buyer).copper).toBe(10_000 - 150);
    expect(sim.marketOrders).toHaveLength(1);
    expect(sim.marketOrders[0]).toMatchObject({
      buyerKey: String(buyer),
      buyerName: 'Buyer',
      itemId: ORE,
      count: 5,
      unitPrice: 30,
    });
    expect(loot(sim, buyer)).toEqual(['Placed an order for Copper Ore x5 at 30c each.']);
    const i = info(sim, buyer);
    expect(i.orders).toEqual([
      { id: 1, buyerName: 'Buyer', itemId: ORE, count: 5, unitPrice: 30, mine: true },
    ]);
    expect(i.myOrderCount).toBe(1);
    expect(i.maxOrders).toBe(MARKET_MAX_ORDERS);
  });

  it('fills on the spot from listings at or under the bid, cheapest first, and escrows only the rest', () => {
    const sim = makeWorld();
    const seller = player(sim, 'Seller');
    sim.addItem(ORE, 6, seller);
    sim.marketList(ORE, 2, 40, seller); // 20 each: fills
    sim.marketList(ORE, 1, 25, seller); // 25 each: fills
    sim.marketList(ORE, 3, 120, seller); // 40 each: too dear
    const buyer = player(sim, 'Buyer', 'mage', 10_000);
    sim.events.length = 0;
    const settled = sim.marketOrderPlace(ORE, 5, 30, buyer);
    expect(errors(sim)).toEqual([]);
    expect(settled.map((l) => l.price)).toEqual([40, 25]);
    expect(bagCount(sim, buyer, ORE)).toBe(3);
    // 65 spent on the fills, 2 units still wanted at 30 = 60 escrowed.
    expect(playerOf(sim, buyer).copper).toBe(10_000 - 65 - 60);
    expect(sim.marketOrders).toEqual([
      expect.objectContaining({ itemId: ORE, count: 2, unitPrice: 30 }),
    ]);
    expect(sim.marketListings.filter((l) => !l.house && l.itemId === ORE)).toHaveLength(1);
    expect(loot(sim, buyer)).toEqual([
      'Bought Copper Ore x3 for 65c.',
      'Placed an order for Copper Ore x2 at 30c each.',
    ]);
    // The sellers were paid through the ordinary settlement.
    const sellerInfo = info(sim, seller);
    expect(sellerInfo.collectionCopper).toBe(
      Math.floor(40 * (1 - MARKET_CUT)) + Math.floor(25 * (1 - MARKET_CUT)),
    );
  });

  it('opens no order when the book covers the whole ask', () => {
    const sim = makeWorld();
    const seller = player(sim, 'Seller');
    sim.addItem(ORE, 4, seller);
    sim.marketList(ORE, 4, 40, seller);
    const buyer = player(sim, 'Buyer', 'mage', 1_000);
    sim.events.length = 0;
    sim.marketOrderPlace(ORE, 4, 10, buyer);
    expect(sim.marketOrders).toHaveLength(0);
    expect(bagCount(sim, buyer, ORE)).toBe(4);
    expect(playerOf(sim, buyer).copper).toBe(960);
    expect(loot(sim, buyer)).toEqual(['Bought Copper Ore x4 for 40c.']);
  });

  it("never fills from the buyer's own listings or the Merchant's house stock", () => {
    const sim = makeWorld();
    const house = sim.marketListings.find((l) => l.house);
    if (!house) throw new Error('no house stock');
    const buyer = player(sim, 'Buyer', 'mage', 5_000_000);
    sim.addItem(house.itemId, 1, buyer);
    sim.marketList(house.itemId, 1, 1, buyer);
    sim.events.length = 0;
    sim.marketOrderPlace(house.itemId, 1, house.price + 1, buyer);
    expect(errors(sim)).toEqual([]);
    expect(sim.marketOrders).toEqual([
      expect.objectContaining({ itemId: house.itemId, count: 1, unitPrice: house.price + 1 }),
    ]);
    expect(sim.marketListings.some((l) => l.id === house.id)).toBe(true);
  });

  it('refuses away from the Merchant, unaffordable, over the cap, bad counts, and bad prices', () => {
    const sim = makeWorld();
    const buyer = player(sim, 'Buyer', 'mage', 100);
    const e = entityOf(sim, buyer);
    e.pos.x += 500;
    e.prevPos = { ...e.pos };
    sim.marketOrderPlace(ORE, 1, 1, buyer);
    standAtMerchant(sim, buyer);
    sim.marketOrderPlace(ORE, 1, 101, buyer);
    sim.marketOrderPlace(ORE, 0, 1, buyer);
    sim.marketOrderPlace(ORE, MARKET_ORDER_MAX_UNITS + 1, 1, buyer);
    sim.marketOrderPlace(ORE, 1, 0, buyer);
    sim.marketOrderPlace(ORE, 1, 6_000_000, buyer);
    expect(errors(sim)).toEqual([
      'You are too far from the Merchant.',
      'You cannot afford that.',
      'Name how many you want.',
      'Name how many you want.',
      'Name a price of at least 1 copper.',
      'That price is beyond what the Merchant will broker.',
    ]);
    expect(sim.marketOrders).toHaveLength(0);
    expect(playerOf(sim, buyer).copper).toBe(100);
    playerOf(sim, buyer).copper = 1_000;
    sim.events.length = 0;
    for (let i = 0; i < MARKET_MAX_ORDERS + 1; i++) sim.marketOrderPlace(ORE, 1, 1, buyer);
    expect(sim.marketOrders).toHaveLength(MARKET_MAX_ORDERS);
    expect(errors(sim)).toEqual([`You may keep at most ${MARKET_MAX_ORDERS} orders open at once.`]);
  });

  it('refuses quest items and unmarketable items exactly like a listing', () => {
    const sim = makeWorld();
    const buyer = player(sim, 'Buyer', 'mage', 1_000);
    const quest = Object.values(ITEMS).find((d) => d.kind === 'quest');
    const bound = Object.values(ITEMS).find((d) => d.soulbound && d.kind !== 'quest');
    if (!quest || !bound) throw new Error('catalog lacks a quest or soulbound item');
    sim.marketOrderPlace(quest.id, 1, 1, buyer);
    sim.marketOrderPlace(bound.id, 1, 1, buyer);
    expect(errors(sim)).toEqual([
      'The Merchant will not broker quest items.',
      'That item cannot be listed on the World Market.',
    ]);
  });
});

describe('marketOrderFill', () => {
  function board(sim: Sim) {
    const buyer = player(sim, 'Buyer', 'mage', 10_000);
    sim.marketOrderPlace(ORE, 5, 30, buyer);
    const seller = player(sim, 'Seller');
    sim.addItem(ORE, 8, seller);
    sim.events.length = 0;
    return { buyer, seller, orderId: sim.marketOrders[0].id };
  }

  it("moves the goods to the buyer's collection, pays the deliverer less the cut, and shrinks the order", () => {
    const sim = makeWorld();
    const { buyer, seller, orderId } = board(sim);
    const result = sim.marketOrderFill(orderId, 3, seller);
    expect(errors(sim)).toEqual([]);
    expect(result).toEqual({ units: 3, copper: 90 });
    expect(bagCount(sim, seller, ORE)).toBe(5);
    expect(sim.marketOrders[0].count).toBe(2);
    const proceeds = Math.floor(90 * (1 - MARKET_CUT));
    const sellerInfo = info(sim, seller);
    expect(sellerInfo.collectionCopper).toBe(proceeds);
    expect(sellerInfo.collectionSales).toEqual([
      { itemId: ORE, count: 3, price: 90, proceeds, buyerName: 'Buyer' },
    ]);
    const buyerInfo = info(sim, buyer);
    // Ore is an honest material, so the bucket carries its (unsigned) sources.
    expect(buyerInfo.collectionItems).toEqual([
      { itemId: ORE, count: 3, materialSources: [{ count: 3, source: {} }] },
    ]);
    expect(sim.marketCollectPendingFor(buyer)).toBe(true);
    expect(loot(sim, seller)).toEqual([
      `Delivered Copper Ore x3 to Buyer for 90c - collect ${proceeds}c from the Merchant.`,
    ]);
    expect(loot(sim, buyer)).toEqual([
      'Seller delivered Copper Ore x3 to your order - collect it from the Merchant.',
    ]);
    // The buyer picks the goods up through the ordinary collect path.
    sim.marketCollect(buyer);
    expect(bagCount(sim, buyer, ORE)).toBe(3);
  });

  it('clamps a fill to what the order still wants and closes it at zero', () => {
    const sim = makeWorld();
    const { seller, orderId } = board(sim);
    sim.marketOrderFill(orderId, 50, seller);
    expect(errors(sim)).toEqual([]);
    expect(bagCount(sim, seller, ORE)).toBe(3);
    expect(sim.marketOrders).toHaveLength(0);
  });

  it('refuses your own order, a closed order, too few goods, and a deliverer away from the Merchant', () => {
    const sim = makeWorld();
    const { buyer, seller, orderId } = board(sim);
    sim.marketOrderFill(orderId, 1, buyer);
    sim.marketOrderFill(999, 1, seller);
    // A fill clamps to the order's remainder (5), so 9 is fine with 8 in bags;
    // hold only 3 and the clamped 5 is more than the deliverer has.
    sim.removeItem(ORE, 5, seller);
    sim.marketOrderFill(orderId, 9, seller);
    sim.addItem(ORE, 5, seller);
    const e = entityOf(sim, seller);
    e.pos.x += 500;
    e.prevPos = { ...e.pos };
    sim.marketOrderFill(orderId, 1, seller);
    expect(errors(sim)).toEqual([
      'That is your own order - cancel it to withdraw it.',
      'That order is no longer open.',
      'You do not have that many to sell.',
      'You must bring your goods to the Merchant.',
    ]);
    expect(sim.marketOrders[0].count).toBe(5);
    expect(bagCount(sim, seller, ORE)).toBe(8);
  });

  it('keeps a crafted-recipe marker on the delivered bucket (no provenance laundering)', () => {
    const sim = makeWorld();
    const { buyer, seller, orderId } = board(sim);
    const meta = playerOf(sim, seller);
    const slot = meta.inventory.find((s) => s.itemId === ORE);
    if (!slot) throw new Error('missing ore');
    slot.craftedRecipeId = 'r_test';
    sim.marketOrderFill(orderId, 2, seller);
    expect(info(sim, buyer).collectionItems).toEqual([
      expect.objectContaining({ itemId: ORE, count: 2, craftedRecipeId: 'r_test' }),
    ]);
  });
});

describe('marketOrderCancel', () => {
  it('returns the unfilled escrow to the purse and removes the order', () => {
    const sim = makeWorld();
    const buyer = player(sim, 'Buyer', 'mage', 1_000);
    sim.marketOrderPlace(ORE, 4, 25, buyer);
    const seller = player(sim, 'Seller');
    sim.addItem(ORE, 1, seller);
    sim.marketOrderFill(sim.marketOrders[0].id, 1, seller);
    sim.events.length = 0;
    sim.marketOrderCancel(sim.marketOrders[0].id, buyer);
    expect(errors(sim)).toEqual([]);
    expect(sim.marketOrders).toHaveLength(0);
    expect(playerOf(sim, buyer).copper).toBe(1_000 - 100 + 75);
    expect(loot(sim, buyer)).toEqual(['Withdrew your order for Copper Ore; 75c returned.']);
  });

  it("refuses someone else's order and a caller away from the Merchant", () => {
    const sim = makeWorld();
    const buyer = player(sim, 'Buyer', 'mage', 1_000);
    sim.marketOrderPlace(ORE, 1, 25, buyer);
    const other = player(sim, 'Other');
    sim.marketOrderCancel(1, other);
    const e = entityOf(sim, buyer);
    e.pos.x += 500;
    e.prevPos = { ...e.pos };
    sim.marketOrderCancel(1, buyer);
    expect(errors(sim)).toEqual(['That is not your order.', 'You are too far from the Merchant.']);
    expect(sim.marketOrders).toHaveLength(1);
  });
});

describe('the readout', () => {
  it("lists other buyers' orders by item name then best bid, and the unlisted materials", () => {
    const sim = makeWorld();
    const a = player(sim, 'Anna', 'mage', 10_000);
    const b = player(sim, 'Bo', 'mage', 10_000);
    sim.marketOrderPlace(FANG, 1, 5, a);
    sim.marketOrderPlace(ORE, 1, 10, a);
    sim.marketOrderPlace(ORE, 1, 20, b);
    const viewer = player(sim, 'Viewer');
    const i = info(sim, viewer);
    expect(i.orders.map((o) => [o.itemId, o.unitPrice, o.buyerName, o.mine])).toEqual([
      [ORE, 20, 'Bo', false],
      [ORE, 10, 'Anna', false],
      [FANG, 5, 'Anna', false],
    ]);
    expect(i.myOrderCount).toBe(0);
    expect(i.unlistedMaterials).toContain(ORE);
    // The viewer's own rows come FIRST (positionally, not just by count).
    expect(info(sim, a).orders.map((o) => o.mine)).toEqual([true, true, false]);
    expect(MARKET_MAX_ORDERS).toBe(6);
  });

  it('caps the wire at MARKET_ORDER_WIRE_LIMIT rows with own rows kept', () => {
    const sim = makeWorld();
    const pids: number[] = [];
    for (let i = 0; i < 12; i++) pids.push(player(sim, `B${i}`, 'mage', 100_000));
    // 12 buyers x 6 orders = 72 open rows, past the 60-row wire cap.
    for (const pid of pids) {
      for (let k = 0; k < MARKET_MAX_ORDERS; k++) sim.marketOrderPlace(ORE, 1, 2 + k, pid);
    }
    expect(sim.marketOrders).toHaveLength(72);
    const last = pids[pids.length - 1];
    const rows = info(sim, last).orders;
    expect(rows).toHaveLength(60);
    expect(rows.slice(0, MARKET_MAX_ORDERS).every((o) => o.mine)).toBe(true);
  });

  it('drops a material from the unlisted strip once it is listed, and restores it when the listing goes', () => {
    const sim = makeWorld();
    const seller = player(sim, 'Seller');
    expect(info(sim, seller).unlistedMaterials).toContain(ORE);
    sim.addItem(ORE, 1, seller);
    sim.marketList(ORE, 1, 5, seller);
    expect(info(sim, seller).unlistedMaterials).not.toContain(ORE);
    const row = sim.marketListings.find((l) => !l.house && l.itemId === ORE);
    if (!row) throw new Error('missing row');
    sim.marketCancel(row.id, seller);
    expect(info(sim, seller).unlistedMaterials).toContain(ORE);
  });

  it('advances the browse revision on place, fill, and cancel', () => {
    const sim = makeWorld();
    const buyer = player(sim, 'Buyer', 'mage', 10_000);
    const seller = player(sim, 'Seller');
    sim.addItem(ORE, 2, seller);
    const at = () => {
      const rev = sim.marketBrowseRevFor(seller);
      if (rev === null) throw new Error('left the Merchant');
      return rev;
    };
    let rev = at();
    sim.marketOrderPlace(ORE, 2, 10, buyer);
    expect(at()).toBeGreaterThan(rev);
    rev = at();
    sim.marketOrderFill(sim.marketOrders[0].id, 1, seller);
    expect(at()).toBeGreaterThan(rev);
    rev = at();
    sim.marketOrderCancel(sim.marketOrders[0].id, buyer);
    expect(at()).toBeGreaterThan(rev);
  });
});

describe('persistence and identity', () => {
  it('round-trips the board and its id counter, and writes no orders key when empty', () => {
    const sim = makeWorld();
    expect('orders' in sim.serializeMarket()).toBe(false);
    const buyer = player(sim, 'Buyer', 'mage', 10_000);
    sim.marketOrderPlace(ORE, 3, 12, buyer);
    sim.marketOrderPlace(FANG, 1, 7, buyer);
    sim.marketOrderCancel(1, buyer);
    const save = sim.serializeMarket();
    expect(save.orders).toEqual([
      {
        id: 2,
        buyerKey: String(buyer),
        buyerName: 'Buyer',
        itemId: FANG,
        count: 1,
        unitPrice: 7,
        secondsLeft: MARKET_ORDER_DURATION,
      },
    ]);
    expect(save.nextOrderId).toBe(3);
    const fresh = makeWorld();
    fresh.loadMarket(JSON.parse(JSON.stringify(save)));
    expect(fresh.marketOrders.map(({ expiresAt: _e, ...o }) => o)).toEqual(
      save.orders?.map(({ secondsLeft: _s, ...o }) => o),
    );
    expect(fresh.marketOrders[0].expiresAt).toBe(fresh.time + MARKET_ORDER_DURATION);
    const again = player(fresh, 'Again', 'mage', 1_000);
    fresh.marketOrderPlace(ORE, 1, 1, again);
    expect(fresh.marketOrders.map((o) => o.id)).toEqual([2, 3]);
    // An emptied board still carries the counter, so ids are never reissued.
    fresh.marketOrderCancel(2, buyer);
    fresh.marketOrderCancel(3, again);
    const empty = fresh.serializeMarket();
    expect('orders' in empty).toBe(false);
    expect(empty.nextOrderId).toBe(4);
    const later = makeWorld();
    later.loadMarket(JSON.parse(JSON.stringify(empty)));
    const c = player(later, 'C', 'mage', 1_000);
    later.marketOrderPlace(ORE, 1, 1, c);
    expect(later.marketOrders[0].id).toBe(4);
    // A saved counter above the max id wins over max id + 1.
    const high = makeWorld();
    high.loadMarket({ ...save, nextOrderId: 50 });
    const d = player(high, 'D', 'mage', 1_000);
    high.marketOrderPlace(ORE, 1, 1, d);
    expect(high.marketOrders.at(-1)?.id).toBe(50);
  });

  it('expires an order after MARKET_ORDER_DURATION and refunds the escrow to the collection', () => {
    const sim = makeWorld();
    const buyer = player(sim, 'Buyer', 'mage', 1_000);
    sim.marketOrderPlace(ORE, 4, 25, buyer);
    expect(playerOf(sim, buyer).copper).toBe(900);
    sim.marketOrders[0].expiresAt = sim.time - 1;
    const ticked: string[] = [];
    for (let i = 0; i < 20; i++) {
      // The once-a-second sweep; tick() hands back the frame's events.
      for (const e of sim.tick()) if (e.type === 'log') ticked.push(e.text);
    }
    expect(sim.marketOrders).toHaveLength(0);
    expect(playerOf(sim, buyer).copper).toBe(900);
    expect(info(sim, buyer).collectionCopper).toBe(100);
    expect(ticked.some((t) => t.startsWith('Your order for'))).toBe(true);
    sim.marketCollect(buyer);
    expect(playerOf(sim, buyer).copper).toBe(1_000);
  });

  it('loads a pre-order save and a malformed board defensively', () => {
    const sim = makeWorld();
    sim.loadMarket({ listings: [], collections: [], nextListingId: 1000 });
    expect(sim.marketOrders).toEqual([]);
    const dirty = makeWorld();
    dirty.loadMarket({
      listings: [],
      collections: [],
      nextListingId: 1000,
      orders: [
        { id: 4, buyerKey: 'k', buyerName: 'K', itemId: ORE, count: 2, unitPrice: 3 },
        { id: 4, buyerKey: 'k', buyerName: 'K', itemId: ORE, count: 2, unitPrice: 3 },
        { id: 5, buyerKey: 'k', buyerName: 'K', itemId: ORE, count: 0, unitPrice: 3 },
        { id: 6, buyerKey: 'k', buyerName: 'K', itemId: 'no_such_item', count: 1, unitPrice: 3 },
        // biome-ignore lint/suspicious/noExplicitAny: a hand-mangled blob row
        { id: 7 } as any,
        { id: 8, buyerKey: 'k', buyerName: 'K', itemId: ORE, count: 1, unitPrice: 0 },
        { id: 9, buyerKey: '', buyerName: 'Nobody', itemId: ORE, count: 1, unitPrice: 3 },
        // biome-ignore lint/suspicious/noExplicitAny: an id-less row
        { buyerKey: 'k', buyerName: 'K', itemId: ORE, count: 1, unitPrice: 3 } as any,
        // Out-of-band price and count are clamped, never trusted (no minting).
        { id: 10, buyerKey: 'k', buyerName: 'K', itemId: ORE, count: 9_999, unitPrice: 1e12 },
      ],
      nextOrderId: 2,
    });
    expect(dirty.marketOrders.map((o) => o.id)).toEqual([4, 6, 10]);
    expect(dirty.marketOrders[2]).toMatchObject({
      count: MARKET_ORDER_MAX_UNITS,
      unitPrice: 5_000_000,
    });
    const b = player(dirty, 'B', 'mage', 100);
    dirty.marketOrderPlace(ORE, 1, 1, b);
    expect(dirty.marketOrders.at(-1)?.id).toBe(11);
  });

  it('follows a rename and leaves with a deleted character', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('mage', 'Old', { characterId: 77 });
    standAtMerchant(sim, pid);
    playerOf(sim, pid).copper = 1_000;
    sim.marketOrderPlace(ORE, 1, 5, pid);
    expect(sim.rekeyMarketSeller(77, 'Old', 'New')).toBe(true);
    expect(sim.marketOrders[0]).toMatchObject({ buyerKey: '77', buyerName: 'New' });
    expect(sim.purgeMarketSeller(77, 'New')).toBe(true);
    expect(sim.marketOrders).toHaveLength(0);
  });
});

describe('edges the reviewers asked for', () => {
  it('takes fill rows only while they fit in the bags and escrows the rest', () => {
    const sim = makeWorld();
    const seller = player(sim, 'Seller', 'mage');
    sim.addItem(ORE, 40, seller);
    sim.marketList(ORE, 20, 20, seller);
    sim.marketList(ORE, 20, 40, seller);
    const buyer = player(sim, 'Buyer', 'mage', 10_000);
    // Fill the bags with singles of another item until only ONE of the two
    // 20-stacks fits (the pools are opaque, so ask the fit gate, not a count).
    const meta = playerOf(sim, buyer);
    const pools = bagPools(meta.bags);
    let guard = 0;
    while (canGrantCopies(meta.inventory, pools, ORE, 40) && guard++ < 400) {
      meta.inventory.push({ itemId: FANG, count: 1 });
    }
    expect(canGrantCopies(meta.inventory, pools, ORE, 20)).toBe(true);
    const settled = sim.marketOrderPlace(ORE, 40, 2, buyer);
    expect(settled).toHaveLength(1);
    expect(sim.marketOrders).toHaveLength(1);
    expect(sim.marketOrders[0].count).toBe(20);
    expect(meta.copper).toBe(10_000 - 20 - 20 * 2);
  });

  it('refuses a dead caller on place and fill, and a noMarketList item', () => {
    const sim = makeWorld();
    const buyer = player(sim, 'Buyer', 'mage', 1_000);
    sim.marketOrderPlace(ORE, 1, 5, buyer);
    const dead = player(sim, 'Dead', 'mage', 1_000);
    sim.addItem(ORE, 1, dead);
    entityOf(sim, dead).dead = true;
    sim.marketOrderPlace(ORE, 1, 5, dead);
    expect(sim.marketOrderFill(sim.marketOrders[0].id, 1, dead)).toEqual({ units: 0, copper: 0 });
    expect(sim.marketOrders).toHaveLength(1);
    expect(playerOf(sim, dead).copper).toBe(1_000);
    const locked = Object.values(ITEMS).find(
      (d) => d.noMarketList && !d.soulbound && d.kind !== 'quest',
    );
    if (locked) {
      sim.marketOrderPlace(locked.id, 1, 5, buyer);
      expect(errors(sim).at(-1)).toBe('That item cannot be listed on the World Market.');
    }
  });

  it('migrates a legacy name-keyed order on rename and purges it on delete', () => {
    const sim = makeWorld();
    sim.loadMarket({
      listings: [],
      collections: [],
      nextListingId: 1000,
      orders: [{ id: 1, buyerKey: 'Old', buyerName: 'Old', itemId: ORE, count: 1, unitPrice: 3 }],
      nextOrderId: 2,
    });
    expect(sim.rekeyMarketSeller(77, 'Old', 'New')).toBe(true);
    expect(sim.marketOrders[0]).toMatchObject({ buyerKey: '77', buyerName: 'New' });
    expect(sim.rekeyMarketSeller(77, 'Old', 'New')).toBe(false);
    expect(sim.purgeMarketSeller(78, 'Other')).toBe(false);
    expect(sim.purgeMarketSeller(77, 'New')).toBe(true);
    expect(sim.marketOrders).toHaveLength(0);
  });
});
