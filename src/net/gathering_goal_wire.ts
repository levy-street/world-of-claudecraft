// Strict client decode for the `ggoal` self-delta (Intentional Gathering PR4:
// docs/prd/intentional-gathering/goal-projection-contract.md). Kept as its own
// DOM-free, ClientWorld-free module, the harvest_preference_wire.ts /
// snapshot_timer_wire.ts idiom: unit-testable without a socket, online.ts stays
// a consumer.
//
// Wire semantics: `ggoal` is delta-omitted (a missing key preserves the prior
// mirror); a PRESENT key is either an explicit `null` (clears the goal) or the
// COMPLETE GatheringGoalView (a full replacement, never a partial patch). Every
// field is re-validated here, including the identity/status/reason/material
// invariants gathering_goal_projection.ts actually produces (never a superset
// a forged frame could exploit); a malformed or version-skewed frame decodes
// to `null` (refused) rather than a best-effort partial projection. Only the
// known GatheringGoalView fields are ever copied into the result: an
// unrecognized wire property is silently dropped for forward compatibility,
// never retained or replaced with a placeholder.

import { loadGatheringGoal } from '../sim/professions/gathering_goal_persist';
import type {
  GatheringGoalIdentity,
  GatheringGoalMaterial,
  GatheringGoalUnavailableReason,
  GatheringGoalView,
} from '../sim/professions/gathering_goal_types';

const STATUSES = new Set<GatheringGoalView['status']>([
  'collecting',
  'ready',
  'unavailable',
  'delivered',
  'cancelled',
  'expired',
]);

const TERMINAL_STATUSES = new Set<GatheringGoalView['status']>([
  'delivered',
  'cancelled',
  'expired',
]);

const REASONS = new Set<GatheringGoalUnavailableReason>([
  'invalid_goal',
  'unknown_recipe',
  'recipe_unavailable',
  'commission_unavailable',
  'daily_limit',
  'batch_limit',
]);

// The canonical printable id shape, byte-identical to gathering_goal_persist.ts's
// private `recipeId` matcher: no control characters, no whitespace, bounded.
const CANONICAL_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function isCanonicalId(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_ID_PATTERN.test(value);
}

/** Plain-data record only: JSON.parse output (Object.prototype or null
 *  prototype), never a class instance or exotic object smuggling behavior
 *  alongside its own keys (the vault_snapshot_wire.ts / corpse_harvest_info_wire.ts
 *  precedent). */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function isNonNegativeSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Delegates to the sim's own persisted-goal loader: the exact-key, canonical-id,
 *  bounded-count validation a saved goal already goes through, so a wire
 *  identity can never be looser than a persisted one. `undefined` (an absent
 *  or JS-undefined `goal` field) and the `{kind:'invalid'}` sentinel both
 *  refuse. */
function decodeIdentity(raw: unknown): GatheringGoalIdentity | null {
  const loaded = loadGatheringGoal(raw);
  if (!loaded || loaded.kind === 'invalid') return null;
  return loaded;
}

/** Refuses a material row whose counts are not exactly the projection's own
 *  arithmetic: every count is a nonnegative safe integer, owned
 *  (carried+stored) can never exceed required, reachable can never exceed
 *  owned, and missing/inaccessible are the EXACT derived remainders
 *  (required-owned, owned-reachable) rather than merely bounded by them. */
function decodeMaterial(raw: unknown): GatheringGoalMaterial | null {
  if (!isPlainRecord(raw) || !isCanonicalId(raw.itemId)) return null;
  const { required, carried, stored, reachable, missing, inaccessible } = raw;
  if (
    !isNonNegativeSafeInt(required) ||
    !isNonNegativeSafeInt(carried) ||
    !isNonNegativeSafeInt(stored) ||
    !isNonNegativeSafeInt(reachable) ||
    !isNonNegativeSafeInt(missing) ||
    !isNonNegativeSafeInt(inaccessible)
  ) {
    return null;
  }
  const owned = carried + stored;
  if (owned > required) return null;
  if (reachable > owned) return null;
  if (missing !== required - owned) return null;
  if (inaccessible !== owned - reachable) return null;
  return { itemId: raw.itemId, required, carried, stored, reachable, missing, inaccessible };
}

/**
 * Decode a PRESENT `self.ggoal` wire value into a `GatheringGoalView` mirror,
 * or `null` for an explicit clear or a refused malformed frame. Callers must
 * only invoke this on a key already confirmed present in the delta (an
 * omitted key means "unchanged", decided before this function is reached),
 * the same contract `decodeHarvestPreferenceWire` documents.
 */
export function decodeGatheringGoalWire(raw: unknown): GatheringGoalView | null {
  if (raw === null || raw === undefined) return null;
  if (!isPlainRecord(raw)) return null;
  if (typeof raw.status !== 'string' || !STATUSES.has(raw.status as GatheringGoalView['status'])) {
    return null;
  }
  const status = raw.status as GatheringGoalView['status'];
  const reasonValid =
    raw.reason === null ||
    (typeof raw.reason === 'string' && REASONS.has(raw.reason as GatheringGoalUnavailableReason));
  if (!reasonValid) return null;
  const reason = (raw.reason ?? null) as GatheringGoalUnavailableReason | null;

  let goal: GatheringGoalIdentity | null = null;
  if (raw.goal !== null) {
    goal = decodeIdentity(raw.goal);
    if (!goal) return null;
  }

  // Identity/status/reason consistency: a null goal exists ONLY for the
  // unavailable+invalid_goal pairing, and 'invalid_goal' never pairs with a
  // real identity (gathering_goal_projection.ts unavailable(null,'invalid_goal')
  // is its one producer).
  if (goal === null) {
    if (status !== 'unavailable' || reason !== 'invalid_goal') return null;
  } else {
    if (reason === 'invalid_goal') return null;
    if (status === 'unavailable') {
      if (reason === null) return null;
    } else if (reason !== null) {
      return null;
    }
    // Terminal statuses are commission-only (commissionState's delivered/
    // cancelled/expired arm never fires for a recipe goal).
    if (TERMINAL_STATUSES.has(status) && goal.kind !== 'commission') return null;
  }

  if (!Array.isArray(raw.materials)) return null;
  const materials: GatheringGoalMaterial[] = [];
  for (const entry of raw.materials) {
    const decoded = decodeMaterial(entry);
    if (!decoded) return null;
    materials.push(decoded);
  }
  // Only collecting/ready ever carry real rows (a valid empty-reagent recipe
  // keeps an empty array under either status too); every other status is the
  // no-projection-work shortcut, materials always [].
  const projecting = status === 'collecting' || status === 'ready';
  if (!projecting && materials.length !== 0) return null;
  if (status === 'ready') {
    for (const m of materials) {
      if (m.missing !== 0 || m.inaccessible !== 0) return null;
    }
  }

  if (!isSafeIntInRange(raw.payableCrafts, 0, Number.MAX_SAFE_INTEGER)) return null;
  const payableCrafts = raw.payableCrafts;
  if (!projecting) {
    if (payableCrafts !== 0) return null;
  } else if (payableCrafts > (goal as GatheringGoalIdentity).count) {
    return null;
  }

  if (typeof raw.storageRestricted !== 'boolean') return null;

  return {
    goal,
    status,
    reason,
    materials,
    payableCrafts,
    storageRestricted: raw.storageRestricted,
  };
}
