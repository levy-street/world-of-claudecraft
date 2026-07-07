import { describe, expect, it } from 'vitest';
import { GAUNTLET, GAUNTLET_LAYOUT, GAUNTLET_VENUE } from '../src/sim/content/gauntlet';
import { isGauntletPos } from '../src/sim/data';
import { nextGreenWindowS } from '../src/sim/gauntlet/trial_sentinel';
import {
  aliveContestants,
  clamp01,
  sentinelScore,
  trialDamageFromScore,
} from '../src/sim/gauntlet/vitality';
import { Sim } from '../src/sim/sim';
import { DT, type GauntletPhase, type SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// --- local helpers (not shared; copied idioms from arena.test.ts / sim.test.ts) ---

const makeSim = (seed = 42, open = true) =>
  new Sim({ seed, playerClass: 'warrior', noPlayer: true, gauntletAlwaysOpen: open });

function recruiter(sim: Sim) {
  return [...sim.entities.values()].find((e) => e.templateId === 'gauntlet_recruiter');
}

// Teleport idiom: set pos.{x,z}, then pos.y from the shared terrain fn, then prevPos.
function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

// Tick once so the recruiter spawns (end-of-tick block), then stand each player
// beside it and join. The lobby run is created by the first joiner.
function openAndJoin(sim: Sim, ...pids: number[]) {
  sim.tick();
  const r = recruiter(sim)!;
  for (const pid of pids) {
    teleport(sim, pid, r.pos.x, r.pos.z);
    sim.gauntletJoin(pid);
  }
}

// Advance until the run reaches a phase, collecting every event seen on the way.
function advanceTo(sim: Sim, phase: GauntletPhase, maxTicks = 20 * 80): SimEvent[] {
  const evs: SimEvent[] = [];
  for (let i = 0; i < maxTicks && sim.gauntletRuns[0]?.phase !== phase; i++)
    evs.push(...sim.tick());
  return evs;
}

// Tick until phase 'podium' (or the run disposes), collecting events.
function runToPodium(sim: Sim, maxTicks = 20 * 300): SimEvent[] {
  const evs: SimEvent[] = [];
  for (let i = 0; i < maxTicks && sim.gauntletRuns[0]?.phase !== 'podium'; i++) {
    if (sim.gauntletRuns.length === 0) break;
    evs.push(...sim.tick());
  }
  return evs;
}

// Drive the player forward only on ticks that land safely mid-red (past the
// grace window, comfortably before the next flip), so each convicting step is a
// deliberate red-light violation. Stops when `stop` observes its event.
function catchLoop(
  sim: Sim,
  pid: number,
  stop: (evs: SimEvent[]) => boolean,
  maxTicks: number,
): SimEvent[] {
  const collected: SimEvent[] = [];
  for (let i = 0; i < maxTicks; i++) {
    const trial = sim.gauntletRuns[0]?.trial;
    const mid =
      !!trial &&
      trial.kind === 'sentinel' &&
      trial.light === 'red' &&
      sim.time + DT >= trial.graceUntil &&
      sim.time + 2 * DT < trial.flipAt;
    sim.meta(pid)!.moveInput.forward = mid;
    const evs = sim.tick();
    collected.push(...evs);
    sim.meta(pid)!.moveInput.forward = false;
    if (stop(evs)) break;
  }
  return collected;
}

// Filter to one SimEvent variant with narrowing (assertions read fields directly).
function pick<T extends SimEvent['type']>(
  evs: SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return evs.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

function errorTexts(evs: SimEvent[]): string[] {
  return pick(evs, 'error').map((e) => e.text);
}

// -----------------------------------------------------------------------------

describe('gauntlet sentinel scoring (pure)', () => {
  const t = GAUNTLET.sentinel;

  it('trialDamageFromScore: score 1 takes nothing, score 0 takes damageMax, monotonic', () => {
    expect(trialDamageFromScore(1, t.damageMax)).toBe(0);
    expect(trialDamageFromScore(0, t.damageMax)).toBe(t.damageMax);
    expect(trialDamageFromScore(0.5, t.damageMax)).toBe(Math.round(t.damageMax * 0.5));
    // a finish bonus (score > 1) still clamps to zero damage, never negative
    expect(trialDamageFromScore(1.25, t.damageMax)).toBe(0);
    // higher score, strictly less damage
    expect(trialDamageFromScore(0.3, t.damageMax)).toBeGreaterThan(
      trialDamageFromScore(0.7, t.damageMax),
    );
  });

  it('sentinelScore: a finisher always clears >= 1; an unfinished score is bestZ/fieldLength', () => {
    // finishing always scores >= 1, so a finisher takes no end-of-trial damage
    expect(sentinelScore(0, true, 0, t.fieldLength, t.finishBonusMax)).toBe(1);
    expect(sentinelScore(0, true, 1, t.fieldLength, t.finishBonusMax)).toBe(1 + t.finishBonusMax);
    expect(
      trialDamageFromScore(
        sentinelScore(5, true, 0.5, t.fieldLength, t.finishBonusMax),
        t.damageMax,
      ),
    ).toBe(0);
    // unfinished: linear field progress, clamped to 0..1
    expect(sentinelScore(t.fieldLength / 2, false, 0, t.fieldLength, t.finishBonusMax)).toBeCloseTo(
      0.5,
      6,
    );
    expect(sentinelScore(0, false, 0, t.fieldLength, t.finishBonusMax)).toBe(0);
    expect(sentinelScore(t.fieldLength * 2, false, 0, t.fieldLength, t.finishBonusMax)).toBe(1);
  });

  it('nextGreenWindowS shrinks by accelPerCycle each cycle and floors at greenFloorS', () => {
    const draw = t.greenMaxS;
    expect(nextGreenWindowS(draw, 0, t)).toBeCloseTo(draw, 6);
    expect(nextGreenWindowS(draw, 1, t)).toBeCloseTo(draw * t.accelPerCycle, 6);
    expect(nextGreenWindowS(draw, 2, t)).toBeCloseTo(draw * t.accelPerCycle ** 2, 6);
    // strictly smaller each cycle while above the floor
    expect(nextGreenWindowS(draw, 2, t)).toBeLessThan(nextGreenWindowS(draw, 1, t));
    // a large cycle count never dips below the floor
    expect(nextGreenWindowS(draw, 100, t)).toBe(t.greenFloorS);
  });

  it('clamp01 pins to the unit interval', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.4)).toBe(0.4);
  });
});

