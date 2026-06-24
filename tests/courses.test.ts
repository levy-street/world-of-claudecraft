import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';
import type { SimEvent } from '../src/sim/types';
import { COURSES, courseTotalGates } from '../src/sim/content/courses';

const CAST_TICKS = 40; // mount summon (1.5s) + margin

function makeFlyer() {
  const sim = new Sim({ seed: 9, playerClass: 'warrior', autoEquip: true });
  const p = sim.player;
  // summon on known-good open ground; course pass-through teleports the rider to
  // each gate anyway, so the spawn spot is independent of the course location.
  p.pos.x = 40; p.pos.z = 40;
  p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  p.mountTier = 11;
  // pacify so nothing can interfere
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob') { e.hostile = false; e.aggroTargetId = null; e.aiState = 'idle'; }
  }
  sim.summonMount('sovereign'); // a flyer
  for (let i = 0; i < CAST_TICKS; i++) sim.tick();
  expect(p.mountId).toBe('sovereign');
  return { sim, p, meta: (sim as unknown as { players: Map<number, { courseRun: unknown }> }).players.get(sim.playerId)! };
}

// Teleport onto a checkpoint at the start of a tick, then advance one tick: the
// tick copies prevPos←pos (both = checkpoint), flight nudges pos, and
// updateCourseRun tests the prev→cur segment (which starts at the gate centre).
function flyThroughGate(sim: Sim, p: { pos: { x: number; y: number; z: number } }, gate: { x: number; y: number; z: number }): SimEvent[] {
  p.pos.x = gate.x; p.pos.y = gate.y; p.pos.z = gate.z;
  return sim.tick();
}

describe('course substrate — start gating', () => {
  it('rejects a flyingOnly course for a ground mount, an unknown id, and double-starts', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', autoEquip: true });
    const p = sim.player;
    p.mountTier = 11;
    p.pos.x = 40; p.pos.z = 40; p.pos.y = terrainHeight(40, 40, sim.cfg.seed); p.prevPos = { ...p.pos };

    // ground mount → ineligible for the flyingOnly Vale Skytrial
    sim.summonMount('stormhoof'); // tier 5, GROUND
    for (let i = 0; i < CAST_TICKS; i++) sim.tick();
    expect(p.mountId).toBe('stormhoof');
    expect(sim.startCourse('skytrial_vale')).toBe(false);

    // unknown course id
    expect(sim.startCourse('not_a_course')).toBe(false);
  });

  it('starts on a flyer and refuses a second concurrent run', () => {
    const { sim } = makeFlyer();
    expect(sim.startCourse('skytrial_vale')).toBe(true);
    expect(sim.courseRun?.state).toBe('active');
    expect(sim.startCourse('skytrial_vale')).toBe(false); // already running
  });
});

