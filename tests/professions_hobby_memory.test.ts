// Quested-hobby memory (professions/hobby_memory.ts): the per-pair record that
// lets a make-amends RETURN restore the hobby a character explicitly quested for
// that pair instead of silently re-deriving the skill default.
//
// The end-to-end walkthrough through the real zone-1 quests lives in
// tests/profession_attunement_quests.test.ts ("a make-amends return restores the
// hobby this character quested for that pair"); this file owns the module's own
// arms: what records, what restores, what is refused, the legacy wrapper's
// mirror of the rule, and persistence.

import { describe, expect, it } from 'vitest';
import { oppositeCraft } from '../src/sim/content/professions';
import {
  attuneArchetypePair,
  hobbyCandidatesForPair,
  requiredAmendsProgress,
} from '../src/sim/professions/archetype';
import {
  applyPairTransitionHobbyMemory,
  normalizeHobbyMemoryOnLoad,
  recordQuestedHobby,
} from '../src/sim/professions/hobby_memory';
import { applyProfessionQuestEffect } from '../src/sim/quests/profession_quest_effects';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { QuestDef, QuestProgress } from '../src/sim/types';

// The Smith pair and its two hobby candidates (the crafts opposite its majors).
const PAIR = 'weaponcrafting+armorcrafting';
const PRIMARY = 'weaponcrafting';
const SECONDARY = 'armorcrafting';
const DEFAULT_HOBBY = 'leatherworking'; // opposite(weaponcrafting), ring-order tie break at 0 skill
const QUESTED_HOBBY = 'tailoring'; // opposite(armorcrafting), the deliberate choice
// A pair that shares NEITHER major with the Smith pair, used as the away pair.
const AWAY_PAIR = 'alchemy+cooking';
// A craft that is not a hobby candidate of the Smith pair.
const NON_CANDIDATE = 'cooking';

function makeSim(seed = 7311): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

function ctxOf(sim: Sim): SimContext {
  return (sim as unknown as { ctx: SimContext }).ctx;
}

function metaOf(sim: Sim): PlayerMeta {
  return sim.players.get(sim.playerId) as PlayerMeta;
}

/** Quest the hobby through the REAL effect path (accept-time validation plus
 *  the record), the way applyProfessionQuestEffect runs at turn-in. */
function questHobby(sim: Sim, target: string): boolean {
  const quest = { completionEffect: { type: 'switchHobby' } } as unknown as QuestDef;
  const progress = { selection: target } as unknown as QuestProgress;
  return applyProfessionQuestEffect(ctxOf(sim), quest, progress, metaOf(sim));
}

/** Attune through the REAL effect path, so the transition runs the same
 *  hobby-memory and tier-mail rules the quest turn-in runs. */
function questAttune(sim: Sim, target: string, mode: 'new' | 'return'): boolean {
  const quest = { completionEffect: { type: 'attunePair', mode } } as unknown as QuestDef;
  const progress = { selection: target } as unknown as QuestProgress;
  return applyProfessionQuestEffect(ctxOf(sim), quest, progress, metaOf(sim));
}

