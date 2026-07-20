// Phase 10 recipe economy + ladder-shape gate (Professions 2.0). Phase 10 landed
// LADDER_RECIPES (54 trainer recipes across six crafts at skillReq 0/25/50) plus
// the new materials/specimens/vendor reagents in content/profession_items.ts.
// The locked economy decision: no recipe vendors above its input value. Several
// PRE-Phase-10 recipes are grossly gold-positive and the prime directive forbids
// touching any existing recipe or item value, so the invariant carries a FROZEN
// legacy exception list (a Phase 15 burn-down target, never an escape hatch for
// new content).
import { describe, expect, it } from 'vitest';
import { STATION_TYPE_BY_CRAFT } from '../src/sim/content/professions';
import { ALL_RECIPES, COMBO_RECIPES, LADDER_RECIPES, recipeById } from '../src/sim/content/recipes';
import { ITEMS, NPCS } from '../src/sim/data';
import { NODE_MATERIAL_TABLE } from '../src/sim/professions/gathering';
import { stationsOfType, stationTypeForCraft } from '../src/sim/professions/stations';
import { PRE_TRAINING_RECIPE_IDS } from '../src/sim/professions/training';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';

// --- economy math (the locked reagent-value rule) --------------------------
// inputValue: sum over reagents of count x the reagent's unit value, where the
// unit value is buyValue when the def carries a finite buyValue > 0 (a vendor
// staple the player pays for), else sellValue (a harvested/dropped material the
// player realizes at the vendor floor). outputValue: the result def sellValue
// times the recipe's resultCount.
function reagentUnitValue(itemId: string): number {
  const def = ITEMS[itemId];
  if (!def) throw new Error(`recipe reagent ${itemId} has no ItemDef`);
  return typeof def.buyValue === 'number' && def.buyValue > 0 ? def.buyValue : def.sellValue;
}
function inputValue(recipe: ProfessionRecipeRecord): number {
  let total = 0;
  for (const reagent of recipe.reagents) total += reagent.count * reagentUnitValue(reagent.itemId);
  return total;
}
function outputValue(recipe: ProfessionRecipeRecord): number {
  const def = ITEMS[recipe.resultItemId];
  if (!def) throw new Error(`recipe result ${recipe.resultItemId} has no ItemDef`);
  return def.sellValue * recipe.resultCount;
}

// The FROZEN pre-Phase-10 gold-positive recipes: every recipe whose output
// sellValue meets or exceeds its summed reagent value TODAY, all authored before
// Phase 10 (8 of the 9 common recipes, all 3 caster-hub recipes, all 3 combo
// recipes). This list is a Phase 15 balance burn-down target, NEVER an escape
// hatch for new content: every member is pinned to PRE_TRAINING_RECIPE_IDS below,
// so no post-Phase-9 recipe can ever join it, and each member is re-checked to
// still violate, so a later balance pass that fixes one reds this suite and the
// id must be removed deliberately.
const LEGACY_GOLD_POSITIVE_RECIPE_IDS: ReadonlySet<string> = new Set([
  // COMMON_RECIPES (8 of 9; recipe_tough_jerky already clears the invariant)
  'recipe_eastbrook_arming_sword',
  'recipe_eastbrook_chain_vest',
  'recipe_eastbrook_wool_trousers',
  'recipe_tanned_leather_jerkin',
  'recipe_minor_healing_potion',
  'recipe_eastbrook_ritual_vestments',
  'recipe_eastbrook_druids_hide',
  'recipe_eastbrook_warded_leggings',
  // CASTER_HUB_RECIPES (all 3)
  'recipe_wardweave_cowl',
  'recipe_duskhide_wraps',
  'recipe_sootscale_mantle',
  // COMBO_RECIPES (all 3)
  'recipe_ironbound_warplate_helm',
  'recipe_forgeguard_bulwark_gauntlets',
  'recipe_volatile_flux_elixir',
]);

// The exact sorted membership, spelled out as literals (property c below). Kept
// separate from the authoring-grouped Set above so a stray addition/removal reds
// the toEqual rather than silently passing.
const EXPECTED_LEGACY_SORTED = [
  'recipe_duskhide_wraps',
  'recipe_eastbrook_arming_sword',
  'recipe_eastbrook_chain_vest',
  'recipe_eastbrook_druids_hide',
  'recipe_eastbrook_ritual_vestments',
  'recipe_eastbrook_warded_leggings',
  'recipe_eastbrook_wool_trousers',
  'recipe_forgeguard_bulwark_gauntlets',
  'recipe_ironbound_warplate_helm',
  'recipe_minor_healing_potion',
  'recipe_sootscale_mantle',
  'recipe_tanned_leather_jerkin',
  'recipe_volatile_flux_elixir',
  'recipe_wardweave_cowl',
];

