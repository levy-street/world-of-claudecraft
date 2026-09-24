// The Onrush (Charge) opening cue: the authored Warrior rush kit is started by a
// selfCast spellfx the sim emits on the hostile rush path (effect_dispatch.ts,
// charge effect). It is a presentation handshake only: no rng, emitted once per
// cast, and never for a friendly rush (Intervene), which is pure repositioning.
import { afterEach, expect, it, vi } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const sim = new Sim({
    seed: 11,
    playerClass: 'warrior',
    autoEquip: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(20);
  const p = sim.player;
  const target = createMob(100_002, MOBS.forest_wolf, p.level, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 15,
  });
  target.hp = target.maxHp = 1_000_000;
  target.hostile = true;
  sim.ctx.addEntity(target);
  sim.targetEntity(target.id, p.id);
  p.facing = 0;
  p.resource = 0;
  p.gcdRemaining = 0;
  sim.drainEvents();
  return { sim, p, target };
}

function rushCues(events: SimEvent[]) {
  return events.filter(
    (e): e is Extract<SimEvent, { type: 'spellfx' }> =>
      e.type === 'spellfx' && e.fx === 'selfCast' && e.ability === 'charge',
  );
}

it('emits exactly one Onrush opening cue for a hostile rush, before the rage is minted', () => {
  const { sim, p, target } = fixture();
  const rolls = vi.spyOn(sim.ctx.rng, 'next');
  sim.castAbility('charge');
  const events = sim.drainEvents();
  expect(rushCues(events)).toEqual([
    expect.objectContaining({ sourceId: p.id, targetId: target.id, school: 'physical' }),
  ]);
  expect(p.resource).toBeGreaterThan(0);
  expect(rolls).not.toHaveBeenCalled();
  // The cue does not repeat on later ticks of the same rush.
  const later: SimEvent[] = [];
  for (let tick = 0; tick < 10; tick++) later.push(...sim.tick());
  expect(rushCues(later)).toEqual([]);
});

it('emits no opening cue and no rage for a friendly rush', () => {
  const { sim, p } = fixture();
  vi.spyOn(sim.ctx, 'isFriendlyTo').mockReturnValue(true);
  sim.castAbility('charge');
  const events = sim.drainEvents();
  expect(rushCues(events)).toEqual([]);
  expect(p.resource).toBe(0);
});
