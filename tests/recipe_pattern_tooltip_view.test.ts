// Recipe PATTERN tooltip core: the model resolution plus the three rendered
// lines. English copy is asserted directly (the gather_tool_tooltip.test.ts
// idiom).
//
// The taught recipes are SYNTHETIC, pushed onto the live table in beforeAll and
// removed in afterAll (the tests/recipe_pattern_items.test.ts fixture idiom).
// That is forced, not a shortcut: the view refuses any recipe the content table
// does not mark drop-acquirable, and no shipped recipe carries 'drop' yet
// (phase 11 authors that content), so a real id could only ever pin the
// silence. The silence itself is pinned against a real trainer-only recipe
// below, and the result ITEM ids stay real, so the teaches line still quotes
// the shipped catalog rather than a made-up name.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ALL_RECIPES, recipeById } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { resolvePatternLearn } from '../src/sim/professions/pattern_items';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { Sim } from '../src/sim/sim';
import type { ItemDef, RecipeItemDef } from '../src/sim/types';
import { Hud } from '../src/ui/hud';
import {
  type RecipePatternViewerInput,
  recipePatternTooltipLines,
  recipePatternTooltipModel,
} from '../src/ui/hud/professions/recipe_pattern_tooltip_view';
import { bareClient } from './helpers/bare_client';
import { EMPTY_TEST_WORLD } from './sim_shared';

// An alchemy recipe with a real skill gate and a resolvable result item.
const GATED_RECIPE = 'recipe_tooltip_pattern_gated';
// The same craft gated at 0, for the no-requirement-line arm.
const FREE_RECIPE = 'recipe_tooltip_pattern_free';
// skillReq 60 is deliberately NOT a multiple of TIER_SKILL_STEP: it is the only
// shape that can tell the tier-band derivation apart from a raw `skill >= req`.
const OFF_STEP_RECIPE = 'recipe_tooltip_pattern_off_step';
// skillReq inside tier 0 (1..24), where skill 0 buckets to the SAME tier: the
// only shape that can tell the practiced arm apart from the tier arm.
const SUB_TIER_RECIPE = 'recipe_tooltip_pattern_sub_tier';
// A REAL recipe, and trainer-only like every recipe shipped today: the
// acquisition gate must silence it.
const TRAINER_ONLY_RECIPE = 'recipe_sunpetal_mana_draught';
// The grandfathered shape: NO acquisition key at all (the launch-era recipes
// ship exactly this way), so the view's optional chain is exercised against a
// missing list, not just a trainer-only one.
const NO_LIST_RECIPE = 'recipe_tooltip_pattern_no_list';

function dropRecipe(
  id: string,
  over: Partial<ProfessionRecipeRecord> = {},
): ProfessionRecipeRecord {
  return {
    id,
    professionId: 'alchemy',
    resultItemId: 'sunpetal_mana_draught',
    resultCount: 1,
    reagents: [{ itemId: 'sunpetal_herb', count: 1 }],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
    acquisition: ['drop'],
    ...over,
  };
}

const FIXTURES: ProfessionRecipeRecord[] = [
  dropRecipe(GATED_RECIPE),
  dropRecipe(FREE_RECIPE, {
    professionId: 'weaponcrafting',
    resultItemId: 'eastbrook_arming_sword',
    skillReq: 0,
  }),
  dropRecipe(OFF_STEP_RECIPE, { skillReq: 60 }),
  dropRecipe(SUB_TIER_RECIPE, { skillReq: 10 }),
  // Hand-built, not dropRecipe(): the grandfathered arm needs the acquisition
  // KEY absent, which a Partial spread cannot express.
  {
    id: NO_LIST_RECIPE,
    professionId: 'alchemy',
    resultItemId: 'sunpetal_mana_draught',
    resultCount: 1,
    reagents: [{ itemId: 'sunpetal_herb', count: 1 }],
    skillReq: 50,
    itemLevelBudget: 20,
    level: 20,
  },
];

beforeAll(() => {
  ALL_RECIPES.push(...FIXTURES);
});

