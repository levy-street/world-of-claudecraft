import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GAUNTLET, GAUNTLET_VENUE } from '../src/sim/content/gauntlet';
import type { GauntletSpanState } from '../src/sim/gauntlet/state';
import {
  spanFieldEndZ,
  spanSideCenterX,
  spanStepCenterZ,
  spanZStart,
} from '../src/sim/gauntlet/trial_span';
import { trialDamageFromScore } from '../src/sim/gauntlet/vitality';
import { Sim } from '../src/sim/sim';
import type { GauntletTrialKind, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// --- local helpers (copied idioms from gauntlet.test.ts) ---

const makeSim = (seed = 42) =>
  new Sim({
    seed,
    playerClass: 'warrior',
    noPlayer: true,
    gauntletAlwaysOpen: true,
    gauntletInstantLobby: true,
  });

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

// Tick once so the recruiter spawns, stand the player beside it, and join. The
// instant lobby starts the run immediately (offline single-player idiom).
function openAndJoin(sim: Sim, pid: number) {
  sim.tick();
  const r = recruiter(sim)!;
  teleport(sim, pid, r.pos.x, r.pos.z);
  sim.gauntletJoin(pid);
}

// Advance from the instant-lobby staging area into the live span trial.
function advanceToSpan(sim: Sim, maxTicks = 20 * 30) {
  for (let i = 0; i < maxTicks && sim.gauntletRuns[0]?.phase !== 'trial'; i++) sim.tick();
}

function spanState(sim: Sim): GauntletSpanState {
  return sim.gauntletRuns[0]!.trial as GauntletSpanState;
}

// Instance-local -> world teleport onto a step/side (or an explicit local x,z).
function teleportLocal(sim: Sim, pid: number, localX: number, localZ: number) {
  const run = sim.gauntletRuns[0]!;
  teleport(sim, pid, run.origin.x + localX, run.origin.z + localZ);
}

function pick<T extends SimEvent['type']>(
  evs: SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return evs.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

// -----------------------------------------------------------------------------
// Isolate trial 5: a one-trial run so the field arrives at the span un-culled.

let savedTrials: GauntletTrialKind[];
let savedTargets: number[];

beforeEach(() => {
  savedTrials = GAUNTLET.trials;
  savedTargets = GAUNTLET.targetSurvivorsPerTrial;
  GAUNTLET.trials = ['span'];
  GAUNTLET.targetSurvivorsPerTrial = [12];
});

afterEach(() => {
  GAUNTLET.trials = savedTrials;
  GAUNTLET.targetSurvivorsPerTrial = savedTargets;
});

// -----------------------------------------------------------------------------

describe('the brittle span panel geometry', () => {
  it('matches the venue convention exactly (the renderer draws from these rects)', () => {
    const t = GAUNTLET.span;
    const a = GAUNTLET_VENUE.span;
    const zStart = a.z - (t.steps * t.panelLength) / 2;
    expect(spanZStart()).toBeCloseTo(zStart, 9);
    expect(spanFieldEndZ()).toBeCloseTo(zStart + t.steps * t.panelLength, 9);
    const off = t.panelGap / 2 + t.panelWidth / 2;
    expect(spanSideCenterX(0)).toBeCloseTo(a.x - off, 9);
    expect(spanSideCenterX(1)).toBeCloseTo(a.x + off, 9);
    expect(spanStepCenterZ(0)).toBeCloseTo(zStart + 0.5 * t.panelLength, 9);
    expect(spanStepCenterZ(t.steps - 1)).toBeCloseTo(spanFieldEndZ() - 0.5 * t.panelLength, 9);
    // the pair leaves a real gap between them
    expect(spanSideCenterX(1) - spanSideCenterX(0)).toBeCloseTo(t.panelGap + t.panelWidth, 9);
  });
});

describe('the brittle span layout', () => {
  it('is deterministic: two same-seed runs agree on the safe sides', () => {
    const build = (seed: number) => {
      const sim = makeSim(seed);
      const pid = sim.addPlayer('warrior', 'Layout');
      openAndJoin(sim, pid);
      advanceToSpan(sim);
      return spanState(sim);
    };
    const a = build(101);
    const b = build(101);
    expect(a.safeSide.length).toBe(GAUNTLET.span.steps);
    expect(a.safeSide).toEqual(b.safeSide);
    for (const s of a.safeSide) expect(s === 0 || s === 1).toBe(true);
    // starts fully unknown, with a slot per step
    expect(a.revealed).toEqual(new Array(GAUNTLET.span.steps).fill(-1));
  });
});

describe('the brittle span player detection', () => {
  it('shatters on the brittle panel: fall damage, a reveal, and a respawn at the start', () => {
    const sim = makeSim(202);
    const pid = sim.addPlayer('warrior', 'Faller');
    openAndJoin(sim, pid);
    advanceToSpan(sim);
    const run = sim.gauntletRuns[0]!;
    const span = spanState(sim);
    const i = 4;
    const brittle = 1 - span.safeSide[i];
    teleportLocal(sim, pid, spanSideCenterX(brittle), spanStepCenterZ(i));
    const evs = sim.tick();

    const dmg = pick(evs, 'gauntletDamage').find((e) => e.pid === pid && e.cause === 'caught');
    expect(dmg).toBeTruthy();
    expect(dmg!.amount).toBe(GAUNTLET.span.fallDamage);
    expect(dmg!.vitality).toBe(GAUNTLET.vitalityMax - GAUNTLET.span.fallDamage);
    // the shattered pair is now known to the field
    expect(span.revealed[i]).toBe(span.safeSide[i]);
    // respawned south of the first panel, centered between the pair
    const e = sim.entities.get(pid)!;
    const lz = e.pos.z - run.origin.z;
    const lx = e.pos.x - run.origin.x;
    expect(lz).toBeLessThan(spanZStart());
    expect(lz).toBeGreaterThan(spanZStart() - 5);
    expect(Math.abs(lx - GAUNTLET_VENUE.span.x)).toBeLessThan(0.5);
    const c = run.contestants.find((k) => k.entityId === pid)!;
    expect(c.vitality).toBe(GAUNTLET.vitalityMax - GAUNTLET.span.fallDamage);
  });

  it('advances on the safe panels, reveals them, and finishes across the far edge', () => {
    const sim = makeSim(303);
    const pid = sim.addPlayer('warrior', 'Crosser');
    openAndJoin(sim, pid);
    advanceToSpan(sim);
    const run = sim.gauntletRuns[0]!;
    const span = spanState(sim);
    for (let i = 0; i < GAUNTLET.span.steps; i++) {
      teleportLocal(sim, pid, spanSideCenterX(span.safeSide[i]), spanStepCenterZ(i));
      sim.tick();
      expect(span.revealed[i]).toBe(span.safeSide[i]);
      expect(span.playerStep.get(pid)).toBe(i);
    }
    // a clean safe walk costs no vitality
    const c = run.contestants.find((k) => k.entityId === pid)!;
    expect(c.vitality).toBe(GAUNTLET.vitalityMax);
    // stepping past the far edge (inside the width envelope) finishes the trial
    teleportLocal(sim, pid, GAUNTLET_VENUE.span.x, spanFieldEndZ() + 1);
    sim.tick();
    expect(sim.gauntletRunWire(pid)!.finished).toBe(true);
  });

  it('falls through the gap between the pair, revealing nothing', () => {
    const sim = makeSim(404);
    const pid = sim.addPlayer('warrior', 'Gapper');
    openAndJoin(sim, pid);
    advanceToSpan(sim);
    const run = sim.gauntletRuns[0]!;
    const span = spanState(sim);
    const i = 5;
    // dead center between the panels: in the gap
    teleportLocal(sim, pid, GAUNTLET_VENUE.span.x, spanStepCenterZ(i));
    const evs = sim.tick();

    const dmg = pick(evs, 'gauntletDamage').find((e) => e.pid === pid && e.cause === 'caught');
    expect(dmg).toBeTruthy();
    expect(dmg!.amount).toBe(GAUNTLET.span.fallDamage);
    // a gap fall teaches the field nothing (no panel was tested)
    expect(span.revealed[i]).toBe(-1);
    expect(span.playerStep.has(pid)).toBe(false);
    // respawned south of the field
    const e = sim.entities.get(pid)!;
    expect(e.pos.z - run.origin.z).toBeLessThan(spanZStart());
  });
});

describe('the brittle span crossers', () => {
  it('reveal early panels over time with no player input, poofing on their guesses', () => {
    const sim = makeSim(505);
    const pid = sim.addPlayer('warrior', 'Idle');
    openAndJoin(sim, pid);
    advanceToSpan(sim);
    const span = spanState(sim);
    expect(span.npcCrossers.length).toBe(GAUNTLET.span.npcAheadCount);
    // park the player well south of the span so ONLY the crossers act
    teleportLocal(sim, pid, GAUNTLET_VENUE.span.x, spanZStart() - 10);
    expect(span.revealed.filter((r) => r >= 0).length).toBe(0);

    const poofs: SimEvent[] = [];
    for (let i = 0; i < 20 * 45 && sim.gauntletRuns[0]?.phase === 'trial'; i++) {
      for (const e of sim.tick()) if (e.type === 'gauntletPoof') poofs.push(e);
    }

    // panels lit up although no player ever stepped on one
    expect(span.revealed.filter((r) => r >= 0).length).toBeGreaterThan(0);
    expect(span.playerStep.size).toBe(0);
    // at least one crosser met a brittle panel (per the seeded plan)
    expect(poofs.length).toBeGreaterThan(0);
  }, 20000);
});

describe('the brittle span resolution', () => {
  it('deals timeout damage that scales with how many panels a player proved', () => {
    const dmgAt = (seed: number, reach: number): number => {
      const sim = makeSim(seed);
      const pid = sim.addPlayer('warrior', 'Stuck');
      openAndJoin(sim, pid);
      advanceToSpan(sim);
      const run = sim.gauntletRuns[0]!;
      const span = spanState(sim);
      // stand on the target panel so playerStep records it
      teleportLocal(sim, pid, spanSideCenterX(span.safeSide[reach]), spanStepCenterZ(reach));
      sim.tick();
      expect(span.playerStep.get(pid)).toBe(reach);
      // force the trial clock to expire and resolve
      run.phaseEndsAt = sim.time;
      const evs = sim.tick();
      const dmg = pick(evs, 'gauntletDamage').find((e) => e.pid === pid && e.cause === 'timeout');
      expect(dmg).toBeTruthy();
      return dmg!.amount;
    };
    const near = dmgAt(606, 2); // stuck early
    const far = dmgAt(606, 12); // nearly across
    expect(near).toBeGreaterThan(far);
    // decisive: exactly the (step + 1) / steps score curve
    const t = GAUNTLET.span;
    expect(near).toBe(trialDamageFromScore((2 + 1) / t.steps, t.damageMax));
    expect(far).toBe(trialDamageFromScore((12 + 1) / t.steps, t.damageMax));
  });
});

describe('the brittle span determinism', () => {
  it('two same-seed runs with identical scripts produce identical reveals and vitality', () => {
    const scenario = (): string => {
      const sim = makeSim(707);
      const pid = sim.addPlayer('warrior', 'Det');
      openAndJoin(sim, pid);
      advanceToSpan(sim);
      const run = sim.gauntletRuns[0]!;
      const span = spanState(sim);
      // park the player south so the crossers drive the whole trial: the only
      // run.rng draws are their seeded plans, so any draw-order fork shows here
      teleportLocal(sim, pid, GAUNTLET_VENUE.span.x, spanZStart() - 10);
      const evs: SimEvent[] = [];
      for (let i = 0; i < 20 * 40 && sim.gauntletRuns[0]?.phase === 'trial'; i++) {
        for (const e of sim.tick()) if (e.type.startsWith('gauntlet')) evs.push(e);
      }
      const c = run.contestants.find((k) => k.entityId === pid)!;
      return JSON.stringify({ revealed: span.revealed, vitality: c.vitality, evs });
    };
    const a = scenario();
    const b = scenario();
    // a real mid-trial stream (crosser poofs + shared reveals), byte-identical twice
    expect(a.includes('gauntletPoof')).toBe(true);
    expect(a).toBe(b);
  }, 20000);
});
