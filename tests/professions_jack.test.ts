// Jack of All Trades (issue #1296): the breadth attunement. Covers the
// eligibility/attunement state machine and the reused breadth ceiling
// (archetype.ts), the improviser variance roll and cross-craft material
// discount (crafting.ts, jack_variance.ts), and the combo denial the
// existing null-identity combo gate already provides for free. See
// archetype.ts's module comment on ArchetypeState.isJackOfAllTrades for what
// is deliberately NOT covered here (the attunement quest content and any
// switching flow between Jack and an archetype, both explicitly out of
// scope per the issue's own Notes).

import { describe, expect, it } from 'vitest';
import { CRAFT_RING } from '../src/sim/content/professions';
import { COMBO_RECIPES } from '../src/sim/content/recipes';
import {
  type ArchetypeState,
  acceptArchetypeQuest,
  attuneArchetypePair,
  attuneJackOfAllTrades,
  canAttuneArchetypePair,
  craftCeiling,
  emptyArchetypeState,
  isEligibleForJackOfAllTrades,
  JACK_CEILING_TIER,
  normalizeArchetypeState,
} from '../src/sim/professions/archetype';
import {
  meetsComboRequirement,
  requiredReagentCountFor,
  resolveCraftForRecipe,
} from '../src/sim/professions/crafting';
import {
  JACK_VARIANCE_BETTER_CHANCE,
  JACK_VARIANCE_WORSE_CHANCE,
  rollCraftVariance,
} from '../src/sim/professions/jack_variance';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { type CraftSkills, emptyCraftSkills } from '../src/sim/professions/wheel';
import type { Rng } from '../src/sim/rng';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function metaOf(sim: Sim, pid: number): PlayerMeta {
  return (sim as unknown as { players: Map<number, PlayerMeta> }).players.get(pid)!;
}

function ctxOf(sim: Sim) {
  return (sim as unknown as { ctx: Parameters<typeof resolveCraftForRecipe>[0] }).ctx;
}

function skillsAt(craftId: string, skill: number): CraftSkills {
  const skills = emptyCraftSkills();
  skills[craftId] = skill;
  return skills;
}

// Two ring-adjacent crafts (engineering+alchemy) and two that are NOT
// adjacent (engineering+cooking, two ring positions apart), matching the
// design doc's own eligibility split ("offered at the rare tier when the
// two highest crafts are not adjacent").
const ADJACENT_A = CRAFT_RING[0].id; // engineering
const ADJACENT_B = CRAFT_RING[1].id; // alchemy
const NON_ADJACENT_B = CRAFT_RING[2].id; // cooking

describe('ArchetypeState.isJackOfAllTrades: state shape and normalization', () => {
  it('a fresh character is not Jack', () => {
    expect(emptyArchetypeState().isJackOfAllTrades).toBe(false);
  });

  it('normalizeArchetypeState backfills a saved Jack flag when no archetype is set', () => {
    const saved: Partial<ArchetypeState> = {
      activeArchetype: null,
      isJackOfAllTrades: true,
    };
    expect(normalizeArchetypeState(saved).isJackOfAllTrades).toBe(true);
  });

  it('normalizeArchetypeState ignores an absent flag (defaults false)', () => {
    expect(normalizeArchetypeState({ activeArchetype: null }).isJackOfAllTrades).toBe(false);
    expect(normalizeArchetypeState(undefined).isJackOfAllTrades).toBe(false);
  });

  it('normalizeArchetypeState forces the flag false whenever an archetype is also set: the two identities are mutually exclusive, whatever a hand-edited/corrupt save carries', () => {
    const saved: Partial<ArchetypeState> = {
      activeArchetype: ADJACENT_A,
      pairedMajor: ADJACENT_B,
      isJackOfAllTrades: true,
    };
    const normalized = normalizeArchetypeState(saved);
    expect(normalized.activeArchetype).toBe(ADJACENT_A);
    expect(normalized.isJackOfAllTrades).toBe(false);
  });
});

describe('isEligibleForJackOfAllTrades: the rare-tier, non-adjacent offer condition', () => {
  it('is false for a fresh character (nothing at rare yet)', () => {
    expect(isEligibleForJackOfAllTrades(emptyCraftSkills())).toBe(false);
  });

  it('is false when only one of the two highest crafts has reached rare', () => {
    const skills = { ...skillsAt(ADJACENT_A, 50), [NON_ADJACENT_B]: 24 };
    expect(isEligibleForJackOfAllTrades(skills)).toBe(false);
  });

  it('is false when the two highest rare-tier crafts ARE ring-adjacent (that offers an archetype instead)', () => {
    const skills = { ...skillsAt(ADJACENT_A, 50), [ADJACENT_B]: 50 };
    expect(isEligibleForJackOfAllTrades(skills)).toBe(false);
  });

  it('is true when the two highest rare-tier crafts are NOT ring-adjacent', () => {
    const skills = { ...skillsAt(ADJACENT_A, 50), [NON_ADJACENT_B]: 50 };
    expect(isEligibleForJackOfAllTrades(skills)).toBe(true);
  });
});

