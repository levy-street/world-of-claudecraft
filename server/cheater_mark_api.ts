// The Cheater mark's server-side REST contract (src/sim/moderation/): the two
// typed request schemas, the machine vocabulary a mark write refuses with, and
// the mapping from that vocabulary onto the stable error codes the admin routes
// raise. Host-agnostic leaf: no db, no res, no HTTP server, so a Vitest drives it
// directly and the admin coordinator stays a thin consumer.
//
// Why a shared machine vocabulary instead of messages: `server/` is
// language-agnostic (server/CLAUDE.md, "Error localization"), so the write layer
// in moderation_db.ts has to refuse with something the route can turn into a
// stable `cheater_mark.<reason>` code without parsing English prose. The refusal
// tokens below are that something; the client localizes the code.
//
// The mark is POWER-NEUTRAL by construction (src/sim/moderation/CLAUDE.md): every
// refusal here is about WHO may be branded and for HOW LONG, never about a
// gameplay effect, and nothing in this module may grow one.

import type { ErrorCode } from './http/error_codes';
import { HttpError } from './http/errors';
import { type Infer, num, object, str } from './http/schema';

/** Every way a Cheater mark write can be refused. Machine tokens, never prose. */
export const CHEATER_MARK_REFUSALS = [
  // The audited reason was absent or blank after trimming.
  'reason_required',
  // The played-second budget did not normalize to a positive number.
  'invalid_duration',
  // A lift was asked for on an account that is not wearing the tag.
  'not_marked',
  // The write matched no account row. Reachable from the admin routes despite
  // requireAdminTarget, which only decodes the :id into a positive integer and
  // never resolves it, and despite the operator-target guard, whose
  // isAdminAccount read answers false for an id that does not exist. So a
  // mistyped or purged account id lands here, and it has to read as a precise
  // operator-facing answer rather than an opaque 500.
  'no_account',
] as const;
export type CheaterMarkRefusal = (typeof CHEATER_MARK_REFUSALS)[number];

/**
 * The typed refusal the moderation_db writes throw. It carries a token, never a
 * sentence, so the route can map it to a stable code and every other caller
 * (a script, a future command) still gets a precise, checkable reason.
 */
export class CheaterMarkRefused extends Error {
  constructor(readonly refusal: CheaterMarkRefusal) {
    super(refusal);
    this.name = 'CheaterMarkRefused';
  }
}

/**
 * The HTTP status per refusal. `not_marked` is a 409 and not a 400: the request
 * was well formed and the operator's intent is unambiguous, the account simply is
 * not in a state that can be lifted (a double-clicked Lift button lands here).
 * `no_account` is the 404 that says the target itself does not exist.
 */
const REFUSAL_STATUS: Record<CheaterMarkRefusal, number> = {
  reason_required: 400,
  invalid_duration: 400,
  not_marked: 409,
  no_account: 404,
};

/**
 * The stable code per refusal (the client localizes `apiError.<code>`).
 *
 * `no_account` deliberately reuses the repo-wide `account.not_found` rather than
 * minting a `cheater_mark.*` twin: it is the same fact every other account route
 * already reports, and the shared code is already mapped and translated.
 */
const REFUSAL_CODE: Record<CheaterMarkRefusal, ErrorCode> = {
  reason_required: 'cheater_mark.reason_required',
  invalid_duration: 'cheater_mark.invalid_duration',
  not_marked: 'cheater_mark.not_marked',
  no_account: 'account.not_found',
};

/**
 * The code for a mark aimed at an operator account. Not a moderation_db refusal:
 * the route holds this line, because it is the caller's authority that is in
 * question rather than the write's shape.
 */
export const CHEATER_MARK_ADMIN_TARGET_CODE: ErrorCode = 'cheater_mark.admin_target';

/**
 * Rethrow a failed mark write as the throwable the route should surface: a coded
 * HttpError for a refusal, the ORIGINAL value for anything else. Passing the
 * original through is load-bearing: a Postgres or connection error must keep
 * falling to the pipeline's 500 internal.error rather than being relabelled as
 * an operator mistake.
 */
export function rethrowCheaterMarkRefusal(err: unknown): never {
  if (err instanceof CheaterMarkRefused) {
    throw new HttpError(REFUSAL_STATUS[err.refusal], REFUSAL_CODE[err.refusal]);
  }
  throw err;
}

/**
 * POST /admin/api/moderation/accounts/:id/cheater-mark body.
 *
 * SHAPE only, on purpose: the reason's trim/truncate and the budget's positivity
 * and CHEATER_MARK_MAX_SECONDS ceiling all live in moderation_db, so the ceiling
 * holds for EVERY caller rather than only for requests that came through here.
 * A wrong-typed or missing field is a 422 validation.failed from the pipeline; a
 * well-typed but out-of-contract value is a coded refusal from the write.
 */
export const cheaterMarkBodySchema = object({
  reason: str(),
  seconds: num(),
});
export type CheaterMarkBody = Infer<typeof cheaterMarkBodySchema>;

/**
 * POST /admin/api/moderation/accounts/:id/lift-cheater-mark body. The reason is
 * required on the lift too: who un-branded an account, and why, has to be
 * recoverable from the audit long after the tag is gone.
 */
export const liftCheaterMarkBodySchema = object({
  reason: str(),
});
export type LiftCheaterMarkBody = Infer<typeof liftCheaterMarkBodySchema>;
