import { describe, expect, it } from 'vitest';
import { STATION_TYPE_BY_CRAFT } from '../src/sim/content/professions';
import {
  CASTER_HUB_RECIPES,
  COMBO_RECIPES,
  COMMON_RECIPES,
  LADDER_RECIPES,
  recipeById,
  TOOL_RECIPES,
} from '../src/sim/content/recipes';
import {
  hasRecipeMaterials,
  meetsComboRequirement,
  resolveCraft,
  resolveCraftForRecipe,
} from '../src/sim/professions/crafting';
import { MASTERWORK_CHANCE_CAP } from '../src/sim/professions/masterwork';
import { stationsOfType } from '../src/sim/professions/stations';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import type { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function grantItem(sim: Sim, itemId: string, count: number, pid: number) {
  for (let i = 0; i < count; i++) sim.addItem(itemId, 1, pid);
}

// Phase 8: station-bound recipes gate on POSITION only (the old level-20 hub
// arm retired), so a harness just walks the player onto the recipe's station
// (the STATIONS record, so a content re-placement can never strand this).
function placeAtStationFor(sim: Sim, pid: number, recipeId: string) {
  const stationType = recipeById(recipeId)?.stationType;
  if (!stationType) throw new Error(`${recipeId} is not station-bound`);
  const station = stationsOfType(stationType)[0];
  const entity = (sim as any).entities.get(pid);
  entity.pos.x = station.pos.x;
  entity.pos.z = station.pos.z;
  entity.prevPos = { ...entity.pos };
}

describe('recipe content (#1127)', () => {
  it('defines at least one recipe per craft on the ring, all common tier', () => {
    expect(COMMON_RECIPES.length).toBeGreaterThanOrEqual(5);
    for (const recipe of COMMON_RECIPES) {
      expect(recipe.skillReq).toBe(0); // free-floor: common tier costs zero skill
      expect(recipe.reagents.length).toBeGreaterThan(0);
      expect(recipe.resultCount).toBeGreaterThan(0);
    }
  });

  it('recipeById resolves a known id and returns undefined for an unknown one', () => {
    expect(recipeById(COMMON_RECIPES[0].id)?.id).toBe(COMMON_RECIPES[0].id);
    expect(recipeById('not_a_real_recipe')).toBeUndefined();
  });
});

describe('TOOL_RECIPES (#1135 de-stub): tier 4/5 tool recipes', () => {
  it('defines the six crafted base tools, each requiring skill', () => {
    expect(TOOL_RECIPES.length).toBe(6);
    for (const recipe of TOOL_RECIPES) {
      expect(recipe.skillReq).toBeGreaterThan(0); // unlike common-tier, these gate on skill
      expect(recipe.reagents.length).toBeGreaterThan(0);
      expect(recipe.resultCount).toBeGreaterThan(0);
      expect(recipe.professionId).toBe('engineering');
    }
  });

  it('recipeById resolves tool recipes alongside common ones', () => {
    for (const recipe of TOOL_RECIPES) {
      expect(recipeById(recipe.id)?.id).toBe(recipe.id);
    }
  });

  it('resolveCraft produces a tool from its recipe reagents', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_thorium_mining_pick')!;
    // Phase 8: TOOL_RECIPES are station-bound (toolworks), so this recipe
    // requires standing at that station; there is NO level arm anymore (see
    // professions_crafting_hub.test.ts for the gate's dedicated coverage).
    placeAtStationFor(sim, pid, recipe.id);
    grantItem(sim, 'thorium_ore', 4, pid);
    grantItem(sim, 'mithril_mining_pick', 1, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(true);
    expect(sim.countItem('thorium_ore', pid)).toBe(0);
    expect(sim.countItem('mithril_mining_pick', pid)).toBe(0);
    expect(sim.countItem('thorium_mining_pick', pid)).toBe(1);
  });
});

describe('caster-stat (int/spi) crafting recipes', () => {
  const CASTER_COMMON_IDS = [
    'recipe_eastbrook_ritual_vestments',
    'recipe_eastbrook_druids_hide',
    'recipe_eastbrook_warded_leggings',
  ];

  it('COMMON_RECIPES has one free-floor caster piece per tailoring/leatherworking/armorcrafting', () => {
    const casterCommon = COMMON_RECIPES.filter((r) => CASTER_COMMON_IDS.includes(r.id));
    expect(casterCommon.length).toBe(3);
    const professionIds = casterCommon.map((r) => r.professionId).sort();
    expect(professionIds).toEqual(['armorcrafting', 'leatherworking', 'tailoring']);
    for (const recipe of casterCommon) {
      expect(recipe.skillReq).toBe(0);
      expect(recipe.stationType).toBeUndefined();
    }
  });

  it('CASTER_HUB_RECIPES defines one station-bound int/spi piece per tailoring/leatherworking/armorcrafting', () => {
    expect(CASTER_HUB_RECIPES.length).toBe(3);
    const professionIds = CASTER_HUB_RECIPES.map((r) => r.professionId).sort();
    expect(professionIds).toEqual(['armorcrafting', 'leatherworking', 'tailoring']);
    for (const recipe of CASTER_HUB_RECIPES) {
      // Phase 8: each piece is bound to ITS OWN craft's station type
      // (loom/tannery/forge), never someone else's.
      expect(recipe.stationType).toBe(STATION_TYPE_BY_CRAFT[recipe.professionId]);
      expect(recipe.skillReq).toBeGreaterThan(0);
      expect(recipe.reagents.length).toBeGreaterThan(0);
    }
  });

  it('recipeById resolves every caster-tier recipe', () => {
    for (const recipe of [
      ...COMMON_RECIPES.filter((r) => CASTER_COMMON_IDS.includes(r.id)),
      ...CASTER_HUB_RECIPES,
    ]) {
      expect(recipeById(recipe.id)?.id).toBe(recipe.id);
    }
  });

  it('crafts the common-tier tailoring caster piece from its reagents', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_eastbrook_ritual_vestments')!;
    grantItem(sim, 'linen_scrap', 3, pid);
    grantItem(sim, 'spider_leg', 1, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(true);
    expect(sim.countItem('linen_scrap', pid)).toBe(0);
    expect(sim.countItem('spider_leg', pid)).toBe(0);
    expect(sim.countItem('eastbrook_ritual_vestments', pid)).toBe(1);
  });

  it('crafts the station-tier armorcrafting caster piece once at the forge with reagents held', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_sootscale_mantle')!;
    placeAtStationFor(sim, pid, recipe.id);
    grantItem(sim, 'thorium_ore', 4, pid);
    grantItem(sim, 'bone_fragments', 2, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(true);
    expect(sim.countItem('sootscale_mantle', pid)).toBe(1);
  });
});

describe('profession XP on craft (profession_xp.ts)', () => {
  it('a successful craft grants character XP', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    const recipe = recipeById('recipe_tough_jerky')!;
    grantItem(sim, 'spider_leg', 1, pid);
    const before = meta.xp;

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(true);
    expect(meta.xp).toBeGreaterThan(before);
  });

  it('a trivial craft for a high-level player grants zero XP (gray band)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setPlayerLevel(20);
    const meta = (sim as any).players.get(pid);
    const recipe = recipeById('recipe_tough_jerky')!; // level 1
    grantItem(sim, 'spider_leg', 1, pid);
    const before = meta.xp;

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(true);
    expect(meta.xp).toBe(before);
  });

  it('a denied craft (insufficient materials) grants no XP', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    const recipe = recipeById('recipe_tough_jerky')!;
    const before = meta.xp;

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(false);
    expect(meta.xp).toBe(before);
  });
});

