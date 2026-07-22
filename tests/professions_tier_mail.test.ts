import { describe, expect, it } from 'vitest';
import { type LetterDef, MASTER_TIER_LETTERS } from '../src/sim/content/letters';
import {
  baselineActivePairTierMail,
  normalizeTierMailOnLoad,
  updateTierMailFor,
} from '../src/sim/professions/tier_mail';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';

// The Smith pair (weaponcrafting + armorcrafting): the four wave-one masters are
// the only pairs with tier letters, and this is Forgemistress Darva's.
const PRIMARY = 'weaponcrafting';
const SECONDARY = 'armorcrafting';
const PAIR = 'weaponcrafting+armorcrafting';
// A neither-major, neither-hobby dormant craft for the negative case.
const DORMANT = 'cooking';
// The Smith pair's hobby (the craft opposite a major on the ring).
const HOBBY = 'leatherworking';
// A pre-Phase-14 non-wave-one pair: attunable only via the retired un-narrowed
// acceptance quest, a valid adjacent ring pair with NO seated master, so
// MASTER_TIER_LETTERS carries no entry for it.
const NON_WAVE_ONE_PRIMARY = 'tailoring';
const NON_WAVE_ONE_SECONDARY = 'inscription';
const NON_WAVE_ONE_PAIR = 'tailoring+inscription';

function tierSkill(tier: number): number {
  return tier * 25; // tierForSkill = floor(skill / 25)
}

function makeSim(seed = 5150): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

/** Attune the local player to the Smith pair directly (bypassing the quest), so
 *  the tier-mail sweep sees an attuned character with the two majors active. */
function attunedMeta(sim: Sim): PlayerMeta {
  const meta = sim.players.get(sim.playerId)!;
  meta.archetype.activeArchetype = PRIMARY;
  meta.archetype.pairedMajor = SECONDARY;
  meta.archetype.hobbyCraft = HOBBY;
  meta.archetype.attunedPairs = [PAIR];
  return meta;
}

function recordingCtx(): { ctx: SimContext; booked: LetterDef[] } {
  const booked: LetterDef[] = [];
  const ctx = {
    mailAuthoredLetter: (_meta: PlayerMeta, letter: LetterDef) => booked.push(letter),
  } as unknown as SimContext;
  return { ctx, booked };
}

