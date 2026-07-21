// Route layer for the desktop-login handoff pair:
//   POST /api/desktop-login/create    mint the single-use IP-bound handoff code
//   POST /api/desktop-login/exchange  trade the deep-linked code for a session
// A SIBLING of server/desktop_login.ts (which stays db-import-free so its
// pure-unit tests never construct the pg pool), following the auth_routes.ts
// route-module pattern. The legacy handleApi arms in main.ts stay as the
// flag-off rollback path until the ladder-deletion PR (next release).
//
// PARITY-FIRST: both handlers reuse the desktop_login.ts cores UNCHANGED
// (issueDesktopLoginCode / handleDesktopLoginExchange), so every body is the
// legacy { error } / { code, expiresInMs } / { token, username } byte-for-byte.
//
// - The FUSED per-IP budget is preserved: desktopLoginRateGuard calls the SAME
//   rateLimited(req) default bucket the register/login RouteDefs
//   (auth_routes.ts ipRateLimitGuard) and the legacy fused arm consume, so all
//   four paths stay ONE budget, and the limiter runs BEFORE auth exactly like
//   the legacy ladder (the fused check sits ahead of the arms).
// - Scope fix (maintainer-resolved fork): create authenticates via
//   the shared createActiveGuard (full active session; a read-scope
//   companion/OAuth token answers 403 'this token is read-only'), where the
//   original handler used the scope-blind accountForToken, letting a read token
//   escalate to the full session exchange mints. The legacy arm carries the
//   mirror fix (bearerActiveAccount before issueDesktopLoginCode); the
//   desktopLoginCreateFullScope known deviation records the contract change.
// - exchange stays unauthenticated by design (the 160-bit single-use IP-bound
//   code IS the credential) and SELF-READS its body (no withBody): a malformed
//   or over-cap body rejects out of readBody into the withErrors boundary (the
//   desktopLoginBodyValidationRemap deviation; the legacy counterfactual is a
//   request HANG, the bare-return arm escaping handleApi's outer catch).

import type { IncomingMessage } from 'node:http';
import {
  accountAndScopeForToken,
  accountById,
  moderationStatusForAccount,
  saveToken,
  touchLogin,
} from './db';
import {
  type DesktopLoginRouteDeps,
  handleDesktopLoginExchange,
  issueDesktopLoginCode,
} from './desktop_login';
import { ctxAccountId } from './http/context';
import { type BearerActiveGuardDb, createActiveGuard } from './http/middleware/bearer_active_guard';
import type { Ctx, Middleware, Next, RouteDef } from './http/types';
import { json, readBody } from './http_util';
import { rateLimited, requestIp } from './ratelimit';

// The exact legacy 429 prose the fused register/login/desktop-login budget
// answers with (main.ts fused arm + auth_routes.ts ipRateLimitGuard).
const TOO_MANY_ATTEMPTS = 'too many attempts, wait a minute and try again';

// The db reads the guard and the two handler cores need. Built LAZILY (a
// function, not a module-scope object literal) so importing this module never
// dereferences the db.ts bindings (the lazy-db-bundle rule: an
// unrelated test that partial-mocks server/db and pulls this module in
// transitively must not throw on a missing export).
function makeRealDesktopLoginDb() {
  return {
    accountAndScopeForToken,
    moderationStatusForAccount,
    accountById,
    touchLogin,
    saveToken,
  };
}
type DesktopLoginDb = ReturnType<typeof makeRealDesktopLoginDb>;
let realDesktopLoginDb: DesktopLoginDb | undefined;
let desktopLoginDbOverride: DesktopLoginDb | undefined;
function desktopLoginDb(): DesktopLoginDb {
  if (desktopLoginDbOverride) return desktopLoginDbOverride;
  realDesktopLoginDb ??= makeRealDesktopLoginDb();
  return realDesktopLoginDb;
}

/** Override the db bundle with a fake (test-only; merges over the real reads). */
export function setDesktopLoginRoutesDbForTests(overrides: Partial<DesktopLoginDb>): void {
  realDesktopLoginDb ??= makeRealDesktopLoginDb();
  desktopLoginDbOverride = { ...realDesktopLoginDb, ...overrides };
}

/** Restore the real db bundle after a setDesktopLoginRoutesDbForTests override. */
export function resetDesktopLoginRoutesDbForTests(): void {
  desktopLoginDbOverride = undefined;
}

// Byte-identical to main.ts requestMetadata (the legacy deps wiring).
function requestMetadata(req: IncomingMessage): { ip: string; userAgent: string } {
  return {
    ip: requestIp(req),
    userAgent: String(req.headers['user-agent'] ?? ''),
  };
}

// The DesktopLoginRouteDeps view over the live db bundle, rebuilt per call so a
// setDesktopLoginRoutesDbForTests override installed after import is honored.
function routeDeps(): DesktopLoginRouteDeps {
  const db = desktopLoginDb();
  return {
    readBody,
    json,
    requestMetadata,
    accountById: db.accountById,
    moderationStatusForAccount: db.moderationStatusForAccount,
    touchLogin: db.touchLogin,
    saveToken: db.saveToken,
  };
}

/**
 * The fused per-IP limiter, BEFORE auth (legacy order): one rateLimited(req)
 * default bucket shared with /api/register + /api/login. exchange is
 * unauthenticated (defense in depth on top of the single-use code) and create
 * bounds how fast one authenticated client can grow the code store.
 */
const desktopLoginRateGuard: Middleware = async (ctx: Ctx, next: Next) => {
  if (!rateLimited(ctx.req).allowed) {
    json(ctx.res, 429, { error: TOO_MANY_ATTEMPTS, code: 'auth.too_many_attempts' });
    return;
  }
  await next();
};

/** Full-session auth for create (mirrors bearerActiveAccount; the 18b scope fix). */
const activeGuard = createActiveGuard(() => desktopLoginDb() as BearerActiveGuardDb);

/** POST /api/desktop-login/create: mint the handoff code (auth resolved by the guard). */
async function desktopLoginCreateHandler(ctx: Ctx): Promise<void> {
  return issueDesktopLoginCode(ctx.req, ctx.res, routeDeps(), ctxAccountId(ctx));
}

/** POST /api/desktop-login/exchange: trade the code for a session (unauthenticated). */
async function desktopLoginExchangeHandler(ctx: Ctx): Promise<void> {
  return handleDesktopLoginExchange(ctx.req, ctx.res, routeDeps());
}

// The route table. registry.ts spreads this into apiRoutes; the limiter guard
// is FIRST on both (limiter-before-auth, the legacy fused order).
export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/api/desktop-login/create',
    surface: 'api',
    middleware: [desktopLoginRateGuard, activeGuard],
    handler: desktopLoginCreateHandler,
  },
  {
    method: 'POST',
    path: '/api/desktop-login/exchange',
    surface: 'api',
    middleware: [desktopLoginRateGuard],
    handler: desktopLoginExchangeHandler,
  },
];
