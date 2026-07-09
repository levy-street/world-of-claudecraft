// Active-archetype state and quest-gated switching (issue #1129, superseded scope).
// Per the maintainer comment on #1129 (referencing decision #107), the original
// conserved-mass budget / opposite-craft-drain model is dropped: knowledge across
// all ten crafts stays purely additive, and archetype identity is an ADJACENT
// PAIR (activeArchetype, the title craft the player swaps via quest, plus
// pairedMajor, its ring-adjacent second major). See src/sim/professions/archetype.ts.
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
import { normalizeArchetypeState } from '../src/sim/professions/archetype';
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

function archetypeOf(sim: Sim) {
  return (
    sim as unknown as {
      players: Map<
        number,
        { archetype: { activeArchetype: string | null; pairedMajor: string | null } }
      >;
    }
  ).players.get(sim.playerId)!.archetype;
}

// All pair ids below are pinned as LITERALS (never recomputed via
// adjacentCrafts/defaultPairedMajor) so a change to the default-pair rule
// reddens here deliberately, per the anti-self-comparison pin convention.
describe('the stubbed default paired major (#1129 pair model, #1638 review round 2)', () => {
  it('prefers the content-combo partner for every craft named in a combo recipe', () => {
    const expected: Array<[string, string]> = [
      ['armorcrafting', 'weaponcrafting'],
      ['weaponcrafting', 'armorcrafting'],
      ['alchemy', 'engineering'],
      ['engineering', 'alchemy'],
    ];
    for (const [attuned, pair] of expected) {
      const sim = makeSim();
      sim.acceptArchetypeQuest(attuned);
      expect(archetypeOf(sim).pairedMajor, `${attuned} pairs with ${pair}`).toBe(pair);
    }
  });

  it('falls back to the first ring-adjacent neighbor for a craft with no content combo', () => {
    const sim = makeSim();
    sim.acceptArchetypeQuest('cooking');
    expect(archetypeOf(sim).pairedMajor).toBe('engineering'); // cooking's ring-prev neighbor
  });

  it('switchArchetype re-derives the pair for the new title craft', () => {
    const sim = makeSim();
    sim.acceptArchetypeQuest('cooking');
    const required = sim.archetypeAmendsRequired;
    for (let i = 0; i < required; i++) sim.advanceAmendsProgress();
    expect(sim.switchArchetype('alchemy')).toBe(true);
    expect(archetypeOf(sim).pairedMajor).toBe('engineering'); // alchemy's combo partner
  });
});

describe('archetype persistence: pairedMajor round trip and pre-pair save backfill', () => {
  it('pairedMajor survives a serialize/reload round trip', () => {
    const sim = makeSim();
    sim.acceptArchetypeQuest('armorcrafting');
    const saved = sim.serializeCharacter(sim.playerId);
    const sim2 = makeSim();
    const pid2 = sim2.addPlayer('warrior', 'Reloaded', { state: saved ?? undefined });
    const archetype = (
      sim2 as unknown as {
        players: Map<
          number,
          { archetype: { activeArchetype: string | null; pairedMajor: string | null } }
        >;
      }
    ).players.get(pid2)!.archetype;
    expect(archetype.activeArchetype).toBe('armorcrafting');
    expect(archetype.pairedMajor).toBe('weaponcrafting');
  });

  it('a pre-pair save (activeArchetype set, no pairedMajor field) loads with the default pair', () => {
    const state = normalizeArchetypeState({
      activeArchetype: 'cooking',
      switchCount: 1,
      amendsProgress: 2,
    });
    expect(state.pairedMajor).toBe('engineering'); // backfilled, not left null
    expect(state.activeArchetype).toBe('cooking');
    expect(state.switchCount).toBe(1);
    expect(state.amendsProgress).toBe(2);
  });

  it('a saved pairedMajor that is not ring-adjacent to the title craft is replaced by the default', () => {
    const state = normalizeArchetypeState({
      activeArchetype: 'armorcrafting',
      pairedMajor: 'cooking', // opposite, not adjacent: malformed
      switchCount: 0,
      amendsProgress: 0,
    });
    expect(state.pairedMajor).toBe('weaponcrafting');
  });

  it('a saved NON-DEFAULT but ring-adjacent pairedMajor is preserved (a future quest-chosen pair)', () => {
    const state = normalizeArchetypeState({
      activeArchetype: 'armorcrafting',
      pairedMajor: 'leatherworking', // the OTHER neighbor, valid
      switchCount: 0,
      amendsProgress: 0,
    });
    expect(state.pairedMajor).toBe('leatherworking');
  });

  it('no archetype means no pair, for missing, null, and malformed saves alike', () => {
    expect(normalizeArchetypeState(undefined).pairedMajor).toBeNull();
    expect(normalizeArchetypeState(null).activeArchetype).toBeNull();
    const malformed = normalizeArchetypeState({ activeArchetype: 'not_a_craft' });
    expect(malformed.activeArchetype).toBeNull();
    expect(malformed.pairedMajor).toBeNull();
  });
});
