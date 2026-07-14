// The Steam link surface: three registry-only RouteDefs (no legacy-ladder
// twin, by design, like server/deeds.ts). Everything answers steam.disabled
// until STEAM_ENABLED=1.
//
// THE HARD RULE, pinned by tests/server/steam_routes.test.ts: linking is
// allowed, LOGIN WITH STEAM DOES NOT EXIST. Nothing in server/steam/ calls
// newToken, reads or writes auth_tokens, or mints any credential; a
// steam_links row is a cosmetic-mirror pointer for the deeds achievement
// mirror, never an identity or session source. Login stays email + Discord
// only, everywhere, always.
//
// POST /api/steam/link { ticket }: the client (desktop shell only in v1)
// obtains a Steam session ticket bound to the wocc-link identity and posts
// its hex form; the SERVER verifies it upstream with the publisher key and
// extracts the Steam id from the verified response. The client is never
// trusted to name its own Steam id. VAC/publisher-banned accounts are
// refused. On success the reconcile job pushes every already-earned mapped
// deed to Steam, fire-and-forget.

import { ctxAccountId } from '../http/context';
import { HttpError } from '../http/errors';
import { withBody } from '../http/middleware/body';
import { rateLimit, STEAM_LINK_POLICY } from '../http/middleware/rate_limit';
import { requireAccount } from '../http/middleware/require_account';
import type { Ctx, Middleware, RouteDef } from '../http/types';
import { json } from '../http_util';
import { steamAppId, steamEnabled, steamWebApiKey } from './config';
import { onLinkChanged, reconcileLink } from './mirror';
import {
  accountForSteamId,
  deleteSteamLink,
  displaceSteamLink,
  insertSteamLink,
  steamLinkForAccount,
} from './steam_db';
import { isTicketShape } from './ticket';
import { verifyLinkTicket } from './web_api';

/** The feature gate, FIRST on every route (before auth): with the flag off
 *  the whole surface answers the stable steam.disabled 503, bearer or not. */
const steamDisabledGuard: Middleware = async (_ctx, next) => {
  if (!steamEnabled()) throw new HttpError(503, 'steam.disabled');
  await next();
};

/** POST /api/steam/link { ticket }: verify and store the caller's link. */
async function linkHandler(ctx: Ctx): Promise<void> {
  const accountId = ctxAccountId(ctx);
  const ticket = (ctx.body as Record<string, unknown> | null | undefined)?.ticket;
  if (!isTicketShape(ticket)) throw new HttpError(400, 'steam.invalid_ticket');

  // Enabled but not provisioned (no app id or publisher key yet) reads as the
  // upstream being unreachable: a 503 the player can retry, never a 500.
  const appId = steamAppId();
  const key = steamWebApiKey();
  if (appId === null || key === null) throw new HttpError(503, 'steam.upstream');

  // Cheap conflict first: an already-linked account never burns an upstream
  // verification call.
  if ((await steamLinkForAccount(accountId)) !== null) {
    throw new HttpError(409, 'steam.already_linked');
  }

  const outcome = await verifyLinkTicket({ key, appId, ticket });
  if (outcome.kind === 'upstream') throw new HttpError(503, 'steam.upstream');
  if (outcome.kind === 'invalid' || outcome.kind === 'malformed') {
    throw new HttpError(400, 'steam.invalid_ticket');
  }
  if (outcome.kind === 'banned') throw new HttpError(403, 'steam.banned');
  const steamId = outcome.steamId;

  const owner = await accountForSteamId(steamId);
  if (owner !== null && owner !== accountId) {
    // Reclaim-by-proof, NOT a 409: this Steam id is currently linked to a
    // DIFFERENT WoCC account, but the caller just proved CURRENT control of the
    // Steam account with a fresh verified ticket, strictly stronger evidence
    // than the stale (possibly stolen) ticket the squatter linked with. Displace
    // the old row and hand the link to the true owner, so the account that
    // controls the Steam login always wins in steady state. (The server-issued
    // identity-challenge in ticket.ts is the stronger future design; today the
    // fresh-ticket displacement is the reclaim path.)
    const displaced = await displaceSteamLink(accountId, steamId);
    if (displaced.result === 'account_linked') throw new HttpError(409, 'steam.already_linked');
    if (displaced.result === 'steam_taken') throw new HttpError(409, 'steam.account_taken');
    // Flip the displaced account's cached mirror view in-request so its
    // in-flight pushes revalidate against a now-empty link and drop, exactly as
    // unlink does. A peer realm process still heals via its own push-time read.
    if (displaced.displacedAccountId !== null) onLinkChanged(displaced.displacedAccountId, null);
  } else {
    // The Steam id is free. Plain insert; it re-classifies a 23505 in case a
    // concurrent request beat the pre-checks, both arms the same 409s the
    // pre-checks answer.
    const inserted = await insertSteamLink(accountId, steamId);
    if (inserted === 'account_linked') throw new HttpError(409, 'steam.already_linked');
    if (inserted === 'steam_taken') throw new HttpError(409, 'steam.account_taken');
  }

  reconcileLink(accountId, steamId);
  json(ctx.res, 200, { linked: true, steamId });
}

/** DELETE /api/steam/link: drop the caller's link. Idempotent. */
async function unlinkHandler(ctx: Ctx): Promise<void> {
  const accountId = ctxAccountId(ctx);
  await deleteSteamLink(accountId);
  onLinkChanged(accountId, null);
  json(ctx.res, 200, { unlinked: true });
}

/** GET /api/steam/status: the caller's link state (enabled is always true
 *  here; with the flag off the guard answered first). */
async function statusHandler(ctx: Ctx): Promise<void> {
  const row = await steamLinkForAccount(ctxAccountId(ctx));
  json(ctx.res, 200, {
    enabled: true,
    linked: row !== null,
    ...(row === null ? {} : { steamId: row.steamId }),
  });
}

/** Mutation-tier bearer gate for link/unlink. */
const activeAccount = requireAccount({ scope: 'active' });
/** Read-tier bearer gate for the status read. */
const readAccount = requireAccount({ scope: 'read' });

export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/api/steam/link',
    surface: 'api',
    // Order matters: the feature gate answers before auth (steam.disabled on
    // every call while dark), the limiter needs ctx.account so it mounts
    // behind the guard, and the body reader feeds the handler last.
    middleware: [steamDisabledGuard, activeAccount, rateLimit(STEAM_LINK_POLICY), withBody()],
    handler: linkHandler,
  },
  {
    method: 'DELETE',
    path: '/api/steam/link',
    surface: 'api',
    middleware: [steamDisabledGuard, activeAccount],
    handler: unlinkHandler,
  },
  {
    method: 'GET',
    path: '/api/steam/status',
    surface: 'api',
    middleware: [steamDisabledGuard, readAccount],
    handler: statusHandler,
  },
];
