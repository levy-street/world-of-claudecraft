// The owner plan (2026-09-09) as content invariants: buddies are never bag
// loot, never a gold vendor row, and every source the tables name resolves.
import { describe, expect, it } from 'vitest';
import { BUDDY_KEYS } from '../src/sim/content/buddies';
import { BUDDY_BOSS_DROPS, BUDDY_DEED_REWARDS } from '../src/sim/content/buddy_sources';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS, MOBS, NPCS } from '../src/sim/data';
import type { ItemDef } from '../src/sim/types';

const whistles: ItemDef[] = Object.values(ITEMS).filter((item) => item.kind === 'buddy');
const charms: ItemDef[] = Object.values(ITEMS).filter((item) => item.kind === 'buddy_cosmetic');

describe('companions have no inventory items', () => {
  it('has no whistle or charm definitions', () => {
    expect(whistles).toEqual([]);
    expect(charms).toEqual([]);
  });
  it('has no companion items in loot, vendor stock or recipes', () => {
    const ids = [
      ...Object.values(MOBS).flatMap((mob) => (mob.loot ?? []).map((row) => row.itemId)),
      ...Object.values(HEROIC_BOSS_LOOT).flatMap((rows) => rows.map((row) => row.itemId)),
      ...Object.values(NPCS).flatMap((npc) => npc.vendorItems ?? []),
      ...HEROIC_VENDOR_STOCK.map((row) => row.itemId),
      ...ALL_RECIPES.map((row) => row.resultItemId),
    ];
    expect(ids.filter((id) => id?.startsWith('whistle_') || id?.startsWith('charm_stag_'))).toEqual(
      [],
    );
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

  it('no charm items remain and nothing crafts a buddy item', () => {
    expect(charms).toEqual([]);
    const recipes = ALL_RECIPES.filter((r) =>
      ['buddy', 'buddy_cosmetic'].includes(ITEMS[r.resultItemId]?.kind),
    );
    expect(recipes).toEqual([]);
  });
});
