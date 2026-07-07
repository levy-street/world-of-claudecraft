import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GAUNTLET } from '../src/sim/content/gauntlet';
import type { GauntletEchoState } from '../src/sim/gauntlet/state';
import { Sim } from '../src/sim/sim';
import type { GauntletPhase } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Isolate Trial 4 so a run is a single echo trial: splice the trial sequence
// down to ['echo'] and its NPC-attrition target to [12] (restored after). Each
// test file gets its own module instance under Vitest, so this never leaks
// into tests/gauntlet.test.ts.
let savedTrials: typeof GAUNTLET.trials;
let savedTargets: typeof GAUNTLET.targetSurvivorsPerTrial;
beforeAll(() => {
  savedTrials = [...GAUNTLET.trials];
  savedTargets = [...GAUNTLET.targetSurvivorsPerTrial];
  GAUNTLET.trials.length = 0;
  GAUNTLET.trials.push('echo');
  GAUNTLET.targetSurvivorsPerTrial.length = 0;
  GAUNTLET.targetSurvivorsPerTrial.push(12);
});
afterAll(() => {
  GAUNTLET.trials.length = 0;
  GAUNTLET.trials.push(...savedTrials);
  GAUNTLET.targetSurvivorsPerTrial.length = 0;
  GAUNTLET.targetSurvivorsPerTrial.push(...savedTargets);
});

// --- local helpers (copied idioms from tests/gauntlet.test.ts) ---

