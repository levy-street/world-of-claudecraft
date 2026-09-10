// Forgemaw The Molten: the first companion whose ONLY source is a heroic kill.
//
// The Crystal Lich needed LootEntry.heroicChance because it drops on both
// difficulties at different rates. This one needs nothing new: HEROIC_BOSS_LOOT
// rows are appended to a boss's table only when the dying mob's claimed
// instance is heroic (loot/loot_roll.ts), so a plain row there IS "heroic only"
// — Normal Ignivar and Normal Varkhul never see it.
//
// What could silently go wrong, and is therefore pinned: the rate drifting off
// 1%, the row acquiring a rollGroup (which would make it compete with the set
// pieces instead of rolling independently), the whistle leaking onto a normal
// mob table, and the epic global-drop tier opening up and handing it out for
// free anywhere in the world.

import { describe, expect, it } from 'vitest';
import { BUDDIES } from '../src/sim/content/buddies';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { ITEMS, MOBS } from '../src/sim/data';
import { VARKHUL_BOSS_ID } from '../src/sim/ignivar_raid_ids';
import { GLOBAL_BUDDY_DROP_TIERS } from '../src/sim/loot/global_drops';
import { IGNIVAR_BOSS_ID } from '../src/sim/types';

const WHISTLE = 'whistle_forgemaw';
const rowsOn = (bossId: string) =>
  (HEROIC_BOSS_LOOT[bossId] ?? []).filter((row) => row.itemId === WHISTLE);

describe('Forgemaw The Molten drop', () => {
  it('drops at 1% from both Crucible bosses, on heroic only', () => {
    for (const bossId of [IGNIVAR_BOSS_ID, VARKHUL_BOSS_ID]) {
      const rows = rowsOn(bossId);
      expect(rows, `${bossId} rows`).toHaveLength(1);
      expect(rows[0].chance, `${bossId} chance`).toBe(0.01);
      // Ungrouped: an independent draw, so the companion never displaces a
      // sigil or a weapon from the boss's exact-1.00 rollGroup partitions.
      expect(rows[0].rollGroup, `${bossId} rollGroup`).toBeUndefined();
    }
  });

  it('is on no normal mob table anywhere, which is what makes heroic the gate', () => {
    const normalSources = Object.values(MOBS)
      .filter((mob) => (mob.loot ?? []).some((row) => row.itemId === WHISTLE))
      .map((mob) => mob.id);
    expect(normalSources).toEqual([]);
  });

  it('is an epic buddy whistle the global drop table cannot hand out', () => {
    expect(ITEMS[WHISTLE].kind).toBe('buddy');
    expect(ITEMS[WHISTLE].quality).toBe('epic');
    expect(BUDDIES.forgemaw.kind).toBe('elemental');
    const epic = GLOBAL_BUDDY_DROP_TIERS.find((tier) => tier.quality === 'epic');
    expect(epic?.chance).toBe(0);
  });

  it('sells for the flat 5g every whistle takes, and stays discardable and tradeable', () => {
    const item = ITEMS[WHISTLE];
    expect(item.sellValue).toBe(50_000);
    expect(item.soulbound).toBeUndefined();
    expect(item.noDiscard).toBeUndefined();
    expect(item.noVendorSell).toBeUndefined();
  });
});
