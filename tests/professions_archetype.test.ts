// Active-archetype state and quest-gated switching (issue #1129, superseded scope).
// Per the maintainer comment on #1129 (referencing decision #107), the original
// conserved-mass budget / opposite-craft-drain model is dropped: knowledge across
// all ten crafts stays purely additive, and archetype identity is an ADJACENT
// PAIR (activeArchetype, the title craft the player swaps via quest, plus
// pairedMajor, its ring-adjacent second major). See src/sim/professions/archetype.ts.
//
// NOTE: the quests behind this feature (zone-1 q_archetype_acceptance /
// q_prof_make_amends / q_prof_hobby_switch) are wired live into the generic quest
// accept/turn-in flow via completionEffect (src/sim/quests/profession_quest_effects.ts);
// the quest-driven path is covered by tests/profession_attunement_quests.test.ts.
// These tests exercise the STATE MACHINE directly via its sim entry points
// (acceptArchetypeQuest / advanceAmendsProgress / switchArchetype).

import { describe, expect, it } from 'vitest';
import { CRAFT_RING, oppositeCraft } from '../src/sim/content/professions';
import {
  ARCHETYPE_PAIR_TARGETS,
  type ArchetypeState,
  archetypePairId,
  attuneArchetypePair,
  canAttuneArchetypePair,
  canSwitchHobby,
  craftsForPairTarget,
  defaultHobbyForPair,
  emptyArchetypeState,
  hobbyCandidatesForPair,
  isAdjacentPairTarget,
  normalizeArchetypeState,
  requiredAmendsProgress,
  switchHobby,
} from '../src/sim/professions/archetype';
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
    expect(archetypeOf(sim).pairedMajor).toBe('alchemy'); // cooking's ring-prev neighbor
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
    expect(state.pairedMajor).toBe('alchemy'); // backfilled, not left null
    expect(state.activeArchetype).toBe('cooking');
    expect(state.switchCount).toBe(1);
    expect(state.amendsProgress).toBe(2);
  });

  it('a saved pairedMajor that is not ring-adjacent to the title craft is replaced by the default', () => {
    const state = normalizeArchetypeState({
      activeArchetype: 'armorcrafting',
      pairedMajor: 'tailoring', // opposite, not adjacent: malformed
      switchCount: 0,
      amendsProgress: 0,
    });
    expect(state.pairedMajor).toBe('weaponcrafting');
  });

  it('a saved NON-DEFAULT but ring-adjacent pairedMajor is preserved (a future quest-chosen pair)', () => {
    const state = normalizeArchetypeState({
      activeArchetype: 'armorcrafting',
      pairedMajor: 'engineering', // the OTHER neighbor (across the ring wrap), valid
      switchCount: 0,
      amendsProgress: 0,
    });
    expect(state.pairedMajor).toBe('engineering');
  });

  it('no archetype means no pair, for missing, null, and malformed saves alike', () => {
    expect(normalizeArchetypeState(undefined).pairedMajor).toBeNull();
    expect(normalizeArchetypeState(null).activeArchetype).toBeNull();
    const malformed = normalizeArchetypeState({ activeArchetype: 'not_a_craft' });
    expect(malformed.activeArchetype).toBeNull();
    expect(malformed.pairedMajor).toBeNull();
  });

  // The shape every real production save carries: v0.26.0 shipped the archetype
  // blob with the acceptance quests retired, so activeArchetype is null (or the
  // blob is absent entirely) in every deployed row. Pin that BOTH shapes load to
  // the exact empty state, so the ring reorder's pairedMajor/attunedPairs repair
  // paths (which only run for a non-null activeArchetype) provably never touch a
  // shipped save.
  it('the deployed v0.26.0 save shapes (null archetype, bare blob) load as the exact empty state', () => {
    expect(normalizeArchetypeState({ activeArchetype: null })).toEqual(emptyArchetypeState());
    expect(normalizeArchetypeState({})).toEqual(emptyArchetypeState());
  });

  it('a saved hobby outside the pair opposites is replaced by the deterministic default', () => {
    // cooking is neither opposite of the armor/weapon majors (tailoring,
    // leatherworking), so the normalize repair must not keep it.
    const state = normalizeArchetypeState({
      activeArchetype: 'armorcrafting',
      pairedMajor: 'weaponcrafting',
      hobbyCraft: 'cooking',
    });
    expect(state.hobbyCraft).toBe('leatherworking');
  });

  it('the backfilled hobby prefers the higher retained-skill candidate from the skills argument', () => {
    const state = normalizeArchetypeState(
      { activeArchetype: 'armorcrafting', pairedMajor: 'weaponcrafting' },
      { tailoring: 10 },
    );
    expect(state.hobbyCraft).toBe('tailoring');
  });
});

