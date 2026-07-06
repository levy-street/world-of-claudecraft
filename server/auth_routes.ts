// Auth credential surface, ported onto RouteDefs.
//
// The highest-sensitivity migrated domain: the three
// credential-issuing POST routes move off the inline handleApi ladder in
// server/main.ts onto the shared server/http/ pipeline the registry dispatcher
// serves when API_DISPATCH is 'new':
//   POST /api/register                      create an account, issue a session token
//   POST /api/login                         verify credentials (+ 2FA), issue a token
//   POST /api/native-attestation/challenge  issue a short-lived native-app nonce
//
// It follows the server/leaderboard.ts template exactly:
//  - the handlers are thin Ctx adapters that write the SAME legacy body shapes with
//    the same http_util json() helper, so every ported success/error body is
//    byte-identical to today and the parity harness proves it. The rate-limit 429
//    strings use a comma (the no-em-dash code invariant forbids a U+2014 literal in
//    new code); the legacy handleApi ladder strings were aligned to the same comma,
//    so the bodies are now byte-identical and the former authRateLimitDashToComma
//    known deviation was retired.
//  - the credential checks stay in their exact legacy ORDER, decomposed into small
//    per-route guard middleware so the onion runs them cheap-reject-first (origin
//    guard, IP rate-limit, register IP block) BEFORE withBody parses the body and the
//    shared Turnstile gate runs AFTER it. Login's IP block stays in-handler (checked
//    only after the account is known, so an admin is never locked out) exactly as the
//    legacy arm did.
//  - runtime singletons the handlers need but cannot import without a cycle
//    (game.isIpBlocked, main.ts passesTurnstile, main.ts requestMetadata) are INJECTED
//    once at boot via configureAuthRuntime, so `export const routes` stays a static
//    array registry.ts can spread. The db.ts / account.ts reads+writes and the
//    register side-effects are bundled behind a test seam (setAuthDbForTests) so the
//    handlers are unit-testable against a fake with no Postgres.
//
// Server-authority + language-agnostic: every auth outcome is decided here; the
// English body strings are stable identities the client re-localizes (no t(), no DOM).

import type * as http from 'node:http';
import { verifyLoginTwoFactor } from './account';
import {
  hashPassword,
  MIN_PASSWORD_LENGTH,
  newToken,
  normalizeEmail,
  offensiveName,
  validPassword,
  validUsernameShape,
  verifyPassword,
} from './auth';
import {
  type AccountRow,
  createAccount,
  findAccount,
  isAdminAccount,
  moderationStatusForAccount,
  type RequestMetadata,
  saveToken,
  setAccountEmail,
  touchLogin,
} from './db';
import { emailAccountCreated } from './email';
import { logger } from './http/logger';
import { withBody } from './http/middleware/body';
import { turnstile } from './http/middleware/turnstile';
import type { Ctx, Middleware, RouteDef } from './http/types';
import { isUniqueViolation, json, moderationErrorBody } from './http_util';
import { metaEventSourceUrl, metaRequestUserData, trackAccountCreated } from './meta_capi';
import { createSuspiciousRegistrationReport } from './moderation_db';
import { createNativeAttestationChallenge } from './native_attestation';
import { captureReferral } from './player_card';
import {
  authThrottled,
  clearAuthFailures,
  rateLimited,
  recordAuthFailure,
  requestIp,
} from './ratelimit';
import { isWebClientRequest, webLoginEnforced } from './web_login_guard';

// ---------------------------------------------------------------------------
// Ported response bodies (the exact legacy { error } identities). Named constants
// so the guard middleware and handlers cannot drift and so the ONE dash-to-comma
// divergence is written in exactly one place. The client prose-matcher (src/main.ts
// userFacingApiError) resolves each of these; the two 429 strings match on their
// "too many attempts" / "too many failed attempts" PREFIX, so the comma-for-em-dash
// swap the no-em-dash code invariant forces is matcher-safe and localizes
// identically. The stable machine codes (RFC 9457) ride alongside additively
// (the REST error i18n / client code-matcher).
// ---------------------------------------------------------------------------

