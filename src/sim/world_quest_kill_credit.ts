// The combat death path supplies authoritative kill recipients. Reconcile plain
// hunt entry here because projectiles and earlier party members can kill before
// a recipient's area-update tick. Never run encounter updates from this hook.

import { killParticipationPos } from './loot/kill_participation';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { Entity, WorldQuestDef, WorldQuestProgress } from './types';
import { positionInWorldQuestArea } from './world_quest_area';
import { investigationKillCounts } from './world_quest_investigation';
import { playerActiveWorldQuests } from './world_quest_reroll';

export function creditWorldQuestKills(
  ctx: SimContext,
  mob: Entity,
  meta: PlayerMeta,
  credit: (quest: WorldQuestDef, progress: WorldQuestProgress) => void,
): void {
  const player = ctx.entities.get(meta.entityId);
  // World hunts are overworld objectives; released members participate from
  // their corpse, just as they do in the shared kill-recipient selection.
  const position = killParticipationPos(player, null);
  if (!player || !position || meta.leaving) return;
  // Bounded by the authored rotation catalog, not the realm's mob/player books.
  for (const quest of playerActiveWorldQuests(meta)) {
    if (
      (quest.objective.type !== 'kill' && quest.objective.type !== 'investigation') ||
      player.level < quest.minLevel ||
      mob.templateId !== quest.objective.targetMobId ||
      !positionInWorldQuestArea(position, quest) ||
      !positionInWorldQuestArea(mob.pos, quest)
    )
      continue;
    // Investigation remains personal and requires its existing evidence state.
    if (
      quest.objective.type === 'investigation' &&
      (player.dead || !investigationKillCounts(meta, mob))
    )
      continue;
    let progress = meta.worldQuestLog.get(quest.id);
    if (!progress) {
      if (player.dead || quest.objective.type !== 'kill') continue;
      progress = { questId: quest.id, count: 0, state: 'active' };
      meta.worldQuestLog.set(quest.id, progress);
      meta.worldQuestAreas.add(quest.id);
      meta.wireRev++;
      ctx.emit({ type: 'worldQuestStarted', questId: quest.id, pid: meta.entityId });
    }
    if (progress.state === 'active') credit(quest, progress);
  }
}
