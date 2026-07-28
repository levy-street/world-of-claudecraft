import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_CATCH_UP_TICKS, planTickDebt } from '../server/tick_debt';

const STEP = 1 / 20;

describe('planTickDebt', () => {
  it('preserves normal fixed 20 Hz execution', () => {
    expect(planTickDebt(0, STEP, STEP)).toEqual({
      ticks: 1,
      debtAfterSeconds: 0,
      droppedSeconds: 0,
      capped: false,
    });

    const partial = planTickDebt(0.01, 0.02, STEP);
    expect(partial.ticks).toBe(0);
    expect(partial.debtAfterSeconds).toBeCloseTo(0.03);
    expect(partial.droppedSeconds).toBe(0);
  });

  it('runs only the cap after a two second stall', () => {
    const plan = planTickDebt(0, 2, STEP);
    expect(plan.ticks).toBe(DEFAULT_MAX_CATCH_UP_TICKS);
    expect(plan.capped).toBe(true);
    expect(plan.debtAfterSeconds).toBeCloseTo(0);
    expect(plan.droppedSeconds).toBeCloseTo(1.8);
  });

  it('retains a sub-tick remainder while dropping excess whole ticks', () => {
    const plan = planTickDebt(0.017, 0.5, STEP);
    expect(plan.ticks).toBe(DEFAULT_MAX_CATCH_UP_TICKS);
    expect(plan.debtAfterSeconds).toBeCloseTo(0.017);
    expect(plan.droppedSeconds).toBeCloseTo(0.3);
  });

  it('cannot grow debt across repeated overload callbacks', () => {
    let debt = 0;
    let dropped = 0;
    for (let i = 0; i < 30; i++) {
      const plan = planTickDebt(debt, 0.5, STEP);
      expect(plan.ticks).toBe(DEFAULT_MAX_CATCH_UP_TICKS);
      expect(plan.debtAfterSeconds).toBeLessThan(STEP);
      debt = plan.debtAfterSeconds;
      dropped += plan.droppedSeconds;
    }
    expect(debt).toBeLessThan(STEP);
    expect(dropped).toBeGreaterThan(8);
  });

  it('provides debt that can be stored before any scheduled tick executes', () => {
    const plan = planTickDebt(0.03, 0.12, STEP);
    let storedDebt = plan.debtAfterSeconds;
    expect(plan.ticks).toBe(3);

    // Simulate the first tick throwing. The caller has already stored the plan,
    // so no scheduled whole tick remains banked for the next callback.
    const afterThrow = planTickDebt(storedDebt, 0, STEP);
    storedDebt = afterThrow.debtAfterSeconds;
    expect(afterThrow.ticks).toBe(0);
    expect(storedDebt).toBeLessThan(STEP);
  });

  it('rejects invalid planning configuration', () => {
    expect(() => planTickDebt(0, 0, 0)).toThrow(RangeError);
    expect(() => planTickDebt(0, 0, STEP, 0)).toThrow(RangeError);
    expect(() => planTickDebt(0, 0, STEP, 1.5)).toThrow(RangeError);
  });
});
