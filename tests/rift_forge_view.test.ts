// The Rift Forge window's pure core (src/ui/hud/rift_forge/rift_forge_view.ts).
//
// Pins: one row per Riftbound band from bags AND worn slots (worn rows carry
// no affordance), the band's item level now and after the next upgrade quoted
// from the ladder, the next-upgrade cost quoted from the sim's own ladder and
// gated on the essence in the bags, the top of the ladder answering null, the
// socketable list (owned gems only, and still offered on a full band because
// sockets are replaceable, with the oldest gem named), and the wallet counts
// summed across stacks with each colour's rating line. Same snapshot shape as
// both hosts (IWorld.inventory / equipment / equipmentInstances).

import { describe, expect, it } from 'vitest';
import { RIFT_ESSENCE_ITEM_ID, RIFT_GEM_IDS } from '../src/sim/content/rift/items';
import {
  RIFT_GEM_RATING,
  RIFT_GEM_RATING_STAT,
  riftBandItemLevel,
} from '../src/sim/rift/band_ladder';
import { createRiftGearInstance, riftUpgradeCost } from '../src/sim/rift/progression';
import type { InvSlot } from '../src/sim/types';
import { buildRiftForgeView } from '../src/ui/hud/rift_forge';

function band(tier: 'C' | 'S' = 'S', upgradeLevel = 0) {
  return createRiftGearInstance(`view-${tier}`, tier, 'warrior', 1, upgradeLevel);
}

describe('buildRiftForgeView', () => {
  it('lists a bagged band with the ladder, the sim cost, and the essence gate', () => {
    const gear = band('S', 1);
    const inventory: InvSlot[] = [
      { itemId: 'linen_cloth', count: 3 },
      { itemId: gear.itemId, count: 1, instance: gear.instance },
      { itemId: RIFT_ESSENCE_ITEM_ID, count: 3 },
      { itemId: RIFT_ESSENCE_ITEM_ID, count: 2 },
    ];
    const view = buildRiftForgeView({ inventory, equipment: {}, equipmentInstances: {} });
    expect(view.essence).toBe(5);
    expect(view.rings).toHaveLength(1);
    const r = view.rings[0];
    expect(r.source).toEqual({ kind: 'bag', slotIndex: 1 });
    expect(r.tier).toBe('S');
    expect(r.upgradeLevel).toBe(1);
    expect(r.itemLevel).toBe(riftBandItemLevel('S', 1));
    expect(r.nextItemLevel).toBe(riftBandItemLevel('S', 2));
    expect(r.nextUpgradeCost).toBe(riftUpgradeCost(1));
    expect(r.canUpgrade).toBe(true); // 5 >= 4
    expect(r.gemSlots).toBe(2);
    expect(r.socketable).toEqual([]); // no gems owned
    expect(r.replaces).toBeNull();
    expect(r.worn).toBe(false);
  });

  it('answers null at the top of the ladder and gates the upgrade on essence', () => {
    const gear = band('C', 0);
    if (gear.instance.rift) gear.instance.rift.upgradeLevel = gear.instance.rift.maxUpgradeLevel;
    const inventory: InvSlot[] = [
      { itemId: gear.itemId, count: 1, instance: gear.instance },
      { itemId: RIFT_ESSENCE_ITEM_ID, count: 1 },
    ];
    const r = buildRiftForgeView({ inventory, equipment: {}, equipmentInstances: {} }).rings[0];
    expect(r.nextUpgradeCost).toBeNull();
    expect(r.nextItemLevel).toBeNull();
    expect(r.canUpgrade).toBe(false);
    const cheap = band('C', 0);
    const short = buildRiftForgeView({
      inventory: [
        { itemId: cheap.itemId, count: 1, instance: cheap.instance },
        { itemId: RIFT_ESSENCE_ITEM_ID, count: riftUpgradeCost(0) - 1 },
      ],
      equipment: {},
      equipmentInstances: {},
    }).rings[0];
    expect(short.canUpgrade).toBe(false);
  });

  it('offers only OWNED gems, still on a full band, naming the oldest gem a socket replaces', () => {
    const gear = band('C'); // one socket
    const inventory: InvSlot[] = [
      { itemId: gear.itemId, count: 1, instance: gear.instance },
      { itemId: RIFT_GEM_IDS[1], count: 1 },
      { itemId: RIFT_GEM_IDS[2], count: 2 },
    ];
    const open = buildRiftForgeView({ inventory, equipment: {}, equipmentInstances: {} });
    expect(open.rings[0].socketable).toEqual([RIFT_GEM_IDS[1], RIFT_GEM_IDS[2]]);
    expect(open.rings[0].replaces).toBeNull();
    expect(open.gems).toEqual(
      RIFT_GEM_IDS.map((id, i) => ({
        id,
        count: [0, 1, 2][i],
        stat: RIFT_GEM_RATING_STAT[id],
        rating: RIFT_GEM_RATING,
      })),
    );
    gear.instance.rift?.gems.push(RIFT_GEM_IDS[1]);
    const full = buildRiftForgeView({ inventory, equipment: {}, equipmentInstances: {} });
    expect(full.rings[0].gems).toEqual([RIFT_GEM_IDS[1]]);
    // Sockets are replaceable: the owned gems stay offered, and the row says
    // which gem the next socket destroys (the oldest).
    expect(full.rings[0].socketable).toEqual([RIFT_GEM_IDS[1], RIFT_GEM_IDS[2]]);
    expect(full.rings[0].replaces).toBe(RIFT_GEM_IDS[1]);
    // No gems owned: nothing to offer, so nothing is threatened either.
    const none = buildRiftForgeView({
      inventory: [{ itemId: gear.itemId, count: 1, instance: gear.instance }],
      equipment: {},
      equipmentInstances: {},
    });
    expect(none.rings[0].socketable).toEqual([]);
    expect(none.rings[0].replaces).toBeNull();
  });

  it('lists a worn band as worn with every affordance off, and skips non-rift slots', () => {
    const gear = band('S');
    const view = buildRiftForgeView({
      inventory: [
        { itemId: RIFT_ESSENCE_ITEM_ID, count: 20 },
        { itemId: RIFT_GEM_IDS[0], count: 1 },
      ],
      equipment: { ring1: gear.itemId, ring2: 'copper_band' },
      equipmentInstances: { ring1: gear.instance, ring2: { signer: 'Someone' } },
    });
    expect(view.rings).toHaveLength(1);
    const r = view.rings[0];
    expect(r.worn).toBe(true);
    expect(r.source).toEqual({ kind: 'worn', slot: 'ring1' });
    expect(r.canUpgrade).toBe(false);
    expect(r.socketable).toEqual([]);
    expect(r.replaces).toBeNull();
    expect(r.itemLevel).toBe(riftBandItemLevel('S', 0));
  });

  it('renders the empty state shape when the player owns no band', () => {
    const view = buildRiftForgeView({ inventory: [], equipment: {}, equipmentInstances: {} });
    expect(view.rings).toEqual([]);
    expect(view.essence).toBe(0);
  });
});
