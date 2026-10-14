import { describe, expect, it } from 'vitest';
import { WARFARE_TRINKET_STOCK } from '../src/sim/content/pvp_honor';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';

const PVP_TRINKETS = ['medallion_of_defiance', 'duelists_brand'];
const trinkets = Object.values(ITEMS).filter((item) => item.slot === 'trinket');

describe('trinket soulbinding', () => {
  it('binds only the two PvP vendor trinkets in the merged item catalog', () => {
    expect(WARFARE_TRINKET_STOCK).toEqual(PVP_TRINKETS);
    expect(trinkets).toHaveLength(18);
    expect(
      trinkets
        .filter((item) => item.soulbound)
        .map((item) => item.id)
        .sort(),
    ).toEqual([...PVP_TRINKETS].sort());
  });

  it.each(trinkets)(
    '$id can be listed on the World Market only when it is not PvP gear',
    (item) => {
      const sim = new Sim({ seed: 42, playerClass: 'warrior' });
      const merchant = [...sim.entities.values()].find(
        (entity) => entity.templateId === 'the_merchant',
      );
      if (!merchant) throw new Error('the Merchant was not spawned');
      sim.player.pos = { ...merchant.pos };
      sim.addItem(item.id, 1);
      sim.drainEvents();

      sim.marketList(item.id, 1, 100);

      const bound = PVP_TRINKETS.includes(item.id);
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
