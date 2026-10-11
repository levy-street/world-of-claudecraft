import { describe, expect, it } from 'vitest';
import { GLIDER_COURSE } from '../src/sim/content/world_quest_glider';
import { GLIDER_COURSES } from '../src/sim/content/world_quest_glider_levels';
import { groundHeight } from '../src/sim/world';
import { gliderCourseForCycle } from '../src/sim/world_quest_glider_generation';
import { WORLD_SEED } from '../src/sim/world_seed';

describe('fixed ranked glider routes', () => {
  it('uses the identical route across daily rotations so lifetime records remain comparable', () => {
    for (const course of GLIDER_COURSES) {
      for (const cycle of ['wq1_0', 'wq1_5', 'wq3_42', undefined]) {
        expect(gliderCourseForCycle(cycle, course.id)).toBe(course);
      }
    }
    expect(gliderCourseForCycle('wq1_0')).toBe(GLIDER_COURSE);
    expect(gliderCourseForCycle('wq1_0', 'unknown')).toBe(GLIDER_COURSE);
  });
  it('keeps every ring clear of the ground', () => {
    for (const course of GLIDER_COURSES) {
      for (const ring of course.rings) {
        expect(
          ring.y - ring.radius - groundHeight(ring.x, ring.z, WORLD_SEED),
          `${course.id} ring ${ring.id}`,
        ).toBeGreaterThan(2);
      }
    }
  });
});
