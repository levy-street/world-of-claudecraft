import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { spawnPointInArea } from '../src/sim/spawn_area';

describe('spawnPointInArea', () => {
  const area = { minX: -20, minZ: 10, maxX: 20, maxZ: 30 };

  it('spreads consecutive new players across distinct positions inside the area', () => {
    const points = Array.from({ length: 12 }, (_, i) => spawnPointInArea(area, i));
    expect(new Set(points.map((p) => `${p.x},${p.z}`)).size).toBe(12);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(area.minX);
      expect(point.x).toBeLessThanOrEqual(area.maxX);
      expect(point.z).toBeGreaterThanOrEqual(area.minZ);
      expect(point.z).toBeLessThanOrEqual(area.maxZ);
    }
  });

  it('is deterministic and normalizes reversed bounds', () => {
    const reversed = { minX: 20, minZ: 30, maxX: -20, maxZ: 10 };
    expect(spawnPointInArea(reversed, 7)).toEqual(spawnPointInArea(area, 7));
  });

  it('is used by the simulation for consecutive fresh players', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      world: { ...BUILTIN_WORLD, playerSpawnArea: area },
    });
    const first = sim.addPlayer('warrior', 'First');
    const second = sim.addPlayer('mage', 'Second');
    expect(sim.entities.get(first)?.pos).toMatchObject(spawnPointInArea(area, 0));
    expect(sim.entities.get(second)?.pos).toMatchObject(spawnPointInArea(area, 1));
  });
});
