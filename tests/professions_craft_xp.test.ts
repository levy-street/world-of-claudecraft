// Learning-coupled craft character XP: a successful craft grants
// character XP only in proportion to the skill it actually taught (the
// applied post-clamp gainCraftSkill delta). A craft that teaches nothing,
// whether gray by tier, above the archetype ceiling, or at the craft's
// enforced 125 content cap, pays zero character XP, exactly as it already
// pays zero skill. This keeps craft XP bounded for every recipe: a
// level-20 recipe never grays by CHARACTER level at the level-20 cap, so
// the green/gray falloff alone could not bound it; the skill journey is
// the missing, finite dimension.
import { describe, expect, it } from 'vitest';
import { craftMaxSkillFor } from '../src/sim/content/professions';
import { ALL_RECIPES, recipeById } from '../src/sim/content/recipes';
import { STATIONS } from '../src/sim/data';
import { craftSkillGainMultiplier } from '../src/sim/professions/archetype';
import { resolveCraft, resolveCraftForRecipe } from '../src/sim/professions/crafting';
import { stationsOfType } from '../src/sim/professions/stations';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function grantItem(sim: Sim, itemId: string, count: number, pid: number) {
  for (let i = 0; i < count; i++) sim.addItem(itemId, 1, pid);
}

function mustMeta(sim: Sim, pid: number): PlayerMeta {
  const meta = (sim as any).players.get(pid);
  if (!meta) throw new Error(`missing player meta ${pid}`);
  return meta;
}

// Station-bound recipes gate on POSITION only; walk the player onto the
// recipe's station (same harness idiom as professions_crafting.test.ts).
function placeAtStationFor(sim: Sim, pid: number, recipe: ProfessionRecipeRecord) {
  if (!recipe.stationType) return;
  const station = stationsOfType(STATIONS, recipe.stationType)[0];
  const entity = (sim as any).entities.get(pid);
  entity.pos.x = station.pos.x;
  entity.pos.z = station.pos.z;
  entity.prevPos = { ...entity.pos };
}

// Make `active`/`paired` the character's two uncapped majors so the
// archetype ceiling never zeroes the grant; the tests that DO exercise the
// ceiling arm simply skip this.
function setMajors(meta: PlayerMeta, active: string, paired: string | null) {
  meta.archetype.activeArchetype = active;
  meta.archetype.pairedMajor = paired;
  meta.archetype.hobbyCraft = null;
}

const MANTLE = recipeById('recipe_sootscale_mantle')!;

function grantMantleMats(sim: Sim, pid: number) {
  grantItem(sim, 'thorium_ore', 7, pid);
  grantItem(sim, 'smithing_flux', 5, pid);
}

describe('learning-coupled craft XP: taught-nothing crafts pay nothing', () => {
  it('the capstone grants zero XP once armorcrafting is maxed (the at-cap boundary)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setPlayerLevel(20);
    const meta = mustMeta(sim, pid);
    setMajors(meta, 'armorcrafting', 'weaponcrafting');
    meta.craftSkills.armorcrafting = craftMaxSkillFor('armorcrafting');
    placeAtStationFor(sim, pid, MANTLE);
    grantMantleMats(sim, pid);
    const before = meta.lifetimeXp;

    const throttleBefore = meta.craftThrottle.count;

    const first = resolveCraft((sim as any).ctx, pid, MANTLE.id);

    // The craft itself still works: item granted, materials consumed, the
    // shared action throttle still spent (at skill 125 the specialization
    // discount reduces the listed 7 ore + 5 flux to 5 + 4).
    expect(first.ok).toBe(true);
    expect(sim.countItem('sootscale_mantle', pid)).toBe(1);
    expect(sim.countItem('thorium_ore', pid)).toBe(2);
    expect(sim.countItem('smithing_flux', pid)).toBe(1);
    expect(meta.craftThrottle.count).toBe(throttleBefore + 1);
    // But it taught nothing, so it pays nothing: no lifetime XP, no skill.
    expect(meta.lifetimeXp).toBe(before);
    expect(meta.craftSkills.armorcrafting).toBe(125);

    // And it stays zero on repeat: the bound holds craft after craft.
    grantMantleMats(sim, pid);
    const second = resolveCraft((sim as any).ctx, pid, MANTLE.id);
    expect(second.ok).toBe(true);
    expect(meta.lifetimeXp).toBe(before);
  });

  it('the skillReq-150 tool chain grants zero XP at the engineering cap (the full-multiplier hole)', () => {
    // recipe_arcanite_mining_pick is tier 6, above ANY reachable capability
    // (cap 125 = tier 5), so the four-state curve alone reads FULL for it
    // forever; the applied-delta coupling is what zeroes it at the cap.
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setPlayerLevel(20);
    const meta = mustMeta(sim, pid);
    setMajors(meta, 'engineering', 'armorcrafting');
    meta.craftSkills.engineering = craftMaxSkillFor('engineering');
    const recipe = recipeById('recipe_arcanite_mining_pick')!;
    placeAtStationFor(sim, pid, recipe);
    grantItem(sim, 'arcanite_bar', 2, pid);
    grantItem(sim, 'thorium_mining_pick', 1, pid);
    const before = meta.lifetimeXp;

    const result = resolveCraft((sim as any).ctx, pid, recipe.id);

    expect(result.ok).toBe(true);
    expect(meta.lifetimeXp).toBe(before);
    expect(meta.craftSkills.engineering).toBe(125);
  });

  it('a pre-attunement character gains neither skill nor XP from the capstone (ceiling arm)', () => {
    // A fresh level-1 character: no archetype, so the tier-3
    // mantle sits above the rare ceiling and must teach (and pay) nothing.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = mustMeta(sim, pid);
    meta.craftSkills.armorcrafting = 80;
    placeAtStationFor(sim, pid, MANTLE);
    grantMantleMats(sim, pid);
    const beforeXp = meta.xp;
    const beforeLifetime = meta.lifetimeXp;

    const result = resolveCraft((sim as any).ctx, pid, MANTLE.id);

    expect(result.ok).toBe(true);
    expect(meta.xp).toBe(beforeXp);
    expect(meta.lifetimeXp).toBe(beforeLifetime);
    expect(meta.craftSkills.armorcrafting).toBe(80);
  });
});

