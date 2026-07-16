// Shared world-staging helpers for the three Vale Cup suites (vale_cup_match,
// vale_cup_bots, vale_cup_meta), moved verbatim from the original single-file
// tests/vale_cup.test.ts when it was split along describe boundaries for CI
// shard balance. Not a test file: nothing here runs on its own.

import { expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

export function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
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