describe('resolveCraft (#1127)', () => {
  it('consumes exactly the required materials and produces the correct output', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_tough_jerky')!;
    grantItem(sim, 'spider_leg', 1, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(true);
    expect(result.itemId).toBe('tough_jerky');
    expect(result.count).toBe(1);
    expect(sim.countItem('spider_leg', pid)).toBe(0);
    expect(sim.countItem('tough_jerky', pid)).toBe(1);
  });

  it('consumes multi-reagent recipes down to exactly zero, never over- or under-consuming', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_eastbrook_arming_sword')!;
    grantItem(sim, 'bone_fragments', 2, pid);
    grantItem(sim, 'linen_scrap', 1, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(true);
    expect(sim.countItem('bone_fragments', pid)).toBe(0);
    expect(sim.countItem('linen_scrap', pid)).toBe(0);
    expect(sim.countItem('eastbrook_arming_sword', pid)).toBe(1);
  });

  it('denies and consumes NOTHING when any single reagent is short', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_eastbrook_arming_sword')!;
    // One bone_fragments short of the required 2.
    grantItem(sim, 'bone_fragments', 1, pid);
    grantItem(sim, 'linen_scrap', 1, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_materials');
    // Partial consumption never happens: both reagents untouched.
    expect(sim.countItem('bone_fragments', pid)).toBe(1);
    expect(sim.countItem('linen_scrap', pid)).toBe(1);
    expect(sim.countItem('eastbrook_arming_sword', pid)).toBe(0);
  });

  it('denies and consumes NOTHING when a LATER reagent is short (mirror of the first-reagent-short case)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_eastbrook_arming_sword')!;
    // Held bone_fragments (reagents[0]) in full, short on linen_scrap (reagents[1]).
    grantItem(sim, 'bone_fragments', 2, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_materials');
    expect(sim.countItem('bone_fragments', pid)).toBe(2);
    expect(sim.countItem('linen_scrap', pid)).toBe(0);
    expect(sim.countItem('eastbrook_arming_sword', pid)).toBe(0);
  });

  it('denies an unknown recipe id with no side effects', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const result = resolveCraft((sim as any).ctx, pid, 'not_a_real_recipe');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unknown_recipe');
  });

  it('hasRecipeMaterials matches resolveCraft admission without mutating state', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_tough_jerky')!;
    expect(hasRecipeMaterials((sim as any).ctx, recipe, pid)).toBe(false);
    grantItem(sim, 'spider_leg', 1, pid);
    expect(hasRecipeMaterials((sim as any).ctx, recipe, pid)).toBe(true);
    // Read-only: no reagent was consumed by the check itself.
    expect(sim.countItem('spider_leg', pid)).toBe(1);
  });

  it('grants a flat point of craft skill for the crafted recipe only', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_tough_jerky')!;
    grantItem(sim, 'spider_leg', 2, pid);
    const meta = (sim as any).players.get(pid);

    resolveCraft((sim as any).ctx, pid, recipe.id);
    expect(meta.craftSkills.cooking).toBe(1);
    expect(meta.craftSkills.weaponcrafting).toBe(0);

    resolveCraft((sim as any).ctx, pid, recipe.id);
    expect(meta.craftSkills.cooking).toBe(2);
  });

  it('a fixed-seed craft resolves to an identical result across two runs, masterwork field included', () => {
    const runOnce = () => {
      const sim = makeSim(7);
      const pid = sim.playerId;
      grantItem(sim, 'spider_leg', 1, pid);
      const recipe = recipeById('recipe_tough_jerky')!;
      return resolveCraft((sim as any).ctx, pid, recipe.id);
    };
    const a = runOnce();
    const b = runOnce();
    // Same seed, same scenario: the full CraftResult (masterwork proc outcome
    // included) must be identical across runs.
    expect(a).toEqual(b);
    // Phase 2: quality reports the OUTPUT DEF quality, a static fact of the
    // def (tough_jerky's def is common), identical for every craft of the
    // recipe at any seed.
    expect(a.quality).toBe('common');
    // A consumable def (no slot, no primary-stat profile) can never
    // masterwork, at any seed: the flag stays absent.
    expect(a.masterwork).toBeUndefined();
    expect(b.masterwork).toBeUndefined();
  });

  it('grants no craft skill on a denied craft', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_tough_jerky')!;
    const meta = (sim as any).players.get(pid);

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(false);
    expect(meta.craftSkills.cooking).toBe(0);
  });

  it('a successful craft consumes exactly one rng draw (the masterwork proc), zero on denial', () => {
    const sim = makeSim(7);
    const pid = sim.playerId;
    const recipe = recipeById('recipe_tough_jerky')!;

    let draws = 0;
    const rng: Rng = (sim as any).ctx.rng;
    rng.setObserver(() => {
      draws++;
    });

    const denied = resolveCraft((sim as any).ctx, pid, recipe.id);
    expect(denied.ok).toBe(false);
    expect(draws).toBe(0);

    grantItem(sim, 'spider_leg', 1, pid);
    const result = resolveCraft((sim as any).ctx, pid, recipe.id);
    rng.setObserver(null);

    expect(result.ok).toBe(true);
    // Phase 2: the output quality no longer rolls; it is the def's own static
    // quality (tough_jerky: common), whatever the seed.
    expect(result.quality).toBe('common');
    // Exactly one draw per successful craft: the masterwork proc roll, held at
    // the position the retired quality roll occupied. Denials draw nothing.
    expect(draws).toBe(1);
  });
});