describe('learning-coupled craft XP: legitimate play keeps its grant', () => {
  it('a capped character learning the craft keeps the full 100 XP per craft', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setPlayerLevel(20);
    const meta = mustMeta(sim, pid);
    setMajors(meta, 'armorcrafting', 'weaponcrafting');
    placeAtStationFor(sim, pid, MANTLE);
    grantMantleMats(sim, pid);
    const before = meta.lifetimeXp;

    const result = resolveCraft((sim as any).ctx, pid, MANTLE.id);

    expect(result.ok).toBe(true);
    expect(meta.lifetimeXp).toBe(before + 100);
    expect(meta.craftSkills.armorcrafting).toBe(1);
  });

  it('an attuned low-level crafter keeps the sub-cap upscale (120 XP at level 10)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setPlayerLevel(10);
    const meta = mustMeta(sim, pid);
    setMajors(meta, 'armorcrafting', 'weaponcrafting');
    placeAtStationFor(sim, pid, MANTLE);
    grantMantleMats(sim, pid);
    const before = meta.xp;

    const result = resolveCraft((sim as any).ctx, pid, MANTLE.id);

    expect(result.ok).toBe(true);
    expect(meta.xp).toBe(before + 120);
    expect(meta.craftSkills.armorcrafting).toBe(1);
  });

  it('the half-gain band pays exactly half XP', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setPlayerLevel(20);
    const meta = mustMeta(sim, pid);
    setMajors(meta, 'armorcrafting', 'weaponcrafting');
    meta.craftSkills.armorcrafting = 100; // capability 4 vs recipe tier 3
    placeAtStationFor(sim, pid, MANTLE);
    grantMantleMats(sim, pid);
    const before = meta.lifetimeXp;

    const result = resolveCraft((sim as any).ctx, pid, MANTLE.id);

    expect(result.ok).toBe(true);
    expect(meta.lifetimeXp).toBe(before + 50);
    expect(meta.craftSkills.armorcrafting).toBe(100.5);
  });

  it('the minimal band pays a quarter (synthetic tier-1 recipe)', () => {
    // Exercised via a synthetic recipe exactly as resolveCraftForRecipe's
    // doc invites: no real armorcrafting recipe sits two tiers below a
    // reachable capability while still paying at level 20.
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setPlayerLevel(20);
    const meta = mustMeta(sim, pid);
    setMajors(meta, 'armorcrafting', 'weaponcrafting');
    meta.craftSkills.armorcrafting = 75; // capability 3 vs recipe tier 1
    const recipe: ProfessionRecipeRecord = {
      id: 'recipe_test_minimal_band',
      professionId: 'armorcrafting',
      resultItemId: 'tough_jerky',
      resultCount: 1,
      reagents: [{ itemId: 'spider_leg', count: 1 }],
      skillReq: 25,
      itemLevelBudget: 1,
      level: 20,
    };
    grantItem(sim, 'spider_leg', 1, pid);
    const before = meta.lifetimeXp;

    const result = resolveCraftForRecipe((sim as any).ctx, pid, recipe);

    expect(result.ok).toBe(true);
    expect(meta.lifetimeXp).toBe(before + 25);
    expect(meta.craftSkills.armorcrafting).toBe(75.25);
  });

  it('the final fractional skill point scales the grant (delta clamp at the cap)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setPlayerLevel(20);
    const meta = mustMeta(sim, pid);
    setMajors(meta, 'armorcrafting', 'weaponcrafting');
    meta.craftSkills.armorcrafting = 124.6; // half band; 0.5 gain clamps to 0.4
    placeAtStationFor(sim, pid, MANTLE);
    grantMantleMats(sim, pid);
    const before = meta.lifetimeXp;

    const result = resolveCraft((sim as any).ctx, pid, MANTLE.id);

    expect(result.ok).toBe(true);
    expect(meta.lifetimeXp).toBe(before + 40);
    expect(meta.craftSkills.armorcrafting).toBe(125);
  });
});

