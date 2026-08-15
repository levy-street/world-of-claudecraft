// The Epic link surface: three registry-only RouteDefs (no legacy-ladder twin,
// by design, like server/steam/routes.ts). Everything answers epic.disabled
// until EPIC_ENABLED=1.
//
// THE HARD RULE, pinned by tests/server/epic_routes.test.ts: linking is
// allowed, LOGIN WITH EPIC DOES NOT EXIST. Nothing in server/epic/ calls
// newToken, reads or writes auth_tokens, or mints any credential; an
// epic_links row is a cosmetic-mirror pointer for the deeds achievement
// mirror, never an identity or session source. Login stays email + Discord
// only, everywhere, always.
//
// POST /api/epic/link { proof }: the client (desktop shell only in v1)
// obtains a short-lived proof (preferred: launcher exchange code) and posts
// it; the SERVER verifies it upstream with the confidential client credentials
// and extracts the Epic account id from the verified response. The client is
// never trusted to name its own Epic id. Blocked accounts are refused. On
// success the reconcile job (Phase 6 fill) is fire-and-forget.

import { ctxAccountId } from '../http/context';
import { HttpError } from '../http/errors';
import { withBody } from '../http/middleware/body';
import { EPIC_LINK_POLICY, rateLimit } from '../http/middleware/rate_limit';
import { requireAccount } from '../http/middleware/require_account';
import type { Ctx, Middleware, RouteDef } from '../http/types';
import { json } from '../http_util';
import {
  epicClientId,
  epicClientSecret,
  epicDeploymentId,
  epicEnabled,
  epicProvisioned,
} from './config';
import {
  accountForEpicId,
  deleteEpicLink,
  displaceEpicLink,
  epicLinkForAccount,
  insertEpicLink,
} from './epic_db';
import { onLinkChanged, reconcileLink } from './mirror';
import { isProofShape } from './ticket';
import { verifyLinkProof } from './web_api';

// Re-export shape helpers so existing importers of routes stay stable; the
// pure source of truth lives in ticket.ts.
export { isProofShape, MAX_PROOF_CHARS, MIN_PROOF_CHARS } from './ticket';

/** The feature gate, FIRST on every route (before auth): with the flag off
 *  the whole surface answers the stable epic.disabled 503, bearer or not. */
const epicDisabledGuard: Middleware = async (_ctx, next) => {
  if (!epicEnabled()) throw new HttpError(503, 'epic.disabled');
  await next();
};

/** POST /api/epic/link { proof }: verify and store the caller's link. */
async function linkHandler(ctx: Ctx): Promise<void> {
  const accountId = ctxAccountId(ctx);
  const proof = (ctx.body as Record<string, unknown> | null | undefined)?.proof;
  if (!isProofShape(proof)) throw new HttpError(400, 'epic.invalid_token');

  // Enabled but not provisioned (missing product / deployment / client ids or
  // secret) reads as the upstream being unreachable: a 503 the player can
  // retry, never a 500.
  if (!epicProvisioned()) throw new HttpError(503, 'epic.upstream');

  const clientId = epicClientId();
  const clientSecret = epicClientSecret();
  const deploymentId = epicDeploymentId();
  // epicProvisioned already checked non-null; narrow for the type system.
  if (clientId === null || clientSecret === null || deploymentId === null) {
    throw new HttpError(503, 'epic.upstream');
  }

  // Cheap conflict first: an already-linked account never burns an upstream
  // verification call.
  if ((await epicLinkForAccount(accountId)) !== null) {
    throw new HttpError(409, 'epic.already_linked');
  }

  const outcome = await verifyLinkProof({
    clientId,
    clientSecret,
    deploymentId,
    proof,
  });
  if (outcome.kind === 'upstream') throw new HttpError(503, 'epic.upstream');
  if (outcome.kind === 'invalid' || outcome.kind === 'malformed') {
    throw new HttpError(400, 'epic.invalid_token');
  }
  if (outcome.kind === 'banned') throw new HttpError(403, 'epic.banned');
  const epicAccountId = outcome.epicAccountId;

  const owner = await accountForEpicId(epicAccountId);
  if (owner !== null && owner !== accountId) {
    // Reclaim-by-proof, NOT a 409: this Epic id is currently linked to a
    // DIFFERENT WoCC account, but the caller just proved CURRENT control of
    // the Epic account with a fresh verified proof, strictly stronger evidence
    // than the stale (possibly stolen) proof the squatter linked with. Displace
    // the old row and hand the link to the true owner, so the account that
    // controls the Epic login always wins in steady state.
    const displaced = await displaceEpicLink(accountId, epicAccountId);
    if (displaced.result === 'account_linked') throw new HttpError(409, 'epic.already_linked');
    if (displaced.result === 'epic_taken') throw new HttpError(409, 'epic.account_taken');
    // Flip the displaced account's cached mirror view in-request so its
    // in-flight pushes revalidate against a now-empty link and drop, exactly as
    // unlink does. A peer realm process still heals via its own push-time read.
    if (displaced.displacedAccountId !== null) {
      // Operator-visible trace for the reclaim: numeric account ids only (the
      // secrets rule keeps upstream identifiers out of log lines).
      console.warn(
        `epic link: account ${accountId} reclaimed a linked Epic account from account ${displaced.displacedAccountId}`,
      );
      onLinkChanged(displaced.displacedAccountId, null);
    }
  } else {
    // The Epic id is free. Plain insert; it re-classifies a 23505 in case a
    // concurrent request beat the pre-checks, both arms the same 409s the
    // pre-checks answer.
    const inserted = await insertEpicLink(accountId, epicAccountId);
    if (inserted === 'account_linked') throw new HttpError(409, 'epic.already_linked');
    if (inserted === 'epic_taken') throw new HttpError(409, 'epic.account_taken');
  }

  reconcileLink(accountId, epicAccountId);
  json(ctx.res, 200, { linked: true, epicAccountId });
}

/** DELETE /api/epic/link: drop the caller's link. Idempotent. */
async function unlinkHandler(ctx: Ctx): Promise<void> {
  const accountId = ctxAccountId(ctx);
  await deleteEpicLink(accountId);
  onLinkChanged(accountId, null);
  json(ctx.res, 200, { unlinked: true });
}

/** GET /api/epic/status: the caller's link state (enabled is always true
 *  here; with the flag off the guard answered first). */
async function statusHandler(ctx: Ctx): Promise<void> {
  const row = await epicLinkForAccount(ctxAccountId(ctx));
  json(ctx.res, 200, {
    enabled: true,
    linked: row !== null,
    ...(row === null ? {} : { epicAccountId: row.epicAccountId }),
  });
}

/** Mutation-tier bearer gate for link/unlink. */
const activeAccount = requireAccount({ scope: 'active' });
/** Read-tier bearer gate for the status read. */
const readAccount = requireAccount({ scope: 'read' });

export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/api/epic/link',
    surface: 'api',
    // Order matters: the feature gate answers before auth (epic.disabled on
    // every call while dark), the limiter needs ctx.account so it mounts
    // behind the guard, and the body reader feeds the handler last.
    middleware: [epicDisabledGuard, activeAccount, rateLimit(EPIC_LINK_POLICY), withBody()],
    handler: linkHandler,
  },
  {
    method: 'DELETE',
    path: '/api/epic/link',
    surface: 'api',
    middleware: [epicDisabledGuard, activeAccount],
    handler: unlinkHandler,
  },
  {
    method: 'GET',
    path: '/api/epic/status',
    surface: 'api',
    middleware: [epicDisabledGuard, readAccount],
    handler: statusHandler,
  },
];
