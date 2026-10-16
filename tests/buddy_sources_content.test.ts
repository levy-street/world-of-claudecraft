// The owner plan (2026-09-09) as content invariants: buddies are never bag
// loot, never a gold vendor row, and every source the tables name resolves.
import { describe, expect, it } from 'vitest';
import { BUDDY_KEYS, buddyDef } from '../src/sim/content/buddies';
import { BUDDY_BOSS_DROPS, BUDDY_DEED_REWARDS } from '../src/sim/content/buddy_sources';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS, MOBS, NPCS } from '../src/sim/data';
import type { ItemDef } from '../src/sim/types';

const whistles: ItemDef[] = Object.values(ITEMS).filter((item) => item.kind === 'buddy');
const charms: ItemDef[] = Object.values(ITEMS).filter((item) => item.kind === 'buddy_cosmetic');

describe('buddy tokens: soulbound, consumed on use, never loot', () => {
  it('has a whistle for every buddy, so the sweeps below are not vacuous', () => {
    const active = whistles.filter((item) => item.kind === 'buddy' && buddyDef(item.buddy));
    expect(active.map((item) => item.id).sort()).toEqual([
      'whistle_crystal_lich',
      'whistle_forgemaw',
      'whistle_horse',
      'whistle_sapling',
    ]);
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

  it('sells only Horse through the two honor vendors', () => {
    const vendorTokens: string[] = [];
    for (const npc of Object.values(NPCS)) {
      for (const itemId of npc.vendorItems ?? []) {
        const item = ITEMS[itemId];
        if (item?.kind === 'buddy' || item?.kind === 'buddy_cosmetic')
          vendorTokens.push(`${npc.id}:${itemId}`);
      }
    }
    expect(vendorTokens.sort()).toEqual([
      'fury:whistle_horse',
      'warmarshal_draven_kole:whistle_horse',
    ]);
    const marks = HEROIC_VENDOR_STOCK.filter((o) =>
      ['buddy', 'buddy_cosmetic'].includes(ITEMS[o.itemId]?.kind),
    );
    expect(marks).toEqual([]);
  });
});

describe('every buddy source resolves', () => {
  it('has no deed rewards', () => {
    expect(BUDDY_DEED_REWARDS).toEqual({});
  });

  it('boss rows name real bosses and real companions, and Forgemaw stays heroic-only', () => {
    expect(BUDDY_BOSS_DROPS.map((row) => [row.key, row.bossId])).toEqual([
      ['crystal_lich', 'nythraxis_scourge_of_thornpeak'],
      ['forgemaw', 'ignivar_herald_of_the_last_flame'],
      ['forgemaw', 'varkhul_forgefather_of_the_last_flame'],
    ]);
    for (const row of BUDDY_BOSS_DROPS) {
      expect(MOBS[row.bossId], row.bossId).toBeTruthy();
      expect((BUDDY_KEYS as readonly string[]).includes(row.key), row.key).toBe(true);
    }
    const forge = BUDDY_BOSS_DROPS.filter((row) => row.key === 'forgemaw');
    expect(forge).toHaveLength(2);
    for (const row of forge) expect(row.heroicOnly).toBe(true);
  });

  it('historical charms have no active look and no remaining crafting source', () => {
    expect(charms.map((charm) => charm.id).sort()).toEqual([
      'charm_stag_acorn',
      'charm_stag_gilded',
    ]);
    const recipes = ALL_RECIPES.filter((r) =>
      ['buddy', 'buddy_cosmetic'].includes(ITEMS[r.resultItemId]?.kind),
    );
    expect(recipes).toEqual([]);
  });
});