describe('THE ECONOMY INVARIANT', () => {
  // Operator: strict less-than. Measured against the shipped tables, the
  // tightest passing non-legacy margin is 2 copper and no recipe sits exactly
  // equal, so outputValue < inputValue holds for every non-legacy recipe.
  it('every non-legacy recipe vendors strictly below its input value', () => {
    let checked = 0;
    for (const recipe of ALL_RECIPES) {
      if (LEGACY_GOLD_POSITIVE_RECIPE_IDS.has(recipe.id)) continue;
      checked += 1;
      expect(
        outputValue(recipe),
        `${recipe.id}: output ${outputValue(recipe)} must be below input ${inputValue(recipe)}`,
      ).toBeLessThan(inputValue(recipe));
    }
    // Guard the enumeration is real (not an empty sweep): all recipes minus the
    // 14 frozen legacy ids.
    expect(checked).toBe(ALL_RECIPES.length - LEGACY_GOLD_POSITIVE_RECIPE_IDS.size);
    expect(checked).toBeGreaterThan(0);
  });

  it('(a) every legacy member predates trainer acquisition (in PRE_TRAINING_RECIPE_IDS)', () => {
    const preTraining = new Set(PRE_TRAINING_RECIPE_IDS);
    for (const id of LEGACY_GOLD_POSITIVE_RECIPE_IDS) {
      expect(preTraining.has(id), `${id} must be a pre-Phase-9 recipe`).toBe(true);
    }
  });

  it('(b) every legacy member currently DOES violate the invariant (self-pruning)', () => {
    for (const id of LEGACY_GOLD_POSITIVE_RECIPE_IDS) {
      const recipe = recipeById(id);
      expect(recipe, `${id} must resolve to a real recipe`).toBeDefined();
      // Violation of a strict-less-than invariant means output >= input.
      expect(
        outputValue(recipe as ProfessionRecipeRecord),
        `${id}: output ${outputValue(recipe as ProfessionRecipeRecord)} vs input ${inputValue(recipe as ProfessionRecipeRecord)} no longer violates; remove it from the frozen list`,
      ).toBeGreaterThanOrEqual(inputValue(recipe as ProfessionRecipeRecord));
    }
  });

  it('(c) the frozen list has exactly the pinned sorted contents', () => {
    expect([...LEGACY_GOLD_POSITIVE_RECIPE_IDS].sort()).toEqual(EXPECTED_LEGACY_SORTED);
  });
});