describe('gauntlet event window', () => {
  it('stays closed by default: no recruiter spawns and joining is refused', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Hopeful');
    for (let i = 0; i < 10; i++) sim.tick();
    expect(sim.gauntletOpen).toBe(false);
    expect(recruiter(sim)).toBeUndefined();
    sim.gauntletJoin(pid);
    expect(errorTexts(sim.tick())).toContain('The Gauntlet is not open right now.');
    expect(sim.gauntletRuns.length).toBe(0);
  });

  it('opens the recruiter and admits a player standing beside it', () => {
    const sim = makeSim(1, true);
    const pid = sim.addPlayer('warrior', 'Ready');
    sim.tick();
    const r = recruiter(sim);
    expect(r).toBeTruthy();
    teleport(sim, pid, r!.pos.x, r!.pos.z);
    sim.gauntletJoin(pid);
    expect(sim.gauntletRuns.length).toBe(1);
    expect(sim.gauntletRuns[0]!.playerStates.has(pid)).toBe(true);
  });

  it('refuses a player standing away from the Herald', () => {
    const sim = makeSim(1, true);
    const pid = sim.addPlayer('warrior', 'Distant');
    sim.tick();
    expect(recruiter(sim)).toBeTruthy();
    teleport(sim, pid, 200, 200); // far beyond joinRadius (12)
    sim.gauntletJoin(pid);
    expect(errorTexts(sim.tick())).toContain('You must speak to the Herald to enter the Gauntlet.');
    expect(sim.gauntletRuns.length).toBe(0);
  });
});