const WEB_LOGIN_ONLY = 'logins are only allowed from the game client';
// A comma (the no-em-dash code invariant forbids a U+2014 literal in new code).
// The legacy handleApi ladder strings were aligned to this same comma, so the
// legacy and migrated 429 bodies are now byte-identical. The client matcher keys on
// the prefix, so the localized text is unchanged either way.
const TOO_MANY_ATTEMPTS = 'too many attempts, wait a minute and try again';
const TOO_MANY_FAILED_ATTEMPTS = 'too many failed attempts, wait a few minutes and try again';
const INVALID_CREDENTIALS = 'invalid username or password';
const USERNAME_SHAPE = 'username must be 3-24 chars (letters, digits, _)';
const USERNAME_NOT_ALLOWED = 'username is not allowed';
// The literal derives its bound from MIN_PASSWORD_LENGTH so the message and the
// validator can never disagree (byte-identical to the legacy "at least 6 chars").
const PASSWORD_TOO_SHORT = `password must be at least ${MIN_PASSWORD_LENGTH} chars`;
const USERNAME_TAKEN = 'username already taken';
const INVALID_TWO_FACTOR_CODE = 'invalid authentication code';
// Mandatory signup-email reject (mirrors the legacy /api/register arm; the shape
// gate itself is the shared normalizeEmail in server/auth.ts).
const EMAIL_INVALID = 'enter a valid email address';
// The native-attestation action defaults to 'auth' when the body omits it.
const DEFAULT_ATTESTATION_ACTION = 'auth';

// ---------------------------------------------------------------------------
// Runtime injection. registry.ts spreads the static `routes` array at module load,
// before main.ts has booted the GameServer, so the handlers cannot close over
// `game`/passesTurnstile directly (that would be a cycle: main -> registry ->
// auth_routes -> main). Instead main.ts injects them once at load via
// configureAuthRuntime; a request never arrives before that runs.
// ---------------------------------------------------------------------------

export interface AuthRuntime {
  /** game.isIpBlocked: is this client IP under an active abuse block? */
  isIpBlocked(ip: string): boolean;
  /**
   * main.ts passesTurnstile: a native-app attestation verifies, OR a supplied
   * Turnstile token verifies, OR (dev/test) no secret is configured. The one
   * anti-bot decision, injected whole so this module never re-reads TURNSTILE_SECRET
   * or duplicates the verifier.
   */
  passesTurnstile(req: http.IncomingMessage, body: Record<string, unknown>): Promise<boolean>;
  /** main.ts requestMetadata: the { ip, userAgent } stamped on account writes. */
  requestMetadata(req: http.IncomingMessage): RequestMetadata;
}

let runtime: AuthRuntime | null = null;

/** Inject the main.ts runtime the handlers need. Called once at boot. */
export function configureAuthRuntime(rt: AuthRuntime): void {
  runtime = rt;
}

/** Clear the injected runtime so a unit test can install its own fake. */
export function resetAuthRuntimeForTests(): void {
  runtime = null;
}

/** The injected runtime, or a loud failure if a request somehow beat boot wiring. */
function useRuntime(): AuthRuntime {
  if (runtime === null) {
    throw new Error('auth runtime is not configured; call configureAuthRuntime');
  }
  return runtime;
}

// ---------------------------------------------------------------------------
// Db seam. The db.ts / account.ts reads+writes plus the register side-effects,
// bundled once behind a test-only setter so the handlers can be driven with a fake
// and no Postgres. Production never calls the setter, so REAL_AUTH_DB is the only
// runtime binding, and it references the exact functions the legacy arms call.
// ---------------------------------------------------------------------------

const REAL_AUTH_DB = {
  findAccount,
  createAccount,
  saveToken,
  moderationStatusForAccount,
  isAdminAccount,
  touchLogin,
  setAccountEmail,
  verifyLoginTwoFactor,
  emailAccountCreated,
  createSuspiciousRegistrationReport,
  captureReferral,
  trackAccountCreated,
};
let authDb = REAL_AUTH_DB;

/** Override the auth db + side-effect bundle with a fake (test-only; merges over real). */
export function setAuthDbForTests(overrides: Partial<typeof REAL_AUTH_DB>): void {
  authDb = { ...REAL_AUTH_DB, ...overrides };
}

/** Restore the real auth db bundle after a setAuthDbForTests override (test-only). */
export function resetAuthDbForTests(): void {
  authDb = REAL_AUTH_DB;
}

// ---------------------------------------------------------------------------
// Per-route guard middleware. Each writes the exact legacy { error } body and
// short-circuits (no next()) on rejection, so the onion runs them in legacy order,
// cheap-reject-first, and never changes a body shape. They are LOCAL (credential-
// surface-specific), unlike the shared turnstile middleware.
// ---------------------------------------------------------------------------

