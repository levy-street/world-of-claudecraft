import { describe, expect, it } from 'vitest';
import { drainDelayedEvents } from '../src/sim/entity_roster';
import {
  LANCE_FIXED_DAMAGE,
  LANCE_REST_SECONDS,
  LANCE_THRUST_RANGE,
} from '../src/sim/lance_balance_core';
import { eyeWardBlinded } from '../src/sim/mob/eye_ward';
import { advancePendingProjectiles } from '../src/sim/projectile_travel';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { DT } from '../src/sim/types';

function setup(distance = 12) {
  const sim = new Sim({ seed: 73, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  const ctx = (sim as unknown as { ctx: SimContext }).ctx;
  const id = (
    sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
  ).spawnDevBoss('balgath_cyclops', 0, 390);
  const boss = sim.entities.get(id);
  if (!boss) throw new Error('Missing test boss');
  sim.player.pos = { x: 0, y: boss.pos.y, z: 390 - distance };
  sim.player.onGround = true;
  sim.player.weaponStowed = true;
  sim.addItem('skerrits_shardpike', 1, sim.playerId);
  sim.equipItem('skerrits_shardpike');
  sim.lanceBrace();
  const meta = sim.players.get(sim.playerId);
  if (!meta?.lance) throw new Error('Brace failed');
  meta.questLog.set('q_socketwrights_due', {
    questId: 'q_socketwrights_due',
    counts: [0],
    state: 'active',
  });
  meta.lance.phase = 'steadied';
  const step = () => {
    sim.time += DT;
    advancePendingProjectiles(ctx);
    drainDelayedEvents(ctx);
  };
  return { sim, ctx, boss, meta, step };
}
describe('real Shardpike entry and payoff', () => {
  it('preserves the approved fixed damage, rest and reach', () => {
    expect(LANCE_FIXED_DAMAGE).toBe(150);
    expect(LANCE_REST_SECONDS).toBe(5);
    // 28 (was 22, and 14 before that): the owner asked for more reach. At 28 the pikeman
    // stands clear of every area blow centred on him (Smash 12, Barrowfall 16, the cleave's
    // 20) with room to give ground, and it stays under half the 60-yard guidance range.
    expect(LANCE_THRUST_RANGE).toBe(28);
  });
  it('draws the weapon, consumes one attempt, and defers fixed damage and blind credit until contact', () => {
    const h = setup();
    expect(h.sim.player.weaponStowed).toBe(false);
    const hp = h.boss.hp;
    h.sim.lanceThrust();
    h.sim.lanceThrust(); // Duplicate command cannot create a second throw.
    expect(h.ctx.delayedEvents).toHaveLength(1);
    expect(h.meta.lance).toBeUndefined();
    expect(h.meta.lanceRestUntil).toBe(h.sim.time + LANCE_REST_SECONDS);
    expect(h.boss.hp).toBe(hp);
    expect(eyeWardBlinded(h.ctx, h.boss)).toBe(false);
    for (let i = 0; i < 8; i++) h.step();
    expect(h.boss.hp).toBe(hp);
    expect(h.meta.lanceThrusts ?? 0).toBe(0);
    expect(h.meta.questLog.get('q_socketwrights_due')?.counts).toEqual([0]);
    for (let i = 0; i < 12; i++) h.step();
    expect(h.boss.hp).toBe(hp - LANCE_FIXED_DAMAGE);
    expect(eyeWardBlinded(h.ctx, h.boss)).toBe(true);
    expect(h.meta.lanceThrusts).toBe(1);
    expect(h.meta.questLog.get('q_socketwrights_due')).toMatchObject({
      counts: [1],
      state: 'ready',
    });
    for (let i = 0; i < 20; i++) h.step();
    expect(h.boss.hp).toBe(hp - LANCE_FIXED_DAMAGE);
    expect(h.meta.lanceThrusts).toBe(1);
  });
  it('keeps the original exclusive range gate and leaves an out-of-range attempt ready', () => {
    const h = setup(LANCE_THRUST_RANGE);
    h.sim.lanceThrust();
    expect(h.ctx.delayedEvents).toHaveLength(0);
    expect(h.meta.lance?.phase).toBe('steadied');
    expect(h.meta.lanceRestUntil ?? 0).toBe(0);
  });
  it('replays the same command stream deterministically', () => {
    const run = () => {
      const h = setup();
      h.sim.lanceThrust();
      const trace = [];
      for (let i = 0; i < 25; i++) {
        h.step();
        trace.push([h.boss.hp, h.meta.lanceThrusts ?? 0, h.ctx.pendingProjectiles.length]);
      }
      return trace;
    };
    expect(run()).toEqual(run());
  });
});
