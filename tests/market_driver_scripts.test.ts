import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

// The three market driver scripts (scripts/market_mp_e2e.mjs,
// market_search_shot.mjs, market_listing_count_shot.mjs) stage the market the
// same way; this pins the sim-side assumptions those scripts now rely on after
// listings gained a copper deposit and the auction-era listing shape.
describe('market driver script assumptions', () => {
  function atMerchant(sim: Sim, pid: number): void {
    const merch = [...sim.entities.values()].find((e) => e.templateId === 'the_merchant')!;
    const e = sim.entities.get(pid)!;
    e.pos = { ...merch.pos };
    e.prevPos = { ...merch.pos };
  }

  it('a funded flood seller lists deposit-bearing goods without refusal (search/count shots)', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('mage', 'FloodSeller');
    atMerchant(sim, pid);
    sim.players.get(pid)!.copper = 100000; // the fix: fund the flood seller
    for (let j = 0; j < 12; j++) {
      sim.addItem('oiled_boots', 1, pid);
      sim.marketList('oiled_boots', 1, 100 + j * 10, pid);
    }
    // every attempt escrows a deposit + the item and creates a listing
    expect(sim.marketListings.filter((l) => l.sellerKey === String(pid))).toHaveLength(12);
  });

  it('an unfunded seller of a deposit-bearing item IS refused (proving the scripts needed the fund)', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('mage', 'Broke');
    atMerchant(sim, pid);
    sim.players.get(pid)!.copper = 0;
    sim.addItem('oiled_boots', 1, pid);
    sim.marketList('oiled_boots', 1, 400, pid);
    expect(sim.marketListings.filter((l) => l.sellerKey === String(pid))).toHaveLength(0);
  });

  it('the boots deposit and its refund match the e2e assertion math (48h tier)', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const seller = sim.addPlayer('warrior', 'Sellwyn');
    const buyer = sim.addPlayer('mage', 'Buyrum');
    atMerchant(sim, seller);
    atMerchant(sim, buyer);
    sim.players.get(seller)!.copper = 100000;
    sim.players.get(buyer)!.copper = 100000;
    sim.addItem('oiled_boots', 1, seller);
    sim.marketList('oiled_boots', 1, 400, seller); // default 48h tier
    const lot = sim.marketListings.find((l) => l.sellerKey === String(seller))!;
    const info = sim.marketInfoFor(seller)!;
    const mine = info.listings.find((l) => l.mine && l.itemId === 'oiled_boots')!;
    // oiled_boots sellValue 80, 48h tier mult 4: floor(80*0.15)*4 = 48
    expect(mine.depositTotal).toBe(48);
    sim.marketBuy(lot.id, undefined, buyer);
    const sellerColl = sim.marketInfoFor(seller)!;
    // proceeds floor(400*0.95)=380 plus the 48c deposit refund
    expect(sellerColl.collectionCopper).toBe(Math.floor(400 * 0.95) + 48);
  });

  it('a hand-pushed flood listing carries the full auction-era shape marketInfoFor reads (count shot)', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const me = sim.addPlayer('warrior', 'Strider');
    atMerchant(sim, me);
    const id = sim.marketListings.reduce((m, l) => Math.max(m, l.id + 1), 1);
    sim.marketListings.push({
      id,
      sellerKey: 'Trader0',
      sellerName: 'Trader0',
      itemId: 'bone_fragments',
      count: 1,
      price: 40,
      expiresAt: sim.time + 1000,
      house: false,
      kind: 'fixed',
      denom: 'copper',
      pricePerUnit: 40,
      durationSeconds: 1000,
      depositPerUnit: 0,
    });
    // marketInfoFor must render the hand-pushed row without throwing on a missing field
    const info = sim.marketInfoFor(me)!;
    const row = info.listings.find((l) => l.sellerName === 'Trader0');
    expect(row).toBeTruthy();
    expect(row!.kind).toBe('fixed');
    expect(row!.denom).toBe('copper');
    expect(row!.pricePerUnit).toBe(40);
  });
});
