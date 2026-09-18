import { GLIDER_COURSE } from './content/world_quest_glider';
import { GLIDER_COURSES } from './content/world_quest_glider_levels';
import type { GliderCourseDef } from './minigames/glider_flight';

/** Session identity shared by authority, owner decoding and course visuals. */
export function gliderCourseById(courseId?: string): GliderCourseDef {
  return GLIDER_COURSES.find((course) => course.id === courseId) ?? GLIDER_COURSE;
}
