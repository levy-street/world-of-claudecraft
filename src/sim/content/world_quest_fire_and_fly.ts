import type { NpcDef, WorldQuestDef } from '../types';

export const FIRE_AND_FLY_QUEST_ID = 'wq_evergarden_fire_and_fly';
export const FIRE_AND_FLY_NPC_ID = 2_146_900_050;

// At the Evergarden's south gate, beside Gatewarden Pell and clear of the gate
// watchtower, facing the road the recruits walk in on.
export const FIRE_AND_FLY_NPC_DEF: NpcDef = {
  id: 'fire_and_fly_instructor',
  name: 'Master Gunner Alder',
  title: 'Gunnery Recruiter',
  pos: { x: 405, z: 713 },
  facing: -Math.PI / 2,
  color: 0x7a6a4a,
  questIds: [],
  dynamic: true,
  greeting:
    'The ramparts need more defenders than the garrison can spare, so I am recruiting. Before I trust anyone with a cannon, I want to see them hold a tower of their own. Take a trial: blast the monsters back before they reach your walls.',
};

export const WORLD_QUEST_FIRE_AND_FLY: WorldQuestDef = {
  id: FIRE_AND_FLY_QUEST_ID,
  zoneId: 'evergarden',
  minLevel: 20,
  area: { x: FIRE_AND_FLY_NPC_DEF.pos.x, z: FIRE_AND_FLY_NPC_DEF.pos.z, radius: 40 },
  objective: { type: 'turret', instructorNpcId: FIRE_AND_FLY_NPC_DEF.id },
  count: 1,
};