describe('gauntlet lobby and run setup', () => {
  it('fills a lobby, spawns the field and watcher, and opens the trial', () => {
    const sim = makeSim(3);
    const a = sim.addPlayer('warrior', 'Aay');
    const b = sim.addPlayer('warrior', 'Bee');
    openAndJoin(sim, a, b);
    const run = sim.gauntletRuns[0]!;
    expect(sim.gauntletRuns.length).toBe(1);
    expect(run.phase).toBe('lobby');
    // both joiners landed in the SAME lobby
    expect(run.playerStates.size).toBe(2);
    expect(run.contestants.filter((c) => c.player).length).toBe(2);

    // lobbyFillS elapses -> staging: NPC backfill to the full field, watcher spawned
    advanceTo(sim, 'staging');
    expect(sim.gauntletRuns[0]!.phase).toBe('staging');
    expect(run.contestants.length).toBe(GAUNTLET.fieldSize);
    expect(run.watcherId).not.toBeNull();
    expect(sim.entities.has(run.watcherId!)).toBe(true);
    // both players teleported into the gauntlet band
    expect(isGauntletPos(sim.entities.get(a)!.pos.x)).toBe(true);
    expect(isGauntletPos(sim.entities.get(b)!.pos.x)).toBe(true);

    // staging -> trial (the sentinel light machine)
    advanceTo(sim, 'trial');
    expect(sim.gauntletRuns[0]!.phase).toBe('trial');
    expect(run.trial?.kind).toBe('sentinel');
  }, 20000);
});

describe('gauntlet sentinel trial', () => {
  it('a red-light violation deals a caught hit and drops vitality', () => {
    const sim = makeSim(5);
    const pid = sim.addPlayer('warrior', 'Runner');
    openAndJoin(sim, pid);
    advanceTo(sim, 'trial');
    const run = sim.gauntletRuns[0]!;
    teleport(sim, pid, run.origin.x, run.origin.z + 20); // mid-field, on the far side of the start line

    const damage: SimEvent[] = [];
    catchLoop(
      sim,
      pid,
      (evs) => {
        for (const e of pick(evs, 'gauntletDamage')) if (e.cause === 'caught') damage.push(e);
        return damage.length > 0;
      },
      20 * 60,
    );

    expect(damage.length).toBe(1);
    const hit = damage[0] as Extract<SimEvent, { type: 'gauntletDamage' }>;
    expect(hit.cause).toBe('caught');
    expect(hit.amount).toBe(GAUNTLET.sentinel.hardFailDamage);
    expect(hit.vitality).toBe(GAUNTLET.vitalityMax - GAUNTLET.sentinel.hardFailDamage);
    // the wire view reflects the same vitality
    expect(sim.gauntletRunWire(pid)!.vitality).toBe(
      GAUNTLET.vitalityMax - GAUNTLET.sentinel.hardFailDamage,
    );
  }, 20000);

  it('five caught hits knock the player out to the spectator platform; the run resolves without them', () => {
    const sim = makeSim(5);
    const pid = sim.addPlayer('warrior', 'Fallible');
    openAndJoin(sim, pid);
    advanceTo(sim, 'trial');
    const run = sim.gauntletRuns[0]!;
    teleport(sim, pid, run.origin.x, run.origin.z + 20);

    let eliminated = false;
    let caughtHits = 0;
    const evs = catchLoop(
      sim,
      pid,
      (batch) => {
        for (const e of pick(batch, 'gauntletDamage')) if (e.cause === 'caught') caughtHits++;
        if (pick(batch, 'gauntletEliminated').length > 0) eliminated = true;
        return eliminated;
      },
      20 * 120,
    );

    expect(eliminated).toBe(true);
    // vitalityMax 100 / hardFailDamage 22 => 5 catches to reach zero
    expect(caughtHits).toBe(Math.ceil(GAUNTLET.vitalityMax / GAUNTLET.sentinel.hardFailDamage));
    expect(pick(evs, 'gauntletEliminated')[0]!.trialIndex).toBe(0);
    expect(sim.gauntletRunWire(pid)!.spectating).toBe(true);
    // parked beside the field on the spectator platform
    const e = sim.entities.get(pid)!;
    expect(e.pos.x - run.origin.x).toBeCloseTo(GAUNTLET_LAYOUT.spectatorX, 5);
    expect(e.pos.z - run.origin.z).toBeCloseTo(GAUNTLET_LAYOUT.spectatorZ, 5);

    // the run continues for the NPC field and resolves to a podium the spectator loses
    const tail = runToPodium(sim);
    const podium = pick(tail, 'gauntletPodium')[0]!;
    expect(podium).toBeTruthy();
    expect(podium.won).toBe(false);
    // the fallen player no longer counts toward the survivor target (12 - 1)
    expect(aliveContestants(sim.gauntletRuns[0]!).length).toBe(
      GAUNTLET.targetSurvivorsPerTrial[0] - 1,
    );
  }, 40000);

  it('crossing the finish line wins the podium, culls the field to target, and records the run', () => {
    const sim = makeSim(5);
    const pid = sim.addPlayer('warrior', 'Champ');
    openAndJoin(sim, pid);
    advanceTo(sim, 'trial');
    const run = sim.gauntletRuns[0]!;

    // cross during a green light (a direct pos set re-syncs prevPos, so no red-light displacement)
    for (let i = 0; i < 400 && run.trial?.light !== 'green'; i++) sim.tick();
    teleport(sim, pid, run.origin.x, run.origin.z + GAUNTLET.sentinel.fieldLength + 1);
    sim.tick();
    expect(sim.gauntletRunWire(pid)!.finished).toBe(true);

    const tail = runToPodium(sim);
    expect(sim.gauntletRuns[0]!.phase).toBe('podium');

    // NPC attrition: the field culls toward the trial target, plus the surviving player
    expect(aliveContestants(sim.gauntletRuns[0]!).length).toBe(GAUNTLET.targetSurvivorsPerTrial[0]);
    // mid-trial fumbles were observed as knockout poofs
    expect(pick(tail, 'gauntletPoof').length).toBeGreaterThan(0);

    const podium = pick(tail, 'gauntletPodium')[0]!;
    expect(podium.won).toBe(true);
    expect(podium.first).toBe('Champ');
    expect(sim.meta(pid)!.gauntletStats).toEqual({ runs: 1, wins: 1, bestTrial: 1 });
  }, 40000);
});