describe('craftItem command (#1127)', () => {
  it('resolves server-side via Sim.craftItem, stashing the result on lastCraftResult', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantItem(sim, 'spider_leg', 1, pid);
    sim.craftItem('recipe_tough_jerky', pid);
    expect(sim.lastCraftResult?.ok).toBe(true);
    expect(sim.lastCraftResult?.itemId).toBe('tough_jerky');
    // Phase 2: quality is the OUTPUT DEF quality (tough_jerky: common), and a
    // plain deterministic craft never carries the masterwork flag.
    expect(sim.lastCraftResult?.quality).toBe('common');
    expect(sim.lastCraftResult?.masterwork).toBeUndefined();
    expect(sim.countItem('tough_jerky', pid)).toBe(1);
  });

  it('the IWorld recipeList read surface exposes every recipe, common, tool, and combo alike (#1132 review)', () => {
    const sim = makeSim();
    const allIds = [
      ...COMMON_RECIPES,
      ...TOOL_RECIPES,
      ...CASTER_HUB_RECIPES,
      ...COMBO_RECIPES,
      ...LADDER_RECIPES,
    ]
      .map((r) => r.id)
      .sort();
    expect(sim.recipeList.length).toBe(
      COMMON_RECIPES.length +
        TOOL_RECIPES.length +
        CASTER_HUB_RECIPES.length +
        COMBO_RECIPES.length +
        LADDER_RECIPES.length,
    );
    expect(sim.recipeList.map((r) => r.id).sort()).toEqual(allIds);
  });

  it('denies a craft with an error event and leaves lastCraftResult reflecting the denial', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.craftItem('recipe_tough_jerky', pid);
    expect(sim.lastCraftResult?.ok).toBe(false);
    expect(sim.lastCraftResult?.reason).toBe('insufficient_materials');
  });
});

