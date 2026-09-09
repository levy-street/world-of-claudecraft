import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { updateFarmFeasts } from '../src/sim/professions/feast';
import { descendRift, riftInstanceAtPos, updateRiftInstances } from '../src/sim/rift/runs';
import { Sim } from '../src/sim/sim';
import { EMPTY_TEST_WORLD } from './sim_shared';

const FEAST_ITEMS = Object.values(ITEMS).filter((item) => 'feast' in item && item.feast);

function enterRun() {
  const sim = new Sim({
    seed: 99117,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const pid = sim.addPlayer('warrior', 'Hostess');
  sim.setPlayerLevel(20, pid);
  sim.enterRift(4242, 20, pid);
  const player = sim.entities.get(pid);
  if (!player) throw new Error('Player entry failed');
  const run = riftInstanceAtPos(sim.ctx, player.pos);
  expect(run).not.toBeNull();
  if (!run) throw new Error('Rift entry failed');
  return { sim, pid, run };
}

function place(sim: Sim, pid: number, itemId: string): number {
  sim.addItem(itemId, 1, pid);
  const from = sim.events.length;
  sim.useItem(itemId, pid);
  const events = sim.events.slice(from).filter((event) => event.type === 'farmFeastPlaced');
  expect(events).toHaveLength(1);
  return events[0].feastId;
}

function sweepRift(sim: Sim): void {
  sim.tickCount += (20 - (sim.tickCount % 20)) % 20;
  updateRiftInstances(sim.ctx);
}

describe('feasts follow the rift floor lifecycle', () => {
  it.each(FEAST_ITEMS)(
    '$id is removed on descent and releases its owner slot',
    ({ id: itemId }) => {
      const { sim, pid, run } = enterRun();
      expect(run.floorCount).toBeGreaterThan(1);
      const feastId = place(sim, pid, itemId);
      for (const id of run.mobIds) {
        const mob = sim.entities.get(id);
        if (!mob) throw new Error('Rift mob missing');
        mob.hp = 0;
        mob.dead = true;
      }
      run.litPylons = new Set(run.pylonIds);
      run.puzzleSolved = true;
      sweepRift(sim);
      expect(run.descentOpen).toBe(true);
      descendRift(sim.ctx, pid);
      expect(run.floorIndex).toBe(1);
      expect(sim.entities.has(feastId)).toBe(false);
      updateFarmFeasts(sim.ctx);
      expect(sim.feasts.has(feastId)).toBe(false);
      expect(sim.feasts.has(place(sim, pid, itemId))).toBe(true);
    },
  );

  it.each(FEAST_ITEMS)('$id is removed when the empty run is reclaimed', ({ id: itemId }) => {
    const { sim, pid, run } = enterRun();
    const feastId = place(sim, pid, itemId);
    sim.leaveRift(pid);
    // Advance the empty-run clock without expiring the feast itself.
    run.emptyFor = 180;
    sweepRift(sim);
    expect(run.partyKey).toBeNull();
    expect(sim.entities.has(feastId)).toBe(false);
    updateFarmFeasts(sim.ctx);
    expect(sim.feasts.has(feastId)).toBe(false);
    expect(sim.feasts.has(place(sim, pid, itemId))).toBe(true);
  });
});
