import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import type * as http from 'node:http';
import { verifyLoginTwoFactor } from './account';
import {
  accountForApple,
  consumeApplePendingLogin,
  createApplePendingLogin,
  deleteUnusedAppleProvision,
  linkAppleAccount,
  peekApplePendingLogin,
} from './apple_auth_db';
import { hashPassword, newToken, offensiveName, verifyPassword } from './auth';
import {
  accountById,
  backfillAccountEmailIfEmpty,
  createAccount,
  findAccount,
  moderationStatusForAccount,
  pool,
  saveToken,
  touchLogin,
} from './db';
import { withBody } from './http/middleware/body';
import type { Ctx, RouteDef } from './http/types';
import { isUniqueViolation, json, moderationErrorBody } from './http_util';
import { verifyNativeAttestationChallenge } from './native_attestation';
import {
  authThrottled,
  clearAuthFailures,
  rateLimited,
  recordAuthFailure,
  requestIp,
} from './ratelimit';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = `${APPLE_ISSUER}/auth/keys`;
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID?.trim() || 'com.worldofclaudecraft';
const APPLE_PENDING_LOGIN_TTL_MINUTES = 15;
let cachedKeys: { expiresAt: number; keys: JsonWebKey[] } | null = null;

export interface AppleAuthRuntime {
  isIpBlocked(ip: string): boolean;
}

let appleAuthRuntime: AppleAuthRuntime = { isIpBlocked: () => false };

export function configureAppleAuthRuntime(runtime: AppleAuthRuntime): void {
  appleAuthRuntime = runtime;
}

function useAppleAuthRuntime(): AppleAuthRuntime {
  return appleAuthRuntime;
}

export function resetAppleKeyCacheForTests(): void {
  cachedKeys = null;
}

function decodePart(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function appleKeys(forceRefresh = false): Promise<JsonWebKey[]> {
  if (!forceRefresh && cachedKeys && cachedKeys.expiresAt > Date.now()) return cachedKeys.keys;
  try {
    const response = await fetch(APPLE_KEYS_URL, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return [];
    const body = (await response.json()) as { keys?: JsonWebKey[] };
    const keys = Array.isArray(body.keys) ? body.keys : [];
    cachedKeys = { expiresAt: Date.now() + 60 * 60 * 1000, keys };
    return keys;
  } catch {
    return [];
  }
}

export interface VerifiedAppleIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
}

export async function verifyAppleIdentityToken(
  token: string,
  expectedNonce: string,
): Promise<VerifiedAppleIdentity | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  if (!header || !claims || header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
  let valid = false;
  try {
    let key = (await appleKeys()).find(
      (candidate) => (candidate as JsonWebKey & { kid?: string }).kid === header.kid,
    );
    if (!key) {
      key = (await appleKeys(true)).find(
        (candidate) => (candidate as JsonWebKey & { kid?: string }).kid === header.kid,
      );
    }
    if (!key) return null;
    valid = verify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey({ key, format: 'jwk' }),
      Buffer.from(parts[2], 'base64url'),
    );
  } catch {
    return null;
  }
  const audience = claims.aud;
  const audienceValid =
    audience === APPLE_CLIENT_ID || (Array.isArray(audience) && audience.includes(APPLE_CLIENT_ID));
  const expiresAt = typeof claims.exp === 'number' ? claims.exp : 0;
  if (
    !valid ||
    claims.iss !== APPLE_ISSUER ||
    !audienceValid ||
    expiresAt <= Date.now() / 1000 ||
    claims.nonce !== expectedNonce ||
    typeof claims.sub !== 'string'
  ) {
    return null;
  }
  const email = typeof claims.email === 'string' ? claims.email : null;
  return {
    subject: claims.sub,
    email,
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
  };
}

function usernameBase(name: string, email: string | null): string {
  const emailName = email?.split('@')[0] ?? '';
  let value = (name || emailName).replace(/[^A-Za-z0-9_]/g, '').slice(0, 18);
  if (value.length < 3 || offensiveName(value)) value = `apple${randomBytes(3).toString('hex')}`;
  return value;
}

