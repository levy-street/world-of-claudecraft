import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GAUNTLET, GAUNTLET_VENUE } from '../src/sim/content/gauntlet';
import { aliveContestants } from '../src/sim/gauntlet/vitality';
import { Sim } from '../src/sim/sim';
import { DT, type GauntletPhase, type SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// --- Trial isolation: run ONLY the court, crowning a single champion. Splice
// the shared trial schedule + survivor targets down to the final court and
// restore them after each test (copied idiom: mutate the live arrays in place).
const origTrials = [...GAUNTLET.trials];
const origTargets = [...GAUNTLET.targetSurvivorsPerTrial];
beforeEach(() => {
  GAUNTLET.trials.splice(0, GAUNTLET.trials.length, 'court');
  GAUNTLET.targetSurvivorsPerTrial.splice(0, GAUNTLET.targetSurvivorsPerTrial.length, 1);
});
afterEach(() => {
  GAUNTLET.trials.splice(0, GAUNTLET.trials.length, ...origTrials);
  GAUNTLET.targetSurvivorsPerTrial.splice(
    0,
    GAUNTLET.targetSurvivorsPerTrial.length,
    ...origTargets,
  );
});

// --- local helpers (not shared; copied idioms from gauntlet.test.ts) ---

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
  sim.tick(); // recruiter spawns end-of-tick
  const r = recruiter(sim)!;
  teleport(sim, pid, r.pos.x, r.pos.z);
  sim.gauntletJoin(pid);
}

function advanceTo(sim: Sim, phase: GauntletPhase, maxTicks = 20 * 40): SimEvent[] {
  const evs: SimEvent[] = [];
  for (let i = 0; i < maxTicks && sim.gauntletRuns[0]?.phase !== phase; i++)
    evs.push(...sim.tick());
  return evs;
}