describe('course substrate — pass-through, ordering, timing', () => {
  it('completes a full run in order and reports a server-measured tick time', () => {
    const { sim, p } = makeFlyer();
    const def = COURSES.skytrial_vale;
    expect(sim.startCourse('skytrial_vale')).toBe(true);
    expect(sim.courseRun!.startTick).toBe(-1); // armed; clock not yet running

    const finishes: Extract<SimEvent, { type: 'courseFinish' }>[] = [];
    for (const gate of def.checkpoints) {
      for (const ev of flyThroughGate(sim, p, gate)) {
        if (ev.type === 'courseFinish') finishes.push(ev);
      }
    }
    expect(finishes).toHaveLength(1);
    expect(finishes[0].courseId).toBe('skytrial_vale');
    expect(finishes[0].elapsedTicks).toBeGreaterThan(0);
    expect(finishes[0].elapsedTicks).toBe(sim.courseRun!.elapsedTicks);
    expect(sim.courseRun!.state).toBe('done');
    expect(sim.courseRun!.splits.length).toBe(courseTotalGates(def));
    // clock = last gate tick − FIRST gate tick (the start line), integer ticks
    expect(sim.courseRun!.startTick).toBe(sim.courseRun!.splits[0]);
    expect(finishes[0].elapsedTicks).toBe(
      sim.courseRun!.splits[sim.courseRun!.splits.length - 1] - sim.courseRun!.splits[0],
    );
  });

  it('enforces gate order — flying through a later gate first does not advance', () => {
    const { sim, p } = makeFlyer();
    const def = COURSES.skytrial_vale;
    sim.startCourse('skytrial_vale');
    // hit gate 3 out of order: cursor must stay at 0
    flyThroughGate(sim, p, def.checkpoints[3]);
    expect(sim.courseRun!.nextCheckpoint).toBe(0);
    // now the correct first gate advances the cursor
    flyThroughGate(sim, p, def.checkpoints[0]);
    expect(sim.courseRun!.nextCheckpoint).toBe(1);
  });

  it('detects pass-through across a long single-tick segment (no tunneling)', () => {
    const { sim, p, meta } = makeFlyer();
    sim.startCourse('skytrial_vale');
    const gate = COURSES.skytrial_vale.checkpoints[0];
    // a 40-yard segment straight through the gate; the END point is 20 yd away
    // (well outside the 4-yd radius) — a point-in-sphere test would miss it.
    p.prevPos = { x: gate.x - 20, y: gate.y, z: gate.z };
    p.pos = { x: gate.x + 20, y: gate.y, z: gate.z };
    (sim as unknown as { updateCourseRun: (a: unknown, b: unknown) => void }).updateCourseRun(p, meta);
    expect((meta as unknown as { courseRun: { nextCheckpoint: number } }).courseRun.nextCheckpoint).toBe(1);
  });
});

describe('course substrate — best-time tracking', () => {
  // Run a whole course, optionally idling `idlePerGate` ticks before each gate
  // (away from the rings) so the run takes longer — a controllable finish time.
  function runCourse(sim: Sim, p: { pos: { x: number; y: number; z: number } }, courseId: string, idlePerGate: number) {
    sim.startCourse(courseId);
    const def = COURSES[courseId];
    for (let lap = 0; lap < def.laps; lap++) {
      for (const gate of def.checkpoints) {
        for (let i = 0; i < idlePerGate; i++) { p.pos.x = -120; p.pos.y = 40; p.pos.z = -120; sim.tick(); }
        flyThroughGate(sim, p, gate);
      }
    }
  }

  it('keeps the best (lowest) time — a faster run wins, a slower one is ignored', () => {
    const { sim, p } = makeFlyer();
    runCourse(sim, p, 'skytrial_vale', 3);
    const first = sim.mountTrialBests['skytrial_vale'];
    expect(first).toBeGreaterThan(0);

    runCourse(sim, p, 'skytrial_vale', 6); // slower
    expect(sim.mountTrialBests['skytrial_vale']).toBe(first);

    runCourse(sim, p, 'skytrial_vale', 0); // faster
    expect(sim.mountTrialBests['skytrial_vale']).toBeLessThan(first);
  });

  it('seeds the session bests from join-loaded records', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: true });
    const pid = sim.addPlayer('mage', 'Veteran', { mountTrialBests: { skytrial_vale: 412 } });
    const meta = (sim as unknown as { players: Map<number, { mountTrialBests: Record<string, number> }> }).players.get(pid)!;
    expect(meta.mountTrialBests.skytrial_vale).toBe(412);
  });
});

describe('course substrate — failure paths', () => {
  it('fails the run when the rider loses flight mid-course', () => {
    const { sim, p } = makeFlyer();
    sim.startCourse('skytrial_vale');
    flyThroughGate(sim, p, COURSES.skytrial_vale.checkpoints[0]);
    expect(sim.courseRun!.nextCheckpoint).toBe(1);
    sim.dismissMount(); // lost the flyer
    const evs = sim.tick();
    expect(evs.some((e) => e.type === 'courseFail' && e.reason === 'dismounted')).toBe(true);
    expect(sim.courseRun).toBeNull();
  });

  it('aborts on demand', () => {
    const { sim } = makeFlyer();
    sim.startCourse('skytrial_vale');
    sim.abortCourse();
    expect(sim.courseRun).toBeNull();
  });
});
