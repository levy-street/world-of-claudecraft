import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

function world() {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const seller = sim.addPlayer('warrior', 'Seller', { characterId: 10 });
  const buyer = sim.addPlayer('mage', 'Buyer', { characterId: 11 });
  const merchant = [...sim.entities.values()].find((e) => e.templateId === 'the_merchant')!;
  for (const pid of [seller, buyer]) {
    sim.entities.get(pid)!.pos = { ...merchant.pos };
    sim.players.get(pid)!.copper = 100000;
  }
  return { sim, seller, buyer };
}

describe('membership auction house fees', () => {
  it('stamps the 2.5% fee at listing, persists it, and honours it after expiry and restart', () => {
    const { sim, seller, buyer } = world();
    sim.setMembership(seller, 30);
    expect(sim.marketInfoFor(seller)?.cutPct).toBe(2.5);
    sim.addItem('worn_sword', 1, seller);
    sim.marketList('worn_sword', 1, 10000, seller);
    const saved = sim.serializeMarket();
    expect(saved.listings[0].membershipDiscount).toBe(true);
    const next = world();
    next.sim.loadMarket(saved);
    expect(next.sim.marketInfoFor(next.seller)?.cutPct).toBe(5);
    const listing = next.sim.marketListings.find((l) => !l.house)!;
    next.sim.marketBuy(listing.id, undefined, next.buyer);
    expect(next.sim.marketInfoFor(next.seller)?.collectionCopper).toBe(9750);
    expect(sim.players.has(buyer)).toBe(true);
  });

  it('keeps legacy/non-member listings at 5% and charges a member filling an order 2.5%', () => {
    const { sim, seller, buyer } = world();
    sim.addItem('worn_sword', 2, seller);
    sim.marketList('worn_sword', 1, 10000, seller);
    const listing = sim.marketListings.find((l) => !l.house)!;
    expect(listing.membershipDiscount).toBeUndefined();
    sim.marketBuy(listing.id, undefined, buyer);
    expect(sim.marketInfoFor(seller)?.collectionCopper).toBe(9500);
    sim.marketOrderPlace('worn_sword', 1, 10000, buyer);
    sim.setMembership(seller, 30);
    const order = sim.marketOrders.find((o) => o.buyerKey === '11')!;
    sim.marketOrderFill(order.id, 1, seller);
    expect(sim.marketInfoFor(seller)?.collectionCopper).toBe(19250);
    sim.setMembership(seller, 0);
    expect(sim.marketInfoFor(seller)?.cutPct).toBe(5);
  });
});
