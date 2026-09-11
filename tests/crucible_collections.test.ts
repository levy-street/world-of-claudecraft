import { describe, expect, it } from 'vitest';
import {
  CRUCIBLE_COLLECTION_ITEMS,
  CRUCIBLE_COLLECTION_PATTERNS,
  CRUCIBLE_COLLECTION_RECIPES,
  CRUCIBLE_COLLECTIONS,
  CRUCIBLE_PROFESSION_PATTERN_LOOT,
  crucibleCollectionFamilyForSet,
  crucibleCollectionForItem,
} from '../src/sim/content/crucible_collections';
import { CRUCIBLE_VENDOR_STOCK } from '../src/sim/content/ignivar_loot';
import { ITEM_SETS } from '../src/sim/content/item_sets';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS, MOBS } from '../src/sim/data';
import { VARKHUL_BOSS_ID } from '../src/sim/ignivar_raid_ids';
import {
  expectedStatBudget,
  itemLevel,
  primaryStatSum,
  staminaBaseline,
  statIdentity,
} from '../src/sim/item_level';
import { IGNIVAR_BOSS_ID } from '../src/sim/types';

const EXPECTED_PROFILES = [
  ['crucible_str_mail', 'physical', 'mail', 'armorcrafting'],
  ['crucible_tank_mail', 'tank', 'mail', 'armorcrafting'],
  ['crucible_caster_mail', 'caster', 'mail', 'armorcrafting'],
  ['crucible_healer_mail', 'healer', 'mail', 'armorcrafting'],
  ['crucible_agi_leather', 'physical', 'leather', 'leatherworking'],
  ['crucible_str_leather', 'physical', 'leather', 'leatherworking'],
  ['crucible_tank_leather', 'tank', 'leather', 'leatherworking'],
  ['crucible_caster_leather', 'caster', 'leather', 'leatherworking'],
  ['crucible_healer_leather', 'healer', 'leather', 'leatherworking'],
  ['crucible_caster_cloth', 'caster', 'cloth', 'tailoring'],
  ['crucible_healer_cloth', 'healer', 'cloth', 'tailoring'],
] as const;