// REQUIRE_WEB_LOGIN + isWebClientRequest: register/login must come from a known
// origin. webLoginEnforced() is read LIVE per request (the legacy arm cached it once
// in a module const); this is parity-equivalent because the env is fixed at boot, and
// it keeps the guard unit-testable (a test can flip REQUIRE_WEB_LOGIN after import).
const webLoginGuard: Middleware = async (ctx, next) => {
  if (webLoginEnforced() && !isWebClientRequest(ctx.req)) {
    json(ctx.res, 403, { error: WEB_LOGIN_ONLY, code: 'auth.web_login_only' });
    return;
  }
  await next();
};

/** IP-keyed sliding-window rate limit, BEFORE the body is read or any DB call. */
const ipRateLimitGuard: Middleware = async (ctx, next) => {
  if (!rateLimited(ctx.req).allowed) {
    json(ctx.res, 429, { error: TOO_MANY_ATTEMPTS, code: 'auth.too_many_attempts' });
    return;
  }
  await next();
};

/**
 * Register-only IP block gate. Reuses the rate-limit message so a blocked client
 * gets no signal the block exists. Login gates the block in-handler instead (after
 * the account is known, so an admin verified by password is never locked out).
 */
const registerIpBlockGuard: Middleware = async (ctx, next) => {
  if (useRuntime().isIpBlocked(requestIp(ctx.req))) {
    json(ctx.res, 429, { error: TOO_MANY_ATTEMPTS, code: 'auth.too_many_attempts' });
    return;
  }
  await next();
};

/** The shared Turnstile gate, wired to the injected passesTurnstile. */
const turnstileGuard: Middleware = turnstile({
  verify: (req, body) => useRuntime().passesTurnstile(req, body),
});

// ---------------------------------------------------------------------------
// Handlers (thin Ctx adapters). The guard middleware above has already run in the
// onion, so each handler starts at its first post-Turnstile step, in exact legacy
// order, and writes the legacy-identical body with json().
// ---------------------------------------------------------------------------

/** POST /api/register: validate, create the account, issue a session token. */
async function registerHandler(ctx: Ctx): Promise<void> {
  const rt = useRuntime();
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  if (!validUsernameShape(body.username)) {
    json(ctx.res, 400, { error: USERNAME_SHAPE, code: 'account.username_invalid' });
    return;
  }
  if (offensiveName(body.username)) {
    json(ctx.res, 400, { error: USERNAME_NOT_ALLOWED, code: 'account.username_not_allowed' });
    return;
  }
  if (!validPassword(body.password)) {
    json(ctx.res, 400, { error: PASSWORD_TOO_SHORT, code: 'account.password_too_short' });
    return;
  }
  // Email is mandatory at signup: it is the recovery address that later proves
  // account ownership on a password reset, so we capture it up front (mirrors the
  // legacy arm's check order: after the password gate, before the username lookup).
  const signupEmail = normalizeEmail(body.email);
  if (!signupEmail) {
    json(ctx.res, 400, { error: EMAIL_INVALID, code: 'email.invalid' });
    return;
  }
  const existing = await authDb.findAccount(body.username);
  if (existing) {
    json(ctx.res, 409, { error: USERNAME_TAKEN, code: 'account.username_taken' });
    return;
  }
  const meta = rt.requestMetadata(ctx.req);
  let account: AccountRow;
  try {
    account = await authDb.createAccount(body.username, await hashPassword(body.password), meta);
  } catch (err) {
    // A concurrent registration can win the insert after our findAccount check; the
    // username UNIQUE index is the real guard. Surface it as the same 409, not a 500.
    if (isUniqueViolation(err)) {
      json(ctx.res, 409, { error: USERNAME_TAKEN, code: 'account.username_taken' });
      return;
    }
    throw err;
  }
  const token = newToken();
  await authDb.saveToken(token, account.id);
  // Store the mandatory signup email and send the welcome mail. Validated above,
  // so this always runs for a fresh registration.
  await authDb.setAccountEmail(account.id, signupEmail);
  authDb.emailAccountCreated({
    id: account.id,
    username: account.username,
    email: signupEmail,
    locale: null,
    marketing_opt_in: false,
  });
  // Server-side Meta CAPI conversion event (fire-and-forget; a no-op without
  // META_CAPI env config, and it must never block or fail registration).
  void authDb.trackAccountCreated(
    account.id,
    {
      email: signupEmail,
      // RequestMetadata's fields are nullable; the CAPI reader wants string | undefined.
      ...metaRequestUserData(ctx.req, {
        ip: meta.ip ?? undefined,
        userAgent: meta.userAgent ?? undefined,
      }),
    },
    metaEventSourceUrl(ctx.req),
  );
  void authDb
    .createSuspiciousRegistrationReport({
      accountId: account.id,
      username: account.username,
      ...meta,
    })
    .catch((err) => logger.error({ err }, 'suspicious registration report failed'));
  // Capture the referral when this account signed up via a card link (?ref=<slug>).
  // Best-effort: never block or fail registration on it.
  void authDb
    .captureReferral(account.id, body.ref)
    .catch((err) => logger.error({ err }, 'referral capture failed'));
  // emailMissing is always false here (email is required above); sent so the
  // client can use one uniform post-auth check across register and login.
  json(ctx.res, 200, {
    token,
    username: account.username,
    accountId: account.id,
    emailMissing: false,
  });
}

