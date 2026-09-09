// Sparse, bounded persistence for one explicit goal. Order IDs are display identity,
// never authority to recover a live commission after deserialization.

import { CRAFT_BATCH_MAX } from '../content/professions';
import type { GatheringGoalIdentity } from './gathering_goal_types';

export type SavedGatheringGoal = GatheringGoalIdentity | { readonly kind: 'invalid' };
const INVALID_GOAL: SavedGatheringGoal = Object.freeze({ kind: 'invalid' });

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function validGatheringGoalCount(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= CRAFT_BATCH_MAX
  );
}

export function validGatheringGoalOrderId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function recipeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

/** Unknown recipes retain their identity so retirement renders unavailable.
 * Malformed selections retain an invalid state instead of silently switching goals. */
export function loadGatheringGoal(raw: unknown): SavedGatheringGoal | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!record(raw)) return INVALID_GOAL;
  if (
    raw.kind === 'recipe' &&
    exactKeys(raw, ['kind', 'recipeId', 'count']) &&
    recipeId(raw.recipeId) &&
    validGatheringGoalCount(raw.count)
  ) {
    return Object.freeze({ kind: 'recipe', recipeId: raw.recipeId, count: raw.count });
  }
  if (
    raw.kind === 'commission' &&
    exactKeys(raw, ['kind', 'recipeId', 'orderId', 'count']) &&
    recipeId(raw.recipeId) &&
    validGatheringGoalOrderId(raw.orderId) &&
    raw.count === 1
  ) {
    return Object.freeze({
      kind: 'commission',
      recipeId: raw.recipeId,
      orderId: raw.orderId,
      count: 1,
    });
  }
  return INVALID_GOAL;
}

/** Copy only the closed compact selection. Never serialize a projection or order object. */
export function saveGatheringGoal(
  goal: SavedGatheringGoal | undefined,
): SavedGatheringGoal | undefined {
  return loadGatheringGoal(goal);
}
