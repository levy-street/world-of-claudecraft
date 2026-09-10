// What a buddy whistle is worth and who will not sell you one
// (2026-09-04 owner call).
//
// Three rules, and each one is the kind that rots silently: a new whistle added
// without the flags would be undiscardable and unsellable like the old roster,
// and a whistle quietly restocked on the stablemaster would put the common tier
// back behind a vendor counter after it was deliberately made a drop.

import { describe, expect, it } from 'vitest';
import { ITEMS, NPCS } from '../src/sim/data';
import type { ItemDef } from '../src/sim/types';

const WHISTLE_SELL_VALUE = 50_000; // 5g in copper
const whistles: ItemDef[] = Object.values(ITEMS).filter((item) => item.kind === 'buddy');

describe('buddy whistle economy', () => {
  it('has a whistle for every buddy, so the sweeps below are not vacuous', () => {
    expect(whistles.length).toBeGreaterThan(20);
  });

  it('makes every whistle discardable and vendor-sellable at a flat 5g', () => {
    for (const item of whistles) {
      expect(item.noDiscard, `${item.id} noDiscard`).toBeUndefined();
      expect(item.noVendorSell, `${item.id} noVendorSell`).toBeUndefined();
      // Flat across the roster: rarity buys a nicer follower, not a better
      // vendor price, so an epic whistle sells for exactly what a common does.
      expect(item.sellValue, `${item.id} sellValue`).toBe(WHISTLE_SELL_VALUE);
    }
  });

  it('keeps every whistle off the stablemaster, mounts included in her stock', () => {
    const marla = NPCS.stablemaster_marla;
    expect(marla, 'stablemaster_marla').toBeDefined();
    const stock = marla.vendorItems ?? [];
    // Anti-vacuity: she still sells something, so an emptied list cannot pass.
    expect(stock).toContain('reins_valorsteed');
    expect(stock).toContain('riding_training');
    for (const itemId of stock) {
      expect(ITEMS[itemId]?.kind, `${itemId} on Marla's list`).not.toBe('buddy');
    }
  });

  it('binds none of them: every whistle in the game is tradeable', () => {
    // The three currency companions used to bind, which closed a route from a
    // prestige currency to gold through the market. The 2026-09-04 owner call
    // reopened it: a collectible should change hands, so nothing in the roster
    // carries soulbound any more.
    for (const item of whistles) {
      expect(item.soulbound, `${item.id} soulbound`).toBeUndefined();
    }
  });

  it('prices only the whistle a vendor actually charges for', () => {
    // A buyValue on an item no NPC stocks is dead data that reads as a price
    // (and, at the 5g sellValue every whistle now takes, would read as a
    // break-even loop if one were ever restocked). Penny Goldspark is the one
    // whistle a vendor sells for coin, so she is the one that keeps a price.
    const priced = whistles.filter((item) => item.buyValue !== undefined);
    expect(priced.map((item) => item.id)).toEqual(['whistle_penny_goldspark']);
    const stocked = Object.values(NPCS).some((npc) =>
      npc.vendorItems?.includes('whistle_penny_goldspark'),
    );
    expect(stocked).toBe(true);
  });

  it('leaves the three currency companions with their own vendors', () => {
    // The stablemaster losing the whistles must not strand the vendor-only
    // companions: each still has exactly one NPC that stocks it.
    for (const itemId of ['whistle_proud_grunt', 'whistle_penny_goldspark']) {
      const sellers = Object.values(NPCS).filter((npc) => npc.vendorItems?.includes(itemId));
      expect(
        sellers.map((npc) => npc.id),
        itemId,
      ).toHaveLength(1);
    }
  });
});
