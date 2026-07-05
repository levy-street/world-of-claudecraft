// Account self-service portal handlers (home-page account portal).
//
// Mirrors server/wallet.ts: each REST route is an exported, account-scoped
// handler with a real http (req, res) signature, so tests/account_server.test.ts
// can drive every branch through the mock-pg harness with no live database and
// no module-private seam. main.ts resolves the bearer account once and then
// delegates here. All four routes are bearer-auth + account-scoped.
import type http from 'node:http';
import {
  hashPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  verifyPassword,
} from './auth';
import {
  type AccountRow,
  accountById,
  accountByUnsubscribeToken,
  accountTwoFactorEnabled,
  backfillAccountEmailIfEmpty,
  characterCountForAccount,
  claimTotpWindow,
  consumeEmailChangeRequest,
  consumeRecoveryCode,
  createEmailChangeRequest,
  disableTotp,
  enableTotp,
  ensureUnsubscribeToken,
  exportAccountData,
  getTotpState,
  listCharacters,
  revokeToken,
  revokeTokensExcept,
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
  emailTwoFactorDisabled,
  emailTwoFactorEnabled,
  hashEmailToken,
  makeEmailToken,
} from './email';
import { json, readBody } from './http_util';
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

// Hooks main.ts injects so the deactivate path can consult and tear down live
// game sessions without account.ts importing the GameServer (which pulls in the
// browser-free sim + ws stack and is awkward to construct in a unit test).
export interface AccountGameHooks {
  /** True when any of the account's characters is currently in a live session. */
  anyCharacterOnline(characterIds: number[]): boolean;
  /** Close any established socket for the account right after deactivation. */
  disconnectAccount(accountId: number, reason: string): void;
}

// GET /api/account — whoami; re-validates a stored token on reload + feeds the
// portal header. characterCount is account-wide (every realm), matching the
// account-wide nature of this self-service portal.
export async function handleAccountWhoami(
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  const acct = await accountById(accountId);
  if (!acct) return json(res, 404, { error: 'account not found' });
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

// POST /api/account/password — re-verify current, then revoke every OTHER token
// so a password change signs out other devices while keeping this one alive.
// callerToken is resolved by main.ts; it must never be null here (validated up
// the stack) so the revoke below can never accidentally nuke this session.
export async function handleAccountChangePassword(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
  callerToken: string,
): Promise<void> {
  if (rateLimited(req)) return json(res, 429, { error: 'too many attempts, slow down' });
  const body = await readBody(req);
  const acct = await accountById(accountId);
  if (!acct) return json(res, 404, { error: 'account not found' });
  if (!(await verifyPassword(String(body.current ?? ''), acct.password_hash))) {
    recordAuthFailure(acct.username);
    return json(res, 401, { error: 'current password is incorrect' });
  }
  // Correct password: forgive earlier portal mis-types so a re-verify here never
  // throttles the user's own subsequent login. Mirrors the login success path.
  clearAuthFailures(acct.username);
  const next = body.next;
  if (typeof next !== 'string' || next.length < MIN_PASSWORD_LENGTH) {
    return json(res, 400, { error: `password must be at least ${MIN_PASSWORD_LENGTH} chars` });
  }
  if (next.length > MAX_PASSWORD_LENGTH) {
    return json(res, 400, { error: `password must be at most ${MAX_PASSWORD_LENGTH} chars` });
  }
  await updatePasswordHash(accountId, await hashPassword(next));
  await revokeTokensExcept(accountId, callerToken);
  // Best-effort security notice; never blocks the password change on mail state.
  emailPasswordChanged(acct);
  return json(res, 200, { ok: true });
}

// POST /api/account/logout — revoke this device's bearer token. Unlike the
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
  if (rateLimited(req)) return json(res, 429, { error: 'too many attempts, slow down' });
  const body = await readBody(req);
  const acct = await accountById(accountId);
  if (!acct) return json(res, 404, { error: 'account not found' });
  if (acct.email && acct.email.trim()) {
    return json(res, 409, { error: 'use verified email change' });
  }
  const email = normalizeEmail(body.email);
  if (!email) return json(res, 400, { error: 'enter a valid email address' });
  // Atomic fill (the guard lives in the UPDATE's WHERE), so two concurrent
  // set-initial calls, or one racing a Discord capture, cannot both write past the
  // empty-email check above. The address is self-asserted here, so it is stored
  // UNVERIFIED (verified=false). A false return means a concurrent writer already
  // set an address: treat it exactly like the already-set case.
  const filled = await backfillAccountEmailIfEmpty(accountId, email, false);
  if (!filled) return json(res, 409, { error: 'use verified email change' });
  return json(res, 200, { ok: true, email });
}

