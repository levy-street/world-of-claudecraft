// The Shardpike brace refuses a body another movement mode owns. The release/v0.44.0
// merge brought new exclusive modes (vehicles, the ferry deck, the glider run) that
// return BEFORE the brace step in player_movement_modes.ts advanceExclusiveMovement, so
// a brace opened inside one would never tick: lanceBrace must refuse it up front.
import { describe, expect, it } from 'vitest';
import { GLIDER_QUEST_ID } from '../src/sim/content/world_quest_glider';
import { Sim } from '../src/sim/sim';
import type { VehicleSession, WorldQuestProgress } from '../src/sim/types';

function armed() {
  const sim = new Sim({ seed: 73, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  sim.player.onGround = true;
  sim.addItem('skerrits_shardpike', 1, sim.playerId);
  sim.equipItem('skerrits_shardpike');
  const meta = sim.players.get(sim.playerId);
  if (!meta) throw new Error('Missing player meta');
  return { sim, meta };
}

describe('Shardpike brace: exclusive movement modes', () => {
  it('braces on ordinary ground (the control arm)', () => {
    const { sim, meta } = armed();
    sim.lanceBrace();
    expect(meta.lance).toBeDefined();
  });

  it('refuses while seated in a vehicle', () => {
    const { sim, meta } = armed();
    meta.vehicle = {} as VehicleSession;
    sim.lanceBrace();
    expect(meta.lance).toBeUndefined();
  });

  it('refuses while riding a ferry deck', () => {
    const { sim, meta } = armed();
    sim.player.ferryRide = {
      route: 'eastbrook_nightbloom',
    } as unknown as typeof sim.player.ferryRide;
    sim.lanceBrace();
    expect(meta.lance).toBeUndefined();
  });

  it('refuses during the glider run', () => {
    const { sim, meta } = armed();
    const log = new Map(meta.worldQuestLog);
    log.set(GLIDER_QUEST_ID, { glider: { phase: 'flying' } } as unknown as WorldQuestProgress);
    meta.worldQuestLog = log;
    sim.lanceBrace();
    expect(meta.lance).toBeUndefined();
  });
});
