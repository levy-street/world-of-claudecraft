import { describe, expect, it, vi } from 'vitest';
import { groundTelegraphWireJson, groundTelegraphWorld } from '../server/ground_telegraph_wire';
import { decodeHunterTraps } from '../src/net/ground_telegraph_wire';
import { ABILITIES } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { bareClient } from './helpers/bare_client';

function placedTrap() {
  const sim = new Sim({ seed: 7, playerClass: 'hunter', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: 'marksmanship', rows: {} })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.castAbility('frostjaw_trap');
  sim.tick();
  return sim;
}

function snapshot(sim: Sim, anchor: { x: number; z: number } = sim.player.pos, aoeBase = 50) {
  const projection = groundTelegraphWorld(sim, 50, 90);
  return JSON.parse(
    `{"t":"snap","ents":[]${groundTelegraphWireJson(projection, anchor, aoeBase)}}`,
  );
}

describe('Hunter trap presentation state across offline and online worlds', () => {
  it('round-trips real legacy placement and retires a modern trap only after its actual trigger', () => {
    const sim = placedTrap();
    const def = ABILITIES.frost_trap;
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('Hunter metadata missing');
    sim.ctx.runEffects(sim.player, meta, null, {
      def,
      rank: 1,
      cost: def.cost,
      castTime: def.castTime,
      cooldown: def.cooldown,
      effects: def.effects,
      threatFlat: 0,
      threatMult: 1,
    });
    expect(decodeHunterTraps(snapshot(sim).hunterTraps)[0]).toMatchObject({
      abilityId: 'frost_trap',
      duration: 60,
      armTime: 1.5,
      armRemaining: 1.5,
    });
    sim.tick();
    sim.player.cooldowns.delete('frostjaw_trap');
    sim.player.gcdRemaining = 0;
    sim.castAbility('frostjaw_trap');
    sim.tick();
    const placed = sim.activeHunterTraps[0];
    const client = bareClient(sim.playerId, { playerClass: 'hunter' });
    const receiver = client as unknown as { applySnapshot(value: unknown): void };
    receiver.applySnapshot(snapshot(sim));
    expect(client.activeHunterTraps).toHaveLength(1);
    const mob = createMob(900001, MOBS.forest_wolf, 20, { ...sim.player.pos });
    mob.hostile = true;
    mob.moveSpeed = 0;
    mob.aiState = 'idle';
    mob.hp = mob.maxHp = 100000;
    (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(
      mob.auras.some((aura) => aura.id === 'frostjaw_trap_freeze' && aura.kind === 'root'),
    ).toBe(true);
    receiver.applySnapshot(snapshot(sim));
    expect(client.activeHunterTraps).toEqual([]);
    sim.player.cooldowns.delete('frostjaw_trap');
    sim.player.gcdRemaining = 0;
    sim.castAbility('frostjaw_trap');
    sim.tick();
    expect(sim.activeHunterTraps[0].id).not.toBe(placed.id);
    expect(sim.activeHunterTraps[0].armRemaining).toBeGreaterThan(0);
    expect(sim.activeHunterTraps[0].x).toBeCloseTo(placed.x);
  });
  it('carries actual placement, arming and expiry into the client and clears omitted snapshots', () => {
    const sim = placedTrap();
    const first = sim.activeHunterTraps[0];
    expect(first).toMatchObject({
      sourceId: sim.playerId,
      abilityId: 'frostjaw_trap',
      radius: 4,
      duration: 30,
      armTime: 0.75,
    });
    expect(first.armRemaining).toBeGreaterThan(0);
    const client = bareClient(sim.playerId, { playerClass: 'hunter' });
    const receiver = client as unknown as { applySnapshot(value: unknown): void };
    receiver.applySnapshot(snapshot(sim));
    expect(client.activeHunterTraps[0]).toMatchObject({ id: first.id, radius: 4, duration: 30 });
    for (let i = 0; i < 20; i++) sim.tick();
    receiver.applySnapshot(snapshot(sim));
    expect(client.activeHunterTraps[0].armRemaining).toBe(0);
    expect(client.activeHunterTraps[0].remaining).toBeLessThan(first.remaining);
    receiver.applySnapshot({ t: 'snap', ents: [] });
    expect(client.activeHunterTraps).toEqual([]);
    for (let i = 0; i < 610; i++) sim.tick();
    expect(sim.activeHunterTraps).toEqual([]);
  });

  it('uses the trap-center event horizon even with a distant unseen owner or widened battleground scope', () => {
    const sim = placedTrap();
    const trap = sim.activeHunterTraps[0];
    sim.player.pos.x += 1000;
    expect(snapshot(sim, { x: trap.x + 90, z: trap.z }, 500).hunterTraps).toHaveLength(1);
    expect(snapshot(sim, { x: trap.x + 90.01, z: trap.z }, 500).hunterTraps).toBeUndefined();
  });

  it('reads the trap collection once per broadcast and returns detached records', () => {
    const sim = placedTrap();
    const read = vi.spyOn(sim, 'activeHunterTraps', 'get');
    const projected = groundTelegraphWorld(sim, 50, 90);
    groundTelegraphWireJson(projected, sim.player.pos, 50);
    groundTelegraphWireJson(projected, sim.player.pos, 500);
    expect(read).toHaveBeenCalledTimes(1);
    projected.activeHunterTraps[0].armRemaining = 0;
    expect(sim.activeHunterTraps[0].armRemaining).toBeGreaterThan(0);
  });

  it('drops malformed wire rows and accepts legacy and modern trap identities', () => {
    const sim = placedTrap();
    const valid = snapshot(sim).hunterTraps[0];
    const invalid = [
      { id: '' },
      { sourceId: -1 },
      { sourceId: 1.2 },
      { abilityId: 'frost_nova' },
      { x: Infinity },
      { z: NaN },
      { r: 0 },
      { dur: 0 },
      { rem: 0 },
      { arm: -1 },
      { arm: 31 },
      { ar: -1 },
      { ar: 1 },
    ].map((patch) => ({ ...valid, ...patch }));
    expect(
      decodeHunterTraps([...invalid, valid, { ...valid, abilityId: 'frost_trap' }]),
    ).toHaveLength(2);
    expect(decodeHunterTraps([{ ...valid, rem: 999 }])[0].remaining).toBe(30);
    expect(decodeHunterTraps(undefined)).toEqual([]);
  });
});