describe('gauntlet leave, disconnect, and forfeit', () => {
  it('leaving an empty lobby disposes the run and frees the slot', () => {
    const sim = makeSim(3);
    const pid = sim.addPlayer('warrior', 'Solo');
    openAndJoin(sim, pid);
    expect(sim.gauntletRuns.length).toBe(1);
    expect(sim.gauntletRuns[0]!.phase).toBe('lobby');
    sim.gauntletLeave(pid);
    expect(sim.gauntletRuns.length).toBe(0);
  });

  it('leaving mid-trial restores the pre-join position and poofs to the remaining field', () => {
    const sim = makeSim(3);
    const a = sim.addPlayer('warrior', 'Stay');
    const b = sim.addPlayer('warrior', 'Quit');
    openAndJoin(sim, a, b);
    const savedB = { ...sim.entities.get(b)!.pos }; // captured at join, before staging teleports b
    advanceTo(sim, 'trial');
    expect(isGauntletPos(sim.entities.get(b)!.pos.x)).toBe(true); // b is in the band mid-trial

    sim.gauntletLeave(b);
    const drained = sim.tick(); // the poof/eliminated were queued during gauntletLeave

    // b restored to the pre-join spot (never left in the band)
    const eb = sim.entities.get(b)!;
    expect(eb.pos.x).toBeCloseTo(savedB.x, 5);
    expect(eb.pos.z).toBeCloseTo(savedB.z, 5);
    expect(isGauntletPos(eb.pos.x)).toBe(false);
    // the field saw the forfeit as a knockout poof
    expect(pick(drained, 'gauntletPoof').some((e) => e.entityId === b)).toBe(true);
    // the run continues for the other player
    expect(sim.gauntletRuns.length).toBe(1);
    expect(sim.gauntletRuns[0]!.playerStates.has(a)).toBe(true);
    expect(sim.gauntletRuns[0]!.playerStates.has(b)).toBe(false);
  }, 20000);

  it('removePlayer mid-run detaches without restoring and the run continues', () => {
    const sim = makeSim(3);
    const a = sim.addPlayer('warrior', 'Keep');
    const b = sim.addPlayer('warrior', 'Gone');
    openAndJoin(sim, a, b);
    advanceTo(sim, 'trial');
    sim.removePlayer(b);
    // the character left the world entirely (no teleport home): the entity is gone
    expect(sim.entities.has(b)).toBe(false);
    expect(sim.gauntletRuns.length).toBe(1);
    expect(sim.gauntletRuns[0]!.playerStates.has(b)).toBe(false);
    expect(sim.gauntletRuns[0]!.playerStates.has(a)).toBe(true);
  }, 20000);
});

