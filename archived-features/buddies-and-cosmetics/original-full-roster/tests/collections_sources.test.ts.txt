import { beforeEach, describe, expect, it } from 'vitest';
import { BUDDY_KEYS } from '../src/sim/content/buddies';
import { BUDDY_COSMETICS } from '../src/sim/content/buddy_cosmetics';
import {
  BUDDY_BOSS_DROPS,
  BUDDY_COSMETIC_CHALLENGES,
  BUDDY_DEED_REWARDS,
} from '../src/sim/content/buddy_sources';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { ITEMS, NPCS } from '../src/sim/data';
import {
  buddyCosmeticFacts,
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

  it('derives the honor vendor, its zone and its price for the Proud Grunt token', () => {
    const facts = collectionItemFacts('whistle_proud_grunt');
    expect(facts?.obtainable).toBe(true);
    expect(facts?.drops).toEqual([]);
    expect(facts?.vendors).toHaveLength(1);
    const vendor = facts?.vendors[0];
    expect(vendor?.npcId).toBe('warmarshal_draven_kole');
    expect(vendor?.currency).toBe('honor');
    expect(vendor?.price).toBe(ITEMS.whistle_proud_grunt.priceHonor);
    expect(vendor?.zoneName.length).toBeGreaterThan(0);
    // A token binds: the companion is the character's, never the market's.
    expect(facts?.tradeable).toBe(false);
    // Honor purchases are final: no vendor buys the honor whistle back.
    expect(facts?.sellValue).toBeNull();
    // And the companion row reads the same vendor through its token.
    const buddy = buddySourceFacts('proud_grunt');
    expect(buddy.token?.vendors[0]?.npcId).toBe('warmarshal_draven_kole');
    expect(buddy.obtainable).toBe(true);
  });

  it('derives the marks price for the Loot Goblin token from the quartermaster stock', () => {
    const facts = collectionItemFacts('whistle_loot_goblin');
    const vendor = facts?.vendors.find((v) => v.currency === 'marks');
    const offer = HEROIC_VENDOR_STOCK.find((o) => o.itemId === 'whistle_loot_goblin');
    expect(vendor?.price).toBe(offer?.marks);
    expect(NPCS[vendor?.npcId ?? ''].heroicVendor).toBe(true);
  });

  it('Penny Goldspark has no gold row any more and reports as unobtainable', () => {
    const facts = collectionItemFacts('whistle_penny_goldspark');
    expect(facts?.vendors).toEqual([]);
    expect(facts?.obtainable).toBe(false);
    expect(buddySourceFacts('penny_goldspark').obtainable).toBe(false);
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

  it('derives the deed for an achievement pet, and the table agrees', () => {
    const stag = buddySourceFacts('stag');
    expect(stag.deedId).toBe('prog_logging_100');
    expect(BUDDY_DEED_REWARDS.prog_logging_100).toBe('stag');
    expect(stag.bossDrops).toEqual([]);
    expect(stag.obtainable).toBe(true);
  });

  it('every companion the tables name is obtainable, and every other one says so honestly', () => {
    const sourced = new Set<string>([
      ...BUDDY_BOSS_DROPS.map((row) => row.key),
      ...Object.values(BUDDY_DEED_REWARDS),
      'proud_grunt',
      'loot_goblin',
    ]);
    for (const key of BUDDY_KEYS) {
      expect(buddySourceFacts(key).obtainable, key).toBe(sourced.has(key));
    }
  });

  it('derives a look’s challenge, deed, craft, vendor and grant sources', () => {
    const frost = buddyCosmeticFacts('crystal_lich_frostbound');
    expect(frost?.challenges).toHaveLength(1);
    expect(frost?.challenges[0].kind).toBe('speed');
    expect(frost?.challenges[0].amount).toBe(
      BUDDY_COSMETIC_CHALLENGES.find((c) => c.cosmeticId === 'crystal_lich_frostbound')!.kind ===
        'speed'
        ? 300
        : -1,
    );
    expect(frost?.obtainable).toBe(true);
    const acorn = buddyCosmeticFacts('stag_acorn');
    expect(acorn?.craft?.recipeId).toBe('recipe_charm_stag_acorn');
    expect(acorn?.craft?.professionId).toBe('leatherworking');
    expect(acorn?.tokenItemId).toBe('charm_stag_acorn');
    expect(acorn?.vendors).toEqual([]);
    const gilded = buddyCosmeticFacts('stag_gilded');
    expect(gilded?.vendors[0]?.npcId).toBe('armorer_hode');
    expect(gilded?.vendors[0]?.currency).toBe('gold');
    expect(gilded?.craft).toBeNull();
    const warlord = buddyCosmeticFacts('proud_grunt_warlord');
    expect(warlord?.grantOnly).toBe(true);
    expect(warlord?.obtainable).toBe(true);
    expect(warlord?.challenges).toEqual([]);
    const verdant = buddyCosmeticFacts('moss_hare_verdant');
    expect(verdant?.deedId).toBe('prog_master_gatherer');
    expect(buddyCosmeticFacts('no_such_look')).toBeNull();
  });

  it('every authored look is obtainable one way or another', () => {
    for (const id of Object.keys(BUDDY_COSMETICS)) {
      expect(buddyCosmeticFacts(id)?.obtainable, id).toBe(true);
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
    const first = collectionItemFacts('whistle_proud_grunt');
    expect(collectionItemFacts('whistle_proud_grunt')).toBe(first);
    const buddy = buddySourceFacts('stag');
    expect(buddySourceFacts('stag')).toBe(buddy);
    resetCollectionSourceCache();
    expect(collectionItemFacts('whistle_proud_grunt')).not.toBe(first);
    expect(buddySourceFacts('stag')).not.toBe(buddy);
  });
});
