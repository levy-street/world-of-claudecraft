// Account self-service portal: the exported handleAccount* domain handlers plus the
// RouteDef layer that serves them (see the block above `export const routes`).
//
// The domain handlers mirror server/wallet.ts: each is an exported, account-scoped
// function with a real http (req, res) signature, so tests/account_server.test.ts can
// drive every branch through the mock-pg harness with no live database. A thin
// RouteDef layer of 16 routes rides below, served by the shared
// server/http/ pipeline under API_DISPATCH 'new'; each self-resolves its bearer via a
// per-route guard (activeGuard/logoutGuard), except the two token-in-query link routes
// (email/verify, email/unsubscribe) which carry no auth. main.ts resolves the bearer
// only on the KEPT legacy rollback arms, and the route layer adds module-private
// test/runtime seams (setAccountDbForTests, configureAccountRuntime).
import type http from 'node:http';
import {
  hashPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  newToken,
  normalizeEmail,
  verifyPassword,
} from './auth';
import {
  type AccountRow,
  accountAndScopeForToken,
  accountById,
  accountByUnsubscribeToken,
  accountForToken,
  accountMailTarget,
  accountTwoFactorEnabled,
  backfillAccountEmailIfEmpty,
  characterCountForAccount,
  claimTotpWindow,
  consumeEmailChangeRequest,
  consumePasswordResetRequest,
  consumeRecoveryCode,
  createCompanionToken,
  createEmailChangeRequest,
  createPasswordResetRequest,
  disableTotp,
  enableTotp,
  ensureUnsubscribeToken,
  exportAccountData,
  findAccount,
  getTotpState,
  listCharacters,
  listCompanionTokens,
  moderationStatusForAccount,
  revokeCompanionToken,
  revokeToken,
  revokeTokensExcept,
  scopeAllowsMutation,
  setAccountDeactivated,
  setAccountMarketingOptIn,
  setTotpPending,
  updatePasswordHash,
} from './db';
import {
  emailAccountDeleted,
  emailChangeVerifyUrl,
  emailDataExport,
  emailEmailChangeRequested,
  emailPasswordChanged,
  emailPasswordReset,
  emailTwoFactorDisabled,
  emailTwoFactorEnabled,
  hashEmailToken,
  makeEmailToken,
  passwordResetUrl,
} from './email';
import { ctxAccountId } from './http/context';
import type { Ctx, Middleware, RouteDef } from './http/types';
import { json, moderationErrorBody, readBody } from './http_util';
import { clearAuthFailures, rateLimited, recordAuthFailure } from './ratelimit';
import {
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  otpauthUri,
  verifyTotp,
} from './totp';

// Issuer label shown in the user's authenticator app next to the 6-digit code.
const TOTP_ISSUER = 'World of ClaudeCraft';

// How long an email-change verification link stays valid.
const EMAIL_CHANGE_TTL_HOURS = 24;
// How long a password-reset link stays valid. Shorter than the email-change TTL:
// a reset is higher-value and the user acts on it immediately.
const PASSWORD_RESET_TTL_HOURS = 1;

// Hooks main.ts injects so the deactivate path can consult and tear down live
// game sessions without account.ts importing the GameServer (which pulls in the
// browser-free sim + ws stack and is awkward to construct in a unit test).
export interface AccountGameHooks {
  /** True when any of the account's characters is currently in a live session. */
  anyCharacterOnline(characterIds: number[]): boolean;
  /** Close any established socket for the account right after deactivation. */
  disconnectAccount(accountId: number, reason: string): void;
}

// GET /api/account: whoami; re-validates a stored token on reload + feeds the
// portal header. characterCount is account-wide (every realm), matching the
// account-wide nature of this self-service portal.
export async function handleAccountWhoami(
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  const acct = await accountById(accountId);
  if (!acct) return json(res, 404, { error: 'account not found', code: 'account.not_found' });
  const characterCount = await characterCountForAccount(accountId);
  const twoFactorEnabled = await accountTwoFactorEnabled(accountId);
  return json(res, 200, {
    username: acct.username,
    email: acct.email ?? '',
    // True when the account has no recovery address yet: the client uses this to
    // force the mandatory-email prompt (e.g. on a restored session that skipped
    // the login response's emailMissing flag).
    emailMissing: !(acct.email && acct.email.trim()),
    createdAt: acct.created_at,
    characterCount,
    twoFactorEnabled,
  });
}

