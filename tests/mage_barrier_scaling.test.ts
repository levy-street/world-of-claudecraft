import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

function castBarrier(
  level: number,
  spec: 'fire' | 'frost',
  abilityId: 'blazing_barrier' | 'ice_barrier',
  spellPower?: number,
): { absorb: number; cost: number; maxHp: number; spellPower: number } {
  const sim = new Sim({ seed: 707, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(level);
  expect(sim.setSpec(spec)).toBe(true);
  if (spellPower !== undefined) sim.player.spellPower = spellPower;
  sim.player.resource = sim.player.maxResource;
  const manaBefore = sim.player.resource;

  sim.castAbility(abilityId);

  const barrier = sim.player.auras.find((aura) => aura.id === abilityId);
  expect(barrier?.kind).toBe('absorb');
  return {
    absorb: barrier?.value ?? 0,
    cost: manaBefore - sim.player.resource,
    maxHp: sim.player.maxHp,
    spellPower: sim.player.spellPower,
  };
}

function castTemporalBarrier(
  level: number,
  spellPower: number,
): { absorb: number; cost: number; spellPower: number } {
  const sim = new Sim({ seed: 708, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(level);
  expect(sim.setSpec('arcane')).toBe(true);
  sim.player.resource = sim.player.maxResource;
  const manaBefore = sim.player.resource;
  const allyId = sim.addPlayer('warrior', 'Barrier Target');
  const ally = sim.entities.get(allyId);
  if (!ally) throw new Error('missing barrier target');
  sim.targetEntity(allyId);
  sim.player.spellPower = spellPower;

  sim.castAbility('temporal_barrier');

  const barrier = ally.auras.find((aura) => aura.id === 'temporal_barrier');
  expect(barrier?.kind).toBe('absorb');
  return {
    absorb: barrier?.value ?? 0,
    cost: manaBefore - sim.player.resource,
    spellPower: sim.player.spellPower,
  };
}

describe('mage personal barrier rank scaling', () => {
  it.each([
    ['frost', 'ice_barrier'],
    ['fire', 'blazing_barrier'],
  ] as const)('%s uses an early-game barrier instead of the level-20 absorb value', (spec, id) => {
    const level7 = castBarrier(7, spec, id);
    const expected = 50 + Math.round(level7.spellPower * 0.5);

    expect(level7.absorb).toBe(expected);
    expect(level7.cost).toBe(45);
    expect(level7.absorb / level7.maxHp).toBeLessThan(0.5);
  });

  it.each([
    ['frost', 'ice_barrier'],
    ['fire', 'blazing_barrier'],
  ] as const)('%s adds 50% Spell Power to every barrier rank', (spec, id) => {
    expect(castBarrier(5, spec, id, 0)).toMatchObject({ absorb: 50, cost: 45 });
    expect(castBarrier(11, spec, id, 123)).toMatchObject({ absorb: 112, cost: 45 });
    expect(castBarrier(12, spec, id, 0)).toMatchObject({ absorb: 90, cost: 65 });
    expect(castBarrier(17, spec, id, 123)).toMatchObject({ absorb: 152, cost: 65 });
    expect(castBarrier(18, spec, id, 0)).toMatchObject({ absorb: 130, cost: 90 });
    expect(castBarrier(20, spec, id, 123)).toMatchObject({ absorb: 192, cost: 90 });
  });

  it('adds 25% Spell Power to every Temporal Barrier rank', () => {
    for (const [level, cost] of [
      [5, 50],
      [12, 75],
      [18, 105],
    ] as const) {
      const baseline = castTemporalBarrier(level, 0);
      const scaled = castTemporalBarrier(level, 123);
      expect(scaled.spellPower).toBe(123);
      expect(scaled.absorb - baseline.absorb).toBe(Math.round(scaled.spellPower * 0.25));
      expect(scaled.cost).toBe(cost);
    }
  });
});