describe('tier-crossing master mail (Professions 2.0 Phase 14)', () => {
  it('baselines an already-attuned character silently (deploy migration, no retroactive spam)', () => {
    const sim = makeSim();
    const meta = attunedMeta(sim);
    meta.craftSkills[PRIMARY] = tierSkill(3);
    meta.craftSkills[SECONDARY] = tierSkill(1);
    expect(meta.tierMailSent.size).toBe(0); // a loaded pre-Phase-14 save

    const { ctx, booked } = recordingCtx();
    expect(updateTierMailFor(meta, ctx)).toBe(false);
    expect(booked).toEqual([]); // no mail for tiers held BEFORE tracking began
    expect(meta.tierMailSent.get(PRIMARY)).toBe(3);
    expect(meta.tierMailSent.get(SECONDARY)).toBe(1);
  });

  it('pins the letterId derivation literal for every wave-one pair', () => {
    // One literal per pair: a systematic id-scheme regression on any pair's
    // tier letters must red here, not only on the smith pair.
    expect(MASTER_TIER_LETTERS['weaponcrafting+armorcrafting'][2].letterId).toBe(
      'prof_tier_weaponcrafting_armorcrafting_2',
    );
    expect(MASTER_TIER_LETTERS['leatherworking+tailoring'][3].letterId).toBe(
      'prof_tier_leatherworking_tailoring_3',
    );
    expect(MASTER_TIER_LETTERS['alchemy+cooking'][1].letterId).toBe('prof_tier_alchemy_cooking_1');
    expect(MASTER_TIER_LETTERS['engineering+alchemy'][5].letterId).toBe(
      'prof_tier_engineering_alchemy_5',
    );
  });

  it('sends exactly one letter per crossing, then stays quiet until the next crossing', () => {
    const sim = makeSim();
    const meta = attunedMeta(sim);
    meta.craftSkills[PRIMARY] = tierSkill(1);
    meta.craftSkills[SECONDARY] = tierSkill(1);
    baselineActivePairTierMail(meta); // both majors baselined at tier 1

    meta.craftSkills[PRIMARY] = tierSkill(2);
    const first = recordingCtx();
    expect(updateTierMailFor(meta, first.ctx)).toBe(true);
    // Assert the exact content entry (convention-agnostic on the letterId string).
    expect(first.booked).toEqual([MASTER_TIER_LETTERS[PAIR][2]]);
    expect(meta.tierMailSent.get(PRIMARY)).toBe(2);

    // No further skill gain: the next sweep books nothing.
    const second = recordingCtx();
    expect(updateTierMailFor(meta, second.ctx)).toBe(false);
    expect(second.booked).toEqual([]);
  });

  it('mails a SECONDARY major crossing too (both majors watched, not just the archetype)', () => {
    // Every other crossing test raises PRIMARY (activeArchetype), so a
    // regression that watched only that craft on the mailing path would
    // stay green; this arm crosses pairedMajor upward and demands its letter.
    const sim = makeSim();
    const meta = attunedMeta(sim);
    meta.craftSkills[PRIMARY] = tierSkill(1);
    meta.craftSkills[SECONDARY] = tierSkill(1);
    baselineActivePairTierMail(meta);

    meta.craftSkills[SECONDARY] = tierSkill(2);
    const { ctx, booked } = recordingCtx();
    expect(updateTierMailFor(meta, ctx)).toBe(true);
    expect(booked).toEqual([MASTER_TIER_LETTERS[PAIR][2]]);
    expect(meta.tierMailSent.get(SECONDARY)).toBe(2);
    expect(meta.tierMailSent.get(PRIMARY)).toBe(1); // untouched
  });

  it('sends only the top tier letter on a multi-tier jump', () => {
    const sim = makeSim();
    const meta = attunedMeta(sim);
    meta.craftSkills[PRIMARY] = tierSkill(1);
    meta.craftSkills[SECONDARY] = tierSkill(1);
    baselineActivePairTierMail(meta);

    meta.craftSkills[PRIMARY] = tierSkill(4); // jumped 1 -> 4 between sweeps
    const { ctx, booked } = recordingCtx();
    updateTierMailFor(meta, ctx);
    expect(booked).toEqual([MASTER_TIER_LETTERS[PAIR][4]]); // only tier 4, not 2 and 3
    expect(meta.tierMailSent.get(PRIMARY)).toBe(4);
  });

  it('baseline-arms a pre-phase non-wave-one active pair without mailing or crashing', () => {
    // A character attuned before Phase 14 (via the retired un-narrowed acceptance
    // quest) can hold any of the ten ring pairs; the four seated masters cover
    // only the wave-one pairs, so this pair has no MASTER_TIER_LETTERS entry.
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId)!;
    meta.archetype.activeArchetype = NON_WAVE_ONE_PRIMARY;
    meta.archetype.pairedMajor = NON_WAVE_ONE_SECONDARY;
    meta.archetype.attunedPairs = [NON_WAVE_ONE_PAIR];
    meta.craftSkills[NON_WAVE_ONE_PRIMARY] = tierSkill(1);
    expect(MASTER_TIER_LETTERS[NON_WAVE_ONE_PAIR]).toBeUndefined();

    // Baseline arms silently, exactly as for a wave-one pair.
    const baseline = recordingCtx();
    expect(updateTierMailFor(meta, baseline.ctx)).toBe(false);
    expect(baseline.booked).toEqual([]);
    expect(meta.tierMailSent.get(NON_WAVE_ONE_PRIMARY)).toBe(1);

    // A real tier crossing books no mail (no letters for this pair) and never
    // crashes; the reached tier is still acknowledged so it is not re-evaluated.
    meta.craftSkills[NON_WAVE_ONE_PRIMARY] = tierSkill(3);
    const crossing = recordingCtx();
    expect(updateTierMailFor(meta, crossing.ctx)).toBe(false);
    expect(crossing.booked).toEqual([]);
    expect(meta.tierMailSent.get(NON_WAVE_ONE_PRIMARY)).toBe(3);
  });

  it('acknowledges an over-cap tier beyond the authored 1..5 range without mailing', () => {
    const sim = makeSim();
    const meta = attunedMeta(sim);
    meta.craftSkills[PRIMARY] = tierSkill(5);
    meta.craftSkills[SECONDARY] = tierSkill(1);
    baselineActivePairTierMail(meta); // PRIMARY acknowledged at the authored top tier
    // Decisive precondition: the wave-one letter set really ends at tier 5.
    expect(MASTER_TIER_LETTERS[PAIR][5]).toBeDefined();
    expect(MASTER_TIER_LETTERS[PAIR][6]).toBeUndefined();

    // An over-cap skill crossing into tier 6 has no authored letter, so nothing
    // is booked; the acknowledgement still advances so the same crossing is
    // never re-evaluated by a later sweep.
    meta.craftSkills[PRIMARY] = tierSkill(6);
    const crossing = recordingCtx();
    expect(updateTierMailFor(meta, crossing.ctx)).toBe(false);
    expect(crossing.booked).toEqual([]);
    expect(meta.tierMailSent.get(PRIMARY)).toBe(6);

    const after = recordingCtx();
    expect(updateTierMailFor(meta, after.ctx)).toBe(false);
    expect(after.booked).toEqual([]);
  });

  it('stays quiet through a skill drop and re-cross, then mails only a genuinely new tier', () => {
    const sim = makeSim();
    const meta = attunedMeta(sim);
    meta.craftSkills[PRIMARY] = tierSkill(3);
    meta.craftSkills[SECONDARY] = tierSkill(1);
    baselineActivePairTierMail(meta); // PRIMARY acknowledged at tier 3

    // A mastery reset (12c) can lower craft skills: the acknowledgement never
    // regresses with the skill, so the earlier congratulation stands.
    meta.craftSkills[PRIMARY] = tierSkill(1);
    const dropped = recordingCtx();
    expect(updateTierMailFor(meta, dropped.ctx)).toBe(false);
    expect(dropped.booked).toEqual([]);
    expect(meta.tierMailSent.get(PRIMARY)).toBe(3);

    // Re-crossing an already-acknowledged tier delivers nothing: no duplicate
    // congratulations for ground regained.
    meta.craftSkills[PRIMARY] = tierSkill(3);
    const recrossed = recordingCtx();
    expect(updateTierMailFor(meta, recrossed.ctx)).toBe(false);
    expect(recrossed.booked).toEqual([]);
    expect(meta.tierMailSent.get(PRIMARY)).toBe(3);

    // Only a tier never acknowledged before mails: exactly the tier-4 letter.
    meta.craftSkills[PRIMARY] = tierSkill(4);
    const fresh = recordingCtx();
    expect(updateTierMailFor(meta, fresh.ctx)).toBe(true);
    expect(fresh.booked).toEqual([MASTER_TIER_LETTERS[PAIR][4]]);
    expect(meta.tierMailSent.get(PRIMARY)).toBe(4);
  });

  it('never mails for an unattuned character, a hobby craft, or a dormant craft', () => {
    // Unattuned: activeArchetype null -> a complete no-op, tierMailSent stays empty.
    const simUnattuned = makeSim();
    const unattuned = simUnattuned.players.get(simUnattuned.playerId)!;
    unattuned.craftSkills[PRIMARY] = tierSkill(3);
    const un = recordingCtx();
    expect(updateTierMailFor(unattuned, un.ctx)).toBe(false);
    expect(un.booked).toEqual([]);
    expect(unattuned.tierMailSent.size).toBe(0);

    // Attuned: raising the hobby or a dormant craft books nothing (only the two
    // active majors are watched); the majors are baselined silently.
    const sim = makeSim();
    const meta = attunedMeta(sim);
    meta.craftSkills[HOBBY] = tierSkill(3);
    meta.craftSkills[DORMANT] = tierSkill(3);
    const { ctx, booked } = recordingCtx();
    baselineActivePairTierMail(meta); // majors baselined at tier 0
    meta.craftSkills[HOBBY] = tierSkill(4);
    meta.craftSkills[DORMANT] = tierSkill(4);
    expect(updateTierMailFor(meta, ctx)).toBe(false);
    expect(booked).toEqual([]);
    expect(meta.tierMailSent.has(HOBBY)).toBe(false);
    expect(meta.tierMailSent.has(DORMANT)).toBe(false);
  });

  it('round-trips the acknowledged tiers and never re-fires on load', () => {
    const sim = makeSim();
    const meta = attunedMeta(sim);
    meta.craftSkills[PRIMARY] = tierSkill(2);
    meta.craftSkills[SECONDARY] = tierSkill(2);
    baselineActivePairTierMail(meta);
    meta.craftSkills[PRIMARY] = tierSkill(3);
    updateTierMailFor(meta, recordingCtx().ctx); // acknowledges tier 3

    const saved = sim.serializeCharacter(sim.playerId);
    expect(saved?.tierMailSent).toMatchObject({ [PRIMARY]: 3, [SECONDARY]: 2 });

    const reloaded = makeSim(5151);
    const pid = reloaded.addPlayer('warrior', 'Reloaded', { state: saved ?? undefined });
    const reloadedMeta = reloaded.players.get(pid)!;
    expect(reloadedMeta.tierMailSent.get(PRIMARY)).toBe(3);
    // The persisted acknowledgement means the same tier never re-mails on load.
    const afterLoad = recordingCtx();
    expect(updateTierMailFor(reloadedMeta, afterLoad.ctx)).toBe(false);
    expect(afterLoad.booked).toEqual([]);
  });

  it('serializes no tierMailSent key for an unattuned character (zero-default omission)', () => {
    const sim = makeSim();
    const saved = sim.serializeCharacter(sim.playerId);
    expect(saved && 'tierMailSent' in saved).toBe(false);
  });

  it('normalizeTierMailOnLoad drops invalid entries and keeps valid ones', () => {
    expect(normalizeTierMailOnLoad(undefined).size).toBe(0);
    expect([
      ...normalizeTierMailOnLoad({
        [PRIMARY]: 3,
        [SECONDARY]: 0,
        bad: Number.NaN,
        alsoBad: -1,
        infinite: Infinity,
      }).entries(),
    ]).toEqual([
      [PRIMARY, 3],
      [SECONDARY, 0],
    ]);
  });
});
