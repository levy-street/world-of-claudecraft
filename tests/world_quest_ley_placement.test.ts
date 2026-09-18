import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { GLIDER_LAUNCH_SITE } from '../src/sim/content/world_quest_glider';
import { WORLD_QUEST_OBJECTS, WORLD_QUESTS_BY_ID } from '../src/sim/content/world_quests';
import { CAMPS, zoneAt } from '../src/sim/data';
import { MAX_AGGRO_RADIUS, MAX_WANDER_RADIUS } from '../src/sim/mob/aggro_ranges';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { INTERACT_RANGE } from '../src/sim/types';
import {
  roadDistance,
  terrainHeight,
  terrainSteepness,
  waterLevel,
  waterLevelAt,
} from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const ley = WORLD_QUESTS_BY_ID.wq_galecrest_wisps;
const cache = WORLD_QUEST_OBJECTS.find((object) => object.itemId === 'leyline_cache')!.positions[0];

function expectWalkable(x: number, z: number): void {
  expect(terrainHeight(x, z, WORLD_SEED)).toBeGreaterThanOrEqual(
    Math.max(waterLevel(), waterLevelAt(x, z, WORLD_SEED)) + 1,
  );
  expect(terrainSteepness(x, z, WORLD_SEED)).toBeLessThanOrEqual(PLAYER_MAX_CLIMB_SLOPE);
  expect(isBlocked(WORLD_SEED, x, z, PLAYER_BODY_RADIUS), `${x},${z}`).toBe(false);
}

describe('Ley Alignment placement beside the Old Beacon road', () => {
  it('moves both the activator and map area away from the old site', () => {
    expect(cache).toEqual({ x: 482, z: 306 });
    expect(ley.area).toEqual({ ...cache, radius: 18 });
    expect(zoneAt(cache.x, cache.z).id).toBe('galecrest');
    expect(Math.hypot(cache.x - 420, cache.z - 330)).toBeGreaterThan(45);
    expect(GLIDER_LAUNCH_SITE).toMatchObject({ x: 450, z: 520 });
    expect(
      Math.hypot(cache.x - GLIDER_LAUNCH_SITE.x, cache.z - GLIDER_LAUNCH_SITE.z),
    ).toBeGreaterThan(200);
  });

  it('keeps the full interaction footprint dry, walkable, and free of colliders', () => {
    expectWalkable(cache.x, cache.z);
    for (let radius = 0.5; radius <= INTERACT_RANGE; radius += 0.5) {
      for (let spoke = 0; spoke < 24; spoke++) {
        const angle = (spoke / 24) * Math.PI * 2;
        expectWalkable(cache.x + Math.cos(angle) * radius, cache.z + Math.sin(angle) * radius);
      }
    }
  });

  it('stays off the road with a clear walking approach from it', () => {
    expect(roadDistance(cache.x, cache.z)).toBeGreaterThan(INTERACT_RANGE);
    expect(roadDistance(484, 316)).toBeLessThan(2);
    for (let step = 0; step <= 20; step++) {
      expectWalkable(cache.x + (2 * step) / 20, cache.z + (10 * step) / 20);
    }
  });

  it('keeps nearby camp aggro outside the interaction footprint', () => {
    for (const camp of CAMPS) {
      expect(
        Math.hypot(cache.x - camp.center.x, cache.z - camp.center.z) - camp.radius,
      ).toBeGreaterThan(MAX_AGGRO_RADIUS + MAX_WANDER_RADIUS + INTERACT_RANGE);
    }
  });
});