afterAll(() => {
  for (const recipe of FIXTURES) {
    const at = ALL_RECIPES.indexOf(recipe);
    if (at >= 0) ALL_RECIPES.splice(at, 1);
  }
});

function pattern(teachesRecipeId: string): RecipeItemDef {
  return {
    id: `pattern_${teachesRecipeId}`,
    name: 'Test Pattern',
    kind: 'recipe',
    quality: 'uncommon',
    sellValue: 100,
    teachesRecipeId,
  };
}

function viewer(over: Partial<RecipePatternViewerInput> = {}): RecipePatternViewerInput {
  return { synced: true, knownRecipes: [], craftSkills: {}, ...over };
}

describe('collection manual and enchant formula tooltips', () => {
  it('shows every taught slot and stays learnable when only the first recipe is known', () => {
    const item = ITEMS.pattern_crucible_str_mail;
    const state = viewer({
      craftSkills: { armorcrafting: 100 },
      knownRecipes: ['recipe_crucible_str_mail_chest'],
    });
    const model = recipePatternTooltipModel(item, state);
    expect(model?.known).toBe(false);
    expect(model?.resultItemIds).toEqual([
      'crucible_str_mail_chest',
      'crucible_str_mail_waist',
      'crucible_str_mail_feet',
    ]);
    const html = recipePatternTooltipLines(item, state);
    expect(html).toContain('Crucible Striker&#39;s Hauberk');
    expect(html).toContain('Crucible Striker&#39;s Girdle');
    expect(html).toContain('Crucible Striker&#39;s Sabatons');
    expect(html).not.toContain('You already know that recipe.');
  });

  it('calls a whole collection known only when all three recipes are known', () => {
    const knownRecipes = ['chest', 'waist', 'feet'].map(
      (slot) => `recipe_crucible_str_mail_${slot}`,
    );
    expect(
      recipePatternTooltipModel(ITEMS.pattern_crucible_str_mail, viewer({ knownRecipes }))?.known,
    ).toBe(true);
  });

  it('previews the enchant formula and its real enchanting skill requirement', () => {
    const item = ITEMS.formula_lastflame_zeal;
    const model = recipePatternTooltipModel(item, viewer({ craftSkills: { enchanting: 100 } }));
    expect(model).toMatchObject({
      enchantId: 'enchant_weapon_lastflame_zeal',
      professionId: 'enchanting',
      skillReq: 100,
      skillMet: true,
      known: false,
    });
    const html = recipePatternTooltipLines(item, viewer({ craftSkills: { enchanting: 99 } }));
    expect(html).toContain('Last Flame');
    expect(html).toContain('Enchanting');
    expect(html).toContain('100');
    expect(html).toContain('tt-red');
    expect(html).not.toContain('how to craft');
  });
});

