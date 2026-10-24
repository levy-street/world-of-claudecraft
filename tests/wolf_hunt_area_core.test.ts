import { describe, expect, it } from 'vitest';
import { wolfHuntArea } from '../src/render/wolf_hunt_area_core';
import { loadPublishedMap } from '../src/sim/maps/eastbrook_and_mirefen_changes.generated';

describe('the authored wolf hunt area', () => {
  it('encloses every split wolf camp in the combined map', () => {
    const camps = loadPublishedMap().camps.filter((camp) => camp.mobId === 'forest_wolf');
    expect(camps).toHaveLength(10);
    const area = wolfHuntArea(camps);
    expect(area).not.toBeNull();
    if (!area) throw new Error('missing wolf hunt area');
    for (const camp of camps) {
      expect(
        Math.hypot(camp.center.x - area.x, camp.center.z - area.z) + camp.radius,
      ).toBeLessThanOrEqual(area.radius);
    }
  });

  it('keeps a single camp circle and excludes empty camps and other mobs', () => {
    expect(
      wolfHuntArea([
        { mobId: 'forest_wolf', center: { x: 60, z: 70 }, radius: 10, count: 8 },
        { mobId: 'forest_wolf', center: { x: 600, z: 700 }, radius: 10, count: 0 },
        { mobId: 'boar', center: { x: 600, z: 700 }, radius: 10, count: 8 },
      ]),
    ).toEqual({ x: 60, z: 70, radius: 10 });
  });

  it('has no hunt area when the map has no wolf camps', () => {
    expect(wolfHuntArea([])).toBeNull();
  });
});
