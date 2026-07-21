// Empowerment ceiling composition (issue #1129/#1203/#1638 review): an archetype
// is an ADJACENT PAIR (the two majors), not a single craft (see the module
// comment on src/sim/professions/archetype.ts). This pins the reachable-ceiling
// math that makes it matter (archetypeCeilingFor/craftCeiling) plus its
// composition into crafting.ts's tier-progress multiplier, masterwork-effect
// gate (Professions 2.0 Phase 2: outputs are deterministic at the def quality,
// so the ceiling binds craft outputs by gating the masterwork bump), and
// combo-recipe gate.

import { describe, expect, it } from 'vitest';
import { CRAFT_RING, oppositeCraft } from '../src/sim/content/professions';
import { COMBO_RECIPES, recipeById } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { archetypeCeilingFor, craftCeiling } from '../src/sim/professions/archetype';
import { meetsComboRequirement, resolveCraftForRecipe } from '../src/sim/professions/crafting';
import { MASTERWORK_BASE_CHANCE } from '../src/sim/professions/masterwork';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { type CraftSkills, emptyCraftSkills, tierCapability } from '../src/sim/professions/wheel';
import { Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';

const ARMOR = CRAFT_RING[9].id; // 'armorcrafting' (the ring's wrap point since the Professions 2.0 reorder)
// The second major acceptArchetypeQuest(ARMOR) defaults to: pinned as a
// LITERAL (not recomputed via adjacentCrafts/defaultPairedMajor) so a change
// to the default-pair rule reddens here deliberately. armorcrafting's content
// combo partner (recipes.ts COMBO_RECIPES) is weaponcrafting, its ring-prev
// neighbor, so the combo-aware default picks it over the ring-next neighbor
// (engineering, across the wrap).
const PAIRED_MAJOR = 'weaponcrafting';
// getHobbyCraft's deterministic single-craft fallback: the craft opposite the
// title major ('tailoring'). This is what the PURE ceiling helpers default to
// when no explicit hobby argument is passed.
const FALLBACK_HOBBY = oppositeCraft(ARMOR).id;
// The ACTUAL persisted hobby acceptArchetypeQuest(ARMOR) selects with zero
// skills: defaultHobbyForPair over the pair's two opposites (tailoring,
// leatherworking) tie-breaks by ring order to leatherworking. Pinned as a
// LITERAL so a change to the hobby-default rule reddens here deliberately.
const STATE_HOBBY = 'leatherworking';
const OUTSIDE = CRAFT_RING.find(
  (c) => ![ARMOR, PAIRED_MAJOR, FALLBACK_HOBBY, STATE_HOBBY].includes(c.id),
)!.id;

function skillsAt(craftId: string, skill: number): CraftSkills {
  const skills = emptyCraftSkills();
  skills[craftId] = skill;
  return skills;
}

describe('archetypeCeilingFor (#1129/#1203 empowerment ceiling, pair model)', () => {
  it('is uncapped-to-rare for every craft before any archetype has been chosen', () => {
    expect(archetypeCeilingFor(null, null, ARMOR)).toBe(2);
    expect(archetypeCeilingFor(null, null, FALLBACK_HOBBY)).toBe(2);
    expect(archetypeCeilingFor(null, null, OUTSIDE)).toBe(2);
  });

  it('is unlimited for the title-quest major itself', () => {
    expect(archetypeCeilingFor(ARMOR, PAIRED_MAJOR, ARMOR)).toBe(Infinity);
  });

  it('is unlimited for the second (ring-adjacent) major too: both majors, not just one', () => {
    expect(archetypeCeilingFor(ARMOR, PAIRED_MAJOR, PAIRED_MAJOR)).toBe(Infinity);
  });

  it('is capped at rare (tier 2) for the hobby: the opposite craft on CRAFT_RING from the title major', () => {
    expect(archetypeCeilingFor(ARMOR, PAIRED_MAJOR, FALLBACK_HOBBY)).toBe(2);
  });

  it('is capped at common (tier 0) for every craft outside the pair and the hobby once an archetype is set', () => {
    expect(archetypeCeilingFor(ARMOR, PAIRED_MAJOR, OUTSIDE)).toBe(0);
  });
});

describe('craftCeiling composes tierCapability with the archetype ceiling (min of the two)', () => {
  it('with no archetype set, a high raw skill is still clamped to the rare ceiling', () => {
    const skills = skillsAt(ARMOR, 500); // raw tierCapability would be far above 2
    expect(tierCapability(skills, ARMOR)).toBeGreaterThan(2);
    expect(craftCeiling(skills, null, null, ARMOR)).toBe(2);
  });

  it('the title major is bounded only by raw skill (archetype side is unlimited)', () => {
    const skills = skillsAt(ARMOR, 130); // tierCapability = floor(130/25) = 5
    expect(craftCeiling(skills, ARMOR, PAIRED_MAJOR, ARMOR)).toBe(5);
  });

  it('the paired (second) major is bounded only by raw skill too', () => {
    const skills = skillsAt(PAIRED_MAJOR, 130);
    expect(craftCeiling(skills, ARMOR, PAIRED_MAJOR, PAIRED_MAJOR)).toBe(5);
  });

  it('hobby craft is clamped to rare even with very high raw skill', () => {
    const skills = skillsAt(FALLBACK_HOBBY, 500);
    expect(craftCeiling(skills, ARMOR, PAIRED_MAJOR, FALLBACK_HOBBY)).toBe(2);
  });

  it('hobby craft with raw skill below the rare ceiling is bounded by the raw skill instead', () => {
    const skills = skillsAt(FALLBACK_HOBBY, 10); // tierCapability = 0
    expect(craftCeiling(skills, ARMOR, PAIRED_MAJOR, FALLBACK_HOBBY)).toBe(0);
  });

  it('a craft outside the pair and the hobby is clamped to common (0) regardless of raw skill', () => {
    const skills = skillsAt(OUTSIDE, 500);
    expect(craftCeiling(skills, ARMOR, PAIRED_MAJOR, OUTSIDE)).toBe(0);
  });
});

describe('meetsComboRequirement composes the archetype ceiling (#1132 combo gate)', () => {
  const combo: ProfessionRecipeRecord['comboRequirement'] = {
    craftA: ARMOR,
    craftB: PAIRED_MAJOR,
    minTier: 1,
  };
  const recipe = { comboRequirement: combo } as unknown as ProfessionRecipeRecord;

  it('denies an unattuned raw-skills caller even when both craft tiers are high', () => {
    const skills = { ...emptyCraftSkills(), [ARMOR]: 25, [PAIRED_MAJOR]: 25 };
    expect(meetsComboRequirement(skills, recipe)).toBe(false);
  });

  it('an attuned specialist meets a minTier-1 combo over their OWN adjacent pair once both reach tier 1 (#1638 review)', () => {
    // Every COMBO_RECIPES pair in content/recipes.ts is ring-adjacent, i.e. exactly
    // the shape of a player's two majors: unlimited ceiling on BOTH sides means raw
    // skill alone (not the archetype-derived cap) decides eligibility here.
    const skills = { ...emptyCraftSkills(), [ARMOR]: 25, [PAIRED_MAJOR]: 25 };
    expect(meetsComboRequirement(skills, recipe, ARMOR, PAIRED_MAJOR)).toBe(true);
  });

  it('a craft outside the archetype pair is capped to common and fails a minTier-1 combo', () => {
    const otherCombo = { craftA: ARMOR, craftB: OUTSIDE, minTier: 1 };
    const skills = { ...emptyCraftSkills(), [ARMOR]: 25, [OUTSIDE]: 25 };
    const otherRecipe = { comboRequirement: otherCombo } as unknown as ProfessionRecipeRecord;
    expect(meetsComboRequirement(skills, otherRecipe, ARMOR, PAIRED_MAJOR)).toBe(false);
  });

  it('a major plus hobby never substitutes for the exact active pair', () => {
    const hobbyCombo = { craftA: ARMOR, craftB: STATE_HOBBY, minTier: 1 };
    const skills = { ...emptyCraftSkills(), [ARMOR]: 25, [STATE_HOBBY]: 25 };
    const hobbyRecipe = { comboRequirement: hobbyCombo } as unknown as ProfessionRecipeRecord;
    expect(meetsComboRequirement(skills, hobbyRecipe, ARMOR, PAIRED_MAJOR, STATE_HOBBY)).toBe(
      false,
    );
  });

  it('every real content combo stays craftable after attuning to EITHER of its two crafts (#1638 review round 2)', () => {
    // The stubbed default pair (archetype.ts defaultPairedMajor) prefers the
    // content-combo partner exactly so this holds: with a first-ring-neighbor
    // default, an armorcrafting- or alchemy-attuned specialist would pair away
    // from their themed combo and be locked out of it at the common ceiling.
    for (const comboRecipe of COMBO_RECIPES) {
      const combo = comboRecipe.comboRequirement!;
      for (const attuned of [combo.craftA, combo.craftB]) {
        const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
        sim.acceptArchetypeQuest(attuned);
        const meta = (
          sim as unknown as {
            players: Map<
              number,
              { archetype: { activeArchetype: string | null; pairedMajor: string | null } }
            >;
          }
        ).players.get(sim.playerId)!;
        const skills = { ...emptyCraftSkills(), [combo.craftA]: 25, [combo.craftB]: 25 };
        expect(
          meetsComboRequirement(
            skills,
            comboRecipe,
            meta.archetype.activeArchetype,
            meta.archetype.pairedMajor,
          ),
          `${comboRecipe.id} must stay craftable when attuned to ${attuned}`,
        ).toBe(true);
      }
    }
  });
});

describe('resolveCraftForRecipe reads the archetype-gated ceiling for skill-gain scaling', () => {
  function makeSim(seed = 42) {
    return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
  }

  function metaOf(sim: Sim, pid: number) {
    return (sim as unknown as { players: Map<number, { craftSkills: CraftSkills }> }).players.get(
      pid,
    )!;
  }

  function ctxOf(sim: Sim) {
    return (sim as unknown as { ctx: Parameters<typeof resolveCraftForRecipe>[0] }).ctx;
  }

  // #1638 review, Blocking bullet 2: the ceiling must actually FREEZE progress
  // once raw skill reaches it, not just cap the momentary multiplier. Before the
  // fix, a craft capped at common (tier 0) still leveled at full speed toward
  // higher-tier recipes forever (tiersBelow went negative, which
  // tierProgressMultiplier read as "at or above capability", granting full
  // progress). The fix must treat "recipe tier above the ceiling" as frozen (0),
  // not full.
  it('a craft outside the pair and the hobby never gains skill toward an above-common recipe', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.acceptArchetypeQuest(ARMOR); // ARMOR + its default paired major are the two majors
    const meta = metaOf(sim, pid);
    meta.craftSkills[OUTSIDE] = 100; // raw tierCapability(OUTSIDE) = 4, but the ceiling caps it at 0

    const recipe: ProfessionRecipeRecord = {
      id: 'test_recipe_tier2_outside',
      professionId: OUTSIDE,
      resultItemId: 'bone_fragments',
      resultCount: 1,
      reagents: [],
      skillReq: 50, // recipeTier = 2
      itemLevelBudget: 10,
      level: 10,
    };
    const result = resolveCraftForRecipe(ctxOf(sim), pid, recipe);

    expect(result.ok).toBe(true);
    expect(meta.craftSkills[OUTSIDE]).toBe(100); // frozen: no progress past the common ceiling
  });

  it('a dormant craft with LOW raw skill cannot even start climbing toward tier 1 (isolates the ceiling from diminishing returns)', () => {
    // The high-raw-skill case above also zeroes under plain diminishing
    // returns (raw capability 4 vs a tier-2 recipe), so it alone cannot
    // distinguish the ceiling from the ordinary curve. Here raw capability is
    // 0, where base granted FULL climb progress toward a tier-1 recipe: only
    // the dormancy ceiling produces the freeze.
    const sim = makeSim();
    const pid = sim.playerId;
    sim.acceptArchetypeQuest(ARMOR);
    const meta = metaOf(sim, pid);
    meta.craftSkills[OUTSIDE] = 20; // raw tierCapability(OUTSIDE) = 0

    const recipe: ProfessionRecipeRecord = {
      id: 'test_recipe_tier1_outside_climb',
      professionId: OUTSIDE,
      resultItemId: 'bone_fragments',
      resultCount: 1,
      reagents: [],
      skillReq: 25, // recipeTier = 1, above the common (0) dormancy ceiling
      itemLevelBudget: 10,
      level: 10,
    };
    const result = resolveCraftForRecipe(ctxOf(sim), pid, recipe);

    expect(result.ok).toBe(true);
    expect(meta.craftSkills[OUTSIDE]).toBe(20); // frozen at 20: the climb itself is denied
  });

  it('a common-tier (recipeTier 0) craft still produces skill progress at the free floor even when dormant', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.acceptArchetypeQuest(ARMOR);
    const meta = metaOf(sim, pid);
    meta.craftSkills[OUTSIDE] = 100;

    const recipe: ProfessionRecipeRecord = {
      id: 'test_recipe_common_outside',
      professionId: OUTSIDE,
      resultItemId: 'bone_fragments',
      resultCount: 1,
      reagents: [],
      skillReq: 0, // recipeTier = 0 (common, the free floor)
      itemLevelBudget: 1,
      level: 1,
    };
    const result = resolveCraftForRecipe(ctxOf(sim), pid, recipe);

    expect(result.ok).toBe(true);
    expect(meta.craftSkills[OUTSIDE]).toBe(101); // full progress, unaffected by the ceiling
  });

  it('grants full skill progress in the title major even at very high raw skill', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.acceptArchetypeQuest(ARMOR);
    const meta = metaOf(sim, pid);
    meta.craftSkills[ARMOR] = 100; // tierCapability = 4; archetype ceiling is unlimited here

    const recipe: ProfessionRecipeRecord = {
      id: 'test_recipe_tier4_armor',
      professionId: ARMOR,
      resultItemId: 'bone_fragments',
      resultCount: 1,
      reagents: [],
      skillReq: 100, // recipeTier = 4, exactly at capability -> full progress
      itemLevelBudget: 10,
      level: 10,
    };
    const result = resolveCraftForRecipe(ctxOf(sim), pid, recipe);

    expect(result.ok).toBe(true);
    expect(meta.craftSkills[ARMOR]).toBe(101);
  });

  it('grants full skill progress in the SECOND (paired) major too, not just the title-quest craft', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.acceptArchetypeQuest(ARMOR);
    const meta = metaOf(sim, pid);
    meta.craftSkills[PAIRED_MAJOR] = 100;

    const recipe: ProfessionRecipeRecord = {
      id: 'test_recipe_tier4_paired',
      professionId: PAIRED_MAJOR,
      resultItemId: 'bone_fragments',
      resultCount: 1,
      reagents: [],
      skillReq: 100,
      itemLevelBudget: 10,
      level: 10,
    };
    const result = resolveCraftForRecipe(ctxOf(sim), pid, recipe);

    expect(result.ok).toBe(true);
    expect(meta.craftSkills[PAIRED_MAJOR]).toBe(101);
  });

  it('the hobby craft freezes at the rare ceiling: no further progress past tier 2', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.acceptArchetypeQuest(ARMOR);
    const meta = metaOf(sim, pid);
    meta.craftSkills[STATE_HOBBY] = 50; // tierCapability = 2 (rare), exactly at the hobby ceiling

    const recipe: ProfessionRecipeRecord = {
      id: 'test_recipe_tier3_hobby',
      professionId: STATE_HOBBY,
      resultItemId: 'bone_fragments',
      resultCount: 1,
      reagents: [],
      skillReq: 75, // recipeTier = 3, above the rare ceiling
      itemLevelBudget: 10,
      level: 10,
    };
    const result = resolveCraftForRecipe(ctxOf(sim), pid, recipe);

    expect(result.ok).toBe(true);
    expect(meta.craftSkills[STATE_HOBBY]).toBe(50); // frozen at the rare ceiling
  });

  // #1638 review round 2: the freeze guard must fire ONLY above the archetype
  // ceiling, never above the raw-skill capability. There is no skillReq
  // admission gate on crafting, so a recipe tier above raw capability is the
  // ordinary climb (wheel.ts: "full at or above capability: this is how
  // capability advances in the first place") and base granted it full
  // progress. The first guard cut compared against craftCeiling (min with raw
  // capability) and zeroed the climb everywhere: an engineering major could
  // never level engineering at all (all six engineering recipes are tier 3/6).
  it('a major climbs at full speed toward a recipe above its raw capability (the engineering regression)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.acceptArchetypeQuest('engineering'); // majors: engineering + alchemy (combo-aware default)
    const meta = metaOf(sim, pid);
    expect(meta.craftSkills.engineering ?? 0).toBe(0); // raw capability 0

    const recipe: ProfessionRecipeRecord = {
      id: 'test_recipe_tier3_engineering',
      professionId: 'engineering',
      resultItemId: 'bone_fragments',
      resultCount: 1,
      reagents: [],
      skillReq: 75, // recipeTier = 3, far above raw capability, within the unlimited ceiling
      itemLevelBudget: 10,
      level: 10,
    };
    const result = resolveCraftForRecipe(ctxOf(sim), pid, recipe);

    expect(result.ok).toBe(true);
    expect(meta.craftSkills.engineering).toBe(1); // full progress: the climb works
  });

  it('the hobby climbs at full speed toward an above-raw-capability recipe BELOW its rare ceiling', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.acceptArchetypeQuest(ARMOR);
    const meta = metaOf(sim, pid);
    meta.craftSkills[STATE_HOBBY] = 30; // raw capability 1, below the rare (2) hobby ceiling

    const recipe: ProfessionRecipeRecord = {
      id: 'test_recipe_tier2_hobby_climb',
      professionId: STATE_HOBBY,
      resultItemId: 'bone_fragments',
      resultCount: 1,
      reagents: [],
      skillReq: 50, // recipeTier = 2: above raw capability, exactly at the ceiling
      itemLevelBudget: 10,
      level: 10,
    };
    const result = resolveCraftForRecipe(ctxOf(sim), pid, recipe);

    expect(result.ok).toBe(true);
    expect(meta.craftSkills[STATE_HOBBY]).toBe(31); // full progress up to the ceiling
  });

  it('pre-archetype, a recipe above the rare ceiling grants zero progress (uncapped-to-rare)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    meta.craftSkills[ARMOR] = 60; // raw capability 2, at the pre-archetype rare ceiling

    const recipe: ProfessionRecipeRecord = {
      id: 'test_recipe_tier3_prearchetype',
      professionId: ARMOR,
      resultItemId: 'bone_fragments',
      resultCount: 1,
      reagents: [],
      skillReq: 75, // recipeTier = 3, above the pre-archetype rare ceiling
      itemLevelBudget: 10,
      level: 10,
    };
    const result = resolveCraftForRecipe(ctxOf(sim), pid, recipe);

    expect(result.ok).toBe(true);
    expect(meta.craftSkills[ARMOR]).toBe(60); // frozen: attunement is what unlocks tiers 3+
  });
});

