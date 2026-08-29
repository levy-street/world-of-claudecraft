import { describe, expect, it } from 'vitest';
import { CRAFT_GOLD_SINK_COPPER_PER_BUDGET, STATIONS } from '../src/sim/content/professions';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { archetypeCeilingFor } from '../src/sim/professions/archetype';
import { requiredReagentCount } from '../src/sim/professions/crafting';
import { materialGradeIds } from '../src/sim/professions/material_grades';
import type { StationType } from '../src/sim/professions/stations';
import { stationTypeForCraft } from '../src/sim/professions/stations';
import {
  MINIMAL_TIER_MULTIPLIER,
  REDUCED_TIER_MULTIPLIER,
  tierCapability,
  tierForSkill,
  tierProgressMultiplier,
} from '../src/sim/professions/wheel';
import type { PlayerMeta } from '../src/sim/sim';
import type { InvSlot, ItemDef } from '../src/sim/types';
import {
  buildCraftingView,
  type CraftDifficulty,
  type CraftingIdentityLike,
  craftingReagentSig,
  craftLearnHints,
  type RecipeDefLike,
} from '../src/ui/crafting_view';

function item(id: string): ItemDef {
  return {
    id,
    name: id,
    quality: 'common',
    kind: 'junk',
    sellValue: 0,
  } as unknown as ItemDef;
}

function table(...items: ItemDef[]): Record<string, ItemDef> {
  return Object.fromEntries(items.map((i) => [i.id, i]));
}

function recipe(id: string, reagents: { itemId: string; count: number }[]): RecipeDefLike {
  return {
    id,
    professionId: 'cooking',
    resultItemId: `${id}_result`,
    resultCount: 1,
    reagents,
    skillReq: 0,
  };
}

describe('buildCraftingView', () => {
  it('marks a recipe craftable when the player holds every required reagent', () => {
    const items = table(item('bone_fragments'), item('recipe_a_result'));
    const inventory: InvSlot[] = [{ itemId: 'bone_fragments', count: 3 }];
    const view = buildCraftingView(
      [recipe('recipe_a', [{ itemId: 'bone_fragments', count: 2 }])],
      inventory,
      items,
    );
    expect(view.recipes[0].craftable).toBe(true);
    expect(view.recipes[0].reagents[0]).toMatchObject({ required: 2, have: 3, satisfied: true });
  });

  it('marks a recipe not craftable when any single reagent is short', () => {
    const items = table(item('bone_fragments'), item('linen_scrap'), item('recipe_b_result'));
    const inventory: InvSlot[] = [
      { itemId: 'bone_fragments', count: 2 },
      { itemId: 'linen_scrap', count: 0 },
    ];
    const view = buildCraftingView(
      [
        recipe('recipe_b', [
          { itemId: 'bone_fragments', count: 2 },
          { itemId: 'linen_scrap', count: 1 },
        ]),
      ],
      inventory,
      items,
    );
    expect(view.recipes[0].craftable).toBe(false);
    const linen = view.recipes[0].reagents.find((r) => r.itemId === 'linen_scrap')!;
    expect(linen.satisfied).toBe(false);
    expect(linen.have).toBe(0);
  });

  it('sums count across multiple inventory slots of the same reagent', () => {
    const items = table(item('spider_leg'), item('recipe_c_result'));
    const inventory: InvSlot[] = [
      { itemId: 'spider_leg', count: 1 },
      { itemId: 'spider_leg', count: 1 },
    ];
    const view = buildCraftingView(
      [recipe('recipe_c', [{ itemId: 'spider_leg', count: 2 }])],
      inventory,
      items,
    );
    expect(view.recipes[0].reagents[0].have).toBe(2);
    expect(view.recipes[0].craftable).toBe(true);
  });

  it('never mutates the inventory or recipe inputs passed in', () => {
    const items = table(item('bone_fragments'), item('recipe_d_result'));
    const inventory: InvSlot[] = [{ itemId: 'bone_fragments', count: 5 }];
    const recipes = [recipe('recipe_d', [{ itemId: 'bone_fragments', count: 2 }])];
    const inventorySnapshot = JSON.stringify(inventory);
    const recipesSnapshot = JSON.stringify(recipes);
    buildCraftingView(recipes, inventory, items);
    expect(JSON.stringify(inventory)).toBe(inventorySnapshot);
    expect(JSON.stringify(recipes)).toBe(recipesSnapshot);
  });
});

