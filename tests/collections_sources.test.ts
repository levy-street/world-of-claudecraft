import { beforeEach, describe, expect, it } from 'vitest';
import { BUDDY_KEYS } from '../src/sim/content/buddies';
import { BUDDY_BOSS_DROPS, BUDDY_DEED_REWARDS } from '../src/sim/content/buddy_sources';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { ITEMS, NPCS } from '../src/sim/data';
import {
  buddySourceFacts,
  collectionItemFacts,
  resetCollectionSourceCache,
} from '../src/ui/collections/collection_sources';

describe('collection source derivation', () => {
  beforeEach(() => {
    resetCollectionSourceCache();
  });

  it('reports an unknown item id as absent rather than inventing a source', () => {
    expect(collectionItemFacts('no_such_item_id')).toBeNull();
  });

  it('derives honor vendor prices from stocked item definitions', () => {
    const item = Object.values(ITEMS).find(
      (candidate) =>
        candidate.priceHonor !== undefined &&
        Object.values(NPCS).some((npc) => npc.vendorItems?.includes(candidate.id)),
    );
    expect(item).toBeDefined();
    const facts = collectionItemFacts(item!.id);
    const vendor = facts?.vendors.find((row) => row.currency === 'honor');
    expect(vendor).toBeDefined();
    expect(vendor?.price).toBe(item!.priceHonor);
    expect(vendor?.zoneName.length).toBeGreaterThan(0);
    expect(facts?.obtainable).toBe(true);
  });

  it('derives marks prices from the quartermaster stock', () => {
    const offer = HEROIC_VENDOR_STOCK[0];
    expect(offer).toBeDefined();
    const facts = collectionItemFacts(offer.itemId);
    const vendor = facts?.vendors.find((row) => row.currency === 'marks');
    expect(vendor?.price).toBe(offer.marks);
    expect(NPCS[vendor?.npcId ?? ''].heroicVendor).toBe(true);
  });

  it('does not advertise retired buddy tokens as obtainable', () => {
    for (const id of ['whistle_proud_grunt', 'whistle_loot_goblin', 'whistle_penny_goldspark']) {
      const facts = collectionItemFacts(id);
      expect(facts?.obtainable ?? false, id).toBe(false);
      expect(facts?.vendors ?? [], id).toEqual([]);
    }
  });

  it('derives the per-player boss rolls for a boss pet, with the heroic rate and gate', () => {
    const lich = buddySourceFacts('crystal_lich');
    expect(lich.bossDrops).toHaveLength(1);
    expect(lich.bossDrops[0].bossId).toBe('nythraxis_scourge_of_thornpeak');
    expect(lich.bossDrops[0].bossName.length).toBeGreaterThan(0);
    expect(lich.bossDrops[0].location.length).toBeGreaterThan(0);
    expect(lich.bossDrops[0].chance).toBe(0.005);
    expect(lich.bossDrops[0].heroicChance).toBe(0.01);
    expect(lich.bossDrops[0].heroicOnly).toBe(false);
    expect(lich.deedId).toBeNull();
    expect(lich.obtainable).toBe(true);
    const forge = buddySourceFacts('forgemaw');
    expect(forge.bossDrops).toHaveLength(2);
    expect(forge.bossDrops.every((d) => d.heroicOnly)).toBe(true);
  });

  it('reports Horse at both honor vendors for 100,000 honor', () => {
    const facts = buddySourceFacts('horse');
    expect(facts.deedId).toBeNull();
    expect(facts.bossDrops).toEqual([]);
    expect(facts.obtainable).toBe(true);
    expect(
      facts.token?.vendors
        .map(({ npcId, currency, price }) => ({ npcId, currency, price }))
        .sort((a, b) => a.npcId.localeCompare(b.npcId)),
    ).toEqual([
      { npcId: 'fury', currency: 'honor', price: 100_000 },
      { npcId: 'warmarshal_draven_kole', currency: 'honor', price: 100_000 },
    ]);
  });

  it('every companion the tables name is obtainable, and every other one says so honestly', () => {
    const sourced = new Set<string>([
      ...BUDDY_BOSS_DROPS.map((row) => row.key),
      ...Object.values(BUDDY_DEED_REWARDS),
      ...Object.values(ITEMS).flatMap((item) =>
        item.kind === 'buddy' &&
        Object.values(NPCS).some((npc) => npc.vendorItems?.includes(item.id))
          ? [item.buddy]
          : [],
      ),
    ]);
    for (const key of BUDDY_KEYS) {
      expect(buddySourceFacts(key).obtainable, key).toBe(sourced.has(key));
    }
  });

  it('derives a heroic-only mount drop with its boss, dungeon and authored chance', () => {
    const facts = collectionItemFacts('reins_stormfeather_griffin');
    const drop = facts?.drops.find((d) => d.heroicOnly);
    expect(drop).toBeTruthy();
    expect(drop?.chance).toBeGreaterThan(0);
    expect(drop?.mobName.length).toBeGreaterThan(0);
    expect(facts?.obtainable).toBe(true);
  });

  it('memoizes per id, so the window can ask once per row per frame', () => {
    const first = collectionItemFacts('reins_stormfeather_griffin');
    expect(collectionItemFacts('reins_stormfeather_griffin')).toBe(first);
    const buddy = buddySourceFacts('crystal_lich');
    expect(buddySourceFacts('crystal_lich')).toBe(buddy);
    resetCollectionSourceCache();
    expect(collectionItemFacts('reins_stormfeather_griffin')).not.toBe(first);
    expect(buddySourceFacts('crystal_lich')).not.toBe(buddy);
  });
});
