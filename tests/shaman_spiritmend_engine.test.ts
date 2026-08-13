import { describe, expect, it } from 'vitest';
import {
  clearSpiritmendState,
  consumeMendingCurrent,
  depositMendingCurrent,
  LIFESPRING_WEAPON_ID,
  mendingCurrent,
  tickMendingCurrent,
} from '../src/sim/combat/shaman_spiritmend';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function setup(): { sim: Sim; healer: Entity; ally: Entity; other: Entity } {
  const sim = new Sim({ seed: 2831, playerClass: 'shaman', noPlayer: true });
  const healerId = sim.addPlayer('shaman', 'Engine');
  const allyId = sim.addPlayer('warrior', 'Ally');
  const otherId = sim.addPlayer('shaman', 'Other');
  for (const pid of [healerId, allyId, otherId]) sim.setPlayerLevel(20, pid);
  expect(sim.setSpec('restoration', healerId)).toBe(true);
  expect(sim.setSpec('restoration', otherId)).toBe(true);
  const healer = sim.entities.get(healerId);
  const ally = sim.entities.get(allyId);
  const other = sim.entities.get(otherId);
  if (!healer || !ally || !other) throw new Error('missing party member');
  ally.hp = Math.round(ally.maxHp * 0.25);
  sim.drainEvents();
  return { sim, healer, ally, other };
}

describe('Spiritmend engine', () => {
  it('adds, refreshes, and caps one owner-scoped current', () => {
    const { sim, healer, ally } = setup();
    depositMendingCurrent(sim.ctx, healer, ally, ally.maxHp, 'healing_wave');
    const first = mendingCurrent(ally, healer.id);
    expect(first?.value).toBe(Math.round(ally.maxHp * 0.3));
    expect(first?.duration).toBe(12);
    depositMendingCurrent(sim.ctx, healer, ally, 100, 'healing_wave');
    expect(ally.auras.filter((aura) => aura.sourceId === healer.id)).toHaveLength(1);
    expect(first?.remaining).toBe(12);
  });

  it('draws each tick from the same remaining pool', () => {
    const { sim, healer, ally } = setup();
    depositMendingCurrent(sim.ctx, healer, ally, 600, 'tidecall');
    const current = mendingCurrent(ally, healer.id);
    if (!current) throw new Error('missing current');
    const before = current.value;
    current.remaining = 9;
    expect(tickMendingCurrent(sim.ctx, ally, current)).toBe(true);
    expect(current.value).toBeLessThan(before);
    expect(ally.hp).toBeGreaterThan(Math.round(ally.maxHp * 0.25));
  });

  it('consumes only the casting healer current and preserves another owner', () => {
    const { sim, healer, ally, other } = setup();
    depositMendingCurrent(sim.ctx, healer, ally, 200, 'tidecall');
    depositMendingCurrent(sim.ctx, other, ally, 180, 'tidecall');
    const otherAmount = mendingCurrent(ally, other.id)?.value;
    expect(consumeMendingCurrent(sim.ctx, healer, ally)).toBe(250);
    expect(mendingCurrent(ally, healer.id)).toBeNull();
    expect(mendingCurrent(ally, other.id)?.value).toBe(otherAmount);
  });

  it('strengthens deposits with Lifespring and cleans remote pools on exit', () => {
    const baseline = setup();
    const normal = depositMendingCurrent(
      baseline.sim.ctx,
      baseline.healer,
      baseline.ally,
      100,
      'healing_wave',
    );

    const enhanced = setup();
    enhanced.healer.auras.push({
      id: LIFESPRING_WEAPON_ID,
      name: 'Lifespring Weapon',
      kind: 'imbue',
      value: 0,
      remaining: 300,
      duration: 300,
      sourceId: enhanced.healer.id,
      school: 'nature',
    });
    const boosted = depositMendingCurrent(
      enhanced.sim.ctx,
      enhanced.healer,
      enhanced.ally,
      100,
      'healing_wave',
    );
    expect(boosted).toBeGreaterThan(normal);
    clearSpiritmendState(enhanced.sim.ctx, enhanced.healer);
    expect(mendingCurrent(enhanced.ally, enhanced.healer.id)).toBeNull();
  });
});
