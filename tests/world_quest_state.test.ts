import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { takeWorldQuestDeliveryCargo } from '../src/sim/world_quest_delivery';
import { freshWorldQuestRotationCache, rotationBindings } from '../src/sim/world_quest_state';

describe('world quest coordinator adapters', () => {
  it('keeps the reset-day view live while reusing the same-day rotation', () => {
    const cache = freshWorldQuestRotationCache();
    const host = { resetDay: '2026-09-06' };
    const bound = rotationBindings(cache, host);
    const initial = bound.currentWorldQuestRotation();
    expect(bound.currentWorldQuestRotation()).toBe(initial);
    host.resetDay = '2026-09-07';
    expect(bound.currentWorldQuestRotation()).not.toBe(initial);
    expect(bound.currentWorldQuestRotation().cycle).not.toBe(initial.cycle);
  });

  it('drops only the requested player cargo and ignores missing players', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const other = sim.addPlayer('mage', 'Other');
    takeWorldQuestDeliveryCargo(sim.ctx, sim.player);
    expect(sim.dropWorldQuestDeliveryCargo(987654)).toBe(false);
    expect(sim.dropWorldQuestDeliveryCargo(other)).toBe(false);
    expect(sim.dropWorldQuestDeliveryCargo()).toBe(true);
    expect(sim.dropWorldQuestDeliveryCargo()).toBe(false);
  });
});