// The regression-proof form: EVERY recipe, current and future, must stop
// paying character XP once its craft can no longer be taught, i.e. at the
// craft's enforced content cap. Drives the real resolveCraft path for every
// recipe and asserts ok === true so a new gate kind can never make this
// suite pass vacuously.
describe('every recipe stops paying XP at its craft cap (boundedness)', () => {
  for (const recipe of ALL_RECIPES) {
    it(`${recipe.id} grants zero XP at the ${recipe.professionId} cap`, () => {
      const sim = makeSim();
      const pid = sim.playerId;
      sim.setPlayerLevel(20);
      const meta = mustMeta(sim, pid);
      const cap = craftMaxSkillFor(recipe.professionId);
      meta.craftSkills[recipe.professionId] = cap;
      if (recipe.comboRequirement) {
        const { craftA, craftB, minTier } = recipe.comboRequirement;
        setMajors(meta, craftA, craftB);
        meta.craftSkills[craftA] = Math.max(meta.craftSkills[craftA] ?? 0, minTier * 25);
        meta.craftSkills[craftB] = Math.max(meta.craftSkills[craftB] ?? 0, minTier * 25);
      } else {
        setMajors(meta, recipe.professionId, null);
      }
      if (recipe.acquisition && recipe.acquisition.length > 0) {
        meta.knownRecipes.add(recipe.id);
      }
      placeAtStationFor(sim, pid, recipe);
      for (const reagent of recipe.reagents) {
        grantItem(sim, reagent.itemId, reagent.count, pid);
      }
      const before = meta.lifetimeXp;
      const skillBefore = meta.craftSkills[recipe.professionId];

      const result = resolveCraft((sim as any).ctx, pid, recipe.id);

      expect(result.ok).toBe(true);
      expect(meta.lifetimeXp).toBe(before);
      // Drift-proof: the skill must not MOVE across the craft (comparing to
      // the captured pre-craft value, not to craftMaxSkillFor again, so a
      // clamp bug cannot cancel out of both operands).
      expect(meta.craftSkills[recipe.professionId]).toBe(skillBefore);
    });
  }
});

// Direct sim-side pin on the shared multiplier's content-cap arm: the
// grant-site tests above cannot distinguish the cap arm from
// gainCraftSkill's own clamp (at cap the applied delta is zero either
// way), so the arm's own contract is pinned here, mirroring the
// crafting_view label pin from the UI side.
describe('craftSkillGainMultiplier content-cap arm', () => {
  it('returns 0 at the 125 cap and the ordinary band just under it', () => {
    const skills = { armorcrafting: 125 };
    expect(
      craftSkillGainMultiplier(
        skills,
        'armorcrafting',
        'weaponcrafting',
        'armorcrafting',
        null,
        75,
      ),
    ).toBe(0);
    expect(
      craftSkillGainMultiplier(
        skills,
        'armorcrafting',
        'weaponcrafting',
        'armorcrafting',
        null,
        150,
      ),
    ).toBe(0);
    const under = { armorcrafting: 124.5 };
    expect(
      craftSkillGainMultiplier(under, 'armorcrafting', 'weaponcrafting', 'armorcrafting', null, 75),
    ).toBe(0.5);
    expect(
      craftSkillGainMultiplier(
        under,
        'armorcrafting',
        'weaponcrafting',
        'armorcrafting',
        null,
        150,
      ),
    ).toBe(1);
  });

  it('stays total over an unknown craft id (no cap arm, no throw)', () => {
    expect(craftSkillGainMultiplier({}, null, null, 'blacksmithing', null, 0)).toBe(1);
  });
});
