// Jewelcrafting base catalog pins (Masterwrought phase 05): the nine
// trainer-taught JEWELCRAFTING_RECIPES (src/sim/content/recipes.ts) and their
// crafted jewelry outputs (src/sim/content/profession_items.ts). This suite
// owns the catalog's own shape the way tests/recipe_economy.test.ts owns
// LADDER_RECIPES: rung structure, the forge binding, the disenchant-ladder
// reagent identity (dust/essence, NEVER shard), the uncommon/uncommon/rare
// quality ladder, formula-exact stat budgets, and the ruling-R14 zero-rating
// rule. Economy (output strictly below input) and the foreign-bound station
// pin live in recipe_economy / professions_crafting_hub; this file does not
// restate them.
import { describe, expect, it } from 'vitest';
import { HEROIC_VENDOR_ITEMS } from '../src/sim/content/heroic_vendor';
import { JEWELCRAFTING_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import {
  expectedStatBudget,
  itemLevel,
  primaryStatBudget,
  primaryStatSum,
  QUALITY_ILVL_BONUS,
} from '../src/sim/item_level';
import { trainingFeeFor } from '../src/sim/professions/training';
import type { ItemDef } from '../src/sim/types';

// The cross-craft scaffolding convention (recipes.ts LADDER_RECIPES header):
// skillReq 0 -> level 10 / budget 10, 25 -> 15/16, 50 -> 20/20.
const CONVENTION: Record<number, { level: number; itemLevelBudget: number }> = {
  0: { level: 10, itemLevelBudget: 10 },
  25: { level: 15, itemLevelBudget: 16 },
  50: { level: 20, itemLevelBudget: 20 },
};

// Quality per rung (the phase 05 ledger deviation): uncommon at BOTH leveling
// rungs (common quality carries no primary-stat budget and jewelry has no
// armor axis), rare exclusively at 50 (the deed rare-tier derivation).
const QUALITY_BY_RUNG: Record<number, string> = { 0: 'uncommon', 25: 'uncommon', 50: 'rare' };

// Formula-derived primary-stat budget per rung (ring and neck agree at these
// item levels): pinned as literals so a silent item_budget retune cannot
// rebalance the catalog without this suite forcing a deliberate re-author.
const BUDGET_BY_RUNG: Record<number, number> = { 0: 3, 25: 4, 50: 8 };

// The shipped smithing_flux count per rung: the two leveling rungs take one,
// the rare rung takes two.
const FLUX_BY_RUNG: Record<number, number> = { 0: 1, 25: 1, 50: 2 };

// The one-time training fee per rung in copper (TRAINING_FEE_BY_TIER tiers
// 0/1/2, which is where skillReq 0/25/50 land through tierForSkill).
const FEE_BY_RUNG: Record<number, number> = { 0: 0, 25: 2500, 50: 10000 };

// Every rating key an ItemDef can carry (src/sim/types.ts). Ruling R14: the
// base-rung catalog is rating-free; ratings stay jewelry's endgame identity.
const RATING_KEYS = [
  'spellPower',
  'critRating',
  'hasteRating',
  'hitRating',
  'pvpOffenseRating',
  'pvpDefenseRating',
] as const;

function output(recipe: (typeof JEWELCRAFTING_RECIPES)[number]): ItemDef {
  const def = ITEMS[recipe.resultItemId];
  expect(def, `${recipe.id} result ${recipe.resultItemId}`).toBeDefined();
  return def;
}

describe('jewelcrafting catalog shape', () => {
  it('ships exactly nine recipes, three per rung, on the convention level/budget pairs', () => {
    expect(JEWELCRAFTING_RECIPES).toHaveLength(9);
    const byRung = (rung: number) =>
      JEWELCRAFTING_RECIPES.filter((r) => r.skillReq === rung).map((r) => r.id);
    expect(byRung(0).sort()).toEqual([
      'recipe_coiled_copper_torc',
      'recipe_hammered_copper_band',
      'recipe_polished_copper_loop',
    ]);
    expect(byRung(25).sort()).toEqual([
      'recipe_etched_iron_loop',
      'recipe_iron_link_choker',
      'recipe_riveted_iron_signet',
    ]);
    expect(byRung(50).sort()).toEqual([
      'recipe_burnished_thorium_amulet',
      'recipe_gleaming_thorium_loop',
      'recipe_weighted_thorium_band',
    ]);
    for (const recipe of JEWELCRAFTING_RECIPES) {
      const convention = CONVENTION[recipe.skillReq];
      expect(convention, `${recipe.id} skillReq ${recipe.skillReq}`).toBeDefined();
      expect(recipe.level, `${recipe.id} level`).toBe(convention.level);
      expect(recipe.itemLevelBudget, `${recipe.id} itemLevelBudget`).toBe(
        convention.itemLevelBudget,
      );
    }
  });

  it('every recipe is forge-bound, trainer-taught, jewelcrafting-home, single-output', () => {
    for (const recipe of JEWELCRAFTING_RECIPES) {
      expect(recipe.professionId, recipe.id).toBe('jewelcrafting');
      expect(recipe.stationType, recipe.id).toBe('forge');
      expect(recipe.acquisition, recipe.id).toEqual(['trainer']);
      expect(recipe.resultCount, recipe.id).toBe(1);
    }
  });

  it('every recipe consumes smithing_flux at EXACTLY its rung count', () => {
    // Pinned exactly rather than to a 1-to-6 band: the shipped ladder steps
    // 1 / 1 / 2, and a band that wide passes on any retune inside it, which is
    // every retune anyone would actually make. An exact per-rung pin is what
    // forces a flux rebalance to be a deliberate edit here.
    for (const recipe of JEWELCRAFTING_RECIPES) {
      const flux = recipe.reagents.find((r) => r.itemId === 'smithing_flux');
      expect(flux, `${recipe.id} must consume smithing_flux`).toBeDefined();
      expect(flux?.count, `${recipe.id} flux at rung ${recipe.skillReq}`).toBe(
        FLUX_BY_RUNG[recipe.skillReq],
      );
    }
    // Anti-vacuity: the map really does step, so a table flattened to one
    // number everywhere could not satisfy the loop above.
    expect(new Set(Object.values(FLUX_BY_RUNG)).size).toBe(2);
  });

  it('charges the tier training fee ladder 0 / 2500 / 10000 per rung', () => {
    // The rungs map onto tiers 0/1/2 of TRAINING_FEE_BY_TIER, so the free
    // starter rung and the two priced ones are pinned as the copper a player
    // is really charged, through the same function resolveTrain deducts with.
    for (const recipe of JEWELCRAFTING_RECIPES) {
      expect(trainingFeeFor(recipe), `${recipe.id} fee at rung ${recipe.skillReq}`).toBe(
        FEE_BY_RUNG[recipe.skillReq],
      );
    }
    // Rung 0 really is free and the ladder really climbs: a fee table gone
    // uniform (or gone zero) fails here rather than passing the loop above.
    expect(FEE_BY_RUNG[0]).toBe(0);
    expect(FEE_BY_RUNG[50]).toBeGreaterThan(FEE_BY_RUNG[25]);
    expect(FEE_BY_RUNG[25]).toBeGreaterThan(FEE_BY_RUNG[0]);
  });

  it('no recipe consumes arcane_shard; the dust/essence ladder is really consumed', () => {
    const consumed = new Set(
      JEWELCRAFTING_RECIPES.flatMap((r) => r.reagents.map((reagent) => reagent.itemId)),
    );
    expect(consumed.has('arcane_shard')).toBe(false);
    // Positive controls: the scan reads real reagent ids (the phase 05
    // gems-from-salvage reading), so the negative above cannot pass vacuously
    // on a typo'd id sweep.
    expect(consumed.has('arcane_dust')).toBe(true);
    expect(consumed.has('arcane_essence')).toBe(true);
  });
});

describe('jewelcrafting catalog outputs', () => {
  it('maps rung quality uncommon/uncommon/rare, rare exclusive to rung 50', () => {
    for (const recipe of JEWELCRAFTING_RECIPES) {
      expect(output(recipe).quality, recipe.id).toBe(QUALITY_BY_RUNG[recipe.skillReq]);
    }
    const rareRungs = JEWELCRAFTING_RECIPES.filter((r) => output(r).quality === 'rare').map(
      (r) => r.skillReq,
    );
    expect(rareRungs).toEqual([50, 50, 50]);
  });

  it('each rung yields two rings and one neck, armor-kind with no armor axis', () => {
    for (const rung of [0, 25, 50]) {
      const atRung = JEWELCRAFTING_RECIPES.filter((r) => r.skillReq === rung).map(output);
      expect(
        atRung.filter((d) => d.slot === 'ring'),
        `rung ${rung} rings`,
      ).toHaveLength(2);
      expect(
        atRung.filter((d) => d.slot === 'neck'),
        `rung ${rung} necks`,
      ).toHaveLength(1);
      for (const def of atRung) {
        expect(def.kind, def.id).toBe('armor');
        expect(def.armorType, `${def.id} must carry no armorType`).toBeUndefined();
        expect(def.stats?.armor, `${def.id} must carry no armor stat`).toBeUndefined();
      }
    }
  });

  it('every output carries EXACTLY its formula budget, derived at the recipe level', () => {
    let checked = 0;
    for (const recipe of JEWELCRAFTING_RECIPES) {
      const def = output(recipe);
      // Derive from the FORMULA at the recipe level (recipes register their
      // output's source level in item_level.buildSourceIndex), never from a
      // copied stat literal: recipe.level + quality bump through
      // primaryStatBudget is the independent arm the authored stats must hit.
      const bonus = QUALITY_ILVL_BONUS[def.quality ?? 'common'];
      expect(bonus, `${def.id} quality bump`).toBeGreaterThan(0);
      const level = recipe.level + bonus;
      const formulaBudget = primaryStatBudget(level, def.quality, def.slot);
      expect(formulaBudget, `${def.id} formula budget`).toBe(BUDGET_BY_RUNG[recipe.skillReq]);
      expect(primaryStatSum(def), `${def.id} stat sum`).toBe(formulaBudget);
      // The live source index agrees: the tooltip item level and expected
      // budget derive the same numbers from the shipped tables.
      expect(itemLevel(def), `${def.id} item level`).toBe(level);
      expect(expectedStatBudget(def), `${def.id} expected budget`).toBe(formulaBudget);
      checked += 1;
    }
    expect(checked).toBe(9);
  });

  it('carries zero rating fields on every output (ruling R14, all six keys)', () => {
    for (const recipe of JEWELCRAFTING_RECIPES) {
      const def = output(recipe);
      for (const key of RATING_KEYS) {
        expect(def[key], `${def.id} must not carry ${key}`).toBeUndefined();
      }
    }
    // Positive controls: the key list is live vocabulary, proven against
    // shipped jewelry defs that DO carry a rating (the heroic vendor stock),
    // so a renamed ItemDef field cannot rot this sweep into a vacuous pass.
    // THREE distinct keys, not one: pinning hitRating alone left the other five
    // names unproven, so a rename of critRating or hasteRating would have made
    // the sweep above pass while asserting nothing about those fields.
    expect(HEROIC_VENDOR_ITEMS.seal_of_the_nine_oaths.hitRating).toBeGreaterThan(0);
    expect(HEROIC_VENDOR_ITEMS.sutils_gambit.critRating).toBeGreaterThan(0);
    expect(HEROIC_VENDOR_ITEMS.zyzzs_deathless_signet.hasteRating).toBeGreaterThan(0);
    // And derived, so the three named exemplars cannot be the only reach: the
    // live keys really are drawn from RATING_KEYS rather than from names this
    // test invented.
    const liveKeys = new Set(
      Object.values(HEROIC_VENDOR_ITEMS).flatMap((def) =>
        RATING_KEYS.filter((key) => (def[key] ?? 0) > 0),
      ),
    );
    expect([...liveKeys].sort()).toEqual(['critRating', 'hasteRating', 'hitRating']);
  });

  it('stocks no output at a vendor (the never-bought header claim, buyValue-free)', () => {
    // The catalog's premise is that jewelry of this band is CRAFTED, never
    // bought: a buyValue is what puts an item on an NPC vendor row, so its
    // absence is the pin that keeps the trainer ladder the only source.
    // sellValue is the vendor BUYBACK price and is expected on every output.
    for (const recipe of JEWELCRAFTING_RECIPES) {
      const def = output(recipe);
      expect(def.buyValue, `${def.id} must carry no buyValue`).toBeUndefined();
      expect(def.sellValue, `${def.id} sell value`).toBeGreaterThan(0);
    }
    // Anti-vacuity: buyValue is a live ItemDef field some shipped item really
    // sets, so the undefined sweep above is not reading a name that no longer
    // exists.
    const vendorStocked = Object.values(ITEMS).filter((def) => (def.buyValue ?? 0) > 0);
    expect(vendorStocked.length).toBeGreaterThan(0);
  });

  it('every output has a catalog name row that byte-matches its def (Osmium display register)', async () => {
    // The def name is the sim-side English source and the catalog row is what
    // t() renders; the two must agree byte for byte, including the id/display
    // split on the three thorium ids (frozen thorium ids, Osmium displays,
    // matching thorium_ore whose display is Osmium Ore).
    const { en } = await import('../src/ui/i18n.resolved.generated/en');
    const items = (en as unknown as { entities: { items: Record<string, { name?: string }> } })
      .entities.items;
    for (const recipe of JEWELCRAFTING_RECIPES) {
      const def = output(recipe);
      expect(items[def.id]?.name, `catalog row for ${def.id}`).toBe(def.name);
    }
    expect(items.weighted_thorium_band?.name).toBe('Weighted Osmium Band');
    expect(items.gleaming_thorium_loop?.name).toBe('Gleaming Osmium Loop');
    expect(items.burnished_thorium_amulet?.name).toBe('Burnished Osmium Amulet');
  });
});