function pick<T extends SimEvent['type']>(
  evs: SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return evs.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

// Stand a fresh solo player in the live court trial; returns the pid.
function startCourtTrial(sim: Sim, name = 'Duelist'): number {
  const pid = sim.addPlayer('warrior', name);
  openAndJoin(sim, pid);
  advanceTo(sim, 'trial');
  return pid;
}

// The court's instance-local geometry (matches trial_court.ts).
const anchor = GAUNTLET_VENUE.court;
const ct = GAUNTLET.court;
const Z0 = anchor.z - ct.courtLength / 2;
const Z1 = Z0 + ct.courtLength;

function courtState(sim: Sim) {
  const trial = sim.gauntletRuns[0]!.trial;
  if (trial?.kind !== 'court') throw new Error('expected the court trial to be live');
  return trial;
}

// -----------------------------------------------------------------------------

describe('gauntlet court: duel setup', () => {
  it('pairs a solo player against the strongest NPC as attacker at the entry line', () => {
    const sim = makeSim(101);
    const pid = startCourtTrial(sim, 'Champ');
    const run = sim.gauntletRuns[0]!;
    const duel = courtState(sim).duels.get(pid)!;

    expect(duel).toBeTruthy();
    expect(duel.rivalPid).toBeNull(); // the rival is an NPC, not a second player
    expect(duel.attacker).toBe(true); // the player attacks first (better feel)

    // the rival is the most-skilled surviving NPC
    const strongest = run.contestants
      .filter((c) => !c.player && c.eliminatedAtTrial === null)
      .sort((a, b) => b.skill - a.skill)[0];
    expect(duel.rivalId).toBe(strongest.entityId);

    // the player stands just inside the entry line, centered in its lane
    const e = sim.entities.get(pid)!;
    expect(e.pos.x - run.origin.x).toBeCloseTo(anchor.x, 5); // solo lane = anchor.x
    expect(e.pos.z - run.origin.z).toBeCloseTo(Z0 + 1, 5);
  });
});

describe('gauntlet court: the pre-neck one-foot rule', () => {
  it('an attacker crawls before the neck and moves freely past it', () => {
    const sim = makeSim(102);
    const pid = startCourtTrial(sim);
    const run = sim.gauntletRuns[0]!;
    const e = sim.entities.get(pid)!;

    // A forward step measured well before the neck (both ticks land inside the
    // opening beat, so the NPC rival never shoves and confounds the reading).
    teleport(sim, pid, run.origin.x + anchor.x, run.origin.z + Z0 + 4);
    e.facing = 0;
    const preFrom = e.pos.z;
    sim.meta(pid)!.moveInput.forward = true;
    sim.tick();
    sim.meta(pid)!.moveInput.forward = false;
    const preStep = e.pos.z - preFrom;

    // A forward step measured past the neck.
    teleport(sim, pid, run.origin.x + anchor.x, run.origin.z + Z0 + ct.neckZ + 4);
    e.facing = 0;
    const postFrom = e.pos.z;
    sim.meta(pid)!.moveInput.forward = true;
    sim.tick();
    sim.meta(pid)!.moveInput.forward = false;
    const postStep = e.pos.z - postFrom;

    expect(preStep).toBeGreaterThan(0);
    expect(postStep).toBeGreaterThan(preStep);
    // the pre-neck step is preNeckSpeedMult of the free step
    expect(preStep / postStep).toBeCloseTo(ct.preNeckSpeedMult, 1);
  });
});

describe('gauntlet court: the shove', () => {
  it('knocks the rival back and chips vitality; the cooldown blocks an instant second shove', () => {
    const sim = makeSim(103);
    const pid = startCourtTrial(sim);
    const run = sim.gauntletRuns[0]!;
    const duel = courtState(sim).duels.get(pid)!;
    const rivalC = run.contestants.find((c) => c.entityId === duel.rivalId)!;
    const rivalE = sim.entities.get(duel.rivalId)!;

    // stand the player a yard from the rival (well inside shoveRange)
    teleport(sim, pid, rivalE.pos.x + 1, rivalE.pos.z);
    const before = { x: rivalE.pos.x, z: rivalE.pos.z };
    const vitBefore = rivalC.vitality;

    sim.gauntletCourt(pid); // the shove
    const moved = Math.hypot(rivalE.pos.x - before.x, rivalE.pos.z - before.z);
    expect(moved).toBeCloseTo(ct.shovePush, 1); // knocked back a full shovePush
    expect(rivalE.pos.x).toBeLessThan(before.x); // away from the shover (player was at +x)
    expect(rivalC.vitality).toBe(vitBefore - ct.shoveDamage);

    // an immediate second shove is on cooldown: no further damage
    const vitAfter = rivalC.vitality;
    sim.gauntletCourt(pid);
    expect(rivalC.vitality).toBe(vitAfter);
  });
});

describe('gauntlet court: reaching the head zone', () => {
  it('wins the duel outright, knocks out the rival, and crowns the player', () => {
    const sim = makeSim(104);
    const pid = startCourtTrial(sim, 'Champ');
    const run = sim.gauntletRuns[0]!;
    const duel = courtState(sim).duels.get(pid)!;
    const rivalC = run.contestants.find((c) => c.entityId === duel.rivalId)!;

    // plant the attacker in the head zone (within the lane, within the opening
    // beat so the rival cannot shove it back before the win resolves)
    teleport(sim, pid, run.origin.x + anchor.x, run.origin.z + Z1 + 0.5);
    const evs = sim.tick();

    expect(rivalC.eliminatedAtTrial).not.toBeNull(); // rival knocked out
    expect(run.playerStates.get(pid)!.finishedAt).not.toBeNull(); // player finished
    expect(run.phase).toBe('podium'); // the lone trial resolved
    expect(run.podium?.first).toBe('Champ');
    // with targets [1] the surviving field is exactly the champion
    expect(aliveContestants(run).length).toBe(1);
    const mine = pick(evs, 'gauntletPodium').find((e) => e.pid === pid)!;
    expect(mine.won).toBe(true);
  });
});

describe('gauntlet court: pushed out of bounds', () => {
  it('a fighter driven outside the court loses the duel and is knocked out', () => {
    const sim = makeSim(105);
    const pid = startCourtTrial(sim);
    const run = sim.gauntletRuns[0]!;

    // shove the player clear out the side of its lane
    teleport(sim, pid, run.origin.x + anchor.x + ct.courtHalfWidth + 5, run.origin.z + Z0 + 5);
    const evs = sim.tick();

    expect(pick(evs, 'gauntletEliminated').some((e) => e.pid === pid)).toBe(true);
    const pc = run.contestants.find((c) => c.entityId === pid)!;
    expect(pc.eliminatedAtTrial).not.toBeNull();
    expect(run.playerStates.get(pid)!.spectating).toBe(true);
    expect(run.playerStates.get(pid)!.finishedAt).toBeNull(); // a loss never finishes
  });
});

describe('gauntlet court: role swap', () => {
  it('flips the attacker role at the swap timer without resolving the duel', () => {
    const sim = makeSim(106);
    const pid = startCourtTrial(sim);
    const duel = courtState(sim).duels.get(pid)!;
    expect(duel.attacker).toBe(true);
    const swapAt0 = duel.swapAt;

    // idle at the entry line so nothing resolves before the timer, then step past it
    while (sim.time < swapAt0 + DT && sim.gauntletRuns[0]?.phase === 'trial') sim.tick();

    expect(duel.done).toBe(false);
    expect(duel.attacker).toBe(false); // roles flipped
    expect(duel.swapAt).toBeCloseTo(swapAt0 + ct.roleSwapS, 5); // next swap re-armed
  });
});

describe('gauntlet court: determinism', () => {
  it('is byte-identical across two same-seed sims with identical scripted inputs', () => {
    const scenario = () => {
      const sim = makeSim(207);
      const pid = sim.addPlayer('warrior', 'Det');
      openAndJoin(sim, pid);
      const evs: SimEvent[] = [];
      for (let i = 0; i < 20 * 100; i++) {
        const inTrial = sim.gauntletRuns[0]?.phase === 'trial';
        sim.meta(pid)!.moveInput.forward = inTrial;
        if (inTrial && i % 10 === 0) sim.gauntletCourt(pid); // exercise the shove command path
        for (const e of sim.tick()) if (e.type.startsWith('gauntlet')) evs.push(e);
      }
      return evs;
    };

    const a = scenario();
    const b = scenario();
    expect(a.length).toBeGreaterThan(5);
    expect(pick(a, 'gauntletPhase').length).toBeGreaterThan(0);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  }, 30000);
});
