import { describe, expect, it } from 'vitest';
import { MAX_LOADOUTS, rowForLevel } from '../src/sim/content/talents';
import { repairTalentLoadouts } from '../src/sim/talent_loadouts';

describe('Talent V2 persisted loadout repair', () => {
  it('repairs every allocation, bounds bars and loadout count, and remaps the active index', () => {
    const validOption = rowForLevel('warrior', 5)!.options[0].id;
    const raw = [
      null,
      {
        name: 'x'.repeat(30),
        alloc: { spec: 'arms', rows: { 5: validOption, 8: 'bogus' } },
        bar: [...Array(30).keys()].map((index) => (index === 0 ? 'charge' : index)),
      },
      ...Array.from({ length: MAX_LOADOUTS }, (_, index) => ({
        name: `L${index}`,
        alloc: { spec: 'bogus', rows: { 5: 'bogus' } },
        bar: [],
      })),
    ];

    const repaired = repairTalentLoadouts('warrior', 20, raw, 1);

    expect(repaired.loadouts).toHaveLength(MAX_LOADOUTS - 1);
    expect(repaired.activeLoadout).toBe(0);
    expect(repaired.loadouts[0]).toEqual({
      name: 'x'.repeat(24),
      alloc: { spec: 'arms', rows: { 5: validOption } },
      bar: ['charge', ...Array(21).fill(null)],
    });
    expect(repaired.loadouts[1].alloc).toEqual({ spec: null, rows: {} });
  });

  it('drops point-tree allocations to a free row repick while preserving a valid spec', () => {
    const repaired = repairTalentLoadouts(
      'warrior',
      20,
      [{ name: 'Legacy', alloc: { spec: 'arms', ranks: { old: 5 }, choices: {} }, bar: [] }],
      0,
    );

    expect(repaired).toEqual({
      loadouts: [{ name: 'Legacy', alloc: { spec: 'arms', rows: {} }, bar: [] }],
      activeLoadout: 0,
    });
  });

  it('clears an invalid or missing active index deterministically', () => {
    const raw = [{ name: 'A', alloc: { spec: null, rows: {} }, bar: [] }];
    expect(repairTalentLoadouts('warrior', 20, raw, Number.MAX_SAFE_INTEGER).activeLoadout).toBe(
      -1,
    );
    expect(repairTalentLoadouts('warrior', 20, raw, 1.5).activeLoadout).toBe(-1);
  });
});
