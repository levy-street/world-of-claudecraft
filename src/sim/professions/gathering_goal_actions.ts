// Explicit goal changes only. No inventory, preference, clock or database writes.
import { recipeById } from '../content/recipes';
import type { SimContext } from '../sim_context';
import {
  loadGatheringGoal,
  validGatheringGoalCount,
  validGatheringGoalOrderId,
} from './gathering_goal_persist';

export function trackGatheringRecipe(
  ctx: SimContext,
  recipeId: string,
  count: number,
  pid = ctx.primaryId,
): boolean {
  const meta = ctx.players.get(pid);
  if (!meta) return false;
  if (!validGatheringGoalCount(count)) {
    ctx.error(pid, 'Choose a goal quantity from 1 to 50.');
    return false;
  }
  if (typeof recipeId !== 'string' || !recipeById(recipeId)) {
    ctx.error(pid, 'That recipe is unavailable.');
    return false;
  }
  const goal = loadGatheringGoal({ kind: 'recipe', recipeId, count });
  if (!goal || goal.kind === 'invalid') return false;
  meta.gatheringGoal = goal;
  delete meta.gatheringGoalOrder;
  return true;
}

export function trackGatheringCommission(
  ctx: SimContext,
  orderId: number,
  pid = ctx.primaryId,
): boolean {
  const meta = ctx.players.get(pid);
  if (!meta) return false;
  const order = validGatheringGoalOrderId(orderId)
    ? ctx.commissionOrderBoard.find((entry) => entry.id === orderId)
    : undefined;
  if (!order || order.status !== 'accepted' || order.acceptedBy !== pid) {
    ctx.error(pid, 'That commission is no longer available.');
    return false;
  }
  const goal = loadGatheringGoal({
    kind: 'commission',
    recipeId: order.recipeId,
    orderId: order.id,
    count: 1,
  });
  if (!goal || goal.kind !== 'commission') return false;
  meta.gatheringGoal = goal;
  // This exact object is the authority. Loading a saved numeric ID never restores it.
  meta.gatheringGoalOrder = order;
  return true;
}

export function clearGatheringGoal(ctx: SimContext, pid = ctx.primaryId): void {
  const meta = ctx.players.get(pid);
  if (!meta) return;
  delete meta.gatheringGoal;
  delete meta.gatheringGoalOrder;
}