// The reagent line shows and gates on the DISCOUNTED requirement the sim
// actually charges (requiredReagentCount: the #1145 self-signed reduction
// composed with the #1134 specialization discount), never the raw listed
// count, so the window can neither overstate the cost nor block a craft the
// server would accept.
describe('buildCraftingView discounted reagent requirements (#1134/#1145)', () => {
  const PLAYER = 'Testchar';
  // PERK_THRESHOLDS: specialization at skill 75, materialDiscountPct 0.2.
  const specializedSkills = { cooking: 75 };
  const noIdentity: CraftingIdentityLike = {
    synced: true,
    activeArchetype: null,
    pairedMajor: null,
    hobbyCraft: null,
  };

  function reagentRow(
    listed: number,
    inventory: InvSlot[],
    craftSkills: Record<string, number>,
    playerName?: string,
  ) {
    const items = table(item('bone_fragments'), item('recipe_disc_result'));
    const view = buildCraftingView(
      [recipe('recipe_disc', [{ itemId: 'bone_fragments', count: listed }])],
      inventory,
      items,
      craftSkills,
      noIdentity,
      new Set<StationType>(),
      playerName,
    );
    return { row: view.recipes[0], reagent: view.recipes[0].reagents[0] };
  }

  it('a specialized crafter sees the discounted requirement and the row gates on it (listed 4 shows 3)', () => {
    // Holding exactly the discounted amount: the raw-count view says short
    // (3 < 4) and disables Craft; the sim charges 3 and would accept. This is
    // the red case the fix exists for.
    const inventory: InvSlot[] = [{ itemId: 'bone_fragments', count: 3 }];
    const { row, reagent } = reagentRow(4, inventory, specializedSkills, PLAYER);
    expect(reagent).toMatchObject({ required: 3, have: 3, satisfied: true });
    expect(row.craftable).toBe(true);
  });

  it('the specialization discount applies even when no player name is passed', () => {
    // No name only disables the SELF-SIGNED check; the #1134 discount reads
    // craftSkills alone and must still show.
    const inventory: InvSlot[] = [{ itemId: 'bone_fragments', count: 3 }];
    const { row, reagent } = reagentRow(4, inventory, specializedSkills);
    expect(reagent).toMatchObject({ required: 3, satisfied: true });
    expect(row.craftable).toBe(true);
  });

  it('a listed count of 1 floors at required 1 under every discount', () => {
    const signed: InvSlot[] = [
      { itemId: 'bone_fragments', count: 1, instance: { signer: PLAYER } },
    ];
    expect(reagentRow(1, signed, specializedSkills, PLAYER).reagent.required).toBe(1);
    expect(reagentRow(1, signed, {}, PLAYER).reagent.required).toBe(1);
    expect(
      reagentRow(1, [{ itemId: 'bone_fragments', count: 1 }], specializedSkills, PLAYER).reagent
        .required,
    ).toBe(1);
  });

  it('a self-signed instance of the reagent reduces required by 1; another name does not', () => {
    const selfSigned: InvSlot[] = [
      { itemId: 'bone_fragments', count: 4, instance: { signer: PLAYER } },
    ];
    expect(reagentRow(4, selfSigned, {}, PLAYER).reagent.required).toBe(3);
    // Someone ELSE's signed material behaves like a plain unsigned one.
    const otherSigned: InvSlot[] = [
      { itemId: 'bone_fragments', count: 4, instance: { signer: 'Someoneelse' } },
    ];
    expect(reagentRow(4, otherSigned, {}, PLAYER).reagent.required).toBe(4);
  });

  it('both discounts compose: listed 4, self-signed to 3, times 0.8 floors to 2', () => {
    const selfSigned: InvSlot[] = [
      { itemId: 'bone_fragments', count: 2, instance: { signer: PLAYER } },
    ];
    const { row, reagent } = reagentRow(4, selfSigned, specializedSkills, PLAYER);
    expect(reagent).toMatchObject({ required: 2, have: 2, satisfied: true });
    expect(row.craftable).toBe(true);
  });

  it('non-specialized with no self-signed material: required equals the listed count', () => {
    const inventory: InvSlot[] = [{ itemId: 'bone_fragments', count: 3 }];
    const { row, reagent } = reagentRow(4, inventory, { cooking: 74 }, PLAYER);
    expect(reagent).toMatchObject({ required: 4, have: 3, satisfied: false });
    expect(row.craftable).toBe(false);
  });

  it('divergence guard: the view required equals the sim requiredReagentCount for identical inputs', () => {
    const cases: { listed: number; inventory: InvSlot[]; skills: Record<string, number> }[] = [
      { listed: 4, inventory: [{ itemId: 'bone_fragments', count: 3 }], skills: specializedSkills },
      {
        listed: 4,
        inventory: [{ itemId: 'bone_fragments', count: 4, instance: { signer: PLAYER } }],
        skills: {},
      },
      {
        listed: 4,
        inventory: [{ itemId: 'bone_fragments', count: 2, instance: { signer: PLAYER } }],
        skills: specializedSkills,
      },
      { listed: 1, inventory: [{ itemId: 'bone_fragments', count: 1 }], skills: specializedSkills },
      { listed: 5, inventory: [], skills: {} },
    ];
    for (const c of cases) {
      const meta = { name: PLAYER, inventory: c.inventory } as unknown as PlayerMeta;
      const simRequired = requiredReagentCount(
        meta,
        { itemId: 'bone_fragments', count: c.listed },
        c.skills,
        'cooking',
      ).count;
      const { reagent } = reagentRow(c.listed, c.inventory, c.skills, PLAYER);
      expect(reagent.required, `listed ${c.listed} skills ${JSON.stringify(c.skills)}`).toBe(
        simRequired,
      );
    }
  });

  it('a shared reagent keeps per-recipe required counts (memoized facts are per item, not per row)', () => {
    // Two recipes in ONE build pull the same reagent, so the inventory probes
    // (have, self-signed) resolve once for the pair, but required must still
    // differ per recipe: it also depends on the recipe's professionId, and
    // only cooking is specialized here. A memo that cached the required
    // count per itemId would collapse these to one value and fail.
    const items = table(
      item('bone_fragments'),
      item('recipe_disc_a_result'),
      item('recipe_disc_b_result'),
    );
    const inventory: InvSlot[] = [
      { itemId: 'bone_fragments', count: 4, instance: { signer: PLAYER } },
    ];
    const view = buildCraftingView(
      [
        recipe('recipe_disc_a', [{ itemId: 'bone_fragments', count: 4 }]),
        {
          ...recipe('recipe_disc_b', [{ itemId: 'bone_fragments', count: 4 }]),
          professionId: 'weaponcrafting',
        },
      ],
      inventory,
      items,
      specializedSkills,
      noIdentity,
      new Set<StationType>(),
      PLAYER,
    );
    const [cookingRow, weaponRow] = view.recipes;
    // Cooking is specialized AND self-signed: 4 to 3, then floor(3 * 0.8) = 2.
    expect(cookingRow.reagents[0]).toMatchObject({ required: 2, have: 4, satisfied: true });
    // Weaponcrafting is not specialized: the self-signed reduction alone, 4 to 3.
    expect(weaponRow.reagents[0]).toMatchObject({ required: 3, have: 4, satisfied: true });
    expect(cookingRow.craftable).toBe(true);
    expect(weaponRow.craftable).toBe(true);
  });

  it('cache-hit rows stay consistent: same profession shares identical facts, other reagents stay independent', () => {
    // Three recipes in one build: two same-profession rows sharing a reagent
    // must render identical have/required, and a third recipe's different
    // reagent must keep its own facts (the memo keys by itemId only).
    const items = table(
      item('bone_fragments'),
      item('linen_scrap'),
      item('recipe_disc_c_result'),
      item('recipe_disc_d_result'),
      item('recipe_disc_e_result'),
    );
    const inventory: InvSlot[] = [
      { itemId: 'bone_fragments', count: 3 },
      { itemId: 'linen_scrap', count: 1 },
    ];
    const view = buildCraftingView(
      [
        recipe('recipe_disc_c', [{ itemId: 'bone_fragments', count: 4 }]),
        recipe('recipe_disc_d', [{ itemId: 'bone_fragments', count: 4 }]),
        recipe('recipe_disc_e', [{ itemId: 'linen_scrap', count: 3 }]),
      ],
      inventory,
      items,
      specializedSkills,
      noIdentity,
      new Set<StationType>(),
      PLAYER,
    );
    const [first, second, third] = view.recipes;
    // Same profession, same unsigned reagent: identical rows, floor(4 * 0.8) = 3.
    expect(first.reagents[0]).toMatchObject({ required: 3, have: 3, satisfied: true });
    expect(second.reagents[0]).toMatchObject({ required: 3, have: 3, satisfied: true });
    // A different reagent keeps independent facts: floor(3 * 0.8) = 2 against have 1.
    expect(third.reagents[0]).toMatchObject({ required: 2, have: 1, satisfied: false });
    expect(third.craftable).toBe(false);
  });
});