// POST /api/account/deactivate — re-confirm password + username, require all
// characters offline, then lock the account and revoke ALL tokens. The lock is
// reversible by an admin. After locking we deterministically tear down any
// established socket (revoking tokens alone does not close an open WS).
export async function handleAccountDeactivate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
  hooks: AccountGameHooks,
): Promise<void> {
  if (rateLimited(req)) return json(res, 429, { error: 'too many attempts, slow down' });
  const body = await readBody(req);
  const acct = await accountById(accountId);
  if (!acct) return json(res, 404, { error: 'account not found' });
  if (String(body.username ?? '') !== acct.username) {
    return json(res, 400, { error: 'username does not match' });
  }
  if (!(await verifyPassword(String(body.password ?? ''), acct.password_hash))) {
    recordAuthFailure(acct.username);
    return json(res, 401, { error: 'password is incorrect' });
  }
  // Correct password: forgive earlier portal mis-types so a re-verify here never
  // throttles the user's own subsequent login. Mirrors the login success path.
  clearAuthFailures(acct.username);
  const chars = await listCharacters(accountId);
  if (hooks.anyCharacterOnline(chars.map((c) => c.id))) {
    return json(res, 409, { error: 'log out all characters before deactivating' });
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
  if (rateLimited(req)) return json(res, 429, { error: 'too many attempts, slow down' });
  const body = await readBody(req);
  const acct = await accountById(accountId);
  if (!acct) return json(res, 404, { error: 'account not found' });
  if (!(await verifyPassword(String(body.password ?? ''), acct.password_hash))) {
    recordAuthFailure(acct.username);
    return json(res, 401, { error: 'password is incorrect' });
  }
  clearAuthFailures(acct.username);
  const newEmail = normalizeEmail(body.newEmail);
  if (!newEmail) {
    return json(res, 400, { error: 'enter a valid email address' });
  }
  if (newEmail.toLowerCase() === (acct.email ?? '').toLowerCase()) {
    return json(res, 400, { error: 'that is already your email address' });
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
  if (rateLimited(req)) return json(res, 429, { error: 'too many attempts, slow down' });
  const bundle = await exportAccountData(accountId);
  if (!bundle) return json(res, 404, { error: 'account not found' });
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
  if (rateLimited(req)) return json(res, 429, { error: 'too many attempts, slow down' });
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

// POST /api/account/2fa/setup — password re-verify, then return a pending secret
// + otpauth URI for the user to scan. Idempotent: re-running before enabling just
// supersedes the previous pending secret.
export async function handleAccount2faSetup(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (rateLimited(req)) return json(res, 429, { error: 'too many attempts, slow down' });
  const body = await readBody(req);
  const acct = await accountById(accountId);
  if (!acct) return json(res, 404, { error: 'account not found' });
  if (!(await verifyPassword(String(body.password ?? ''), acct.password_hash))) {
    recordAuthFailure(acct.username);
    return json(res, 401, { error: 'password is incorrect' });
  }
  clearAuthFailures(acct.username);
  const state = await getTotpState(accountId);
  if (state?.enabledAt) return json(res, 409, { error: 'two-factor is already enabled' });
  const secret = generateSecret();
  await setTotpPending(accountId, secret);
  return json(res, 200, { secret, otpauthUri: otpauthUri(secret, acct.username, TOTP_ISSUER) });
}

// POST /api/account/2fa/enable — confirm a live code against the pending secret,
// activate 2FA, and return the one-time recovery codes (shown to the user once).
export async function handleAccount2faEnable(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
  now: number = Date.now(),
): Promise<void> {
  if (rateLimited(req)) return json(res, 429, { error: 'too many attempts, slow down' });
  const body = await readBody(req);
  const state = await getTotpState(accountId);
  if (!state) return json(res, 404, { error: 'account not found' });
  if (state.enabledAt) return json(res, 409, { error: 'two-factor is already enabled' });
  if (!state.pendingSecret) return json(res, 400, { error: 'start two-factor setup first' });
  const code = String(body.code ?? '');
  if (verifyTotp(state.pendingSecret, code, now) === null) {
    return json(res, 400, { error: 'that code is not valid, try again' });
  }
  const recoveryCodes = generateRecoveryCodes();
  await enableTotp(accountId, state.pendingSecret, recoveryCodes.map(hashRecoveryCode));
  const acct = await accountById(accountId);
  if (acct) emailTwoFactorEnabled(acct, recoveryCodes.length);
  return json(res, 200, { ok: true, recoveryCodes });
}

// POST /api/account/2fa/disable — password re-verify, then clear the secret and
// all recovery codes. Best-effort security notice email.
export async function handleAccount2faDisable(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (rateLimited(req)) return json(res, 429, { error: 'too many attempts, slow down' });
  const body = await readBody(req);
  const acct = await accountById(accountId);
  if (!acct) return json(res, 404, { error: 'account not found' });
  if (!(await verifyPassword(String(body.password ?? ''), acct.password_hash))) {
    recordAuthFailure(acct.username);
    return json(res, 401, { error: 'password is incorrect' });
  }
  clearAuthFailures(acct.username);
  const state = await getTotpState(accountId);
  if (!state?.enabledAt) return json(res, 400, { error: 'two-factor is not enabled' });
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
