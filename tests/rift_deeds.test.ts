// Book of Deeds coverage for the Rift procedural dungeon system
// (src/sim/rift/runs.ts). Rifts have no fixed dungeonId to key a
// dungeonClears trigger against (every rift regenerates from a seed), so
// creditRiftClearDeeds bumps the riftClears/riftSRankClears counters
// directly on run completion; this pins that bump (and the deeds it backs)
// against a real end-to-end clear, C-rank and S-rank alike.
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { RIFT_RANK_BASE_LEVEL } from '../src/sim/rift/ranks';
import { Sim } from '../src/sim/sim';
import type { WorldContent } from '../src/sim/types';

const SEED = 4242;

// Same trimmed world as rift_sim.test.ts: rift geometry lives in its own
// coordinate band, ambient overworld entities are irrelevant here.
const RIFT_DEEDS_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeSim(seed = SEED) {
  return new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: true,
    devCommands: true,
    world: RIFT_DEEDS_TEST_WORLD,
  });
}

// Keep the player alive so a dead, unreleased player never blocks the
// descend/exit walk (mirrors tickAlive in rift_sim.test.ts).
function tickAlive(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) {
    sim.player.hp = sim.player.maxHp;
    sim.tick();
  }
}

function killTrash(sim: Sim): void {
  const inst = sim.riftInstances.find((i) => i.partyKey !== null);
  if (!inst) return;
  for (const id of inst.mobIds) {
    if (id === inst.bossId) continue;
    const e = sim.entities.get(id);
    if (e) {
      e.hp = 0;
      e.dead = true;
    }
  }
}

function killAll(sim: Sim): void {
  const inst = sim.riftInstances.find((i) => i.partyKey !== null);
  if (!inst) return;
  for (const id of inst.mobIds) {
    const e = sim.entities.get(id);
    if (e) {
      e.hp = 0;
      e.dead = true;
    }
  }
}

// Enter a rift at baseLevel and fight through to the boss floor, forcing
// every gate open exactly like rift_sim.test.ts's descent tests, then kill
// the boss and let updateRiftInstances/updateDeeds settle in the same tick.
function clearRift(sim: Sim, baseLevel: number): void {
  sim.enterRift(SEED, baseLevel, sim.player.id);
  const inst = sim.riftInstances.find((i) => i.partyKey !== null)!;
  for (let guard = 0; guard < 10 && inst.floorIndex < inst.floorCount - 1; guard++) {
    killTrash(sim);
    inst.litPylons = new Set(inst.pylonIds);
    inst.puzzleSolved = true; // dedicated puzzle tests cover solving; force the gate here
    tickAlive(sim, 21);
    if (inst.descentId === null) break;
    const desc = sim.entities.get(inst.descentId)!;
    sim.player.pos = { ...desc.pos };
    sim.player.hp = sim.player.maxHp;
    sim.tick();
  }
  expect(inst.floorIndex).toBe(inst.floorCount - 1);
  killAll(sim);
  tickAlive(sim, 21);
  expect(inst.exitId).not.toBeNull(); // run actually completed
}

describe('rift deeds: dgn_rift / dgn_rift_s_rank', () => {
  it('a C-rank clear credits riftClears and grants dgn_rift, but not the S-rank deed', () => {
    const sim = makeSim();
    clearRift(sim, RIFT_RANK_BASE_LEVEL.C);
    const meta = sim.meta(sim.player.id)!;
    expect(meta.deedStats.counters.riftClears).toBe(1);
    expect(meta.deedStats.counters.riftSRankClears).toBe(0);
    expect(meta.deedsEarned.has('dgn_rift')).toBe(true);
    expect(meta.deedsEarned.has('dgn_rift_s_rank')).toBe(false);
  });

  it('an S-rank clear credits both counters and grants both deeds', () => {
    const sim = makeSim();
    clearRift(sim, RIFT_RANK_BASE_LEVEL.S);
    const meta = sim.meta(sim.player.id)!;
    expect(meta.deedStats.counters.riftClears).toBe(1);
    expect(meta.deedStats.counters.riftSRankClears).toBe(1);
    expect(meta.deedsEarned.has('dgn_rift')).toBe(true);
    expect(meta.deedsEarned.has('dgn_rift_s_rank')).toBe(true);
  });

  it('a decided run never re-credits the clear on later ticks (the inst.rewarded guard)', () => {
    // completeRiftClear is reachable from the once-a-second sweep in
    // updateRiftInstances; this pins that its own inst.rewarded early return
    // (not just the exitId filter one level up) keeps creditRiftClearDeeds a
    // single-shot call, so an already-decided run can never double-count.
    const sim = makeSim();
    clearRift(sim, RIFT_RANK_BASE_LEVEL.C);
    const meta = sim.meta(sim.player.id)!;
    expect(meta.deedStats.counters.riftClears).toBe(1);
    const firstEarnedAt = meta.deedsEarned.get('dgn_rift');
    expect(firstEarnedAt).toBeDefined();
    tickAlive(sim, 60);
    expect(meta.deedStats.counters.riftClears).toBe(1);
    expect(meta.deedsEarned.get('dgn_rift')).toBe(firstEarnedAt);
  });
});