describe('buildCraftingView combo-recipe gate (#1132 review)', () => {
  function comboRecipe(id: string): RecipeDefLike {
    return {
      ...recipe(id, []),
      comboRequirement: { craftA: 'armorcrafting', craftB: 'weaponcrafting', minTier: 1 },
    };
  }

  it('marks a combo recipe not craftable when the player lacks tier capability in either named craft', () => {
    const items = table(item('recipe_combo_result'));
    const view = buildCraftingView([comboRecipe('recipe_combo')], [], items, {
      armorcrafting: 25,
      weaponcrafting: 0,
    });
    expect(view.recipes[0].craftable).toBe(false);
  });

  it('marks a combo recipe craftable once the player meets tier capability in both named crafts', () => {
    const items = table(item('recipe_combo_result'));
    const view = buildCraftingView(
      [comboRecipe('recipe_combo')],
      [],
      items,
      {
        armorcrafting: 25,
        weaponcrafting: 25,
      },
      {
        synced: true,
        activeArchetype: 'armorcrafting',
        pairedMajor: 'weaponcrafting',
        hobbyCraft: 'leatherworking',
      },
    );
    expect(view.recipes[0].craftable).toBe(true);
    expect(view.recipes[0].comboRequirement).toMatchObject({ met: true, reason: null });
  });

  it('an unrelated craft, however high, never substitutes for a required craft', () => {
    const items = table(item('recipe_combo_result'));
    const view = buildCraftingView([comboRecipe('recipe_combo')], [], items, {
      armorcrafting: 25,
      cooking: 500,
    });
    expect(view.recipes[0].craftable).toBe(false);
  });

  it('a recipe with no comboRequirement ignores craftSkills entirely', () => {
    const items = table(item('bone_fragments'), item('recipe_plain_result'));
    const inventory: InvSlot[] = [{ itemId: 'bone_fragments', count: 2 }];
    const view = buildCraftingView(
      [recipe('recipe_plain', [{ itemId: 'bone_fragments', count: 2 }])],
      inventory,
      items,
      {},
    );
    expect(view.recipes[0].craftable).toBe(true);
  });

  it('high raw skills do not unlock a combo without the exact active pair', () => {
    const items = table(item('recipe_combo_result'));
    const view = buildCraftingView(
      [comboRecipe('recipe_combo')],
      [],
      items,
      { armorcrafting: 100, weaponcrafting: 100 },
      { synced: true, activeArchetype: null, pairedMajor: null, hobbyCraft: null },
    );
    expect(view.recipes[0].craftable).toBe(false);
    expect(view.recipes[0].comboRequirement).toMatchObject({
      met: false,
      reason: 'not_attuned',
    });
  });

  it('keeps the action available while the online crafting identity is still syncing', () => {
    const items = table(item('recipe_combo_result'));
    const view = buildCraftingView(
      [comboRecipe('recipe_combo')],
      [],
      items,
      {},
      { synced: false, activeArchetype: null, pairedMajor: null, hobbyCraft: null },
    );
    expect(view.recipes[0].craftable).toBe(true);
    expect(view.recipes[0].comboRequirement).toMatchObject({ met: null, reason: 'syncing' });
  });
});

