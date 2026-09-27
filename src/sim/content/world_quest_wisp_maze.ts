import type { NpcDef, WorldQuestDef } from '../types';

export const WISP_MAZE_QUEST_ID = 'wq_evergarden_wisp_maze';
export const WISP_MAZE_NPC_ID = 2_146_800_040;
export const WISP_MAZE_SITE = { x: 450, z: 1040 } as const;
export const WISP_MAZE_NPC_DEF: NpcDef = {
  id: 'wisp_maze_keeper',
  name: 'Keeper Liora',
  title: 'Warden of the Hedge Maze',
  pos: { x: 450, z: 1067 },
  facing: Math.PI,
  color: 0x92d9bc,
  questIds: [],
  dynamic: true,
  greeting:
    'Thieves hid their stolen gold all through my maze, and the shadows guard it now. Recover every coin purse. Avoid the guardians, or take a radiant wisp to banish them. Three lost lives return you to the entrance, but the purses you gathered remain safe.',
};
export const WORLD_QUEST_WISP_MAZE: WorldQuestDef = {
  id: WISP_MAZE_QUEST_ID,
  zoneId: 'evergarden',
  minLevel: 20,
  area: { ...WISP_MAZE_SITE, radius: 40 },
  objective: { type: 'wisp_maze', instructorNpcId: WISP_MAZE_NPC_DEF.id },
  count: 1,
};
