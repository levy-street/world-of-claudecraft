import { describe, expect, it } from 'vitest';
import {
  consumeThornsCharge,
  type ThornsState,
  thornsDepleted,
  thornsHasCharge,
  tickThornsCooldown,
} from '../src/sim/combat/thorns_charge';
import { CAST_COMPLETE_EPS, DT } from '../src/sim/types';

describe('thorns_charge', () => {
  it('treats an undefined charge count as unlimited and ungated (legacy thorns)', () => {
    const a: ThornsState = {};
    for (let i = 0; i < 100; i++) {
      expect(consumeThornsCharge(a)).toBe(true);
    }
    expect(thornsHasCharge(a)).toBe(true);
    expect(thornsDepleted(a)).toBe(false);
  });

  it('consumes one charge per trigger and depletes after the configured count', () => {
    const a: ThornsState = { charges: 3 };
    expect(consumeThornsCharge(a)).toBe(true); // charge 3 -> 2
    expect(consumeThornsCharge(a)).toBe(true); // 2 -> 1
    expect(consumeThornsCharge(a)).toBe(true); // 1 -> 0
    expect(thornsDepleted(a)).toBe(true);
    expect(consumeThornsCharge(a)).toBe(false); // no charges left
    expect(a.charges).toBe(0);
  });

  it('arms an internal cooldown that blocks the next trigger until it elapses', () => {
    const a: ThornsState = { charges: 3, icdMax: 5 };
    expect(consumeThornsCharge(a)).toBe(true); // fires, arms 5s icd
    expect(a.icd).toBe(5);
    expect(a.charges).toBe(2);
    // a second hit during the cooldown is blocked and costs nothing
    expect(consumeThornsCharge(a)).toBe(false);
    expect(a.charges).toBe(2);
  });

  it('ticks the internal cooldown down by DT and fires again once ready', () => {
    const a: ThornsState = { charges: 3, icdMax: 5 };
    consumeThornsCharge(a);
    const ticks = Math.ceil(5 / DT); // 5 seconds of 20 Hz ticks
    for (let i = 0; i < ticks; i++) tickThornsCooldown(a);
    // float residual stays well under the readiness epsilon, so the gate is ready
    expect(a.icd).toBeLessThan(CAST_COMPLETE_EPS);
    expect(consumeThornsCharge(a)).toBe(true); // off cooldown -> fires
    expect(a.charges).toBe(1);
  });

  it('never lets the cooldown drift below zero', () => {
    const a: ThornsState = { charges: 3, icdMax: 5 };
    consumeThornsCharge(a);
    for (let i = 0; i < 1000; i++) tickThornsCooldown(a);
    expect(a.icd).toBeGreaterThanOrEqual(0);
    expect(a.icd).toBeLessThan(CAST_COMPLETE_EPS);
  });
});