// POST /api/account/password: re-verify current, then revoke every OTHER token
// so a password change signs out other devices while keeping this one alive.
// callerToken is resolved by main.ts; it must never be null here (validated up
// the stack) so the revoke below can never accidentally nuke this session.
export async function handleAccountChangePassword(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
  callerToken: string,
): Promise<void> {
  if (!rateLimited(req).allowed) return json(res, 429, { error: 'too many attempts, slow down' });
  const body = await readBody(req);
  const acct = await accountById(accountId);
  if (!acct) return json(res, 404, { error: 'account not found', code: 'account.not_found' });
  if (!(await verifyPassword(String(body.current ?? ''), acct.password_hash))) {
    recordAuthFailure(acct.username);
    return json(res, 401, {
      error: 'current password is incorrect',
      code: 'auth.current_password_incorrect',
    });
  }
  // Correct password: forgive earlier portal mis-types so a re-verify here never
  // throttles the user's own subsequent login. Mirrors the login success path.
  clearAuthFailures(acct.username);
  const next = body.next;
  if (typeof next !== 'string' || next.length < MIN_PASSWORD_LENGTH) {
    return json(res, 400, {
      error: `password must be at least ${MIN_PASSWORD_LENGTH} chars`,
      code: 'account.password_too_short',
    });
  }
  if (next.length > MAX_PASSWORD_LENGTH) {
    return json(res, 400, {
      error: `password must be at most ${MAX_PASSWORD_LENGTH} chars`,
      code: 'account.password_too_long',
    });
  }
  await updatePasswordHash(accountId, await hashPassword(next));
  await revokeTokensExcept(accountId, callerToken);
  // Best-effort security notice; never blocks the password change on mail state.
  emailPasswordChanged(acct);
  return json(res, 200, { ok: true });
}

// Unauthenticated: begin a self-service password reset. Identify by username, look
// up the account's on-file email, and mail a reset link if there is one. ALWAYS
// returns 200 with an identical body on every path (unknown user, known-but-no
// email, success), so the status/body never reveal whether an account exists (anti
// enumeration, mirroring handleEmailUnsubscribe). The email send is fire-and-forget
// so its latency does not leak either; only the count of DB round-trips differs by
// path, the same best-effort timing posture the rest of the account routes accept.
// An account with no email on file simply cannot self-reset (still 200): those
// users recover via Discord or an admin.
export async function handleAccountPasswordForgot(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (!rateLimited(req).allowed) return json(res, 429, { error: 'too many attempts, slow down' });
  const body = await readBody(req);
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  if (username) {
    const acct = await findAccount(username);
    if (acct) {
      const target = await accountMailTarget(acct.id);
      if (target?.email) {
        const { token, tokenHash } = makeEmailToken();
        await createPasswordResetRequest(acct.id, tokenHash, PASSWORD_RESET_TTL_HOURS);
        emailPasswordReset(target, passwordResetUrl(token));
      }
    }
  }
  return json(res, 200, { ok: true });
}

// Unauthenticated: complete a reset with the emailed token + a new password. The
// token is validated, the new password applied, and every session revoked, all in
// one atomic DB call. Invalid and expired tokens return the same 400 so neither a
// bad guess nor an old link reveals anything.
export async function handleAccountPasswordReset(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (!rateLimited(req).allowed) return json(res, 429, { error: 'too many attempts, slow down' });
  const body = await readBody(req);
  const raw = typeof body.token === 'string' ? body.token.trim() : '';
  const next = body.next;
  if (!raw) return json(res, 400, { error: 'invalid or expired link' });
  if (typeof next !== 'string' || next.length < MIN_PASSWORD_LENGTH) {
    return json(res, 400, { error: `password must be at least ${MIN_PASSWORD_LENGTH} chars` });
  }
  if (next.length > MAX_PASSWORD_LENGTH) {
    return json(res, 400, { error: `password must be at most ${MAX_PASSWORD_LENGTH} chars` });
  }
  const applied = await consumePasswordResetRequest(hashEmailToken(raw), await hashPassword(next));
  if (!applied) return json(res, 400, { error: 'invalid or expired link' });
  // Best-effort "your password changed" notice; never blocks the reset on mail state.
  const target = await accountMailTarget(applied.accountId);
  if (target) emailPasswordChanged(target);
  return json(res, 200, { ok: true });
}

// POST /api/account/logout: revoke this device's bearer token. Unlike the
// other account routes this does not need an active account gate; banned,
// suspended, or deactivated accounts should still be able to sign out locally
// and invalidate the token held by this browser.
export async function handleAccountLogout(
  res: http.ServerResponse,
  callerToken: string,
): Promise<void> {
  await revokeToken(callerToken);
  return json(res, 200, { ok: true });
}

// POST /api/account/email: legacy email setter. Recovery email is a security
// address now, so it can only change through /api/account/email/change with a
// password re-check and verification link.
export async function handleAccountSetEmail(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _accountId: number,
): Promise<void> {
  return json(res, 410, { error: 'use verified email change' });
}