// #2037: skill-req line, skill-gain difficulty, and the station
// gate (per-type) on the rows model.
describe('buildCraftingView difficulty and skillReq', () => {
  // Identity where the recipe's craft (cooking) is a MAJOR: the archetype
  // ceiling is Infinity, isolating the ordinary tier curve.
  const majorIdentity: CraftingIdentityLike = {
    synced: true,
    activeArchetype: 'cooking',
    pairedMajor: 'alchemy',
    hobbyCraft: null,
  };

  function difficultyFor(
    skillReq: number,
    craftSkills: Record<string, number>,
    identity: CraftingIdentityLike = majorIdentity,
  ): CraftDifficulty {
    const items = table(item('recipe_diff_result'));
    const view = buildCraftingView(
      [{ ...recipe('recipe_diff', []), skillReq }],
      [],
      items,
      craftSkills,
      identity,
    );
    return view.recipes[0].difficulty;
  }

  it('surfaces the recipe skillReq on the row', () => {
    const items = table(item('recipe_sr_result'));
    const view = buildCraftingView([{ ...recipe('recipe_sr', []), skillReq: 75 }], [], items);
    expect(view.recipes[0].skillReq).toBe(75);
  });

  // The #1301 gold sink (src/sim/professions/crafting.ts resolveCraftForRecipe)
  // charges Math.ceil(itemLevelBudget * CRAFT_GOLD_SINK_COPPER_PER_BUDGET) on
  // every successful craft, but never surfaced it anywhere in the crafting
  // window: a player could not see the fee before or after crafting. The
  // itemLevelBudget of 16 below mirrors the real Marshstalker Spaulders
  // recipe (a reported 32c fee at CRAFT_GOLD_SINK_COPPER_PER_BUDGET=2).
  it('surfaces the craft fee using the exact sim gold-sink formula', () => {
    const items = table(item('recipe_fee_result'));
    const view = buildCraftingView(
      [{ ...recipe('recipe_fee', []), itemLevelBudget: 16 }],
      [],
      items,
    );
    expect(view.recipes[0].craftFeeCopper).toBe(Math.ceil(16 * CRAFT_GOLD_SINK_COPPER_PER_BUDGET));
  });

  it('charges zero craft fee for a recipe with no itemLevelBudget', () => {
    const items = table(item('recipe_nofee_result'));
    const view = buildCraftingView([recipe('recipe_nofee', [])], [], items);
    expect(view.recipes[0].craftFeeCopper).toBe(0);
  });

  it('surfaces content craft-cast durationSec on every row (Phase 2 chip source)', () => {
    const items = table(item('recipe_dur_result'));
    const field = buildCraftingView([{ ...recipe('recipe_field', []), skillReq: 0 }], [], items);
    const mid = buildCraftingView([{ ...recipe('recipe_mid', []), skillReq: 50 }], [], items);
    expect(field.recipes[0].durationSec).toBe(1.75);
    expect(mid.recipes[0].durationSec).toBe(3);
  });

  it('full at or above raw capability (this is how capability advances)', () => {
    // At capability: skill 100 (tier 4) vs skillReq 100 (tier 4).
    expect(difficultyFor(100, { cooking: 100 })).toBe('full');
    // Above capability: skill 50 (tier 2) vs skillReq 100 (tier 4).
    expect(difficultyFor(100, { cooking: 50 })).toBe('full');
  });

  it('reduced one tier below, minimal two below, none three or more below', () => {
    expect(difficultyFor(75, { cooking: 100 })).toBe('reduced');
    // Two below is the green minimal state (MINIMAL_TIER_MULTIPLIER), its own
    // four-state label since the Stage 5 split (was bucketed into 'reduced').
    expect(difficultyFor(50, { cooking: 100 })).toBe('minimal');
    expect(difficultyFor(25, { cooking: 100 })).toBe('none');
  });

  it('the tier-0 free floor is retired: common recipes ride the curve', () => {
    expect(difficultyFor(0, { cooking: 0 })).toBe('full');
    expect(difficultyFor(0, { cooking: 25 })).toBe('reduced');
    expect(difficultyFor(0, { cooking: 50 })).toBe('minimal');
    expect(difficultyFor(0, { cooking: 300 })).toBe('none'); // was 'full' pre-12c
    expect(difficultyFor(24, { cooking: 300 })).toBe('none');
  });

  it('at the craft content cap the label is none regardless of band (the learning-XP arm)', () => {
    // The four-state curve alone can never reach gray for skillReq 75+
    // (that needs capability past the 125 cap), so without the cap arm a
    // maxed craft would read minimal, or even full for a tier-6 recipe,
    // forever while the applied gain and the character-XP grant are zero.
    expect(difficultyFor(75, { cooking: 125 })).toBe('none'); // was 'minimal'
    expect(difficultyFor(150, { cooking: 125 })).toBe('none'); // was 'full'
    // Just under the cap the recipe still teaches, so the band still shows
    // (124.5 is tier 4: tier 5 begins exactly at the 125 cap, which is why
    // a tier-3 recipe's minimal state only ever existed at the cap itself).
    expect(difficultyFor(150, { cooking: 124.5 })).toBe('full');
    expect(difficultyFor(75, { cooking: 124.5 })).toBe('reduced');
    // Online pre-sync the skills mirror is EMPTY, and empty must never read
    // as capped: with the majors identity the label rides the ordinary curve
    // (full at capability 0) until the first cprof snapshot lands, the same
    // pre-existing transient every difficulty state has. (With a NULL
    // pre-sync identity the rare-ceiling arm reads 'none' for skillReq 75+
    // on its own, so the majors identity is what isolates the cap arm here.)
    expect(
      difficultyFor(
        75,
        {},
        {
          synced: false,
          activeArchetype: 'cooking',
          pairedMajor: 'alchemy',
          hobbyCraft: null,
        },
      ),
    ).toBe('full');
  });

  it('pins the multiplier constants and their four-state difficulty mapping', () => {
    // Constant identity: the view compares against the SAME exported wheel.ts
    // constants the sim gain site consumes, so a curve retune moves the label
    // and the grant together, never one without the other.
    expect(REDUCED_TIER_MULTIPLIER).toBe(0.5);
    expect(MINIMAL_TIER_MULTIPLIER).toBe(0.25);
    expect(tierProgressMultiplier(5, 4)).toBe(REDUCED_TIER_MULTIPLIER);
    expect(tierProgressMultiplier(5, 3)).toBe(MINIMAL_TIER_MULTIPLIER);
    // Each multiplier value drives its own state through a real skills/recipe
    // fixture: cooking 100 is tier-4 capability against recipe tiers 4/3/2/1,
    // multipliers 1 / 0.5 / 0.25 / 0.
    expect(difficultyFor(100, { cooking: 100 })).toBe('full');
    expect(difficultyFor(75, { cooking: 100 })).toBe('reduced');
    expect(difficultyFor(50, { cooking: 100 })).toBe('minimal');
    expect(difficultyFor(25, { cooking: 100 })).toBe('none');
  });

  it('a recipe tier above the ARCHETYPE ceiling is none even when the curve says full', () => {
    // cooking is neither major nor hobby: common (tier 0) ceiling. skillReq 25
    // (tier 1) at exactly tier-1 capability would be full on the curve alone.
    const otherIdentity: CraftingIdentityLike = {
      synced: true,
      activeArchetype: 'alchemy',
      pairedMajor: 'engineering',
      hobbyCraft: 'smelting',
    };
    expect(difficultyFor(25, { cooking: 25 }, otherIdentity)).toBe('none');
    // Hobby craft: rare (tier 2) ceiling. Tier 2 at capability passes, tier 3
    // at capability clamps to none.
    const hobbyIdentity: CraftingIdentityLike = {
      synced: true,
      activeArchetype: 'alchemy',
      pairedMajor: 'engineering',
      hobbyCraft: 'cooking',
    };
    expect(difficultyFor(50, { cooking: 50 }, hobbyIdentity)).toBe('full');
    expect(difficultyFor(75, { cooking: 75 }, hobbyIdentity)).toBe('none');
    // No archetype chosen at all: every craft is capped at rare (tier 2).
    const unchosenIdentity: CraftingIdentityLike = {
      synced: true,
      activeArchetype: null,
      pairedMajor: null,
      hobbyCraft: null,
    };
    expect(difficultyFor(75, { cooking: 75 }, unchosenIdentity)).toBe('none');
  });

  it('difficulty never gates craftable: a none recipe with reagents stays craftable', () => {
    // There is NO skillReq admission gate on crafting (crafting.ts documents
    // that resolveCraft does not read skillReq); difficulty is informational.
    // skillReq 25 (tier 1) at cooking 100 (tier-4 capability) is three tiers
    // below: gray on the curve, so the row reads 'none'.
    const items = table(item('bone_fragments'), item('recipe_none_result'));
    const view = buildCraftingView(
      [{ ...recipe('recipe_none', [{ itemId: 'bone_fragments', count: 1 }]), skillReq: 25 }],
      [{ itemId: 'bone_fragments', count: 1 }],
      items,
      { cooking: 100 },
      majorIdentity,
    );
    expect(view.recipes[0].difficulty).toBe('none');
    expect(view.recipes[0].craftable).toBe(true);
  });

  it('pins equality with the sim skill-gain derivation across the boundary sweep', () => {
    // The view's difficulty must be the EXACT mapping of the multiplier the
    // sim computes at the gainCraftSkill call site (crafting.ts): archetype
    // ceiling alone zeroes, else tierProgressMultiplier off raw capability.
    // Each case also pins the ABSOLUTE bucket so a shared regression in both
    // derivations cannot pass as vacuous equality.
    const otherIdentity: CraftingIdentityLike = {
      synced: true,
      activeArchetype: 'alchemy',
      pairedMajor: 'engineering',
      hobbyCraft: 'smelting',
    };
    const cases: {
      skillReq: number;
      skills: Record<string, number>;
      identity: CraftingIdentityLike;
      expected: CraftDifficulty;
    }[] = [
      // At capability.
      { skillReq: 100, skills: { cooking: 100 }, identity: majorIdentity, expected: 'full' },
      // One below capability.
      { skillReq: 75, skills: { cooking: 100 }, identity: majorIdentity, expected: 'reduced' },
      // Two below capability: the green minimal state
      // (MINIMAL_TIER_MULTIPLIER), its own label since the Stage 5 split.
      { skillReq: 50, skills: { cooking: 100 }, identity: majorIdentity, expected: 'minimal' },
      // Recipe above raw capability: the ordinary climb, full.
      { skillReq: 100, skills: { cooking: 25 }, identity: majorIdentity, expected: 'full' },
      // Recipe tier 0 at a towering capability: the free floor is retired
      // so this is gray (was 'full' before the retire).
      { skillReq: 0, skills: { cooking: 300 }, identity: majorIdentity, expected: 'none' },
      // Ceiling-clamped: curve alone would say full, common ceiling zeroes it.
      { skillReq: 25, skills: { cooking: 25 }, identity: otherIdentity, expected: 'none' },
      // A tier-0 recipe at tier-0 capability stays full under any ceiling
      // (tier 0 is never above tier 0, and zero tiers below is orange).
      { skillReq: 0, skills: {}, identity: otherIdentity, expected: 'full' },
    ];
    for (const c of cases) {
      // The sim derivation, computed with the SAME imported pure functions.
      const ceilingTier = archetypeCeilingFor(
        c.identity.activeArchetype,
        c.identity.pairedMajor,
        'cooking',
        c.identity.hobbyCraft,
      );
      const recipeTier = tierForSkill(c.skillReq);
      const multiplier =
        recipeTier > ceilingTier
          ? 0
          : tierProgressMultiplier(tierCapability(c.skills, 'cooking'), recipeTier);
      const simDerived: CraftDifficulty =
        multiplier === 0
          ? 'none'
          : multiplier === REDUCED_TIER_MULTIPLIER
            ? 'reduced'
            : multiplier === MINIMAL_TIER_MULTIPLIER
              ? 'minimal'
              : 'full';
      const viewDerived = difficultyFor(c.skillReq, c.skills, c.identity);
      expect(viewDerived, `skillReq ${c.skillReq} skills ${JSON.stringify(c.skills)}`).toBe(
        simDerived,
      );
      expect(viewDerived, `skillReq ${c.skillReq} skills ${JSON.stringify(c.skills)}`).toBe(
        c.expected,
      );
    }
  });

  it('while syncing, difficulty computes normally from the empty pre-cprof skills', () => {
    // Chosen behavior, documented here: pre-cprof the same payload carries the
    // skills, so they are empty; difficulty computes normally over them (a
    // tier-0 recipe reads full, a tier-3 recipe reads none under the
    // no-archetype rare ceiling) and stays presentation-neutral, while the
    // LOCKED optimistic craftable behavior is untouched.
    const syncing: CraftingIdentityLike = {
      synced: false,
      activeArchetype: null,
      pairedMajor: null,
      hobbyCraft: null,
    };
    expect(difficultyFor(0, {}, syncing)).toBe('full');
    // Curve still runs over the empty skills: tier 1 at zero capability is the
    // ordinary above-capability climb, full, within the no-archetype ceiling.
    expect(difficultyFor(25, {}, syncing)).toBe('full');
    // Tier 3 sits above the no-archetype rare (tier 2) ceiling: none.
    expect(difficultyFor(75, {}, syncing)).toBe('none');
    const items = table(item('recipe_sync_result'));
    const view = buildCraftingView(
      [{ ...recipe('recipe_sync', []), skillReq: 75 }],
      [],
      items,
      {},
      syncing,
    );
    expect(view.recipes[0].craftable).toBe(true);
  });
});