describe('recipePatternTooltipModel', () => {
  it('resolves the taught recipe off the live table', () => {
    const recipe = recipeById(GATED_RECIPE);
    expect(recipe).toBeDefined();
    const model = recipePatternTooltipModel(pattern(GATED_RECIPE), viewer());
    expect(model).toEqual({
      recipeId: GATED_RECIPE,
      resultItemId: 'sunpetal_mana_draught',
      professionId: 'alchemy',
      skillReq: 50,
      skillMet: false,
      known: false,
      reagents: [[{ itemId: 'sunpetal_herb', count: 1 }]],
    });
    // The model quotes the table, never a second copy of these numbers.
    expect(model?.skillReq).toBe(recipe?.skillReq);
    expect(model?.resultItemId).toBe(recipe?.resultItemId);
    expect(model?.reagents[0]).toBe(recipe?.reagents);
  });

  it('answers null for every non-pattern kind', () => {
    const potion: ItemDef = {
      id: 'qa_potion',
      name: 'QA Potion',
      kind: 'potion',
      quality: 'common',
      sellValue: 1,
    };
    expect(recipePatternTooltipModel(potion, viewer())).toBeNull();
    expect(recipePatternTooltipLines(potion, viewer())).toBe('');
  });

  it('answers null for a teachesRecipeId this bundle cannot resolve', () => {
    // The R34 stale-client arm: no invented line for unknown content.
    expect(recipePatternTooltipModel(pattern('recipe_from_a_newer_build'), viewer())).toBeNull();
    expect(recipePatternTooltipLines(pattern('recipe_from_a_newer_build'), viewer())).toBe('');
  });

  it('answers null for a recipe no drop may teach, matching the sim silent refusal', () => {
    // The acquisition gate, pinned against REAL shipped content: every recipe
    // in the table today is trainer-only, and resolvePatternLearn refuses such
    // a pattern with no message at all, so the hover must not describe a click
    // that does nothing. This arm flips the day phase 11 authors drop content
    // for this id, which is the moment the pin should be re-pointed.
    const real = recipeById(TRAINER_ONLY_RECIPE);
    expect(real?.acquisition).toEqual(['trainer']);
    expect(recipePatternTooltipModel(pattern(TRAINER_ONLY_RECIPE), viewer())).toBeNull();
    expect(recipePatternTooltipLines(pattern(TRAINER_ONLY_RECIPE), viewer())).toBe('');
  });

  it('answers null for a recipe with no acquisition list at all (grandfathered)', () => {
    // The launch-era shape: no list, known to everyone, nothing a pattern
    // could teach. The optional chain must answer null exactly like the sim's
    // silent click, never throw over the missing key.
    const fixture = recipeById(NO_LIST_RECIPE);
    expect(fixture).toBeDefined();
    expect(fixture && 'acquisition' in fixture).toBe(false);
    expect(recipePatternTooltipModel(pattern(NO_LIST_RECIPE), viewer())).toBeNull();
    expect(recipePatternTooltipLines(pattern(NO_LIST_RECIPE), viewer())).toBe('');
  });

  it('reads skillMet off the viewer craft skill, per craft', () => {
    const under = recipePatternTooltipModel(
      pattern(GATED_RECIPE),
      viewer({ craftSkills: { alchemy: 49 } }),
    );
    const exact = recipePatternTooltipModel(
      pattern(GATED_RECIPE),
      viewer({ craftSkills: { alchemy: 50 } }),
    );
    // A different craft's skill must not satisfy an alchemy gate.
    const wrongCraft = recipePatternTooltipModel(
      pattern(GATED_RECIPE),
      viewer({ craftSkills: { tailoring: 300 } }),
    );
    expect(under?.skillMet).toBe(false);
    expect(exact?.skillMet).toBe(true);
    expect(wrongCraft?.skillMet).toBe(false);
  });

  it('derives skillMet from the tier bands the learn gate uses, not a raw compare', () => {
    // skillReq 60 sits inside tier 2 (25-wide bands), so skill 50 is already at
    // tier 2 and professions/training.ts teachTierMet says yes. A raw
    // `50 >= 60` would paint this hover red for a crafter the sim will teach,
    // which is the exact drift this derivation exists to prevent. Skill 49
    // (tier 1) is the negative half, so the assertion is not vacuous.
    const atBand = recipePatternTooltipModel(
      pattern(OFF_STEP_RECIPE),
      viewer({ craftSkills: { alchemy: 50 } }),
    );
    const belowBand = recipePatternTooltipModel(
      pattern(OFF_STEP_RECIPE),
      viewer({ craftSkills: { alchemy: 49 } }),
    );
    expect(atBand?.skillReq).toBe(60);
    expect(atBand?.skillMet).toBe(true);
    expect(belowBand?.skillMet).toBe(false);
  });

  it('agrees with resolvePatternLearn cell for cell across the skill matrix', () => {
    // The coupling assertion the module header promises: hover (skillMet) and
    // click (the sim resolver) may never disagree for a viewer who does not
    // yet know the recipe. The view re-derives the tier band rather than
    // calling teachTierMet, so this matrix is what keeps the two formulas one:
    // mutate either side (a raw skill >= skillReq in training.ts, or a
    // band-free compare in the view) and a cell reds. Recipes cover on-step
    // (50), off-step (60), sub-tier (10), and free (0) gates; skills straddle
    // every band edge those gates can meet.
    // EMPTY_TEST_WORLD (the gate-perf trim): both Sim builds here only read
    // craft skills and known recipes off a fresh player, never a camp, npc,
    // or ground object.
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      world: EMPTY_TEST_WORLD,
    });
    const pid = sim.addPlayer('warrior', 'Matrix');
    const meta = sim.meta(pid);
    if (!meta) throw new Error('missing meta');
    for (const recipeId of [GATED_RECIPE, FREE_RECIPE, OFF_STEP_RECIPE, SUB_TIER_RECIPE]) {
      const recipe = recipeById(recipeId);
      if (!recipe) throw new Error(`missing fixture ${recipeId}`);
      for (const skill of [0, 1, 24, 25, 49, 50, 59, 60, 74, 75, 100]) {
        meta.craftSkills[recipe.professionId] = skill;
        const model = recipePatternTooltipModel(
          pattern(recipeId),
          viewer({ craftSkills: { [recipe.professionId]: skill } }),
        );
        expect(model, `${recipeId} at skill ${skill}`).not.toBeNull();
        expect(model?.skillMet, `${recipeId} at skill ${skill}`).toBe(
          resolvePatternLearn(recipe, meta).ok,
        );
      }
    }
  });

  it('refuses a never-practiced craft even when the tier band alone would pass', () => {
    // resolvePatternLearn's `profession` arm, mirrored: skillReq 10 buckets to
    // tier 0, and so does skill 0, so the tier comparison ALONE says yes to a
    // character who has never touched alchemy and whose click the sim refuses.
    // Skill 1 is the same tier and the same requirement, differing only in the
    // practiced arm, so this pair isolates that arm and nothing else.
    const unpracticed = recipePatternTooltipModel(
      pattern(SUB_TIER_RECIPE),
      viewer({ craftSkills: { alchemy: 0 } }),
    );
    const practiced = recipePatternTooltipModel(
      pattern(SUB_TIER_RECIPE),
      viewer({ craftSkills: { alchemy: 1 } }),
    );
    expect(unpracticed?.skillReq).toBe(10);
    expect(unpracticed?.skillMet).toBe(false);
    expect(practiced?.skillMet).toBe(true);
    // An absent craft key reads the same as an explicit 0 (hasOwn-safe read).
    expect(recipePatternTooltipModel(pattern(SUB_TIER_RECIPE), viewer())?.skillMet).toBe(false);
  });

  it('reads known off the viewer known-recipe list', () => {
    expect(
      recipePatternTooltipModel(pattern(GATED_RECIPE), viewer({ knownRecipes: [GATED_RECIPE] }))
        ?.known,
    ).toBe(true);
    expect(
      recipePatternTooltipModel(pattern(GATED_RECIPE), viewer({ knownRecipes: [FREE_RECIPE] }))
        ?.known,
    ).toBe(false);
  });
});