describe('archetype ceilings gate the masterwork effect (Phase 2: ceilings bind craft outputs)', () => {
  // Professions 2.0 Phase 2 retired the rolled output quality: a craft's
  // output is its recipe's declared item at the DEF quality, and the only way
  // an output can exceed that tier is the masterwork bump (def quality + 1 on
  // the ladder). The empowerment ceiling therefore binds craft outputs by
  // gating the masterwork EFFECT, never the proc draw itself: every successful
  // craft below still draws exactly once.
  //
  // PROC_SEED was HUNTED (loop seeds, build the scenario, craft once, keep the
  // first seed whose proc roll lands under MASTERWORK_BASE_CHANCE) and is
  // pinned as a literal; the hunt loop is not committed. At this seed the
  // craft's proc roll is the FIRST rng draw after Sim construction in every
  // arm below (nothing else here draws), so the identical roll value reaches
  // the proc comparison each time: only the archetype ceiling changes the
  // outcome, which is exactly what these cases pin.
  const PROC_SEED = 18;

  function makeSim() {
    return new Sim({ seed: PROC_SEED, playerClass: 'warrior', autoEquip: false });
  }

  interface CraftMeta {
    name: string;
    craftSkills: CraftSkills;
    archetype: {
      activeArchetype: string | null;
      pairedMajor: string | null;
      hobbyCraft: string | null;
    };
    inventory: InvSlot[];
  }

  function metaOf(sim: Sim, pid: number): CraftMeta {
    return (sim as unknown as { players: Map<number, CraftMeta> }).players.get(pid)!;
  }

  function ctxOf(sim: Sim) {
    return (sim as unknown as { ctx: Parameters<typeof resolveCraftForRecipe>[0] }).ctx;
  }

  /** Run `fn` while observing rng draws: returns the draw count and the last
   *  drawn value (the proc roll, since every arm draws exactly once). */
  function observeDraws<T>(sim: Sim, fn: () => T): { result: T; draws: number; roll: number } {
    const rng = ctxOf(sim).rng;
    let draws = 0;
    let roll = -1;
    rng.setObserver((value) => {
      draws += 1;
      roll = value;
    });
    const result = fn();
    rng.setObserver(null);
    return { result, draws, roll };
  }

  function syntheticRecipe(
    professionId: string,
    resultItemId: string,
    level: number,
  ): ProfessionRecipeRecord {
    return {
      id: `test_recipe_masterwork_${professionId}_${resultItemId}`,
      professionId,
      resultItemId,
      resultCount: 1,
      reagents: [],
      skillReq: 0,
      itemLevelBudget: level,
      level,
    };
  }

  it('a dormant craft never produces a masterwork, even on the seed whose roll procs under a major', () => {
    const recipe = recipeById('recipe_eastbrook_ritual_vestments')!;
    expect(recipe.professionId).toBe('tailoring');
    expect(ITEMS[recipe.resultItemId].quality).toBe('uncommon'); // bump target: rare (tier 2)

    // Major control arm (the full Sim.craftItem path): attuned to tailoring,
    // the pinned seed's roll procs and the effect applies.
    const major = makeSim();
    const majorPid = major.playerId;
    major.acceptArchetypeQuest('tailoring');
    for (const r of recipe.reagents) major.addItem(r.itemId, r.count, majorPid);
    const majorRun = observeDraws(major, () => major.craftItem(recipe.id, majorPid));
    expect(majorRun.draws).toBe(1);
    expect(majorRun.roll).toBeLessThan(MASTERWORK_BASE_CHANCE); // the hunted premise
    expect(major.lastCraftResult?.masterwork).toBe(true);
    expect(major.events.filter((e) => e.type === 'masterwork')).toEqual([
      {
        type: 'masterwork',
        recipeId: recipe.id,
        itemId: recipe.resultItemId,
        crafter: majorPid,
        pid: majorPid,
      },
    ]);
    expect(major.lastMasterwork).toEqual({
      recipeId: recipe.id,
      itemId: recipe.resultItemId,
      crafter: majorPid,
    });
    const minted = metaOf(major, majorPid).inventory.find((s) => s.itemId === recipe.resultItemId);
    expect(minted?.instance?.rolled?.masterwork).toBe(true);

    // Dormant replay: same seed, same recipe, but attuned to armorcrafting
    // (majors armorcrafting+weaponcrafting, persisted hobby leatherworking),
    // so tailoring sits OUTSIDE the pair and the hobby: common ceiling. The
    // identical roll still draws (and lands under the proc chance), but the
    // effect is gated off entirely.
    const dormant = makeSim();
    const pid = dormant.playerId;
    dormant.acceptArchetypeQuest(ARMOR);
    expect(metaOf(dormant, pid).archetype.hobbyCraft).toBe(STATE_HOBBY); // not tailoring: dormant
    for (const r of recipe.reagents) dormant.addItem(r.itemId, r.count, pid);
    const run = observeDraws(dormant, () => dormant.craftItem(recipe.id, pid));
    expect(run.draws).toBe(1); // the proc draw is unconditional on success
    expect(run.roll).toBe(majorRun.roll); // the very roll that procced under the major
    expect(dormant.lastCraftResult?.ok).toBe(true);
    expect(dormant.lastCraftResult?.masterwork).toBeUndefined();
    expect(dormant.events.some((e) => e.type === 'masterwork')).toBe(false);
    expect(dormant.lastMasterwork).toBeNull();
    // The deterministic output still lands, plain and instance-free.
    expect(dormant.countItem(recipe.resultItemId, pid)).toBe(1);
    expect(
      metaOf(dormant, pid).inventory.some((s) => s.itemId === recipe.resultItemId && s.instance),
    ).toBe(false);
  });

  it('a hobby craft (rare ceiling) still masterworks an uncommon-def output: the rare bump sits at the ceiling', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.acceptArchetypeQuest(ARMOR);
    expect(metaOf(sim, pid).archetype.hobbyCraft).toBe(STATE_HOBBY);
    expect(ITEMS.eastbrook_ritual_vestments.quality).toBe('uncommon');
    const recipe = syntheticRecipe(STATE_HOBBY, 'eastbrook_ritual_vestments', 9);
    const { result, draws, roll } = observeDraws(sim, () =>
      resolveCraftForRecipe(ctxOf(sim), pid, recipe),
    );
    expect(draws).toBe(1);
    expect(roll).toBeLessThan(MASTERWORK_BASE_CHANCE);
    expect(result.ok).toBe(true);
    expect(result.masterwork).toBe(true);
    expect(result.quality).toBe('uncommon'); // the DEF quality; the bump rides the instance
    const minted = metaOf(sim, pid).inventory.find((s) => s.itemId === recipe.resultItemId);
    expect(minted?.instance?.rolled?.masterwork).toBe(true);
  });

  it('a hobby craft never masterworks a rare-def output: the epic bump would exceed the rare ceiling', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.acceptArchetypeQuest(ARMOR);
    expect(metaOf(sim, pid).archetype.hobbyCraft).toBe(STATE_HOBBY);
    expect(ITEMS.moggers_copper_cudgel.quality).toBe('rare');
    const recipe = syntheticRecipe(STATE_HOBBY, 'moggers_copper_cudgel', 10);
    const { result, draws, roll } = observeDraws(sim, () =>
      resolveCraftForRecipe(ctxOf(sim), pid, recipe),
    );
    expect(draws).toBe(1); // gating the EFFECT never suppresses the draw
    expect(roll).toBeLessThan(MASTERWORK_BASE_CHANCE); // this roll DID land in the proc window
    expect(result.ok).toBe(true);
    expect(result.masterwork).toBeUndefined();
    expect(result.quality).toBe('rare');
    // The rare-def output still lands as the plain SIGNED single copy (#1149
    // attribution keyed on the def quality), never a masterwork instance.
    const minted = metaOf(sim, pid).inventory.find((s) => s.itemId === recipe.resultItemId);
    expect(minted?.instance?.signer).toBe(metaOf(sim, pid).name);
    expect(minted?.instance?.rolled).toBeUndefined();
  });

  it('a major masterworks the same rare-def output the hobby could not (unlimited ceiling)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.acceptArchetypeQuest(ARMOR);
    const recipe = syntheticRecipe(ARMOR, 'moggers_copper_cudgel', 10);
    const { result, draws, roll } = observeDraws(sim, () =>
      resolveCraftForRecipe(ctxOf(sim), pid, recipe),
    );
    expect(draws).toBe(1);
    expect(roll).toBeLessThan(MASTERWORK_BASE_CHANCE);
    expect(result.ok).toBe(true);
    expect(result.masterwork).toBe(true);
    const minted = metaOf(sim, pid).inventory.find((s) => s.itemId === recipe.resultItemId);
    expect(minted?.instance?.rolled?.masterwork).toBe(true);
  });
});