describe('buildCraftingView station gate (formerly the #1297 hub boolean)', () => {
  function stationRecipe(id: string, reagents: { itemId: string; count: number }[]): RecipeDefLike {
    // The base recipe helper is professionId 'cooking': kitchens is its craft's
    // own station type (STATION_TYPE_BY_CRAFT).
    return { ...recipe(id, reagents), stationType: 'kitchens' };
  }

  it('a station recipe whose type is in the in-range set stays craftable', () => {
    const items = table(item('bone_fragments'), item('recipe_st_result'));
    const view = buildCraftingView(
      [stationRecipe('recipe_st', [{ itemId: 'bone_fragments', count: 1 }])],
      [{ itemId: 'bone_fragments', count: 1 }],
      items,
      {},
      { synced: true, activeArchetype: null, pairedMajor: null, hobbyCraft: null },
      new Set<StationType>(['kitchens']),
    );
    expect(view.recipes[0].station).toEqual({ required: true, type: 'kitchens', inRange: true });
    expect(view.recipes[0].craftable).toBe(true);
  });

  it('a station recipe out of range is not craftable even with every reagent', () => {
    const items = table(item('bone_fragments'), item('recipe_st_result'));
    const view = buildCraftingView(
      [stationRecipe('recipe_st', [{ itemId: 'bone_fragments', count: 1 }])],
      [{ itemId: 'bone_fragments', count: 1 }],
      items,
      {},
      { synced: true, activeArchetype: null, pairedMajor: null, hobbyCraft: null },
      new Set<StationType>(),
    );
    expect(view.recipes[0].station).toEqual({ required: true, type: 'kitchens', inRange: false });
    expect(view.recipes[0].craftable).toBe(false);
  });

  it('the in-range set discriminates per type: a different station in range does not satisfy', () => {
    const items = table(item('bone_fragments'), item('recipe_st_result'));
    const view = buildCraftingView(
      [stationRecipe('recipe_st', [{ itemId: 'bone_fragments', count: 1 }])],
      [{ itemId: 'bone_fragments', count: 1 }],
      items,
      {},
      { synced: true, activeArchetype: null, pairedMajor: null, hobbyCraft: null },
      new Set<StationType>(['forge', 'loom']),
    );
    expect(view.recipes[0].station).toEqual({ required: true, type: 'kitchens', inRange: false });
    expect(view.recipes[0].craftable).toBe(false);
  });

  it('station range and reagents gate independently: in range with short reagents stays blocked', () => {
    const items = table(item('bone_fragments'), item('recipe_st_result'));
    const view = buildCraftingView(
      [stationRecipe('recipe_st', [{ itemId: 'bone_fragments', count: 2 }])],
      [{ itemId: 'bone_fragments', count: 1 }],
      items,
      {},
      { synced: true, activeArchetype: null, pairedMajor: null, hobbyCraft: null },
      new Set<StationType>(['kitchens']),
    );
    expect(view.recipes[0].station).toEqual({ required: true, type: 'kitchens', inRange: true });
    expect(view.recipes[0].craftable).toBe(false);
  });

  it('a recipe without stationType gets a null station and ignores the in-range set', () => {
    const items = table(item('bone_fragments'), item('recipe_free_result'));
    const view = buildCraftingView(
      [recipe('recipe_free', [{ itemId: 'bone_fragments', count: 1 }])],
      [{ itemId: 'bone_fragments', count: 1 }],
      items,
      {},
      { synced: true, activeArchetype: null, pairedMajor: null, hobbyCraft: null },
      new Set<StationType>(),
    );
    expect(view.recipes[0].station).toBeNull();
    expect(view.recipes[0].craftable).toBe(true);
  });

  it('the in-range set defaults to EMPTY (out of range) when omitted', () => {
    // Re-pin: the old boolean defaulted to true; the set default is
    // deliberately conservative, so a caller that forgets to pass it renders
    // a disabled station row rather than a falsely-enabled one.
    const items = table(item('recipe_st_result'));
    const view = buildCraftingView([stationRecipe('recipe_st', [])], [], items);
    expect(view.recipes[0].station).toEqual({ required: true, type: 'kitchens', inRange: false });
    expect(view.recipes[0].craftable).toBe(false);
  });

  it('never mutates any input across the new difficulty and station paths', () => {
    const items = table(item('bone_fragments'), item('recipe_mut_result'));
    const inventory: InvSlot[] = [{ itemId: 'bone_fragments', count: 5 }];
    const recipes = [
      { ...stationRecipe('recipe_mut', [{ itemId: 'bone_fragments', count: 2 }]), skillReq: 75 },
    ];
    const craftSkills = { cooking: 100 };
    const identity: CraftingIdentityLike = {
      synced: true,
      activeArchetype: 'cooking',
      pairedMajor: 'alchemy',
      hobbyCraft: null,
    };
    const snapshots = [inventory, recipes, items, craftSkills, identity].map((v) =>
      JSON.stringify(v),
    );
    buildCraftingView(
      recipes,
      inventory,
      items,
      craftSkills,
      identity,
      new Set<StationType>(['kitchens']),
    );
    const after = [inventory, recipes, items, craftSkills, identity].map((v) => JSON.stringify(v));
    expect(after).toEqual(snapshots);
  });
});

