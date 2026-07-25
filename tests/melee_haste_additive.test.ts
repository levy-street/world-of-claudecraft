// v0.27.1: melee haste is ONE additive bucket, mirroring spellHasteMult (which
// was always additive). Before this, buff_haste auras multiplied against each
// other and against the meleeHaste stat bucket (item sets + Enrage), so stacked
// raid buffs compounded: Bloodlust 1.3 x Wildfang Rally 1.05 x Enrage 1.25 =
// 1.71x attack speed instead of the additive 1.6x. Single-source cases are
// unchanged by design: 1/(1 + x) === 1/mult for one aura.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { ENRAGE_HASTE_PCT } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;

function warrior(): { sim: AnySim; p: Entity } {
  const sim = new Sim({ seed: 271, playerClass: 'warrior' }) as AnySim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec('fury')).toBe(true);
  return { sim, p: sim.player };
}

function aura(sim: AnySim, p: Entity, a: object): void {
  (sim as unknown as { applyAura(t: Entity, a: object): void }).applyAura(p, a);
}

function addHaste(sim: AnySim, p: Entity, id: string, mult: number): void {
  aura(sim, p, {
    id,
    name: id,
    kind: 'buff_haste',
    value: mult,
    remaining: 300,
    duration: 300,
    sourceId: p.id,
    school: 'nature',
  });
}

describe('melee haste is one additive bucket', () => {
  it('a single haste buff is unchanged: interval divides by exactly its value', () => {
    const { sim, p } = warrior();
    const base = sim.swingIntervalMult(p);
    addHaste(sim, p, 'bloodlust', 1.3);
    expect(sim.swingIntervalMult(p)).toBeCloseTo(base / 1.3, 5);
  });

  it('stacked buffs sum instead of compounding: Bloodlust + Wildfang + Enrage = 1.6x', () => {
    const { sim, p } = warrior();
    const base = sim.swingIntervalMult(p);
    addHaste(sim, p, 'bloodlust', 1.3);
    addHaste(sim, p, 'aspect_of_the_wild', 1.05);
    aura(sim, p, {
      id: 'enrage',
      name: 'Enrage',
      kind: 'enrage',
      value: 0.07,
      remaining: 4,
      duration: 4,
      sourceId: p.id,
      school: 'physical',
    });
    const expectedHaste = 0.3 + 0.05 + ENRAGE_HASTE_PCT; // 0.6 additive
    expect(sim.swingIntervalMult(p)).toBeCloseTo(base / (1 + expectedHaste), 5);
    // The multiplicative composition this replaces would have been 1.706x.
    expect(sim.swingIntervalMult(p)).not.toBeCloseTo(
      base / (1.3 * 1.05 * (1 + ENRAGE_HASTE_PCT)),
      3,
    );
  });

  it('slows stay on their own axis and still compose with the haste bucket', () => {
    const { sim, p } = warrior();
    const base = sim.swingIntervalMult(p);
    aura(sim, p, {
      id: 'test_slow',
      name: 'Test Slow',
      kind: 'attackspeed',
      value: 1.2,
      remaining: 10,
      duration: 10,
      sourceId: p.id,
      school: 'physical',
    });
    addHaste(sim, p, 'bloodlust', 1.3);
    expect(sim.swingIntervalMult(p)).toBeCloseTo((base * 1.2) / 1.3, 5);
  });
});