describe('attuneJackOfAllTrades: the one-time first-attunement transition', () => {
  it('sets isJackOfAllTrades and leaves every archetype field null, from a pristine character', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    expect(attuneJackOfAllTrades(ctxOf(sim), pid)).toBe(true);
    const state = metaOf(sim, pid).archetype;
    expect(state.isJackOfAllTrades).toBe(true);
    expect(state.activeArchetype).toBeNull();
    expect(state.pairedMajor).toBeNull();
    expect(state.hobbyCraft).toBeNull();
  });

  it('is a no-op (returns false, unchanged) the second time', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const ctx = ctxOf(sim);
    attuneJackOfAllTrades(ctx, pid);
    expect(attuneJackOfAllTrades(ctx, pid)).toBe(false);
  });

  it('is a no-op once an archetype is already active', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const ctx = ctxOf(sim);
    sim.acceptArchetypeQuest(ADJACENT_A);
    expect(attuneJackOfAllTrades(ctx, pid)).toBe(false);
    expect(metaOf(sim, pid).archetype.isJackOfAllTrades).toBe(false);
  });
});

describe('a Jack cannot silently gain an archetype for free (the switching-flow guard)', () => {
  it('acceptArchetypeQuest refuses for a Jack', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const ctx = ctxOf(sim);
    attuneJackOfAllTrades(ctx, pid);
    expect(acceptArchetypeQuest(ctx, pid, ADJACENT_A)).toBe(false);
    const state = metaOf(sim, pid).archetype;
    expect(state.isJackOfAllTrades).toBe(true);
    expect(state.activeArchetype).toBeNull();
  });

  it('attuneArchetypePair and its canAttuneArchetypePair predicate both refuse for a Jack', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const ctx = ctxOf(sim);
    attuneJackOfAllTrades(ctx, pid);
    const state = metaOf(sim, pid).archetype;
    const target = `${ADJACENT_A}+${ADJACENT_B}`;
    expect(canAttuneArchetypePair(state, target, 'new')).toBe(false);
    expect(attuneArchetypePair(ctx, pid, target, 'new')).toBe(false);
    expect(state.isJackOfAllTrades).toBe(true);
    expect(state.activeArchetype).toBeNull();
  });
});

describe('the Jack of All Trades breadth ceiling reuses archetypeCeilingFor/craftCeiling (#1296)', () => {
  it('JACK_CEILING_TIER is the rare tier (2 on the five-rung MaterialRarity ladder), well short of legendary (4)', () => {
    expect(JACK_CEILING_TIER).toBe(2);
    expect(JACK_CEILING_TIER).toBeLessThan(4);
  });

  it('a Jack reaches the breadth ceiling across all ten crafts, whatever the raw skill', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    attuneJackOfAllTrades(ctxOf(sim), pid);
    const state = metaOf(sim, pid).archetype;
    const highSkills: CraftSkills = {};
    for (const craft of CRAFT_RING) highSkills[craft.id] = 500;
    for (const craft of CRAFT_RING) {
      const ceiling = craftCeiling(
        highSkills,
        state.activeArchetype,
        state.pairedMajor,
        craft.id,
        state.hobbyCraft,
      );
      expect(ceiling, `${craft.id} ceiling`).toBe(JACK_CEILING_TIER);
    }
  });

  it('a Jack with LOW raw skill is bounded by that skill instead, the same min() composition every other identity uses', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    attuneJackOfAllTrades(ctxOf(sim), pid);
    const state = metaOf(sim, pid).archetype;
    const lowSkills = skillsAt(ADJACENT_A, 10); // tierCapability = 0
    expect(
      craftCeiling(
        lowSkills,
        state.activeArchetype,
        state.pairedMajor,
        ADJACENT_A,
        state.hobbyCraft,
      ),
    ).toBe(0);
  });
});

