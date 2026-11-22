import { describe, expect, it } from 'vitest';
import { MEADOW_COVERAGE_FLOORS, zoneMeadowCoverage } from '../src/render/meadow_zone_density_core';
import { ZONES } from '../src/sim/data';

describe('per-zone meadow coverage floor', () => {
  const eastbrook = ZONES.find((z) => z.id === 'eastbrook_vale');
  const other = ZONES.find((z) => !(z.id in MEADOW_COVERAGE_FLOORS) && z.hub);

  it('raises a lean Eastbrook cell to the floor, never lowers a lush one', () => {
    expect(eastbrook).toBeDefined();
    const x = 20;
    const z = 40;
    expect(zoneMeadowCoverage(x, z, 0.3)).toBe(MEADOW_COVERAGE_FLOORS.eastbrook_vale);
    expect(zoneMeadowCoverage(x, z, 1.4)).toBe(1.4);
  });

  it('leaves every unlisted zone on the shipped coverage exactly', () => {
    expect(other).toBeDefined();
    const { x, z } = other!.hub!;
    for (const shipped of [0, 0.3, 0.77, 1.2]) {
      expect(zoneMeadowCoverage(x, z, shipped)).toBe(shipped);
    }
  });
});
