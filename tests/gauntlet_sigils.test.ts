import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GAUNTLET, GAUNTLET_VENUE, sigilRingAngle } from '../src/sim/content/gauntlet';
import { type SigilOutline, sigilOutline } from '../src/sim/gauntlet/sigil_shapes';
import { Sim } from '../src/sim/sim';
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

  it('every vertex of every shape stays inside the unit square', () => {
    for (const id of [0, 1, 2, 3, 4]) {
      const o = sigilOutline(4242, id, n);
      for (let i = 0; i < n; i++) {
        expect(o.xs[i]).toBeGreaterThanOrEqual(0);
        expect(o.xs[i]).toBeLessThanOrEqual(1);
        expect(o.ys[i]).toBeGreaterThanOrEqual(0);
        expect(o.ys[i]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the circle carries no thin sections; every cornered shape does', () => {
    // 0 triangle, 1 circle, 2 star, 3 rectangle, 4 hexagon.
    expect(sigilOutline(1, 1, n).thin.some(Boolean)).toBe(false); // circle: smooth
    for (const id of [0, 2, 3, 4]) {
      const o = sigilOutline(1, id, n);
      expect(o.thin.some(Boolean)).toBe(true); // corners are fragile
      // the thin band is a minority of the loop, not the whole shape
      expect(o.thin.filter(Boolean).length).toBeLessThan(n);
    }
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

  it('the NPC field mans the ring lecterns during the trial', () => {
    const { sim, run } = startTrialSim(31);
    const { x, z, ring } = GAUNTLET_VENUE.sigils;
    const npcs = run.contestants.filter((c) => !c.player && c.eliminatedAtTrial === null);
    expect(npcs.length).toBeGreaterThan(ring.count); // the ring fills, extras rank behind
    for (let i = 0; i < ring.count; i++) {
      const e = sim.entities.get(npcs[i].entityId)!;
      const a = sigilRingAngle(i, ring.count);
      expect(e.pos.x).toBeCloseTo(run.origin.x + x + Math.sin(a) * (ring.radius + 1.6), 3);
      expect(e.pos.z).toBeCloseTo(run.origin.z + z + Math.cos(a) * (ring.radius + 1.6), 3);
    }
    // the overflow rank stands one step further out at the same station angle
    const extra = sim.entities.get(npcs[ring.count].entityId)!;
    const a0 = sigilRingAngle(0, ring.count);
    expect(extra.pos.x).toBeCloseTo(run.origin.x + x + Math.sin(a0) * (ring.radius + 3.2), 3);
  });

  it('the shape roll picks any of the five shapes (0..4) with real variety', () => {
    // The per-run seed keys off the run-creation tick (runs.ts), so vary the
    // ticks before joining to sample distinct shape rolls.
    const seen = new Set<number>();
    for (let pre = 0; pre < 24; pre++) {
      const sim = makeSim(42);
      const pid = sim.addPlayer('warrior', 'Etcher');
      sim.tick(); // spawn the recruiter
      for (let i = 0; i < pre; i++) sim.tick(); // shift the run-creation tick
      const r = recruiter(sim)!;
      teleport(sim, pid, r.pos.x, r.pos.z);
      sim.gauntletJoin(pid);
      advanceToTrial(sim);
      const trial = sim.gauntletRuns[0]!.trial;
      if (!trial || trial.kind !== 'sigils') throw new Error('expected the sigils trial');
      const sp = trial.players.get(pid)!;
      expect(sp.shapeId).toBeGreaterThanOrEqual(0);
      expect(sp.shapeId).toBeLessThanOrEqual(4);
      seen.add(sp.shapeId);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3); // real variety across run seeds
  }, 30000);

  it('a clean, continuous on-path drag reaches done with no shatter', () => {
    const { sim, pid, run, sp } = startTrialSim(5, 1); // circle: no thin, radial from center
    const n = GAUNTLET.sigils.outlinePoints;
    const outline = sigilOutline(sp.shapeSeed, 1, n);
    // Walk the arc forward in steps under the contiguity reach, so the covered
    // frontier extends without a gap; coverage grows as one connected pass.
    const paceFracPerTick = GAUNTLET.sigils.carveArcFrac * 0.8;
    let frac = 0.25; // the stroke may begin anywhere on the outline
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

  it('scattered dabs never stitch the loop: coverage stays a tiny seed', () => {
    const { sim, pid, sp } = startTrialSim(21, 1); // circle
    const n = GAUNTLET.sigils.outlinePoints;
    const outline = sigilOutline(sp.shapeSeed, 1, n);
    // Six fixed dab spots hammered for ten seconds. Only the first seeds the
    // arc; the others land far from the covered frontier (a jump across the
    // shape), so they carve nothing. Coverage never grows past the seed.
    const spots = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6].map((f) => pointAtArc(outline, f));
    for (let i = 0; i < 20 * 10 && !sp.done; i++) {
      const pts: number[] = [];
      for (const [x, y] of spots) pts.push(x, y);
      sim.gauntletTrace(pts, pid);
      sim.tick();
    }
    expect(sp.done).toBe(false);
    expect(sp.crack).toBe(0); // the dabs are all on-band, so nothing cracks
    expect(sp.coveredCount).toBeLessThan(n * 0.15); // never stitched into a loop
  });

  it('a point just outside the tightened band cracks', () => {
    const { sim, pid, sp } = startTrialSim(22, 1); // circle: the line is radial from center
    const outline = sigilOutline(sp.shapeSeed, 1, GAUNTLET.sigils.outlinePoints);
    const [px, py] = pointAtArc(outline, 0);
    const dx = px - 0.5;
    const dy = py - 0.5;
    const len = Math.hypot(dx, dy);
    // 0.07 out: well past the tightened 0.02 accept band, so it cracks.
    const off = 0.07;
    expect(off).toBeGreaterThan(GAUNTLET.sigils.tolerance);
    const p: [number, number] = [px + (dx / len) * off, py + (dy / len) * off];
    sim.tick();
    sim.gauntletTrace([p[0], p[1]], pid);
    expect(sp.crack).toBeGreaterThan(0);
    expect(sp.coveredCount).toBe(0);
  });

  it('tracing the arc BACKWARD from the seed still extends coverage', () => {
    const { sim, pid, sp } = startTrialSim(11, 1);
    const n = GAUNTLET.sigils.outlinePoints;
    const outline = sigilOutline(sp.shapeSeed, 1, n);
    // Continuous backward drag under the contiguity reach: the frontier extends
    // the other way, so a trace works either direction from where it began.
    const paceFracPerTick = GAUNTLET.sigils.carveArcFrac * 0.8;
    let frac = 0.6;
    for (let i = 0; i < 20 * 3; i++) {
      frac = (frac - paceFracPerTick + 1) % 1;
      const [x, y] = pointAtArc(outline, frac);
      sim.gauntletTrace([x, y], pid);
      sim.tick();
    }
    expect(sp.coveredCount).toBeGreaterThan(5);
    expect(sp.crack).toBe(0);
  });

  it('re-tracing an already-covered arc adds nothing', () => {
    const { sim, pid, sp } = startTrialSim(12, 1);
    const n = GAUNTLET.sigils.outlinePoints;
    const outline = sigilOutline(sp.shapeSeed, 1, n);
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
    const { sim, pid, sp } = startTrialSim(6, 1);
    const n = GAUNTLET.sigils.outlinePoints;
    const outline = sigilOutline(sp.shapeSeed, 1, n);
    sim.tick(); // one tick elapses so the batch has a real (small) time budget
    // The outline points are in arc order, so this fat batch IS a contiguous
    // chain (each point adjacent to the last): contiguity would let it all carve,
    // but the per-second rate cap holds it to the banked budget.
    const pts: number[] = [];
    for (let i = 0; i < n; i++) pts.push(outline.xs[i], outline.ys[i]);
    sim.gauntletTrace(pts, pid);
    expect(sp.coveredCount).toBeLessThanOrEqual(GAUNTLET.sigils.coverageCapPerS);
    expect(sp.done).toBe(false);
    expect(sp.crack).toBe(0);
  });

  it('off-band points accrue crack (double when far out) and never coverage', () => {
    const { sim, pid, sp } = startTrialSim(13, 1);
    const outline = sigilOutline(sp.shapeSeed, 1, GAUNTLET.sigils.outlinePoints);
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
    const { sim, pid, run, sp } = startTrialSim(7, 1);
    const c = run.contestants.find((k) => k.entityId === pid)!;
    const startVitality = c.vitality;
    const oldSeed = sp.shapeSeed;
    // Carve a little first so the shatter observably resets coverage.
    const outline = sigilOutline(sp.shapeSeed, 1, GAUNTLET.sigils.outlinePoints);
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

  it('a player who traced nothing is knocked out at the timeout (zero coverage is fatal)', () => {
    const { sim, run } = startTrialSim(8);
    const pid = [...run.playerStates.keys()][0];
    const c = run.contestants.find((k) => k.entityId === pid)!;
    // tick through the whole trial without a single trace point
    for (let i = 0; i < 20 * 120 && sim.gauntletRuns[0]?.trial?.kind === 'sigils'; i++) {
      sim.tick();
    }
    // Resolved on the clock: zero coverage takes the full-pool end-of-trial
    // toll (damageMax === vitalityMax), which is lethal from full vitality, so
    // an idle player is eliminated rather than coasting to the next trial.
    expect(GAUNTLET.sigils.damageMax).toBe(GAUNTLET.vitalityMax);
    expect(c.vitality).toBe(0);
    expect(c.eliminatedAtTrial).not.toBeNull();
    expect(run.playerStates.get(pid)!.spectating).toBe(true);
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