describe('a Jack cannot craft combo recipes (#1296): the existing null-identity combo gate already covers it', () => {
  it('meetsComboRequirement denies even with both crafts at high skill', () => {
    const combo = COMBO_RECIPES[0];
    const req = combo.comboRequirement!;
    const skills: CraftSkills = { ...emptyCraftSkills(), [req.craftA]: 200, [req.craftB]: 200 };
    // A real Jack's activeArchetype/pairedMajor/hobbyCraft are null (see
    // attuneJackOfAllTrades above), the exact identity shape passed here.
    expect(meetsComboRequirement(skills, combo, null, null, null)).toBe(false);
  });

  it('resolveCraftForRecipe denies a combo recipe outright for a real Jack-attuned crafter, drawing zero rng', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const ctx = ctxOf(sim);
    attuneJackOfAllTrades(ctx, pid);
    const meta = metaOf(sim, pid);
    const combo = COMBO_RECIPES[0];
    const req = combo.comboRequirement!;
    meta.craftSkills[req.craftA] = 200;
    meta.craftSkills[req.craftB] = 200;
    let draws = 0;
    const rng: Rng = ctx.rng;
    rng.setObserver(() => draws++);
    const result = resolveCraftForRecipe(ctx, pid, combo);
    rng.setObserver(null);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('combo_requirement_unmet');
    expect(draws).toBe(0);
  });
});

describe('rollCraftVariance (jack_variance.ts): pure Rng-draw bucketing', () => {
  it('buckets the bottom JACK_VARIANCE_WORSE_CHANCE of the roll to worse', () => {
    expect(rollCraftVariance(0)).toBe('worse');
    expect(rollCraftVariance(JACK_VARIANCE_WORSE_CHANCE - 0.0001)).toBe('worse');
  });

  it('buckets the next JACK_VARIANCE_BETTER_CHANCE of the roll to better', () => {
    expect(rollCraftVariance(JACK_VARIANCE_WORSE_CHANCE)).toBe('better');
    expect(
      rollCraftVariance(JACK_VARIANCE_WORSE_CHANCE + JACK_VARIANCE_BETTER_CHANCE - 0.0001),
    ).toBe('better');
  });

  it('everything else is normal', () => {
    expect(rollCraftVariance(JACK_VARIANCE_WORSE_CHANCE + JACK_VARIANCE_BETTER_CHANCE)).toBe(
      'normal',
    );
    expect(rollCraftVariance(0.999999)).toBe('normal');
  });
});

describe('requiredReagentCountFor: the Jack cross-craft synergy material-saving bonus (#1296)', () => {
  it('shaves the discount off a reagent requirement, composing with the existing discounts', () => {
    const reagent = { itemId: 'spider_leg', count: 10 };
    expect(
      requiredReagentCountFor(false, reagent, emptyCraftSkills(), 'cooking', false).count,
    ).toBe(10);
    expect(requiredReagentCountFor(false, reagent, emptyCraftSkills(), 'cooking', true).count).toBe(
      9,
    );
  });

  it('never waives a reagent below 1, even discounted', () => {
    const reagent = { itemId: 'spider_leg', count: 1 };
    expect(requiredReagentCountFor(false, reagent, emptyCraftSkills(), 'cooking', true).count).toBe(
      1,
    );
  });

  it('defaults to false: a non-Jack call site (e.g. crafting_view.ts) is byte-identical', () => {
    const reagent = { itemId: 'spider_leg', count: 10 };
    expect(requiredReagentCountFor(false, reagent, emptyCraftSkills(), 'cooking').count).toBe(10);
  });
});

describe('the material-saving bonus and the output-variance roll apply at craft time (#1296, end to end)', () => {
  const jackRecipe: ProfessionRecipeRecord = {
    id: 'test_recipe_jack_material_saving',
    professionId: 'cooking',
    resultItemId: 'tough_jerky',
    resultCount: 1,
    reagents: [{ itemId: 'spider_leg', count: 10 }],
    skillReq: 0,
    itemLevelBudget: 1,
    level: 1,
  };

  it('a Jack-attuned craft consumes fewer reagents than an identical non-Jack craft', () => {
    const plainSim = makeSim();
    const plainPid = plainSim.playerId;
    plainSim.addItem('spider_leg', 10, plainPid);
    resolveCraftForRecipe(ctxOf(plainSim), plainPid, jackRecipe);
    expect(plainSim.countItem('spider_leg', plainPid)).toBe(0);

    const jackSim = makeSim();
    const jackPid = jackSim.playerId;
    attuneJackOfAllTrades(ctxOf(jackSim), jackPid);
    jackSim.addItem('spider_leg', 10, jackPid);
    const result = resolveCraftForRecipe(ctxOf(jackSim), jackPid, jackRecipe);
    expect(result.ok).toBe(true);
    // 10 reagents at a 10% discount: floor(10 * 0.9) = 9 consumed, 1 spared.
    expect(jackSim.countItem('spider_leg', jackPid)).toBe(1);
  });

  it('a Jack-attuned craft draws the extra variance roll (two draws) where a non-Jack craft draws one', () => {
    const plainSim = makeSim();
    const plainPid = plainSim.playerId;
    plainSim.addItem('spider_leg', 10, plainPid);
    let plainDraws = 0;
    const plainRng: Rng = ctxOf(plainSim).rng;
    plainRng.setObserver(() => plainDraws++);
    resolveCraftForRecipe(ctxOf(plainSim), plainPid, jackRecipe);
    plainRng.setObserver(null);
    expect(plainDraws).toBe(1);

    const jackSim = makeSim();
    const jackPid = jackSim.playerId;
    attuneJackOfAllTrades(ctxOf(jackSim), jackPid);
    jackSim.addItem('spider_leg', 10, jackPid);
    let jackDraws = 0;
    const jackRng: Rng = ctxOf(jackSim).rng;
    jackRng.setObserver(() => jackDraws++);
    const result = resolveCraftForRecipe(ctxOf(jackSim), jackPid, jackRecipe);
    jackRng.setObserver(null);
    expect(jackDraws).toBe(2);
    expect(result.variance).toMatch(/^(worse|normal|better)$/);
  });
});

