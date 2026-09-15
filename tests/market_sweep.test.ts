// Market Sweep on the live Market (src/sim/market.ts marketSweepQuote /
// marketSweep): the quote echo, the batched cheapest-first buyout through the
// shared settlement, and every refusal arm. The planner's own ordering rules are
// pinned in tests/market_sweep_plan.test.ts; this file pins what the sim DOES with
// a plan: coin, goods, seller proceeds, the browse revision, and the messages.
import { describe, expect, it } from 'vitest';
import { MARKET_SWEEP_MAX_UNITS } from '../src/sim/market_sweep';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const ORE = 'copper_ore';

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

function errorsSince(sim: Sim): string[] {
  return sim.events.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text);
}

function lootSince(sim: Sim, pid: number): string[] {
  return sim.events
    .filter((e) => e.type === 'loot' && (e as { pid?: number }).pid === pid)
    .map((e) => (e as { text: string }).text);
}

/** A seller standing at the Merchant with `stacks` of ore listed at each price. */
function seller(sim: Sim, name: string, stacks: { count: number; price: number }[]): number {
  const pid = sim.addPlayer('warrior', name);
  standAtMerchant(sim, pid);
  for (const s of stacks) {
    sim.addItem(ORE, s.count, pid);
    sim.marketList(ORE, s.count, s.price, pid);
  }
  return pid;
}

function buyer(sim: Sim, copper: number): number {
  const pid = sim.addPlayer('mage', 'Buyer');
  standAtMerchant(sim, pid);
  playerOf(sim, pid).copper = copper;
  sim.events.length = 0;
  return pid;
}

function info(sim: Sim, pid: number) {
  const i = sim.marketInfoFor(pid);
  if (!i) throw new Error('no market info');
  return i;
}

describe('marketSweepQuote', () => {
  it('echoes a live plan for the staged item and count, cheapest per unit first', () => {
    const sim = makeWorld();
    seller(sim, 'Halden', [
      { count: 1, price: 9 },
      { count: 5, price: 25 },
    ]);
    seller(sim, 'Mira', [{ count: 2, price: 12 }]);
    const b = buyer(sim, 1000);
    expect(info(sim, b).sweepQuote).toBeNull();

    sim.marketSweepQuote(ORE, 6, b);

    expect(info(sim, b).sweepQuote).toEqual({
      itemId: ORE,
      count: 6,
      units: 7,
      listings: 2,
      total: 37,
      short: false,
    });
  });

  it('flags a short book and clears on a bad count or unknown item', () => {
    const sim = makeWorld();
    seller(sim, 'Halden', [{ count: 2, price: 20 }]);
    const b = buyer(sim, 1000);
    sim.marketSweepQuote(ORE, 5, b);
    expect(info(sim, b).sweepQuote).toMatchObject({ units: 2, short: true });
    sim.marketSweepQuote(ORE, MARKET_SWEEP_MAX_UNITS + 1, b);
    expect(info(sim, b).sweepQuote).toBeNull();
    sim.marketSweepQuote(ORE, 3, b);
    sim.marketSweepQuote('no_such_item', 3, b);
    expect(info(sim, b).sweepQuote).toBeNull();
  });

  it('never counts the viewer own rows or house stock in the quote', () => {
    const sim = makeWorld();
    const b = buyer(sim, 1000);
    sim.addItem(ORE, 3, b);
    sim.marketList(ORE, 3, 3, b);
    sim.marketSweepQuote(ORE, 1, b);
    expect(info(sim, b).sweepQuote).toMatchObject({ units: 0, listings: 0, short: true });
  });
});