describe('craftLearnHints (discoverability)', () => {
  const trainerRecipeIdsFor = (craft: string): string[] =>
    ALL_RECIPES.filter((r) => r.professionId === craft && r.acquisition?.includes('trainer')).map(
      (r) => r.id,
    );

  it('hints a craft with unlearned trainer recipes at its station and master (positive)', () => {
    // Nothing learned: every stationed craft with a trainer recipe is hinted,
    // naming its station type and resident master.
    const hints = craftLearnHints([], STATIONS);
    expect(trainerRecipeIdsFor('weaponcrafting').length).toBeGreaterThan(0);
    expect(hints.get('weaponcrafting')).toEqual({
      stationType: 'forge',
      masterNpcId: 'forgemistress_darva',
    });
  });

  it('drops the hint once every trainer recipe of the craft is known (fully-trained negative)', () => {
    const known = trainerRecipeIdsFor('weaponcrafting');
    expect(known.length).toBeGreaterThan(0);
    expect(craftLearnHints(known, STATIONS).has('weaponcrafting')).toBe(false);
  });

  it('never hints a craft with no physical station, and stays safe for unknown crafts', () => {
    const hints = craftLearnHints([], []);
    // Every hinted craft resolves to the station type it was paired with.
    for (const [craft, hint] of hints) {
      expect(stationTypeForCraft(craft)).toBe(hint.stationType);
      expect(hint.masterNpcId).toBeTruthy();
    }
    // jewelcrafting has no station master, so it is never hinted even unlearned;
    // a bogus craft id is simply absent (no crash, no entry).
    expect(hints.has('jewelcrafting')).toBe(false);
    expect(hints.has('not-a-craft')).toBe(false);
  });
});

// The crafting window is a MIRROR of the sim's reagent check, so the D8
// downward substitution (a fine grade satisfies a requirement for its base)
// has to reach it or the window refuses crafts the sim performs. That is not
// a cosmetic mismatch: crafting_window.ts disables the Craft button on
// `craftable` and re-guards the click on it, and eastbrook_vale is all tier-1
// veins, so any tier-2 tool stops the plain grade dropping entirely.
describe('buildCraftingView spans material grades', () => {
  const gradeIdentity: CraftingIdentityLike = {
    synced: true,
    activeArchetype: null,
    pairedMajor: null,
    hobbyCraft: null,
  };
  const GRADE_ITEMS = table(
    item('copper_ore'),
    item('fine_copper_ore'),
    item('recipe_grade_result'),
  );
  const gradeRecipe = recipe('recipe_grade', [{ itemId: 'copper_ore', count: 4 }]);

  it('counts a fine grade toward its base, and the Craft button opens', () => {
    const fineOnly: InvSlot[] = [{ itemId: 'fine_copper_ore', count: 4 }];
    const view = buildCraftingView([gradeRecipe], fineOnly, GRADE_ITEMS);
    expect(view.recipes[0].reagents[0]).toMatchObject({ have: 4, required: 4, satisfied: true });
    expect(view.recipes[0].craftable).toBe(true);
  });

  it('a mixed bag sums both grades', () => {
    const mixed: InvSlot[] = [
      { itemId: 'copper_ore', count: 1 },
      { itemId: 'fine_copper_ore', count: 3 },
    ];
    const view = buildCraftingView([gradeRecipe], mixed, GRADE_ITEMS);
    expect(view.recipes[0].reagents[0].have).toBe(4);
    expect(view.recipes[0].craftable).toBe(true);
  });

  it('substitution widens what counts, it does not waive the count', () => {
    const short: InvSlot[] = [{ itemId: 'fine_copper_ore', count: 3 }];
    const view = buildCraftingView([gradeRecipe], short, GRADE_ITEMS);
    expect(view.recipes[0].reagents[0]).toMatchObject({ have: 3, satisfied: false });
    expect(view.recipes[0].craftable).toBe(false);
  });

  it('fineSubstituted states exactly what the spend plan would take from the fine grade', () => {
    // The substitution signal (the UX pass): base short by 3 of 4, so the
    // craft would burn three fine copies, and the row says so.
    const mixed: InvSlot[] = [
      { itemId: 'copper_ore', count: 1 },
      { itemId: 'fine_copper_ore', count: 5 },
    ];
    const mixedView = buildCraftingView([gradeRecipe], mixed, GRADE_ITEMS);
    expect(mixedView.recipes[0].reagents[0]).toMatchObject({
      satisfied: true,
      fineSubstituted: 3,
    });
    // Base fully covers: no warning, even with fine copies in the bag.
    const covered: InvSlot[] = [
      { itemId: 'copper_ore', count: 4 },
      { itemId: 'fine_copper_ore', count: 5 },
    ];
    const coveredView = buildCraftingView([gradeRecipe], covered, GRADE_ITEMS);
    expect(coveredView.recipes[0].reagents[0]).toMatchObject({
      satisfied: true,
      fineSubstituted: 0,
    });
    // Unsatisfied rows warn about nothing (the craft will not run).
    const short: InvSlot[] = [{ itemId: 'fine_copper_ore', count: 3 }];
    const shortView = buildCraftingView([gradeRecipe], short, GRADE_ITEMS);
    expect(shortView.recipes[0].reagents[0].fineSubstituted).toBe(0);
    // Fully substituted (the phase 14 QA's missing arm): zero base held and
    // the fine stock covers the WHOLE bill, so the suffix states the entire
    // requirement.
    const allFine: InvSlot[] = [{ itemId: 'fine_copper_ore', count: 4 }];
    const allFineView = buildCraftingView([gradeRecipe], allFine, GRADE_ITEMS);
    expect(allFineView.recipes[0].reagents[0]).toMatchObject({
      satisfied: true,
      fineSubstituted: 4,
    });
  });

  it('the base never counts toward a FINE reagent (the gate stays one-directional)', () => {
    const fineRecipe = recipe('recipe_fine_only', [{ itemId: 'fine_copper_ore', count: 4 }]);
    const plainOnly: InvSlot[] = [{ itemId: 'copper_ore', count: 8 }];
    const view = buildCraftingView([fineRecipe], plainOnly, GRADE_ITEMS);
    expect(view.recipes[0].reagents[0]).toMatchObject({ have: 0, satisfied: false });
    expect(view.recipes[0].craftable).toBe(false);
  });

  it('a self-signed FINE copy earns the displayed discount, matching what the sim charges', () => {
    // The divergence this closes: the sim widened hasSelfSignedInstance across
    // grades, so a window reading the declared id alone would show 4 while the
    // craft charged 3.
    const signedFine: InvSlot[] = [
      { itemId: 'fine_copper_ore', count: 3, instance: { signer: 'Adventurer' } },
    ];
    const view = buildCraftingView(
      [gradeRecipe],
      signedFine,
      GRADE_ITEMS,
      {},
      gradeIdentity,
      new Set<StationType>(),
      'Adventurer',
    );
    expect(view.recipes[0].reagents[0]).toMatchObject({ required: 3, have: 3, satisfied: true });
    expect(view.recipes[0].craftable).toBe(true);
    // Another player's signature earns nothing, on the fine grade too.
    const tradedFine: InvSlot[] = [
      { itemId: 'fine_copper_ore', count: 3, instance: { signer: 'Someoneelse' } },
    ];
    const traded = buildCraftingView(
      [gradeRecipe],
      tradedFine,
      GRADE_ITEMS,
      {},
      gradeIdentity,
      new Set<StationType>(),
      'Adventurer',
    );
    expect(traded.recipes[0].reagents[0]).toMatchObject({ required: 4, satisfied: false });
  });
});

