// Masterwrought apex recipe patterns: the kind:'recipe' drops in
// src/sim/content/apex_patterns.ts that teach the acquisition:['drop'] apex
// recipes, plus the R8 channel wiring: the ten APEX_GEAR patterns on the
// Nythraxis base loot table ('nythraxis_patterns', tail-pinned in
// tests/nythraxis_raid_unit.test.ts), the ten APEX_ARMOR patterns on the rift
// clear draw (RIFT_PATTERN_ITEM_IDS), and the APEX_CONSUMABLE patterns in
// NEITHER drop channel (they are Heroic Quartermaster stock,
// tests/heroic_vendor.test.ts). It was 28 at phase 11; masterwrought Phase 11i
// added three cooking rows and the first pattern to teach a row OUTSIDE the
// three APEX_* tables, the apex rod's schematic, which rides the same
// quartermaster channel. Every count below is a literal beside a derivation,
// never a number in this header. The generic kind:'recipe' behavior sweeps
// (learn flow, tradability, market, stacking) live in
// tests/recipe_pattern_items.test.ts; this file pins the SHIPPED phase 11
// content against the recorded contract.
import { describe, expect, it } from 'vitest';
import { CRUCIBLE_COLLECTIONS } from '../src/sim/content/crucible_collections';
import { ENCHANTS } from '../src/sim/content/enchants';
import { CRAFT_RING } from '../src/sim/content/professions';
import {
  ALL_RECIPES,
  APEX_ARMOR_RECIPES,
  APEX_CONSUMABLE_RECIPES,
  APEX_GEAR_RECIPES,
  FARM_RECIPES,
  ROD_RECIPES,
  recipeById,
} from '../src/sim/content/recipes';
import { ITEMS, MOBS } from '../src/sim/data';
import { addRiftClearGearLoot, RIFT_PATTERN_ITEM_IDS } from '../src/sim/rift/progression';
import { Rng } from '../src/sim/rng';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';

// The classic per-craft display prefix table (the recorded phase decision):
// spelled as literals so a drifted def name reds here, never re-derived.
const PREFIX_BY_PROFESSION: Record<string, string> = {
  armorcrafting: 'Plans',
  weaponcrafting: 'Plans',
  leatherworking: 'Pattern',
  tailoring: 'Pattern',
  jewelcrafting: 'Design',
  engineering: 'Schematic',
  inscription: 'Technique',
  alchemy: 'Recipe',
  cooking: 'Recipe',
};

const ARMOR_PATTERN_IDS = APEX_ARMOR_RECIPES.map((r) => `pattern_${r.resultItemId}`);
const GEAR_PATTERN_IDS = APEX_GEAR_RECIPES.map((r) => `pattern_${r.resultItemId}`);
const CONSUMABLE_PATTERN_IDS = APEX_CONSUMABLE_RECIPES.map((r) => `pattern_${r.resultItemId}`);
const ALL_PATTERN_IDS = [...ARMOR_PATTERN_IDS, ...GEAR_PATTERN_IDS, ...CONSUMABLE_PATTERN_IDS];

// The FARM half of the kind:'recipe' universe (masterwrought Phase 11f).
// DERIVED FROM THE RECIPE TABLE, filtered on the acquisition channel, and
// deliberately NOT from content/farm_patterns.ts: the union pin below compares
// what the merged ITEMS table actually ships against what the RECIPE tables
// say should exist, so both sides must come from independent places. Deriving
// this half from the pattern table would make the pin compare
// farm_patterns.ts with itself and prove nothing.
const FARM_PATTERN_IDS = FARM_RECIPES.filter((r) => r.acquisition?.includes('drop')).map(
  (r) => `pattern_${r.resultItemId}`,
);
// The ROD half (masterwrought Phase 11i): the apex rung of ROD_RECIPES is
// drop-taught, so it mints a pattern too, and it is the FIRST pattern in the
// universe that teaches a row outside the three APEX_* tables. Derived off the
// acquisition channel exactly like the farm half, and for the same reason: the
// union pin below must compare the merged ITEMS table against the RECIPE
// tables, so this side may never be read out of content/apex_patterns.ts.
const ROD_PATTERN_IDS = ROD_RECIPES.filter((r) => r.acquisition?.includes('drop')).map(
  (r) => `pattern_${r.resultItemId}`,
);
const EVERY_PATTERN_ID = [...ALL_PATTERN_IDS, ...FARM_PATTERN_IDS, ...ROD_PATTERN_IDS];
const CRUCIBLE_SCROLL_IDS = [
  ...CRUCIBLE_COLLECTIONS.map((collection) => `pattern_${collection.id}`),
  'formula_lastflame_zeal',
];

