import { describe, expect, it } from 'vitest';
import { DELVES } from '../src/sim/data';
import { delveRunForPlayer } from '../src/sim/delves/runs';
import { enterDungeon, instanceAt } from '../src/sim/instances/dungeons';
import { updateFarmFeasts } from '../src/sim/professions/feast';
import { riftInstanceAtPos } from '../src/sim/rift/runs';
import { Sim } from '../src/sim/sim';
import { EMPTY_TEST_WORLD } from './sim_shared';

function enterRun() {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', world: EMPTY_TEST_WORLD });
  sim.setPlayerLevel(20);
  sim.enterRift(4242, 20);
  const run = riftInstanceAtPos(sim.ctx, sim.player.pos);
  if (!run) throw new Error('Rift entry failed');
  return { sim, run };
}

function place(sim: Sim) {
  sim.addItem('harvest_feast', 1);
  const from = sim.events.length;
  sim.placeFeast();
  const placed = sim.events.slice(from).filter((event) => event.type === 'farmFeastPlaced');
  expect(placed).toHaveLength(1);
  const id = placed[0].feastId;
  const feast = sim.feasts.get(id);
  if (!feast) throw new Error('Feast state missing');
  return { id, feast };
}

describe('retired feasts leave their room object roster', () => {
  it.each(['dungeon', 'delve'] as const)('also reclaims expired ids from a %s roster', (kind) => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', world: EMPTY_TEST_WORLD });
    if (kind === 'dungeon') enterDungeon(sim.ctx, 'hollow_crypt', sim.player.id);
    else {
      sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
      sim.enterDelve('collapsed_reliquary', 'normal');
    }
    const owner =
      kind === 'dungeon'
        ? instanceAt(sim.ctx, sim.player.pos)
        : delveRunForPlayer(sim.ctx, sim.player.id);
    if (!owner) throw new Error('Room entry failed');
    const roster = owner.objectIds;
    const original = [...roster];
    const { id, feast } = place(sim);
    expect(owner.objectIds).toEqual([...original, id]);
    sim.tickCount = feast.expiresAtTick;
    updateFarmFeasts(sim.ctx);
    expect(owner.objectIds).toBe(roster);
    expect(owner.objectIds).toEqual(original);
    expect(sim.entities.has(id)).toBe(false);
    expect(sim.feasts.has(id)).toBe(false);
  });

  it.each(['expired', 'drained', 'missing'] as const)(
    'repeated %s feasts cannot grow the rift roster scanned by the lift tick',
    (reason) => {
      const { sim, run } = enterRun();
      const roster = run.objectIds;
      const original = [...roster];
      const guests: number[] = [];
      if (reason === 'drained') {
        for (let i = 0; i < 10; i++) guests.push(sim.addPlayer('warrior', `Guest ${i}`));
      }
      for (let cycle = 0; cycle < 5; cycle++) {
        const { id, feast } = place(sim);
        expect(run.objectIds).toEqual([...original, id]);
        if (reason === 'expired') sim.tickCount = feast.expiresAtTick;
        else if (reason === 'missing') sim.ctx.dropEntity(id);
        else {
          // Spend every serving through the authoritative consume command.
          expect(guests.length).toBeGreaterThanOrEqual(feast.charges);
          for (const pid of guests) {
            const guest = sim.entities.get(pid);
            if (!guest) throw new Error('Guest missing');
            guest.pos = { ...sim.player.pos };
            guest.eating = null;
            sim.consumeFeast(id, pid);
          }
          expect(feast.charges).toBe(0);
        }
        updateFarmFeasts(sim.ctx);
        expect(sim.feasts.has(id)).toBe(false);
        expect(sim.entities.has(id)).toBe(false);
        expect(run.objectIds).toBe(roster);
        expect(run.objectIds).toEqual(original);
      }
    },
  );

  it('uses the current owner roster after a room replaces its array', () => {
    const { sim, run } = enterRun();
    const { id, feast } = place(sim);
    const original = run.objectIds.filter((objectId) => objectId !== id);
    const replacement = [...original, id];
    run.objectIds = replacement;
    feast.charges = 0;
    updateFarmFeasts(sim.ctx);
    expect(run.objectIds).toBe(replacement);
    expect(run.objectIds).toEqual(original);
  });

  it('preserves a reused room roster when its old feast is already absent', () => {
    const { sim, run } = enterRun();
    const { id } = place(sim);
    sim.ctx.dropEntity(id);
    const replacement = run.objectIds.filter((objectId) => objectId !== id);
    const expected = [...replacement];
    expect(expected.length).toBeGreaterThan(0);
    run.objectIds = replacement;
    updateFarmFeasts(sim.ctx);
    expect(run.objectIds).toBe(replacement);
    expect(run.objectIds).toEqual(expected);
    expect(sim.feasts.has(id)).toBe(false);
  });
});