// #1145: signed materials + the self-gathered crafting bonus. The chosen bonus
// (see professions/crafting.ts) is a reduced required quantity: one fewer unit
// of a reagent the crafter holds a self-signed instance of.
describe('self-gathered crafting bonus (#1145)', () => {
  it('a self-signed instance reduces that reagent requirement by one and is consumed', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    const recipe = recipeById('recipe_eastbrook_arming_sword')!; // needs bone_fragments x2, linen_scrap x1
    // One self-signed bone_fragments (stamped with this player's own name) plus
    // one plain bone_fragments: normally 2 would be required, the bonus drops it to 1.
    sim.addItemInstance('bone_fragments', { signer: meta.name }, pid);
    grantItem(sim, 'linen_scrap', 1, pid);

    expect(hasRecipeMaterials((sim as any).ctx, recipe, pid)).toBe(true);
    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(true);
    expect(result.selfSignedBonusApplied).toBe(true);
    // The single signed copy (the only bone_fragments held) was consumed as
    // part of satisfying the reduced (1-unit) requirement.
    expect(sim.countItem('bone_fragments', pid)).toBe(0);
    expect(sim.countItem('linen_scrap', pid)).toBe(0);
    expect(sim.countItem('eastbrook_arming_sword', pid)).toBe(1);
  });

  it('a material signed by a DIFFERENT player grants no bonus (same as unsigned)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_eastbrook_arming_sword')!;
    // Signed by someone else: does not count toward the crafter's own bonus.
    sim.addItemInstance('bone_fragments', { signer: 'SomeoneElse' }, pid);
    grantItem(sim, 'linen_scrap', 1, pid);

    // Still short: only 1 of the required 2 bone_fragments (no bonus reduction).
    expect(hasRecipeMaterials((sim as any).ctx, recipe, pid)).toBe(false);
    const result = resolveCraft((sim as any).ctx, pid, recipe.id);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_materials');
    expect(result.selfSignedBonusApplied).toBeUndefined();
  });

  it('an unsigned (plain fungible) material grants no bonus', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_eastbrook_arming_sword')!;
    grantItem(sim, 'bone_fragments', 2, pid);
    grantItem(sim, 'linen_scrap', 1, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);
    expect(result.ok).toBe(true);
    expect(result.selfSignedBonusApplied).toBe(false);
    expect(sim.countItem('bone_fragments', pid)).toBe(0);
  });
});