const makeSim = (seed = 42) =>
  new Sim({
    seed,
    playerClass: 'warrior',
    noPlayer: true,
    gauntletAlwaysOpen: true,
    gauntletInstantLobby: true, // a lone joiner starts the run on the spot
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

function openAndJoin(sim: Sim, pid: number) {
  sim.tick(); // end-of-tick block spawns the recruiter
  const r = recruiter(sim)!;
  teleport(sim, pid, r.pos.x, r.pos.z);
  sim.gauntletJoin(pid); // instant lobby -> staging on the spot
}

function advanceTo(sim: Sim, phase: GauntletPhase, maxTicks = 20 * 80) {
  for (let i = 0; i < maxTicks && sim.gauntletRuns[0]?.phase !== phase; i++) sim.tick();
}

// Stand up a run and advance to the live echo trial; returns the player pid.
function reachEcho(seed: number): { sim: Sim; pid: number } {
  const sim = makeSim(seed);
  const pid = sim.addPlayer('warrior', 'Listener');
  openAndJoin(sim, pid);
  advanceTo(sim, 'trial');
  return { sim, pid };
}

function echoTrial(sim: Sim): GauntletEchoState {
  return sim.gauntletRuns[0]!.trial as GauntletEchoState;
}

// Tick until the player's answer window is open (past the flash schedule).
function reachAnswerWindow(sim: Sim, pid: number) {
  const ep = echoTrial(sim).players.get(pid)!;
  const showEndsAt = ep.showStartAt + ep.seq.length * GAUNTLET.echo.stepS;
  for (let i = 0; i < 20 * 30 && sim.time < showEndsAt; i++) sim.tick();
  return ep;
}

// Answer the player's current round correctly, stone by stone.
function answerRound(sim: Sim, pid: number) {
  const ep = reachAnswerWindow(sim, pid);
  const seq = [...ep.seq];
  for (const stone of seq) sim.gauntletEcho(stone, pid);
}

// -----------------------------------------------------------------------------

describe("the Keeper's Echo: rounds and sequences", () => {
  it('opens with a dealt sequence of the base length, one entry per live player', () => {
    const { sim, pid } = reachEcho(2);
    const run = sim.gauntletRuns[0]!;
    expect(run.phase).toBe('trial');
    const ep = echoTrial(sim).players.get(pid)!;
    expect(ep.round).toBe(0);
    expect(ep.seq.length).toBe(GAUNTLET.echo.baseLen);
    for (const s of ep.seq) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(GAUNTLET.echo.stones);
    }
  });

  it('taps during the watch phase are ignored', () => {
    const { sim, pid } = reachEcho(3);
    const ep = echoTrial(sim).players.get(pid)!;
    // still inside the flash schedule (lead-in is 1s; we are at its very start)
    sim.gauntletEcho(ep.seq[0], pid);
    expect(ep.progress).toBe(0);
    expect(ep.misses).toBe(0);
  });

  it('echoing the sequence back clears the round and deals a longer one', () => {
    const { sim, pid } = reachEcho(4);
    answerRound(sim, pid);
    const ep = echoTrial(sim).players.get(pid)!;
    expect(ep.round).toBe(1);
    expect(ep.seq.length).toBe(GAUNTLET.echo.baseLen + 1);
    expect(ep.progress).toBe(0);
    expect(ep.misses).toBe(0);
  });

  it('a wrong stone costs missDamage and re-deals the SAME round fresh', () => {
    const { sim, pid } = reachEcho(5);
    const run = sim.gauntletRuns[0]!;
    const c = run.contestants.find((k) => k.entityId === pid)!;
    const ep = reachAnswerWindow(sim, pid);
    const before = [...ep.seq];
    const wrong = (ep.seq[0] + 1) % GAUNTLET.echo.stones;
    sim.gauntletEcho(wrong, pid);
    expect(c.vitality).toBe(GAUNTLET.vitalityMax - GAUNTLET.echo.missDamage);
    expect(ep.round).toBe(0); // same round
    expect(ep.misses).toBe(1);
    expect(ep.progress).toBe(0);
    // the re-deal is scheduled fresh (a new watch phase lies ahead)
    expect(ep.showStartAt).toBeGreaterThan(sim.time);
    void before; // the new draw MAY coincide by chance; the schedule is the pin
  });

  it('timing out the answer window is a miss too', () => {
    const { sim, pid } = reachEcho(6);
    const run = sim.gauntletRuns[0]!;
    const c = run.contestants.find((k) => k.entityId === pid)!;
    const ep = echoTrial(sim).players.get(pid)!;
    const deadline = ep.inputEndsAt;
    for (let i = 0; i < 20 * 30 && sim.time < deadline + 0.1; i++) sim.tick();
    expect(ep.misses).toBe(1);
    expect(c.vitality).toBe(GAUNTLET.vitalityMax - GAUNTLET.echo.missDamage);
    expect(ep.round).toBe(0);
  });

  it('clearing every round finishes the trial and banks a finish time', () => {
    const { sim, pid } = reachEcho(7);
    const run = sim.gauntletRuns[0]!;
    const c = run.contestants.find((k) => k.entityId === pid)!;
    for (let r = 0; r < GAUNTLET.echo.rounds; r++) answerRound(sim, pid);
    const ep = echoTrial(sim).players.get(pid)!;
    expect(ep.done).toBe(true);
    expect(ep.round).toBe(GAUNTLET.echo.rounds);
    expect(run.playerStates.get(pid)!.finishedAt).not.toBeNull();
    // a finisher takes no end-of-trial damage: run resolves on the next tick
    sim.tick();
    expect(c.vitality).toBe(GAUNTLET.vitalityMax);
    expect(run.phase).toBe('podium'); // single-trial splice goes straight to podium
  });

  it('an unfinished player takes damage scaled by rounds cleared at the cap', () => {
    const { sim, pid } = reachEcho(8);
    const run = sim.gauntletRuns[0]!;
    const c = run.contestants.find((k) => k.entityId === pid)!;
    answerRound(sim, pid); // clear exactly one of the five rounds
    const start = c.vitality;
    // run out the clock; timeouts along the way cost missDamage each
    for (let i = 0; i < 20 * 150 && sim.gauntletRuns[0]?.phase === 'trial'; i++) sim.tick();
    // final toll: misses en route plus the end-of-trial scale for 1/5 cleared
    const expectedEnd = Math.round((1 - 1 / GAUNTLET.echo.rounds) * GAUNTLET.echo.damageMax);
    expect(start - c.vitality).toBeGreaterThanOrEqual(expectedEnd);
  });

  it('two same-seed sims fed identical tap streams stay identical', () => {
    const scenario = () => {
      const { sim, pid } = reachEcho(9);
      const run = sim.gauntletRuns[0]!;
      const c = run.contestants.find((k) => k.entityId === pid)!;
      const snap: string[] = [];
      // one clean round, one deliberate miss, then a stretch of idle ticks
      answerRound(sim, pid);
      const ep = reachAnswerWindow(sim, pid);
      sim.gauntletEcho((ep.seq[0] + 1) % GAUNTLET.echo.stones, pid);
      for (let i = 0; i < 20 * 5; i++) {
        sim.tick();
        const p = echoTrial(sim).players.get(pid)!;
        snap.push(`${p.round}|${p.seq.join('')}|${p.progress}|${p.misses}|${c.vitality}`);
      }
      return snap;
    };
    expect(scenario()).toEqual(scenario());
  });
});
