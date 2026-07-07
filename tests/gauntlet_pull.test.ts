import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GAUNTLET, GAUNTLET_VENUE } from '../src/sim/content/gauntlet';
import type { GauntletPullState, GauntletRun } from '../src/sim/gauntlet/state';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';

// --- local helpers (not shared; copied idioms from gauntlet.test.ts) ---

// Solo tests use the instant lobby (a join starts the run at staging on the
// spot); the two-player test needs the real lobby fill so both can join.
const makeSim = (seed = 42, instant = true) =>
  new Sim({
    seed,
    playerClass: 'warrior',
    noPlayer: true,
    gauntletAlwaysOpen: true,
    gauntletInstantLobby: instant,
  });

function recruiter(sim: Sim) {
  return [...sim.entities.values()].find((e) => e.templateId === 'gauntlet_recruiter');
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

function openAndJoin(sim: Sim, ...pids: number[]) {
  sim.tick();
  const r = recruiter(sim)!;
  for (const pid of pids) {
    teleport(sim, pid, r.pos.x, r.pos.z);
    sim.gauntletJoin(pid);
  }
}

function advanceToTrial(sim: Sim, maxTicks = 20 * 100): GauntletRun {
  for (let i = 0; i < maxTicks && sim.gauntletRuns[0]?.phase !== 'trial'; i++) sim.tick();
  return sim.gauntletRuns[0]!;
}

function pullState(sim: Sim): GauntletPullState {
  const trial = sim.gauntletRuns[0]!.trial;
  if (!trial || trial.kind !== 'pull') throw new Error('not in the pull trial');
  return trial;
}

// Test-only field control: shrink the surviving NPC rope by eliminating all but
// the first `keep` NPC contestants (direct record edit, no side effects), so the
// per-beat NPC heave (surviving-NPC-count scaled) is a known, small quantity.
function keepNpcs(run: GauntletRun, keep: number) {
  const npcs = run.contestants.filter((c) => !c.player);
  for (let i = keep; i < npcs.length; i++) npcs[i].eliminatedAtTrial = run.trialIndex;
}

const beatTime = (trial: GauntletPullState, beat: number) =>
  trial.beatAnchor + beat * GAUNTLET.pull.beatPeriodS;

function tickToTime(sim: Sim, target: number, maxTicks = 20 * 120) {
  for (let i = 0; i < maxTicks && sim.time < target - 1e-6; i++) sim.tick();
}

// Beats land exactly on 20 Hz ticks (beatAnchor = start + 2s = start + 40 ticks;
// beatPeriodS 1.1 = 22 ticks), so a spammer can land a perfect pull every beat:
// pull the moment the clock enters the perfect window, then advance the beat.
function spamPerfect(sim: Sim, pid: number, seconds = 60) {
  const perfectHalf = GAUNTLET.pull.perfectWindowS / 2;
  let nextBeat = 0;
  for (let i = 0; i < 20 * seconds; i++) {
    const trial = sim.gauntletRuns[0]?.trial;
    if (!trial || trial.kind !== 'pull' || trial.resolved) break;
    const bt = beatTime(trial, nextBeat);
    if (Math.abs(sim.time - bt) <= perfectHalf) {
      sim.gauntletPull(nextBeat, pid);
      nextBeat++;
    } else if (sim.time > bt + perfectHalf) {
      nextBeat++;
    }
    sim.tick();
  }
}

// -----------------------------------------------------------------------------
// Isolate this trial: run a single-trial gauntlet ['pull'] with a target of 12
// survivors (splice-mutate the shared content in setup, restore after).
const savedTrials = GAUNTLET.trials.slice();
const savedTargets = GAUNTLET.targetSurvivorsPerTrial.slice();
beforeAll(() => {
  GAUNTLET.trials.splice(0, GAUNTLET.trials.length, 'pull');
  GAUNTLET.targetSurvivorsPerTrial.splice(0, GAUNTLET.targetSurvivorsPerTrial.length, 12);
});
afterAll(() => {
  GAUNTLET.trials.splice(0, GAUNTLET.trials.length, ...savedTrials);
  GAUNTLET.targetSurvivorsPerTrial.splice(
    0,
    GAUNTLET.targetSurvivorsPerTrial.length,
    ...savedTargets,
  );
});

describe('gauntlet pull: beat claims', () => {
  it('an on-beat pull heaves the marker to the puller side; a beat cannot be claimed twice', () => {
    const sim = makeSim(101);
    const pid = sim.addPlayer('warrior', 'Heaver');
    openAndJoin(sim, pid);
    const run = advanceToTrial(sim);
    const trial = pullState(sim);
    keepNpcs(run, 0); // no NPC heave: the marker moves only from the player pull
    expect(trial.teamOf.get(pid)).toBe(0); // solo player is team 0 (heaves positive)

    tickToTime(sim, beatTime(trial, 0)); // land exactly on beat 0 (a perfect hit)
    const before = trial.marker;
    sim.gauntletPull(0, pid);
    const perfect = GAUNTLET.pull.pullForce * GAUNTLET.pull.perfectMult;
    expect(trial.marker).toBeCloseTo(before + perfect, 6);
    expect(trial.marker).toBeGreaterThan(before); // moved toward team 0 (positive)

    const afterFirst = trial.marker;
    sim.gauntletPull(0, pid); // same beat again: rejected, marker unchanged
    expect(trial.marker).toBe(afterFirst);
    expect(trial.claimed.get(pid)).toBe(0);
  }, 20000);

  it('a pull outside the accept window is rejected and leaves the marker untouched', () => {
    const sim = makeSim(102);
    const pid = sim.addPlayer('warrior', 'Mistimed');
    openAndJoin(sim, pid);
    const run = advanceToTrial(sim);
    keepNpcs(run, 0);
    const trial = pullState(sim);

    // Sit between beats: beat 0's true time is half a period behind (off well
    // past acceptWindowS/2), and still comfortably before braceUntil.
    tickToTime(sim, beatTime(trial, 0) + GAUNTLET.pull.beatPeriodS / 2);
    const before = trial.marker;
    sim.gauntletPull(0, pid); // stale beat: off > acceptWindowS/2 -> rejected
    expect(trial.marker).toBe(before);
    sim.gauntletPull(5, pid); // a future beat whose time has not arrived -> rejected
    expect(trial.marker).toBe(before);
    expect(trial.claimed.has(pid)).toBe(false);
  }, 20000);

  it('a perfect pull grants more force than a loose (in-window, off-beat) pull', () => {
    const sim = makeSim(103);
    const pid = sim.addPlayer('warrior', 'Timing');
    openAndJoin(sim, pid);
    const run = advanceToTrial(sim);
    keepNpcs(run, 0);
    const trial = pullState(sim);

    // Perfect: land exactly on beat 0.
    tickToTime(sim, beatTime(trial, 0));
    const p0 = trial.marker;
    sim.gauntletPull(0, pid);
    const perfectDelta = trial.marker - p0;

    // Loose: 0.10s before beat 1 (inside acceptWindowS/2 0.18, outside
    // perfectWindowS/2 0.07).
    tickToTime(sim, beatTime(trial, 1) - 0.1);
    const l0 = trial.marker;
    sim.gauntletPull(1, pid);
    const looseDelta = trial.marker - l0;

    expect(perfectDelta).toBeCloseTo(GAUNTLET.pull.pullForce * GAUNTLET.pull.perfectMult, 6);
    expect(looseDelta).toBeCloseTo(GAUNTLET.pull.pullForce, 6);
    expect(perfectDelta).toBeGreaterThan(looseDelta);
  }, 20000);
});

describe('gauntlet pull: opening brace', () => {
  it('a team that misses the opening brace eats the yank toward its opponent', () => {
    const sim = makeSim(104);
    const pid = sim.addPlayer('warrior', 'Slow');
    openAndJoin(sim, pid);
    const run = advanceToTrial(sim);
    keepNpcs(run, 0); // no NPC heave: only the yank can move the marker
    const trial = pullState(sim);
    expect(trial.marker).toBe(0);

    // Never pull, so the lone team-0 player never braces; team 1 has no players
    // (braced). Tick just past braceUntil and the yank lands against team 0.
    tickToTime(sim, trial.braceUntil + 0.2);
    expect(trial.marker).toBeCloseTo(-GAUNTLET.pull.openingYank, 6); // toward team 1
    expect(trial.braced.has(pid)).toBe(false);
  }, 20000);
});

describe('gauntlet pull: resolution', () => {
  it('a beat-perfect spammer drags the marker to its side and wins; the idle team eats lossDamage', () => {
    const sim = makeSim(105, false); // real lobby so two players can both join
    const spammer = sim.addPlayer('warrior', 'Heaver');
    const idler = sim.addPlayer('warrior', 'Slacker');
    openAndJoin(sim, spammer, idler);
    const run = advanceToTrial(sim);
    const trial = pullState(sim); // hold the ref: run.trial is nulled at resolution
    expect(trial.teamOf.get(spammer)).toBe(0);
    expect(trial.teamOf.get(idler)).toBe(1);
    keepNpcs(run, 2); // a little real NPC opposition, small enough that play decides

    spamPerfect(sim, spammer, 60);

    expect(trial.resolved).toBe(true);
    expect(trial.wonBy).toBe(0); // the spammer's side
    const sc = run.contestants.find((c) => c.entityId === spammer)!;
    const ic = run.contestants.find((c) => c.entityId === idler)!;
    expect(sc.vitality).toBe(GAUNTLET.vitalityMax); // winner: no loss
    expect(ic.vitality).toBe(GAUNTLET.vitalityMax - GAUNTLET.pull.lossDamage); // loser: the chunk
    // lossDamage (55) is not a kill, so neither player was knocked out.
    expect(run.playerStates.get(spammer)!.spectating).toBe(false);
    expect(run.playerStates.get(idler)!.spectating).toBe(false);
    expect(run.playerStates.get(spammer)!.finishedAt).not.toBeNull();
  }, 40000);
});

describe('gauntlet pull: determinism', () => {
  it('two same-seed runs with identical scripted pulls reach identical marker and vitality', () => {
    const scenario = () => {
      const sim = makeSim(106);
      const pid = sim.addPlayer('warrior', 'Twin');
      openAndJoin(sim, pid);
      const run = advanceToTrial(sim);
      const trial = pullState(sim);
      keepNpcs(run, 2); // keep NPCs so the per-beat jitter draws are exercised
      spamPerfect(sim, pid, 40);
      return {
        marker: trial.marker,
        wonBy: trial.wonBy,
        resolved: trial.resolved,
        vit: run.contestants.map((c) => c.vitality),
        elim: run.contestants.map((c) => c.eliminatedAtTrial),
      };
    };
    const a = scenario();
    const b = scenario();
    expect(a.resolved).toBe(true); // the run actually decided (a decisive comparison)
    expect(b).toEqual(a);
  }, 40000);
});

describe('gauntlet pull: rope dressing', () => {
  it('lines the surviving NPC field along both banks of the trench', () => {
    const sim = makeSim(107);
    const pid = sim.addPlayer('warrior', 'Onlooker');
    openAndJoin(sim, pid);
    const run = advanceToTrial(sim);
    const cx = run.origin.x + GAUNTLET_VENUE.pull.x;
    const npcs = run.contestants.filter((c) => !c.player && c.eliminatedAtTrial === null);
    const left = npcs.filter((c) => sim.entities.get(c.entityId)!.pos.x < cx).length;
    const right = npcs.filter((c) => sim.entities.get(c.entityId)!.pos.x > cx).length;
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    expect(left + right).toBe(npcs.length); // every NPC lands on one bank or the other
  }, 20000);
});
