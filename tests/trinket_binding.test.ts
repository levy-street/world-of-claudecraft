import { describe, expect, it } from 'vitest';
import { WARFARE_TRINKET_STOCK } from '../src/sim/content/pvp_honor';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';

const PVP_TRINKETS = ['medallion_of_defiance', 'duelists_brand'];
const BOUND_TRINKETS = [...PVP_TRINKETS, 'referral_hollow_charm', 'referral_fog_charm'];
const trinkets = Object.values(ITEMS).filter((item) => item.slot === 'trinket');

describe('trinket soulbinding', () => {
  it('binds the PvP vendor and referral trinkets in the merged item catalog', () => {
    expect(WARFARE_TRINKET_STOCK).toEqual(PVP_TRINKETS);
    expect(trinkets).toHaveLength(31);
    expect(
      trinkets
        .filter((item) => item.soulbound)
        .map((item) => item.id)
        .sort(),
    ).toEqual([...BOUND_TRINKETS].sort());
  });

  it.each(trinkets)(
    '$id can be listed on the World Market only when it is not bound reward gear',
    (item) => {
      const sim = new Sim({ seed: 42, playerClass: 'warrior' });
      const merchant = [...sim.entities.values()].find(
        (entity) => entity.templateId === 'the_merchant',
      );
      if (!merchant) throw new Error('the Merchant was not spawned');
      sim.player.pos = { ...merchant.pos };
      sim.addItem(item.id, 1);
      sim.drainEvents();

      const held = sim.meta(sim.playerId)!.inventory.find((slot) => slot.itemId === item.id);
      // Tracked epics are exact copies, so use the same instance-selected
      // listing path as the market UI rather than the fungible bulk path.
      if (held?.instance) sim.marketListInstance(item.id, 100, held.instance);
      else sim.marketList(item.id, 1, 100);

      const bound = BOUND_TRINKETS.includes(item.id);
      expect(
        sim.marketListings.some((listing) => !listing.house && listing.itemId === item.id),
      ).toBe(!bound);
      expect(sim.countItem(item.id)).toBe(bound ? 1 : 0);
      if (bound) {
        expect(sim.drainEvents()).toContainEqual({
          type: 'error',
          pid: sim.player.id,
          text: 'That item cannot be listed on the World Market.',
        });
      }
    },
  );
});