// Direct pins for the ring-derived pair helpers the Professions 2.0 Phase 1
// reorder introduced. The canonical pair id is a persisted save/wire format
// (ArchetypeState.attunedPairs), so every arm below is pinned with literals.
describe('archetypePairId canonicalization (Phase 1 pair identity)', () => {
  it('joins an adjacent pair in CRAFT_RING forward order regardless of argument order', () => {
    expect(archetypePairId('engineering', 'alchemy')).toBe('engineering+alchemy');
    expect(archetypePairId('alchemy', 'engineering')).toBe('engineering+alchemy');
  });

  it('canonicalizes the ring-wrap pair as armorcrafting+engineering from either side', () => {
    expect(archetypePairId('armorcrafting', 'engineering')).toBe('armorcrafting+engineering');
    expect(archetypePairId('engineering', 'armorcrafting')).toBe('armorcrafting+engineering');
  });

  it('returns null for a non-adjacent pair, an unknown craft, and a missing second craft', () => {
    // engineering+cooking was ring-adjacent BEFORE the reorder: the old
    // geometry must not leak through as a derivable id.
    expect(archetypePairId('engineering', 'cooking')).toBeNull();
    expect(archetypePairId('not_a_craft', 'alchemy')).toBeNull();
    expect(archetypePairId('engineering', null)).toBeNull();
  });
});

describe('isAdjacentPairTarget / craftsForPairTarget (Phase 1 pair identity)', () => {
  it('accepts exactly the canonical orientation, never the reversed or pre-reorder form', () => {
    expect(isAdjacentPairTarget('weaponcrafting+armorcrafting')).toBe(true);
    // The pre-reorder canonical id of the same pair: recognized nowhere.
    expect(isAdjacentPairTarget('armorcrafting+weaponcrafting')).toBe(false);
    expect(isAdjacentPairTarget('engineering+cooking')).toBe(false);
    expect(isAdjacentPairTarget('not+a+pair')).toBe(false);
  });

  it('splits a canonical target into its two crafts and rejects everything else', () => {
    expect(craftsForPairTarget('weaponcrafting+armorcrafting')).toEqual([
      'weaponcrafting',
      'armorcrafting',
    ]);
    expect(craftsForPairTarget('armorcrafting+weaponcrafting')).toBeNull();
    expect(craftsForPairTarget('garbage')).toBeNull();
  });
});

describe('hobbyCandidatesForPair (Phase 1 ring derivation)', () => {
  it('returns the two ring opposites in argument order for every selectable pair', () => {
    for (const target of ARCHETYPE_PAIR_TARGETS) {
      const pair = craftsForPairTarget(target);
      if (!pair) throw new Error(`craftsForPairTarget rejected its own target ${target}`);
      const [a, b] = pair;
      expect(hobbyCandidatesForPair(a, b)).toEqual([oppositeCraft(a).id, oppositeCraft(b).id]);
      expect(hobbyCandidatesForPair(b, a)).toEqual([oppositeCraft(b).id, oppositeCraft(a).id]);
    }
  });

  it('pins the armor/weapon exemplar literally: tailoring and leatherworking', () => {
    expect(hobbyCandidatesForPair('weaponcrafting', 'armorcrafting')).toEqual([
      'leatherworking',
      'tailoring',
    ]);
  });

  it('returns an empty list for a non-adjacent pair and for an unknown craft', () => {
    expect(hobbyCandidatesForPair('engineering', 'tailoring')).toEqual([]);
    expect(hobbyCandidatesForPair('not_a_craft', 'alchemy')).toEqual([]);
  });
});

