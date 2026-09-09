// Pure parsing for the optional headless `{cmd:'gathering_goal', verb:...}`
// request family (Intentional Gathering PR4). Frozen contract:
// docs/protocols/gathering-goal.md
//
// A separate, closed family from `{cmd:'gathering', verb:...}` (PR3,
// `gathering_protocol.ts`): that family stays exactly as shipped, this one
// carries the one-goal tracking surface (inspect/track_recipe/
// track_commission/clear) on its own verbs and its own capability.
//
// Strict plain-record, exact-key validation: arrays, non-plain records,
// unknown/extra keys, unsafe ids and out-of-range counts all refuse.
// `recipeId` and `count` reuse the exact bounds `gathering_goal_persist.ts`
// enforces on load (the same canonical recipe-id shape, the same
// 1..CRAFT_BATCH_MAX count range via its exported `validGatheringGoalCount`);
// `orderId` reuses its exported `validGatheringGoalOrderId`.

import {
  validGatheringGoalCount,
  validGatheringGoalOrderId,
} from '../src/sim/professions/gathering_goal_persist';

export type GatheringGoalVerb = 'inspect' | 'track_recipe' | 'track_commission' | 'clear';

const GATHERING_GOAL_VERBS: readonly GatheringGoalVerb[] = [
  'inspect',
  'track_recipe',
  'track_commission',
  'clear',
];

/** Advertised in the `info` reply's `gathering_goal` field so a client can
 *  discover the family without hardcoding it. */
export const GATHERING_GOAL_CAPABILITY = Object.freeze({
  version: 1 as const,
  verbs: GATHERING_GOAL_VERBS,
});

export type GatheringGoalRequest =
  | { readonly cmd: 'gathering_goal'; readonly verb: 'inspect' }
  | {
      readonly cmd: 'gathering_goal';
      readonly verb: 'track_recipe';
      readonly recipeId: string;
      readonly count: number;
    }
  | { readonly cmd: 'gathering_goal'; readonly verb: 'track_commission'; readonly orderId: number }
  | { readonly cmd: 'gathering_goal'; readonly verb: 'clear' };

export type GatheringGoalParseResult =
  | { readonly ok: true; readonly request: GatheringGoalRequest }
  | { readonly ok: false; readonly reason: 'invalid_request' };

const INVALID: GatheringGoalParseResult = { ok: false, reason: 'invalid_request' };

// The same canonical recipe-id shape `gathering_goal_persist.ts` checks on
// load (that module keeps its own private copy; there is no exported
// validator to reuse, so this mirrors the bound rather than reimplementing a
// different one).
const RECIPE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isCanonicalRecipeId(value: unknown): value is string {
  return typeof value === 'string' && RECIPE_ID_PATTERN.test(value);
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const recordKeys = Object.keys(record);
  return recordKeys.length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

export function parseGatheringGoalRequest(raw: unknown): GatheringGoalParseResult {
  if (!isPlainRecord(raw)) return INVALID;
  if (raw.cmd !== 'gathering_goal' || typeof raw.verb !== 'string') return INVALID;

  switch (raw.verb) {
    case 'inspect':
      if (!hasExactKeys(raw, ['cmd', 'verb'])) return INVALID;
      return { ok: true, request: { cmd: 'gathering_goal', verb: 'inspect' } };

    case 'track_recipe':
      if (!hasExactKeys(raw, ['cmd', 'verb', 'recipeId', 'count'])) return INVALID;
      if (!isCanonicalRecipeId(raw.recipeId)) return INVALID;
      if (!validGatheringGoalCount(raw.count)) return INVALID;
      return {
        ok: true,
        request: {
          cmd: 'gathering_goal',
          verb: 'track_recipe',
          recipeId: raw.recipeId,
          count: raw.count,
        },
      };

    case 'track_commission':
      if (!hasExactKeys(raw, ['cmd', 'verb', 'orderId'])) return INVALID;
      if (!validGatheringGoalOrderId(raw.orderId)) return INVALID;
      return {
        ok: true,
        request: { cmd: 'gathering_goal', verb: 'track_commission', orderId: raw.orderId },
      };

    case 'clear':
      if (!hasExactKeys(raw, ['cmd', 'verb'])) return INVALID;
      return { ok: true, request: { cmd: 'gathering_goal', verb: 'clear' } };

    default:
      return INVALID;
  }
}