describe('recipePatternTooltipLines', () => {
  it('states what the pattern teaches, in the item name, not the recipe id', () => {
    const html = recipePatternTooltipLines(pattern(GATED_RECIPE), viewer());
    expect(html).toContain(
      '<div class="tt-desc">Use: Teaches you how to craft Sunpetal Mana Draught.</div>',
    );
    expect(html).not.toContain(GATED_RECIPE);
  });

  it('paints the requirement line red below the gate and plain at or above it', () => {
    expect(recipePatternTooltipLines(pattern(GATED_RECIPE), viewer())).toContain(
      '<div class="tt-red">Requires Alchemy 50</div>',
    );
    expect(
      recipePatternTooltipLines(pattern(GATED_RECIPE), viewer({ craftSkills: { alchemy: 50 } })),
    ).toContain('<div class="tt-sub">Requires Alchemy 50</div>');
  });

  it('paints the requirement line red for a never-practiced craft inside tier 0', () => {
    // The rendered half of the practiced arm: same recipe, same requirement,
    // and the ONLY difference is one point of alchemy. Without that arm both
    // sides render tt-sub and the unpracticed viewer reads a plain requirement
    // for a click that answers "You have not practiced that profession."
    expect(
      recipePatternTooltipLines(pattern(SUB_TIER_RECIPE), viewer({ craftSkills: { alchemy: 0 } })),
    ).toContain('<div class="tt-red">Requires Alchemy 10</div>');
    expect(
      recipePatternTooltipLines(pattern(SUB_TIER_RECIPE), viewer({ craftSkills: { alchemy: 1 } })),
    ).toContain('<div class="tt-sub">Requires Alchemy 10</div>');
  });

  it('renders no requirement line for a recipe gated at 0', () => {
    const html = recipePatternTooltipLines(pattern(FREE_RECIPE), viewer());
    expect(html).toContain('Use: Teaches you how to craft');
    // Scoped to the skill line: the materials line below says "Requires:" too.
    expect(html).not.toContain('Requires Weaponcrafting');
    expect(html).not.toContain('tt-red');
  });

  it('adds the trainer already-known line only when the recipe is known', () => {
    const unknown = recipePatternTooltipLines(pattern(GATED_RECIPE), viewer());
    const known = recipePatternTooltipLines(
      pattern(GATED_RECIPE),
      viewer({ knownRecipes: [GATED_RECIPE] }),
    );
    expect(unknown).not.toContain('You already know that recipe.');
    // The trainer's own wording, reused rather than reworded, and now the same
    // sentence the sim's own refusal raises on the click.
    expect(known).toContain('<div class="tt-red">You already know that recipe.</div>');
  });

  it('orders the block teaches, then requirement, then known', () => {
    // The hover reads top-down as what it grants, what it costs in skill, and
    // whether it is already spent; a reordered block would bury the refusal.
    const html = recipePatternTooltipLines(
      pattern(GATED_RECIPE),
      viewer({ knownRecipes: [GATED_RECIPE] }),
    );
    const teaches = html.indexOf('Teaches you');
    const requires = html.indexOf('Requires Alchemy');
    const known = html.indexOf('You already know');
    expect(teaches).toBeGreaterThanOrEqual(0);
    expect(requires).toBeGreaterThan(teaches);
    expect(known).toBeGreaterThan(requires);
  });

  it('renders no viewer-gated line before the first cprof snapshot lands', () => {
    // An online client's craftSkills and knownRecipes are empty defaults until
    // that snapshot arrives, so both gated lines would be answering off state
    // the client does not have. The viewer here deliberately carries state that
    // WOULD produce both lines, proving the suppression is the synced flag and
    // not merely empty inputs.
    const unsynced = recipePatternTooltipLines(
      pattern(GATED_RECIPE),
      viewer({ synced: false, knownRecipes: [GATED_RECIPE], craftSkills: { alchemy: 0 } }),
    );
    expect(unsynced).toContain('Use: Teaches you how to craft Sunpetal Mana Draught.');
    expect(unsynced).not.toContain('Requires Alchemy');
    expect(unsynced).not.toContain('You already know');
    // What the pattern makes is static content, not viewer state, so the
    // materials line still renders unsynced.
    expect(unsynced).toContain('Requires: Sunpetal Herb x1');
    // The same state synced renders all three, so the arm above is a real gate.
    const synced = recipePatternTooltipLines(
      pattern(GATED_RECIPE),
      viewer({ knownRecipes: [GATED_RECIPE], craftSkills: { alchemy: 0 } }),
    );
    expect(synced).toContain('Requires Alchemy');
    expect(synced).toContain('You already know');
  });
});

