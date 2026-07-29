import { describe, expect, it } from 'vitest';
import {
  BREAKDOWN_ROW_CAP,
  type BreakdownEntry,
  breakdownKey,
  buildMeterBreakdown,
} from '../src/ui/meters_breakdown_view';

const entry = (
  ability: string | null,
  amount: number,
  petName: string | null = null,
): BreakdownEntry => ({ ability, petName, amount });

describe('meters hover breakdown', () => {
  it('ranks abilities by amount and reports each row share of the member total', () => {
    const model = buildMeterBreakdown(
      [entry('Fireball', 300), entry(null, 100), entry('Fire Blast', 600)],
      10,
    );
    expect(model.total).toBe(1000);
    expect(model.perSecond).toBe(100);
    expect(model.rows.map((r) => r.ability)).toEqual(['Fire Blast', 'Fireball', null]);
    expect(model.rows.map((r) => r.amount)).toEqual([600, 300, 100]);
    expect(model.rows.map((r) => r.share)).toEqual([0.6, 0.3, 0.1]);
    // fill is relative to the BIGGEST row, so the top row always fills the bar
    expect(model.rows.map((r) => r.fill)).toEqual([1, 0.5, 1 / 6]);
    expect(model.rows.every((r) => r.folded === 0)).toBe(true);
  });

  it('keeps a pet ability on its own row, labeled with the pet name', () => {
    const model = buildMeterBreakdown([entry('Claw', 400, 'Broken Tooth'), entry('Claw', 100)], 10);
    expect(model.rows).toHaveLength(2);
    expect(model.rows[0]).toMatchObject({ ability: 'Claw', petName: 'Broken Tooth', amount: 400 });
    expect(model.rows[1]).toMatchObject({ ability: 'Claw', petName: null, amount: 100 });
    // the merge key is what keeps them apart upstream in MeterData
    expect(breakdownKey('Broken Tooth', 'Claw')).not.toBe(breakdownKey(null, 'Claw'));
  });

  it('drops zero rows and never divides a sub-second segment into a nonsense rate', () => {
    const model = buildMeterBreakdown([entry('Fireball', 50), entry('Frostbolt', 0)], 0.1);
    expect(model.rows.map((r) => r.ability)).toEqual(['Fireball']);
    // duration floors at 1s, matching MeterData, so this reads 50/s and not 500/s
    expect(model.perSecond).toBe(50);
  });

  it('folds everything past the row cap into one trailing row carrying its count', () => {
    const many = Array.from({ length: BREAKDOWN_ROW_CAP + 4 }, (_, i) =>
      entry(`Ability ${i}`, 100 - i),
    );
    const model = buildMeterBreakdown(many, 10);
    expect(model.rows).toHaveLength(BREAKDOWN_ROW_CAP);
    const last = model.rows[BREAKDOWN_ROW_CAP - 1];
    // 12 entries, 7 shown individually, the remaining 5 fold
    expect(last.folded).toBe(5);
    expect(last.ability).toBeNull();
    expect(last.amount).toBe(many.slice(BREAKDOWN_ROW_CAP - 1).reduce((s, e) => s + e.amount, 0));
    // the folded row still counts toward the total, so the shares sum to 1
    expect(model.rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 10);
    expect(model.total).toBe(many.reduce((s, e) => s + e.amount, 0));
  });

  it('orders equal amounts deterministically instead of letting them swap per render', () => {
    const a = buildMeterBreakdown([entry('Shoot', 100), entry('Claw', 100, 'Pet')], 10);
    const b = buildMeterBreakdown([entry('Claw', 100, 'Pet'), entry('Shoot', 100)], 10);
    expect(a.rows.map((r) => [r.petName, r.ability])).toEqual(
      b.rows.map((r) => [r.petName, r.ability]),
    );
    // the member's own row (no pet name) sorts ahead of the pet's on a tie
    expect(a.rows[0].petName).toBeNull();
  });

  it('returns an empty model rather than NaN shares when nothing was recorded', () => {
    const model = buildMeterBreakdown([], 10);
    expect(model).toEqual({ total: 0, perSecond: 0, rows: [] });
  });
});
