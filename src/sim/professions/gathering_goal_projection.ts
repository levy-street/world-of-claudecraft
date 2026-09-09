// Per-character derived output. The gate precedes all scratch copies and material work.
import { recipeById } from '../content/recipes';
import { craftVaultDrawBlockedFor, craftVaultStockFor } from '../materials_vault';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { craftDailyLimitReached, isRecipeKnown, meetsComboRequirement } from './crafting';
import type { SavedGatheringGoal } from './gathering_goal_persist';
import type {
  GatheringGoalIdentity,
  GatheringGoalUnavailableReason,
  GatheringGoalView,
} from './gathering_goal_types';
import { projectMaterialGoalReagents } from './material_goal_projection';

export const GATHERING_GOAL_REFRESH_TICKS = 5;
interface CachedGoal {
  readonly goal: SavedGatheringGoal;
  readonly signature: string;
  readonly value: GatheringGoalView;
  nextCheckTick: number;
}
const cache = new WeakMap<PlayerMeta, CachedGoal>();
const NO_MATERIALS = Object.freeze([]);

function unavailable(
  goal: GatheringGoalIdentity | null,
  reason: GatheringGoalUnavailableReason,
): GatheringGoalView {
  return Object.freeze({
    goal,
    status: 'unavailable',
    reason,
    materials: NO_MATERIALS,
    payableCrafts: 0,
    storageRestricted: false,
  });
}

function commissionState(meta: PlayerMeta): GatheringGoalView | null {
  const goal = meta.gatheringGoal;
  if (!goal || goal.kind !== 'commission') return null;
  const order = meta.gatheringGoalOrder;
  if (
    !order ||
    order.id !== goal.orderId ||
    order.recipeId !== goal.recipeId ||
    order.acceptedBy !== meta.entityId
  ) {
    return unavailable(goal, 'commission_unavailable');
  }
  if (order.status === 'delivered' || order.status === 'cancelled' || order.status === 'expired') {
    return Object.freeze({
      goal,
      status: order.status,
      reason: null,
      materials: NO_MATERIALS,
      payableCrafts: 0,
      storageRestricted: false,
    });
  }
  return order.status === 'accepted' ? null : unavailable(goal, 'commission_unavailable');
}

export function forgetGatheringGoalProjection(meta: PlayerMeta): void {
  cache.delete(meta);
}

/** Reads the exact bound commission only; unrelated board churn does not cause material work. */
export function gatheringGoalFor(ctx: SimContext, pid: number): GatheringGoalView | null {
  const meta = ctx.players.get(pid);
  const goal = meta?.gatheringGoal;
  if (!meta || !goal) {
    if (meta) cache.delete(meta);
    return null;
  }
  const previous = cache.get(meta);
  const stopped =
    goal.kind === 'invalid' ? unavailable(null, 'invalid_goal') : commissionState(meta);
  if (stopped) {
    const signature = 'stopped:' + stopped.status + ':' + stopped.reason;
    if (previous?.goal === goal && previous.signature === signature) return previous.value;
    cache.set(meta, {
      goal,
      signature,
      value: stopped,
      nextCheckTick: ctx.tickCount + GATHERING_GOAL_REFRESH_TICKS,
    });
    return stopped;
  }
  if (goal.kind === 'invalid') return unavailable(null, 'invalid_goal');
  if (
    previous?.goal === goal &&
    !previous.signature.startsWith('stopped:') &&
    ctx.tickCount < previous.nextCheckTick
  ) {
    return previous.value;
  }
  const recipe = recipeById(goal.recipeId);
  const known = !!recipe && isRecipeKnown(meta, recipe);
  const blocked = craftVaultDrawBlockedFor(ctx, pid);
  const daily = !!recipe && craftDailyLimitReached(ctx, meta, recipe);
  const signature = JSON.stringify([
    meta.wireRev,
    meta.bankWireRev,
    meta.vaultWireRev,
    blocked,
    meta.name,
    meta.craftSkills,
    meta.archetype.activeArchetype,
    meta.archetype.pairedMajor,
    meta.archetype.hobbyCraft,
    meta.archetype.isJackOfAllTrades,
    known,
    ctx.resetDay,
    daily,
  ]);
  if (previous?.goal === goal && previous.signature === signature) {
    previous.nextCheckTick = ctx.tickCount + GATHERING_GOAL_REFRESH_TICKS;
    return previous.value;
  }

  let value: GatheringGoalView;
  if (!recipe) {
    value = unavailable(goal, 'unknown_recipe');
  } else if (
    !known ||
    !meetsComboRequirement(
      meta.craftSkills,
      recipe,
      meta.archetype.activeArchetype,
      meta.archetype.pairedMajor,
      meta.archetype.hobbyCraft,
    )
  ) {
    value = unavailable(goal, 'recipe_unavailable');
  } else if (daily) {
    value = unavailable(goal, 'daily_limit');
  } else if ((recipe.oncePerDay || recipe.consumeOnCraft) && goal.count !== 1) {
    value = unavailable(goal, 'batch_limit');
  } else {
    const projection = projectMaterialGoalReagents({
      recipe,
      quantity: goal.count,
      crafterName: meta.name,
      craftSkills: meta.craftSkills,
      jackAttuned: !!meta.archetype.isJackOfAllTrades,
      carriedInventory: meta.inventory,
      bankInventory: meta.bank.inventory,
      vault: meta.vault,
      drawableVaultStock: blocked ? null : craftVaultStockFor(ctx, pid),
    });
    value = projection.ok
      ? Object.freeze({
          goal,
          status: projection.allMaterialsReady ? 'ready' : 'collecting',
          reason: null,
          materials: Object.freeze(
            projection.rows.map((row) =>
              Object.freeze({
                itemId: row.itemId,
                required: row.requiredCount,
                carried: row.carriedCount,
                stored: row.storedCount,
                reachable: row.reachableCount,
                missing: row.missingCount,
                inaccessible: row.inaccessibleCount,
              }),
            ),
          ),
          payableCrafts: projection.payableCraftCount,
          storageRestricted: blocked,
        })
      : unavailable(goal, 'invalid_goal');
  }
  cache.set(meta, {
    goal,
    signature,
    value,
    nextCheckTick: ctx.tickCount + GATHERING_GOAL_REFRESH_TICKS,
  });
  return value;
}