describe('tiered mastery gating (#1128)', () => {
  // A synthetic tier-1 recipe (skillReq 25, one bucket above common) reusing an
  // existing harvested reagent, so these tests can drive the tier curve without
  // needing higher-tier content in content/recipes.ts (that is a later issue).
  const tier1Recipe: ProfessionRecipeRecord = {
    id: 'test_tier1_recipe',
    professionId: 'weaponcrafting',
    resultItemId: 'eastbrook_arming_sword',
    resultCount: 1,
    reagents: [{ itemId: 'bone_fragments', count: 1 }],
    skillReq: 25,
    itemLevelBudget: 10,
    level: 10,
  };

  function setSkill(sim: Sim, pid: number, craftId: string, value: number) {
    const meta = (sim as any).players.get(pid);
    meta.craftSkills[craftId] = value;
  }

  it('crafting at the player tier capability grants full skill progress', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    setSkill(sim, pid, 'weaponcrafting', 25); // tier-1 capability
    grantItem(sim, 'bone_fragments', 1, pid);

    const result = resolveCraftForRecipe((sim as any).ctx, pid, tier1Recipe);

    expect(result.ok).toBe(true);
    const meta = (sim as any).players.get(pid);
    expect(meta.craftSkills.weaponcrafting).toBe(26); // 25 + full 1 point
  });

  it('crafting one tier below capability grants reduced (but non-zero) skill progress', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    setSkill(sim, pid, 'weaponcrafting', 50); // tier-2 capability, recipe is tier-1
    grantItem(sim, 'bone_fragments', 1, pid);

    const result = resolveCraftForRecipe((sim as any).ctx, pid, tier1Recipe);

    expect(result.ok).toBe(true);
    const meta = (sim as any).players.get(pid);
    const gained = meta.craftSkills.weaponcrafting - 50;
    expect(gained).toBeGreaterThan(0);
    expect(gained).toBeLessThan(1);
  });

  it('crafting two or more tiers below capability grants zero skill progress', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // Set weaponcrafting as the active archetype so its empowerment ceiling (#1129/#1203) is
    // unlimited: this isolates the raw tier-capability curve from the separate pre-archetype
    // "uncapped-to-rare" (tier 2) ceiling that would otherwise also clamp a tier-3 raw skill.
    sim.acceptArchetypeQuest('weaponcrafting');
    setSkill(sim, pid, 'weaponcrafting', 75); // tier-3 capability, recipe is tier-1
    grantItem(sim, 'bone_fragments', 1, pid);

    const result = resolveCraftForRecipe((sim as any).ctx, pid, tier1Recipe);

    expect(result.ok).toBe(true);
    const meta = (sim as any).players.get(pid);
    expect(meta.craftSkills.weaponcrafting).toBe(75);
  });

  it('common-tier crafting always grants its full floor, regardless of capability', () => {
    const lowCapSim = makeSim();
    const lowPid = lowCapSim.playerId;
    grantItem(lowCapSim, 'spider_leg', 1, lowPid);
    const commonRecipe = recipeById('recipe_tough_jerky')!;
    expect(commonRecipe.skillReq).toBe(0);

    resolveCraftForRecipe((lowCapSim as any).ctx, lowPid, commonRecipe);
    const lowMeta = (lowCapSim as any).players.get(lowPid);
    expect(lowMeta.craftSkills.cooking).toBe(1);

    const highCapSim = makeSim();
    const highPid = highCapSim.playerId;
    setSkill(highCapSim, highPid, 'cooking', 100); // high tier capability
    grantItem(highCapSim, 'spider_leg', 1, highPid);

    resolveCraftForRecipe((highCapSim as any).ctx, highPid, commonRecipe);
    const highMeta = (highCapSim as any).players.get(highPid);
    expect(highMeta.craftSkills.cooking).toBe(101); // still the full floor point
  });
});

describe('combo recipes requiring an adjacent craft pair (#1132)', () => {
  // recipe_ironbound_warplate_helm requires BOTH armorcrafting and
  // weaponcrafting at tier 1 (skill >= 25): confirmed adjacent via
  // src/sim/content/professions.ts adjacentCrafts('armorcrafting').
  const comboRecipe = COMBO_RECIPES.find((r) => r.id === 'recipe_ironbound_warplate_helm')!;

  function setSkill(sim: Sim, pid: number, craftId: string, value: number) {
    const meta = (sim as any).players.get(pid);
    meta.craftSkills[craftId] = value;
  }

  it('every combo recipe carries a comboRequirement naming two crafts and a minTier', () => {
    expect(COMBO_RECIPES.length).toBeGreaterThanOrEqual(2);
    for (const recipe of COMBO_RECIPES) {
      expect(recipe.comboRequirement).toBeDefined();
      expect(recipe.comboRequirement!.craftA).not.toBe(recipe.comboRequirement!.craftB);
      expect(recipe.comboRequirement!.minTier).toBeGreaterThan(0);
    }
  });

  it('meetsComboRequirement is true with no comboRequirement on the recipe', () => {
    const commonRecipe = recipeById('recipe_tough_jerky')!;
    expect(meetsComboRequirement({}, commonRecipe)).toBe(true);
  });

  it('a player with both required crafts at or above minTier CAN craft the combo recipe', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.acceptArchetypeQuest('armorcrafting');
    setSkill(sim, pid, 'armorcrafting', 25);
    setSkill(sim, pid, 'weaponcrafting', 25);
    // Phase 9 acquisition switch: combo recipes are trainer-taught, so the
    // fresh test player learns this one explicitly before crafting it.
    (sim as any).players.get(pid).knownRecipes.add(comboRecipe.id);
    grantItem(sim, 'bone_fragments', 4, pid);
    grantItem(sim, 'linen_scrap', 2, pid);

    const result = resolveCraftForRecipe((sim as any).ctx, pid, comboRecipe);

    expect(result.ok).toBe(true);
    expect(result.itemId).toBe(comboRecipe.resultItemId);
    expect(sim.countItem(comboRecipe.resultItemId, pid)).toBe(1);
  });

  it('missing craftB denies the craft even with craftA and an unrelated craft very high', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    setSkill(sim, pid, 'armorcrafting', 100); // craftA very high
    setSkill(sim, pid, 'weaponcrafting', 0); // craftB missing entirely
    setSkill(sim, pid, 'cooking', 100); // unrelated craft, also very high
    grantItem(sim, 'bone_fragments', 4, pid);
    grantItem(sim, 'linen_scrap', 2, pid);

    let draws = 0;
    const rng: Rng = (sim as any).ctx.rng;
    rng.setObserver(() => {
      draws++;
    });
    const result = resolveCraftForRecipe((sim as any).ctx, pid, comboRecipe);
    rng.setObserver(null);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('combo_requirement_unmet');
    // The combo admission gate denies BEFORE the masterwork proc draw: a
    // combo-denied craft consumes zero rng, same as every other denial, so
    // the draw can never migrate ahead of admission unnoticed.
    expect(draws).toBe(0);
    // Denied with no side effect: reagents untouched, no item granted.
    expect(sim.countItem('bone_fragments', pid)).toBe(4);
    expect(sim.countItem('linen_scrap', pid)).toBe(2);
    expect(sim.countItem(comboRecipe.resultItemId, pid)).toBe(0);
  });

  it('a player whose only high skill is an unrelated craft cannot craft the combo recipe', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // No skill at all in either required craft; sky-high skill in a third,
    // unrelated craft never substitutes for either half of the pair.
    setSkill(sim, pid, 'cooking', 200);
    grantItem(sim, 'bone_fragments', 4, pid);
    grantItem(sim, 'linen_scrap', 2, pid);

    const result = resolveCraftForRecipe((sim as any).ctx, pid, comboRecipe);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('combo_requirement_unmet');
  });

  it('one craft below minTier still denies even though the other meets it', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    setSkill(sim, pid, 'armorcrafting', 25); // meets minTier 1
    setSkill(sim, pid, 'weaponcrafting', 24); // one point short of tier 1
    grantItem(sim, 'bone_fragments', 4, pid);
    grantItem(sim, 'linen_scrap', 2, pid);

    const result = resolveCraftForRecipe((sim as any).ctx, pid, comboRecipe);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('combo_requirement_unmet');
  });

  it('craftItem via the Sim command surface denies a combo recipe missing craftB', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    setSkill(sim, pid, 'armorcrafting', 25);
    grantItem(sim, 'bone_fragments', 4, pid);
    grantItem(sim, 'linen_scrap', 2, pid);

    sim.craftItem(comboRecipe.id, pid);

    expect(sim.lastCraftResult?.ok).toBe(false);
    expect(sim.lastCraftResult?.reason).toBe('combo_requirement_unmet');
  });
});

