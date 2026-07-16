// Empowerment ceiling composition (issue #1129/#1203/#1638 review): an archetype
// is an ADJACENT PAIR (the two majors), not a single craft (see the module
// comment on src/sim/professions/archetype.ts). This pins the reachable-ceiling
// math that makes it matter (archetypeCeilingFor/craftCeiling) plus its
// composition into crafting.ts's tier-progress multiplier, output-quality clamp,
// and combo-recipe gate.

import { describe, expect, it } from 'vitest';
import { CRAFT_RING, oppositeCraft } from '../src/sim/content/professions';
import { COMBO_RECIPES } from '../src/sim/content/recipes';
import { archetypeCeilingFor, craftCeiling } from '../src/sim/professions/archetype';
import { meetsComboRequirement, resolveCraftForRecipe } from '../src/sim/professions/crafting';
import { clampMaterialRarity } from '../src/sim/professions/gathering';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { type CraftSkills, emptyCraftSkills, tierCapability } from '../src/sim/professions/wheel';
import { Sim } from '../src/sim/sim';

const ARMOR = CRAFT_RING[0].id; // 'armorcrafting'
// The second major acceptArchetypeQuest(ARMOR) defaults to: pinned as a
// LITERAL (not recomputed via adjacentCrafts/defaultPairedMajor) so a change
// to the default-pair rule reddens here deliberately. armorcrafting's content
// combo partner (recipes.ts COMBO_RECIPES) is weaponcrafting, its ring-next
// neighbor, so the combo-aware default picks it over the ring-prev neighbor.
const PAIRED_MAJOR = 'weaponcrafting';
const COOKING = oppositeCraft(ARMOR).id; // opposite of ARMOR (the title major) -> the hobby
const OUTSIDE = CRAFT_RING.find((c) => ![ARMOR, PAIRED_MAJOR, COOKING].includes(c.id))!.id;

function skillsAt(craftId: string, skill: number): CraftSkills {
  const skills = emptyCraftSkills();
  skills[craftId] = skill;
  return skills;
}

