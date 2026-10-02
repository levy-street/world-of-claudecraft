// Where a world quest's map marker stands. An instructor activity that sends the
// player away to play (the glider's slalom, Fire and Fly's arena) pins a point on
// its instructor, with no area circle; every other quest marks its area.

import { FIRE_AND_FLY_NPC_DEF } from '../sim/content/world_quest_fire_and_fly';
import { GLIDER_NPC_DEF } from '../sim/content/world_quest_glider';
import type { WorldQuestDef } from '../sim/types';

export function worldQuestInstructorAnchor(
  quest: Pick<WorldQuestDef, 'objective'>,
): Readonly<{ x: number; z: number }> | null {
  if (quest.objective.type === 'glider') return GLIDER_NPC_DEF.pos;
  if (quest.objective.type === 'turret') return FIRE_AND_FLY_NPC_DEF.pos;
  return null;
}
