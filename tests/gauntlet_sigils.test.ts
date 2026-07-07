import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GAUNTLET } from '../src/sim/content/gauntlet';
import { type SigilOutline, sigilOutline } from '../src/sim/gauntlet/sigil_shapes';
import { Sim } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// --- local helpers (not shared; copied idioms from gauntlet.test.ts) ---

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

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

// Instant-lobby join: tick once so the recruiter spawns, then stand beside it
// and join (the run starts on the spot in single-player).
function openAndJoin(sim: Sim, pid: number) {
  sim.tick();
  const r = recruiter(sim)!;
  teleport(sim, pid, r.pos.x, r.pos.z);
  sim.gauntletJoin(pid);
}

function advanceToTrial(sim: Sim, maxTicks = 20 * 40) {
  for (let i = 0; i < maxTicks && sim.gauntletRuns[0]?.phase !== 'trial'; i++) sim.tick();
}

// Point on a closed outline at a target arc-fraction (0..1), walking the same
// piecewise-linear polyline the scorer uses.
function pointAtArc(o: SigilOutline, frac: number): [number, number] {
  const n = o.xs.length;
  const seg = new Array<number>(n);
  let total = 0;
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    seg[k] = Math.hypot(o.xs[j] - o.xs[k], o.ys[j] - o.ys[k]);
    total += seg[k];
  }
  let target = frac * total;
  for (let k = 0; k < n; k++) {
    if (target <= seg[k] || k === n - 1) {
      const j = (k + 1) % n;
      const t = seg[k] > 0 ? target / seg[k] : 0;
      return [o.xs[k] + t * (o.xs[j] - o.xs[k]), o.ys[k] + t * (o.ys[j] - o.ys[k])];
    }
    target -= seg[k];
  }
  return [o.xs[0], o.ys[0]];
}

// Drive one sim into the sigils trial and hand back the live per-player state,
// with the shape optionally forced and the crack/coverage state reset so a test
// controls the trace from a known start.
function startTrialSim(seed: number, shapeId?: number) {
  const sim = makeSim(seed);
  const pid = sim.addPlayer('warrior', 'Etcher');
  openAndJoin(sim, pid);
  advanceToTrial(sim);
  const run = sim.gauntletRuns[0]!;
  const trial = run.trial;
  if (!trial || trial.kind !== 'sigils') throw new Error('expected the sigils trial to be live');
  const sp = trial.players.get(pid)!;
  if (shapeId !== undefined) sp.shapeId = shapeId;
  sp.covered.fill(false);
  sp.coveredCount = 0;
  sp.carveBank = 0;
  sp.crack = 0;
  sp.shatters = 0;
  sp.done = false;
  sp.lastPointAt = sim.time;
  return { sim, pid, run, trial, sp };
}

// -----------------------------------------------------------------------------