describe('REFERENTIAL INTEGRITY', () => {
  // The real trainer-home rule (professions/training.ts resolveTrain): a train
  // attempt locates the station via stationTypeForCraft(recipe.professionId),
  // NOT via recipe.stationType. That is how the three station-free COMBO_RECIPES
  // (no stationType field) still resolve a home: their professionId maps to a
  // station type in STATION_TYPE_BY_CRAFT. So the teachable-home check walks
  // professionId, and every trainer recipe must map to an existing station type
  // that has at least one placed station with an existing master NPC.
  const RUNTIME_STATION_TYPES = new Set(Object.values(STATION_TYPE_BY_CRAFT));

  it('every recipe reagent and result resolves to a real ItemDef', () => {
    for (const recipe of ALL_RECIPES) {
      expect(ITEMS[recipe.resultItemId], `result ${recipe.resultItemId}`).toBeDefined();
      for (const reagent of recipe.reagents) {
        expect(ITEMS[reagent.itemId], `reagent ${reagent.itemId} in ${recipe.id}`).toBeDefined();
      }
    }
  });

  it('every trainer recipe has a teachable home (station type, station, master NPC)', () => {
    let trainerRecipes = 0;
    for (const recipe of ALL_RECIPES) {
      if (!recipe.acquisition?.includes('trainer')) continue;
      trainerRecipes += 1;
      const type = stationTypeForCraft(recipe.professionId);
      expect(
        type,
        `${recipe.id}: professionId ${recipe.professionId} has no station type`,
      ).toBeDefined();
      const stations = stationsOfType(type as NonNullable<typeof type>);
      expect(stations.length, `${recipe.id}: no station of type ${type}`).toBeGreaterThan(0);
      for (const station of stations) {
        expect(
          NPCS[station.masterNpcId],
          `${recipe.id}: station ${station.id} master ${station.masterNpcId} has no NpcDef`,
        ).toBeDefined();
      }
    }
    // The 54 ladder recipes plus the 3 grandfathered combos all carry 'trainer'.
    expect(trainerRecipes).toBe(LADDER_RECIPES.length + COMBO_RECIPES.length);
  });

  it('the three station-free combo recipes resolve a home via professionId, not stationType', () => {
    for (const recipe of COMBO_RECIPES) {
      // Combos deliberately carry NO stationType field (field-craftable, pair-gated).
      expect(recipe.stationType, `${recipe.id} should have no stationType`).toBeUndefined();
      const type = stationTypeForCraft(recipe.professionId);
      expect(type, `${recipe.id}: combo home unresolved`).toBeDefined();
      expect(stationsOfType(type as NonNullable<typeof type>).length).toBeGreaterThan(0);
    }
  });

  it('every recipe stationType is a real runtime StationType with a placed station', () => {
    for (const recipe of ALL_RECIPES) {
      if (!recipe.stationType) continue;
      expect(
        RUNTIME_STATION_TYPES.has(recipe.stationType),
        `${recipe.id}: stationType ${recipe.stationType} is not a runtime StationType`,
      ).toBe(true);
      expect(
        stationsOfType(recipe.stationType).length,
        `${recipe.id}: ${recipe.stationType}`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('MATERIAL DEMAND COVERAGE', () => {
  // Every gathered/harvested/vendor material Phases 4 and 10 introduced must be
  // consumed by at least one recipe, so no supply node produces a dead good.
  const NODE_YIELDS = [
    'copper_ore',
    'iron_ore',
    'thorium_ore',
    'ironbark_log',
    'ashwood_log',
    'elderwood_log',
    'silverleaf_herb',
    'goldleaf_herb',
    'sunpetal_herb',
  ];
  const HARVEST_MATERIALS = [
    'rough_hide',
    'spider_silk',
    'venom_gland',
    'game_meat',
    'homespun_cloth',
  ];
  const SPECIMENS = ['pristine_hide', 'pristine_silk', 'pristine_venom_gland', 'prime_cut'];
  const VENDOR_REAGENTS = [
    'smithing_flux',
    'spool_of_thread',
    'tanning_agent',
    'cooking_salt',
    'glass_vial',
  ];
  const RAW_FISH = [
    'raw_river_perch',
    'raw_marsh_pike',
    'raw_bog_eel',
    'raw_frostgill_trout',
    'raw_stonescale_carp',
    'raw_mirror_trout',
  ];

  const allReagentIds = new Set<string>();
  for (const recipe of ALL_RECIPES) {
    for (const reagent of recipe.reagents) allReagentIds.add(reagent.itemId);
  }

  it('pins the nine node yields to the live NODE_MATERIAL_TABLE (literal list cannot rot)', () => {
    const liveYields = new Set<string>();
    for (const byZone of Object.values(NODE_MATERIAL_TABLE)) {
      for (const row of Object.values(byZone)) liveYields.add(row.itemId);
    }
    expect([...liveYields].sort()).toEqual([...NODE_YIELDS].sort());
  });

  it('every Phase 4 + Phase 10 material is consumed by at least one recipe', () => {
    for (const id of [...NODE_YIELDS, ...HARVEST_MATERIALS, ...SPECIMENS, ...VENDOR_REAGENTS]) {
      expect(allReagentIds.has(id), `${id} is never consumed by any recipe`).toBe(true);
    }
  });

  it('every raw fish is consumed by at least one cooking recipe', () => {
    const cookingReagents = new Set<string>();
    for (const recipe of ALL_RECIPES) {
      if (recipe.professionId !== 'cooking') continue;
      for (const reagent of recipe.reagents) cookingReagents.add(reagent.itemId);
    }
    for (const fish of RAW_FISH) {
      expect(cookingReagents.has(fish), `${fish} is never cooked`).toBe(true);
    }
  });
});

describe('LADDER SHAPE PINS', () => {
  const LADDER_CRAFTS = [
    'weaponcrafting',
    'armorcrafting',
    'tailoring',
    'leatherworking',
    'cooking',
    'alchemy',
  ];
  const QUALITY_BY_RUNG: Record<number, string> = { 0: 'common', 25: 'uncommon', 50: 'rare' };

  // Material bands (Phase 10 ladder design): a rung-50 (rare) recipe must not be
  // craftable from ONLY the top rare-band inputs; it must still consume something
  // below that tier so the low/mid gathering economy keeps its demand. The
  // rare-band is the tier-3 gathered materials, the arcanite bar, and the rare
  // specimens. NOTE the check is phrased as "not solely rare-band" rather than
  // "contains a low/mid material": recipe_anglers_feast_platter (a shipped rung-50
  // cooking recipe) consumes only mid-tier fish, sunpetal_herb, and cooking_salt,
  // none of which sit in the explicit low/mid lists, yet it is clearly not an
  // all-rare recipe. The low/mid lists are retained as documented lower tiers and
  // pinned disjoint from the rare-band.
  const LOW_BAND = new Set([
    'copper_ore',
    'ironbark_log',
    'silverleaf_herb',
    'rough_hide',
    'spider_silk',
    'venom_gland',
    'game_meat',
    'homespun_cloth',
    'linen_scrap',
    'bone_fragments',
    'spider_leg',
  ]);
  const MID_BAND = new Set(['iron_ore', 'ashwood_log', 'goldleaf_herb']);
  const RARE_BAND = new Set([
    'thorium_ore',
    'elderwood_log',
    'sunpetal_herb',
    'arcanite_bar',
    'pristine_hide',
    'pristine_silk',
    'pristine_venom_gland',
    'prime_cut',
  ]);

  function isConsumable(itemId: string): boolean {
    const def = ITEMS[itemId];
    return (
      def != null &&
      (def.foodHp != null ||
        def.potionHp != null ||
        def.potionMana != null ||
        def.elixir != null ||
        def.use != null)
    );
  }

  it('every ladder recipe has the fixed shape (trainer, station, rung, quality)', () => {
    for (const recipe of LADDER_RECIPES) {
      expect(recipe.acquisition, `${recipe.id} acquisition`).toEqual(['trainer']);
      expect(recipe.stationType, `${recipe.id} stationType`).toBeDefined();
      expect([0, 25, 50], `${recipe.id} skillReq`).toContain(recipe.skillReq);
      const def = ITEMS[recipe.resultItemId];
      expect(def, `${recipe.id} result`).toBeDefined();
      expect(def.quality, `${recipe.id} result quality for rung ${recipe.skillReq}`).toBe(
        QUALITY_BY_RUNG[recipe.skillReq],
      );
    }
  });

  it('each of the six ladder crafts has exactly 9 recipes, 3 per rung', () => {
    for (const craft of LADDER_CRAFTS) {
      const forCraft = LADDER_RECIPES.filter((r) => r.professionId === craft);
      expect(forCraft.length, `${craft} ladder recipe count`).toBe(9);
      for (const rung of [0, 25, 50]) {
        const atRung = forCraft.filter((r) => r.skillReq === rung);
        expect(atRung.length, `${craft} rung ${rung}`).toBe(3);
      }
    }
    // No stray ladder craft outside the six.
    expect(new Set(LADDER_RECIPES.map((r) => r.professionId))).toEqual(new Set(LADDER_CRAFTS));
    expect(LADDER_RECIPES.length).toBe(54);
  });

  it('the three material bands are pairwise disjoint', () => {
    for (const id of LOW_BAND) expect(MID_BAND.has(id) || RARE_BAND.has(id)).toBe(false);
    for (const id of MID_BAND) expect(RARE_BAND.has(id)).toBe(false);
  });

  it('every rung-50 ladder recipe consumes at least one non-rare-band material', () => {
    for (const recipe of LADDER_RECIPES) {
      if (recipe.skillReq !== 50) continue;
      const hasLower = recipe.reagents.some((r) => !RARE_BAND.has(r.itemId));
      expect(
        hasLower,
        `${recipe.id} (rare) consumes only rare-band inputs: ${recipe.reagents.map((r) => r.itemId).join(', ')}`,
      ).toBe(true);
    }
  });

  it('cooking and alchemy have a consumable output at every rung', () => {
    for (const craft of ['cooking', 'alchemy']) {
      for (const rung of [0, 25, 50]) {
        const consumables = LADDER_RECIPES.filter(
          (r) => r.professionId === craft && r.skillReq === rung && isConsumable(r.resultItemId),
        );
        expect(consumables.length, `${craft} rung ${rung} consumable output`).toBeGreaterThan(0);
      }
    }
  });
});
