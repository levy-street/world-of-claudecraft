import { describe, expect, it } from 'vitest';
import { CRAFT_RING } from '../src/sim/content/professions';
import {
  emptyCraftSkills,
  gainCraftSkill,
  normalizeCraftSkills,
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
