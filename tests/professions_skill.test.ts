import { describe, expect, it } from 'vitest';
import { CRAFT_RING } from '../src/sim/content/professions';
import { recipeById } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { archetypeCeilingFor, craftSkillGainMultiplier } from '../src/sim/professions/archetype';
import {
  emptyCraftSkills,
  gainCraftSkill,
  MINIMAL_TIER_MULTIPLIER,
  normalizeCraftSkills,
  tierCapability,
  tierForSkill,
  tierProgressMultiplier,
} from '../src/sim/professions/wheel';
import { Sim } from '../src/sim/sim';

describe('flat per-craft skill tracking (#1126)', () => {
  it('starts every one of the ten crafts at 0', () => {
    const skills = emptyCraftSkills();
    expect(Object.keys(skills).sort()).toEqual(CRAFT_RING.map((c) => c.id).sort());
    for (const craft of CRAFT_RING) expect(skills[craft.id]).toBe(0);
  });

  it('gaining skill in one craft never changes any other craft', () => {
    const skills = emptyCraftSkills();
    gainCraftSkill(skills, 'armorcrafting', 5);
    expect(skills.armorcrafting).toBe(5);
    for (const craft of CRAFT_RING) {
      if (craft.id === 'armorcrafting') continue;
      expect(skills[craft.id]).toBe(0);
    }
  });

  it('gains are purely additive across repeated calls', () => {
    const skills = emptyCraftSkills();
    gainCraftSkill(skills, 'weaponcrafting', 3);
    gainCraftSkill(skills, 'weaponcrafting', 4);
    expect(skills.weaponcrafting).toBe(7);
  });

  it('every one of the ten crafts stays independent under simultaneous gains', () => {
    const skills = emptyCraftSkills();
    CRAFT_RING.forEach((craft, i) => {
      gainCraftSkill(skills, craft.id, i + 1);
    });
    CRAFT_RING.forEach((craft, i) => {
      expect(skills[craft.id]).toBe(i + 1);
    });
  });

  it('a non-positive amount is a no-op', () => {
    const skills = emptyCraftSkills();
    gainCraftSkill(skills, 'alchemy', 0);
    gainCraftSkill(skills, 'alchemy', -5);
    expect(skills.alchemy).toBe(0);
  });

  it('an unknown craft id is a no-op (never adds a stray key)', () => {
    const skills = emptyCraftSkills();
    gainCraftSkill(skills, 'not-a-craft', 5);
    expect(Object.keys(skills).sort()).toEqual(CRAFT_RING.map((c) => c.id).sort());
  });

  it('normalizeCraftSkills backfills missing crafts at 0 (additive back-compat)', () => {
    const partial = normalizeCraftSkills({ cooking: 12 });
    expect(partial.cooking).toBe(12);
    for (const craft of CRAFT_RING) {
      if (craft.id === 'cooking') continue;
      expect(partial[craft.id]).toBe(0);
    }
  });

  it('normalizeCraftSkills tolerates a missing/undefined save (pre-#1126 characters)', () => {
    const skills = normalizeCraftSkills(undefined);
    for (const craft of CRAFT_RING) expect(skills[craft.id]).toBe(0);
  });

  it('normalizeCraftSkills ignores negative or non-finite garbage values', () => {
    const skills = normalizeCraftSkills({ enchanting: -3, tailoring: Number.NaN });
    expect(skills.enchanting).toBe(0);
    expect(skills.tailoring).toBe(0);
  });
});