describe('quested-hobby memory: recording', () => {
  it('records the applied choice against the CURRENT pair, and only from the quest path', () => {
    const sim = makeSim();
    expect(attuneArchetypePair(ctxOf(sim), sim.playerId, PAIR, 'new')).toBe(true);
    // The transition itself derived the default: no record, because a default
    // the engine chose is not an explicit choice.
    expect(metaOf(sim).archetype.hobbyCraft).toBe(DEFAULT_HOBBY);
    expect(metaOf(sim).questedHobbies.size).toBe(0);

    expect(questHobby(sim, QUESTED_HOBBY)).toBe(true);
    expect(metaOf(sim).archetype.hobbyCraft).toBe(QUESTED_HOBBY);
    expect([...metaOf(sim).questedHobbies.entries()]).toEqual([[PAIR, QUESTED_HOBBY]]);
  });

  it('records nothing when the switch itself is refused', () => {
    const sim = makeSim();
    attuneArchetypePair(ctxOf(sim), sim.playerId, PAIR, 'new');
    expect(questHobby(sim, NON_CANDIDATE)).toBe(false);
    expect(metaOf(sim).archetype.hobbyCraft).toBe(DEFAULT_HOBBY);
    expect(metaOf(sim).questedHobbies.size).toBe(0);
  });

  it('is a no-op for an unattuned character and for a hobby off the pair candidates', () => {
    const sim = makeSim();
    recordQuestedHobby(metaOf(sim)); // never attuned
    expect(metaOf(sim).questedHobbies.size).toBe(0);

    attuneArchetypePair(ctxOf(sim), sim.playerId, PAIR, 'new');
    metaOf(sim).archetype.hobbyCraft = NON_CANDIDATE; // malformed state, direct write
    recordQuestedHobby(metaOf(sim));
    expect(metaOf(sim).questedHobbies.size).toBe(0);
  });

  it('keeps one entry per pair: a later quested hobby overwrites the older choice', () => {
    const sim = makeSim();
    attuneArchetypePair(ctxOf(sim), sim.playerId, PAIR, 'new');
    expect(questHobby(sim, QUESTED_HOBBY)).toBe(true);
    expect(questHobby(sim, DEFAULT_HOBBY)).toBe(true); // switch back, deliberately
    expect([...metaOf(sim).questedHobbies.entries()]).toEqual([[PAIR, DEFAULT_HOBBY]]);
  });
});

describe('quested-hobby memory: restoring at a pair transition', () => {
  it('a RETURN restores the quested hobby; the record survives the dormant period', () => {
    const sim = makeSim();
    questAttune(sim, PAIR, 'new');
    questHobby(sim, QUESTED_HOBBY);

    // Away: the away pair gets its own default, and the Smith pair's choice is
    // gone from live archetype state (only the record still holds it).
    expect(questAttune(sim, AWAY_PAIR, 'new')).toBe(true);
    expect(metaOf(sim).archetype.hobbyCraft).toBe(oppositeCraft('alchemy').id);
    expect(metaOf(sim).questedHobbies.get(PAIR)).toBe(QUESTED_HOBBY);

    expect(questAttune(sim, PAIR, 'return')).toBe(true);
    expect(metaOf(sim).archetype.hobbyCraft).toBe(QUESTED_HOBBY);
    // The record is not consumed: a second away-and-back restores it again.
    questAttune(sim, AWAY_PAIR, 'return');
    expect(questAttune(sim, PAIR, 'return')).toBe(true);
    expect(metaOf(sim).archetype.hobbyCraft).toBe(QUESTED_HOBBY);
  });

  it('a NEW attunement keeps the skill-derived default (a never-held pair cannot have a record)', () => {
    const sim = makeSim();
    questAttune(sim, PAIR, 'new');
    questHobby(sim, QUESTED_HOBBY);
    // A different pair, attuned for the first time: the default rule stands.
    expect(questAttune(sim, AWAY_PAIR, 'new')).toBe(true);
    expect(metaOf(sim).archetype.hobbyCraft).toBe(oppositeCraft('alchemy').id);
    expect(metaOf(sim).questedHobbies.has(AWAY_PAIR)).toBe(false);
  });

  it('the default still wins when the record is absent or no longer a candidate', () => {
    const sim = makeSim();
    attuneArchetypePair(ctxOf(sim), sim.playerId, PAIR, 'new');

    // Absent: the transition default is left alone.
    applyPairTransitionHobbyMemory(metaOf(sim));
    expect(metaOf(sim).archetype.hobbyCraft).toBe(DEFAULT_HOBBY);

    // Present but not a hobby candidate of this pair (a hand-edited or
    // pre-reorder value that reached the live map): ignored, default kept.
    metaOf(sim).questedHobbies.set(PAIR, NON_CANDIDATE);
    applyPairTransitionHobbyMemory(metaOf(sim));
    expect(metaOf(sim).archetype.hobbyCraft).toBe(DEFAULT_HOBBY);
    expect(hobbyCandidatesForPair(PRIMARY, SECONDARY)).not.toContain(NON_CANDIDATE);
  });

  it('the legacy switchArchetype wrapper mirrors the rule for the pair it switches INTO', () => {
    // The quest-less wrapper runs the full transition rule (the tier-mail
    // precedent), so a return through it restores the quested hobby too.
    const sim = makeSim();
    questAttune(sim, PAIR, 'new');
    questHobby(sim, QUESTED_HOBBY);
    questAttune(sim, AWAY_PAIR, 'new');
    expect(metaOf(sim).archetype.hobbyCraft).not.toBe(QUESTED_HOBBY);

    const meta = metaOf(sim);
    meta.archetype.amendsProgress = requiredAmendsProgress(meta.archetype.switchCount);
    expect(sim.switchArchetype(PRIMARY, sim.playerId)).toBe(true);
    expect(meta.archetype.pairedMajor).toBe(SECONDARY); // the combo-aware default pair
    expect(sim.hobbyCraft).toBe(QUESTED_HOBBY);
  });

  it('acceptArchetypeQuest restores a surviving record after a normalizer reset', () => {
    // The third transition entry point is NOT inert: normalizeArchetypeState
    // resets an invalid archetype block on load (a retired craft id, a
    // malformed save) while the quested-hobby record normalizes
    // independently and survives. The re-acceptance quest is then a REAL
    // pair transition, and it must restore the quested choice like the
    // other two entry points.
    const sim = makeSim();
    questAttune(sim, PAIR, 'new');
    questHobby(sim, QUESTED_HOBBY);
    const meta = metaOf(sim);
    expect(meta.questedHobbies.get(PAIR)).toBe(QUESTED_HOBBY);
    // The normalizer-reset shape: the archetype block is factory-fresh
    // (normalizeArchetypeState leaves attunedPairs empty too when the active
    // craft fails validation), while the record survives its own
    // independent normalization.
    meta.archetype.activeArchetype = null;
    meta.archetype.pairedMajor = null;
    meta.archetype.hobbyCraft = null;
    meta.archetype.attunedPairs = [];
    expect(sim.acceptArchetypeQuest(PRIMARY, sim.playerId)).toBe(true);
    expect(meta.archetype.activeArchetype).toBe(PRIMARY);
    expect(sim.hobbyCraft).toBe(QUESTED_HOBBY);
  });
});

