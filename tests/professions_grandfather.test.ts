// THE PHASE 9 GATE: the one-time grandfather union that keeps every
// pre-Phase-9 recipe known to existing characters when the three combo
// recipes flip to trainer-taught acquisition. A hand-frozen LEGACY save
// (no recipesGrandfathered flag, no combo ids) must come out of the load
// path knowing all 21 pre-training recipes and persist the flag; a FRESH
// character must NOT know the combos (the acquisition switch is live).
// Also pins the trained-not-known authoring default for every future recipe.
import { describe, expect, it } from 'vitest';
import { ALL_RECIPES, COMBO_RECIPES, recipeById } from '../src/sim/content/recipes';
import { isRecipeKnown, resolveCraft } from '../src/sim/professions/crafting';
import { grandfatherKnownRecipes, PRE_TRAINING_RECIPE_IDS } from '../src/sim/professions/training';
import { type CharacterState, Sim } from '../src/sim/sim';

// The 21 recipe ids that existed BEFORE Phase 9, as LITERALS (9 common, 6
// tool, 3 caster hub, 3 combo): this list is a historical record and must
// never grow when new recipes are authored, so the pin is spelled out rather
// than derived from content.
const EXPECTED_PRE_TRAINING_IDS = [
  'recipe_eastbrook_arming_sword',
  'recipe_eastbrook_chain_vest',
  'recipe_eastbrook_wool_trousers',
  'recipe_tanned_leather_jerkin',
  'recipe_tough_jerky',
  'recipe_minor_healing_potion',
  'recipe_eastbrook_ritual_vestments',
  'recipe_eastbrook_druids_hide',
  'recipe_eastbrook_warded_leggings',
  'recipe_thorium_mining_pick',
  'recipe_arcanite_mining_pick',
  'recipe_ashwood_axe',
  'recipe_elderwood_axe',
  'recipe_goldleaf_sickle',
  'recipe_sunpetal_sickle',
  'recipe_wardweave_cowl',
  'recipe_duskhide_wraps',
  'recipe_sootscale_mantle',
  'recipe_ironbound_warplate_helm',
  'recipe_forgeguard_bulwark_gauntlets',
  'recipe_volatile_flux_elixir',
];

// A pre-Phase-9 save, frozen by hand: NO recipesGrandfathered flag, NO combo
// ids in knownRecipes (an empty learned set was the normal state before any
// drop/quest acquisition content existed), craft skill present. Only the
// required CharacterState fields plus the ones under test, so this fixture
// also guards the load path's tolerance of sparse legacy rows.
const LEGACY_SAVE = {
  level: 15,
  xp: 0,
  copper: 5000,
  hp: 100,
  resource: 0,
  pos: { x: 0, z: 150 },
  facing: 0,
  equipment: {},
  inventory: [],
  questLog: [],
  questsDone: [],
  craftSkills: { armorcrafting: 30 },
  knownRecipes: [],
} as unknown as CharacterState;

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function metaOf(sim: Sim, pid: number) {
  return (sim as any).players.get(pid);
}

// Deep-copy through JSON so no load can mutate the shared fixture between
// tests (the load path takes ownership of nested arrays).
function legacySave(): CharacterState {
  return JSON.parse(JSON.stringify(LEGACY_SAVE)) as CharacterState;
}

