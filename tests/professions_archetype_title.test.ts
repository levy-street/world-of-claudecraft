// Archetype title (issue #1130, pair-named under the Professions 2.0 Phase 1
// blueprint): a player's currently-active adjacent-pair attunement (see
// src/sim/professions/archetype.ts, issue #1129) grants the named title for
// that PAIR, identified by the canonical pair id (archetypePairId). There is no
// "Jack of All Trades" fallback under this model since a character has at most
// one active pair at a time; the natural analog of the old "below rare grants
// no title" rule is the pre-acceptance-quest state, which grants no title at all.

import { describe, expect, it } from 'vitest';
import {
  ARCHETYPE_PAIR_TARGETS,
  craftsForPairTarget,
  getArchetypeTitle,
} from '../src/sim/professions/archetype';
import { Sim } from '../src/sim/sim';

function makeSim(seed = 7) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

describe('getArchetypeTitle (#1130, pair-named)', () => {
  it('returns null when no archetype is chosen', () => {
    expect(getArchetypeTitle(null, null)).toBeNull();
  });

  it('returns the canonical pair id for every selectable pair, in either major order', () => {
    for (const target of ARCHETYPE_PAIR_TARGETS) {
      const pair = craftsForPairTarget(target);
      if (!pair) throw new Error(`craftsForPairTarget rejected its own target ${target}`);
      expect(getArchetypeTitle(pair[0], pair[1])).toBe(target);
      // Canonicalization: swapping activeArchetype/pairedMajor yields the SAME id.
      expect(getArchetypeTitle(pair[1], pair[0])).toBe(target);
    }
  });

  it('returns null for a malformed pre-pair state (no paired major)', () => {
    expect(getArchetypeTitle('engineering', null)).toBeNull();
  });

  it('returns null for a non-adjacent pair (defensive, should not happen for real state)', () => {
    expect(getArchetypeTitle('engineering', 'tailoring')).toBeNull();
  });

  it('returns null for an unrecognized craft id (defensive, should not happen for real state)', () => {
    expect(getArchetypeTitle('not_a_real_craft', 'alchemy')).toBeNull();
  });
});

describe('IWorld archetypeTitle read surface (#1130, pair-named)', () => {
  it('a. a fresh character (no archetype chosen yet) has no title', () => {
    const sim = makeSim();
    expect(sim.activeArchetype).toBeNull();
    expect(sim.archetypeTitle).toBeNull();
  });

  it('b. completing the acceptance quest grants the title of the attuned pair', () => {
    const sim = makeSim();
    // The legacy single-craft acceptance path pairs engineering with its combo
    // partner alchemy (defaultPairedMajor), so the granted title identifier is
    // the canonical 'engineering+alchemy' pair id (the Bombardier pair).
    sim.acceptArchetypeQuest('engineering');
    expect(sim.activeArchetype).toBe('engineering');
    expect(sim.archetypeTitle).toBe('engineering+alchemy');
  });

  it('c. switching the active archetype updates the granted title to the new pair', () => {
    const sim = makeSim();
    sim.acceptArchetypeQuest('engineering');
    expect(sim.archetypeTitle).toBe('engineering+alchemy');

    const required = sim.archetypeAmendsRequired;
    for (let i = 0; i < required; i++) sim.advanceAmendsProgress();
    // Cooking has no combo partner, so it pairs with its first ring neighbor
    // alchemy: the canonical 'alchemy+cooking' pair id (the Apothecary pair).
    const switched = sim.switchArchetype('cooking');
    expect(switched).toBe(true);

    expect(sim.activeArchetype).toBe('cooking');
    expect(sim.archetypeTitle).toBe('alchemy+cooking');
  });

  it('d. a blocked switch attempt (insufficient amends progress) leaves the title unchanged', () => {
    const sim = makeSim();
    sim.acceptArchetypeQuest('engineering');
    const switched = sim.switchArchetype('cooking');
    expect(switched).toBe(false);
    expect(sim.archetypeTitle).toBe('engineering+alchemy');
  });

  it('e. per-pid read surface (archetypeTitleFor) matches the primary-player getter', () => {
    const sim = makeSim();
    sim.acceptArchetypeQuest('engineering');
    expect(sim.archetypeTitleFor(sim.playerId)).toBe(sim.archetypeTitle);
  });
});