describe('what the taught recipe makes', () => {
  // The player-facing ask: a pattern must say what its product IS and DOES,
  // not only its name. The host renders the product card; a stub stands in
  // here so the pure core's placement and gating are pinned on their own.
  const card = (product: ItemDef) => `<div class="stub-card">${product.id}</div>`;

  it('embeds the product card and its materials below the gate lines', () => {
    const html = recipePatternTooltipLines(
      pattern(GATED_RECIPE),
      viewer({ knownRecipes: [GATED_RECIPE] }),
      card,
    );
    expect(html).toContain(
      '<div class="tt-recipe-product"><div class="stub-card">sunpetal_mana_draught</div>' +
        '<div class="tt-sub">Requires: Sunpetal Herb x1</div></div>',
    );
    // Reads top-down: teaches, skill gate, known, then what it makes.
    const known = html.indexOf('You already know');
    expect(known).toBeGreaterThan(html.indexOf('Requires Alchemy'));
    expect(html.indexOf('tt-recipe-product')).toBeGreaterThan(known);
  });

  it('still lists the materials when the host supplies no card renderer', () => {
    const html = recipePatternTooltipLines(pattern(GATED_RECIPE), viewer());
    expect(html).toContain(
      '<div class="tt-recipe-product"><div class="tt-sub">Requires: Sunpetal Herb x1</div></div>',
    );
  });

  it('lists every reagent with its count, in recipe order', () => {
    const recipe = recipeById('recipe_crucible_str_mail_chest');
    if (!recipe) throw new Error('missing crucible recipe');
    const html = recipePatternTooltipLines(ITEMS.pattern_crucible_str_mail, viewer());
    for (const reagent of recipe.reagents) {
      expect(html).toContain(`${ITEMS[reagent.itemId].name} x${reagent.count}`);
    }
  });

  it('gives a collection manual one product block per taught recipe', () => {
    const html = recipePatternTooltipLines(ITEMS.pattern_crucible_str_mail, viewer(), card);
    expect(html.match(/class="tt-recipe-product"/g)?.length).toBe(3);
    const chest = html.indexOf('crucible_str_mail_chest</div>');
    const waist = html.indexOf('crucible_str_mail_waist</div>');
    const feet = html.indexOf('crucible_str_mail_feet</div>');
    expect(chest).toBeGreaterThan(-1);
    expect(waist).toBeGreaterThan(chest);
    expect(feet).toBeGreaterThan(waist);
  });

  it('asks every manual card but the last to omit the shared set block', () => {
    // The three crucible pieces share one set: its bonuses must read once,
    // on the last card, not three times down one tooltip.
    const calls: Array<[string, boolean]> = [];
    recipePatternTooltipLines(ITEMS.pattern_crucible_str_mail, viewer(), (product, omitSet) => {
      calls.push([product.id, omitSet]);
      return '';
    });
    expect(ITEMS.crucible_str_mail_chest.set).toBeTruthy();
    expect(calls).toEqual([
      ['crucible_str_mail_chest', true],
      ['crucible_str_mail_waist', true],
      ['crucible_str_mail_feet', false],
    ]);
    // A single-product pattern always keeps its set block.
    const single: boolean[] = [];
    recipePatternTooltipLines(pattern(GATED_RECIPE), viewer(), (_product, omitSet) => {
      single.push(omitSet);
      return '';
    });
    expect(single).toEqual([false]);
  });

  it('never embeds a card for a product that is itself a pattern', () => {
    const id = 'recipe_tooltip_pattern_nested';
    const nested = dropRecipe(id, { resultItemId: 'pattern_spiritweld_girdle' });
    ALL_RECIPES.push(nested);
    try {
      expect(ITEMS.pattern_spiritweld_girdle?.kind).toBe('recipe');
      const html = recipePatternTooltipLines(pattern(id), viewer(), card);
      expect(html).not.toContain('stub-card');
      expect(html).toContain('Requires: Sunpetal Herb x1');
    } finally {
      ALL_RECIPES.splice(ALL_RECIPES.indexOf(nested), 1);
    }
  });

  it('states what a formula enchant does, then its materials, and never calls the card', () => {
    const html = recipePatternTooltipLines(ITEMS.formula_lastflame_zeal, viewer(), () => {
      throw new Error('a formula has no product item to render');
    });
    expect(html).toContain(
      '<div class="tt-green">Your landed melee attacks can grant 50 Strength for 15 sec',
    );
    expect(html).toContain('Requires: Core of the Last Flame x3');
    expect(html.indexOf('tt-green')).toBeGreaterThan(html.indexOf('Teaches you how to apply'));
  });

  it('states a stat formula as one green line per stat axis', () => {
    // The non-proc formula arm. No shipped stat enchant is drop-taught, so a
    // REAL id (its name key exists) is swapped for a drop-taught two-axis copy
    // and restored afterwards.
    const id = 'enchant_weapon_might';
    const real = ENCHANTS[id];
    ENCHANTS[id] = {
      ...real,
      reagents: [{ itemId: 'sunpetal_herb', count: 2 }],
      statBonus: { sta: 6, int: 4 },
      acquisition: 'drop',
    };
    try {
      const formula: RecipeItemDef = { ...pattern(id), teachesEnchantId: id };
      const html = recipePatternTooltipLines(formula, viewer());
      expect(html).toContain('<div class="tt-green">+6 Stamina</div>');
      expect(html).toContain('<div class="tt-green">+4 Intellect</div>');
      expect(html).toContain('Requires: Sunpetal Herb x2');
      expect(html.indexOf('+6 Stamina')).toBeLessThan(html.indexOf('+4 Intellect'));
    } finally {
      ENCHANTS[id] = real;
    }
  });

  it('skips a reagent this bundle has no item for, and never paints an empty block', () => {
    const id = 'recipe_tooltip_pattern_unknown_reagent';
    const onlyUnknown = 'recipe_tooltip_pattern_only_unknown';
    const fixtures = [
      dropRecipe(id, {
        reagents: [
          { itemId: 'qa_no_such_reagent', count: 3 },
          { itemId: 'sunpetal_herb', count: 1 },
        ],
      }),
      dropRecipe(onlyUnknown, { reagents: [{ itemId: 'qa_no_such_reagent', count: 3 }] }),
    ];
    ALL_RECIPES.push(...fixtures);
    try {
      const html = recipePatternTooltipLines(pattern(id), viewer());
      expect(html).toContain('Requires: Sunpetal Herb x1</div>');
      expect(html).not.toContain('qa_no_such_reagent');
      // No card renderer and no printable reagent: nothing to wrap.
      expect(recipePatternTooltipLines(pattern(onlyUnknown), viewer())).not.toContain(
        'tt-recipe-product',
      );
    } finally {
      for (const recipe of fixtures) ALL_RECIPES.splice(ALL_RECIPES.indexOf(recipe), 1);
    }
  });

  it('adds nothing for a non-pattern def', () => {
    expect(recipePatternTooltipLines(ITEMS.sunpetal_mana_draught, viewer(), card)).toBe('');
  });
});

