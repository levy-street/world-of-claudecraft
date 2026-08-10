import { describe, expect, it } from 'vitest';
import {
  addThunderCharges,
  armPrimalMastery,
  clearThundercallState,
  consumeThunderVent,
  PRIMAL_MASTERY_ID,
  PRIMAL_MASTERY_INSTANT_ID,
  thunderCharges,
  thundercallDamageMultiplier,
  thundercallOnArcBoltImpact,
} from '../src/sim/combat/shaman_thundercall';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function setup(spec: 'elemental' | 'enhancement' = 'elemental'): { sim: Sim; shaman: Entity } {
  const sim = new Sim({ seed: 2811, playerClass: 'shaman', noPlayer: true });
  const pid = sim.addPlayer('shaman', 'Engine');
  sim.setPlayerLevel(20, pid);
  expect(sim.setSpec(spec, pid)).toBe(true);
  const shaman = sim.entities.get(pid);
  if (!shaman) throw new Error('missing shaman');
  return { sim, shaman };
}

describe('Thundercall engine', () => {
  it('caps the authoritative bank and scales each vent independently', () => {
    const { sim, shaman } = setup();
    addThunderCharges(sim.ctx, shaman, 4);
    expect(thundercallDamageMultiplier(sim.ctx, shaman, 'earth_shock')).toBe(1);
    expect(thundercallDamageMultiplier(sim.ctx, shaman, 'earthquake')).toBe(1);
    expect(consumeThunderVent(sim.ctx, shaman, 'earth_shock')).toBe(0);
    expect(thunderCharges(shaman)).toBe(4);

    addThunderCharges(sim.ctx, shaman, 9);
    expect(thunderCharges(shaman)).toBe(5);
    expect(thundercallDamageMultiplier(sim.ctx, shaman, 'earth_shock')).toBe(2.25);
    expect(thundercallDamageMultiplier(sim.ctx, shaman, 'earthquake')).toBe(2);
    expect(consumeThunderVent(sim.ctx, shaman, 'earth_shock')).toBe(5);
    expect(thunderCharges(shaman)).toBe(0);
  });

  it('accelerates only valid impact grants during Primal Mastery', () => {
    const { sim, shaman } = setup();
    armPrimalMastery(sim.ctx, shaman);
    expect(shaman.auras.find((aura) => aura.id === PRIMAL_MASTERY_ID)?.duration).toBe(12);
    expect(
      shaman.auras.find((aura) => aura.id === PRIMAL_MASTERY_INSTANT_ID)?.empowerAbilities,
    ).toEqual(['lightning_bolt', 'chain_lightning']);
    thundercallOnArcBoltImpact(sim.ctx, shaman);
    expect(thunderCharges(shaman)).toBe(2);
  });

  it('does not grant or vent another spec and clears all owned state', () => {
    const other = setup('enhancement');
    addThunderCharges(other.sim.ctx, other.shaman, 3);
    expect(thunderCharges(other.shaman)).toBe(0);

    const { sim, shaman } = setup();
    armPrimalMastery(sim.ctx, shaman);
    addThunderCharges(sim.ctx, shaman, 3);
    clearThundercallState(sim.ctx, shaman);
    expect(thunderCharges(shaman)).toBe(0);
    expect(shaman.auras.some((aura) => aura.id.startsWith('elemental_mastery'))).toBe(false);
  });
});
