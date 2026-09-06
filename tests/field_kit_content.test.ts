import { describe, expect, it } from 'vitest';
import { DELVE_SHOPS } from '../src/sim/content/delves/shop';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { PTR_DEV_VENDOR_DEF } from '../src/sim/content/ptr_dev_vendor';
import { FURY_STOCK } from '../src/sim/content/pvp_honor';
import { ITEMS, NPCS } from '../src/sim/data';
import { expectDefined } from './helpers/defined';
import { makeScopedSim, teleportTo, VENDOR_TEST_WORLD } from './sim_shared';

const FIELD_KIT_SELLERS = [
  'farmer_hollis',
  'farmer_jessica',
  'farmer_teasel',
  'farmer_verbena',
  'fisherman_brandt',
  'forgemistress_darva',
  'provisioner_fenna',
  'provisioner_hale',
  'quartermaster_bree',
  'tinker_gizzel',
  'trader_wilkes',
  'weaver_ottilie',
] as const;

describe('Field Kit content', () => {
  it('is the reusable all-class 20-copper Harvest preference tool', () => {
    const fieldKit = ITEMS.field_kit;

    expect(fieldKit).toMatchObject({
      id: 'field_kit',
      name: 'Field Kit',
      kind: 'tool',
      quality: 'common',
      use: { type: 'harvestPreference' },
      buyValue: 20,
      sellValue: 4,
    });
    expect(fieldKit.requiredClass).toBeUndefined();
    expect(fieldKit.requiredLevel).toBeUndefined();
    expect(fieldKit.slot).toBeUndefined();
    expect(fieldKit.stackSize).toBeUndefined();
    expect(Object.hasOwn(fieldKit, 'charges')).toBe(false);
    expect(Object.hasOwn(fieldKit, 'durability')).toBe(false);
  });

  it('is stocked by exactly the reviewed ordinary and gathering suppliers', () => {
    const actual = Object.values(NPCS)
      .filter((npc) => npc.vendorItems?.includes('field_kit') === true)
      .map((npc) => npc.id)
      .sort();

    expect(actual).toEqual([...FIELD_KIT_SELLERS]);
  });

  it('stays out of tutorial, currency, dev, and unrelated specialty stock', () => {
    const tutorialQuartermaster = NPCS.quartermaster_finch;
    expect(tutorialQuartermaster).toBeDefined();
    expect(tutorialQuartermaster?.vendorItems).not.toContain('field_kit');

    // PTR_DEV_VENDOR_DEF always assigns vendorItems (allEpicGearIds()); the
    // field is optional only on the shared NpcDef shape, never on this fixture.
    const ptrDevVendorItems = expectDefined(
      PTR_DEV_VENDOR_DEF.vendorItems,
      'PTR_DEV_VENDOR_DEF.vendorItems',
    );
    expect(ptrDevVendorItems.length).toBeGreaterThan(0);
    expect(ptrDevVendorItems).not.toContain('field_kit');

    expect(FURY_STOCK.length).toBeGreaterThan(0);
    expect(FURY_STOCK).not.toContain('field_kit');

    expect(HEROIC_VENDOR_STOCK.length).toBeGreaterThan(0);
    expect(HEROIC_VENDOR_STOCK.map((offer) => offer.itemId)).not.toContain('field_kit');

    const delveOffers = Object.values(DELVE_SHOPS).flat();
    expect(delveOffers.length).toBeGreaterThan(0);
    expect(delveOffers.map((offer) => offer.itemId)).not.toContain('field_kit');
  });

  it('can be bought through the real Sim vendor path for exactly 20 copper', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const wilkes = [...sim.entities.values()].find(
      (entity) => entity.templateId === 'trader_wilkes',
    );
    expect(wilkes).toBeDefined();
    if (!wilkes) return;

    teleportTo(sim, wilkes.pos.x + 2, wilkes.pos.z);
    sim.copper = 20;
    expect(sim.countItem('field_kit')).toBe(0);

    sim.buyItem(wilkes.id, 'field_kit');

    expect(sim.countItem('field_kit')).toBe(1);
    expect(sim.copper).toBe(0);
  });
});