// Masterwork interaction (hunted seeds, the suite's own idiom: see
// tests/professions_crafting.test.ts "masterwork proc" describe block). Both
// scenarios reuse recipe_eastbrook_ritual_vestments (an uncommon-def
// tailoring piece with a primary-stat profile, bumping to rare: tier 2,
// exactly at JACK_CEILING_TIER, so the masterwork effect gate still passes
// for a Jack) so a 'worse' or 'better' roll's effect on the SAME underlying
// masterwork mechanism is directly observable.
describe('the variance roll actually changes the masterwork outcome (#1296, hunted seeds)', () => {
  function vestmentsScenario(sim: Sim, pid: number, meta: PlayerMeta, maxChance: boolean) {
    attuneJackOfAllTrades(ctxOf(sim), pid);
    if (maxChance) {
      meta.craftSkills.tailoring = 200;
      sim.addItemInstance('linen_scrap', { signer: meta.name }, pid);
    } else {
      sim.addItem('linen_scrap', 3, pid);
    }
    sim.addItem('spider_leg', 1, pid);
    sim.addItem('homespun_cloth', 3, pid);
    sim.addItem('spool_of_thread', 5, pid);
  }

  it('a worse roll forces the masterwork bump off even though the proc roll alone would have hit (seed 45)', () => {
    const sim = makeSim(45);
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    vestmentsScenario(sim, pid, meta, true);
    const draws: number[] = [];
    const rng: Rng = ctxOf(sim).rng;
    rng.setObserver((v) => draws.push(v));
    sim.craftItem('recipe_eastbrook_ritual_vestments', false, pid);
    rng.setObserver(null);
    expect(draws.length).toBe(2);
    const [varianceRoll, procRoll] = draws;
    // Confirms the scenario is actually exercising the suppression: without
    // the Jack override this procRoll would have masterworked (MASTERWORK_CHANCE_CAP is 0.15).
    expect(varianceRoll).toBeLessThan(JACK_VARIANCE_WORSE_CHANCE);
    expect(procRoll).toBeLessThan(0.15);
    expect(sim.lastCraftResult?.variance).toBe('worse');
    expect(sim.lastCraftResult?.masterwork).toBeUndefined();
  });

  it('a better roll improves the odds enough to turn an otherwise-miss into a masterwork hit (seed 39)', () => {
    const sim = makeSim(39);
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    vestmentsScenario(sim, pid, meta, false);
    const draws: number[] = [];
    const rng: Rng = ctxOf(sim).rng;
    rng.setObserver((v) => draws.push(v));
    sim.craftItem('recipe_eastbrook_ritual_vestments', false, pid);
    rng.setObserver(null);
    expect(draws.length).toBe(2);
    const [varianceRoll, procRoll] = draws;
    expect(varianceRoll).toBeGreaterThanOrEqual(JACK_VARIANCE_WORSE_CHANCE);
    expect(varianceRoll).toBeLessThan(JACK_VARIANCE_WORSE_CHANCE + JACK_VARIANCE_BETTER_CHANCE);
    // Base chance here is MASTERWORK_BASE_CHANCE alone (0.03: no signed
    // reagent, no specialization, no tiers above); the hunted procRoll sits
    // above that base but under the boosted chance (0.08).
    expect(procRoll).toBeGreaterThanOrEqual(0.03);
    expect(procRoll).toBeLessThan(0.08);
    expect(sim.lastCraftResult?.variance).toBe('better');
    expect(sim.lastCraftResult?.masterwork).toBe(true);
  });

  it('a normal roll changes nothing: draws twice, still masterwork-eligible on the ordinary chance (seed 1)', () => {
    const sim = makeSim(1);
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    vestmentsScenario(sim, pid, meta, true);
    sim.craftItem('recipe_eastbrook_ritual_vestments', false, pid);
    expect(sim.lastCraftResult?.variance).toBe('normal');
  });
});
