import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { TREASURE_SITES } from '../src/sim/content/treasure_maps';
import { ROADS, zoneAt } from '../src/sim/data';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { findHoardEntrancePosition } from '../src/sim/treasure_vault_placement';
import { groundHeight, roadDistance, terrainSteepness, waterLevelAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const ground = (x: number, z: number) => ({ x, y: groundHeight(x, z, WORLD_SEED), z });
const water = (x: number, z: number) => waterLevelAt(x, z, WORLD_SEED);

function expectWalkable(x: number, z: number, label: string): void {
  expect(ground(x, z).y, label).toBeGreaterThan(water(x, z) + 1);
  expect(terrainSteepness(x, z, WORLD_SEED), label).toBeLessThanOrEqual(PLAYER_MAX_CLIMB_SLOPE);
  expect(isBlocked(WORLD_SEED, x, z, PLAYER_BODY_RADIUS), label).toBe(false);
}

function nearestRoad(x: number, z: number) {
  let nearest = { x: 0, z: 0, distance: Infinity };
  for (const road of ROADS) {
    for (let i = 1; i < road.length; i++) {
      const a = road[i - 1],
        b = road[i];
      const dx = b.x - a.x,
        dz = b.z - a.z;
      const lengthSq = dx * dx + dz * dz;
      if (lengthSq === 0) continue;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSq));
      const point = { x: a.x + dx * t, z: a.z + dz * t };
      const distance = Math.hypot(x - point.x, z - point.z);
      if (distance < nearest.distance) nearest = { ...point, distance };
    }
  }
  return nearest;
}

describe('new treasure sites on the shipped map', () => {
  for (const site of TREASURE_SITES.slice(8)) {
    it(`${site.id} has a dry, unobstructed approach and usable hatch`, () => {
      expect(zoneAt(site.x, site.z).id).toBe(site.zoneId);
      expect(roadDistance(site.x, site.z)).toBeGreaterThan(8);
      const road = nearestRoad(site.x, site.z);
      expect(road.distance).toBeLessThan(25);
      for (let step = 0; step <= 50; step++) {
        expectWalkable(
          site.x + ((road.x - site.x) * step) / 50,
          site.z + ((road.z - site.z) * step) / 50,
          `${site.id}: approach ${step}`,
        );
      }
      for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const hatch = findHoardEntrancePosition(site, facing, ground, water);
        expect(hatch, site.id).not.toBeNull();
        if (!hatch) throw new Error('missing hatch');
        for (let dx = -3; dx <= 3; dx++) {
          for (let dz = -3; dz <= 3; dz++) {
            if (dx * dx + dz * dz > 9) continue;
            expectWalkable(hatch.x + dx, hatch.z + dz, `${site.id}: hatch ${facing}`);
          }
        }
        for (let step = 0; step <= 30; step++) {
          expectWalkable(
            site.x + ((hatch.x - site.x) * step) / 30,
            site.z + ((hatch.z - site.z) * step) / 30,
            `${site.id}: dig ${facing}`,
          );
        }
      }
    });
  }
});
