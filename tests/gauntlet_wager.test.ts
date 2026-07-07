import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GAUNTLET } from '../src/sim/content/gauntlet';
import type { GauntletWagerState } from '../src/sim/gauntlet/state';
import { Sim } from '../src/sim/sim';
import type { GauntletPhase, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Isolate Trial 4 so a run is a single wager trial: splice the trial sequence
// down to ['wager'] and its NPC-attrition target to [12] (restored after). Each
// test file gets its own module instance under Vitest, so this never leaks into
// tests/gauntlet.test.ts.
let savedTrials: typeof GAUNTLET.trials;
let savedTargets: typeof GAUNTLET.targetSurvivorsPerTrial;
beforeAll(() => {
  savedTrials = [...GAUNTLET.trials];
  savedTargets = [...GAUNTLET.targetSurvivorsPerTrial];
  GAUNTLET.trials.length = 0;
  GAUNTLET.trials.push('wager');
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

function pick<T extends SimEvent['type']>(
  evs: SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return evs.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

// Stand up a run and advance to the live wager trial; returns the player pid.
function reachWager(seed: number): { sim: Sim; pid: number } {
  const sim = makeSim(seed);
  const pid = sim.addPlayer('warrior', 'Duelist');
  openAndJoin(sim, pid);
  advanceTo(sim, 'trial');
  return { sim, pid };
}

function wagerTrial(sim: Sim): GauntletWagerState {
  return sim.gauntletRuns[0]!.trial as GauntletWagerState;
}

// -----------------------------------------------------------------------------

describe('gauntlet wager: reaching the trial', () => {
  it('opens the wager trial with one pair per live player', () => {
    const { sim, pid } = reachWager(2);
    const run = sim.gauntletRuns[0]!;
    expect(run.phase).toBe('trial');
    expect(run.trial?.kind).toBe('wager');
    const trial = wagerTrial(sim);
    const pair = trial.pairs.get(pid)!;
    expect(pair).toBeTruthy();
    // both purses start full; the stage reflects who hides first
    expect(pair.mine).toBe(GAUNTLET.wager.startingMarbles);
    expect(pair.theirs).toBe(GAUNTLET.wager.startingMarbles);
    expect(pair.stage).toBe(pair.holder ? 'hold' : 'guess');
    // the wire projection mirrors the pair
    const w = sim.gauntletRunWire(pid)!.wager!;
    expect(w.mine).toBe(pair.mine);
    expect(w.theirs).toBe(pair.theirs);
    expect(w.stage).toBe(pair.stage);
    expect(w.partnerName).toBe(pair.partnerName);
  });
});

describe('gauntlet wager: the round machine', () => {
  it('a hold round moves exactly the wager and flips the holder', () => {
    const { sim, pid } = reachWager(3);
    const pair = wagerTrial(sim).pairs.get(pid)!;
    // stake 3, then force this into a hold round (the player hides)
    sim.gauntletWager('wager', 3, pid);
    pair.holder = true;
    pair.stage = 'hold';
    const mineBefore = pair.mine;
    const theirsBefore = pair.theirs;
    const total = mineBefore + theirsBefore;

    sim.gauntletWager('hold', 3, pid);

    // marbles conserved and moved by exactly the wager
    expect(pair.mine + pair.theirs).toBe(total);
    expect(Math.abs(pair.mine - mineBefore)).toBe(3);
    expect(Math.abs(pair.theirs - theirsBefore)).toBe(3);
    // roles flipped: the partner hides next, so the player now guesses
    expect(pair.holder).toBe(false);
    expect(pair.stage).toBe('guess');
  });

  it('a correct guess wins the wager; a wrong guess loses it', () => {
    // correct guess (held is odd, the player calls odd)
    {
      const { sim, pid } = reachWager(4);
      const pair = wagerTrial(sim).pairs.get(pid)!;
      pair.holder = false;
      pair.stage = 'guess';
      pair.held = 3; // odd
      sim.gauntletWager('wager', 2, pid);
      const mineBefore = pair.mine;
      const theirsBefore = pair.theirs;

      sim.gauntletWager('guess', 1, pid); // 1 = odd

      expect(pair.mine).toBe(mineBefore + 2);
      expect(pair.theirs).toBe(theirsBefore - 2);
    }
    // wrong guess (held is odd, the player calls even)
    {
      const { sim, pid } = reachWager(4);
      const pair = wagerTrial(sim).pairs.get(pid)!;
      pair.holder = false;
      pair.stage = 'guess';
      pair.held = 3; // odd
      sim.gauntletWager('wager', 2, pid);
      const mineBefore = pair.mine;
      const theirsBefore = pair.theirs;

      sim.gauntletWager('guess', 0, pid); // 0 = even

      expect(pair.mine).toBe(mineBefore - 2);
      expect(pair.theirs).toBe(theirsBefore + 2);
    }
  });

  it('clamps the wager to maxWager and to the smaller purse, never below 1', () => {
    const { sim, pid } = reachWager(5);
    const pair = wagerTrial(sim).pairs.get(pid)!;
    // a huge bet clamps to maxWager
    sim.gauntletWager('wager', 99, pid);
    expect(pair.wager).toBe(GAUNTLET.wager.maxWager);
    // a short purse clamps the bet to what remains
    pair.mine = 3;
    sim.gauntletWager('wager', 99, pid);
    expect(pair.wager).toBe(3);
    // and never below one marble
    sim.gauntletWager('wager', 0, pid);
    expect(pair.wager).toBe(1);
  });

  it('a round timeout forfeits the wager and opens the next round', () => {
    const { sim, pid } = reachWager(6);
    const pair = wagerTrial(sim).pairs.get(pid)!;
    sim.gauntletWager('wager', 2, pid);
    const mineBefore = pair.mine;
    const theirsBefore = pair.theirs;
    const holderBefore = pair.holder;
    // expire the round clock (the trial clock stays far off)
    pair.roundEndsAt = sim.time - 1;

    sim.tick();

    // the player forfeited exactly the wager to the partner
    expect(pair.mine).toBe(mineBefore - 2);
    expect(pair.theirs).toBe(theirsBefore + 2);
    // roles flipped and a fresh round is ticking
    expect(pair.holder).toBe(!holderBefore);
    expect(pair.roundEndsAt).toBeGreaterThan(sim.time);
    expect(pair.finished).toBe(false);
  });
});

describe('gauntlet wager: resolution', () => {
  it('emptying the purse finishes the pair, deals lossDamage, and knocks the player out', () => {
    const { sim, pid } = reachWager(7);
    const pair = wagerTrial(sim).pairs.get(pid)!;
    // one bet from broke, hidden partner is even, a wrong (odd) guess empties it
    pair.holder = false;
    pair.stage = 'guess';
    pair.held = 2; // even
    pair.mine = 2;
    pair.theirs = 18;
    sim.gauntletWager('wager', 2, pid);

    sim.gauntletWager('guess', 1, pid); // odd -> wrong -> loses 2 -> mine 0

    expect(pair.finished).toBe(true);
    expect(pair.won).toBe(false);
    expect(pair.mine).toBe(0);

    const evs = sim.tick(); // drain the queued knockout events
    const dmg = pick(evs, 'gauntletDamage');
    expect(dmg.some((e) => e.cause === 'trial' && e.amount === GAUNTLET.wager.lossDamage)).toBe(
      true,
    );
    expect(pick(evs, 'gauntletEliminated').length).toBeGreaterThan(0);
    expect(sim.gauntletRunWire(pid)!.spectating).toBe(true);
  });

  it('winning the duel banks a finish time and never damages the winner', () => {
    const { sim, pid } = reachWager(9);
    const run = sim.gauntletRuns[0]!;
    const pair = wagerTrial(sim).pairs.get(pid)!;
    // the partner is one bet from broke; a correct guess empties their purse
    pair.holder = false;
    pair.stage = 'guess';
    pair.held = 3; // odd
    pair.mine = 18;
    pair.theirs = 2;
    sim.gauntletWager('wager', 2, pid);

    sim.gauntletWager('guess', 1, pid); // odd -> correct -> wins 2 -> theirs 0

    expect(pair.finished).toBe(true);
    expect(pair.won).toBe(true);
    expect(pair.theirs).toBe(0);
    expect(run.playerStates.get(pid)!.finishedAt).not.toBeNull();
    const evs = sim.tick();
    // the winner takes no vitality hit from winning
    expect(pick(evs, 'gauntletDamage').some((e) => e.vitality < GAUNTLET.vitalityMax)).toBe(false);
    expect(sim.gauntletRunWire(pid)!.spectating).toBe(false);
  });

  it('at the trial cap an unfinished pair pays the per-marble deficit', () => {
    const { sim, pid } = reachWager(8);
    const run = sim.gauntletRuns[0]!;
    const pair = wagerTrial(sim).pairs.get(pid)!;
    pair.mine = 3;
    pair.theirs = 7; // deficit of 4 marbles
    pair.roundEndsAt = sim.time + 9999; // no timeout this tick
    run.phaseEndsAt = sim.time - 1; // the trial clock has expired
    const vitBefore = sim.gauntletRunWire(pid)!.vitality;

    const evs = sim.tick();

    const dmg = pick(evs, 'gauntletDamage').filter((e) => e.cause === 'timeout');
    expect(dmg.length).toBe(1);
    expect(dmg[0]!.amount).toBe(GAUNTLET.wager.damagePerMarbleShort * 4);
    expect(dmg[0]!.vitality).toBe(vitBefore - GAUNTLET.wager.damagePerMarbleShort * 4);
  });

  it('a pair that is even or ahead at the cap walks away untouched', () => {
    const { sim, pid } = reachWager(10);
    const run = sim.gauntletRuns[0]!;
    const pair = wagerTrial(sim).pairs.get(pid)!;
    pair.mine = 12;
    pair.theirs = 8; // ahead of the partner
    pair.roundEndsAt = sim.time + 9999;
    run.phaseEndsAt = sim.time - 1;

    const evs = sim.tick();

    expect(pick(evs, 'gauntletDamage').filter((e) => e.cause === 'timeout').length).toBe(0);
    expect(sim.gauntletRunWire(pid)!.vitality).toBe(GAUNTLET.vitalityMax);
  });
});

describe('gauntlet wager: the cosmetic partner entity', () => {
  it('seats a named partner entity across the mat while the duel runs', () => {
    const { sim, pid } = reachWager(11);
    const pair = wagerTrial(sim).pairs.get(pid)!;
    expect(pair.partnerEntityId).not.toBe(0);
    const partner = sim.entities.get(pair.partnerEntityId)!;
    expect(partner).toBeTruthy();
    expect(partner.name).toBe(pair.partnerName);
    // seated across the pair's mats: the player west, the partner east
    const player = sim.entities.get(pid)!;
    expect(partner.pos.x - player.pos.x).toBeCloseTo(6.4, 3);
    expect(partner.pos.z).toBeCloseTo(player.pos.z, 3);
  });

  it('despawns the partner when the pair finishes', () => {
    const { sim, pid } = reachWager(12);
    const pair = wagerTrial(sim).pairs.get(pid)!;
    const partnerId = pair.partnerEntityId;
    expect(sim.entities.has(partnerId)).toBe(true);
    // empty the partner's purse with a correct guess
    pair.holder = false;
    pair.stage = 'guess';
    pair.held = 3; // odd
    pair.mine = 18;
    pair.theirs = 2;
    sim.gauntletWager('wager', 2, pid);
    sim.gauntletWager('guess', 1, pid);
    expect(pair.finished).toBe(true);
    expect(pair.partnerEntityId).toBe(0);
    expect(sim.entities.has(partnerId)).toBe(false);
  });

  it('despawns every partner when the trial cap resolves the field', () => {
    const { sim, pid } = reachWager(13);
    const run = sim.gauntletRuns[0]!;
    const pair = wagerTrial(sim).pairs.get(pid)!;
    const partnerId = pair.partnerEntityId;
    pair.roundEndsAt = sim.time + 9999;
    run.phaseEndsAt = sim.time - 1; // trial clock expired

    sim.tick();

    expect(sim.entities.has(partnerId)).toBe(false);
  });

  it('despawns the partner when the player leaves mid-trial', () => {
    const { sim, pid } = reachWager(14);
    const pair = wagerTrial(sim).pairs.get(pid)!;
    const partnerId = pair.partnerEntityId;

    sim.gauntletLeave(pid);
    sim.tick(); // the run driver sweeps the orphaned pair

    expect(sim.entities.has(partnerId)).toBe(false);
  });

  it('despawns the partner when the run disposes mid-trial', () => {
    const { sim, pid } = reachWager(15);
    const run = sim.gauntletRuns[0]!;
    const pair = wagerTrial(sim).pairs.get(pid)!;
    const partnerId = pair.partnerEntityId;
    // strand the player outside the band: the sweep detaches them, and the
    // now-empty run times out and disposes with the trial state still live
    const e = sim.entities.get(pid)!;
    e.pos.x = 100;
    e.prevPos = { ...e.pos };
    (sim as any).rebucket(e);
    for (let i = 0; i < 20 * (GAUNTLET.emptyTimeoutS + 2) && sim.gauntletRuns.length > 0; i++)
      sim.tick();

    expect(sim.gauntletRuns.length).toBe(0);
    expect(sim.entities.has(partnerId)).toBe(false);
  });
});

describe('gauntlet wager: determinism', () => {
  it('two same-seed runs with identical scripted inputs are byte-identical', () => {
    const scenario = () => {
      const sim = makeSim(21);
      const pid = sim.addPlayer('warrior', 'Det');
      openAndJoin(sim, pid);
      advanceTo(sim, 'trial');
      const evs: SimEvent[] = [];
      for (let i = 0; i < 20 * 60; i++) {
        // fire the whole action set each tick; only the one matching the
        // current stage resolves, the rest drop as stale
        sim.gauntletWager('wager', 3, pid);
        sim.gauntletWager('hold', 2, pid);
        sim.gauntletWager('guess', 1, pid);
        for (const e of sim.tick()) if (e.type.startsWith('gauntlet')) evs.push(e);
      }
      return evs;
    };

    const a = scenario();
    const b = scenario();
    // the scripted duel actually resolves and thins the field (a real stream)
    expect(pick(a, 'gauntletPoof').length).toBeGreaterThan(0);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
