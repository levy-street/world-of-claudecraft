// The Open Source dungeon's Book of Deeds credit: the clear key lands on everyone
// inside, and the shared dungeonFinalBossKills counter never moves.

import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import { updateInstances } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { SOURCE_CAVE_DUNGEON_ID } from '../src/sim/source_cave';
import type { Entity } from '../src/sim/types';

// biome-ignore lint/suspicious/noExplicitAny: tests reach ctx / private helpers.
type AnySim = Sim & any;

const CLEARED_DEED = 'hid_source_cave_cleared';
const UNBROKEN_DEED = 'hid_source_cave_unbroken';

function makeSim(seed = 1234): AnySim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true }) as AnySim;
}

function addLvl20(sim: AnySim, name: string): number {
  const pid = sim.addPlayer('warrior', name);
  sim.setPlayerLevel(20, pid);
  return pid;
}

function claimedCave(sim: AnySim) {
  return sim.instances.find(
    (i: { dungeonId: string; partyKey: string | null }) =>
      i.dungeonId === SOURCE_CAVE_DUNGEON_ID && i.partyKey !== null,
  );
}

function killAll(sim: AnySim, inst: { mobIds: number[] }): void {
  for (const id of inst.mobIds) {
    const e = sim.entities.get(id) as Entity;
    e.dead = true;
    e.hp = 0;
  }
}

// tickCount stays 0 here (0 % 20 === 0), exactly when updateInstances runs its
// once-a-second pass, so the clear resolves without a full tick.
function pass(sim: AnySim): void {
  updateInstances(sim.ctx);
}

function meta(sim: AnySim, pid: number) {
  return sim.players.get(pid);
}

function clears(sim: AnySim, pid: number): number {
  return meta(sim, pid).deedStats.dungeonClears[SOURCE_CAVE_DUNGEON_ID] ?? 0;
}

function earned(sim: AnySim, pid: number, deedId: string): boolean {
  return (meta(sim, pid).deedsEarned as Map<string, string>).has(deedId);
}

/** Clear the cave with one level-20 player inside; `breached` sets the seal latch. */
function clearedRun(breached: boolean) {
  const sim = makeSim();
  const pid = addLvl20(sim, 'Alice');
  sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
  const inst = claimedCave(sim);
  inst.sourceCaveEncounter.breached = breached;
  killAll(sim, inst);
  pass(sim);
  return { sim, pid, inst };
}

describe('the cave deed catalog points at the real dungeon', () => {
  // Both the trigger and the credit site hold the id as a literal; comparing
  // them against the runtime constant is what catches a typo in either.
  it('the clear deed triggers on the runtime dungeon id', () => {
    const trigger = DEEDS[CLEARED_DEED].trigger;
    expect(trigger.kind).toBe('dungeonClears');
    expect(trigger.kind === 'dungeonClears' && trigger.dungeonId).toBe(SOURCE_CAVE_DUNGEON_ID);
  });

  it('every cave deed is hidden, so none of them reaches the public wiki catalog', () => {
    for (const id of [CLEARED_DEED, UNBROKEN_DEED, 'hid_source_cave_arsenal']) {
      expect(DEEDS[id].hidden, id).toBe(true);
      expect(DEEDS[id].category, id).toBe('hidden');
    }
  });
});

describe('source cave clear: deed credit', () => {
  it('a clear writes the cave clear key and earns the clear deed', () => {
    const { sim, pid } = clearedRun(false);
    expect(clears(sim, pid)).toBe(1);
    // The dungeonClears trigger resolves in the evaluator, which runs at the end
    // of the tick tail rather than inside the 1 Hz instance pass.
    sim.tick();
    expect(earned(sim, pid, CLEARED_DEED)).toBe(true);
  });

  it('an unbreached clear earns the unbroken-seal deed at clear time', () => {
    const { sim, pid } = clearedRun(false);
    expect(earned(sim, pid, UNBROKEN_DEED)).toBe(true);
  });

  it('a clear after the seal was breached earns the clear but NOT the unbroken deed', () => {
    const { sim, pid } = clearedRun(true);
    expect(clears(sim, pid)).toBe(1);
    sim.tick();
    expect(earned(sim, pid, CLEARED_DEED)).toBe(true);
    expect(earned(sim, pid, UNBROKEN_DEED)).toBe(false);
  });

  it('credits everyone inside at clear time and nobody outside', () => {
    const sim = makeSim();
    const inside = addLvl20(sim, 'Alice');
    const outside = addLvl20(sim, 'Bob');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, inside);
    const inst = claimedCave(sim);
    inst.sourceCaveEncounter.breached = false;
    killAll(sim, inst);
    pass(sim);
    sim.tick();

    expect(clears(sim, inside)).toBe(1);
    expect(earned(sim, inside, CLEARED_DEED)).toBe(true);
    expect(clears(sim, outside)).toBe(0);
    expect(earned(sim, outside, CLEARED_DEED)).toBe(false);
    expect(earned(sim, outside, UNBROKEN_DEED)).toBe(false);
  });

  it('the once-only chest guard also makes the clear credit once, across repeated passes', () => {
    const { sim, pid } = clearedRun(false);
    pass(sim);
    pass(sim);
    expect(clears(sim, pid)).toBe(1);
  });

  // dgn_boss_clears_50 reads this counter: moving it would re-scope an already
  // earnable deed (docs/design/deeds.md rule 9).
  it('never bumps the pinned five-boss kill counter', () => {
    const { sim, pid } = clearedRun(false);
    sim.tick();
    expect(meta(sim, pid).deedStats.counters.dungeonFinalBossKills).toBe(0);
  });
});