describe('apex pattern defs (the drop-taught pattern universe)', () => {
  it('covers every drop-taught apex recipe, one pattern_<output> def per recipe, and no strays', () => {
    expect(ARMOR_PATTERN_IDS).toHaveLength(10);
    expect(GEAR_PATTERN_IDS).toHaveLength(10);
    // THIRTEEN since masterwrought Phase 11k: the eight phase-11 consumables,
    // the angler's two surviving endgame rows at cooking 75 and 100, and the
    // three apex role feasts at 125. It was ELEVEN at 11i, whose own capstone
    // feast row 11k retired along with its pattern (net plus two).
    expect(CONSUMABLE_PATTERN_IDS).toHaveLength(13);
    // The rod half's own count, spelled beside the others for the same reason:
    // one drop-taught rung out of the ladder's three, so a shipped rod silently
    // switching channel moves a literal rather than sliding through the union.
    expect(ROD_PATTERN_IDS).toHaveLength(1);
    expect(ROD_RECIPES).toHaveLength(3);
    // The farm half's own count, predicted then observed at the Phase 11f rung
    // climb: the six rows at or above the drop floor (two at rung 75, four at
    // rung 100). Spelled beside the apex counts so a farm row silently gaining
    // or losing the drop channel moves a literal rather than sliding through
    // both sides of the union below.
    expect(FARM_PATTERN_IDS).toHaveLength(6);
    // Exactness both ways over the UNION: preserve every legacy single-recipe
    // pattern, and add collection manuals plus the separate enchant formula.
    // The left side is read off
    // the merged ITEMS table (populated by content/apex_patterns.ts and
    // content/farm_patterns.ts); the right side is computed from the RECIPE
    // tables, now across FOUR of them. Two independent derivations, which is
    // what keeps the pin non-vacuous as the universe spans more content
    // modules.
    const shippedRecipeKind = Object.values(ITEMS)
      .filter((def) => def.kind === 'recipe')
      .map((def) => def.id)
      .sort();
    expect(shippedRecipeKind).toEqual([...EVERY_PATTERN_ID, ...CRUCIBLE_SCROLL_IDS].sort());
    expect(EVERY_PATTERN_ID).toHaveLength(40);
    expect(CRUCIBLE_SCROLL_IDS).toHaveLength(12);
    expect(shippedRecipeKind).toHaveLength(52);
    // No id belongs to both halves: a collision would let the union stay the
    // right SIZE while one table quietly shadowed the other in mergeItems.
    expect(new Set(EVERY_PATTERN_ID).size).toBe(EVERY_PATTERN_ID.length);
    expect(new Set([...EVERY_PATTERN_ID, ...CRUCIBLE_SCROLL_IDS]).size).toBe(52);
  });

  it('each Crucible manual teaches all three slot alternatives and the formula teaches only Zeal', () => {
    expect(CRUCIBLE_COLLECTIONS).toHaveLength(11);
    for (const collection of CRUCIBLE_COLLECTIONS) {
      const manual = ITEMS[`pattern_${collection.id}`];
      if (manual.kind !== 'recipe') throw new Error(`${manual.id} must be kind recipe`);
      const expectedIds = collection.itemIds.map((itemId) => `recipe_${itemId}`);
      expect(expectedIds, collection.id).toHaveLength(3);
      expect(manual.teachesRecipeIds, collection.id).toEqual(expectedIds);
      expect(manual.teachesRecipeId, collection.id).toBe(expectedIds[0]);
      expect(manual.teachesEnchantId, collection.id).toBeUndefined();
      for (const id of expectedIds) {
        const recipe = recipeById(id);
        expect(recipe?.professionId, id).toBe(collection.craftId);
        expect(recipe?.skillReq, id).toBe(100);
        expect(recipe?.acquisition, id).toEqual(['drop']);
      }
    }
    const formula = ITEMS.formula_lastflame_zeal;
    if (formula.kind !== 'recipe') throw new Error('Zeal formula must be kind recipe');
    expect(formula.teachesEnchantId).toBe('enchant_weapon_lastflame_zeal');
    expect(formula.teachesRecipeId).toBe(formula.teachesEnchantId);
    expect(formula.teachesRecipeIds).toBeUndefined();
    expect(recipeById(formula.teachesRecipeId)).toBeUndefined();
    expect(ENCHANTS[formula.teachesEnchantId!].acquisition).toBe('drop');
    for (const id of CRUCIBLE_SCROLL_IDS) {
      expect(ITEMS[id].soulbound ?? false, id).toBe(false);
      expect(ITEMS[id].noMarketList ?? false, id).toBe(false);
      expect(ITEMS[id].noVendorSell, id).toBe(true);
      expect(ITEMS[id].sellValue, id).toBe(0);
      expect(ITEMS[id].quality, id).toBe('epic');
    }
  });

  it('every pattern is a tradable, sellValue-100 recipe item whose rarity tracks its output', () => {
    // QUALITY IS DERIVED, NOT A UNIFORM LITERAL (ruling 11f-PAT): a pattern
    // carries the rarity of what it TEACHES, so recipe rarity stays monotone to
    // power. It read `toBe('epic')` while every row here taught the epic tier,
    // which masterwrought Phase 11i ended: its two plain fish dishes are rare,
    // so an epic literal would have forced the DISH up a rarity rung to satisfy
    // a test rather than a design. Both rungs are exercised below.
    const seenQualities = new Set<string>();
    for (const id of ALL_PATTERN_IDS) {
      const def = ITEMS[id];
      expect(def, id).toBeDefined();
      if (def.kind !== 'recipe') throw new Error(`${id} must be kind recipe, got ${def.kind}`);
      const taught = recipeById(def.teachesRecipeId);
      expect(taught, `${id} teaches ${def.teachesRecipeId}`).toBeDefined();
      const output = ITEMS[taught!.resultItemId];
      expect(output, `${id} output ${taught!.resultItemId}`).toBeDefined();
      expect(def.quality, `${id} rarity tracks ${output.id}`).toBe(output.quality);
      seenQualities.add(def.quality as string);
      expect(def.sellValue, id).toBe(100);
      // Tradable, bind by consumption at learn: never soulbound, never barred
      // from the World Market.
      expect(def.soulbound ?? false, id).toBe(false);
      expect(def.noMarketList ?? false, id).toBe(false);
      // pattern_<x> teaches the recipe whose resultItemId is <x>.
      const recipe = recipeById(def.teachesRecipeId);
      expect(recipe, `${id} teaches ${def.teachesRecipeId}`).toBeDefined();
      expect(`pattern_${recipe!.resultItemId}`, id).toBe(id);
      expect(recipe!.acquisition, id).toContain('drop');
    }
    // Non-vacuity for the derivation above: the table really does span two
    // rarity rungs now, so the assertion is comparing two moving values rather
    // than one constant against itself.
    expect([...seenQualities].sort()).toEqual(['epic', 'rare']);
  });

  it('names every pattern with its craft family prefix on the output English name', () => {
    for (const id of ALL_PATTERN_IDS) {
      const def = ITEMS[id];
      if (def.kind !== 'recipe') throw new Error(`${id} must be kind recipe`);
      const recipe = recipeById(def.teachesRecipeId)!;
      const prefix = PREFIX_BY_PROFESSION[recipe.professionId];
      expect(prefix, `${id}: no prefix recorded for ${recipe.professionId}`).toBeDefined();
      const output = ITEMS[recipe.resultItemId];
      expect(output, `${id}: output ${recipe.resultItemId}`).toBeDefined();
      expect(def.name, id).toBe(`${prefix}: ${output.name}`);
    }
  });
});