// #1145: signed materials + the self-gathered crafting bonus. The chosen bonus
// (see professions/crafting.ts) is a reduced required quantity: one fewer unit
// of a reagent the crafter holds a self-signed instance of.
describe('self-gathered crafting bonus (#1145)', () => {
  it('a self-signed instance reduces that reagent requirement by one and is consumed', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    const recipe = recipeById('recipe_eastbrook_arming_sword')!; // needs bone_fragments x2, linen_scrap x1
    // One self-signed bone_fragments (stamped with this player's own name) plus
    // one plain bone_fragments: normally 2 would be required, the bonus drops it to 1.
    sim.addItemInstance('bone_fragments', { signer: meta.name }, pid);
    grantItem(sim, 'linen_scrap', 1, pid);

    expect(hasRecipeMaterials((sim as any).ctx, recipe, pid)).toBe(true);
    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(true);
    expect(result.selfSignedBonusApplied).toBe(true);
    // The single signed copy (the only bone_fragments held) was consumed as
    // part of satisfying the reduced (1-unit) requirement.
    expect(sim.countItem('bone_fragments', pid)).toBe(0);
    expect(sim.countItem('linen_scrap', pid)).toBe(0);
    expect(sim.countItem('eastbrook_arming_sword', pid)).toBe(1);
  });

  it('a material signed by a DIFFERENT player grants no bonus (same as unsigned)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_eastbrook_arming_sword')!;
    // Signed by someone else: does not count toward the crafter's own bonus.
    sim.addItemInstance('bone_fragments', { signer: 'SomeoneElse' }, pid);
    grantItem(sim, 'linen_scrap', 1, pid);

    // Still short: only 1 of the required 2 bone_fragments (no bonus reduction).
    expect(hasRecipeMaterials((sim as any).ctx, recipe, pid)).toBe(false);
    const result = resolveCraft((sim as any).ctx, pid, recipe.id);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_materials');
    expect(result.selfSignedBonusApplied).toBeUndefined();
  });

  it('a self-signed instance never waives the last required unit (floored at 1, not 0)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    const recipe = recipeById('recipe_tough_jerky')!; // needs spider_leg x1
    sim.addItemInstance('spider_leg', { signer: meta.name }, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(true);
    // count 1 minus the bonus would floor to 0; the fix floors at 1 instead so
    // the signed instance is actually consumed, not retained for infinite crafts.
    expect(result.selfSignedBonusApplied).toBe(false);
    expect(sim.countItem('spider_leg', pid)).toBe(0);

    // A second craft attempt fails: the signed instance was consumed, not retained.
    const second = resolveCraft((sim as any).ctx, pid, recipe.id);
    expect(second.ok).toBe(false);
  });

  it('an unsigned (plain fungible) material grants no bonus', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const recipe = recipeById('recipe_eastbrook_arming_sword')!;
    grantItem(sim, 'bone_fragments', 2, pid);
    grantItem(sim, 'linen_scrap', 1, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);
    expect(result.ok).toBe(true);
    expect(result.selfSignedBonusApplied).toBe(false);
    expect(sim.countItem('bone_fragments', pid)).toBe(0);
  });
});