describe('same input, same output across both IWorld shapes', () => {
  // The pure-core contract from src/ui/CLAUDE.md: the offline Sim projects a
  // freshly built view (copied skill record, SORTED known list) while the
  // online client mirrors a plain wire object, so the core must not depend on
  // either shape. A core reaching for Set.has or a prototype method would pass
  // one arm and fail the other.
  function offlineViewer(skill: number, known: readonly string[]): RecipePatternViewerInput {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      world: EMPTY_TEST_WORLD,
    });
    const pid = sim.addPlayer('warrior', 'Patternist');
    const meta = sim.meta(pid);
    if (!meta) throw new Error('missing meta');
    meta.craftSkills.alchemy = skill;
    for (const id of known) meta.knownRecipes.add(id);
    return sim.craftingIdentityFor(pid);
  }

  function mirrorViewer(skill: number, known: readonly string[]): RecipePatternViewerInput {
    const client = bareClient(7);
    // The shape applySnapshot stamps on a cprof delta: a plain object, a plain
    // record, a plain array.
    client.craftingIdentity = {
      ...client.craftingIdentity,
      synced: true,
      craftSkills: { alchemy: skill },
      knownRecipes: [...known],
    };
    return client.craftingIdentity;
  }

  const CASES: Array<[string, number, readonly string[]]> = [
    ['unpracticed and unknown', 0, []],
    ['at the gate, unknown', 50, []],
    ['known, and the list carries an unrelated id too', 50, [FREE_RECIPE, GATED_RECIPE]],
  ];

  it.each(CASES)('renders identical lines for %s', (_label, skill, known) => {
    const item = pattern(GATED_RECIPE);
    const offline = recipePatternTooltipLines(item, offlineViewer(skill, known));
    const mirror = recipePatternTooltipLines(item, mirrorViewer(skill, known));
    // Non-vacuous: every case renders at least the teaches line.
    expect(offline).toContain('Teaches you how to craft');
    expect(mirror).toBe(offline);
    expect(recipePatternTooltipModel(item, mirrorViewer(skill, known))).toEqual(
      recipePatternTooltipModel(item, offlineViewer(skill, known)),
    );
  });
});

