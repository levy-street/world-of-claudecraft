import { shadowPickpocketTarget } from '../sim/world_quest_shadow_target';

export { shadowPickpocketTarget } from '../sim/world_quest_shadow_target';

import { SHADOW_QUEST_ID } from '../sim/content/world_quest_shadow';
import type { IWorld } from '../world_api';

export type ShadowControlWorld = Pick<
  IWorld,
  'player' | 'entities' | 'worldQuestLog' | 'shadowWorldQuestAction'
>;
export function shadowControlsActive(world: Pick<IWorld, 'worldQuestLog'>): boolean {
  const progress = world.worldQuestLog.get(SHADOW_QUEST_ID);
  return progress?.state === 'active' && progress.shadow?.phase === 'cloaked';
}
export function shadowChooseSlot(world: ShadowControlWorld, slot: number): void {
  if (world.player.dead || !shadowControlsActive(world)) return;
  if (slot === 1) {
    world.shadowWorldQuestAction('leave');
    return;
  }
  const shadow = world.worldQuestLog.get(SHADOW_QUEST_ID)?.shadow;
  if (slot !== 0 || !shadow || shadow.cooldown > 0 || shadow.suspicion > 0 || shadow.stealing)
    return;
  const targetId = shadowPickpocketTarget(world);
  if (targetId !== undefined) world.shadowWorldQuestAction('pickpocket', targetId);
}