// POST /api/account/email/set-initial: set the recovery email on an account that
// has NONE yet. This is the mandatory-email backfill for accounts created before
// email was required (and the fallback when a Discord login returned no address).
// The bearer session IS the authorization: the caller just proved the password
// (or a Discord grant) at login and there is no existing recovery address to
// protect, so unlike the verified change flow it needs no password re-check. Once
// an address exists it is a security address and can only move through
// /api/account/email/change; calling this then is a 409.
export async function handleAccountSetInitialEmail(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (!rateLimited(req).allowed) return json(res, 429, { error: 'too many attempts, slow down' });
  const body = await readBody(req);
  const acct = await accountById(accountId);
  if (!acct) return json(res, 404, { error: 'account not found', code: 'account.not_found' });
  if (acct.email && acct.email.trim()) {
    return json(res, 409, { error: 'use verified email change' });
  }
  const email = normalizeEmail(body.email);
  if (!email)
    return json(res, 400, { error: 'enter a valid email address', code: 'email.invalid' });
  // Atomic fill (the guard lives in the UPDATE's WHERE), so two concurrent
  // set-initial calls, or one racing a Discord capture, cannot both write past the
  // empty-email check above. The address is self-asserted here, so it is stored
  // UNVERIFIED (verified=false). A false return means a concurrent writer already
  // set an address: treat it exactly like the already-set case.
  const filled = await backfillAccountEmailIfEmpty(accountId, email, false);
  if (!filled) return json(res, 409, { error: 'use verified email change' });
  return json(res, 200, { ok: true, email });
}

// POST /api/account/deactivate: re-confirm password + username, require all
// characters offline, then lock the account and revoke ALL tokens. The lock is
// reversible by an admin. After locking we deterministically tear down any
// established socket (revoking tokens alone does not close an open WS).
export async function handleAccountDeactivate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
  hooks: AccountGameHooks,
): Promise<void> {
  if (!rateLimited(req).allowed) return json(res, 429, { error: 'too many attempts, slow down' });
  const body = await readBody(req);
  const acct = await accountById(accountId);
  if (!acct) return json(res, 404, { error: 'account not found', code: 'account.not_found' });
  if (String(body.username ?? '') !== acct.username) {
    return json(res, 400, { error: 'username does not match', code: 'account.username_mismatch' });
  }
  if (!(await verifyPassword(String(body.password ?? ''), acct.password_hash))) {
    recordAuthFailure(acct.username);
    return json(res, 401, { error: 'password is incorrect', code: 'auth.password_incorrect' });
  }
  // Correct password: forgive earlier portal mis-types so a re-verify here never
  // throttles the user's own subsequent login. Mirrors the login success path.
  clearAuthFailures(acct.username);
  const chars = await listCharacters(accountId);
  if (hooks.anyCharacterOnline(chars.map((c) => c.id))) {
    return json(res, 409, {
      error: 'log out all characters before deactivating',
      code: 'account.characters_online',
    });
  }
  await setAccountDeactivated(accountId, true);
  await revokeTokensExcept(accountId, null);
  hooks.disconnectAccount(accountId, 'This account has been deactivated.');
  emailAccountDeleted(acct);
  return json(res, 200, { ok: true });
}

// POST /api/account/email/change: request a verified email change. Re-confirms
// the current password (this swaps the account's recovery address, so it must
// not ride a bare session), then mails a one-time verify link to the NEW address
// and a security notice to the OLD one. The address only changes on verify.
export async function handleAccountEmailChange(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (!rateLimited(req).allowed) return json(res, 429, { error: 'too many attempts, slow down' });
  const body = await readBody(req);
  const acct = await accountById(accountId);
  if (!acct) return json(res, 404, { error: 'account not found', code: 'account.not_found' });
  if (!(await verifyPassword(String(body.password ?? ''), acct.password_hash))) {
    recordAuthFailure(acct.username);
    return json(res, 401, { error: 'password is incorrect', code: 'auth.password_incorrect' });
  }
  clearAuthFailures(acct.username);
  const newEmail = normalizeEmail(body.newEmail);
  if (!newEmail) {
    return json(res, 400, { error: 'enter a valid email address', code: 'email.invalid' });
  }
  if (newEmail.toLowerCase() === (acct.email ?? '').toLowerCase()) {
    return json(res, 400, { error: 'that is already your email address', code: 'email.unchanged' });
  }
  const { token, tokenHash } = makeEmailToken();
  await createEmailChangeRequest(accountId, newEmail, tokenHash, EMAIL_CHANGE_TTL_HOURS);
  emailEmailChangeRequested(acct, newEmail, emailChangeVerifyUrl(token));
  return json(res, 200, { ok: true });
}

// GET /api/account/email/verify?token=... consume a one-time email-change
// token. Unauthenticated by design: the unguessable token IS the authorization,
// and the consume is race-safe in the DB layer. No token info leaks: invalid and
// expired both return the same 400.
export async function handleAccountEmailVerify(
  res: http.ServerResponse,
  token: string,
): Promise<void> {
  const raw = typeof token === 'string' ? token.trim() : '';
  if (!raw) return json(res, 400, { error: 'invalid or expired link' });
  const applied = await consumeEmailChangeRequest(hashEmailToken(raw));
  if (!applied) return json(res, 400, { error: 'invalid or expired link' });
  return json(res, 200, { ok: true, email: applied.newEmail });
}

