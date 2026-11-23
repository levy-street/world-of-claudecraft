// The world quest block's server-side REST contract (src/sim/world_quest_block.ts):
// the request schema, the machine vocabulary a block write refuses with, and the
// mapping from that vocabulary onto the stable error codes the admin routes
// raise. Host-agnostic leaf: no db, no res, no HTTP server, so a Vitest drives it
// directly and the admin coordinator stays a thin consumer. Same shape as
// server/cheater_mark_api.ts, the registry-only admin route precedent.
//
// The block is an operator sanction for world quest botting, short of a ban:
// the account keeps playing everything else, and its characters start, progress
// and earn nothing from world quests until an operator lifts it.

import type { ErrorCode } from './http/error_codes';
import { HttpError } from './http/errors';
import { type Infer, object, str } from './http/schema';

/** Every way a block write can be refused. Machine tokens, never prose. */
export const WORLD_QUEST_BLOCK_REFUSALS = [
  // The audited reason was absent or blank after trimming.
  'reason_required',
  // A block was asked for on an account that is already blocked (a
  // double-clicked button), so no second audit row claims a second decision.
  'already_blocked',
  // A lift was asked for on an account that is not blocked.
  'not_blocked',
  // The write matched no account row (a mistyped or purged id: requireAdminTarget
  // only decodes the :id, it never resolves it).
  'no_account',
] as const;
export type WorldQuestBlockRefusal = (typeof WORLD_QUEST_BLOCK_REFUSALS)[number];

/** The typed refusal world_quest_block_db.ts throws: a token, never a sentence. */
export class WorldQuestBlockRefused extends Error {
  constructor(readonly refusal: WorldQuestBlockRefusal) {
    super(refusal);
    this.name = 'WorldQuestBlockRefused';
  }
}

/** The HTTP status per refusal: the two state clashes are 409, not 400. */
const REFUSAL_STATUS: Record<WorldQuestBlockRefusal, number> = {
  reason_required: 400,
  already_blocked: 409,
  not_blocked: 409,
  no_account: 404,
};

/** The stable code per refusal (the admin client localizes `apiError.<code>`).
 *  `no_account` reuses the repo-wide `account.not_found`, as the Cheater mark does. */
const REFUSAL_CODE: Record<WorldQuestBlockRefusal, ErrorCode> = {
  reason_required: 'world_quest_block.reason_required',
  already_blocked: 'world_quest_block.already_blocked',
  not_blocked: 'world_quest_block.not_blocked',
  no_account: 'account.not_found',
};

/** The code for a block aimed at an operator account, held by the route. */
export const WORLD_QUEST_BLOCK_ADMIN_TARGET_CODE: ErrorCode = 'world_quest_block.admin_target';

/**
 * Rethrow a failed block write as what the route should surface: a coded
 * HttpError for a refusal, the ORIGINAL value for anything else, so a Postgres
 * or connection error still falls to the pipeline's 500 internal.error.
 */
export function rethrowWorldQuestBlockRefusal(err: unknown): never {
  if (err instanceof WorldQuestBlockRefused) {
    throw new HttpError(REFUSAL_STATUS[err.refusal], REFUSAL_CODE[err.refusal]);
  }
  throw err;
}

/**
 * POST /admin/api/moderation/accounts/:id/world-quests-block and
 * .../world-quests-unblock body. SHAPE only: a wrong-typed or missing reason is a
 * 422 validation.failed from the pipeline; a blank one is the coded
 * reason_required refusal from the write, so it holds for every caller.
 */
export const worldQuestBlockBodySchema = object({
  reason: str(),
});
export type WorldQuestBlockBody = Infer<typeof worldQuestBlockBodySchema>;
