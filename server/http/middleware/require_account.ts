// Bearer-token authentication plus the moderation gate, as an onion middleware
// for the API request pipeline. Mirrors the live
// bearerActiveAccount / bearerReadAccount resolvers (server/main.ts): extract
// and validate the bearer token, enforce the route's scope tier, then apply the
// ban/suspension check. Importable but UNMOUNTED here; the route tables place it
// in front of the routes that need it.

import {
  type AccountModerationStatus,
  accountAndScopeForToken,
  moderationStatusForAccount,
  scopeAllowsMutation,
  type TokenScope,
} from '../../db';
import { HttpError } from '../errors';
import type { Ctx, Middleware, Next } from '../types';

/**
 * The scope tier a route requires. 'active' and 'full' are the SAME mutation
 * tier (both set requiresFull), mirroring the live bearerActiveAccount resolver
 * (which requires scopeAllowsMutation); 'read' is the authenticated-read tier
 * mirroring bearerReadAccount, which accepts either a 'read' or 'full' token.
 */
export type RequiredScope = 'read' | 'active' | 'full';

const BEARER_PATTERN = /^Bearer ([a-f0-9]{64})$/;

/**
 * Deps-bag for testability. lookupToken and moderationStatus hit the database in
 * production, so they are injected and default to the real functions; a
 * production caller passes only { scope }.
 */
export interface RequireAccountDeps {
  scope: RequiredScope;
  /**
   * Anonymous-friendly mode (the public-read authz-gap-close). When true and NO
   * Authorization header is present, next() runs with ctx.account left undefined
   * (the route serves anonymously). A header that IS present is still validated:
   * a malformed or unresolvable token is rejected exactly as in required mode, so
   * a present-but-invalid token can no longer be silently treated as anonymous.
   * Absent by default (the required behavior is unchanged).
   */
  optional?: boolean;
  lookupToken?: (raw: string) => Promise<{ accountId: number; scope: TokenScope } | null>;
  moderationStatus?: (accountId: number) => Promise<AccountModerationStatus>;
}

/**
 * Build the auth middleware for `deps.scope`. Extracts the bearer token,
 * resolves its account and scope, enforces the scope gate, then applies the
 * moderation gate for EVERY scope, not only mutating routes: a locked account is
 * rejected whether the route requires 'read', 'active', or 'full', so no route
 * migrated behind this middleware can skip the ban/suspension check the way a
 * raw bearerScopeAccount call could. On success, sets ctx.account and calls
 * next().
 */
export function requireAccount(deps: RequireAccountDeps): Middleware {
  const lookupToken = deps.lookupToken ?? accountAndScopeForToken;
  const moderationStatus = deps.moderationStatus ?? moderationStatusForAccount;
  const requiresFull = deps.scope !== 'read';
  return async (ctx: Ctx, next: Next) => {
    const hdr = ctx.req.headers.authorization ?? '';
    // Anonymous-friendly: a request with NO Authorization header serves without
    // an account. A present (even malformed) header still falls through to full
    // validation below, so an invalid token is rejected, never served as anon.
    if (deps.optional && hdr === '') {
      await next();
      return;
    }
    const m = BEARER_PATTERN.exec(hdr);
    if (!m) throw new HttpError(401, 'auth.token_missing');
    const info = await lookupToken(m[1]);
    if (info === null) throw new HttpError(401, 'auth.token_invalid');
    if (requiresFull && !scopeAllowsMutation(info.scope)) {
      throw new HttpError(403, 'auth.forbidden');
    }
    const status = await moderationStatus(info.accountId);
    if (status.locked) {
      if (status.banned) throw new HttpError(403, 'moderation.banned');
      if (status.suspendedUntil) {
        throw new HttpError(403, 'moderation.suspended_until', { date: status.suspendedUntil });
      }
      // A self-deactivated account is locked but is neither banned nor suspended;
      // it carries its own stable code so the client localizes the deactivation
      // message rather than a generic suspension. Kept ahead of the fallback,
      // which stays as a defensive catch for any future locked-but-unclassified
      // state (e.g. an indefinite suspension the DB does not currently emit).
      if (status.deactivated) throw new HttpError(403, 'account.deactivated');
      throw new HttpError(403, 'moderation.suspended');
    }
    ctx.account = { accountId: info.accountId, scope: info.scope };
    await next();
  };
}
