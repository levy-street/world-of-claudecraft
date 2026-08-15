// Shared world-staging helpers for the three split Vale Cup suites
// (vale_cup_match, vale_cup_bots, vale_cup_meta). Not a test file: nothing here
// runs on its own.

import { expect } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { SimConfig, SimEvent, WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Vale Cup tests need the real terrain, pitch and instance-plane geometry, but
// none of the hundreds of unrelated overworld mobs, NPCs, or objects. Full
// matches advance thousands of ticks, so stripping ambient constructor spawns
// keeps every terrain-relevant field while avoiding unrelated simulation work.
export const VALE_CUP_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  // Bram spawns from the ACTIVE world's npc registry (a custom world without
  // him must not inherit one), so the scoped world keeps his record while
  // still dropping every other npc for a cheap construction.
  npcs: { groundskeeper_bram: BUILTIN_WORLD.npcs.groundskeeper_bram },
  groundObjects: [],
};

export function makeWorld(overrides: Partial<SimConfig> = {}) {
  return new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    ...overrides,
    world: VALE_CUP_TEST_WORLD,
  });
}

export function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

export function addAt(
  sim: Sim,
  cls: Parameters<Sim['addPlayer']>[0],
  name: string,
  x = 0,
  z = -40,
) {
  const pid = sim.addPlayer(cls, name);
  teleport(sim, pid, x, z);
  return pid;
}

export function errorsOf(events: SimEvent[]): string[] {
  return events.filter((e) => e.type === 'error').map((e) => (e as any).text as string);
}

// Ready up every human fighter in the current match (bots auto-ready), so the
// briefing ends at once and the whistle countdown begins.
export function readyAll(sim: Sim) {
  const matches = [sim.vcup.match, ...sim.vcup.practices].filter((m) => m !== null);
  for (const m of matches) {
    for (const pid of [...m!.teamA, ...m!.teamB]) {
      if (!sim.vcup.botPids.includes(pid)) sim.vcupReady(pid);
    }
  }
}

// Queue a 1v1 and run it to the active phase (briefing readied, kickoff done).
export function startBout(sim: Sim, a: number, b: number) {
  sim.vcupQueueJoin(1, 'vale', 'allrounder', false, a);
  sim.vcupQueueJoin(1, 'mirefen', 'allrounder', false, b);
  sim.tick();
  expect(sim.vcup.match).toBeTruthy();
  readyAll(sim);
  for (let i = 0; i < 20 * 5 && sim.vcup.match!.phase !== 'active'; i++) sim.tick();
  expect(sim.vcup.match!.phase).toBe('active');
  return sim.vcup.match!;
}

export function tickUntil(sim: Sim, pred: () => boolean, maxTicks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < maxTicks && !pred(); i++) out.push(...sim.tick());
  return out;
}
