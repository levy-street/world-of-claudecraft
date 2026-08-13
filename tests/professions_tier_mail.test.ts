import { describe, expect, it } from 'vitest';
import { type LetterDef, MASTER_TIER_LETTERS } from '../src/sim/content/letters';
import { requiredAmendsProgress } from '../src/sim/professions/archetype';
import {
  baselineActivePairTierMail,
  normalizeTierMailOnLoad,
  pruneTierMailToActiveMajors,
  updateTierMailFor,
} from '../src/sim/professions/tier_mail';
import { applyProfessionQuestEffect } from '../src/sim/quests/profession_quest_effects';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { QuestDef, QuestProgress } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

// The Smith pair (weaponcrafting + armorcrafting): the four wave-one masters are
// the only pairs with tier letters, and this is Forgemistress Darva's.
const PRIMARY = 'weaponcrafting';
const SECONDARY = 'armorcrafting';
const PAIR = 'weaponcrafting+armorcrafting';
// A neither-major, neither-hobby dormant craft for the negative case.
const DORMANT = 'cooking';
// The Smith pair's hobby (the craft opposite a major on the ring).
const HOBBY = 'leatherworking';
// A legacy non-wave-one pair: attunable only via the retired un-narrowed
// acceptance quest, a valid adjacent ring pair with NO seated master, so
// MASTER_TIER_LETTERS carries no entry for it.
const NON_WAVE_ONE_PRIMARY = 'tailoring';
const NON_WAVE_ONE_SECONDARY = 'inscription';
const NON_WAVE_ONE_PAIR = 'tailoring+inscription';

function tierSkill(tier: number): number {
  return tier * 25; // tierForSkill = floor(skill / 25)
}

function makeSim(seed = 5150): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true, world: EMPTY_TEST_WORLD });
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

