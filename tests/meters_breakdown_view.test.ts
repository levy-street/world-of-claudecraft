import { describe, expect, it } from 'vitest';
import {
  BREAKDOWN_GROUP_ROW_CAP,
  BREAKDOWN_ROW_CAP,
  type BreakdownEntry,
  breakdownKey,
  buildGroupedMeterBreakdown,
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

// A pet's output folds into its owner's BAR (the damage-meter convention), which
// left a hunter unable to answer "how much of that was the pet": the flat model
// interleaves both by amount and can fold the pet's abilities into `Other` while
// the owner's fill the panel. The grouped model gives each contributor a
// subtotal with its own abilities under it.
describe('grouped hover breakdown (per-contributor subtotals)', () => {
  it('splits the member and each pet into their own group with a subtotal', () => {
    const model = buildGroupedMeterBreakdown(
      [
        entry('Aimed Shot', 3000),
        entry('Ashbolt', 1800, 'Emberkin'),
        entry('Arcane Shot', 600),
        entry('Firebolt', 400, 'Emberkin'),
      ],
      10,
    );
    expect(model.total).toBe(5800);
    expect(model.groups.map((g) => [g.petName, g.amount])).toEqual([
      [null, 3600],
      ['Emberkin', 2200],
    ]);
    // the two subtotals account for the whole total
    expect(model.groups.reduce((s, g) => s + g.amount, 0)).toBe(model.total);
    expect(model.groups.map((g) => g.share)).toEqual([3600 / 5800, 2200 / 5800]);
    // each contributor's own abilities sit under it, never interleaved
    expect(model.groups[0].rows.map((r) => r.ability)).toEqual(['Aimed Shot', 'Arcane Shot']);
    expect(model.groups[1].rows.map((r) => r.ability)).toEqual(['Ashbolt', 'Firebolt']);
  });

  it('omits a contributor with nothing instead of rendering a zero group', () => {
    // a just-summoned or idle pet must not add a dead row
    const model = buildGroupedMeterBreakdown(
      [entry('Aimed Shot', 300), entry('Claw', 0, 'Emberkin')],
      10,
    );
    expect(model.groups.map((g) => g.petName)).toEqual([null]);
  });

  it('ranks a pet that out-damages its owner first', () => {
    const model = buildGroupedMeterBreakdown(
      [entry('Aimed Shot', 100), entry('Ashbolt', 900, 'Emberkin')],
      10,
    );
    expect(model.groups.map((g) => g.petName)).toEqual(['Emberkin', null]);
    expect(model.groups.map((g) => g.fill)).toEqual([1, 100 / 900]);
  });

  it('keeps the member ahead of a pet on an exact tie', () => {
    const model = buildGroupedMeterBreakdown(
      [entry('Aimed Shot', 500), entry('Ashbolt', 500, 'Emberkin')],
      10,
    );
    expect(model.groups.map((g) => g.petName)).toEqual([null, 'Emberkin']);
  });

  it('caps PER GROUP so a pet can never be squeezed out by its owner', () => {
    const owner = Array.from({ length: 20 }, (_, i) => entry(`Skill${i}`, 500 - i));
    const model = buildGroupedMeterBreakdown([...owner, entry('Ashbolt', 1, 'Emberkin')], 10);
    // the owner's tail folds inside the OWNER's group...
    expect(model.groups[0].rows).toHaveLength(BREAKDOWN_GROUP_ROW_CAP);
    expect(model.groups[0].rows.at(-1)?.folded).toBeGreaterThan(0);
    // ...and the pet still has its own group with its ability intact
    expect(model.groups[1].petName).toBe('Emberkin');
    expect(model.groups[1].rows.map((r) => r.ability)).toEqual(['Ashbolt']);
  });

  it('measures every row against the whole total so pet and owner rows compare', () => {
    const model = buildGroupedMeterBreakdown(
      [entry('Aimed Shot', 750), entry('Ashbolt', 250, 'Emberkin')],
      10,
    );
    // 250 of a 1000 total reads 25%, not 100% of its own one-row group
    expect(model.groups[1].rows[0].share).toBe(0.25);
    expect(model.groups[0].rows[0].share).toBe(0.75);
  });

  it('handles an all-zero segment without dividing by zero', () => {
    const model = buildGroupedMeterBreakdown([entry('Aimed Shot', 0)], 10);
    expect(model.total).toBe(0);
    expect(model.groups).toEqual([]);
  });
});