describe('craft-completion event carries audio-relevant data (#1729)', () => {
  it('a completed craft emits a personal craftResult carrying quality (rare distinguishable) and pid', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantItem(sim, 'spider_leg', 1, pid);

    sim.drainEvents();
    // The coordinator command (not the pure resolveCraft) is what emits the
    // craftResult event the client hooks audio onto.
    sim.craftItem('recipe_tough_jerky', pid);
    const craft = sim.drainEvents().find((e) => e.type === 'craftResult');
    if (craft?.type !== 'craftResult') throw new Error('expected a craftResult event');
    expect(craft.ok).toBe(true);
    // Personal: carries the acting player's pid so the server routes it only to
    // the crafter (delivered-to-acting-player acceptance criterion).
    expect(craft.pid).toBe(pid);
    // quality is present on a completed craft so the client can distinguish a
    // rare-def result from a common one for a special cue. Phase 2: this is
    // the OUTPUT DEF quality (tough_jerky's def is common), a static fact of
    // the def, so this exact value is seed-independent.
    expect(craft.quality).toBe('common');
    // A plain deterministic craft never carries the masterwork flag.
    expect(craft.masterwork).toBeUndefined();
  });

  it('a denied craft still emits a craftResult, with ok:false, no quality, and a reason', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // No materials granted: the insufficient_materials denial path.
    sim.drainEvents();
    sim.craftItem('recipe_tough_jerky', pid);
    const craft = sim.drainEvents().find((e) => e.type === 'craftResult');
    if (craft?.type !== 'craftResult') throw new Error('expected a craftResult event');
    expect(craft.ok).toBe(false);
    expect(craft.quality).toBeUndefined();
    expect(craft.reason).toBe('insufficient_materials');
  });
});

