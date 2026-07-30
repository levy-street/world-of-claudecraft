// Hobby craft (issue #1294): one opposite craft on CRAFT_RING (the same one
// archetype.ts's archetypeCeilingFor/craftCeiling already empowers up to
// rare rather than common) is a player's "hobby" alongside their active
// archetype's majors. A pure read/derivation over the #1129 active-archetype
// state, not a new mechanic: the hobby craft id IS oppositeCraft(activeArchetype).

import { describe, expect, it } from 'vitest';
import { CRAFT_RING, oppositeCraft } from '../src/sim/content/professions';
import { getHobbyCraft } from '../src/sim/professions/archetype';
import { Sim } from '../src/sim/sim';

function makeSim(seed = 11) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

const CRAFT_A = CRAFT_RING[0].id;
const CRAFT_B = CRAFT_RING[1].id;

describe('getHobbyCraft (#1294)', () => {
  it('returns null when no archetype has ever been chosen', () => {
    expect(getHobbyCraft(null)).toBeNull();
  });

  it('returns the opposite craft on CRAFT_RING for every valid active archetype', () => {
    for (const craft of CRAFT_RING) {
      expect(getHobbyCraft(craft.id)).toBe(oppositeCraft(craft.id).id);
    }
  });

  it('never returns the active archetype itself (the hobby is a DIFFERENT craft)', () => {
    for (const craft of CRAFT_RING) {
      expect(getHobbyCraft(craft.id)).not.toBe(craft.id);
    }
  });

  it('returns null for an unrecognized craft id (defensive, should not happen for real state)', () => {
    expect(getHobbyCraft('not_a_real_craft')).toBeNull();
  });
});

describe('IWorld hobbyCraft read surface (#1294)', () => {
  it('a. a fresh character (no archetype chosen yet) has no hobby', () => {
    const sim = makeSim();
    expect(sim.activeArchetype).toBeNull();
    expect(sim.hobbyCraft).toBeNull();
  });

  it('b. completing the acceptance quest grants a hobby: the opposite craft on the ring', () => {
    const sim = makeSim();
    sim.acceptArchetypeQuest(CRAFT_A);
    expect(sim.hobbyCraft).toBe(oppositeCraft(CRAFT_A).id);
  });

  it('c. switching the active archetype re-derives the deterministic default hobby for the new pair', () => {
    const sim = makeSim();
    sim.acceptArchetypeQuest(CRAFT_A);
    expect(sim.hobbyCraft).toBe(oppositeCraft(CRAFT_A).id);

    const required = sim.archetypeAmendsRequired;
    for (let i = 0; i < required; i++) sim.advanceAmendsProgress();
    const switched = sim.switchArchetype(CRAFT_B);
    expect(switched).toBe(true);

    // CRAFT_B is alchemy: its combo-aware default pair is alchemy+engineering,
    // whose two opposite candidates are enchanting (opposite alchemy) and
    // inscription (opposite engineering). With zero retained skill,
    // defaultHobbyForPair tie-breaks by ring order to inscription. Pinned as
    // literals so a change to the pair-default or hobby-default rule reddens
    // here deliberately (see tests/professions_archetype.test.ts for the
    // skill-preference arm).
    const meta = (
      sim as unknown as { players: Map<number, { archetype: { pairedMajor: string } }> }
    ).players.get(sim.playerId)!;
    expect(meta.archetype.pairedMajor).toBe('engineering');
    expect(sim.hobbyCraft).toBe('inscription');
  });

  it('d. per-pid read surface (hobbyCraftFor) matches the primary-player getter', () => {
    const sim = makeSim();
    sim.acceptArchetypeQuest(CRAFT_A);
    expect(sim.hobbyCraftFor(sim.playerId)).toBe(sim.hobbyCraft);
  });

  it('e. the empowerment ceiling for the hobby craft matches archetypeCeilingFor (rare, tier 2)', async () => {
    const { archetypeCeilingFor } = await import('../src/sim/professions/archetype');
    const sim = makeSim();
    sim.acceptArchetypeQuest(CRAFT_A);
    const hobby = sim.hobbyCraft;
    expect(hobby).not.toBeNull();
    const meta = (
      sim as unknown as { players: Map<number, { archetype: { pairedMajor: string } }> }
    ).players.get(sim.playerId)!;
    expect(
      archetypeCeilingFor(sim.activeArchetype, meta.archetype.pairedMajor, hobby as string),
    ).toBe(2);
  });
});
