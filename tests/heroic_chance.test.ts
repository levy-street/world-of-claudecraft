// LootEntry.heroicChance: one loot row, two drop rates.
//
// The money arm already had this shape (heroicCopper substitutes the payout
// base under a heroic claim); this is the same substitution for a row's ODDS,
// added so the Crystal Lich buddy can drop from Nythraxis at 0.5% on normal and
// 1% on heroic without living on two tables (which would let a heroic kill award
// it twice, the exact case tests/loot_roll.ts's cross-table dedup guards).
//
// The pins here are the two things that could silently go wrong: the rate must
// actually change with the claim, and the DRAW COUNT must not, because every
// loot parity golden rides the per-kill draw sequence.

import { describe, expect, it } from 'vitest';
import { DUNGEON_MOBS } from '../src/sim/content/dungeons';
import { HEROIC_BOSS_LOOT, NYTHRAXIS_RAID_BOSS_ID } from '../src/sim/content/heroic_loot';
import { ITEMS } from '../src/sim/data';
import type { LootEntry } from '../src/sim/types';

const nythraxisLoot = DUNGEON_MOBS[NYTHRAXIS_RAID_BOSS_ID].loot;
const lichRow = nythraxisLoot.find((row: LootEntry) => row.itemId === 'whistle_crystal_lich');

describe('Crystal Lich drop rates', () => {
  it('drops from Nythraxis at 0.5% on normal and 1% on heroic, from one row', () => {
    expect(lichRow).toBeTruthy();
    expect(lichRow?.chance).toBe(0.005);
    expect(lichRow?.heroicChance).toBe(0.01);
    // Ungrouped: an independent draw that never displaces a set piece from the
    // exact-1.00 rollGroup partitions the boss's gear rides.
    expect(lichRow?.rollGroup).toBeUndefined();
  });

  it('lives on the normal table only, so a heroic kill can never award it twice', () => {
    const heroicIds = HEROIC_BOSS_LOOT[NYTHRAXIS_RAID_BOSS_ID].map((row) => row.itemId);
    expect(heroicIds).not.toContain('whistle_crystal_lich');
  });

  it('is the epic buddy whistle, which the global drop tier does not carry', () => {
    expect(ITEMS.whistle_crystal_lich.kind).toBe('buddy');
    expect(ITEMS.whistle_crystal_lich.quality).toBe('epic');
  });

  it('adds no second draw: the heroic rate is a value swap on the same row', () => {
    // Structural, not statistical: the roller reads ONE chance per non-group
    // row, so a row carrying both rates is still one row. Anything that split
    // this into two entries would show up here as a changed row count.
    const rows = nythraxisLoot.filter((row: LootEntry) => row.itemId === 'whistle_crystal_lich');
    expect(rows).toHaveLength(1);
  });
});