describe('defaultHobbyForPair skill preference (Phase 1 hobby default)', () => {
  it('tie-breaks by ring order when the retained skills are equal', () => {
    // leatherworking (ring index 3) beats tailoring (4) at zero skill.
    expect(defaultHobbyForPair('weaponcrafting', 'armorcrafting', {})).toBe('leatherworking');
    expect(
      defaultHobbyForPair('weaponcrafting', 'armorcrafting', { tailoring: 10, leatherworking: 10 }),
    ).toBe('leatherworking');
  });

  it('prefers the higher retained-skill candidate over the ring-order tie break', () => {
    expect(defaultHobbyForPair('weaponcrafting', 'armorcrafting', { tailoring: 10 })).toBe(
      'tailoring',
    );
  });

  it('returns null for a non-adjacent pair', () => {
    expect(defaultHobbyForPair('engineering', 'tailoring', {})).toBeNull();
  });
});

function ctxOf(sim: Sim) {
  return (sim as unknown as { ctx: Parameters<typeof attuneArchetypePair>[0] }).ctx;
}

function metaOf(sim: Sim) {
  return (
    sim as unknown as {
      players: Map<number, { archetype: ArchetypeState; craftSkills: Record<string, number> }>;
    }
  ).players.get(sim.playerId)!;
}

const WEAPON_ARMOR = 'weaponcrafting+armorcrafting';
const JEWEL_WEAPON = 'jewelcrafting+weaponcrafting';

describe('attuneArchetypePair / canAttuneArchetypePair mode gating (Phase 1 transitions)', () => {
  it('a first NEW attunement sets the full pair state without raising the return counter', () => {
    const sim = makeSim();
    expect(canAttuneArchetypePair(metaOf(sim).archetype, WEAPON_ARMOR, 'new')).toBe(true);
    expect(attuneArchetypePair(ctxOf(sim), sim.playerId, WEAPON_ARMOR, 'new')).toBe(true);
    expect(metaOf(sim).archetype).toEqual({
      activeArchetype: 'weaponcrafting',
      pairedMajor: 'armorcrafting',
      hobbyCraft: 'leatherworking', // zero skills: ring-order tie break
      attunedPairs: [WEAPON_ARMOR],
      switchCount: 0,
      amendsProgress: 0,
    });
  });

  it('the attunement hobby derives from the retained craft skills at transition time', () => {
    const sim = makeSim();
    metaOf(sim).craftSkills.tailoring = 10;
    expect(attuneArchetypePair(ctxOf(sim), sim.playerId, WEAPON_ARMOR, 'new')).toBe(true);
    expect(metaOf(sim).archetype.hobbyCraft).toBe('tailoring');
  });

  it('re-attuning the CURRENT pair is refused in both modes', () => {
    const sim = makeSim();
    attuneArchetypePair(ctxOf(sim), sim.playerId, WEAPON_ARMOR, 'new');
    expect(canAttuneArchetypePair(metaOf(sim).archetype, WEAPON_ARMOR, 'new')).toBe(false);
    expect(canAttuneArchetypePair(metaOf(sim).archetype, WEAPON_ARMOR, 'return')).toBe(false);
    expect(attuneArchetypePair(ctxOf(sim), sim.playerId, WEAPON_ARMOR, 'new')).toBe(false);
    expect(attuneArchetypePair(ctxOf(sim), sim.playerId, WEAPON_ARMOR, 'return')).toBe(false);
    expect(metaOf(sim).archetype.switchCount).toBe(0);
  });

  it('NEW refuses a previously held pair; RETURN attunes it, bumps switchCount, resets amends', () => {
    const sim = makeSim();
    attuneArchetypePair(ctxOf(sim), sim.playerId, WEAPON_ARMOR, 'new');
    attuneArchetypePair(ctxOf(sim), sim.playerId, JEWEL_WEAPON, 'new');
    metaOf(sim).archetype.amendsProgress = 3;

    expect(canAttuneArchetypePair(metaOf(sim).archetype, WEAPON_ARMOR, 'new')).toBe(false);
    expect(attuneArchetypePair(ctxOf(sim), sim.playerId, WEAPON_ARMOR, 'new')).toBe(false);
    expect(metaOf(sim).archetype.activeArchetype).toBe('jewelcrafting');

    expect(attuneArchetypePair(ctxOf(sim), sim.playerId, WEAPON_ARMOR, 'return')).toBe(true);
    expect(metaOf(sim).archetype).toMatchObject({
      activeArchetype: 'weaponcrafting',
      pairedMajor: 'armorcrafting',
      attunedPairs: [WEAPON_ARMOR, JEWEL_WEAPON], // history keeps both, no duplicate
      switchCount: 1,
      amendsProgress: 0,
    });
  });

  it('RETURN refuses a never-held pair and a malformed target is refused outright', () => {
    const sim = makeSim();
    attuneArchetypePair(ctxOf(sim), sim.playerId, WEAPON_ARMOR, 'new');
    expect(canAttuneArchetypePair(metaOf(sim).archetype, JEWEL_WEAPON, 'return')).toBe(false);
    expect(attuneArchetypePair(ctxOf(sim), sim.playerId, JEWEL_WEAPON, 'return')).toBe(false);
    expect(
      canAttuneArchetypePair(metaOf(sim).archetype, 'armorcrafting+weaponcrafting', 'new'),
    ).toBe(false);
    expect(
      attuneArchetypePair(ctxOf(sim), sim.playerId, 'armorcrafting+weaponcrafting', 'new'),
    ).toBe(false);
    expect(metaOf(sim).archetype.activeArchetype).toBe('weaponcrafting');
  });
});

