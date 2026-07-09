import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GAUNTLET, GAUNTLET_LAYOUT, GAUNTLET_VENUE } from '../src/sim/content/gauntlet';
import { aliveContestants, eliminateContestant } from '../src/sim/gauntlet/vitality';
import { Sim } from '../src/sim/sim';
import type { GauntletPhase, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// --- Trial isolation: run ONLY the Final Court brawl, crowning a single
// champion. Splice the shared trial schedule + survivor targets down to the
// court and restore them after each test (mutate the live arrays in place).
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

function teleport(sim: Sim, id: number, x: number, z: number) {
  const e = sim.entities.get(id)!;
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

const anchor = GAUNTLET_VENUE.court;
const ct = GAUNTLET.court;
const center = (run: { origin: { x: number; z: number } }) => ({
  x: run.origin.x + anchor.x,
  z: run.origin.z + anchor.z,
});

function courtState(sim: Sim) {
  const trial = sim.gauntletRuns[0]!.trial;
  if (trial?.kind !== 'court') throw new Error('expected the court trial to be live');
  return trial;
}

function aliveNpcs(sim: Sim) {
  return aliveContestants(sim.gauntletRuns[0]!).filter((c) => !c.player);
}

// -----------------------------------------------------------------------------

describe('gauntlet court: setup', () => {
  it('drops every alive contestant into the ring, normalized to the shared hp pool', () => {
    const sim = makeSim(101);
    const pid = startCourtTrial(sim, 'Champ');
    const run = sim.gauntletRuns[0]!;
    const trial = courtState(sim);
    const alive = aliveContestants(run);

    expect(trial.fighters.size).toBe(alive.length);
    expect(trial.fighters.has(pid)).toBe(true);
    expect(alive.length).toBeGreaterThan(1); // a real brawl, not a walkover

    // every fighter starts full and equal (same maxHp/hp), inside the ring
    const c = center(run);
    for (const f of trial.fighters.values()) {
      const e = sim.entities.get(f.entityId)!;
      expect(e.maxHp).toBe(ct.maxHp);
      expect(e.hp).toBe(ct.maxHp);
      const d = Math.hypot(e.pos.x - c.x, e.pos.z - c.z);
      expect(d).toBeLessThanOrEqual(ct.arenaRadius + 0.01);
    }
    // the player's real maxHp is banked for restore
    expect(trial.fighters.get(pid)!.savedMaxHp).toBeGreaterThan(0);
  });
});

describe('gauntlet court: vanilla combat (hostility + targeting)', () => {
  it('makes every live contestant mutually hostile so vanilla targeting engages', () => {
    const sim = makeSim(105);
    const pid = startCourtTrial(sim);
    const run = sim.gauntletRuns[0]!;
    const npcs = aliveNpcs(sim);
    expect(npcs.length).toBeGreaterThan(1);
    const pe = sim.entities.get(pid)!;
    const a = sim.entities.get(npcs[0].entityId)!;
    const b = sim.entities.get(npcs[1].entityId)!;

    // player <-> npc and npc <-> npc are foes (a free-for-all); never yourself
    expect(sim.isHostileTo(pe, a)).toBe(true);
    expect(sim.isHostileTo(a, pe)).toBe(true);
    expect(sim.isHostileTo(a, b)).toBe(true);
    expect(sim.isHostileTo(pe, pe)).toBe(false);

    // a knocked-out contestant is no longer a foe
    eliminateContestant(sim.ctx, run, npcs[0]);
    expect(sim.isHostileTo(pe, a)).toBe(false);
  });

  it('tab-targets a live court foe (which vanilla targeting could not reach otherwise)', () => {
    const sim = makeSim(112);
    const pid = startCourtTrial(sim);
    const run = sim.gauntletRuns[0]!;
    const npcs = aliveNpcs(sim);
    const rival = npcs[0];
    for (let i = 1; i < npcs.length; i++) eliminateContestant(sim.ctx, run, npcs[i]);
    const c = center(run);
    teleport(sim, pid, c.x, c.z);
    teleport(sim, rival.entityId, c.x + 3, c.z); // within tab range
    const e = sim.entities.get(pid)!;
    e.targetId = null;

    sim.tabTarget(pid);

    expect(e.targetId).toBe(rival.entityId);
  });

  it('leaving the court clears the player target and stops auto-attack', () => {
    const sim = makeSim(116);
    const pid = startCourtTrial(sim);
    const e = sim.entities.get(pid)!;
    const rival = aliveNpcs(sim)[0];
    e.targetId = rival.entityId; // locked onto a foe with vanilla targeting
    e.autoAttack = true;

    sim.gauntletLeave(pid); // forfeit

    expect(e.targetId).toBeNull(); // no stale gauntlet target in the open world
    expect(e.autoAttack).toBe(false);
  });
});

describe('gauntlet court: vanilla combat (real damage + elimination)', () => {
  it('an NPC swings at the player through the normal damage path', () => {
    const sim = makeSim(106);
    const pid = startCourtTrial(sim);
    const run = sim.gauntletRuns[0]!;
    // a clean 1v1 so the rival's only foe is the player
    const npcs = aliveNpcs(sim);
    const rival = npcs[0];
    for (let i = 1; i < npcs.length; i++) eliminateContestant(sim.ctx, run, npcs[i]);
    const c = center(run);
    teleport(sim, pid, c.x, c.z);
    teleport(sim, rival.entityId, c.x + 2, c.z); // inside reach
    courtState(sim).fighters.get(rival.entityId)!.swingReadyAt = 0; // past the opening beat
    const pe = sim.entities.get(pid)!;
    const hpBefore = pe.hp;

    const evs = sim.tick();

    // the NPC's authored flat strikeDamage lands on the equalized pool (post-
    // mitigation, so no armor) via a standard damage event (real floaties)
    expect(pe.hp).toBe(hpBefore - ct.strikeDamage);
    const dmg = pick(evs, 'damage').find(
      (d) => d.sourceId === rival.entityId && d.targetId === pid,
    );
    expect(dmg?.amount).toBe(ct.strikeDamage);
  });

  it('a vanilla killing blow eliminates the foe instead of a normal death', () => {
    const sim = makeSim(107);
    const pid = startCourtTrial(sim);
    const run = sim.gauntletRuns[0]!;
    const rival = aliveNpcs(sim)[0];
    const pe = sim.entities.get(pid)!;
    const rivalE = sim.entities.get(rival.entityId)!;

    // the player's own swing (vanilla combat, real damage) fells the rival
    (sim as unknown as { dealDamage: (...a: unknown[]) => void }).dealDamage(
      pe,
      rivalE,
      999,
      false,
      'physical',
      null,
      'hit',
    );

    expect(rival.eliminatedAtTrial).not.toBeNull(); // knocked out of the event
    expect(sim.entities.has(rival.entityId)).toBe(false); // NPC despawned, no corpse
    expect(pe.dead).toBe(false); // the fight never touched the killer
    // draining the queued events shows the poof, never a real death
    const evs = sim.tick();
    expect(pick(evs, 'gauntletPoof').some((e) => e.entityId === rival.entityId)).toBe(true);
    expect(pick(evs, 'playerDeath').length).toBe(0);
  });

  it('a player felled in the court is eliminated (spectator), not killed', () => {
    const sim = makeSim(108);
    const pid = startCourtTrial(sim);
    const run = sim.gauntletRuns[0]!;
    const rival = aliveNpcs(sim)[0];
    const pe = sim.entities.get(pid)!;
    const rivalE = sim.entities.get(rival.entityId)!;
    const saved = courtState(sim).fighters.get(pid)!.savedMaxHp;

    (sim as unknown as { dealDamage: (...a: unknown[]) => void }).dealDamage(
      rivalE,
      pe,
      999,
      false,
      'physical',
      null,
      'hit',
    );

    const pc = run.contestants.find((k) => k.entityId === pid)!;
    expect(pc.eliminatedAtTrial).not.toBeNull(); // out of the event
    expect(run.playerStates.get(pid)!.spectating).toBe(true); // parked on the terrace
    expect(pe.dead).toBe(false); // no death screen, a stylized knockout
    expect(pe.maxHp).toBe(saved); // real maxHp handed back on the way out
  });
});

describe('gauntlet court: normalization + restore', () => {
  it('restores a player real maxHp when they leave mid-court', () => {
    const sim = makeSim(110);
    const pid = startCourtTrial(sim);
    const e = sim.entities.get(pid)!;
    const saved = courtState(sim).fighters.get(pid)!.savedMaxHp;
    expect(e.maxHp).toBe(ct.maxHp); // normalized at the bell

    sim.gauntletLeave(pid); // forfeit mid-court

    expect(e.maxHp).toBe(saved); // real character restored
  });
});

describe('gauntlet court: crowning', () => {
  it('crowns the last standing, finishes them, and restores their hp', () => {
    const sim = makeSim(107);
    const pid = startCourtTrial(sim, 'Champ');
    const run = sim.gauntletRuns[0]!;
    const e = sim.entities.get(pid)!;
    const saved = courtState(sim).fighters.get(pid)!.savedMaxHp;
    for (const c of aliveNpcs(sim)) eliminateContestant(sim.ctx, run, c);

    const evs = sim.tick(); // updateCourt sees a lone survivor and crowns

    expect(run.playerStates.get(pid)!.finishedAt).not.toBeNull();
    expect(run.phase).toBe('podium');
    expect(run.podium?.first).toBe('Champ');
    expect(aliveContestants(run).length).toBe(1);
    expect(e.maxHp).toBe(saved); // real hp restored on the win
    expect(pick(evs, 'gauntletPodium').find((ev) => ev.pid === pid)?.won).toBe(true);
  });

  it('resolves a live brawl to exactly one champion within the clock', () => {
    const sim = makeSim(108);
    startCourtTrial(sim);
    const run = sim.gauntletRuns[0]!;
    for (let i = 0; i < 20 * (ct.durationS + 5) && run.phase === 'trial'; i++) sim.tick();
    expect(run.phase).toBe('podium');
    expect(aliveContestants(run).length).toBe(1);
    expect(run.podium?.first).toBeTruthy();
  }, 20000);
});

describe('gauntlet court: the podium ceremony', () => {
  it('poses the champion on the gold centre step for the ceremony', () => {
    const sim = makeSim(120);
    const pid = startCourtTrial(sim, 'Champ');
    const run = sim.gauntletRuns[0]!;
    const e = sim.entities.get(pid)!;
    for (const c of aliveNpcs(sim)) eliminateContestant(sim.ctx, run, c);

    sim.tick(); // crowns, then enters the podium phase and seats the winner

    expect(run.phase).toBe('podium');
    const P = GAUNTLET_LAYOUT.podium;
    const gold = P.steps[0];
    // teleported behind the staging plaza, onto the gold step (top of the block)
    expect(e.pos.x).toBeCloseTo(run.origin.x + gold.x, 5);
    expect(e.pos.z).toBeCloseTo(run.origin.z + P.z, 5);
    const floor = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
    expect(e.pos.y).toBeCloseTo(floor + P.baseH + gold.h, 5);
    expect(run.podiumSeats?.[0]?.entityId).toBe(pid);
  });

  it('holds the champion on the step across the ceremony, then sends them home', () => {
    const sim = makeSim(121);
    const pid = startCourtTrial(sim, 'Champ');
    const run = sim.gauntletRuns[0]!;
    const e = sim.entities.get(pid)!;
    const home = { ...run.playerStates.get(pid)!.savedPos };
    for (const c of aliveNpcs(sim)) eliminateContestant(sim.ctx, run, c);
    sim.tick(); // crown + seat
    const seat = { ...e.pos };

    // Try to walk off the podium: the end-of-tick pin snaps the champion back.
    for (let i = 0; i < 20; i++) {
      sim.meta(pid)!.moveInput.forward = true;
      sim.tick();
      if (run.phase !== 'podium') break;
    }
    if (run.phase === 'podium') {
      expect(e.pos.x).toBeCloseTo(seat.x, 5);
      expect(e.pos.z).toBeCloseTo(seat.z, 5);
    }

    // Run the ceremony out: the winner is returned to where they entered.
    for (let i = 0; i < 20 * (GAUNTLET.podiumS + 2) && sim.gauntletRuns[0]; i++) sim.tick();
    expect(sim.gauntletRuns[0]).toBeUndefined();
    expect(e.pos.x).toBeCloseTo(home.x, 5);
    expect(e.pos.z).toBeCloseTo(home.z, 5);
  }, 20000);
});

describe('gauntlet court: timeout tie-break', () => {
  it('crowns the highest remaining hp when the clock expires', () => {
    const sim = makeSim(109);
    const pid = startCourtTrial(sim);
    const run = sim.gauntletRuns[0]!;
    // hand the player full hp, wound every NPC, then expire the clock
    const pe = sim.entities.get(pid)!;
    pe.hp = pe.maxHp;
    for (const c of aliveNpcs(sim)) {
      const ne = sim.entities.get(c.entityId);
      if (ne) ne.hp = 20;
    }
    run.phaseEndsAt = sim.time; // force the cap this tick

    sim.tick();

    expect(run.playerStates.get(pid)!.finishedAt).not.toBeNull();
    expect(aliveContestants(run).length).toBe(1);
    expect(run.contestants.find((c) => c.entityId === pid)!.eliminatedAtTrial).toBeNull();
  });
});

describe('gauntlet court: determinism', () => {
  it('is byte-identical across two same-seed sims with identical scripted inputs', () => {
    const scenario = () => {
      const sim = makeSim(207);
      const pid = sim.addPlayer('warrior', 'Det');
      openAndJoin(sim, pid);
      const evs: SimEvent[] = [];
      for (let i = 0; i < 20 * 120; i++) {
        sim.meta(pid)!.moveInput.forward = sim.gauntletRuns[0]?.phase === 'trial';
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