describe('quested-hobby memory: persistence', () => {
  it('round-trips the record and restores across a reload', () => {
    const sim = makeSim();
    questAttune(sim, PAIR, 'new');
    questHobby(sim, QUESTED_HOBBY);
    questAttune(sim, AWAY_PAIR, 'new');

    const saved = sim.serializeCharacter(sim.playerId);
    expect(saved?.questedHobbies).toEqual({ [PAIR]: QUESTED_HOBBY });

    const reloaded = makeSim(7312);
    const pid = reloaded.addPlayer('warrior', 'Reloaded', { state: saved ?? undefined });
    const reloadedMeta = reloaded.players.get(pid) as PlayerMeta;
    expect(reloadedMeta.questedHobbies.get(PAIR)).toBe(QUESTED_HOBBY);
    // The reloaded character returns and still gets their quested hobby back.
    const quest = {
      completionEffect: { type: 'attunePair', mode: 'return' },
    } as unknown as QuestDef;
    const progress = { selection: PAIR } as unknown as QuestProgress;
    expect(
      applyProfessionQuestEffect(
        (reloaded as unknown as { ctx: SimContext }).ctx,
        quest,
        progress,
        reloadedMeta,
      ),
    ).toBe(true);
    expect(reloadedMeta.archetype.hobbyCraft).toBe(QUESTED_HOBBY);
  });

  it('serializes no questedHobbies key until a hobby is quested (zero-default omission)', () => {
    const sim = makeSim();
    // Not merely a fresh character: an ATTUNED one that never used the quest
    // still writes no new key, so pre-feature saves stay byte-identical.
    questAttune(sim, PAIR, 'new');
    const saved = sim.serializeCharacter(sim.playerId);
    expect(saved && 'questedHobbies' in saved).toBe(false);

    questHobby(sim, QUESTED_HOBBY);
    expect(sim.serializeCharacter(sim.playerId)?.questedHobbies).toEqual({
      [PAIR]: QUESTED_HOBBY,
    });
  });

  it('normalizeHobbyMemoryOnLoad keeps only shipped pair ids holding a candidate of that pair', () => {
    expect(normalizeHobbyMemoryOnLoad(undefined).size).toBe(0);
    expect(normalizeHobbyMemoryOnLoad(null).size).toBe(0);
    expect([
      ...normalizeHobbyMemoryOnLoad({
        [PAIR]: QUESTED_HOBBY,
        [AWAY_PAIR]: 'enchanting', // opposite(cooking): the away pair's other candidate
        // A VALID candidate under a key that is not a shipped pair id (the
        // pre-reorder canonical form, and a malformed id).
        'armorcrafting+weaponcrafting': QUESTED_HOBBY,
        'not+a+pair': QUESTED_HOBBY,
        // A KNOWN pair id whose value is not one of ITS candidates: the value
        // arm has to fire on its own, so this key is a real pair.
        'leatherworking+tailoring': QUESTED_HOBBY,
        // Non-string values from a corrupt save.
        'jewelcrafting+weaponcrafting': 7 as unknown as string,
      }).entries(),
    ]).toEqual([
      [PAIR, QUESTED_HOBBY],
      [AWAY_PAIR, 'enchanting'],
    ]);
  });

  it('drops an invalid persisted entry on load while the valid one still restores', () => {
    const sim = makeSim();
    questAttune(sim, PAIR, 'new');
    questHobby(sim, QUESTED_HOBBY);
    questAttune(sim, AWAY_PAIR, 'new');
    const saved = sim.serializeCharacter(sim.playerId);
    if (!saved) throw new Error('no save');
    // Hand-edited junk beside the real entry (the serialize arm is
    // pass-through; the heal is load-side, the tier_mail idiom).
    saved.questedHobbies = { ...saved.questedHobbies, 'not+a+pair': QUESTED_HOBBY };

    const reloaded = makeSim(7313);
    const pid = reloaded.addPlayer('warrior', 'Healed', { state: saved });
    const reloadedMeta = reloaded.players.get(pid) as PlayerMeta;
    expect([...reloadedMeta.questedHobbies.entries()]).toEqual([[PAIR, QUESTED_HOBBY]]);
  });
});

