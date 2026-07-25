// The one-time gathering-proficiency display heal (issue 2339): the pre-fix
// character sheet rounded its Gathering rows half-up while the deed evaluator
// and the band ladder compare the raw value with >=, so a raw 99.5 read
// "Fishing: 100" with Old Salt still locked. The heal bumps exactly the
// display band [threshold - 0.5, threshold) to the threshold on load, once
// per character (CharacterState.proficiencyDisplayHealApplied, the
// masteryResetApplied idiom), and the join-time retro pass then grants the
// stranded deeds silently.
import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import { emptyGatheringProficiency } from '../src/sim/professions/gathering';
import {
  DISPLAY_HEAL_BAND,
  healDisplayRoundedProficiency,
} from '../src/sim/professions/proficiency_display_heal';
import { type CharacterState, Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function makeSim(seed = 42): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function deedEvents(evs: SimEvent[]): Extract<SimEvent, { type: 'deedUnlocked' }>[] {
  return evs.filter((ev): ev is Extract<SimEvent, { type: 'deedUnlocked' }> => {
    return ev.type === 'deedUnlocked';
  });
}

// A pre-fix save in the stranded display band: the old sheet read both rows
// as "100" while the raw values were still below the deed threshold.
function strandedState(): CharacterState {
  return {
    level: 12,
    xp: 0,
    copper: 0,
    hp: 100,
    resource: 0,
    pos: { x: 2, z: -2 },
    facing: 0,
    equipment: {},
    inventory: [],
    questLog: [],
    questsDone: [],
    gatheringProficiency: { fishing: 99.5, mining: 99.75 },
    // A curve-era blob (Professions 2.0): without this flag the one-time
    // mastery reset zeroes the skill maps at load, BEFORE the heal and the
    // retro sweep run (the tests/deeds.test.ts veteranState precedent).
    masteryResetApplied: true,
  };
}

describe('healDisplayRoundedProficiency', () => {
  it('pins the display band to half a point, the Intl round-half-up width', () => {
    // The pre-fix sheet (formatNumber, maximumFractionDigits 0) showed a
    // threshold for any raw value at or above threshold - 0.5; the heal band
    // must match that display band exactly, no wider.
    expect(DISPLAY_HEAL_BAND).toBe(0.5);
  });

  it('bumps a value the old sheet displayed as a crossed threshold', () => {
    const prof = emptyGatheringProficiency();
    prof.fishing = 99.5;
    prof.mining = 99.75;
    expect(healDisplayRoundedProficiency(prof)).toBe(true);
    expect(prof.fishing).toBe(100);
    expect(prof.mining).toBe(100);
  });

  it('leaves values below the display band and exact thresholds alone', () => {
    const prof = emptyGatheringProficiency();
    prof.fishing = 99.25; // displayed 99: the sheet never claimed the crossing
    prof.mining = 100; // already exactly at the threshold
    prof.logging = 42.5; // fractional, but no band threshold within half a point
    expect(healDisplayRoundedProficiency(prof)).toBe(false);
    expect(prof.fishing).toBe(99.25);
    expect(prof.mining).toBe(100);
    expect(prof.logging).toBe(42.5);
  });

  it('heals every gathering profession: the logging and herbalism edges too', () => {
    // The loop covers all four professions, never just the two the issue
    // named: a regression narrowing it to mining/fishing must red here.
    const prof = emptyGatheringProficiency();
    prof.logging = 99.5;
    prof.herbalism = 99.75;
    expect(healDisplayRoundedProficiency(prof)).toBe(true);
    expect(prof.logging).toBe(100);
    expect(prof.herbalism).toBe(100);
  });

  it('heals the fishing 200 band edge, including the float-drift tail', () => {
    const prof = emptyGatheringProficiency();
    prof.fishing = 199.99; // the 0.02-per-catch climb, displayed as 200
    expect(healDisplayRoundedProficiency(prof)).toBe(true);
    expect(prof.fishing).toBe(200);
  });

  it('ignores the mid-band gain-schedule breakpoint: 150 is not a threshold', () => {
    // 150 halves the fishing gain but nothing reads it with >=: a 149.5
    // displayed "150" claimed nothing a deed or band grants, so no heal.
    const prof = emptyGatheringProficiency();
    prof.fishing = 149.5;
    expect(healDisplayRoundedProficiency(prof)).toBe(false);
    expect(prof.fishing).toBe(149.5);
  });

  it('never heals past a profession cap, even on a malformed over-cap record', () => {
    // Load normalize clamps over-cap values before the heal ever runs; the
    // pure function still refuses the 200 threshold for a 100-cap profession
    // so a malformed record can never be healed ABOVE its cap.
    const prof = emptyGatheringProficiency();
    prof.mining = 199.6;
    expect(healDisplayRoundedProficiency(prof)).toBe(false);
    expect(prof.mining).toBe(199.6);
  });
});

describe('the one-time heal on load', () => {
  it('heals a pre-fix save and grants the stranded deeds on the same join', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Stranded', { state: strandedState() });
    const meta = sim.players.get(pid)!;
    expect(meta.gatheringProficiency.fishing).toBe(100);
    expect(meta.gatheringProficiency.mining).toBe(100);
    expect(meta.deedsEarned.has('prog_fishing_100')).toBe(true);
    expect(meta.deedsEarned.has('prog_mining_100')).toBe(true);
    expect(meta.deedsEarned.has('prog_master_angler')).toBe(false); // 100 < 200
    // Renown accounting stays exact: the running total equals the catalog
    // sum over the earned set, Old Salt's 10 included.
    const catalogSum = [...meta.deedsEarned.keys()].reduce((n, id) => n + DEEDS[id].renown, 0);
    expect(meta.renown).toBe(catalogSum);
    expect(DEEDS.prog_fishing_100.renown).toBe(10);
    // The join events drain retro-flagged on the next tick: the silent Book
    // summary, never the live unlock banner.
    const evs = deedEvents(sim.tick());
    const oldSalt = evs.find((ev) => ev.deedId === 'prog_fishing_100');
    expect(oldSalt?.retro).toBe(true);
    expect(oldSalt?.pid).toBe(pid);
  });

  it('serializes the heal flag as literal true with the healed values', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Stranded', { state: strandedState() });
    const saved = sim.serializeCharacter(pid);
    expect(saved?.proficiencyDisplayHealApplied).toBe(true);
    expect(saved?.gatheringProficiency?.fishing).toBe(100);
    expect(saved?.gatheringProficiency?.mining).toBe(100);
  });

  it('never re-heals a post-fix save: 99.5 under the floored display stays 99.5', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Honest', {
      state: { ...strandedState(), proficiencyDisplayHealApplied: true },
    });
    const meta = sim.players.get(pid)!;
    expect(meta.gatheringProficiency.fishing).toBe(99.5);
    expect(meta.gatheringProficiency.mining).toBe(99.75);
    expect(meta.deedsEarned.has('prog_fishing_100')).toBe(false);
    expect(meta.deedsEarned.has('prog_mining_100')).toBe(false);
  });

  it('a raw value at or past the threshold grants on join with or without the heal', () => {
    // The granting-path acceptance check from issue 2339: the join retro
    // pass compares the raw value with >=, so a genuine 100+ earns Old Salt
    // at the next login regardless of the heal branch.
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Veteran', {
      state: {
        ...strandedState(),
        gatheringProficiency: { fishing: 123.4 },
        proficiencyDisplayHealApplied: true,
      },
    });
    const meta = sim.players.get(pid)!;
    expect(meta.gatheringProficiency.fishing).toBe(123.4);
    expect(meta.deedsEarned.has('prog_fishing_100')).toBe(true);
  });

  it('heals the 200 band edge to the cap and grants both fishing deeds', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Angler', {
      state: { ...strandedState(), gatheringProficiency: { fishing: 199.5 } },
    });
    const meta = sim.players.get(pid)!;
    expect(meta.gatheringProficiency.fishing).toBe(200);
    expect(meta.deedsEarned.has('prog_fishing_100')).toBe(true);
    expect(meta.deedsEarned.has('prog_master_angler')).toBe(true);
  });

  it('a pre-curve save (neither flag) is zeroed by the reset, never healed or granted', () => {
    // The load-order invariant: the mastery reset runs BEFORE the heal, so
    // the heal must not resurrect a value the curve migration wipes.
    const state = strandedState();
    delete state.masteryResetApplied;
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'PreCurve', { state });
    const meta = sim.players.get(pid)!;
    expect(meta.gatheringProficiency.fishing).toBe(0);
    expect(meta.gatheringProficiency.mining).toBe(0);
    expect(meta.deedsEarned.has('prog_fishing_100')).toBe(false);
    expect(meta.deedsEarned.has('prog_mining_100')).toBe(false);
  });

  it('heals a legacy professions-key-only save shape', () => {
    // Old blobs carry only the pre-rename `professions` key; the load
    // normalize folds it into gatheringProficiency BEFORE the heal runs.
    const state = strandedState();
    delete state.gatheringProficiency;
    state.professions = { fishing: 99.5 };
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Legacy', { state });
    const meta = sim.players.get(pid)!;
    expect(meta.gatheringProficiency.fishing).toBe(100);
    expect(meta.deedsEarned.has('prog_fishing_100')).toBe(true);
  });
});
