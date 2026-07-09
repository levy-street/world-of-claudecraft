import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GAUNTLET, GAUNTLET_VENUE } from '../src/sim/content/gauntlet';
import type { GauntletPullState, GauntletRun } from '../src/sim/gauntlet/state';
import { circleSizeAt, pullRampFactor } from '../src/sim/gauntlet/trial_pull';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';

// --- local helpers (not shared; copied idioms from gauntlet.test.ts) ---

// Solo tests use the instant lobby (a join starts the run at staging on the
// spot); the multiplayer tests need the real lobby fill so everyone can join.
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
// per-heave NPC pull is a known, small quantity (zero with none kept).
function keepNpcs(run: GauntletRun, keep: number) {
  const npcs = run.contestants.filter((c) => !c.player);
  for (let i = keep; i < npcs.length; i++) npcs[i].eliminatedAtTrial = run.trialIndex;
}

function tickToTime(sim: Sim, target: number, maxTicks = 20 * 120) {
  for (let i = 0; i < maxTicks && sim.time < target - 1e-6; i++) sim.tick();
}

// Plant a live circle for pid whose size at the CURRENT sim time is exactly
// `size` (a direct record edit, the keepNpcs idiom): from the size curve
// size(t) = start - (start/shrinkS)(t - spawnAt), the spawnAt that yields the
// wanted size now is t - shrinkS * (start - size) / start. Returns the id a
// click must name.
function plantCircle(sim: Sim, trial: GauntletPullState, pid: number, size: number, shrinkS = 2) {
  const id = trial.nextCircleId++;
  const start = GAUNTLET.pull.circleStartSize;
  const spawnAt = sim.time - (shrinkS * (start - size)) / start;
  trial.circles.set(pid, { id, spawnAt, shrinkS });
  return id;
}

