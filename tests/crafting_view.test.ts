import { describe, expect, it } from 'vitest';
import { archetypeCeilingFor } from '../src/sim/professions/archetype';
import type { StationType } from '../src/sim/professions/stations';
import { tierCapability, tierForSkill, tierProgressMultiplier } from '../src/sim/professions/wheel';
import type { InvSlot, ItemDef } from '../src/sim/types';
import {
  buildCraftingView,
  type CraftDifficulty,
  type CraftingIdentityLike,
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

// Phase 6 (#2037): skill-req line, skill-gain difficulty, and the station
// gate (per-type since Phase 8) on the rows model.
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

  it('full at or above raw capability (this is how capability advances)', () => {
    // At capability: skill 100 (tier 4) vs skillReq 100 (tier 4).
    expect(difficultyFor(100, { cooking: 100 })).toBe('full');
    // Above capability: skill 50 (tier 2) vs skillReq 100 (tier 4).
    expect(difficultyFor(100, { cooking: 50 })).toBe('full');
  });

  it('reduced one tier below capability, none two or more below', () => {
    expect(difficultyFor(75, { cooking: 100 })).toBe('reduced');
    expect(difficultyFor(50, { cooking: 100 })).toBe('none');
    expect(difficultyFor(25, { cooking: 100 })).toBe('none');
  });

  it('the common tier is a free floor: full regardless of capability', () => {
    expect(difficultyFor(0, { cooking: 300 })).toBe('full');
    expect(difficultyFor(24, { cooking: 300 })).toBe('full');
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
    const items = table(item('bone_fragments'), item('recipe_none_result'));
    const view = buildCraftingView(
      [{ ...recipe('recipe_none', [{ itemId: 'bone_fragments', count: 1 }]), skillReq: 50 }],
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
      // Two below capability.
      { skillReq: 50, skills: { cooking: 100 }, identity: majorIdentity, expected: 'none' },
      // Recipe above raw capability: the ordinary climb, full.
      { skillReq: 100, skills: { cooking: 25 }, identity: majorIdentity, expected: 'full' },
      // Recipe tier 0 free floor, however high the capability.
      { skillReq: 0, skills: { cooking: 300 }, identity: majorIdentity, expected: 'full' },
      // Ceiling-clamped: curve alone would say full, common ceiling zeroes it.
      { skillReq: 25, skills: { cooking: 25 }, identity: otherIdentity, expected: 'none' },
      // Ceiling-clamped free floor stays full (tier 0 is never above tier 0).
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
        multiplier === 0 ? 'none' : multiplier === 1 ? 'full' : 'reduced';
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

describe('buildCraftingView station gate (Phase 8, formerly the #1297 hub boolean)', () => {
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
    // Phase 8 re-pin: the old boolean defaulted to true; the set default is
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
