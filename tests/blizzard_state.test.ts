import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { EMPTY_TEST_WORLD } from './sim_shared';
import { bareClient } from './helpers/bare_client';
import { groundTelegraphWorld, groundTelegraphWireJson } from '../server/ground_telegraph_wire';
import { decodeBlizzards } from '../src/net/ground_telegraph_wire';
import { applyGroundTelegraphSnapshot } from '../src/net/ground_snapshot';

function placed() {
  const sim = new Sim({ seed: 147, playerClass: 'mage', world: EMPTY_TEST_WORLD });
  sim.setPlayerLevel(20);
  sim.setSpec('frost');
  sim.player.pos = sim.groundPos(700, 0);
  sim.player.prevPos = { ...sim.player.pos };
  sim.player.resource = sim.player.maxResource;
  sim.castAbility('blizzard', undefined, { x: 700, z: 0 });
  const events: SimEvent[] = [];
  for (let i = 0; i < 50 && !sim.activeBlizzards.length; i++) events.push(...sim.tick());
  expect(sim.activeBlizzards).toHaveLength(1);
  return { sim, events };
}
function wire(sim: Sim, x: number) {
  return JSON.parse(
    `{"ents":[]${groundTelegraphWireJson(groundTelegraphWorld(sim, 50, 90), { x, z: 0 }, 500, sim.playerId)}}`,
  );
}
describe('Blizzard persistent snapshot state', () => {
  it('identifies real placement, persists through source death and expires on the original clock', () => {
    const { sim, events } = placed(),
      original = sim.activeBlizzards[0];
    expect(original).toMatchObject({
      sourceId: sim.playerId,
      active: true,
      radius: 7,
      duration: 6.5,
    });
    expect(events.find((e) => e.type === 'spellfxAt' && e.fx === 'snowZone')).toMatchObject({
      sourceId: sim.playerId,
      persistentId: original.id,
    });
    sim.player.dead = true;
    sim.player.hp = 0;
    sim.tick();
    expect(sim.activeBlizzards[0]).toMatchObject({ id: original.id, active: false });
    const remaining = sim.activeBlizzards[0].remaining;
    sim.player.dead = false;
    sim.player.hp = sim.player.maxHp;
    expect(sim.activeBlizzards[0]).toMatchObject({ id: original.id, active: true, remaining });
    for (let i = 0; i < 140; i++) sim.tick();
    expect(sim.activeBlizzards).toEqual([]);
  });
  it('restores a late viewer inside the event horizon and clears stale fields outside it', () => {
    const { sim } = placed(),
      client = bareClient(sim.playerId);
    for (let i = 0; i < 20; i++) sim.tick();
    const snapshot = wire(sim, 790);
    applyGroundTelegraphSnapshot(client, snapshot);
    expect(client.activeBlizzards).toHaveLength(1);
    expect(client.activeBlizzards[0].remaining).toBeLessThan(6.5);
    expect(wire(sim, 790.01).blizzards).toBeUndefined();
    applyGroundTelegraphSnapshot(client, wire(sim, 790.01));
    expect(client.activeBlizzards).toEqual([]);
    applyGroundTelegraphSnapshot(client, snapshot);
    applyGroundTelegraphSnapshot(client, { blizzards: [{ ...snapshot.blizzards[0], r: NaN }] });
    expect(client.activeBlizzards).toEqual([]);
    expect(decodeBlizzards([{ ...snapshot.blizzards[0], sourceId: null }])[0].active).toBe(false);
  });
});