async function provisionAppleAccount(
  name: string,
  email: string | null,
  req: http.IncomingMessage,
) {
  const base = usernameBase(name, email);
  const meta = { ip: requestIp(req), userAgent: String(req.headers['user-agent'] ?? '') };
  for (let attempt = 0; attempt < 8; attempt++) {
    const username = attempt === 0 ? base : `${base.slice(0, 18)}${randomBytes(2).toString('hex')}`;
    if (await findAccount(username)) continue;
    try {
      return await createAccount(username, await hashPassword(newToken()), meta, {
        passwordSet: false,
      });
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }
  return createAccount(
    `apple${randomBytes(8).toString('hex').slice(0, 18)}`,
    await hashPassword(newToken()),
    meta,
    { passwordSet: false },
  );
}

async function issueAppleSession(
  accountId: number,
  req: http.IncomingMessage,
): Promise<{ token: string; username: string; emailMissing: boolean }> {
  await touchLogin(accountId, {
    ip: requestIp(req),
    userAgent: String(req.headers['user-agent'] ?? ''),
  });
  const token = newToken();
  await saveToken(token, accountId, undefined, 'full', 'apple');
  const account = await accountById(accountId);
  return {
    token,
    username: account?.username ?? 'player',
    emailMissing: !account?.email?.trim(),
  };
}

export async function handleAppleLogin(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: Record<string, unknown>,
): Promise<void> {
  if (!rateLimited(req).allowed)
    return json(res, 429, {
      error: 'too many attempts, wait a minute and try again',
      code: 'auth.too_many_attempts',
    });
  const challenge = await verifyNativeAttestationChallenge(req, body.nativeAttestation, 'apple');
  if (!challenge)
    return json(res, 403, { error: 'native attestation failed', code: 'auth.turnstile_failed' });
  const token = typeof body.identityToken === 'string' ? body.identityToken : '';
  const signedNonce = createHash('sha256').update(challenge.nonce).digest('hex');
  const identity = await verifyAppleIdentityToken(token, signedNonce);
  if (!identity)
    return json(res, 401, { error: 'invalid Apple identity', code: 'auth.invalid_credentials' });
  const accountId = await accountForApple(pool, identity.subject);
  if (accountId === null) {
    const displayName = typeof body.displayName === 'string' ? body.displayName : '';
    const linkToken = newToken();
    await createApplePendingLogin(pool, {
      token: linkToken,
      subject: identity.subject,
      email: identity.email,
      emailVerified: identity.emailVerified,
      displayName,
      ttlMinutes: APPLE_PENDING_LOGIN_TTL_MINUTES,
    });
    return json(res, 200, { choose: true, linkToken, username: displayName });
  }
  const status = await moderationStatusForAccount(accountId);
  if (status.locked) return json(res, 403, moderationErrorBody(status));
  if (identity.email && identity.emailVerified)
    await backfillAccountEmailIfEmpty(accountId, identity.email, true);
  return json(res, 200, await issueAppleSession(accountId, req));
}

export async function handleAppleLoginNew(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: Record<string, unknown>,
  isIpBlocked: (ip: string) => boolean = () => false,
): Promise<void> {
  if (!rateLimited(req).allowed)
    return json(res, 429, { error: 'rate limited', code: 'auth.too_many_attempts' });
  if (isIpBlocked(requestIp(req)))
    return json(res, 429, { error: 'rate limited', code: 'auth.too_many_attempts' });
  const linkToken = typeof body.linkToken === 'string' ? body.linkToken : '';
  const pending = await consumeApplePendingLogin(pool, linkToken);
  if (!pending) return json(res, 400, { error: 'expired' });
  let accountId = await accountForApple(pool, pending.apple_subject);
  if (accountId === null) {
    const account = await provisionAppleAccount(
      pending.display_name ?? '',
      pending.apple_email,
      req,
    );
    if (await linkAppleAccount(pool, account.id, pending.apple_subject, pending.apple_email)) {
      accountId = account.id;
    } else {
      await deleteUnusedAppleProvision(pool, account.id);
      accountId = await accountForApple(pool, pending.apple_subject);
      if (accountId === null)
        return json(res, 409, { error: 'already_linked', code: 'auth.invalid_credentials' });
    }
  }
  if (pending.apple_email && pending.apple_email_verified)
    await backfillAccountEmailIfEmpty(accountId, pending.apple_email, true);
  const status = await moderationStatusForAccount(accountId);
  if (status.locked) return json(res, 403, moderationErrorBody(status));
  return json(res, 200, await issueAppleSession(accountId, req));
}

export async function handleAppleLoginLink(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: Record<string, unknown>,
): Promise<void> {
  if (!rateLimited(req).allowed)
    return json(res, 429, { error: 'rate limited', code: 'auth.too_many_attempts' });
  const linkToken = typeof body.linkToken === 'string' ? body.linkToken : '';
  const pending = await peekApplePendingLogin(pool, linkToken);
  if (!pending) return json(res, 400, { error: 'expired' });
  const username = typeof body.username === 'string' ? body.username : '';
  if (username && !authThrottled(username).allowed) {
    return json(res, 429, {
      error: 'too many failed attempts, wait a few minutes and try again',
      code: 'auth.too_many_failed_attempts',
    });
  }
  const account = username ? await findAccount(username) : null;
  const password = typeof body.password === 'string' ? body.password : '';
  if (!account || !(await verifyPassword(password, account.password_hash))) {
    if (username) recordAuthFailure(username);
    return json(res, 401, {
      error: 'invalid username or password',
      code: 'auth.invalid_credentials',
    });
  }
  const status = await moderationStatusForAccount(account.id);
  if (status.locked) return json(res, 403, moderationErrorBody(status));
  if (account.totp_enabled_at) {
    const code = typeof body.code === 'string' ? body.code : '';
    const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode : '';
    if (!code && !recoveryCode) return json(res, 200, { twoFactorRequired: true });
    if (!(await verifyLoginTwoFactor(account, code, recoveryCode))) {
      recordAuthFailure(username);
      return json(res, 401, {
        error: 'that code is not valid, try again',
        code: 'two_factor.code_invalid',
      });
    }
  }
  clearAuthFailures(username);
  const consumed = await consumeApplePendingLogin(pool, linkToken);
  if (!consumed) return json(res, 400, { error: 'expired' });
  if (!(await linkAppleAccount(pool, account.id, consumed.apple_subject, consumed.apple_email))) {
    return json(res, 409, { error: 'already_linked', code: 'auth.invalid_credentials' });
  }
  if (consumed.apple_email && consumed.apple_email_verified)
    await backfillAccountEmailIfEmpty(account.id, consumed.apple_email, true);
  return json(res, 200, await issueAppleSession(account.id, req));
}

async function appleLoginHandler(ctx: Ctx): Promise<void> {
  await handleAppleLogin(ctx.req, ctx.res, (ctx.body ?? {}) as Record<string, unknown>);
}

async function appleLoginNewHandler(ctx: Ctx): Promise<void> {
  await handleAppleLoginNew(
    ctx.req,
    ctx.res,
    (ctx.body ?? {}) as Record<string, unknown>,
    useAppleAuthRuntime().isIpBlocked,
  );
}

async function appleLoginLinkHandler(ctx: Ctx): Promise<void> {
  await handleAppleLoginLink(ctx.req, ctx.res, (ctx.body ?? {}) as Record<string, unknown>);
}

export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/api/auth/apple',
    surface: 'api',
    middleware: [withBody()],
    handler: appleLoginHandler,
  },
  {
    method: 'POST',
    path: '/api/auth/apple/login/new',
    surface: 'api',
    middleware: [withBody()],
    handler: appleLoginNewHandler,
  },
  {
    method: 'POST',
    path: '/api/auth/apple/login/link',
    surface: 'api',
    middleware: [withBody()],
    handler: appleLoginLinkHandler,
  },
];