describe('tier capability mapping and progress curve (#1128)', () => {
  it('buckets flat skill into a tier index every 25 points', () => {
    expect(tierForSkill(0)).toBe(0);
    expect(tierForSkill(24)).toBe(0);
    expect(tierForSkill(25)).toBe(1);
    expect(tierForSkill(49)).toBe(1);
    expect(tierForSkill(50)).toBe(2);
    expect(tierForSkill(-5)).toBe(0);
  });

  it('tierCapability reads the tier bucket for one craft, independent of the rest', () => {
    const skills = emptyCraftSkills();
    gainCraftSkill(skills, 'cooking', 60);
    expect(tierCapability(skills, 'cooking')).toBe(2);
    expect(tierCapability(skills, 'alchemy')).toBe(0);
  });

  // The four-state mastery curve (orange/yellow/green/gray)
  // replaces the three-state curve and its tier-0 free floor. The tier-0 rows
  // changed value BY DESIGN: tierProgressMultiplier(5, 0) was 1 (free floor)
  // and is now 0 (gray); (3, 1) was 0 and is now 0.25 (green).
  it('orange (tiersBelow <= 0): at or above capability is full progress, tier 0 included', () => {
    expect(tierProgressMultiplier(0, 0)).toBe(1);
    expect(tierProgressMultiplier(1, 1)).toBe(1);
    expect(tierProgressMultiplier(1, 2)).toBe(1);
    expect(tierProgressMultiplier(0, 4)).toBe(1);
  });

  it('yellow (tiersBelow === 1): exactly one tier below capability is reduced (0.5)', () => {
    expect(tierProgressMultiplier(2, 1)).toBe(0.5);
    expect(tierProgressMultiplier(3, 2)).toBe(0.5);
    expect(tierProgressMultiplier(1, 0)).toBe(0.5); // tier 0 rides the same curve now
  });

  it('green (tiersBelow === 2): exactly two tiers below capability is minimal (0.25)', () => {
    expect(tierProgressMultiplier(3, 1)).toBe(0.25); // was 0 under the three-state curve
    expect(tierProgressMultiplier(4, 2)).toBe(0.25);
    expect(tierProgressMultiplier(2, 0)).toBe(0.25);
  });

  it('gray (tiersBelow >= 3): three or more tiers below capability is zero', () => {
    expect(tierProgressMultiplier(4, 1)).toBe(0);
    expect(tierProgressMultiplier(3, 0)).toBe(0);
    expect(tierProgressMultiplier(5, 0)).toBe(0); // was 1 under the retired free floor
  });

  it('pins MINIMAL_TIER_MULTIPLIER at its literal value', () => {
    expect(MINIMAL_TIER_MULTIPLIER).toBe(0.25);
  });

  it('craftSkillGainMultiplier walks the curve at the exact skill boundaries (24/25, 49/50, 74/75)', () => {
    // An unlimited-ceiling identity (craftId as the active archetype) so the
    // pins bind the raw curve, never the archetype ceiling.
    const at = (skill: number, skillReq: number): number => {
      const skills = emptyCraftSkills();
      skills.cooking = skill;
      return craftSkillGainMultiplier(skills, 'cooking', null, 'cooking', null, skillReq);
    };
    // A tier-0 recipe (skillReq 0) steps down one curve state per tier bucket.
    expect(at(24, 0)).toBe(1); // capability tier 0: orange
    expect(at(25, 0)).toBe(0.5); // tier 1: yellow
    expect(at(49, 0)).toBe(0.5);
    expect(at(50, 0)).toBe(0.25); // tier 2: green
    expect(at(74, 0)).toBe(0.25);
    expect(at(75, 0)).toBe(0); // tier 3: gray
    // The tier-appropriate ladder stays orange across every boundary: the
    // recipe tier that matches the new capability always grants full.
    expect(at(24, 0)).toBe(1);
    expect(at(25, 25)).toBe(1);
    expect(at(49, 25)).toBe(1);
    expect(at(50, 50)).toBe(1);
    expect(at(74, 50)).toBe(1);
    expect(at(75, 75)).toBe(1);
  });
});