// POST /api/account/export: GDPR-style self-service data export. Returns the
// account profile plus every character it owns as a JSON download, and mails a
// confirmation so an export the user did not request is noticed.
export async function handleAccountExport(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (!rateLimited(req).allowed) return json(res, 429, { error: 'too many attempts, slow down' });
  const bundle = await exportAccountData(accountId);
  if (!bundle) return json(res, 404, { error: 'account not found', code: 'account.not_found' });
  const acct = await accountById(accountId);
  if (acct) emailDataExport(acct);
  res.writeHead(200, {
    'content-type': 'application/json',
    'content-disposition': 'attachment; filename="woc-account-export.json"',
  });
  return void res.end(JSON.stringify(bundle, null, 2));
}

// POST /api/account/marketing: set the marketing opt-in flag. Opting in mints a
// stable unsubscribe token so every future marketing email can carry a working
// one-click unsubscribe link.
export async function handleAccountMarketing(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (!rateLimited(req).allowed) return json(res, 429, { error: 'too many attempts, slow down' });
  const body = await readBody(req);
  const optIn = body.optIn === true;
  await setAccountMarketingOptIn(accountId, optIn);
  if (optIn) await ensureUnsubscribeToken(accountId, makeEmailToken().token);
  return json(res, 200, { optIn });
}

// ── Two-factor auth (TOTP) ──────────────────────────────────────────────────
//
// Enrolment is two steps so a misconfigured authenticator can never lock anyone
// out: setup mints a PENDING secret (not yet enforced) and returns its QR URI;
// enable confirms a live code, promotes the secret, and only THEN mints recovery
// codes. Both setup and disable re-verify the password (mirrors the password and
// deactivate handlers): a bare session is not enough to change the second factor.

// POST /api/account/2fa/setup: password re-verify, then return a pending secret
// + otpauth URI for the user to scan. Idempotent: re-running before enabling just
// supersedes the previous pending secret.
export async function handleAccount2faSetup(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (!rateLimited(req).allowed) return json(res, 429, { error: 'too many attempts, slow down' });
  const body = await readBody(req);
  const acct = await accountById(accountId);
  if (!acct) return json(res, 404, { error: 'account not found', code: 'account.not_found' });
  if (!(await verifyPassword(String(body.password ?? ''), acct.password_hash))) {
    recordAuthFailure(acct.username);
    return json(res, 401, { error: 'password is incorrect', code: 'auth.password_incorrect' });
  }
  clearAuthFailures(acct.username);
  const state = await getTotpState(accountId);
  if (state?.enabledAt)
    return json(res, 409, {
      error: 'two-factor is already enabled',
      code: 'two_factor.already_enabled',
    });
  const secret = generateSecret();
  await setTotpPending(accountId, secret);
  return json(res, 200, { secret, otpauthUri: otpauthUri(secret, acct.username, TOTP_ISSUER) });
}

// POST /api/account/2fa/enable: confirm a live code against the pending secret,
// activate 2FA, and return the one-time recovery codes (shown to the user once).
export async function handleAccount2faEnable(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
  now: number = Date.now(),
): Promise<void> {
  if (!rateLimited(req).allowed) return json(res, 429, { error: 'too many attempts, slow down' });
  const body = await readBody(req);
  const state = await getTotpState(accountId);
  if (!state) return json(res, 404, { error: 'account not found', code: 'account.not_found' });
  if (state.enabledAt)
    return json(res, 409, {
      error: 'two-factor is already enabled',
      code: 'two_factor.already_enabled',
    });
  if (!state.pendingSecret) {
    return json(res, 400, {
      error: 'start two-factor setup first',
      code: 'two_factor.setup_required',
    });
  }
  const code = String(body.code ?? '');
  if (verifyTotp(state.pendingSecret, code, now) === null) {
    return json(res, 400, {
      error: 'that code is not valid, try again',
      code: 'two_factor.code_invalid',
    });
  }
  const recoveryCodes = generateRecoveryCodes();
  await enableTotp(accountId, state.pendingSecret, recoveryCodes.map(hashRecoveryCode));
  const acct = await accountById(accountId);
  if (acct) emailTwoFactorEnabled(acct, recoveryCodes.length);
  return json(res, 200, { ok: true, recoveryCodes });
}