// Professions 2.0 Phase 2: the masterwork proc model. Craft outputs are
// deterministic (quality is the OUTPUT DEF quality, pinned above); the single
// remaining output-side rng draw is the masterwork proc roll. These cases pin
// the proc surface end to end: the CraftResult/craftResult-event flag, the
// minted instance payload, the masterwork SimEvent, and the lastMasterwork
// read surface, plus the miss arm's plain deterministic grant.
describe('masterwork proc (Professions 2.0 Phase 2)', () => {
  // A maximum-chance scenario: tailoring as the active archetype (a MAJOR
  // craft, so the empowerment ceiling is unlimited), skill 200 (tier 8, far
  // above the recipe's tier 0), and a self-signed consumed reagent, so the
  // proc chance sums past the cap and lands at MASTERWORK_CHANCE_CAP (0.15).
  // The output (eastbrook_ritual_vestments) is an equippable uncommon-def
  // piece with a primary-stat profile (int/spi), so the effect gate passes:
  // uncommon bumps to rare, under the major craft's unlimited ceiling.
  function vestmentsScenario(seed: number) {
    const sim = makeSim(seed);
    const pid = sim.playerId;
    sim.acceptArchetypeQuest('tailoring');
    const meta = (sim as any).players.get(pid);
    meta.craftSkills.tailoring = 200;
    // The single self-signed linen scrap satisfies the whole linen requirement
    // (the #1145 minus-one reduction composes with the specialization
    // discount: 3 -> 2 -> floor(2 * 0.8) = 1) and marks selfSignedBonusApplied
    // for the proc-chance input.
    sim.addItemInstance('linen_scrap', { signer: meta.name }, pid);
    sim.addItem('spider_leg', 1, pid);
    return { sim, pid, meta };
  }

  it('a proc mints a signed masterwork instance and surfaces it on every seam (hunted seed)', () => {
    // Seed 2 was hunted (bounded scan from seed 1 upward) so the single proc
    // draw lands under the capped 15 percent chance; only the pinned literal
    // is committed, per the suite's seed-pinning idiom.
    const { sim, pid, meta } = vestmentsScenario(2);
    sim.drainEvents();
    let draws = 0;
    const rng: Rng = (sim as any).ctx.rng;
    rng.setObserver(() => {
      draws++;
    });
    sim.craftItem('recipe_eastbrook_ritual_vestments', pid);
    rng.setObserver(null);

    // Still exactly one draw across the whole command path: the proc roll.
    expect(draws).toBe(1);

    // CraftResult (via the lastCraftResult stash) carries the flag; quality
    // stays the OUTPUT DEF quality (uncommon), never the bumped tier.
    expect(sim.lastCraftResult?.ok).toBe(true);
    expect(sim.lastCraftResult?.quality).toBe('uncommon');
    expect(sim.lastCraftResult?.masterwork).toBe(true);

    const events = sim.drainEvents();
    const craft = events.find((e) => e.type === 'craftResult');
    if (craft?.type !== 'craftResult') throw new Error('expected a craftResult event');
    expect(craft.ok).toBe(true);
    expect(craft.quality).toBe('uncommon');
    expect(craft.masterwork).toBe(true);

    // The masterwork SimEvent: ids only, personal (pid = crafter entity id).
    const mw = events.find((e) => e.type === 'masterwork');
    if (mw?.type !== 'masterwork') throw new Error('expected a masterwork event');
    expect(mw.recipeId).toBe('recipe_eastbrook_ritual_vestments');
    expect(mw.itemId).toBe('eastbrook_ritual_vestments');
    expect(mw.crafter).toBe(pid);
    expect(mw.pid).toBe(pid);

    // The minted copy: ONE signed instance whose rolled payload is the
    // masterwork marker plus the baked TIER-DELTA stats (the uncommon-to-rare
    // primary budget delta at the recipe's level 9, redistributed over the
    // def's int/spi profile). New crafts never write rolled.quality.
    const slots = meta.inventory.filter((s: any) => s.itemId === 'eastbrook_ritual_vestments');
    expect(slots.length).toBe(1);
    const instance = slots[0].instance;
    expect(instance?.signer).toBe(meta.name);
    expect(instance?.rolled?.masterwork).toBe(true);
    expect(instance?.rolled?.quality).toBeUndefined();
    expect(instance?.rolled?.stats).toEqual({ int: 1, spi: 1 });

    // The IWorld read surface reflects the proc.
    expect(sim.lastMasterwork).toEqual({
      recipeId: 'recipe_eastbrook_ritual_vestments',
      itemId: 'eastbrook_ritual_vestments',
      crafter: pid,
    });
  });

  it('a missed proc still draws exactly once and grants a plain common-def stack (hunted seed)', () => {
    // The same maximum-chance shape on a common-def output (the chain vest,
    // under armorcrafting as the MAJOR craft). Seed 1 was hunted so the single
    // proc draw lands ABOVE the capped 15 percent chance: the roll itself
    // misses, decisively. The observed-roll pin below keeps that premise
    // load-bearing (this def is armor-only, so the effect gate would ALSO
    // deny; without the pin, a re-seeded roll under the cap would pass
    // silently through the gate instead of proving a roll miss).
    const sim = makeSim(1);
    const pid = sim.playerId;
    sim.acceptArchetypeQuest('armorcrafting');
    const meta = (sim as any).players.get(pid);
    meta.craftSkills.armorcrafting = 200;
    // One self-signed bone fragment satisfies the whole requirement (3 -> 2 ->
    // floor(2 * 0.8) = 1), mirroring the proc case's chance inputs.
    sim.addItemInstance('bone_fragments', { signer: meta.name }, pid);
    sim.drainEvents();
    let draws = 0;
    let roll = -1;
    const rng: Rng = (sim as any).ctx.rng;
    rng.setObserver((value) => {
      draws++;
      roll = value;
    });
    sim.craftItem('recipe_eastbrook_chain_vest', pid);
    rng.setObserver(null);

    // The proc draw is unconditional on the success path: exactly one draw
    // even when it misses, and the seed-1 draw really does land at or above
    // the capped chance, so the miss is the roll's doing.
    expect(draws).toBe(1);
    expect(roll).toBeGreaterThanOrEqual(MASTERWORK_CHANCE_CAP);
    expect(sim.lastCraftResult?.ok).toBe(true);
    expect(sim.lastCraftResult?.quality).toBe('common');
    expect(sim.lastCraftResult?.masterwork).toBeUndefined();

    // No masterwork event fired.
    const events = sim.drainEvents();
    expect(events.find((e) => e.type === 'masterwork')).toBeUndefined();

    // A common-def output stays a plain fungible stack: no instance minted,
    // no rolled payload anywhere.
    const slots = meta.inventory.filter((s: any) => s.itemId === 'eastbrook_chain_vest');
    expect(slots.length).toBe(1);
    expect(slots[0].count).toBe(1);
    expect(slots[0].instance).toBeUndefined();

    // The per-player masterwork read surface never moved.
    expect(sim.lastMasterwork).toBeNull();
  });
});