/** POST /api/login: verify credentials (+ 2FA), gate moderation/IP, issue a token. */
async function loginHandler(ctx: Ctx): Promise<void> {
  const rt = useRuntime();
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const username = typeof body.username === 'string' ? body.username : '';
  // Per-account brute-force throttle (#93). The message matches a bad-password
  // response so it never reveals whether the account exists.
  if (username && !authThrottled(username).allowed) {
    json(ctx.res, 429, { error: TOO_MANY_FAILED_ATTEMPTS, code: 'auth.too_many_failed_attempts' });
    return;
  }
  const account = username ? await authDb.findAccount(username) : null;
  if (!account || !(await verifyPassword(String(body.password ?? ''), account.password_hash))) {
    if (username) recordAuthFailure(username);
    json(ctx.res, 401, { error: INVALID_CREDENTIALS, code: 'auth.invalid_credentials' });
    return;
  }
  const status = await authDb.moderationStatusForAccount(account.id);
  if (status.locked) {
    json(ctx.res, 403, moderationErrorBody(status));
    return;
  }
  // Checked only now the account is known, so admins (verified after the password)
  // are never locked out by an IP block. Reuses the rate-limit message, so a blocked
  // client gets no signal the block exists.
  if (rt.isIpBlocked(requestIp(ctx.req)) && !(await authDb.isAdminAccount(account.id))) {
    json(ctx.res, 429, { error: TOO_MANY_ATTEMPTS, code: 'auth.too_many_attempts' });
    return;
  }
  // Second factor: with 2FA on, the password alone is not enough. With no code we
  // return a challenge (not a token) so the client shows the code step; with a code
  // (or recovery code) we verify it before issuing.
  if (account.totp_enabled_at) {
    const code = typeof body.code === 'string' ? body.code : '';
    const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode : '';
    if (!code && !recoveryCode) {
      json(ctx.res, 200, { twoFactorRequired: true });
      return;
    }
    if (!(await authDb.verifyLoginTwoFactor(account, code, recoveryCode))) {
      recordAuthFailure(username);
      json(ctx.res, 401, {
        error: INVALID_TWO_FACTOR_CODE,
        code: 'two_factor.code_invalid',
        twoFactorRequired: true,
      });
      return;
    }
  }
  clearAuthFailures(username); // correct password: forgive earlier typos
  await authDb.touchLogin(account.id, rt.requestMetadata(ctx.req));
  const token = newToken();
  await authDb.saveToken(token, account.id);
  // Tell the client whether this (possibly pre-email) account still needs a
  // recovery address, so it can force the mandatory-email prompt on sign-in.
  const emailMissing = !(account.email && account.email.trim());
  json(ctx.res, 200, { token, username: account.username, emailMissing });
}

/** POST /api/native-attestation/challenge: issue a short-lived native-app nonce. */
async function challengeHandler(ctx: Ctx): Promise<void> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : DEFAULT_ATTESTATION_ACTION;
  json(ctx.res, 200, createNativeAttestationChallenge(ctx.req, action));
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes. Under API_DISPATCH
// 'new' the registry dispatcher serves these via the onion; the legacy handleApi
// arms stay in main.ts for the flag-off rollback until the ladder-deletion PR (next release).
//
// Middleware order per route is the exact legacy check order, cheap-reject-first:
// origin guard, IP rate-limit, (register) IP block, withBody (parse), Turnstile.
// The native-attestation challenge carries no anti-bot gate (it is the first step a
// native client takes, before it can attest), so it only parses the body.
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/api/register',
    surface: 'api',
    middleware: [webLoginGuard, ipRateLimitGuard, registerIpBlockGuard, withBody(), turnstileGuard],
    handler: registerHandler,
  },
  {
    method: 'POST',
    path: '/api/login',
    surface: 'api',
    middleware: [webLoginGuard, ipRateLimitGuard, withBody(), turnstileGuard],
    handler: loginHandler,
  },
  {
    method: 'POST',
    path: '/api/native-attestation/challenge',
    surface: 'api',
    middleware: [withBody()],
    handler: challengeHandler,
  },
];
