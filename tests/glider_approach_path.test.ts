import { describe, expect, it } from 'vitest';
import { GLIDER_COURSES } from '../src/sim/content/world_quest_glider_levels';
import { GLIDER_APPROACH_PATH, GLIDER_TRAIL_DECK_Y } from '../src/sim/glider_approach_path';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { groundHeight, terrainHeight } from '../src/sim/world';
import { autopilotFlight } from '../src/sim/world_quest_glider_autopilot';
import { WORLD_SEED } from '../src/sim/world_seed';

describe('the existing mountain launch', () => {
  it.each(GLIDER_COURSES)('gives $id a connected opening section clear of the launch', (course) => {
    const opening = course.rings.slice(0, 5);
    expect(course.rings.map((ring) => ring.id)).toEqual(course.rings.map((_, i) => i + 1));
    expect(opening.filter((ring) => ring.x <= 350).length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < opening.length; i++) {
      const a = opening[i - 1];
      const b = opening[i];
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(60);
      expect(b.x).toBeGreaterThan(a.x);
      expect(b.y - b.radius - terrainHeight(b.x, b.z, WORLD_SEED)).toBeGreaterThan(3);
    }
  });

  it('removes the artificial mountain and seats the new wharf on the western mountain', () => {
    expect(terrainHeight(449, 512, WORLD_SEED)).toBeLessThan(10);
    expect(groundHeight(203, 557, WORLD_SEED)).toBeCloseTo(GLIDER_TRAIL_DECK_Y, 6);
    expect(groundHeight(221, 557, WORLD_SEED)).toBeLessThan(GLIDER_TRAIL_DECK_Y - 5);
  });

  it('keeps every step along the requested approach under the walking slope limit', () => {
    expect(GLIDER_APPROACH_PATH.map(({ x, z }) => [x, z])).toEqual([
      [228, 418],
      [241, 537],
      [222, 611],
      [183, 610],
      [191, 557],
    ]);
    for (let i = 1; i < GLIDER_APPROACH_PATH.length; i++) {
      const a = GLIDER_APPROACH_PATH[i - 1];
      const b = GLIDER_APPROACH_PATH[i];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.ceil(length / 0.5);
      const height = (t: number) =>
        groundHeight(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, WORLD_SEED);
      for (let step = 0; step < steps; step++) {
        expect(
          Math.abs(height((step + 1) / steps) - height(step / steps)) / (length / steps),
        ).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
      }
    }
  });

  it.each(GLIDER_COURSES)('can finish every ring of $id from the relocated launch', (course) => {
    const flight = autopilotFlight(course, WORLD_SEED);
    expect(flight.phase).toBe('won');
    expect(flight.passedRings).toBe(course.rings.length);
  });
});
