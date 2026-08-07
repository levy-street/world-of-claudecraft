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
import { ALL_RECIPES, recipeById } from '../src/sim/content/recipes';
import { resolvePatternLearn } from '../src/sim/professions/pattern_items';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { Sim } from '../src/sim/sim';
import type { ItemDef, RecipeItemDef } from '../src/sim/types';
import { Hud } from '../src/ui/hud';
import {
  type RecipePatternViewerInput,
  recipePatternTooltipLines,
  recipePatternTooltipModel,
} from '../src/ui/recipe_pattern_tooltip_view';
import { bareClient } from './helpers/bare_client';

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
    });
    // The model quotes the table, never a second copy of these numbers.
    expect(model?.skillReq).toBe(recipe?.skillReq);
    expect(model?.resultItemId).toBe(recipe?.resultItemId);
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
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
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
    expect(html).not.toContain('Requires');
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

  it('renders the teaches line ALONE before the first cprof snapshot lands', () => {
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
    expect(unsynced).not.toContain('Requires');
    expect(unsynced).not.toContain('You already know');
    // The same state synced renders all three, so the arm above is a real gate.
    const synced = recipePatternTooltipLines(
      pattern(GATED_RECIPE),
      viewer({ knownRecipes: [GATED_RECIPE], craftSkills: { alchemy: 0 } }),
    );
    expect(synced).toContain('Requires');
    expect(synced).toContain('You already know');
  });
});

describe('same input, same output across both IWorld shapes', () => {
  // The pure-core contract from src/ui/CLAUDE.md: the offline Sim projects a
  // freshly built view (copied skill record, SORTED known list) while the
  // online client mirrors a plain wire object, so the core must not depend on
  // either shape. A core reaching for Set.has or a prototype method would pass
  // one arm and fail the other.
  function offlineViewer(skill: number, known: readonly string[]): RecipePatternViewerInput {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
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
