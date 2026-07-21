import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { itemSourceLevel } from '../src/sim/item_level';
import { meetsLevelRequirement, requiredLevelFor } from '../src/sim/item_level_req';
import type { ItemDef } from '../src/sim/types';
import { MAX_LEVEL } from '../src/sim/types';

function gear(quality: ItemDef['quality'], extra: Partial<ItemDef> = {}): ItemDef {
  return {
    id: 'test_item',
    name: 'Test Item',
    kind: 'armor',
    slot: 'chest',
    armorType: 'cloth',
    sellValue: 1,
    quality,
    ...extra,
  } as ItemDef;
}

describe('requiredLevelFor', () => {
  it('leaves the leveling greens ungated and gates rare and above', () => {
    expect(requiredLevelFor(gear('poor'))).toBe(1);
    expect(requiredLevelFor(gear('common'))).toBe(1);
    expect(requiredLevelFor(gear('uncommon'))).toBe(1);
    expect(requiredLevelFor(gear('rare'))).toBe(12);
    expect(requiredLevelFor(gear('epic'))).toBe(18);
    expect(requiredLevelFor(gear('legendary'))).toBe(MAX_LEVEL);
  });

  it('treats a missing quality as common (ungated)', () => {
    expect(requiredLevelFor(gear(undefined))).toBe(1);
  });

  it('lets an explicit requiredLevel override the quality default', () => {
    expect(requiredLevelFor(gear('common', { requiredLevel: 10 }))).toBe(10);
    expect(requiredLevelFor(gear('legendary', { requiredLevel: 3 }))).toBe(3);
  });

  it('clamps the requirement to [1, MAX_LEVEL]', () => {
    expect(requiredLevelFor(gear('common', { requiredLevel: 0 }))).toBe(1);
    expect(requiredLevelFor(gear('common', { requiredLevel: -5 }))).toBe(1);
    expect(requiredLevelFor(gear('common', { requiredLevel: 999 }))).toBe(MAX_LEVEL);
  });

  it('never gates higher than the level cap, so the rarest gear stays reachable', () => {
    for (const q of ['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary'] as const) {
      expect(requiredLevelFor(gear(q))).toBeLessThanOrEqual(MAX_LEVEL);
    }
  });
});

describe('meetsLevelRequirement', () => {
  it('is false below the requirement and true at or above it', () => {
    const rare = gear('rare'); // requires 12
    expect(meetsLevelRequirement(11, rare)).toBe(false);
    expect(meetsLevelRequirement(12, rare)).toBe(true);
    expect(meetsLevelRequirement(20, rare)).toBe(true);
  });

  it('always passes common/poor starter gear at level 1', () => {
    expect(meetsLevelRequirement(1, gear('common'))).toBe(true);
    expect(meetsLevelRequirement(1, gear('poor'))).toBe(true);
  });

  it('is a pure function of its inputs (same inputs, same result)', () => {
    const item = gear('epic');
    expect(meetsLevelRequirement(18, item)).toEqual(meetsLevelRequirement(18, item));
  });
});

describe('requiredLevelFor against real content', () => {
  it('never gates a rare-and-above item above the level of the content it drops from', () => {
    for (const item of Object.values(ITEMS)) {
      if (item.requiredLevel !== undefined) continue; // explicit override, not derived
      const quality = item.quality ?? 'common';
      if (quality !== 'rare' && quality !== 'epic' && quality !== 'legendary') continue;
      const source = itemSourceLevel(item.id);
      if (source === undefined) continue; // no derivable source: falls back to the quality band
      expect(requiredLevelFor(item)).toBeLessThanOrEqual(source);
    }
  });

  it("gates a known dungeon-tier rare (mogger's shiv) to where it actually drops", () => {
    const item = ITEMS.moggers_shiv;
    expect(item).toBeDefined();
    const source = itemSourceLevel(item.id);
    expect(source).toBeDefined();
    expect(requiredLevelFor(item)).toBe(source);
  });
});