describe('craftingReagentSig tracks every grade', () => {
  it('a fine grade that no recipe names still moves the signature', () => {
    // fine_copper_ore, fine_ironbark_log and fine_silverleaf_herb are reagents
    // in NO recipe, so a declared-id-only signature would never converge an
    // open window while the player gathered them (#2375).
    const before = craftingReagentSig([], null);
    const after = craftingReagentSig([{ itemId: 'fine_copper_ore', count: 5 }], null);
    expect(after).not.toBe(before);
  });

  it('still ignores an item no recipe consumes in any grade', () => {
    // The QUIET half: widening to grades must not turn the signature into a
    // whole-bag hash that repaints on every grey drop.
    const before = craftingReagentSig([], null);
    const after = craftingReagentSig([{ itemId: 'greyjaw_fang', count: 5 }], null);
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Craft-from-vault availability fold (Bank Storage Phase 04): the view folds
// IWorld.craftVaultStock into `have` through the SAME planReagentSourceDraw
// the sim's admission gate uses, so the Craft button and the server's answer
// cannot diverge in either host.
// ---------------------------------------------------------------------------
describe('buildCraftingView craft-from-vault fold (Phase 04)', () => {
  const IDENTITY: CraftingIdentityLike = {
    synced: true,
    activeArchetype: null,
    pairedMajor: null,
    hobbyCraft: null,
  };
  const build = (
    reagents: { itemId: string; count: number }[],
    inventory: InvSlot[],
    vaultStock: Readonly<Record<string, number>> | null,
  ) =>
    buildCraftingView(
      [recipe('recipe_v', reagents)],
      inventory,
      table(item('copper_ore'), item('fine_copper_ore'), item('recipe_v_result')),
      {},
      IDENTITY,
      new Set(),
      null,
      vaultStock,
    );

  it('folds drawable vault stock into have and reports the vault draw', () => {
    const view = build([{ itemId: 'copper_ore', count: 4 }], [{ itemId: 'copper_ore', count: 1 }], {
      copper_ore: 5,
    });
    const row = view.recipes[0].reagents[0];
    expect(row.have).toBe(6);
    expect(row.satisfied).toBe(true);
    // Carried drains FIRST (1 of 4), the vault covers the remainder.
    expect(row.vaultDrawn).toBe(3);
    expect(row.fineSubstituted).toBe(0);
    expect(view.recipes[0].craftable).toBe(true);
  });

  it('a null vaultStock renders the exact pre-vault row (literal values, not a self-compare)', () => {
    // The default parameter IS null, so comparing the two calls would prove
    // nothing (the coverage audit's F4): pin the literal pre-vault row
    // instead, which the vault fold could only corrupt by changing one of
    // these values.
    const reagents = [{ itemId: 'copper_ore', count: 4 }];
    const inventory: InvSlot[] = [{ itemId: 'copper_ore', count: 1 }];
    const row = build(reagents, inventory, null).recipes[0];
    expect(row.reagents).toEqual([
      {
        itemId: 'copper_ore',
        item: item('copper_ore'),
        required: 4,
        have: 1,
        satisfied: false,
        fineSubstituted: 0,
        vaultDrawn: 0,
      },
    ]);
    expect(row.craftable).toBe(false);
  });

  it('the vault tier walks the SAME grade order, and a vault fine take warns on both axes', () => {
    // Carried holds only the fine grade (2), the vault only the base (3);
    // required 4. Carried tier drains base 0 then fine 2; vault tier covers
    // the remaining 2 from its base rows.
    const view = build(
      [{ itemId: 'copper_ore', count: 4 }],
      [{ itemId: 'fine_copper_ore', count: 2 }],
      { copper_ore: 3 },
    );
    const row = view.recipes[0].reagents[0];
    expect(row.have).toBe(5);
    expect(row.satisfied).toBe(true);
    expect(row.vaultDrawn).toBe(2);
    expect(row.fineSubstituted).toBe(2);
  });

  it('corrupt vault rows are invisible to the fold', () => {
    const view = build([{ itemId: 'copper_ore', count: 1 }], [], { copper_ore: 2.5 });
    const row = view.recipes[0].reagents[0];
    expect(row.have).toBe(0);
    expect(row.satisfied).toBe(false);
    expect(row.vaultDrawn).toBe(0);
  });

  it('an unsatisfied row reports no vault draw (an uncraftable recipe warns about nothing)', () => {
    const view = build([{ itemId: 'copper_ore', count: 4 }], [], { copper_ore: 1 });
    const row = view.recipes[0].reagents[0];
    expect(row.have).toBe(1);
    expect(row.satisfied).toBe(false);
    expect(row.vaultDrawn).toBe(0);
  });
});

describe('craftingReagentSig vault term (Phase 04)', () => {
  it('a drawable vault reagent row changes the signature; {} and null are DISTINCT', () => {
    // PIN MOVED (Phase 04 QA): the original arm pinned {} === null encoding,
    // correct while the view treated the two identically. The QA round's
    // vault-unreachable note renders from blocked-ness (null), so a gate flip
    // with no drawable rows must now repaint: null carries the V!| blocked
    // sentinel, {} does not.
    expect(craftingReagentSig([], null, { fine_copper_ore: 5 })).not.toBe(
      craftingReagentSig([], null, null),
    );
    expect(craftingReagentSig([], null, {})).not.toBe(craftingReagentSig([], null, null));
    expect(craftingReagentSig([], null, null)).toContain('V!|');
    expect(craftingReagentSig([], null, {})).not.toContain('V!|');
  });

  it('corrupt and non-reagent vault rows contribute nothing beyond unblocked-ness', () => {
    // Same pin move as above: the corrupt/non-reagent arms compare against
    // the UNBLOCKED empty stock now, since null carries the blocked sentinel.
    expect(craftingReagentSig([], null, { fine_copper_ore: 2.5 })).toBe(
      craftingReagentSig([], null, {}),
    );
    expect(craftingReagentSig([], null, { greyjaw_fang: 5 })).toBe(
      craftingReagentSig([], null, {}),
    );
  });

  it('the V-prefixed vault term can never collide with a bag term', () => {
    expect(craftingReagentSig([{ itemId: 'fine_copper_ore', count: 5 }], null, null)).not.toBe(
      craftingReagentSig([], null, { fine_copper_ore: 5 }),
    );
  });
});

describe('the vault-unreachable note (Phase 04 QA)', () => {
  const oreRecipe = recipe('recipe_note_probe', [{ itemId: 'copper_ore', count: 3 }]);
  const NOTE_ITEMS = table(item('copper_ore'), item('recipe_note_probe_result'));

  it('derives vaultNote ONLY from blocked-plus-short, each arm decisive', () => {
    const short: InvSlot[] = [{ itemId: 'copper_ore', count: 1 }];
    const enough: InvSlot[] = [{ itemId: 'copper_ore', count: 3 }];
    const base = [
      { synced: true, activeArchetype: null, pairedMajor: null, hobbyCraft: null },
      new Set<never>(),
      null,
    ] as const;
    // Blocked AND short: the one true arm.
    expect(
      buildCraftingView([oreRecipe], short, NOTE_ITEMS, {}, ...base, null, true).vaultNote,
    ).toBe(true);
    // Blocked but everything satisfied: no note (nothing to explain).
    expect(
      buildCraftingView([oreRecipe], enough, NOTE_ITEMS, {}, ...base, null, true).vaultNote,
    ).toBe(false);
    // Short but NOT blocked (open world, empty vault {}): no note.
    expect(
      buildCraftingView([oreRecipe], short, NOTE_ITEMS, {}, ...base, {}, false).vaultNote,
    ).toBe(false);
    // The pre-vault default caller (neither vaultStock nor the flag): never a
    // note, the byte-identity arm's guarantee.
    expect(buildCraftingView([oreRecipe], short, NOTE_ITEMS).vaultNote).toBe(false);
  });
});

describe('cross-reagent tally agreement with the sim gate (Phase 04 review)', () => {
  const IDENTITY: CraftingIdentityLike = {
    synced: true,
    activeArchetype: null,
    pairedMajor: null,
    hobbyCraft: null,
  };

  it('a recipe naming ONE material twice cannot promise the same units to both rows', () => {
    // The sim's planCraftReagentDraw denies this construction (its own suite
    // pins it); an untallied projection would show both rows satisfied off
    // the same five units and enable a Craft the server refuses.
    const view = buildCraftingView(
      [
        recipe('recipe_overlap', [
          { itemId: 'copper_ore', count: 5 },
          { itemId: 'copper_ore', count: 5 },
        ]),
      ],
      [],
      table(item('copper_ore'), item('recipe_overlap_result')),
      {},
      IDENTITY,
      new Set(),
      null,
      { copper_ore: 5 },
    );
    const rows = view.recipes[0].reagents;
    expect(rows[0].satisfied).toBe(true);
    expect(rows[1].satisfied).toBe(false);
    expect(view.recipes[0].craftable).toBe(false);
    // The positive control: stock for BOTH lines admits both rows.
    const full = buildCraftingView(
      [
        recipe('recipe_overlap', [
          { itemId: 'copper_ore', count: 5 },
          { itemId: 'copper_ore', count: 5 },
        ]),
      ],
      [],
      table(item('copper_ore'), item('recipe_overlap_result')),
      {},
      IDENTITY,
      new Set(),
      null,
      { copper_ore: 10 },
    );
    expect(full.recipes[0].reagents.map((r) => r.satisfied)).toEqual([true, true]);
    expect(full.recipes[0].craftable).toBe(true);
  });

  it('CONTENT GUARD: no shipped recipe names one material twice or overlaps grade ladders', () => {
    // The tally above (and the sim's) only CHANGES an answer for overlapping
    // reagents. This guard is the tripwire that makes the first overlapping
    // recipe a reviewed act rather than a silent behavior shift: the day it
    // reds, re-read the Phase 04 tally rationale in buildCraftingView and
    // planCraftReagentDraw before widening it, AND fix the display divergence
    // the tally creates on overlap: `have` is the raw per-item fold while
    // `satisfied` is the tallied plan, so the second overlapping row renders
    // a satisfied-looking "x5/5" count in the .unsat error tint. Expose the
    // tallied remaining on the row (or an explicit shortfall figure) in the
    // same change that ships the first overlapping recipe.
    for (const r of ALL_RECIPES) {
      const seen = new Set<string>();
      for (const reagent of r.reagents) {
        for (const gradeId of materialGradeIds(reagent.itemId)) {
          expect(
            seen.has(gradeId),
            `recipe ${r.id}: grade ${gradeId} reachable from two reagents`,
          ).toBe(false);
          seen.add(gradeId);
        }
      }
    }
  });

  it('CONTENT GUARD: reagent ids keep the grammar the V-prefixed sig term is injective under', () => {
    // craftingReagentSig's vault term prefixes 'V' onto `id:count` pieces; the
    // encoding is collision-proof only because no real id is a bare 'V' or a
    // bare digit (a hypothetical item id 'V' with a bag term could collide
    // with an id '5' vault term). Authored ids are lowercase snake_case, which
    // this pin turns from an assumption into a fact: the day an id breaks the
    // grammar, revisit the sig encoding before shipping it.
    for (const r of ALL_RECIPES) {
      for (const reagent of r.reagents) {
        for (const gradeId of materialGradeIds(reagent.itemId)) {
          expect(gradeId, `id ${gradeId} breaks the lowercase snake_case grammar`).toMatch(
            /^[a-z][a-z0-9_]*$/,
          );
        }
      }
    }
  });
});
