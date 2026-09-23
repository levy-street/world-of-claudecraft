import type {
  GliderCourseDef,
  GliderLandingPadDef,
  GliderRingDef,
  GliderWindTunnelDef,
} from '../minigames/glider_flight';
import type { NpcDef, WorldQuestDef } from '../types';

export const GLIDER_QUEST_ID = 'wq_galecrest_slalom';
export const GLIDER_COURSE_ID = 'galecrest_windrider_slalom';

export const GLIDER_NPC_ID = 2_146_900_030;
export const GLIDER_APPRENTICE_NPC_ID = 2_146_900_031;

export const GLIDER_LAUNCH_SITE = {
  x: 450,
  z: 520,
  playerLaunch: { x: 448, y: 74, z: 525 },
  playerFacing: -0.235,
};

export const GLIDER_NPC_DEF: NpcDef = {
  id: 'glider_instructor',
  name: 'Flightmaster Zephyr',
  title: 'Windrider Instructor',
  pos: { x: GLIDER_LAUNCH_SITE.x, z: GLIDER_LAUNCH_SITE.z },
  facing: -0.235,
  color: 0x4aa3df,
  questIds: [],
  dynamic: true,
  greeting:
    'The thermals howling off the cliffs of The Shear are fierce today. Ready to strap into the mechanical glider and test your wings through the slalom course?',
};

export const GLIDER_APPRENTICE_NPC_DEF: NpcDef = {
  id: 'glider_apprentice',
  name: 'Skye',
  title: 'Zephyrs Apprentice',
  pos: { x: 248, z: 663 },
  facing: -1.33,
  color: 0x5dbcd2,
  questIds: [],
  dynamic: true,
  greeting:
    'Great flight down the canyon. Speak with me whenever you need a magical updraft back to Zephyr at The Shear.',
};

// Coastal circuit: broad opening turns tighten into the final ridge slalom.
export const GLIDER_COURSE_RINGS: readonly GliderRingDef[] = [
  { id: 1, x: 444, y: 74, z: 552, radius: 8, boostY: 0 },
  { id: 2, x: 450, y: 74, z: 620, radius: 8, boostY: 0 },
  { id: 3, x: 495, y: 73, z: 673, radius: 8, boostY: 0 },
  { id: 4, x: 526, y: 72, z: 613, radius: 7, boostY: 0 },
  { id: 5, x: 520, y: 71, z: 530, radius: 7, boostY: 0 },
  { id: 6, x: 499, y: 70, z: 446, radius: 7, boostY: 0 },
  { id: 7, x: 520, y: 69, z: 365, radius: 6, boostY: 0 },
  { id: 8, x: 499, y: 68, z: 300, radius: 6, boostY: 0 },
  { id: 9, x: 520, y: 66, z: 228, radius: 6, boostY: 0 },
  { id: 10, x: 470, y: 63, z: 191, radius: 6, boostY: 0 },
  { id: 11, x: 400, y: 60, z: 207, radius: 5, boostY: 0 },
  { id: 12, x: 340, y: 57, z: 252, radius: 5, boostY: 0 },
  { id: 13, x: 301, y: 53, z: 312, radius: 5, boostY: 0 },
  { id: 14, x: 256, y: 49, z: 367, radius: 5, boostY: 0 },
  { id: 15, x: 221, y: 45, z: 428, radius: 4.5, boostY: 0 },
  { id: 16, x: 223, y: 41, z: 488, radius: 4.5, boostY: 0 },
  { id: 17, x: 258, y: 37, z: 536, radius: 4.5, boostY: 0 },
  { id: 18, x: 225, y: 34, z: 580, radius: 4.5, boostY: 0 },
  { id: 19, x: 211, y: 28, z: 620, radius: 4, boostY: 0 },
  { id: 20, x: 232, y: 17, z: 649, radius: 4, boostY: 0 },
];

export const GLIDER_MEDAL_TARGETS = { goldSeconds: 52, silverSeconds: 68, timeoutSeconds: 110 };

// Horizontal wind lanes between rings, aligned with the direction of travel.
export const GLIDER_WIND_TUNNELS: readonly GliderWindTunnelDef[] = [
  {
    id: 'opening',
    x: 447,
    y: 74,
    z: 586,
    yaw: Math.atan2(6, 68),
    radius: 7,
    length: 22,
    speedBoost: 8,
  },
  {
    id: 'northbound',
    x: 509.5,
    y: 70.5,
    z: 488,
    yaw: Math.atan2(-21, -84),
    radius: 6,
    length: 24,
    speedBoost: 8,
  },
  {
    id: 'ridge',
    x: 435,
    y: 61.5,
    z: 199,
    yaw: Math.atan2(-70, 16),
    radius: 5,
    length: 22,
    speedBoost: 7,
  },
  {
    id: 'homeward',
    x: 222,
    y: 43,
    z: 458,
    yaw: Math.atan2(2, 60),
    radius: 4.5,
    length: 20,
    speedBoost: 7,
  },
];

export const GLIDER_LANDING_PAD: GliderLandingPadDef = {
  x: 248,
  y: 1.36,
  z: 656,
  radius: 6,
};

export const GLIDER_COURSE: GliderCourseDef = {
  id: GLIDER_COURSE_ID,
  rings: GLIDER_COURSE_RINGS,
  landingPad: GLIDER_LANDING_PAD,
  minRings: 18,
  medals: GLIDER_MEDAL_TARGETS,
  windTunnels: GLIDER_WIND_TUNNELS,
};

export const WORLD_QUEST_GLIDER: WorldQuestDef = {
  id: GLIDER_QUEST_ID,
  zoneId: 'galecrest',
  minLevel: 20,
  area: { x: 370, z: 440, radius: 330 },
  objective: {
    type: 'glider',
    instructorNpcId: GLIDER_NPC_DEF.id,
    courseId: GLIDER_COURSE_ID,
  },
  count: 1,
  reward: { type: 'copper', base: 3_000, perLevel: 200 },
};