describe('PRE_TRAINING_RECIPE_IDS (the frozen historical record)', () => {
  it('is exactly the 21 literal pre-Phase-9 ids, frozen', () => {
    expect([...PRE_TRAINING_RECIPE_IDS]).toEqual(EXPECTED_PRE_TRAINING_IDS);
    expect(PRE_TRAINING_RECIPE_IDS).toHaveLength(21);
    expect(Object.isFrozen(PRE_TRAINING_RECIPE_IDS)).toBe(true);
  });

  it('every id resolves to a real recipe (no typo can rot the record)', () => {
    for (const id of PRE_TRAINING_RECIPE_IDS) {
      expect(recipeById(id)?.id, id).toBe(id);
    }
  });

  it('trained-not-known default: every recipe OUTSIDE the record carries a non-empty acquisition', () => {
    // The Phase 10+ guard: a new recipe with no acquisition list would be
    // silently known to everyone with no learn step. Today the outside set is
    // empty; the moment content grows, each new entry must carry a list.
    const preTraining = new Set(PRE_TRAINING_RECIPE_IDS);
    for (const recipe of ALL_RECIPES) {
      if (preTraining.has(recipe.id)) continue;
      expect(
        recipe.acquisition && recipe.acquisition.length > 0,
        `${recipe.id} was authored after Phase 9 and must carry a non-empty acquisition list`,
      ).toBe(true);
    }
  });

  it('the three combo recipes carry exactly the trainer acquisition (locked scope)', () => {
    expect(COMBO_RECIPES.map((recipe) => recipe.id)).toEqual([
      'recipe_ironbound_warplate_helm',
      'recipe_forgeguard_bulwark_gauntlets',
      'recipe_volatile_flux_elixir',
    ]);
    for (const recipe of COMBO_RECIPES) {
      expect(recipe.acquisition, recipe.id).toEqual(['trainer']);
    }
    // And no OTHER recipe inside the frozen record gained a list: within the
    // 21 pre-training ids the acquisition switch stays scoped to the combos.
    // Recipes OUTSIDE the record are Phase 10+ content and are required to
    // carry their own non-empty acquisition list (guarded above).
    const preTrainingIds = new Set(PRE_TRAINING_RECIPE_IDS);
    for (const recipe of ALL_RECIPES) {
      if (!preTrainingIds.has(recipe.id) || recipe.comboRequirement) continue;
      expect(
        recipe.acquisition === undefined || recipe.acquisition.length === 0,
        `${recipe.id} must stay grandfathered`,
      ).toBe(true);
    }
  });
});

describe('grandfatherKnownRecipes (pure, idempotent)', () => {
  it('unions the full record when not yet applied and returns true', () => {
    const known = new Set<string>(['recipe_from_a_drop']);
    expect(grandfatherKnownRecipes(known, false)).toBe(true);
    for (const id of PRE_TRAINING_RECIPE_IDS) expect(known.has(id), id).toBe(true);
    expect(known.has('recipe_from_a_drop')).toBe(true); // pre-existing entries survive
    expect(known.size).toBe(22);
  });

  it('is idempotent: a second run changes nothing', () => {
    const known = new Set<string>();
    grandfatherKnownRecipes(known, false);
    const after = [...known].sort();
    expect(grandfatherKnownRecipes(known, false)).toBe(true);
    expect([...known].sort()).toEqual(after);
  });

  it('leaves an already-applied set alone and still returns true', () => {
    const known = new Set<string>();
    expect(grandfatherKnownRecipes(known, true)).toBe(true);
    expect(known.size).toBe(0);
  });
});