describe('the crafting identity view carries the quested-hobby record', () => {
  // The attunement dialog's pre-commit preview reads it through IWorld
  // (offline) and the cprof mirror (online, the one shared Sim builder), so
  // a make-amends return's preview names the hobby the restore will set.
  it('craftingIdentityFor includes the KEY-SORTED record once one exists, and omits it while empty', () => {
    const sim = makeSim(7331);
    const pid = sim.playerId;
    const meta = sim.players.get(pid) as PlayerMeta;
    // Zero-default omission: no field at all for a character without one, so
    // the cprof delta signature never moves for the featureless majority.
    expect('questedHobbies' in sim.craftingIdentityFor(pid)).toBe(false);

    meta.questedHobbies.set('weaponcrafting+armorcrafting', 'tailoring');
    meta.questedHobbies.set('tailoring+leatherworking', 'cooking');
    const view = sim.craftingIdentityFor(pid);
    expect(view.questedHobbies).toEqual({
      'tailoring+leatherworking': 'cooking',
      'weaponcrafting+armorcrafting': 'tailoring',
    });
    // KEY-SORTED for a stable cprof JSON signature, regardless of insertion
    // order (the Map above deliberately inserts out of sort order).
    expect(Object.keys(view.questedHobbies ?? {})).toEqual([
      'tailoring+leatherworking',
      'weaponcrafting+armorcrafting',
    ]);
  });
});
