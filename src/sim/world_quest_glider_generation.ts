import type { GliderCourseDef } from './minigames/glider_flight';
import { gliderCourseById } from './world_quest_glider_levels';

/** Fixed ranked routes: daily and lifetime times must use identical geometry.
 * Keep the cycle-shaped lookup shared by authority, owner decoding and visuals. */
export function gliderCourseForCycle(_cycle: unknown, courseId?: string): GliderCourseDef {
  return gliderCourseById(courseId);
}
