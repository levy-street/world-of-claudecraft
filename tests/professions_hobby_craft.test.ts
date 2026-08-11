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

  it("b. completing the acceptance quest grants a hobby: one of the pair's two ring-opposite candidates", () => {
    const sim = makeSim();
    sim.acceptArchetypeQuest(CRAFT_A);
    // CRAFT_A is engineering; acceptArchetypeQuest pairs it with its
    // combo-aware default major, alchemy (the Bombardier pair). The two ring
    // opposites are inscription (opposite engineering, ring index 5) and
    // enchanting (opposite alchemy, ring index 6). Since the inscription
    // base catalog landed (INSCRIPTION_RECIPES, Masterwrought phase 06),
    // both candidates carry content (professions/archetype.ts
    // CRAFTS_WITH_CONTENT), so defaultHobbyForPair's content-availability
    // tiebreak no longer separates them and the ring-order tie break picks
    // inscription (5) over enchanting (6): the phase 05 Trapper-flip
    // precedent (see tests/professions_archetype.test.ts for the general
    // rule).
    expect(sim.hobbyCraft).toBe('inscription');
  });

  it('c. switching the active archetype re-derives the deterministic default hobby for the new pair', () => {
    const sim = makeSim();
    sim.acceptArchetypeQuest(CRAFT_A);
    expect(sim.hobbyCraft).toBe('inscription'); // the phase 06 Bombardier default (see b)

    const required = sim.archetypeAmendsRequired;
    for (let i = 0; i < required; i++) sim.advanceAmendsProgress();
    const switched = sim.switchArchetype(CRAFT_B);
    expect(switched).toBe(true);

    // CRAFT_B is alchemy: its combo-aware default pair is alchemy+engineering,
    // whose two opposite candidates are enchanting (opposite alchemy, ring
    // index 6) and inscription (opposite engineering, ring index 5). With
    // zero retained skill, and with both candidates carrying content since
    // the inscription base catalog landed (INSCRIPTION_RECIPES, Masterwrought
    // phase 06; professions/archetype.ts CRAFTS_WITH_CONTENT), the
    // content-availability tiebreak is a wash and the ring-order tie break
    // picks inscription (5) over enchanting (6).
    // Pinned as literals so a change to the pair-default or hobby-default
    // rule reddens here deliberately (see tests/professions_archetype.test.ts
    // for the skill-preference and content-availability arms).
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
    // The real persisted hobby is passed explicitly as the 4th arg, matching
    // every production call site (crafting.ts, combo_eligibility.ts). Since
    // the phase 06 inscription catalog this pair's derived default happens
    // to coincide with the legacy single-craft getHobbyCraft fallback (both
    // inscription), but the explicit arg stays: production always passes the
    // persisted hobby, and the two diverge again whenever a tiebreak (e.g. a
    // retained-skill preference for enchanting) picks the other candidate.
    expect(
      archetypeCeilingFor(
        sim.activeArchetype,
        meta.archetype.pairedMajor,
        hobby as string,
        hobby as string,
      ),
    ).toBe(2);
  });
});
