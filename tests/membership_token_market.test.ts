import { describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { Sim } from '../src/sim/sim';

function fixture() {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const seller = sim.addPlayer('warrior', 'Seller', { characterId: 10 });
  const buyer = sim.addPlayer('mage', 'Buyer', { characterId: 11 });
  const merchant = [...sim.entities.values()].find(
    (entity) => entity.templateId === 'the_merchant',
  );
  if (!merchant) throw new Error('missing merchant');
  for (const pid of [seller, buyer]) {
    const player = sim.entities.get(pid);
    const meta = sim.players.get(pid);
    if (!player || !meta) throw new Error('missing player');
    player.pos = { ...merchant.pos };
    player.prevPos = { ...player.pos };
    meta.inventory = [];
    meta.copper = 100_000;
  }
  function fullBags(pid: number) {
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing inventory');
    const capacity = bagCapacity(meta.bags);
    meta.inventory = Array.from({ length: capacity }, (_, slot) => ({
      itemId: 'worn_sword',
      count: 1,
      slot,
    }));
    return { meta, capacity };
  }
  return { sim, seller, buyer, fullBags };
}

describe('membership token market overflow', () => {
  it.each(['buy', 'cancel', 'collect'] as const)(
    '%s preserves token custody and instance identity in full bags without duplicating on replay',
    (action) => {
      const { sim, seller, buyer, fullBags } = fixture();
      const instance = { signer: 'Seller' };
      sim.addItemInstance('membership_token', instance, seller);
      sim.marketListInstance('membership_token', 100, instance, seller);
      const listing = sim.marketListings.find((row) => !row.house);
      if (!listing) throw new Error('missing token listing');
      const receiver = action === 'buy' ? buyer : seller;
      const { meta, capacity } = fullBags(receiver);
      const copper = meta.copper;
      if (action === 'collect') {
        listing.expiresAt = 0;
        for (let tick = 0; tick < 20; tick++) sim.tick();
      }
      const collect = () => {
        if (action === 'buy') sim.marketBuy(listing.id, undefined, buyer);
        else if (action === 'cancel') sim.marketCancel(listing.id, seller);
        else sim.marketCollect(seller);
      };
      const revision = meta.wireRev;
      collect();
      expect(meta.inventory).toHaveLength(capacity + 1);
      expect(meta.inventory.at(-1)).toMatchObject({
        itemId: 'membership_token',
        count: 1,
        instance,
      });
      expect(meta.wireRev).toBeGreaterThan(revision);
      expect(meta.copper).toBe(copper - (action === 'buy' ? 100 : 0));
      expect(sim.marketListings.some((row) => row.id === listing.id)).toBe(false);
      collect();
      expect(meta.inventory.filter((slot) => slot.itemId === 'membership_token')).toHaveLength(1);
      expect(meta.copper).toBe(copper - (action === 'buy' ? 100 : 0));
    },
  );

  it.each(['buy', 'cancel', 'collect'] as const)(
    '%s keeps ordinary items in custody when bags are full',
    (action) => {
      const { sim, seller, buyer, fullBags } = fixture();
      sim.addItem('wolf_fang', 1, seller);
      sim.marketList('wolf_fang', 1, 100, seller);
      const listing = sim.marketListings.find((row) => !row.house);
      if (!listing) throw new Error('missing ordinary listing');
      const { meta, capacity } = fullBags(action === 'buy' ? buyer : seller);
      const copper = meta.copper;
      if (action === 'buy') sim.marketBuy(listing.id, undefined, buyer);
      else if (action === 'cancel') sim.marketCancel(listing.id, seller);
      else {
        listing.expiresAt = 0;
        for (let tick = 0; tick < 20; tick++) sim.tick();
        sim.marketCollect(seller);
        expect(sim.marketCollectPendingFor(seller)).toBe(true);
      }
      expect(meta.inventory).toHaveLength(capacity);
      expect(meta.inventory.some((slot) => slot.itemId === 'wolf_fang')).toBe(false);
      expect(meta.copper).toBe(copper);
      if (action !== 'collect') expect(sim.marketListings).toContain(listing);
    },
  );

  it.each(['sweep', 'order'] as const)(
    '%s purchases membership tokens into overflow through the ordinary settlement',
    (action) => {
      const { sim, seller, buyer, fullBags } = fixture();
      sim.addItem('membership_token', 2, seller);
      sim.marketList('membership_token', 2, 200, seller);
      const { meta, capacity } = fullBags(buyer);
      const copper = meta.copper;
      if (action === 'sweep') sim.marketSweep('membership_token', 2, 200, buyer);
      else sim.marketOrderPlace('membership_token', 2, 100, buyer);
      expect(meta.inventory).toHaveLength(capacity + 1);
      expect(meta.inventory.at(-1)).toMatchObject({ itemId: 'membership_token', count: 2 });
      expect(meta.copper).toBe(copper - 200);
      expect(sim.marketInfoFor(seller)?.collectionCopper).toBe(190);
      expect(sim.marketOrders).toHaveLength(0);
    },
  );

  it.each(['sweep', 'order'] as const)(
    '%s does not deliver ordinary goods past capacity',
    (action) => {
      const { sim, seller, buyer, fullBags } = fixture();
      sim.addItem('wolf_fang', 2, seller);
      sim.marketList('wolf_fang', 2, 200, seller);
      const { meta, capacity } = fullBags(buyer);
      if (action === 'sweep') sim.marketSweep('wolf_fang', 2, 200, buyer);
      else sim.marketOrderPlace('wolf_fang', 2, 100, buyer);
      expect(meta.inventory).toHaveLength(capacity);
      expect(sim.marketListings.some((row) => !row.house && row.itemId === 'wolf_fang')).toBe(true);
      expect(meta.inventory.some((slot) => slot.itemId === 'wolf_fang')).toBe(false);
    },
  );

  it('collects a filled token order into full bags exactly once', () => {
    const { sim, seller, buyer, fullBags } = fixture();
    sim.marketOrderPlace('membership_token', 1, 100, buyer);
    const order = sim.marketOrders.find((row) => row.buyerKey === '11');
    if (!order) throw new Error('missing token order');
    const { meta, capacity } = fullBags(buyer);
    sim.addItem('membership_token', 1, seller);
    sim.marketOrderFill(order.id, 1, seller);
    expect(sim.marketCollectPendingFor(buyer)).toBe(true);
    sim.marketCollect(buyer);
    expect(meta.inventory).toHaveLength(capacity + 1);
    expect(meta.inventory.at(-1)).toMatchObject({ itemId: 'membership_token', count: 1 });
    expect(sim.marketCollectPendingFor(buyer)).toBe(false);
    sim.marketCollect(buyer);
    expect(meta.inventory).toHaveLength(capacity + 1);
  });
});
