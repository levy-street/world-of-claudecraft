// Active-archetype state and quest-gated switching (issue #1129, superseded scope).
// Per the maintainer comment on #1129 (referencing decision #107), the original
// conserved-mass budget / opposite-craft-drain model is dropped: knowledge across
// all ten crafts stays purely additive, and archetype identity is a single active
// craft the player swaps via quest. See src/sim/professions/archetype.ts.
//
// STUB NOTE (read before extending these tests): the two quests behind this feature
// (the zone-1 acceptance lore quest and the repeatable "make amends" quest) are
// content STUBS (src/sim/content/zone1.ts, q_archetype_acceptance /
// q_prof_make_amends): placeholder giver/turn-in NPC and placeholder objective, not
// wired into the generic quest accept/turn-in flow. These tests exercise the STATE
// MACHINE directly via its sim entry points (acceptArchetypeQuest /
// advanceAmendsProgress / switchArchetype), which is what a real quest-completion
// hook would call once that content is authored.

import { describe, expect, it } from 'vitest';
import { CRAFT_RING } from '../src/sim/content/professions';
import { Sim } from '../src/sim/sim';

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

// Two distinct craft ids from the ten-craft ring, used throughout.
const CRAFT_A = CRAFT_RING[0].id;
const CRAFT_B = CRAFT_RING[1].id;
const CRAFT_C = CRAFT_RING[2].id;

describe('professions active-archetype state machine (#1129)', () => {
  it('a. completing the acceptance quest for the first time sets the active archetype', () => {
    const sim = makeSim();
    expect(sim.activeArchetype).toBeNull();
    const accepted = sim.acceptArchetypeQuest(CRAFT_A);
    expect(accepted).toBe(true);
    expect(sim.activeArchetype).toBe(CRAFT_A);
    expect(sim.archetypeSwitchCount).toBe(0);

    // A second acceptance-quest completion is a no-op: the acceptance quest only
    // ever fires once per character (see archetype.ts acceptArchetypeQuest).
    const acceptedAgain = sim.acceptArchetypeQuest(CRAFT_B);
    expect(acceptedAgain).toBe(false);
    expect(sim.activeArchetype).toBe(CRAFT_A);
  });

  it('b. switching without completing the make-amends quest is blocked (a complete no-op)', () => {
    const sim = makeSim();
    sim.acceptArchetypeQuest(CRAFT_A);
    expect(sim.archetypeAmendsProgress).toBe(0);
    expect(sim.archetypeAmendsProgress).toBeLessThan(sim.archetypeAmendsRequired);

    const switched = sim.switchArchetype(CRAFT_B);
    expect(switched).toBe(false);
    expect(sim.activeArchetype).toBe(CRAFT_A);
    expect(sim.archetypeSwitchCount).toBe(0);
    expect(sim.archetypeAmendsProgress).toBe(0);
  });

  it('c. completing the amends quest then switching increments switchCount by 1 and changes the archetype', () => {
    const sim = makeSim();
    sim.acceptArchetypeQuest(CRAFT_A);
    const required = sim.archetypeAmendsRequired;
    for (let i = 0; i < required; i++) sim.advanceAmendsProgress();
    expect(sim.archetypeAmendsProgress).toBe(required);

    const switched = sim.switchArchetype(CRAFT_B);
    expect(switched).toBe(true);
    expect(sim.activeArchetype).toBe(CRAFT_B);
    expect(sim.archetypeSwitchCount).toBe(1);
    // Progress resets for the next switch's (higher) requirement.
    expect(sim.archetypeAmendsProgress).toBe(0);
  });

  it('d. the amends requirement escalates with switchCount (two values, strictly increasing)', () => {
    const sim = makeSim();
    sim.acceptArchetypeQuest(CRAFT_A);
    const requiredAt0 = sim.archetypeAmendsRequired;
    for (let i = 0; i < requiredAt0; i++) sim.advanceAmendsProgress();
    sim.switchArchetype(CRAFT_B);
    expect(sim.archetypeSwitchCount).toBe(1);

    const requiredAt1 = sim.archetypeAmendsRequired;
    expect(requiredAt1).toBeGreaterThan(requiredAt0);

    for (let i = 0; i < requiredAt1; i++) sim.advanceAmendsProgress();
    sim.switchArchetype(CRAFT_C);
    expect(sim.archetypeSwitchCount).toBe(2);
    const requiredAt2 = sim.archetypeAmendsRequired;
    expect(requiredAt2).toBeGreaterThan(requiredAt1);
  });

  it('e. an archetype switch never mutates any of the ten craft skill values', () => {
    const sim = makeSim();
    sim.acceptArchetypeQuest(CRAFT_A);
    // Give every craft a distinct nonzero value so a bit-for-bit comparison is
    // meaningful (not just "all still zero").
    for (const craft of CRAFT_RING) {
      (
        sim as unknown as { gainCraftSkill(pid: number, craftId: string, amount: number): void }
      ).gainCraftSkill(sim.playerId, craft.id, 1);
    }
    const before = { ...sim.craftSkills };

    const required = sim.archetypeAmendsRequired;
    for (let i = 0; i < required; i++) sim.advanceAmendsProgress();
    const switched = sim.switchArchetype(CRAFT_B);
    expect(switched).toBe(true);

    const after = sim.craftSkills;
    for (const craft of CRAFT_RING) {
      expect(after[craft.id]).toBe(before[craft.id]);
    }
    expect(after).toEqual(before);
  });
});