describe('marketSweep', () => {
  it('buys across sellers in one command: coin, goods, proceeds, and one summary line', () => {
    const sim = makeWorld();
    const halden = seller(sim, 'Halden', [
      { count: 1, price: 9 },
      { count: 5, price: 25 },
    ]);
    const mira = seller(sim, 'Mira', [{ count: 2, price: 12 }]);
    const b = buyer(sim, 1000);
    const bookBefore = sim.marketListings.length;

    sim.marketSweep(ORE, 6, 37, b);

    expect(errorsSince(sim)).toEqual([]);
    expect(playerOf(sim, b).copper).toBe(963);
    expect(sim.countItem(ORE, b)).toBe(7);
    // Two rows left the book (the 5-stack and the 2-stack); the 9c single stays.
    expect(sim.marketListings.length).toBe(bookBefore - 2);
    expect(sim.marketListings.some((l) => l.itemId === ORE && l.price === 9)).toBe(true);
    // Each seller is paid through the single-buy path: 5% cut on their own row.
    expect(info(sim, halden).collectionCopper).toBe(Math.floor(25 * 0.95));
    expect(info(sim, mira).collectionCopper).toBe(Math.floor(12 * 0.95));
    expect(info(sim, halden).collectionSales.map((s) => s.buyerName)).toEqual(['Buyer']);
    // The buyer hears the per-row receipts in PLAN order (cheapest per unit
    // first: the 5-stack at 5c each, then the 2-stack at 6c), then ONE summary
    // line in the shape the single buy already speaks, so no new loot matcher is
    // needed.
    const receipts = lootSince(sim, b).filter((l) => l.startsWith('You receive'));
    expect(receipts).toEqual(['You receive: Copper Ore x5.', 'You receive: Copper Ore x2.']);
    const bought = lootSince(sim, b).filter((l) => l.startsWith('Bought '));
    expect(bought).toEqual(['Bought Copper Ore x7 for 37c.']);
  });

  it('advances the browse revision so the server gate rebuilds every viewer', () => {
    const sim = makeWorld();
    seller(sim, 'Halden', [{ count: 2, price: 10 }]);
    const b = buyer(sim, 1000);
    const rev = sim.marketBrowseRevFor(b);
    sim.marketSweep(ORE, 2, 10, b);
    expect(sim.marketBrowseRevFor(b)).not.toBe(rev);
  });

  it('refuses when the live total moved past the quoted cap, buying nothing', () => {
    const sim = makeWorld();
    seller(sim, 'Halden', [{ count: 2, price: 10 }]);
    const b = buyer(sim, 1000);
    sim.marketSweep(ORE, 2, 9, b);
    expect(errorsSince(sim)).toEqual([
      'Prices changed before your sweep landed. Check the quote and try again.',
    ]);
    expect(playerOf(sim, b).copper).toBe(1000);
    expect(sim.countItem(ORE, b)).toBe(0);
  });

  it('refuses an empty plan, an unaffordable plan, and a distant buyer', () => {
    const sim = makeWorld();
    const b = buyer(sim, 5);
    sim.marketSweep(ORE, 1, 100, b);
    expect(errorsSince(sim)).toEqual(['No listings of that item are available to sweep.']);
    sim.events.length = 0;
    seller(sim, 'Halden', [{ count: 1, price: 10 }]);
    sim.marketSweep(ORE, 1, 100, b);
    expect(errorsSince(sim)).toEqual(['You cannot afford that.']);
    sim.events.length = 0;
    playerOf(sim, b).copper = 1000;
    const e = entityOf(sim, b);
    e.pos.x += 500;
    sim.marketSweep(ORE, 1, 100, b);
    expect(errorsSince(sim)).toEqual(['You are too far from the Merchant.']);
    expect(sim.countItem(ORE, b)).toBe(0);
  });

  it('never buys the sweeper own listing, even when it is the cheapest', () => {
    const sim = makeWorld();
    seller(sim, 'Halden', [{ count: 1, price: 50 }]);
    const b = buyer(sim, 1000);
    sim.addItem(ORE, 1, b);
    sim.marketList(ORE, 1, 1, b);
    sim.marketSweep(ORE, 1, 50, b);
    expect(errorsSince(sim)).toEqual([]);
    expect(playerOf(sim, b).copper).toBe(950);
    expect(sim.marketListings.some((l) => l.itemId === ORE && l.price === 1)).toBe(true);
  });

  it('ignores a junk count and a non-finite cap without touching the book', () => {
    const sim = makeWorld();
    seller(sim, 'Halden', [{ count: 1, price: 10 }]);
    const b = buyer(sim, 1000);
    const bookBefore = sim.marketListings.length;
    sim.marketSweep(ORE, 0, 100, b);
    sim.marketSweep(ORE, 1.5, 100, b);
    sim.marketSweep(ORE, 1, Number.NaN, b);
    expect(sim.marketListings.length).toBe(bookBefore);
    expect(playerOf(sim, b).copper).toBe(1000);
  });
});