// POST /api/account/2fa/disable: password re-verify, then clear the secret and
// all recovery codes. Best-effort security notice email.
export async function handleAccount2faDisable(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (!rateLimited(req).allowed) return json(res, 429, { error: 'too many attempts, slow down' });
  const body = await readBody(req);
  const acct = await accountById(accountId);
  if (!acct) return json(res, 404, { error: 'account not found', code: 'account.not_found' });
  if (!(await verifyPassword(String(body.password ?? ''), acct.password_hash))) {
    recordAuthFailure(acct.username);
    return json(res, 401, { error: 'password is incorrect', code: 'auth.password_incorrect' });
  }
  clearAuthFailures(acct.username);
  const state = await getTotpState(accountId);
  if (!state?.enabledAt)
    return json(res, 400, { error: 'two-factor is not enabled', code: 'two_factor.not_enabled' });
  await disableTotp(accountId);
  emailTwoFactorDisabled(acct);
  return json(res, 200, { ok: true });
}

// Login-time second-factor check, shared by the /api/login handler. Accepts a
// live TOTP code (replay-guarded: a code is good for at most one login inside its
// 30s window) OR a single-use recovery code. Returns true on success. Never
// throws: any unexpected state resolves to a denied second factor.
export async function verifyLoginTwoFactor(
  account: AccountRow,
  code: string,
  recoveryCode: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (code && account.totp_secret) {
    const matched = verifyTotp(account.totp_secret, code, now);
    if (matched === null) return false;
    const last = account.totp_last_window;
    const lastNum = last === null || last === undefined ? null : Number(last);
    if (lastNum !== null && matched <= lastNum) return false; // fast-path replay reject
    // Atomic claim closes the concurrent-login window: only one request can move
    // the counter to `matched`, so the same code cannot be accepted twice.
    return claimTotpWindow(account.id, matched);
  }
  if (recoveryCode) {
    return consumeRecoveryCode(account.id, hashRecoveryCode(recoveryCode));
  }
  return false;
}

// GET /api/email/unsubscribe?token=... public one-click marketing unsubscribe.
// Honours the token without a login (mail clients cannot send bearer auth) and
// never reveals whether the token matched, to avoid token probing.
export async function handleEmailUnsubscribe(
  res: http.ServerResponse,
  token: string,
): Promise<void> {
  const raw = typeof token === 'string' ? token.trim() : '';
  if (raw) {
    const accountId = await accountByUnsubscribeToken(raw);
    if (accountId !== null) await setAccountMarketingOptIn(accountId, false);
  }
  return json(res, 200, { ok: true });
}

// ===========================================================================
// Route layer, ported onto RouteDefs.
//
// The account-portal endpoints move off the inline handleApi ladder in
// server/main.ts onto the shared server/http/ pipeline the registry dispatcher
// serves when API_DISPATCH is 'new'. It follows the server/characters.ts +
// server/auth_routes.ts template:
//  - the handlers are THIN Ctx adapters that resolve the bearer, then call the
//    existing handleAccount* domain functions above UNCHANGED. Those functions
//    write the SAME legacy { error } / success bodies with the same http_util
//    json() helper, so every ported response is byte-identical to today and the
//    parity harness proves it. These bodies are deliberately NOT problem+json:
//    the client prose-matcher (src/main.ts userFacingApiError) keys on
//    them, so a migrated route MUST keep the legacy prose body.
//  - the bearer + moderation gate is a per-route guard middleware (activeGuard)
//    that mirrors the legacy bearerActiveAccount resolver and writes the legacy
//    { error } bodies, NOT the generic requireAccount middleware (which throws a
//    problem+json HttpError and would break the goldens and the prose-matcher).
//    Logout has its OWN guard (logoutGuard): a banned/suspended/deactivated
//    account must still be able to sign out, so it validates only that the token
//    maps to an account, with no scope or moderation gate (mirrors the legacy arm).
//  - the account handlers self-read their body with readBody, so NO withBody
//    middleware is composed (that would double-consume the stream). A malformed or
//    over-cap body therefore throws inside readBody and surfaces as a 500 through
//    the shared error boundary (the accountBodyValidationRemap known deviation).
//  - the deactivate route needs the live game session (to refuse deactivation
//    while a character is online and to disconnect the account afterwards); that
//    singleton is INJECTED once at boot via configureAccountRuntime, so
//    `export const routes` stays a static array registry.ts can spread. The db.ts
//    reads the guards + companion-token handlers use are bundled behind
//    setAccountDbForTests so they are unit-testable with a fake and no Postgres.
// ===========================================================================

// The exact legacy { error } identities the guards emit. Named constants so the
// guards cannot drift from the bearerActiveAccount / logout arms they mirror. No
// em dash appears in any of these (the legacy account strings never used one).
const NOT_AUTHENTICATED = { error: 'not authenticated', code: 'auth.required' } as const;
const READ_ONLY_TOKEN = { error: 'this token is read-only', code: 'auth.forbidden' } as const;
const COMPANION_TOKEN_NOT_FOUND = { error: 'token not found' } as const;

// The bearer token shape: a 64-hex secret behind the "Bearer " scheme. Mirrors
// the regex the legacy bearer* resolvers in server/main.ts use.
const BEARER_PATTERN = /^Bearer ([a-f0-9]{64})$/;