describe('leatherworking recipe tier matches its own declared item quality (#3520)', () => {
  // Bug report: leatherworking crafts stop teaching skill once a player
  // reaches the rare-quality gear rung, even with no archetype chosen yet.
  // Root cause: recipe_duskhide_wraps declares its OUTPUT as quality 'rare'
  // (the same "rare" ceiling every craft carries before an archetype is
  // picked, archetypeCeilingFor's activeArchetype===null branch), but its
  // skillReq of 75 buckets it into recipe tier 3 (tierForSkill), one tier
  // ABOVE the tier a rare-quality recipe should occupy per the ladder every
  // other rare-quality leatherworking piece (mirewarden_jerkin/leggings/
  // treads) already follows: skillReq 50 -> tier 2 -> "rare". That mismatch
  // trips craftSkillGainMultiplier's hard recipeTier > ceilingTier gate, so
  // the recipe can never teach skill pre-archetype, not even a diminished
  // trickle, matching the "blue item gives no skill gain, and it stops at
  // skill 75" report.
  it('recipe_duskhide_wraps sits at the same tier as its declared rare quality', () => {
    const recipe = recipeById('recipe_duskhide_wraps');
    expect(recipe, 'recipe_duskhide_wraps is registered').not.toBeUndefined();
    if (!recipe) return;
    const item = ITEMS[recipe.resultItemId];
    expect(item.quality).toBe('rare');
    expect(tierForSkill(recipe.skillReq)).toBe(2); // rare == tier 2, see archetype.ts
  });

  it('a pre-archetype leatherworker can still learn skill from the rare-quality recipe', () => {
    const recipe = recipeById('recipe_duskhide_wraps');
    expect(recipe, 'recipe_duskhide_wraps is registered').not.toBeUndefined();
    if (!recipe) return;
    const skills = emptyCraftSkills();
    skills.leatherworking = 60; // capability tier 2, same rung as the recipe
    const ceilingTier = archetypeCeilingFor(null, null, 'leatherworking', null);
    expect(tierForSkill(recipe.skillReq)).toBeLessThanOrEqual(ceilingTier);
    const multiplier = craftSkillGainMultiplier(
      skills,
      null,
      null,
      'leatherworking',
      null,
      recipe.skillReq,
    );
    expect(multiplier).toBeGreaterThan(0);
  });
});

describe('Sim integration: craftSkills read surface + persistence', () => {
  const makeSim = () => new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });

  it('a fresh character has all ten crafts at 0', () => {
    const sim = makeSim();
    const skills = sim.craftSkillsFor(sim.primaryId);
    expect(Object.keys(skills).sort()).toEqual(CRAFT_RING.map((c) => c.id).sort());
    for (const craft of CRAFT_RING) expect(skills[craft.id]).toBe(0);
  });

  it('gaining skill in Armorcrafting does not change Weaponcrafting or any other craft', () => {
    const sim = makeSim();
    sim.gainCraftSkill(sim.primaryId, 'armorcrafting', 10);
    const skills = sim.craftSkillsFor(sim.primaryId);
    expect(skills.armorcrafting).toBe(10);
    for (const craft of CRAFT_RING) {
      if (craft.id === 'armorcrafting') continue;
      expect(skills[craft.id]).toBe(0);
    }
  });

  it('craftSkillsFor returns a copy, not a live reference', () => {
    const sim = makeSim();
    const first = sim.craftSkillsFor(sim.primaryId);
    first.armorcrafting = 999;
    const second = sim.craftSkillsFor(sim.primaryId);
    expect(second.armorcrafting).toBe(0);
  });

  it('craft skill persists across a save/load round trip (serializeCharacter -> addPlayer)', () => {
    const sim = makeSim();
    sim.gainCraftSkill(sim.primaryId, 'enchanting', 25);
    sim.gainCraftSkill(sim.primaryId, 'cooking', 4);
    const state = sim.serializeCharacter(sim.primaryId);
    if (state === null) throw new Error('expected a serialized character state');

    const reloaded = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = reloaded.addPlayer('warrior', 'Reloaded', { state });
    const skills = reloaded.craftSkillsFor(pid);
    expect(skills.enchanting).toBe(25);
    expect(skills.cooking).toBe(4);
    for (const craft of CRAFT_RING) {
      if (craft.id === 'enchanting' || craft.id === 'cooking') continue;
      expect(skills[craft.id]).toBe(0);
    }
  });

  it('is deterministic: two identical gain sequences produce identical craft skills', () => {
    const run = () => {
      const sim = new Sim({ seed: 99, playerClass: 'mage', autoEquip: true });
      sim.gainCraftSkill(sim.primaryId, 'jewelcrafting', 3);
      sim.gainCraftSkill(sim.primaryId, 'jewelcrafting', 2);
      sim.gainCraftSkill(sim.primaryId, 'inscription', 7);
      for (let i = 0; i < 20; i++) sim.tick();
      return sim.craftSkillsFor(sim.primaryId);
    };
    expect(run()).toEqual(run());
  });
});
