// The owner plan (2026-09-09) as content invariants: buddies are never bag
// loot, never a gold vendor row, and every source the tables name resolves.
import { describe, expect, it } from 'vitest';
import { BUDDY_KEYS } from '../src/sim/content/buddies';
import { BUDDY_COSMETICS } from '../src/sim/content/buddy_cosmetics';
import {
  BUDDY_BOSS_DROPS,
  BUDDY_COSMETIC_CHALLENGES,
  BUDDY_COSMETIC_GRANT_ONLY,
  BUDDY_DEED_REWARDS,
} from '../src/sim/content/buddy_sources';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS, MOBS, NPCS } from '../src/sim/data';
import type { ItemDef } from '../src/sim/types';

const whistles: ItemDef[] = Object.values(ITEMS).filter((item) => item.kind === 'buddy');
const charms: ItemDef[] = Object.values(ITEMS).filter((item) => item.kind === 'buddy_cosmetic');

describe('buddy tokens: soulbound, consumed on use, never loot', () => {
  it('has a whistle for every buddy, so the sweeps below are not vacuous', () => {
    expect(whistles.length).toBe(BUDDY_KEYS.length);
  });

  it('binds every whistle and every charm', () => {
    for (const item of [...whistles, ...charms]) {
      expect(item.soulbound, `${item.id} soulbound`).toBe(true);
    }
  });

  it('keeps the flat 5g vendor value so an unwanted duplicate is bag space back', () => {
    for (const item of [...whistles, ...charms]) {
      expect(item.noDiscard, `${item.id} noDiscard`).toBeUndefined();
      if ((item.priceHonor ?? 0) > 0) {
        // Honor purchases are final (the Warfare doctrine): the honor whistle
        // sells back for nothing and the vendor refuses it.
        expect(item.sellValue, `${item.id} sellValue`).toBe(0);
        expect(item.noVendorSell, `${item.id} noVendorSell`).toBe(true);
        continue;
      }
      if (item.kind === 'buddy_cosmetic' && item.id === 'charm_stag_acorn') {
        // The crafted charm vendors below its fifteen logs (recipe_economy).
        expect(item.sellValue, `${item.id} sellValue`).toBe(200);
        continue;
      }
      expect(item.sellValue, `${item.id} sellValue`).toBe(50_000);
      expect(item.noVendorSell, `${item.id} noVendorSell`).toBeUndefined();
    }
  });

  it('lists no whistle on any mob loot table, normal or heroic', () => {
    const ids = new Set(whistles.map((item) => item.id));
    for (const mob of Object.values(MOBS)) {
      for (const row of mob.loot ?? []) {
        expect(ids.has(row.itemId ?? ''), `${mob.id} drops ${row.itemId}`).toBe(false);
      }
    }
    for (const [bossId, rows] of Object.entries(HEROIC_BOSS_LOOT)) {
      for (const row of rows) {
        expect(ids.has(row.itemId ?? ''), `${bossId} heroic drops ${row.itemId}`).toBe(false);
      }
    }
  });

  it('sells no companion for plain gold: the honor and marks counters are the only whistle rows', () => {
    const goldVendors: string[] = [];
    for (const npc of Object.values(NPCS)) {
      for (const itemId of npc.vendorItems ?? []) {
        const item = ITEMS[itemId];
        if (item?.kind !== 'buddy') continue;
        if (item.priceHonor === undefined) goldVendors.push(`${npc.id}:${itemId}`);
      }
    }
    expect(goldVendors).toEqual([]);
    const marks = HEROIC_VENDOR_STOCK.filter((o) => ITEMS[o.itemId]?.kind === 'buddy');
    expect(marks.map((o) => o.itemId)).toEqual(['whistle_loot_goblin']);
    expect(ITEMS.whistle_proud_grunt.priceHonor).toBeGreaterThan(0);
    expect(ITEMS.whistle_penny_goldspark.buyValue).toBeUndefined();
  });
});

describe('every buddy source resolves', () => {
  it('boss rows name real bosses and real companions, and Forgemaw stays heroic-only', () => {
    for (const row of BUDDY_BOSS_DROPS) {
      expect(MOBS[row.bossId], row.bossId).toBeTruthy();
      expect((BUDDY_KEYS as readonly string[]).includes(row.key), row.key).toBe(true);
    }
    const forge = BUDDY_BOSS_DROPS.filter((row) => row.key === 'forgemaw');
    expect(forge).toHaveLength(2);
    for (const row of forge) expect(row.heroicOnly).toBe(true);
  });

  it('deed rewards name real companions; a look belongs to a real companion', () => {
    for (const key of Object.values(BUDDY_DEED_REWARDS)) {
      expect((BUDDY_KEYS as readonly string[]).includes(key), key).toBe(true);
    }
    for (const def of Object.values(BUDDY_COSMETICS)) {
      expect((BUDDY_KEYS as readonly string[]).includes(def.buddy), def.id).toBe(true);
    }
  });

  it('every charm names a real look and every crafted look has a recipe whose reagents exist', () => {
    for (const charm of charms) {
      const cosmetic = (charm as { cosmetic: string }).cosmetic;
      expect(BUDDY_COSMETICS[cosmetic], charm.id).toBeTruthy();
    }
    const recipes = ALL_RECIPES.filter((r) => ITEMS[r.resultItemId]?.kind === 'buddy_cosmetic');
    expect(recipes.length).toBeGreaterThan(0);
    for (const recipe of recipes) {
      for (const reagent of recipe.reagents) {
        expect(ITEMS[reagent.itemId], `${recipe.id} reagent ${reagent.itemId}`).toBeTruthy();
      }
    }
  });

  it('a grant-only look has no in-game source at all, which is the whole point', () => {
    for (const id of BUDDY_COSMETIC_GRANT_ONLY) {
      expect(BUDDY_COSMETICS[id], id).toBeTruthy();
      expect(BUDDY_COSMETIC_CHALLENGES.some((c) => c.cosmeticId === id)).toBe(false);
      expect(charms.some((c) => (c as { cosmetic: string }).cosmetic === id)).toBe(false);
    }
  });
});