describe('apex pattern channel wiring (R8: raid gear, rift armor, vendor consumables)', () => {
  const raidPatternEntries = () =>
    MOBS.nythraxis_scourge_of_thornpeak.loot.filter(
      (entry) => entry.rollGroup === 'nythraxis_patterns',
    );

  it('the raid group carries exactly the ten gear patterns at 0.04 each', () => {
    const entries = raidPatternEntries();
    expect(entries.map((entry) => entry.itemId).sort()).toEqual([...GEAR_PATTERN_IDS].sort());
    for (const entry of entries) expect(entry.chance, entry.itemId).toBe(0.04);
  });

  it('the rift list is sorted and carries exactly the ten armor patterns', () => {
    expect([...RIFT_PATTERN_ITEM_IDS]).toEqual([...RIFT_PATTERN_ITEM_IDS].sort());
    expect([...RIFT_PATTERN_ITEM_IDS].sort()).toEqual([...ARMOR_PATTERN_IDS].sort());
  });

  it('the eight consumable patterns ride NEITHER drop channel', () => {
    const raidIds = new Set(raidPatternEntries().map((entry) => entry.itemId));
    // Sweep the WHOLE raid table, not just the pattern group, so a consumable
    // pattern smuggled into a gear group would still red.
    const allRaidIds = new Set(
      MOBS.nythraxis_scourge_of_thornpeak.loot.flatMap((entry) =>
        entry.itemId ? [entry.itemId] : [],
      ),
    );
    for (const id of CONSUMABLE_PATTERN_IDS) {
      expect(raidIds.has(id), id).toBe(false);
      expect(allRaidIds.has(id), id).toBe(false);
      expect((RIFT_PATTERN_ITEM_IDS as readonly string[]).includes(id), id).toBe(false);
    }
    // And the two drop channels never overlap.
    for (const id of RIFT_PATTERN_ITEM_IDS) expect(allRaidIds.has(id), id).toBe(false);
  });

  it('winning B/A/S rift clears shed armor patterns near 8%, C clears never do', () => {
    const patternIds = new Set<string>(RIFT_PATTERN_ITEM_IDS);
    const patternsOf = (baseLevel: number, rngSeed: number): string[] => {
      const boss = { loot: { copper: 0, items: [] }, lootable: false } as unknown as Entity;
      const ctx = { rng: new Rng(rngSeed) } as unknown as SimContext;
      addRiftClearGearLoot(ctx, boss, baseLevel);
      return (boss.loot?.items ?? [])
        .map((slot) => slot.itemId ?? '')
        .filter((id) => patternIds.has(id));
    };
    const SAMPLE = 5000;
    // C (baseLevel 20) returns before the pattern draw BY DESIGN.
    for (let s = 1; s <= SAMPLE; s++) expect(patternsOf(20, s)).toEqual([]);
    // The sample is fully deterministic (seeds 1..SAMPLE, a fresh Rng per
    // seed), so the exact count is stable; when RIFT_PATTERN_CHANCE
    // deliberately retunes (phase 15 measures), re-derive by running the
    // suite and adopting the printed observed counts. The band below
    // documents the intent; this pin closes the call-site-literal decoupling
    // window (a hardcoded chance near 0.08 at the draw site would survive
    // every band pin).
    const EXACT_HITS: Record<number, number> = { 22: 401, 25: 400, 28: 405 };
    // B/A/S each draw once per clear at 0.08; the pick is uniform over the
    // sorted list, so every armor pattern must actually be reachable.
    for (const baseLevel of [22, 25, 28]) {
      let hits = 0;
      const seen = new Set<string>();
      for (let s = 1; s <= SAMPLE; s++) {
        const dropped = patternsOf(baseLevel, s);
        expect(dropped.length, `baseLevel ${baseLevel} seed ${s}`).toBeLessThanOrEqual(1);
        for (const id of dropped) {
          hits++;
          seen.add(id);
        }
      }
      expect(hits, `baseLevel ${baseLevel}: observed ${hits}/${SAMPLE}`).toBe(
        EXACT_HITS[baseLevel],
      );
      const expected = SAMPLE * 0.08; // 400
      expect(hits, `baseLevel ${baseLevel}: ${hits}/${SAMPLE}`).toBeGreaterThan(expected * 0.7);
      expect(hits, `baseLevel ${baseLevel}: ${hits}/${SAMPLE}`).toBeLessThan(expected * 1.3);
      for (const id of RIFT_PATTERN_ITEM_IDS) {
        expect(seen.has(id), `${id} never dropped at baseLevel ${baseLevel}`).toBe(true);
      }
    }
  });

  it('every drop-acquisition recipe is learnable within its craft skill cap', () => {
    // The two capstone patterns (recipe_grand_cauldron, recipe_laden_hearth)
    // teach skillReq-125 recipes, and 125 IS the cap for their crafts: a
    // zero-margin boundary. A future cap lowering or tier shift would strand
    // purchasable-but-unlearnable vendor stock, and nothing else pins this.
    const maxSkillByCraft = new Map(CRAFT_RING.map((craft) => [craft.id, craft.maxSkill]));
    let walked = 0;
    for (const recipe of ALL_RECIPES) {
      if (!recipe.acquisition?.includes('drop')) continue;
      walked++;
      const cap = maxSkillByCraft.get(recipe.professionId);
      expect(cap, `${recipe.id}: no CRAFT_RING record for ${recipe.professionId}`).toBeDefined();
      expect(
        recipe.skillReq,
        `${recipe.id}: skillReq above the ${recipe.professionId} cap`,
      ).toBeLessThanOrEqual(cap!);
    }
    // Vacuity floor: every apex recipe is acquisition:['drop'] today, and the
    // floor tracks the real universe rather than a stale 28.
    expect(walked).toBeGreaterThanOrEqual(ALL_PATTERN_IDS.length);
  });
});