// Companion read-only token lifetime: 90 days (mirrors the legacy inline const in
// the main.ts companion-token arm; a MOVE of the named constant, not a new literal).
const COMPANION_TOKEN_TTL_HOURS = 24 * 90;
// The companion secret is minted with scope 'read' and reported as 90 days on
// creation, exactly as the legacy arm returned it.
const COMPANION_TOKEN_SCOPE = 'read';
const COMPANION_TOKEN_EXPIRES_IN_DAYS = 90;

// ---------------------------------------------------------------------------
// Runtime injection. registry.ts spreads the static `routes` array at module
// load, before main.ts has booted the GameServer, so the deactivate handler
// cannot close over `game` directly (that would be a cycle: main -> registry ->
// account -> main). Instead main.ts injects the live session hooks once at boot
// via configureAccountRuntime; a request never arrives before that runs. The
// hooks are the exact AccountGameHooks handleAccountDeactivate already takes.
// ---------------------------------------------------------------------------

let runtime: AccountGameHooks | null = null;

/** Inject the main.ts game-session hooks the deactivate handler needs (boot). */
export function configureAccountRuntime(rt: AccountGameHooks): void {
  runtime = rt;
}

/** Clear the injected runtime so a unit test can install its own fake. */
export function resetAccountRuntimeForTests(): void {
  runtime = null;
}

/** The injected runtime, or a loud failure if a request somehow beat boot wiring. */
function useRuntime(): AccountGameHooks {
  if (runtime === null) {
    throw new Error('account runtime is not configured; call configureAccountRuntime');
  }
  return runtime;
}

// ---------------------------------------------------------------------------
// Db seam. The bearer-resolution + companion-token reads/writes, bundled once
// behind a test-only setter so the guards and companion handlers can be driven
// with a fake and no Postgres. Production never calls the setter, so
// REAL_ACCOUNT_DB is the only runtime binding and it references the exact
// functions the legacy arms call. scopeAllowsMutation is pure (no DB), so it
// stays a direct import rather than a seam member. The handleAccount* domain
// functions keep their own direct db.ts imports (driven by the existing
// account_server.test.ts pg-mock harness); this seam covers only the NEW code.
// ---------------------------------------------------------------------------

const REAL_ACCOUNT_DB = {
  accountAndScopeForToken,
  accountForToken,
  moderationStatusForAccount,
  createCompanionToken,
  listCompanionTokens,
  revokeCompanionToken,
};
let accountDb = REAL_ACCOUNT_DB;

/** Override the account db bundle with a fake (test-only; merges over the real reads). */
export function setAccountDbForTests(overrides: Partial<typeof REAL_ACCOUNT_DB>): void {
  accountDb = { ...REAL_ACCOUNT_DB, ...overrides };
}

/** Restore the real account db bundle after a setAccountDbForTests override (test-only). */
export function resetAccountDbForTests(): void {
  accountDb = REAL_ACCOUNT_DB;
}

// ---------------------------------------------------------------------------
// Bearer helpers + guards. activeGuard mirrors bearerActiveAccount (full-session,
// read-only 403, moderation 403); logoutGuard mirrors the logout arm (any token
// that still maps to an account, no scope or moderation gate). Both write the
// legacy { error } bodies and short-circuit (no next()) on rejection, and a
// missing/malformed bearer 401s WITHOUT a DB call (so the no-auth goldens replay
// DB-free through both dispatch paths).
// ---------------------------------------------------------------------------

/** The raw 64-hex bearer token, or null (no header or bad shape). */
function bearerToken(req: http.IncomingMessage): string | null {
  const m = BEARER_PATTERN.exec(req.headers.authorization ?? '');
  return m ? m[1] : null;
}

/** Resolve the bearer to { accountId, scope }, or null (no header, bad shape, unknown). */
async function resolveBearerScope(
  req: http.IncomingMessage,
): Promise<{ accountId: number; scope: 'read' | 'full' } | null> {
  const token = bearerToken(req);
  if (token === null) return null;
  return accountDb.accountAndScopeForToken(token);
}

/** Mutating + account-scoped gate (mirrors server/main.ts bearerActiveAccount). */
const activeGuard: Middleware = async (ctx, next) => {
  const info = await resolveBearerScope(ctx.req);
  if (info === null) {
    json(ctx.res, 401, NOT_AUTHENTICATED);
    return;
  }
  if (!scopeAllowsMutation(info.scope)) {
    json(ctx.res, 403, READ_ONLY_TOKEN);
    return;
  }
  const status = await accountDb.moderationStatusForAccount(info.accountId);
  if (status.locked) {
    json(ctx.res, 403, moderationErrorBody(status));
    return;
  }
  ctx.account = { accountId: info.accountId, scope: info.scope };
  await next();
};