describe('archetypeCeilingFor (#1129/#1203 empowerment ceiling, pair model)', () => {
  it('is uncapped-to-rare for every craft before any archetype has been chosen', () => {
    expect(archetypeCeilingFor(null, null, ARMOR)).toBe(2);
    expect(archetypeCeilingFor(null, null, COOKING)).toBe(2);
    expect(archetypeCeilingFor(null, null, OUTSIDE)).toBe(2);
  });

  it('is unlimited for the title-quest major itself', () => {
    expect(archetypeCeilingFor(ARMOR, PAIRED_MAJOR, ARMOR)).toBe(Infinity);
  });

  it('is unlimited for the second (ring-adjacent) major too: both majors, not just one', () => {
    expect(archetypeCeilingFor(ARMOR, PAIRED_MAJOR, PAIRED_MAJOR)).toBe(Infinity);
  });

  it('is capped at rare (tier 2) for the hobby: the opposite craft on CRAFT_RING from the title major', () => {
    expect(archetypeCeilingFor(ARMOR, PAIRED_MAJOR, COOKING)).toBe(2);
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
    const skills = skillsAt(COOKING, 500);
    expect(craftCeiling(skills, ARMOR, PAIRED_MAJOR, COOKING)).toBe(2);
  });

  it('hobby craft with raw skill below the rare ceiling is bounded by the raw skill instead', () => {
    const skills = skillsAt(COOKING, 10); // tierCapability = 0
    expect(craftCeiling(skills, ARMOR, PAIRED_MAJOR, COOKING)).toBe(0);
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

  it('defaults activeArchetype/pairedMajor to null (uncapped-to-rare), unchanged for existing raw-skills callers', () => {
    const skills = { ...emptyCraftSkills(), [ARMOR]: 25, [PAIRED_MAJOR]: 25 };
    // Both crafts individually reach tier 1 with no archetype context passed at all.
    expect(meetsComboRequirement(skills, recipe)).toBe(true);
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

  it('the hobby craft can still meet a minTier-1 (below the rare ceiling) combo requirement', () => {
    const hobbyCombo = { craftA: ARMOR, craftB: COOKING, minTier: 1 };
    const skills = { ...emptyCraftSkills(), [ARMOR]: 25, [COOKING]: 25 };
    const hobbyRecipe = { comboRequirement: hobbyCombo } as unknown as ProfessionRecipeRecord;
    expect(meetsComboRequirement(skills, hobbyRecipe, ARMOR, PAIRED_MAJOR)).toBe(true);
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
      trivialAt: 100,
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
      trivialAt: 50,
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
      trivialAt: 25,
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
      trivialAt: 200,
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
      trivialAt: 200,
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
    meta.craftSkills[COOKING] = 50; // tierCapability = 2 (rare), exactly at the hobby ceiling

    const recipe: ProfessionRecipeRecord = {
      id: 'test_recipe_tier3_hobby',
      professionId: COOKING,
      resultItemId: 'bone_fragments',
      resultCount: 1,
      reagents: [],
      skillReq: 75, // recipeTier = 3, above the rare ceiling
      trivialAt: 100,
      itemLevelBudget: 10,
      level: 10,
    };
    const result = resolveCraftForRecipe(ctxOf(sim), pid, recipe);

    expect(result.ok).toBe(true);
    expect(meta.craftSkills[COOKING]).toBe(50); // frozen at the rare ceiling
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
      trivialAt: 200,
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
    meta.craftSkills[COOKING] = 30; // raw capability 1, below the rare (2) hobby ceiling

    const recipe: ProfessionRecipeRecord = {
      id: 'test_recipe_tier2_hobby_climb',
      professionId: COOKING,
      resultItemId: 'bone_fragments',
      resultCount: 1,
      reagents: [],
      skillReq: 50, // recipeTier = 2: above raw capability, exactly at the ceiling
      trivialAt: 100,
      itemLevelBudget: 10,
      level: 10,
    };
    const result = resolveCraftForRecipe(ctxOf(sim), pid, recipe);

    expect(result.ok).toBe(true);
    expect(meta.craftSkills[COOKING]).toBe(31); // full progress up to the ceiling
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
      trivialAt: 100,
      itemLevelBudget: 10,
      level: 10,
    };
    const result = resolveCraftForRecipe(ctxOf(sim), pid, recipe);

    expect(result.ok).toBe(true);
    expect(meta.craftSkills[ARMOR]).toBe(60); // frozen: attunement is what unlocks tiers 3+
  });
});

describe('resolveCraftForRecipe clamps output quality to the empowerment ceiling (#1129)', () => {
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

  // At skill 100 the rarity roll's `common` weight is exactly 0 (gathering.ts
  // MATERIAL_RARITY_MAX_PROFICIENCY), so EVERY draw yields uncommon or better:
  // these two arms are decisive for any rng draw, no seed hunting.
  it('a dormant craft with maxed raw skill still only ever produces common output', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.acceptArchetypeQuest(ARMOR);
    const meta = metaOf(sim, pid);
    meta.craftSkills[OUTSIDE] = 100; // raw roll can never be common; ceiling is common (0)

    const recipe: ProfessionRecipeRecord = {
      id: 'test_recipe_quality_dormant',
      professionId: OUTSIDE,
      resultItemId: 'bone_fragments',
      resultCount: 1,
      reagents: [],
      skillReq: 0,
      trivialAt: 25,
      itemLevelBudget: 1,
      level: 1,
    };
    const result = resolveCraftForRecipe(ctxOf(sim), pid, recipe);

    expect(result.ok).toBe(true);
    expect(result.quality).toBe('common'); // clamped down from a guaranteed uncommon+ roll
  });

  it('a major with maxed raw skill is never clamped down to common', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.acceptArchetypeQuest(ARMOR);
    const meta = metaOf(sim, pid);
    meta.craftSkills[ARMOR] = 100;

    const recipe: ProfessionRecipeRecord = {
      id: 'test_recipe_quality_major',
      professionId: ARMOR,
      resultItemId: 'bone_fragments',
      resultCount: 1,
      reagents: [],
      skillReq: 0,
      trivialAt: 25,
      itemLevelBudget: 1,
      level: 1,
    };
    const result = resolveCraftForRecipe(ctxOf(sim), pid, recipe);

    expect(result.ok).toBe(true);
    expect(result.quality).not.toBe('common'); // unlimited ceiling: the raw roll stands
  });

  it('clampMaterialRarity lowers a roll to the cap and never raises one', () => {
    expect(clampMaterialRarity('legendary', 2)).toBe('rare');
    expect(clampMaterialRarity('epic', 0)).toBe('common');
    expect(clampMaterialRarity('uncommon', 2)).toBe('uncommon'); // below the cap: untouched
    expect(clampMaterialRarity('common', 4)).toBe('common'); // a cap never raises a roll
    expect(clampMaterialRarity('legendary', Infinity)).toBe('legendary'); // no-op ceiling
  });
});