describe('canSwitchHobby / switchHobby (Phase 1 hobby transitions)', () => {
  it('switches only to the OTHER opposite candidate of the active pair', () => {
    const sim = makeSim();
    attuneArchetypePair(ctxOf(sim), sim.playerId, WEAPON_ARMOR, 'new');
    expect(metaOf(sim).archetype.hobbyCraft).toBe('leatherworking');

    expect(canSwitchHobby(metaOf(sim).archetype, 'tailoring')).toBe(true);
    expect(switchHobby(ctxOf(sim), sim.playerId, 'tailoring')).toBe(true);
    expect(metaOf(sim).archetype.hobbyCraft).toBe('tailoring');
  });

  it('refuses the current hobby, a non-candidate craft, and a pre-attunement state', () => {
    const sim = makeSim();
    expect(canSwitchHobby(metaOf(sim).archetype, 'tailoring')).toBe(false);

    attuneArchetypePair(ctxOf(sim), sim.playerId, WEAPON_ARMOR, 'new');
    expect(canSwitchHobby(metaOf(sim).archetype, 'leatherworking')).toBe(false); // current hobby
    expect(canSwitchHobby(metaOf(sim).archetype, 'cooking')).toBe(false); // not an opposite
    expect(switchHobby(ctxOf(sim), sim.playerId, 'cooking')).toBe(false);
    expect(metaOf(sim).archetype.hobbyCraft).toBe('leatherworking');
  });
});

describe('requiredAmendsProgress escalation formula', () => {
  it('pins the 5 + 3 per prior switch ramp', () => {
    expect(requiredAmendsProgress(0)).toBe(5);
    expect(requiredAmendsProgress(1)).toBe(8);
    expect(requiredAmendsProgress(2)).toBe(11);
  });

  it('clamps a negative count to the base and floors a fractional count', () => {
    expect(requiredAmendsProgress(-3)).toBe(5);
    expect(requiredAmendsProgress(2.9)).toBe(11);
  });
});