/**
 * Logout gate (mirrors the legacy /api/account/logout arm): any bearer token that
 * still maps to an account may proceed, with NO scope or moderation gate, so a
 * banned/suspended/deactivated account can still sign out this device. A missing
 * token 401s DB-free; a present-but-unknown token 401s after the accountForToken
 * lookup, exactly as the legacy arm did.
 */
const logoutGuard: Middleware = async (ctx, next) => {
  const token = bearerToken(ctx.req);
  if (token === null || (await accountDb.accountForToken(token)) === null) {
    json(ctx.res, 401, NOT_AUTHENTICATED);
    return;
  }
  await next();
};

// ---------------------------------------------------------------------------
// Thin Ctx handlers. Each starts after its guard has run, resolves the account /
// caller token from the Ctx, and delegates to the matching handleAccount* domain
// function above UNCHANGED (so the response bytes are identical to the legacy arm).
// ---------------------------------------------------------------------------

/** GET /api/account: whoami. */
async function whoamiHandler(ctx: Ctx): Promise<void> {
  return handleAccountWhoami(ctx.res, ctxAccountId(ctx));
}

/** POST /api/account/password: re-verify + rotate password, keeping this session alive. */
async function passwordHandler(ctx: Ctx): Promise<void> {
  const callerToken = bearerToken(ctx.req);
  // activeGuard already validated a full-scope Bearer header, so callerToken is
  // non-null here; the guard mirrors the legacy arm's explicit 401 fallback.
  if (callerToken === null) {
    json(ctx.res, 401, NOT_AUTHENTICATED);
    return;
  }
  return handleAccountChangePassword(ctx.req, ctx.res, ctxAccountId(ctx), callerToken);
}

/** POST /api/account/logout: revoke this device's bearer token. */
async function logoutHandler(ctx: Ctx): Promise<void> {
  const callerToken = bearerToken(ctx.req);
  // logoutGuard already validated the token maps to an account; re-guard for tsc.
  if (callerToken === null) {
    json(ctx.res, 401, NOT_AUTHENTICATED);
    return;
  }
  return handleAccountLogout(ctx.res, callerToken);
}

/** POST /api/account/email: the retired setter (410 use verified change). */
async function setEmailHandler(ctx: Ctx): Promise<void> {
  return handleAccountSetEmail(ctx.req, ctx.res, ctxAccountId(ctx));
}

/** POST /api/account/deactivate: re-confirm, require offline, lock + disconnect. */
async function deactivateHandler(ctx: Ctx): Promise<void> {
  return handleAccountDeactivate(ctx.req, ctx.res, ctxAccountId(ctx), useRuntime());
}

/** POST /api/account/email/change: request a verified email change. */
async function emailChangeHandler(ctx: Ctx): Promise<void> {
  return handleAccountEmailChange(ctx.req, ctx.res, ctxAccountId(ctx));
}

/** POST /api/account/email/set-initial: fill the recovery email on a pre-email account. */
async function emailSetInitialHandler(ctx: Ctx): Promise<void> {
  return handleAccountSetInitialEmail(ctx.req, ctx.res, ctxAccountId(ctx));
}

/** GET /api/account/email/verify: consume a one-time email-change token (unauthenticated). */
async function emailVerifyHandler(ctx: Ctx): Promise<void> {
  const token = ctx.url.searchParams.get('token') ?? '';
  return handleAccountEmailVerify(ctx.res, token);
}

/** POST /api/account/export: GDPR-style self-service data export. */
async function exportHandler(ctx: Ctx): Promise<void> {
  return handleAccountExport(ctx.req, ctx.res, ctxAccountId(ctx));
}

/** POST /api/account/marketing: set the marketing opt-in flag. */
async function marketingHandler(ctx: Ctx): Promise<void> {
  return handleAccountMarketing(ctx.req, ctx.res, ctxAccountId(ctx));
}

/** POST /api/account/2fa/setup: password re-verify, mint a pending TOTP secret. */
async function twoFaSetupHandler(ctx: Ctx): Promise<void> {
  return handleAccount2faSetup(ctx.req, ctx.res, ctxAccountId(ctx));
}

/** POST /api/account/2fa/enable: confirm a code, activate 2FA, return recovery codes. */
async function twoFaEnableHandler(ctx: Ctx): Promise<void> {
  return handleAccount2faEnable(ctx.req, ctx.res, ctxAccountId(ctx));
}

/** POST /api/account/2fa/disable: password re-verify, clear the second factor. */
async function twoFaDisableHandler(ctx: Ctx): Promise<void> {
  return handleAccount2faDisable(ctx.req, ctx.res, ctxAccountId(ctx));
}

/**
 * POST /api/account/companion-token: mint a 90-day read-only companion token.
 * Ported byte-for-byte from the legacy inline arm (self-reads the body; the full
 * secret is returned ONCE, on creation).
 */