describe('tier-crossing master mail (Professions 2.0)', () => {
  it('baselines an already-attuned character silently (deploy migration, no retroactive spam)', () => {
    const sim = makeSim();
    const meta = attunedMeta(sim);
    meta.craftSkills[PRIMARY] = tierSkill(3);
    meta.craftSkills[SECONDARY] = tierSkill(1);
    expect(meta.tierMailSent.size).toBe(0); // a loaded legacy save

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

  it('baseline-arms a legacy non-wave-one active pair without mailing or crashing', () => {
    // A legacy character attuned via the retired un-narrowed acceptance
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

  it('a pair transition retires the outgoing majors and a return re-baselines silently', () => {
    // The retroactive-letter bug: an acknowledgement that survives switching
    // away makes a RETURN skip the silent re-baseline, so a tier crossed
    // while the pair was dormant would mail at the moment of return. Driven
    // through the REAL quest attunement path (applyProfessionQuestEffect).
    const sim = makeSim();
    const meta = attunedMeta(sim);
    meta.craftSkills[PRIMARY] = tierSkill(2);
    meta.craftSkills[SECONDARY] = tierSkill(1);
    baselineActivePairTierMail(meta); // PRIMARY:2, SECONDARY:1
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;

    // Attune AWAY to the adjacent pair that SHARES armorcrafting.
    const away = { completionEffect: { type: 'attunePair', mode: 'new' } } as unknown as QuestDef;
    const awayProgress = { selection: 'armorcrafting+engineering' } as unknown as QuestProgress;
    expect(applyProfessionQuestEffect(ctx, away, awayProgress, meta)).toBe(true);
    // The departing major's acknowledgement is retired; the shared major's
    // watch never lapsed, so its entry (and any crossing it sees) survives.
    expect(meta.tierMailSent.has(PRIMARY)).toBe(false);
    expect(meta.tierMailSent.get(SECONDARY)).toBe(1);
    // The newly-majored craft baselined at its current tier, silently.
    expect(meta.tierMailSent.get('engineering')).toBe(0);

    // While the Smith pair is dormant, its old primary crosses two tiers.
    meta.craftSkills[PRIMARY] = tierSkill(4);

    // RETURN to the Smith pair (mode 'return': the pair is in attunedPairs).
    const back = {
      completionEffect: { type: 'attunePair', mode: 'return' },
    } as unknown as QuestDef;
    const backProgress = { selection: PAIR } as unknown as QuestProgress;
    expect(applyProfessionQuestEffect(ctx, back, backProgress, meta)).toBe(true);
    // The return re-baselined at the CURRENT tier and dropped the pair-B major.
    expect(meta.tierMailSent.get(PRIMARY)).toBe(4);
    expect(meta.tierMailSent.has('engineering')).toBe(false);
    // THE pin: the next sweep books nothing. No retroactive congratulations
    // for tiers crossed while the pair was dormant.
    const sweep = recordingCtx();
    expect(updateTierMailFor(meta, sweep.ctx)).toBe(false);
    expect(sweep.booked).toEqual([]);
  });

  it('the legacy switchArchetype command prunes and baselines exactly like the quest path', () => {
    // The second transition entry point (the sim.ts IWorld command): a
    // regression that wired the prune or the baseline onto only the quest
    // path stays green there and must red here.
    const sim = makeSim();
    const meta = attunedMeta(sim);
    meta.craftSkills[PRIMARY] = tierSkill(2);
    baselineActivePairTierMail(meta); // PRIMARY:2, SECONDARY:0
    meta.archetype.amendsProgress = requiredAmendsProgress(meta.archetype.switchCount);
    expect(sim.switchArchetype('alchemy', sim.playerId)).toBe(true);
    // Neither outgoing major survives (alchemy pairs with engineering, so the
    // Smith majors both left), and the incoming majors baseline IMMEDIATELY
    // at their current tier, closing the window before the next 1 Hz sweep.
    expect(meta.archetype.activeArchetype).toBe('alchemy');
    expect([...meta.tierMailSent.entries()].sort()).toEqual([
      ['alchemy', 0],
      ['engineering', 0],
    ]);
  });

  it('the legacy acceptArchetypeQuest command baselines at accept time, so an immediate crossing mails', () => {
    // The third transition entry point (null to a first pair). Without the
    // accept-time baseline, a tier crossed between acceptance and the first
    // 1 Hz sweep is swallowed by the sweep's silent baseline arm; with it,
    // the crossing books its letter.
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId)!;
    meta.craftSkills[PRIMARY] = tierSkill(1);
    expect(sim.acceptArchetypeQuest(PRIMARY, sim.playerId)).toBe(true);
    // Accept derived the Smith pair (armorcrafting is weaponcrafting's combo
    // partner) and baselined both majors at their current tiers, silently.
    expect(meta.archetype.pairedMajor).toBe(SECONDARY);
    expect(meta.tierMailSent.get(PRIMARY)).toBe(1);
    expect(meta.tierMailSent.get(SECONDARY)).toBe(0);

    // A tier crossed immediately after acceptance, before any sweep ran:
    // the letter must be booked, not swallowed by a first-sweep baseline.
    meta.craftSkills[PRIMARY] = tierSkill(2);
    const sweep = recordingCtx();
    expect(updateTierMailFor(meta, sweep.ctx)).toBe(true);
    expect(sweep.booked).toEqual([MASTER_TIER_LETTERS[PAIR][2]]);
  });

  it('load prunes a stale acknowledgement for a craft that is not a current major', () => {
    const sim = makeSim();
    const meta = attunedMeta(sim);
    meta.craftSkills[PRIMARY] = tierSkill(2);
    baselineActivePairTierMail(meta);
    // A pre-prune save could carry an entry for a once-majored craft. DORMANT
    // is a VALID ring id, so only the majors prune (not the unknown-id arm)
    // can be what removes it on load.
    meta.tierMailSent.set(DORMANT, 1);
    const saved = sim.serializeCharacter(sim.playerId);
    expect(saved?.tierMailSent).toMatchObject({ [DORMANT]: 1 }); // serialize passes it through

    const reloaded = makeSim(5153);
    const pid = reloaded.addPlayer('warrior', 'Pruned', { state: saved ?? undefined });
    const reloadedMeta = reloaded.players.get(pid)!;
    expect(reloadedMeta.tierMailSent.has(DORMANT)).toBe(false); // healed on load
    expect(reloadedMeta.tierMailSent.get(PRIMARY)).toBe(2); // majors survive
    expect(reloadedMeta.tierMailSent.get(SECONDARY)).toBe(0);
  });

  it('pruneTierMailToActiveMajors keeps majors only, and clears all for unattuned', () => {
    const sim = makeSim();
    const meta = attunedMeta(sim);
    meta.tierMailSent.set(PRIMARY, 2);
    meta.tierMailSent.set(SECONDARY, 1);
    meta.tierMailSent.set(HOBBY, 3);
    meta.tierMailSent.set(DORMANT, 3);
    pruneTierMailToActiveMajors(meta);
    expect([...meta.tierMailSent.entries()]).toEqual([
      [PRIMARY, 2],
      [SECONDARY, 1],
    ]);

    const simUnattuned = makeSim(5154);
    const unattuned = simUnattuned.players.get(simUnattuned.playerId)!;
    unattuned.tierMailSent.set(PRIMARY, 2);
    pruneTierMailToActiveMajors(unattuned);
    expect(unattuned.tierMailSent.size).toBe(0);
  });

  it('the one-time mastery reset drops saved acknowledgements, so the re-climb mails again', () => {
    // The reset zeroes craft skills on load; a kept acknowledgement would sit
    // ABOVE the zeroed tier, and updateTierMailFor only mails on
    // currentTier > acknowledged, so the whole re-climb through previously
    // held tiers would pass in silence. Dropping the record re-baselines at
    // the reset tiers and the re-climb congratulates again.
    const sim = makeSim();
    const meta = attunedMeta(sim);
    meta.craftSkills[PRIMARY] = tierSkill(3);
    baselineActivePairTierMail(meta); // PRIMARY acknowledged at 3
    const saved = sim.serializeCharacter(sim.playerId)!;
    expect(saved.tierMailSent).toMatchObject({ [PRIMARY]: 3 });
    // Flag forced to literal false: one of the two shapes the reset gate
    // fires on (the other, the flag ABSENT, is the real pre-curve shape and
    // has its own arm below). Either way the load must take the
    // acknowledgements with the skills it zeroes.
    saved.masteryResetApplied = false;

    const reloaded = makeSim(5155);
    const pid = reloaded.addPlayer('warrior', 'Reset', { state: saved });
    const reloadedMeta = reloaded.players.get(pid)!;
    expect(reloadedMeta.craftSkills[PRIMARY]).toBe(0); // the reset fired
    expect(reloadedMeta.tierMailSent.size).toBe(0); // acknowledgements went with it

    // First sweep re-baselines at the reset tier silently; the re-climb's
    // first crossing books its letter instead of being swallowed.
    const baseline = recordingCtx();
    expect(updateTierMailFor(reloadedMeta, baseline.ctx)).toBe(false);
    reloadedMeta.craftSkills[PRIMARY] = tierSkill(1);
    const recross = recordingCtx();
    expect(updateTierMailFor(reloadedMeta, recross.ctx)).toBe(true);
    expect(recross.booked).toEqual([MASTER_TIER_LETTERS[PAIR][1]]);
  });

  it('a pre-flag save (masteryResetApplied ABSENT) also drops acknowledgements', () => {
    // The REAL pre-curve shape: old saves carry no masteryResetApplied key at
    // all (serialize has written literal true since the flag shipped), so the
    // absent arm is the one every genuine migration hits. Pinned separately
    // from the false arm above: a drop guard rewritten as `=== false` keeps
    // that arm green while silently keeping stale acknowledgements above the
    // zeroed tiers for every real pre-curve character.
    const sim = makeSim();
    const meta = attunedMeta(sim);
    meta.craftSkills[PRIMARY] = tierSkill(3);
    baselineActivePairTierMail(meta);
    const saved = sim.serializeCharacter(sim.playerId)!;
    expect(saved.tierMailSent).toMatchObject({ [PRIMARY]: 3 });
    delete saved.masteryResetApplied;

    const reloaded = makeSim(5156);
    const pid = reloaded.addPlayer('warrior', 'PreFlag', { state: saved });
    const reloadedMeta = reloaded.players.get(pid)!;
    expect(reloadedMeta.craftSkills[PRIMARY]).toBe(0); // the reset fired
    expect(reloadedMeta.tierMailSent.size).toBe(0); // acknowledgements went with it
  });

  it('accept prunes a stale acknowledgement an unattuned character carries', () => {
    // Belt and braces on the accept entry point: accept refuses when a pair
    // is already active, so its prune can only ever clear entries that
    // predate attunement. The DORMANT entry is a synthetic guard probe (the
    // load prune heals any persisted copy of this state, so only a direct
    // write reaches it); deleting the transition rule's prune half must red
    // here.
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId)!;
    meta.tierMailSent.set(DORMANT, 1);
    expect(sim.acceptArchetypeQuest(PRIMARY, sim.playerId)).toBe(true);
    expect(meta.tierMailSent.has(DORMANT)).toBe(false);
    expect(meta.tierMailSent.get(PRIMARY)).toBe(0); // baseline still armed
    expect(meta.tierMailSent.get(SECONDARY)).toBe(0);
  });

  it('a refused switch runs no part of the transition rule', () => {
    // amendsProgress stays at zero, so the switch is refused; neither the
    // prune nor the baseline may fire on a refusal. Both sentinels are
    // synthetic direct writes (production cannot reach either state), which
    // is what makes each half of the guard observable: DORMANT present would
    // be pruned, SECONDARY absent would be re-baselined, so an unguarded run
    // of either half moves the record.
    const sim = makeSim();
    const meta = attunedMeta(sim);
    meta.craftSkills[PRIMARY] = tierSkill(2);
    baselineActivePairTierMail(meta); // PRIMARY:2, SECONDARY:0
    meta.tierMailSent.set(DORMANT, 1); // prune sentinel
    meta.tierMailSent.delete(SECONDARY); // baseline sentinel (a gap to re-arm)
    expect(sim.switchArchetype('alchemy', sim.playerId)).toBe(false);
    expect(meta.archetype.activeArchetype).toBe(PRIMARY);
    // Both sides sorted, so the pin does not encode Map insertion order.
    expect([...meta.tierMailSent.entries()].sort()).toEqual(
      [
        [DORMANT, 1],
        [PRIMARY, 2],
      ].sort(),
    );
  });

  it('normalizeTierMailOnLoad keeps only KNOWN ring craft ids with valid tiers', () => {
    expect(normalizeTierMailOnLoad(undefined).size).toBe(0);
    expect([
      ...normalizeTierMailOnLoad({
        [PRIMARY]: 3,
        [SECONDARY]: 0,
        // Invalid VALUES on KNOWN ring ids: the value arm must fire on its own
        // (an unknown-id key would be dropped before the value check runs).
        [DORMANT]: Number.NaN,
        [HOBBY]: -1,
        alchemy: Infinity,
        // A VALID tier on an id not on the shipped
        // ring (a retired craft, a corrupt save) drops instead of being kept
        // forever, so the record self-heals on load.
        goldsmithing: 2,
      }).entries(),
    ]).toEqual([
      [PRIMARY, 3],
      [SECONDARY, 0],
    ]);
  });

  it('drops an unknown craft id on load while known keys survive the round trip', () => {
    const sim = makeSim();
    const meta = attunedMeta(sim);
    meta.craftSkills[PRIMARY] = tierSkill(2);
    meta.craftSkills[SECONDARY] = tierSkill(1);
    baselineActivePairTierMail(meta);
    // A stale acknowledgement written by content that no longer ships: the
    // serialize arm passes it through verbatim (the heal is load-side only).
    meta.tierMailSent.set('goldsmithing', 2);

    const saved = sim.serializeCharacter(sim.playerId);
    expect(saved?.tierMailSent).toEqual({ [PRIMARY]: 2, [SECONDARY]: 1, goldsmithing: 2 });

    const reloaded = makeSim(5152);
    const pid = reloaded.addPlayer('warrior', 'Reloaded', { state: saved ?? undefined });
    const reloadedMeta = reloaded.players.get(pid)!;
    expect(reloadedMeta.tierMailSent.has('goldsmithing')).toBe(false); // self-healed
    expect([...reloadedMeta.tierMailSent.entries()]).toEqual([
      [PRIMARY, 2],
      [SECONDARY, 1],
    ]);
    // The healed record is what the next save writes: the unknown key is gone
    // for good, never resurrected by a later serialize.
    expect(reloaded.serializeCharacter(pid)?.tierMailSent).toEqual({
      [PRIMARY]: 2,
      [SECONDARY]: 1,
    });
  });
});
