// Shared legacy-body bearer guard for the API request pipeline.
//
// A per-route middleware that mirrors server/main.ts bearerActiveAccount EXACTLY:
// it resolves the 64-hex bearer token, requires a full (mutating) scope, and
// applies the moderation/ban gate, writing the LEGACY { error } bodies and
// short-circuiting (no next()) on rejection. A missing/malformed bearer 401s
// WITHOUT a DB call, so the no-auth goldens replay DB-free through both dispatch
// paths.
//
// Why a shared factory (rule-of-three): server/wallet.ts, server/characters.ts,
// and server/account.ts each grew a byte-identical `const activeGuard` copy during
// their migrations, and the wallet-surface review filed the consolidation as a
// follow-up ("do NOT add a 4th copy; extract when the next domain needs the
// guard"). The reports surface (server/reports.ts) is that next domain, so the
// guard is extracted here and reports.ts consumes it. Retrofitting the three
// existing copies onto this factory is deliberately deferred to the dedicated
// bearer-resolver step (a natural fit alongside the ladder deletion): those surfaces are
// already shipped and byte-parity-pinned, and each carries a sibling guard
// (readGuard / logoutGuard) that this active-only factory does not cover, so the
// retrofit belongs in its own change, not this small migration.
//
// This is a transitional artifact: it emits the legacy prose { error } bodies the
// client prose-matcher (src/main.ts userFacingApiError) still keys on, NOT the
// RFC 9457 problem+json requireAccount middleware. The client code-matcher and the
// 'new' dispatch default are both live, but the give-way to the coded requireAccount
// path happens at the ladder-deletion PR (next release): until then these guards keep
// emitting the legacy-parity bodies on both dispatch arms.

import type * as http from 'node:http';
import { type AccountModerationStatus, scopeAllowsMutation, type TokenScope } from '../../db';
import { json, moderationErrorBody } from '../../http_util';
import type { Ctx, Middleware, Next } from '../types';

// The exact legacy { error } identities bearerActiveAccount emits, plus the additive machine
// `code` the client code-matcher keys on, alongside the untouched prose. Named constants so they
// cannot drift from the resolver they mirror. No em dash appears in any (the legacy
// strings never used one).
export const NOT_AUTHENTICATED = { error: 'not authenticated', code: 'auth.required' } as const;
export const READ_ONLY_TOKEN = {
  error: 'this token is read-only',
  code: 'auth.forbidden',
} as const;

// The bearer token shape: a 64-hex secret behind the "Bearer " scheme. Mirrors the
// regex the legacy bearer* resolvers in server/main.ts use.
const BEARER_PATTERN = /^Bearer ([a-f0-9]{64})$/;

/** The raw 64-hex bearer token, or null (no header or bad shape). */
export function bearerToken(req: http.IncomingMessage): string | null {
  const m = BEARER_PATTERN.exec(req.headers.authorization ?? '');
  return m ? m[1] : null;
}

/**
 * The two db reads the guard needs, bundled so a unit test can inject a fake with
 * no Postgres. The shape mirrors the real server/db.ts exports the legacy
 * bearerActiveAccount arm calls.
 */
export interface BearerActiveGuardDb {
  accountAndScopeForToken(token: string): Promise<{ accountId: number; scope: TokenScope } | null>;
  // The full status shape so the guard can emit the additive moderation `code`
  // (and suspension `date`) via moderationErrorBody; the real db.ts function
  // already returns it, and the test fakes supply a full modStatus().
  moderationStatusForAccount(accountId: number): Promise<AccountModerationStatus>;
}

/**
 * Build the mutating + account-scoped bearer guard (mirrors bearerActiveAccount:
 * full-session, read-only 403, moderation 403). `getDb` returns the LIVE db bundle
 * on each request, so a per-domain test seam (a mutable module-level bundle a
 * setXDbForTests reassigns) is read at call time, not captured at construction.
 * On success it sets ctx.account and calls next(); on any rejection it writes the
 * legacy { error } body and short-circuits.
 */
export function createActiveGuard(getDb: () => BearerActiveGuardDb): Middleware {
  return async (ctx: Ctx, next: Next) => {
    const token = bearerToken(ctx.req);
    const db = getDb();
    const info = token === null ? null : await db.accountAndScopeForToken(token);
    if (info === null) {
      json(ctx.res, 401, NOT_AUTHENTICATED);
      return;
    }
    if (!scopeAllowsMutation(info.scope)) {
      json(ctx.res, 403, READ_ONLY_TOKEN);
      return;
    }
    const status = await db.moderationStatusForAccount(info.accountId);
    if (status.locked) {
      json(ctx.res, 403, moderationErrorBody(status));
      return;
    }
    ctx.account = { accountId: info.accountId, scope: info.scope };
    await next();
  };
}

/**
 * Build the READ-scope bearer guard (mirrors main.ts bearerReadAccount: a 'read'
 * OR 'full' token is accepted, the moderation gate still applies). Same lazy
 * `getDb` contract as createActiveGuard. Extracted as the factory's sibling for
 * the v0.20.0 maps/user-assets migration (GET /api/maps + GET /api/assets/mine),
 * the first registered read-scope routes outside the per-domain guard copies.
 */
export function createReadGuard(getDb: () => BearerActiveGuardDb): Middleware {
  return async (ctx: Ctx, next: Next) => {
    const token = bearerToken(ctx.req);
    const db = getDb();
    const info = token === null ? null : await db.accountAndScopeForToken(token);
    if (info === null) {
      json(ctx.res, 401, NOT_AUTHENTICATED);
      return;
    }
    const status = await db.moderationStatusForAccount(info.accountId);
    if (status.locked) {
      json(ctx.res, 403, moderationErrorBody(status));
      return;
    }
    ctx.account = { accountId: info.accountId, scope: info.scope };
    await next();
  };
}