describe('reachability through the real Hud tooltip', () => {
  // The lines above are only worth pinning if the coordinator actually composes
  // them. Drive the REAL Hud.itemTooltip on a prototype-only instance (the
  // tests/masterwrought_tooltip.test.ts rig) with a kind:'recipe' def, so an
  // unwired or wrongly-gated call site fails here rather than shipping a
  // pattern whose hover says only "Uncommon Pattern".
  function hudTooltip(item: ItemDef, craftingIdentity: RecipePatternViewerInput): string {
    const hud = Object.create(Hud.prototype) as unknown as {
      sim: {
        player: { level: number };
        cfg: { playerClass: string };
        equipment: Record<string, string>;
        craftingIdentity: RecipePatternViewerInput;
      };
      itemTooltip(item: ItemDef, compare?: boolean): string;
    };
    hud.sim = {
      player: { level: 80 },
      cfg: { playerClass: 'warrior' },
      equipment: {},
      craftingIdentity,
    };
    return hud.itemTooltip(item, false);
  }

  it('renders the teaches line for a pattern def', () => {
    const html = hudTooltip(pattern(GATED_RECIPE), viewer());
    expect(html).toContain('Use: Teaches you how to craft Sunpetal Mana Draught.');
  });

  it('renders the red requirement and known lines through the same call', () => {
    const html = hudTooltip(
      pattern(GATED_RECIPE),
      viewer({ knownRecipes: [GATED_RECIPE], craftSkills: { alchemy: 0 } }),
    );
    expect(html).toContain('<div class="tt-red">Requires Alchemy 50</div>');
    expect(html).toContain('<div class="tt-red">You already know that recipe.</div>');
  });

  it('embeds the REAL product item card, so the pattern states what it makes', () => {
    const html = hudTooltip(pattern(GATED_RECIPE), viewer());
    const block = html.slice(html.indexOf('<div class="tt-recipe-product">'));
    expect(block.length).toBeLessThan(html.length);
    // The potion's own use line, from the same builder its bag tooltip uses.
    expect(block).toContain('Use: Instantly restores 425 mana.');
    expect(block).toContain('Requires: Sunpetal Herb x1');
    // The embedded card is compare-free: no second "Currently Equipped" block.
    expect(block).not.toContain('tt-cmp');
  });

  it('renders a manual set block once, on its last embedded card', () => {
    const html = hudTooltip(ITEMS.pattern_crucible_str_mail, viewer());
    expect(html.match(/class="tt-recipe-product"/g)?.length).toBe(3);
    expect(html.match(/class="tt-set-name"/g)?.length).toBe(1);
    expect(html.indexOf('tt-set-name')).toBeGreaterThan(html.lastIndexOf('tt-recipe-product'));
  });

  it('keeps sell price and stack cap off the embedded card, so they read as the pattern', () => {
    // A stackable, sellable product: its own card states both lines when
    // hovered directly, and the pattern's embedded copy must state neither.
    const product = hudTooltip(ITEMS.sunpetal_mana_draught, viewer());
    const html = hudTooltip(pattern(GATED_RECIPE), viewer());
    const start = html.indexOf('<div class="tt-recipe-product">');
    const end = html.indexOf('Requires: Sunpetal Herb x1', start);
    const card = html.slice(start, end);
    expect(product).toContain('Sell price:');
    expect(card).not.toContain('Sell price:');
    expect(product).toContain('Max stack:');
    expect(card).not.toContain('Max stack:');
    // The pattern still states its OWN price, after the product block.
    expect(html.lastIndexOf('Sell price:')).toBeGreaterThan(end);
  });

  it('adds nothing pattern-shaped for a non-pattern def', () => {
    const potion: ItemDef = {
      id: 'qa_potion_reach',
      name: 'QA Potion',
      kind: 'potion',
      quality: 'common',
      sellValue: 1,
    };
    expect(hudTooltip(potion, viewer())).not.toContain('Teaches you');
  });
});
