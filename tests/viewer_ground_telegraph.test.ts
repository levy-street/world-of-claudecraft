import { describe, expect, it } from 'vitest';
import { groundTelegraphWorld, viewerTelegraphJson } from '../server/ground_telegraph_wire';
import { Sim } from '../src/sim/sim';
import { EMPTY_TEST_WORLD } from './sim_shared';

describe('ground telegraphs use one viewer for position and disposition', () => {
  it('keeps the actual viewer identity and range in the snapshot adapter', () => {
    const sim = new Sim({ seed: 147, playerClass: 'mage', world: EMPTY_TEST_WORLD });
    sim.setPlayerLevel(14);
    expect(sim.setSpec('arcane')).toBe(true);
    sim.tick();
    sim.player.pos = sim.groundPos(700, 0);
    sim.player.prevPos = { ...sim.player.pos };
    sim.player.resource = sim.player.maxResource;
    sim.castAbilityAt('temporal_hourglass', { x: 712, z: 0 });
    sim.tick();
    expect(sim.activeTemporalHourglasses).toHaveLength(1);
    const world = groundTelegraphWorld(sim, 50, 90);
    const rows = (viewer: { id: number; pos: { x: number; z: number } }) =>
      JSON.parse(`{"ents":[]${viewerTelegraphJson(world, viewer, 50)}}`);
    const own = rows(sim.player);
    expect(own.hourglasses).toHaveLength(1);
    expect(own.hourglasses[0].disposition).toBe('protective');
    const opponentId = sim.addPlayer('warrior', 'Other viewer');
    expect(rows({ id: opponentId, pos: sim.player.pos }).hourglasses[0].disposition).toBe(
      sim.temporalHourglassDispositionFor(sim.playerId, opponentId),
    );
    expect(rows({ id: sim.playerId, pos: { x: 1000, z: 0 } }).hourglasses).toBeUndefined();
  });
});