describe('sigil shapes (pure)', () => {
  const n = GAUNTLET.sigils.outlinePoints;

  it('sigilOutline is deterministic per (seed, shapeId, points) and varies with the seed', () => {
    const a = sigilOutline(12345, 2, n);
    const b = sigilOutline(12345, 2, n);
    expect(a).toEqual(b);
    expect(a.xs.length).toBe(n);
    expect(a.ys.length).toBe(n);
    expect(a.thin.length).toBe(n);
    // a different seed yields a different (rotated/scaled) outline
    expect(sigilOutline(67890, 2, n).xs).not.toEqual(a.xs);
  });

  it('every vertex stays inside the unit square', () => {
    for (const id of [0, 1, 2, 3]) {
      const o = sigilOutline(4242, id, n);
      for (let i = 0; i < n; i++) {
        expect(o.xs[i]).toBeGreaterThanOrEqual(0);
        expect(o.xs[i]).toBeLessThanOrEqual(1);
        expect(o.ys[i]).toBeGreaterThanOrEqual(0);
        expect(o.ys[i]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('only the star and crown carry thin (fragile) sections', () => {
    expect(sigilOutline(1, 0, n).thin.some(Boolean)).toBe(false); // ring
    expect(sigilOutline(1, 1, n).thin.some(Boolean)).toBe(false); // wedge
    expect(sigilOutline(1, 2, n).thin.some(Boolean)).toBe(true); // star
    expect(sigilOutline(1, 3, n).thin.some(Boolean)).toBe(true); // crown
    // the thin band is a minority of the loop, not the whole shape
    expect(sigilOutline(1, 2, n).thin.filter(Boolean).length).toBeLessThan(n);
  });
});

describe('sigil trial scoring', () => {
  const savedTrials = [...GAUNTLET.trials];
  const savedTargets = [...GAUNTLET.targetSurvivorsPerTrial];
  beforeAll(() => {
    GAUNTLET.trials.splice(0, GAUNTLET.trials.length, 'sigils');
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

  it('a clean, on-path freedraw drag reaches done with no shatter', () => {
    const { sim, pid, run, sp } = startTrialSim(5, 0); // ring: no thin, no self-proximity
    const n = GAUNTLET.sigils.outlinePoints;
    const outline = sigilOutline(sp.shapeSeed, 0, n);
    // Walk the arc forward at ~half the carve cap (an honest continuous drag).
    const paceFracPerTick = ((0.5 * GAUNTLET.sigils.coverageCapPerS) / n) * DT * 20;
    let frac = 0.25; // freedraw: the stroke may begin anywhere on the outline
    for (let i = 0; i < 20 * 60 && !sp.done; i++) {
      frac = (frac + paceFracPerTick) % 1;
      const [x, y] = pointAtArc(outline, frac);
      sim.gauntletTrace([x, y], pid);
      sim.tick();
    }
    expect(sp.done).toBe(true);
    expect(sp.shatters).toBe(0);
    expect(sp.crack).toBe(0);
    expect(run.playerStates.get(pid)!.finishedAt).not.toBeNull();
    // a finisher takes no end-of-trial damage
    const c = run.contestants.find((k) => k.entityId === pid)!;
    expect(c.vitality).toBe(GAUNTLET.vitalityMax);
  }, 20000);

  it('tracing the arc BACKWARD still accrues coverage (order-free)', () => {
    const { sim, pid, sp } = startTrialSim(11, 0);
    const n = GAUNTLET.sigils.outlinePoints;
    const outline = sigilOutline(sp.shapeSeed, 0, n);
    const paceFracPerTick = ((0.5 * GAUNTLET.sigils.coverageCapPerS) / n) * DT * 20;
    let frac = 0.6;
    for (let i = 0; i < 20 * 3; i++) {
      frac = (frac - paceFracPerTick + 1) % 1;
      const [x, y] = pointAtArc(outline, frac);
      sim.gauntletTrace([x, y], pid);
      sim.tick();
    }
    expect(sp.coveredCount).toBeGreaterThan(0);
    expect(sp.crack).toBe(0);
  });

  it('tracing the same arc twice adds nothing', () => {
    const { sim, pid, sp } = startTrialSim(12, 0);
    const n = GAUNTLET.sigils.outlinePoints;
    const outline = sigilOutline(sp.shapeSeed, 0, n);
    const retrace = () => {
      // the same short arc window, walked over 3 seconds
      for (let i = 0; i < 20 * 3; i++) {
        const [x, y] = pointAtArc(outline, 0.3 + 0.1 * ((i % 20) / 20));
        sim.gauntletTrace([x, y], pid);
        sim.tick();
      }
    };
    retrace();
    const afterFirst = sp.coveredCount;
    expect(afterFirst).toBeGreaterThan(0);
    retrace();
    expect(sp.coveredCount).toBe(afterFirst); // already carved; nothing new
    expect(sp.crack).toBe(0); // staying on the band never cracks
  });

  it('feeding the whole outline in one instant is capped by the carve rate', () => {
    const { sim, pid, sp } = startTrialSim(6, 0);
    const n = GAUNTLET.sigils.outlinePoints;
    const outline = sigilOutline(sp.shapeSeed, 0, n);
    sim.tick(); // one tick elapses so the batch has a real (small) time budget
    const pts: number[] = [];
    for (let i = 0; i < n; i++) pts.push(outline.xs[i], outline.ys[i]);
    sim.gauntletTrace(pts, pid);
    // carved at most the banked budget (one second's worth at the cap), far
    // from done, and on-band spam never cracks
    expect(sp.coveredCount).toBeLessThanOrEqual(GAUNTLET.sigils.coverageCapPerS);
    expect(sp.done).toBe(false);
    expect(sp.crack).toBe(0);
  });

  it('off-band points accrue crack (double when far out) and never coverage', () => {
    const { sim, pid, sp } = startTrialSim(13, 0);
    const outline = sigilOutline(sp.shapeSeed, 0, GAUNTLET.sigils.outlinePoints);
    // A graze just outside the band vs a wild point far outside it: build both
    // from the outline's own geometry so the distances are known.
    const [px, py] = pointAtArc(outline, 0);
    const dx = px - 0.5;
    const dy = py - 0.5;
    const len = Math.hypot(dx, dy);
    const graze: [number, number] = [
      px + (dx / len) * 1.5 * GAUNTLET.sigils.tolerance,
      py + (dy / len) * 1.5 * GAUNTLET.sigils.tolerance,
    ];
    sim.tick();
    sim.gauntletTrace([graze[0], graze[1]], pid);
    const grazeCrack = sp.crack;
    expect(grazeCrack).toBeGreaterThan(0);
    expect(sp.coveredCount).toBe(0);
    // the unit-square center sits ~0.36+ from the ring, past 2x tolerance
    sp.crack = 0;
    sp.lastPointAt = sim.time;
    sim.tick();
    sim.gauntletTrace([0.5, 0.5], pid);
    expect(sp.coveredCount).toBe(0);
    expect(sp.crack).toBeCloseTo(grazeCrack * 2, 6); // the far-off doubling
  });

  it('full crack shatters: a vitality chunk, coverage resets, and play continues', () => {
    const { sim, pid, run, sp } = startTrialSim(7, 0);
    const c = run.contestants.find((k) => k.entityId === pid)!;
    const startVitality = c.vitality;
    const oldSeed = sp.shapeSeed;
    // Carve a little first so the shatter observably resets coverage.
    const outline = sigilOutline(sp.shapeSeed, 0, GAUNTLET.sigils.outlinePoints);
    const [ox, oy] = pointAtArc(outline, 0.5);
    for (let i = 0; i < 20; i++) {
      sim.gauntletTrace([ox, oy], pid);
      sim.tick();
    }
    expect(sp.coveredCount).toBeGreaterThan(0);
    // The unit-square center sits well inside the ring, far past tolerance:
    // every fed point is off the line.
    for (let i = 0; i < 20 * 30 && sp.shatters === 0; i++) {
      sim.gauntletTrace([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], pid);
      sim.tick();
    }
    expect(sp.shatters).toBe(1);
    expect(c.vitality).toBe(startVitality - GAUNTLET.sigils.shatterDamage);
    expect(sp.crack).toBe(0); // reset on shatter
    expect(sp.coveredCount).toBe(0);
    expect(sp.covered.some(Boolean)).toBe(false);
    expect(sp.shapeSeed).not.toBe(oldSeed); // a fresh etching
    // play continues: the fresh pane accepts new coverage
    const fresh = sigilOutline(sp.shapeSeed, sp.shapeId, GAUNTLET.sigils.outlinePoints);
    const [nx, ny] = pointAtArc(fresh, 0.2);
    for (let i = 0; i < 20; i++) {
      sim.gauntletTrace([nx, ny], pid);
      sim.tick();
    }
    expect(sp.coveredCount).toBeGreaterThan(0);
  }, 20000);

  it('a player who traced nothing takes damageMax at the timeout', () => {
    const { sim, run } = startTrialSim(8);
    const pid = [...run.playerStates.keys()][0];
    const c = run.contestants.find((k) => k.entityId === pid)!;
    // tick through the whole trial without a single trace point
    for (let i = 0; i < 20 * 120 && sim.gauntletRuns[0]?.trial?.kind === 'sigils'; i++) {
      sim.tick();
    }
    // resolved on the clock: zero progress => the full end-of-trial damage
    expect(c.vitality).toBe(GAUNTLET.vitalityMax - GAUNTLET.sigils.damageMax);
  }, 30000);

  it('two same-seed sims fed identical trace inputs produce identical outcomes', () => {
    const scenario = () => {
      const { sim, pid, run, sp } = startTrialSim(9);
      const c = run.contestants.find((k) => k.entityId === pid)!;
      const snap: string[] = [];
      // off-path churn: crack climbs to a shatter (a per-run rng draw for the
      // fresh seed) over and over, so the stream exercises the trace-path rng
      for (let i = 0; i < 20 * 15; i++) {
        sim.gauntletTrace([0.5, 0.5, 0.5, 0.5], pid);
        sim.tick();
        snap.push(
          `${sp.crack.toFixed(6)}|${sp.coveredCount}|${sp.shatters}|${sp.shapeSeed}|${c.vitality}`,
        );
      }
      return snap;
    };
    const a = scenario();
    const b = scenario();
    expect(b).toEqual(a);
    // the scenario actually exercised scoring (at least one shatter fired)
    expect(Number(a[a.length - 1].split('|')[2])).toBeGreaterThan(0);
  }, 20000);
});
