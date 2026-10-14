// src/sim/social/map_objectives_hooks.ts: how the authored-map objective
// rehearsal is wired into the Sim. tests/map_objectives.test.ts owns the RULES
// (pickup, carry, capture, runes, bots); this file pins the three routes the
// coordinator delegates to, end to end through the real Sim surface:
//
// - the tick phase runs (and laps) on an authored map and never on the built-in
//   world, so the default world's tick, ids and rng stay the release's;
// - Sim.bgFlagAction (the client's `bg_flag` key) reaches the rehearsal on an
//   authored map and falls through to Ravenrift everywhere else;
// - the ctx player-death hook drops a carried rehearsal flag.

import { afterEach, describe, expect, it } from 'vitest';
import { customMapToWorldContent } from '../src/editor/custom_map';
import { thornhollowMap } from '../src/editor/shipped_thornhollow';
import { setActiveWorldContent } from '../src/sim/data';
import { buildDeepglassWorld } from '../src/sim/deepglass/world';
import { Sim } from '../src/sim/sim';
import { updateMapObjectivesPhase } from '../src/sim/social/map_objectives_hooks';
import { objectiveRun } from '../src/sim/social/map_objectives_run';
import type { Entity } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

const map = thornhollowMap('Thornhollow', 'obj_hooks_test', 1);
const world = customMapToWorldContent(map);

afterEach(() => {
  setActiveWorldContent(null);
});

function thornhollowSim() {
  setActiveWorldContent(world);
  const sim = new Sim({ seed: map.meta.seed, playerClass: 'warrior', noPlayer: true, world });
  const pid = sim.addPlayer('warrior', 'Maker');
  const p = sim.ctx.entities.get(pid) as Entity;
  p.level = 30;
  place(sim, p, 0, -150); // Crimson's end: this player is team 0
  sim.tick();
  return { sim, p };
}

function place(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos = sim.ctx.groundPos(x, z);
  e.prevPos = { ...e.pos };
  sim.ctx.rebucket(e);
}

describe('map objective hooks: the tick phase', () => {
  it('runs the driver and the bots, and laps, on an authored map', () => {
    const { sim } = thornhollowSim();
    expect(objectiveRun(sim.ctx)).not.toBeNull();
    // The Sim tick already ran the phase once: the bots are standing.
    expect([...sim.entities.values()].some((e) => e.objectiveBot)).toBe(true);
    const laps: string[] = [];
    updateMapObjectivesPhase(sim.ctx, (phase) => laps.push(phase));
    expect(laps).toEqual(['mapobjectives']);
  });

  it('takes the bots down once when the authored world stops carrying objectives', () => {
    const { sim } = thornhollowSim();
    expect([...sim.entities.values()].some((e) => e.objectiveBot)).toBe(true);
    // Another authored map (the Deepglass arena) with no objective record.
    setActiveWorldContent(buildDeepglassWorld());
    updateMapObjectivesPhase(sim.ctx, undefined);
    expect(objectiveRun(sim.ctx)).toBeNull();
    expect([...sim.entities.values()].some((e) => e.objectiveBot)).toBe(false);
    expect([...sim.entities.values()].some((e) => e.templateId === 'bg_flag')).toBe(false);
  });

  it('never runs, laps or allocates on the built-in world', () => {
    setActiveWorldContent(null);
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
    const nextId = sim.ctx.nextId;
    const laps: string[] = [];
    updateMapObjectivesPhase(sim.ctx, (phase) => laps.push(phase));
    expect(laps).toEqual([]);
    expect(sim.ctx.nextId).toBe(nextId);
    expect([...sim.entities.values()].some((e) => e.objectiveBot)).toBe(false);
  });
});

describe('map objective hooks: the flag key', () => {
  it('routes Sim.bgFlagAction to the rehearsal on an authored map', () => {
    const { sim, p } = thornhollowSim();
    const run = objectiveRun(sim.ctx);
    if (!run) throw new Error('no run');
    place(sim, p, 0, 167); // beside the Azure flag
    sim.bgFlagAction(p.id);
    expect(run.pendingPress.has(p.id)).toBe(true);
    sim.tick();
    expect(run.flags[1].state).toBe('carried');
    expect(run.flags[1].carrier).toBe(p.id);
  });

  it('falls through to Ravenrift on the built-in world without building a run', () => {
    setActiveWorldContent(null);
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Visitor');
    const nextId = sim.ctx.nextId;
    sim.bgFlagAction(pid);
    expect(objectiveRun(sim.ctx)).toBeNull();
    expect(sim.ctx.nextId).toBe(nextId);
    expect([...sim.entities.values()].some((e) => e.templateId === 'bg_flag')).toBe(false);
  });
});

describe('map objective hooks: the death arm', () => {
  it('drops a carried flag where the carrier fell through the ctx death hook', () => {
    const { sim, p } = thornhollowSim();
    const run = objectiveRun(sim.ctx);
    if (!run) throw new Error('no run');
    place(sim, p, 0, 167);
    sim.bgFlagAction(p.id);
    sim.tick();
    expect(run.flags[1].carrier).toBe(p.id);
    place(sim, p, 0, 40);
    sim.ctx.bgOnPlayerDeath(p, null);
    expect(run.flags[1].carrier).toBeNull();
    expect(run.flags[1].state).toBe('dropped');
    expect(run.flags[1].pos.z).toBeCloseTo(40, 0);
  });
});