async function companionCreateHandler(ctx: Ctx): Promise<void> {
  const accountId = ctxAccountId(ctx);
  const body = await readBody(ctx.req);
  const rawLabel = typeof body.label === 'string' ? body.label.trim().slice(0, 64) : '';
  const label = rawLabel || null;
  const token = newToken();
  await accountDb.createCompanionToken(token, accountId, label, COMPANION_TOKEN_TTL_HOURS);
  return json(ctx.res, 200, {
    token,
    label,
    scope: COMPANION_TOKEN_SCOPE,
    expiresInDays: COMPANION_TOKEN_EXPIRES_IN_DAYS,
  });
}

/** GET /api/account/companion-token: list the account's companion tokens (no secrets). */
async function companionListHandler(ctx: Ctx): Promise<void> {
  return json(ctx.res, 200, { tokens: await accountDb.listCompanionTokens(ctxAccountId(ctx)) });
}

/** DELETE /api/account/companion-token: revoke a companion token by prefix. */
async function companionRevokeHandler(ctx: Ctx): Promise<void> {
  const accountId = ctxAccountId(ctx);
  const body = await readBody(ctx.req);
  const prefix = typeof body.prefix === 'string' ? body.prefix.trim().toLowerCase() : '';
  const ok = await accountDb.revokeCompanionToken(accountId, prefix);
  return json(ctx.res, ok ? 200 : 404, ok ? { ok: true } : COMPANION_TOKEN_NOT_FOUND);
}

/** GET /api/email/unsubscribe: public one-click marketing unsubscribe (unauthenticated). */
async function unsubscribeHandler(ctx: Ctx): Promise<void> {
  const token = ctx.url.searchParams.get('token') ?? '';
  return handleEmailUnsubscribe(ctx.res, token);
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes. Under API_DISPATCH
// 'new' the registry dispatcher serves these via the onion; the legacy handleApi
// arms stay in main.ts for the flag-off rollback until the ladder-deletion PR. All routes carry
// [activeGuard] EXCEPT: logout (logoutGuard: sign-out survives moderation locks)
// and the two token-in-query link routes email/verify + email/unsubscribe (no
// auth). companion-token is THREE method-specific RouteDefs (the legacy arm fanned
// POST/GET/DELETE inside one method-agnostic block; an unsupported method now
// answers 405 + Allow before auth, the companionTokenMethodFan known deviation).
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/account',
    surface: 'api',
    middleware: [activeGuard],
    handler: whoamiHandler,
  },
  {
    method: 'POST',
    path: '/api/account/password',
    surface: 'api',
    middleware: [activeGuard],
    handler: passwordHandler,
  },
  {
    method: 'POST',
    path: '/api/account/logout',
    surface: 'api',
    middleware: [logoutGuard],
    handler: logoutHandler,
  },
  {
    method: 'POST',
    path: '/api/account/email',
    surface: 'api',
    middleware: [activeGuard],
    handler: setEmailHandler,
  },
  {
    method: 'POST',
    path: '/api/account/deactivate',
    surface: 'api',
    middleware: [activeGuard],
    handler: deactivateHandler,
  },
  {
    method: 'POST',
    path: '/api/account/companion-token',
    surface: 'api',
    middleware: [activeGuard],
    handler: companionCreateHandler,
  },
  {
    method: 'GET',
    path: '/api/account/companion-token',
    surface: 'api',
    middleware: [activeGuard],
    handler: companionListHandler,
  },
  {
    method: 'DELETE',
    path: '/api/account/companion-token',
    surface: 'api',
    middleware: [activeGuard],
    handler: companionRevokeHandler,
  },
  {
    method: 'POST',
    path: '/api/account/email/change',
    surface: 'api',
    middleware: [activeGuard],
    handler: emailChangeHandler,
  },
  {
    method: 'POST',
    path: '/api/account/email/set-initial',
    surface: 'api',
    middleware: [activeGuard],
    handler: emailSetInitialHandler,
  },
  { method: 'GET', path: '/api/account/email/verify', surface: 'api', handler: emailVerifyHandler },
  {
    method: 'POST',
    path: '/api/account/export',
    surface: 'api',
    middleware: [activeGuard],
    handler: exportHandler,
  },
  {
    method: 'POST',
    path: '/api/account/marketing',
    surface: 'api',
    middleware: [activeGuard],
    handler: marketingHandler,
  },
  {
    method: 'POST',
    path: '/api/account/2fa/setup',
    surface: 'api',
    middleware: [activeGuard],
    handler: twoFaSetupHandler,
  },
  {
    method: 'POST',
    path: '/api/account/2fa/enable',
    surface: 'api',
    middleware: [activeGuard],
    handler: twoFaEnableHandler,
  },
  {
    method: 'POST',
    path: '/api/account/2fa/disable',
    surface: 'api',
    middleware: [activeGuard],
    handler: twoFaDisableHandler,
  },
  { method: 'GET', path: '/api/email/unsubscribe', surface: 'api', handler: unsubscribeHandler },
];
