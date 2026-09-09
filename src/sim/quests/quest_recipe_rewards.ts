// Quest-taught recipes reuse the existing acquisition and text-free training
// feedback seams. Validation precedes the turn-in transaction, and teaching
// follows its successful commitment. No new persistence or randomness.

import { recipeById } from '../content/recipes';
import { acquireRecipe } from '../professions/crafting';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { QuestDef } from '../types';

export function validateQuestRecipeReward(
  ctx: SimContext,
  quest: QuestDef,
  meta: PlayerMeta,
): boolean {
  if (!quest.recipeReward) return true;
  const recipe = recipeById(quest.recipeReward);
  if (!recipe || !recipe.acquisition?.includes('quest')) {
    ctx.error(meta.entityId, 'That quest is not available.');
    return false;
  }
  const skill = meta.craftSkills[recipe.professionId] ?? 0;
  if (!Number.isFinite(skill) || skill < recipe.skillReq) {
    ctx.emit({
      type: 'trainResult',
      ok: false,
      recipeId: recipe.id,
      reason: 'train_tier_unmet',
      pid: meta.entityId,
    });
    return false;
  }
  return true;
}

export function grantQuestRecipeReward(ctx: SimContext, quest: QuestDef, meta: PlayerMeta): void {
  if (!quest.recipeReward) return;
  const result = acquireRecipe(ctx, meta.entityId, quest.recipeReward, 'quest');
  if (result.ok) {
    ctx.emit({ type: 'trainResult', ok: true, recipeId: result.recipeId, pid: meta.entityId });
  }
}