describe('gauntlet determinism and rng isolation', () => {
  it('a scripted run is byte-identical across two fresh sims', () => {
    const scenario = () => {
      const sim = makeSim(21);
      const pid = sim.addPlayer('warrior', 'Det');
      openAndJoin(sim, pid);
      const evs: SimEvent[] = [];
      for (let i = 0; i < 20 * 160; i++) {
        // drive forward only during the trial (idling the lobby avoids a town-wander death)
        sim.meta(pid)!.moveInput.forward = sim.gauntletRuns[0]?.phase === 'trial';
        for (const e of sim.tick()) if (e.type.startsWith('gauntlet')) evs.push(e);
      }
      return evs;
    };

    const a = scenario();
    const b = scenario();
    // a rich mid-trial stream (light flips + NPC fumbles): any shared or per-run rng
    // draw-order change forks it within seconds of the trial opening
    expect(pick(a, 'gauntletLight').length).toBeGreaterThan(5);
    expect(pick(a, 'gauntletPoof').length).toBeGreaterThan(0);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  }, 40000);

  it('an active gauntlet draws nothing from the shared rng stream', () => {
    const busy = makeSim(7);
    const bp = busy.addPlayer('warrior', 'Busy');
    openAndJoin(busy, bp); // ticks once, then joins and runs a full gauntlet

    const idle = makeSim(7);
    const ip = idle.addPlayer('warrior', 'Idle');
    idle.tick(); // mirror openAndJoin's recruiter-spawn tick, but never join
    teleport(idle, ip, recruiter(idle)!.pos.x, recruiter(idle)!.pos.z);

    for (let i = 0; i < 2000; i++) {
      busy.tick();
      idle.tick();
    }
    expect((busy as any).tickCount).toBe((idle as any).tickCount);

    // If any gauntlet path drew from the shared stream, the two streams would fork.
    for (let i = 0; i < 3; i++) {
      expect((busy as any).rng.next()).toBe((idle as any).rng.next());
    }
  }, 30000);
});

describe('gauntlet persistence', () => {
  it('gauntlet stats survive a serialize/addPlayer round-trip', () => {
    const sim = makeSim(3, false);
    const pid = sim.addPlayer('warrior', 'Vet');
    sim.meta(pid)!.gauntletStats = { runs: 2, wins: 1, bestTrial: 1 };
    const state = sim.serializeCharacter(pid)!;
    expect(state.gauntletStats).toEqual({ runs: 2, wins: 1, bestTrial: 1 });

    const fresh = makeSim(3, false);
    const rid = fresh.addPlayer('warrior', 'Vet', { state });
    expect(fresh.meta(rid)!.gauntletStats).toEqual({ runs: 2, wins: 1, bestTrial: 1 });
  });
});

