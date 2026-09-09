// The carried raid proof can finish recovery and start the one-time shaping
// without an NPC. Existing NPC quest paths remain valid for in-flight saves.
// Reuse the normal quest accept/reward cores, never mint a replacement Ember
// or re-teach a recipe whose recovery quest has already paid out.
import { CRUCIBLE_HAMMER_QUEST_IDS } from '../content/ignivar_raid_lore';
import { QUESTS } from '../data';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { finalizeQuestAccept, questState, turnInQuestCore } from './quest_commands';
import { validateQuestRecipeReward } from './quest_recipe_rewards';

export function useForgebreakerEmber(ctx: SimContext, player: Entity, meta: PlayerMeta): void {
  const recoveryId = CRUCIBLE_HAMMER_QUEST_IDS.requiem;
  const forgingId = CRUCIBLE_HAMMER_QUEST_IDS.forging;
  const recovery = QUESTS[recoveryId];
  const forging = QUESTS[forgingId];
  if (
    player.dead ||
    player.level < (recovery.minLevel ?? 0) ||
    !recovery.requiredClass?.includes(meta.cls) ||
    meta.questsDone.has(forgingId)
  ) {
    ctx.error(meta.entityId, 'That quest is not available.');
    return;
  }
  if (!validateQuestRecipeReward(ctx, recovery, meta)) return;
  if (!meta.questsDone.has(recoveryId)) {
    const state = questState(ctx, recoveryId, meta.entityId);
    if (state === 'available') finalizeQuestAccept(ctx, recoveryId, recovery, meta);
    if (meta.questLog.get(recoveryId)?.state !== 'ready') {
      ctx.error(meta.entityId, 'That quest is not complete.');
      return;
    }
    if (!turnInQuestCore(ctx, recoveryId, recovery, meta)) return;
  }
  if (questState(ctx, forgingId, meta.entityId) === 'available') {
    finalizeQuestAccept(ctx, forgingId, forging, meta);
  }
}

// Called only after successful authoritative crafting, after inventory credit.
// Ownership alone (loot, a dev grant, or another recipe) never auto-completes it.
export function completeForgebreakerCraftQuest(
  ctx: SimContext,
  recipeId: string,
  meta: PlayerMeta,
): void {
  const questId = CRUCIBLE_HAMMER_QUEST_IDS.forging;
  if (
    recipeId !== 'recipe_varkhul_forgebreaker' ||
    !meta.questsDone.has(CRUCIBLE_HAMMER_QUEST_IDS.requiem) ||
    meta.questLog.get(questId)?.state !== 'ready'
  )
    return;
  turnInQuestCore(ctx, questId, QUESTS[questId], meta);
}