// A deterministic near-perfect policy: every tick, click the live circle the
// first time its size dips to the target or below (one tick past the crossing,
// so the grade is high but not perfect). Sends land between ticks, exactly like
// the server's dispatch.
function clickWhenSmall(sim: Sim, pid: number, seconds = 60) {
  for (let i = 0; i < 20 * seconds; i++) {
    const trial = sim.gauntletRuns[0]?.trial;
    if (!trial || trial.kind !== 'pull' || trial.resolved) break;
    const c = trial.circles.get(pid);
    if (c && sim.time >= c.spawnAt && circleSizeAt(c, sim.time) <= GAUNTLET.pull.circleTargetSize) {
      sim.gauntletPullCircle(c.id, pid);
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

describe('gauntlet pull: circle clicks', () => {
  it('a click at exactly the target size pulls at full force; the consumed id cannot be replayed', () => {
    const sim = makeSim(101);
    const pid = sim.addPlayer('warrior', 'Heaver');
    openAndJoin(sim, pid);
    const run = advanceToTrial(sim);
    const trial = pullState(sim);
    keepNpcs(run, 0); // no NPC heave: the marker moves only from the player pull
    expect(trial.teamOf.get(pid)).toBe(0); // solo player is team 0 (pulls positive)

    const id = plantCircle(sim, trial, pid, GAUNTLET.pull.circleTargetSize);
    const before = trial.marker;
    sim.gauntletPullCircle(id, pid);
    expect(trial.marker).toBeCloseTo(before + GAUNTLET.pull.pullForceMax, 6);

    // The click consumed the circle and dealt the next one on the spot.
    const next = trial.circles.get(pid)!;
    expect(next.id).toBeGreaterThan(id);

    const afterFirst = trial.marker;
    sim.gauntletPullCircle(id, pid); // stale id: rejected, marker unchanged
    expect(trial.marker).toBe(afterFirst);
    expect(trial.circles.get(pid)!.id).toBe(next.id); // and nothing was consumed
  }, 20000);

  it('force falls off with size error in both directions and hits zero at a full target of error', () => {
    const sim = makeSim(102);
    const pid = sim.addPlayer('warrior', 'Timing');
    openAndJoin(sim, pid);
    const run = advanceToTrial(sim);
    keepNpcs(run, 0);
    const trial = pullState(sim);
    const P = GAUNTLET.pull;

    const deltaFor = (size: number): number => {
      const id = plantCircle(sim, trial, pid, size);
      const before = trial.marker;
      sim.gauntletPullCircle(id, pid);
      return trial.marker - before;
    };

    // Same |error| grades the same on both sides of the target.
    const late = deltaFor(P.circleTargetSize - 15); // too small
    const early = deltaFor(P.circleTargetSize + 15); // too large
    expect(late).toBeCloseTo(early, 6);
    expect(late).toBeCloseTo(P.pullForceMax * (1 - 15 / P.circleTargetSize) ** P.gradePower, 6);
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(P.pullForceMax);

    // A bigger error pulls less.
    const worse = deltaFor(P.circleTargetSize + 40);
    expect(worse).toBeLessThan(late);

    // A full target-size of error (or more) pulls nothing.
    expect(deltaFor(P.circleTargetSize * 2)).toBe(0);
    expect(deltaFor(0)).toBe(0);
  }, 20000);

  it('a click before the circle spawns, or naming a stale id, drops without consuming', () => {
    const sim = makeSim(103);
    const pid = sim.addPlayer('warrior', 'Eager');
    openAndJoin(sim, pid);
    const run = advanceToTrial(sim);
    keepNpcs(run, 0);
    const trial = pullState(sim);

    // A circle still in its spawn gap: visible to nobody, clickable by nobody.
    const id = trial.nextCircleId++;
    trial.circles.set(pid, { id, spawnAt: sim.time + 1, shrinkS: 2 });
    const before = trial.marker;
    sim.gauntletPullCircle(id, pid);
    expect(trial.marker).toBe(before);
    expect(trial.circles.get(pid)!.id).toBe(id); // not consumed

    sim.gauntletPullCircle(id + 5, pid); // a made-up id
    expect(trial.marker).toBe(before);
    expect(trial.circles.get(pid)!.id).toBe(id);
  }, 20000);
});

describe('gauntlet pull: expiry', () => {
  it('an unclicked circle expires as a miss (zero pull) and the next one is dealt', () => {
    const sim = makeSim(104);
    const pid = sim.addPlayer('warrior', 'Idle');
    openAndJoin(sim, pid);
    const run = advanceToTrial(sim);
    keepNpcs(run, 0); // only a click could move the marker, and none comes
    const trial = pullState(sim);

    const first = trial.circles.get(pid)!;
    tickToTime(sim, first.spawnAt + first.shrinkS + 0.1);
    const next = trial.circles.get(pid)!;
    expect(next.id).toBeGreaterThan(first.id); // respawned
    expect(next.spawnAt).toBeGreaterThan(sim.time - 0.2); // dealt at the expiry sweep
    expect(trial.marker).toBe(0); // a miss pulls nothing
  }, 20000);
});

describe('gauntlet pull: teamwork', () => {
  it('teammates SUM their graded pulls; an opponent pull subtracts', () => {
    const sim = makeSim(105, false); // real lobby so all three can join
    const a = sim.addPlayer('warrior', 'First');
    const b = sim.addPlayer('warrior', 'Second');
    const c = sim.addPlayer('warrior', 'Third');
    openAndJoin(sim, a, b, c);
    const run = advanceToTrial(sim);
    const trial = pullState(sim);
    keepNpcs(run, 0);
    // Join order alternates teams: a and c share team 0, b is team 1.
    expect(trial.teamOf.get(a)).toBe(0);
    expect(trial.teamOf.get(b)).toBe(1);
    expect(trial.teamOf.get(c)).toBe(0);

    const perfect = GAUNTLET.pull.circleTargetSize;
    sim.gauntletPullCircle(plantCircle(sim, trial, a, perfect), a);
    sim.gauntletPullCircle(plantCircle(sim, trial, c, perfect), c);
    expect(trial.marker).toBeCloseTo(2 * GAUNTLET.pull.pullForceMax, 6); // the sum

    sim.gauntletPullCircle(plantCircle(sim, trial, b, perfect), b);
    expect(trial.marker).toBeCloseTo(GAUNTLET.pull.pullForceMax, 6); // pulled back
  }, 40000);
});

describe('gauntlet pull: resolution', () => {
  it('a clean clicker wins unscathed; the idle loser is knocked out', () => {
    const sim = makeSim(106, false); // real lobby so two players can both join
    const clicker = sim.addPlayer('warrior', 'Heaver');
    const idler = sim.addPlayer('warrior', 'Slacker');
    openAndJoin(sim, clicker, idler);
    const run = advanceToTrial(sim);
    const trial = pullState(sim); // hold the ref: run.trial is nulled at resolution
    expect(trial.teamOf.get(clicker)).toBe(0);
    expect(trial.teamOf.get(idler)).toBe(1);
    keepNpcs(run, 0); // no NPC drift: the marker (and each side's contribution) is pure play

    clickWhenSmall(sim, clicker, 60);

    expect(trial.resolved).toBe(true);
    expect(trial.wonBy).toBe(0); // the clicker's side
    const cc = run.contestants.find((k) => k.entityId === clicker)!;
    const ic = run.contestants.find((k) => k.entityId === idler)!;
    // The clicker pulled a full win's worth of contribution, so the toll grades
    // to zero: a winner who played takes nothing and banks a finish time.
    expect(cc.vitality).toBe(GAUNTLET.vitalityMax);
    expect(run.playerStates.get(clicker)!.spectating).toBe(false);
    expect(run.playerStates.get(clicker)!.finishedAt).not.toBeNull();
    // The idle loser contributed nothing, so the full-pool toll (lossDamage ===
    // vitalityMax at zero contribution) knocks them out: failing a trial is now
    // fatal, not a survivable chunk.
    expect(GAUNTLET.pull.lossDamage).toBe(GAUNTLET.vitalityMax);
    expect(ic.vitality).toBe(0);
    expect(ic.eliminatedAtTrial).not.toBeNull();
    expect(run.playerStates.get(idler)!.spectating).toBe(true);
  }, 40000);
});

describe('gauntlet pull: determinism', () => {
  it('two same-seed runs with identical scripted clicks reach identical marker and vitality', () => {
    const scenario = () => {
      const sim = makeSim(107);
      const pid = sim.addPlayer('warrior', 'Twin');
      openAndJoin(sim, pid);
      const run = advanceToTrial(sim);
      const trial = pullState(sim);
      keepNpcs(run, 2); // keep NPCs so the per-heave jitter draws are exercised
      clickWhenSmall(sim, pid, 40);
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

describe('gauntlet pull: rope wire sync', () => {
  it('ships the eased rope translation the players are dragged by', () => {
    const sim = makeSim(109);
    const pid = sim.addPlayer('warrior', 'Roped');
    openAndJoin(sim, pid);
    const run = advanceToTrial(sim);
    keepNpcs(run, 0);
    const trial = pullState(sim);
    // Haul the marker near the threshold and let the drag ease for a moment:
    // the wire's kx is the sim's own kx (0.05-quantized), the same value the
    // player's pin x is offset by, so the venue rope can ride it 1:1.
    trial.marker = GAUNTLET.pull.winThreshold - 1;
    for (let i = 0; i < 10; i++) sim.tick();
    const wire = sim.gauntletRunWire(pid);
    expect(wire?.pull).not.toBeNull();
    expect(trial.kx).not.toBeCloseTo(0, 1); // the drag really moved
    expect(wire!.pull!.kx).toBeCloseTo(trial.kx, 1);
    const e = sim.entities.get(pid)!;
    const base = trial.gripBase.get(pid)!;
    expect(e.pos.x).toBeCloseTo(run.origin.x + base.x + trial.kx, 4);
  }, 20000);
});

describe('gauntlet pull: difficulty ramp (pure)', () => {
  it('scales from 1x at the start down to rampMin at the deadline, clamped and monotonic', () => {
    const min = GAUNTLET.pull.circleRampMin;
    expect(pullRampFactor(0, min)).toBe(1); // start: no ramp
    expect(pullRampFactor(1, min)).toBeCloseTo(min, 6); // end: full ramp
    expect(pullRampFactor(0.5, min)).toBeCloseTo(1 - (1 - min) * 0.5, 6);
    // clamped outside [0, 1]
    expect(pullRampFactor(-1, min)).toBe(1);
    expect(pullRampFactor(2, min)).toBeCloseTo(min, 6);
    // strictly faster by the end: at the deadline even a max-length shrink
    // scales below the un-ramped MINIMUM, so late circles shrink faster than
    // any early one could.
    expect(pullRampFactor(1, min) * GAUNTLET.pull.circleShrinkMaxS).toBeLessThan(
      GAUNTLET.pull.circleShrinkMinS,
    );
  });
});

describe('gauntlet pull: rope dressing', () => {
  it('lines the surviving NPC field along both banks of the trench', () => {
    const sim = makeSim(108);
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