describe('Crucible crafted collections', () => {
  it('covers every approved native armor and stat profile', () => {
    expect(CRUCIBLE_COLLECTIONS.map((c) => [c.id, c.role, c.armorType, c.craftId])).toEqual(
      EXPECTED_PROFILES,
    );
    expect(Object.keys(CRUCIBLE_COLLECTION_ITEMS)).toHaveLength(33);
    expect(new Set(CRUCIBLE_COLLECTIONS.flatMap((c) => [...c.itemIds])).size).toBe(33);
  });

  it('offers chest, waist, and feet with one two-piece bonus and no three-piece reward', () => {
    for (const collection of CRUCIBLE_COLLECTIONS) {
      expect(collection.itemIds.map((id) => ITEMS[id].slot)).toEqual(['chest', 'waist', 'feet']);
      expect(ITEM_SETS[collection.id].bonuses.map((tier) => tier.pieces)).toEqual([2]);
      expect(ITEM_SETS[collection.id].lineage).toBeUndefined();
      for (const id of collection.itemIds) {
        expect(ITEMS[id].set).toBe(collection.id);
        expect(crucibleCollectionForItem(id)).toBe(collection);
      }
      expect(crucibleCollectionFamilyForSet(collection.id)).toBe(collection.role);
    }
    expect(crucibleCollectionForItem('forgefold_legguards')).toBeUndefined();
    expect(crucibleCollectionForItem('missing_item')).toBeUndefined();
    expect(crucibleCollectionFamilyForSet('deathlord')).toBeUndefined();
  });

  it('ships useful tradable rank-zero Masterwrought pieces at honest item level 35', () => {
    // The shared line budget per slot: physical roles (str/tank/agi) already
    // hold their stamina inside it, while the caster and healer roles carry
    // their free stamina baseline on top (item_budget.ts, the stamina
    // baseline model), so their TOTAL is the line plus that baseline.
    const lineBudgets = { chest: 25, waist: 17, feet: 16 };
    for (const item of Object.values(CRUCIBLE_COLLECTION_ITEMS)) {
      expect(ITEMS[item.id]).toBe(item);
      expect(item.kind).toBe('armor');
      expect(item.quality).toBe('epic');
      expect(item.requiredLevel).toBe(20);
      expect(item.masterwrought).toBe(true);
      expect(item.soulbound).not.toBe(true);
      expect(itemLevel(item)).toBe(35);
      const line = lineBudgets[item.slot as keyof typeof lineBudgets];
      const expectedTotal =
        statIdentity(item.stats) === 'caster' ? line + staminaBaseline(line) : line;
      expect(primaryStatSum(item)).toBe(expectedTotal);
      expect(primaryStatSum(item)).toBe(expectedStatBudget(item));
      expect((item.critRating ?? 0) + (item.hasteRating ?? 0) + (item.hitRating ?? 0)).toBe(85);
    }
    // The baseline the caster pieces ride, pinned as literals so the generated
    // totals above are checked against numbers and not the share constant that
    // produced them.
    expect([25, 17, 16].map(staminaBaseline)).toEqual([8, 6, 5]);
    // And the chest lines as literals (stamina baseline model, 2026-09-10): the
    // caster profile keeps its Intellect and takes its Spirit on the line, the
    // healer profile its 14:11, the physical profiles their stamina inside the
    // line. Swapping Intellect and Spirit would pass every check above and reds here.
    expect(ITEMS.crucible_caster_cloth_chest.stats).toEqual({
      int: 17,
      spi: 8,
      sta: 8,
      armor: 105,
    });
    expect(ITEMS.crucible_healer_cloth_chest.stats).toEqual({
      int: 14,
      spi: 11,
      sta: 8,
      armor: 105,
    });
    expect(ITEMS.crucible_str_mail_chest.stats).toEqual({ str: 17, sta: 8, armor: 380 });
    expect(ITEMS.crucible_tank_mail_chest.stats).toEqual({ str: 10, sta: 15, armor: 380 });
  });

  it('does not leave cat, bear, Stonebound, or conversion healers on the wrong stats', () => {
    expect(ITEMS.crucible_str_leather_chest.stats?.str).toBeGreaterThan(0);
    expect(ITEMS.crucible_tank_leather_chest.stats?.sta).toBeGreaterThan(
      ITEMS.crucible_tank_leather_chest.stats?.agi ?? 0,
    );
    expect(ITEMS.crucible_tank_mail_chest.requiredClass).toContain('shaman');
    expect(ITEMS.crucible_caster_mail_chest.requiredClass).toContain('shaman');
    expect(ITEMS.crucible_healer_mail_chest.requiredClass).toContain('paladin');
    expect(ITEMS.crucible_healer_cloth_chest.requiredClass).toEqual(['mage', 'priest']);
    expect(ITEMS.crucible_healer_cloth_chest.spellPower).toBeGreaterThan(0);
    expect(ITEMS.crucible_healer_cloth_chest.healPower).toBeGreaterThan(0);
  });

  it('learns at skill 100 and charges three undiscounted raid cores without daily inputs', () => {
    expect(CRUCIBLE_COLLECTION_RECIPES).toHaveLength(33);
    for (const recipe of CRUCIBLE_COLLECTION_RECIPES) {
      expect(ALL_RECIPES).toContain(recipe);
      expect(recipe.skillReq).toBe(100);
      expect(recipe.level).toBe(29);
      expect(recipe.acquisition).toEqual(['drop']);
      expect(recipe.oncePerDay).not.toBe(true);
      expect(recipe.reagents[0]).toEqual({ itemId: 'lastflame_core', count: 3, noDiscount: true });
      for (const blocked of ['quickening_catalyst', 'wyrmfall_core', 'makers_ember']) {
        expect(recipe.reagents.map((r) => r.itemId)).not.toContain(blocked);
      }
      for (const reagent of recipe.reagents) expect(ITEMS[reagent.itemId]).toBeDefined();
    }
  });

  it('uses one tradable manual per collection that teaches all three slot choices', () => {
    expect(Object.keys(CRUCIBLE_COLLECTION_PATTERNS)).toHaveLength(11);
    for (const collection of CRUCIBLE_COLLECTIONS) {
      const pattern = CRUCIBLE_COLLECTION_PATTERNS[`pattern_${collection.id}`];
      expect(ITEMS[pattern.id]).toBe(pattern);
      expect(pattern.kind).toBe('recipe');
      expect(pattern.soulbound).not.toBe(true);
      expect(pattern.teachesRecipeIds).toEqual(collection.itemIds.map((id) => `recipe_${id}`));
      expect(pattern.teachesRecipeId).toBe(pattern.teachesRecipeIds?.[0]);
      expect(CRUCIBLE_VENDOR_STOCK).toContainEqual({
        itemId: pattern.id,
        sigilId: 'lastflame_core',
      });
    }
  });

  it('adds a separate thirty-percent shared boss pattern roll and a deterministic formula fallback', () => {
    expect(CRUCIBLE_PROFESSION_PATTERN_LOOT).toHaveLength(12);
    expect(CRUCIBLE_PROFESSION_PATTERN_LOOT.reduce((sum, row) => sum + row.chance, 0)).toBeCloseTo(
      0.3,
    );
    expect(new Set(CRUCIBLE_PROFESSION_PATTERN_LOOT.map((row) => row.rollGroup)).size).toBe(1);
    for (const bossId of [IGNIVAR_BOSS_ID, VARKHUL_BOSS_ID]) {
      for (const row of CRUCIBLE_PROFESSION_PATTERN_LOOT) {
        expect(MOBS[bossId].loot).toContainEqual(row);
        expect(row.normalOnly).not.toBe(true);
      }
    }
    expect(CRUCIBLE_VENDOR_STOCK).toContainEqual({
      itemId: 'formula_lastflame_zeal',
      sigilId: 'lastflame_core',
    });
  });
});