describe('legacy save load (the one-time union) and persistence', () => {
  it('loading a pre-Phase-9 save unions all 21 ids and persists recipesGrandfathered true', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Legacy', { state: legacySave() });
    const meta = metaOf(sim, pid);

    expect(meta.recipesGrandfathered).toBe(true);
    for (const id of PRE_TRAINING_RECIPE_IDS) {
      expect(meta.knownRecipes.has(id), id).toBe(true);
      expect(isRecipeKnown(meta, recipeById(id)!), id).toBe(true);
    }

    const state = sim.serializeCharacter(pid);
    expect(state).not.toBeNull();
    expect(state!.recipesGrandfathered).toBe(true);
    expect([...(state!.knownRecipes ?? [])].sort()).toEqual([...PRE_TRAINING_RECIPE_IDS].sort());
  });

  it('re-loading the serialized state changes nothing (round-trip stability)', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Legacy', { state: legacySave() });
    const firstState = sim.serializeCharacter(pid)!;

    const reloaded = makeSim(7);
    const reloadedPid = reloaded.addPlayer('warrior', 'Legacy', { state: firstState });
    const reloadedMeta = metaOf(reloaded, reloadedPid);
    expect([...reloadedMeta.knownRecipes].sort()).toEqual(
      [...(firstState.knownRecipes ?? [])].sort(),
    );
    const secondState = reloaded.serializeCharacter(reloadedPid)!;
    expect(secondState.recipesGrandfathered).toBe(true);
    expect([...(secondState.knownRecipes ?? [])].sort()).toEqual(
      [...(firstState.knownRecipes ?? [])].sort(),
    );
  });

  it('a pre-#1299 save with NO knownRecipes key at all still unions the full record', () => {
    // Even older than the hand-frozen fixture: before knownRecipes existed as
    // a CharacterState key, the load guard's false arm leaves the constructed
    // empty set in place and the union must still land all 21 ids.
    const state = legacySave();
    delete (state as { knownRecipes?: string[] }).knownRecipes;
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Ancient', { state });
    const meta = metaOf(sim, pid);
    expect(meta.recipesGrandfathered).toBe(true);
    for (const id of PRE_TRAINING_RECIPE_IDS) {
      expect(meta.knownRecipes.has(id), id).toBe(true);
    }
  });

  it('the accepted rollback caveat, pinned: an old-code strip of the flag re-unions on return', () => {
    // A full CURRENT-shape blob (not the sparse fixture): serialize a fresh
    // Phase 9 character (flag true, nothing learned), then model the
    // documented old-code round-trip, which rebuilds CharacterState WITHOUT
    // the unknown recipesGrandfathered key while preserving knownRecipes.
    // Returning to new code must re-run the union: the three combos read
    // known fee-free, exactly the state.md release-notes caveat.
    const sim = makeSim();
    const full = sim.serializeCharacter(sim.playerId)!;
    expect(full.recipesGrandfathered).toBe(true);
    delete (full as { recipesGrandfathered?: boolean }).recipesGrandfathered;

    const back = makeSim(11);
    const pid = back.addPlayer('warrior', 'Returned', { state: full });
    const meta = metaOf(back, pid);
    expect(meta.recipesGrandfathered).toBe(true);
    for (const recipe of COMBO_RECIPES) {
      expect(isRecipeKnown(meta, recipe), recipe.id).toBe(true);
    }
  });

  it('a save WITH the flag and an empty knownRecipes stays empty (no re-union)', () => {
    // The flag, not the set contents, decides: a post-Phase-9 character who
    // has learned nothing must never be silently handed the combo recipes.
    const state = legacySave();
    state.recipesGrandfathered = true;
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'PostCut', { state });
    const meta = metaOf(sim, pid);
    expect(meta.recipesGrandfathered).toBe(true);
    expect(meta.knownRecipes.size).toBe(0);
    for (const recipe of COMBO_RECIPES) {
      expect(isRecipeKnown(meta, recipe), recipe.id).toBe(false);
    }
  });
});

describe('fresh characters sit past the cut (the acquisition switch is live)', () => {
  it('a NEW character has recipesGrandfathered true, an empty learned set, and no combo knowledge', () => {
    const sim = makeSim();
    const meta = metaOf(sim, sim.playerId);
    expect(meta.recipesGrandfathered).toBe(true);
    expect(meta.knownRecipes.size).toBe(0);
    for (const recipe of COMBO_RECIPES) {
      expect(isRecipeKnown(meta, recipe), recipe.id).toBe(false);
    }
  });

  it('an untrained fresh player is denied the combo craft with recipe_not_learned', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    const combo = recipeById('recipe_ironbound_warplate_helm')!;
    // Meet every OTHER gate (attunement, pair skill, reagents; the combo
    // admission arm resolves BEFORE knownness) so knownness alone denies.
    sim.acceptArchetypeQuest('armorcrafting');
    meta.craftSkills.armorcrafting = 25;
    meta.craftSkills.weaponcrafting = 25;
    for (let i = 0; i < 4; i++) sim.addItem('bone_fragments', 1, pid);
    for (let i = 0; i < 2; i++) sim.addItem('linen_scrap', 1, pid);

    const result = resolveCraft((sim as any).ctx, pid, combo.id);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('recipe_not_learned');
    expect(sim.countItem(combo.resultItemId, pid)).toBe(0);
    expect(sim.countItem('bone_fragments', pid)).toBe(4); // deny consumed nothing
  });
});