describe('instant lobby (offline single-player)', () => {
  it('gauntletInstantLobby skips the fill window: a join starts the run on the spot', () => {
    const sim = new Sim({
      seed: 7,
      playerClass: 'warrior',
      noPlayer: true,
      gauntletAlwaysOpen: true,
      gauntletInstantLobby: true,
    });
    const pid = sim.addPlayer('warrior', 'Solo');
    openAndJoin(sim, pid);
    const run = sim.gauntletRuns[0];
    expect(run.phase).toBe('staging');
    expect(run.contestants.length).toBe(GAUNTLET.fieldSize);
    expect(sim.gauntletRunWire(pid)?.phase).toBe('staging');
  });

  it('without the flag a lone joiner still waits in the lobby', () => {
    const sim = makeSim(7);
    const pid = sim.addPlayer('warrior', 'Waits');
    openAndJoin(sim, pid);
    expect(sim.gauntletRuns[0].phase).toBe('lobby');
  });
});

describe('lobby countdown calibration sample', () => {
  it('gauntletPhase events carry the true seconds remaining in the phase', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'First');
    const b = sim.addPlayer('warrior', 'Late');
    openAndJoin(sim, a);
    let evs = sim.tick();
    const atOpen = pick(evs, 'gauntletPhase');
    expect(atOpen.length).toBeGreaterThan(0);
    for (const ev of atOpen) expect(ev.remainingS).toBeCloseTo(GAUNTLET.lobbyFillS, 1);
    // Ten seconds later a second player joins: their sample reflects the
    // already-elapsed fill window, not the full one.
    for (let i = 0; i < 20 * 10; i++) sim.tick();
    const r = recruiter(sim)!;
    teleport(sim, b, r.pos.x, r.pos.z);
    sim.gauntletJoin(b);
    evs = sim.tick();
    const lateSamples = pick(evs, 'gauntletPhase');
    expect(lateSamples.length).toBeGreaterThan(0);
    for (const ev of lateSamples) {
      expect(ev.remainingS).toBeLessThan(GAUNTLET.lobbyFillS - 9);
      expect(ev.remainingS).toBeGreaterThan(GAUNTLET.lobbyFillS - 12);
    }
  });
});

describe('venue layout envelope', () => {
  it('keeps every venue anchor inside the ground apron and the slot envelope', () => {
    const V = GAUNTLET_VENUE;
    // The apron must stay inside the gauntlet band (no bleed into the
    // battleground reserve at x 9600) and inside one slot's z pitch (400,
    // data.ts GAUNTLET_SLOT_SPACING) so neighboring runs never see it.
    expect(isGauntletPos(9000 - V.groundHalfWidth)).toBe(true);
    expect(isGauntletPos(9000 + V.groundHalfWidth)).toBe(true);
    expect(V.groundZMax - V.groundZMin).toBeLessThan(400);
    const inApron = (x: number, z: number, pad: number) => {
      expect(Math.abs(x) + pad).toBeLessThanOrEqual(V.groundHalfWidth);
      expect(z - pad).toBeGreaterThanOrEqual(V.groundZMin);
      expect(z + pad).toBeLessThanOrEqual(V.groundZMax);
    };
    inApron(V.sigils.x, V.sigils.z, V.sigils.radius + 4);
    inApron(V.pull.x, V.pull.z, Math.max(V.pull.length, V.pull.width) / 2 + 4);
    inApron(V.wager.x, V.wager.z, V.wager.size / 2 + 4);
    inApron(V.span.x, V.span.z, V.span.length / 2 + 6);
    inApron(V.court.x, V.court.z, V.court.radius + 4);
    // The sentinel field itself (z 0..fieldLength plus the warden past the
    // finish) and the shared stages all sit on the apron too.
    inApron(0, GAUNTLET.sentinel.fieldLength + GAUNTLET_LAYOUT.watcherMargin + 4, 6);
    inApron(0, GAUNTLET_LAYOUT.podiumZ - 8, 6);
    inApron(GAUNTLET_LAYOUT.spectatorX + 4, GAUNTLET_LAYOUT.spectatorZ, 12);
    // The grandstands flank the field without covering the spectator park spot.
    expect(V.standX).toBeGreaterThan(GAUNTLET.sentinel.fieldHalfWidth + 4);
    expect(GAUNTLET_LAYOUT.spectatorZ - 12).toBeGreaterThan(V.standZMin);
    expect(GAUNTLET_LAYOUT.spectatorZ + 12).toBeLessThan(V.standZMax);
  });
});
