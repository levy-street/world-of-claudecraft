import type { GliderCourseDef } from '../minigames/glider_flight';
import { GLIDER_COURSE } from './world_quest_glider';

export const GLIDER_COURSE_VALLEYS: GliderCourseDef = {
  ...GLIDER_COURSE,
  id: 'galecrest_practice_valleys',
  windTunnels: [],
  minRings: 11,
  medals: { goldSeconds: 28, silverSeconds: 38, timeoutSeconds: 75 },
  // A smooth diving bank around the northern shoulder.
  rings: [
    { id: 1, x: 245, y: 60, z: 557, radius: 7, boostY: 0 },
    { id: 2, x: 270, y: 52, z: 545, radius: 7, boostY: 0 },
    { id: 3, x: 294, y: 44, z: 518, radius: 7, boostY: 0 },
    { id: 4, x: 320, y: 40, z: 492, radius: 7, boostY: 0 },
    { id: 5, x: 330, y: 36, z: 470, radius: 7, boostY: 0 },
    { id: 6, x: 390, y: 34, z: 485, radius: 7, boostY: 0 },
    { id: 7, x: 420, y: 32, z: 540, radius: 7, boostY: 0 },
    { id: 8, x: 395, y: 30, z: 605, radius: 7, boostY: 0 },
    { id: 9, x: 345, y: 28, z: 650, radius: 7, boostY: 0 },
    { id: 10, x: 285, y: 26, z: 665, radius: 7, boostY: 0 },
    { id: 11, x: 250, y: 17, z: 650, radius: 7, boostY: 0 },
  ],
};

export const GLIDER_COURSE_SWITCHBACKS: GliderCourseDef = {
  ...GLIDER_COURSE,
  id: 'galecrest_practice_switchbacks',
  windTunnels: [],
  minRings: 11,
  medals: { goldSeconds: 28, silverSeconds: 38, timeoutSeconds: 75 },
  // Alternating banks descend away from the launch before the wider ridge turns.
  rings: [
    { id: 1, x: 245, y: 60, z: 557, radius: 7, boostY: 0 },
    { id: 2, x: 279, y: 54, z: 571, radius: 7, boostY: 0 },
    { id: 3, x: 312, y: 48, z: 550, radius: 7, boostY: 0 },
    { id: 4, x: 344, y: 44, z: 572, radius: 7, boostY: 0 },
    { id: 5, x: 375, y: 40, z: 584, radius: 7, boostY: 0 },
    { id: 6, x: 395, y: 34, z: 555, radius: 7, boostY: 0 },
    { id: 7, x: 435, y: 32, z: 605, radius: 7, boostY: 0 },
    { id: 8, x: 400, y: 30, z: 650, radius: 7, boostY: 0 },
    { id: 9, x: 345, y: 28, z: 680, radius: 7, boostY: 0 },
    { id: 10, x: 285, y: 26, z: 670, radius: 7, boostY: 0 },
    { id: 11, x: 250, y: 17, z: 650, radius: 7, boostY: 0 },
  ],
};

export const GLIDER_COURSES: readonly GliderCourseDef[] = [
  GLIDER_COURSE,
  GLIDER_COURSE_VALLEYS,
  GLIDER_COURSE_SWITCHBACKS,
];
