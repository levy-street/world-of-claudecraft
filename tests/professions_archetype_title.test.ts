// Archetype title (issue #1130, re-scoped per the comment on the live issue): a
// player's currently-active archetype (see src/sim/professions/archetype.ts,
// issue #1129) grants the named title for that craft. There is no "Jack of All
// Trades" fallback under this model since a character has at most one active
// archetype at a time; the natural analog of the old "below rare grants no
// title" rule is the pre-acceptance-quest state, which grants no title at all.

import { describe, expect, it } from 'vitest';
import { CRAFT_RING } from '../src/sim/content/professions';
import { getArchetypeTitle } from '../src/sim/professions/archetype';
import { Sim } from '../src/sim/sim';

function makeSim(seed = 7) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

const CRAFT_A = CRAFT_RING[0].id;
const CRAFT_B = CRAFT_RING[1].id;

describe('getArchetypeTitle (#1130)', () => {
  it('returns null for every one of the ten crafts when nothing is chosen', () => {
    expect(getArchetypeTitle(null)).toBeNull();
  });

  it('returns the craft id itself (the title identifier) for a valid active archetype', () => {
    for (const craft of CRAFT_RING) {
      expect(getArchetypeTitle(craft.id)).toBe(craft.id);
    }
  });

  it('returns null for an unrecognized craft id (defensive, should not happen for real state)', () => {
    expect(getArchetypeTitle('not_a_real_craft')).toBeNull();
  });
});

describe('IWorld archetypeTitle read surface (#1130)', () => {
  it('a. a fresh character (no archetype chosen yet) has no title', () => {
    const sim = makeSim();
    expect(sim.activeArchetype).toBeNull();
    expect(sim.archetypeTitle).toBeNull();
  });

  it('b. completing the acceptance quest grants the title matching the chosen craft', () => {
    const sim = makeSim();
    sim.acceptArchetypeQuest(CRAFT_A);
    expect(sim.activeArchetype).toBe(CRAFT_A);
    expect(sim.archetypeTitle).toBe(CRAFT_A);
  });

  it('c. switching the active archetype updates the granted title to match the new archetype', () => {
    const sim = makeSim();
    sim.acceptArchetypeQuest(CRAFT_A);
    expect(sim.archetypeTitle).toBe(CRAFT_A);

    const required = sim.archetypeAmendsRequired;
    for (let i = 0; i < required; i++) sim.advanceAmendsProgress();
    const switched = sim.switchArchetype(CRAFT_B);
    expect(switched).toBe(true);

    expect(sim.activeArchetype).toBe(CRAFT_B);
    expect(sim.archetypeTitle).toBe(CRAFT_B);
  });

  it('d. a blocked switch attempt (insufficient amends progress) leaves the title unchanged', () => {
    const sim = makeSim();
    sim.acceptArchetypeQuest(CRAFT_A);
    const switched = sim.switchArchetype(CRAFT_B);
    expect(switched).toBe(false);
    expect(sim.archetypeTitle).toBe(CRAFT_A);
  });

  it('e. per-pid read surface (archetypeTitleFor) matches the primary-player getter', () => {
    const sim = makeSim();
    sim.acceptArchetypeQuest(CRAFT_A);
    expect(sim.archetypeTitleFor(sim.playerId)).toBe(sim.archetypeTitle);
  });
});
