import { randomBytes } from 'node:crypto';
import type http from 'node:http';
import { hashPassword, newToken, offensiveName } from './auth';
import {
  accountById,
  backfillAccountEmailIfEmpty,
  createAccount,
  findAccount,
  moderationStatusForAccount,
  pool,
  type RequestMetadata,
  saveToken,
  touchLogin,
} from './db';
import { logger } from './http/logger';
import type { Ctx, RouteDef } from './http/types';
import { isUniqueViolation, json } from './http_util';
import { rateLimited, requestIp } from './ratelimit';
import { publicOriginFromRequest } from './realm';
import {
  consumeSocialLoginOAuthState,
  createSocialLoginOAuthState,
  socialLoginLink,
  upsertSocialLoginLink,
} from './social_login_db';
import {
  buildAuthorizeUrl,
  buildTokenRequestBody,
  isSocialLoginProvider,
  PROVIDER_LABEL,
  parseGoogleUser,
  parseKickUser,
  parseTokenResponse,
  parseTwitchUser,
  pkceChallengeFromVerifier,
  providerEnvPrefix,
  type SocialIdentity,
  type SocialLoginConfig,
  type SocialLoginProvider,
  tokenUrl,
} from './social_login_oauth';

const STATE_TTL_MINUTES = 10;

export interface SocialLoginRuntime {
  isIpBlocked(ip: string): boolean;
  requestMetadata(req: http.IncomingMessage): RequestMetadata;
}

let runtime: SocialLoginRuntime | null = null;

export function configureSocialLoginRuntime(rt: SocialLoginRuntime): void {
  runtime = rt;
}

function useRuntime(): SocialLoginRuntime {
  if (runtime === null) throw new Error('social login runtime is not configured');
  return runtime;
}

export function socialLoginConfig(provider: SocialLoginProvider): SocialLoginConfig | null {
  const prefix = providerEnvPrefix(provider);
  const clientId = process.env[`${prefix}_OAUTH_CLIENT_ID`] ?? '';
  const clientSecret = process.env[`${prefix}_OAUTH_CLIENT_SECRET`] ?? '';
  if (!clientId || !clientSecret) return null;
  return { provider, clientId, clientSecret };
}

function redirectUriFor(req: http.IncomingMessage, provider: SocialLoginProvider): string {
  return `${publicOriginFromRequest(req)}/api/auth/${provider}/callback`;
}

export async function handleSocialLoginStart(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  provider: SocialLoginProvider,
): Promise<void> {
  if (!rateLimited(req).allowed) return json(res, 429, { error: 'rate limited' });
  if (useRuntime().isIpBlocked(requestIp(req))) return json(res, 429, { error: 'rate limited' });
  const cfg = socialLoginConfig(provider);
  if (!cfg) {
    return json(res, 503, {
      error: `${PROVIDER_LABEL[provider]} login is not configured`,
    });
  }
  const state = newToken();
  const codeVerifier = newToken();
  await createSocialLoginOAuthState(pool, {
    state,
    provider,
    codeVerifier,
    ttlMinutes: STATE_TTL_MINUTES,
  });
  const url = buildAuthorizeUrl({
    provider,
    clientId: cfg.clientId,
    redirectUri: redirectUriFor(req, provider),
    state,
    codeChallenge: pkceChallengeFromVerifier(codeVerifier),
  });
  return json(res, 200, { url });
}

export async function handleSocialLoginCallback(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  provider: SocialLoginProvider,
): Promise<void> {
  if (useRuntime().isIpBlocked(requestIp(req))) {
    return bouncePage(res, 403, { ok: false, provider, error: 'server_error' });
  }
  const cfg = socialLoginConfig(provider);
  if (!cfg) return bouncePage(res, 503, { ok: false, provider, error: 'not_configured' });
  const u = new URL(req.url ?? '/', 'http://localhost');
  if (u.searchParams.get('error')) {
    return bouncePage(res, 200, { ok: false, provider, error: 'cancelled' });
  }
  const code = u.searchParams.get('code') ?? '';
  const state = u.searchParams.get('state') ?? '';
  if (!code || !state) return bouncePage(res, 400, { ok: false, provider, error: 'bad_request' });

  const stateRow = await consumeSocialLoginOAuthState(pool, state);
  if (!stateRow || stateRow.provider !== provider) {
    return bouncePage(res, 400, { ok: false, provider, error: 'expired' });
  }

  const identity = await exchangeCodeForIdentity(
    provider,
    code,
    redirectUriFor(req, provider),
    stateRow.code_verifier,
    cfg,
  );
  if (!identity) return bouncePage(res, 502, { ok: false, provider, error: 'provider_error' });

  try {
    const meta = useRuntime().requestMetadata(req);
    const { accountId, username } = await loginOrCreateAccount(provider, identity, meta);
    const status = await moderationStatusForAccount(accountId);
    if (status.locked) return bouncePage(res, 403, { ok: false, provider, error: 'locked' });
    await touchLogin(accountId, meta);
    const token = newToken();
    await saveToken(token, accountId, undefined, 'full', provider);
    return bouncePage(res, 200, { ok: true, provider, token, username });
  } catch (err) {
    logger.error({ err, provider }, 'social login callback error');
    return bouncePage(res, 500, { ok: false, provider, error: 'server_error' });
  }
}

async function exchangeCodeForIdentity(
  provider: SocialLoginProvider,
  code: string,
  redirectUri: string,
  codeVerifier: string,
  cfg: SocialLoginConfig,
): Promise<SocialIdentity | null> {
  const tokenJson = await fetchJsonWithTimeout(tokenUrl(provider), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: buildTokenRequestBody({
      provider,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      code,
      redirectUri,
      codeVerifier,
    }),
  });
  const token = parseTokenResponse(tokenJson);
  if (!token) return null;
  if (provider === 'google') {
    const profile = await fetchJsonWithTimeout('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token.accessToken}`, Accept: 'application/json' },
    });
    return parseGoogleUser(profile);
  }
  if (provider === 'twitch') {
    const profile = await fetchJsonWithTimeout('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Client-Id': cfg.clientId,
        Accept: 'application/json',
      },
    });
    return parseTwitchUser(profile);
  }
  const profile = await fetchJsonWithTimeout('https://api.kick.com/public/v1/users', {
    headers: { Authorization: `Bearer ${token.accessToken}`, Accept: 'application/json' },
  });
  return parseKickUser(profile);
}

async function fetchJsonWithTimeout(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function loginOrCreateAccount(
  provider: SocialLoginProvider,
  identity: SocialIdentity,
  meta: RequestMetadata,
): Promise<{ accountId: number; username: string }> {
  const existingLink = await socialLoginLink(pool, provider, identity.providerUserId);
  if (existingLink) {
    if (identity.email) {
      await backfillAccountEmailIfEmpty(
        existingLink.account_id,
        identity.email,
        identity.emailVerified,
      );
    }
    return {
      accountId: existingLink.account_id,
      username: (await accountById(existingLink.account_id))?.username ?? 'player',
    };
  }

  const account = await createSocialAccount(provider, identity, meta);
  await upsertSocialLoginLink(pool, {
    accountId: account.id,
    provider,
    providerUserId: identity.providerUserId,
    displayName: identity.displayName,
    email: identity.email,
    avatarUrl: identity.avatarUrl,
  });
  const linked = await socialLoginLink(pool, provider, identity.providerUserId);
  if (linked && linked.account_id !== account.id) {
    return {
      accountId: linked.account_id,
      username: (await accountById(linked.account_id))?.username ?? 'player',
    };
  }
  if (identity.email)
    await backfillAccountEmailIfEmpty(account.id, identity.email, identity.emailVerified);
  return { accountId: account.id, username: account.username };
}

async function createSocialAccount(
  provider: SocialLoginProvider,
  identity: SocialIdentity,
  meta: RequestMetadata,
): Promise<{ id: number; username: string }> {
  const base = usernameBase(provider, identity.displayName);
  for (let i = 0; i < 8; i++) {
    const suffix = i === 0 ? '' : randomBytes(2).toString('hex');
    const username = `${base}${suffix}`.slice(0, 24);
    if (offensiveName(username) || (await findAccount(username))) continue;
    try {
      return await createAccount(
        username,
        await hashPassword(randomBytes(32).toString('hex')),
        meta,
        {
          passwordSet: false,
        },
      );
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  return createAccount(
    `${provider}${randomBytes(5).toString('hex')}`.slice(0, 24),
    await hashPassword(randomBytes(32).toString('hex')),
    meta,
    { passwordSet: false },
  );
}

function usernameBase(provider: SocialLoginProvider, displayName: string): string {
  const cleaned = displayName.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 18);
  const base = cleaned.length >= 3 ? cleaned : `${provider}player`;
  return base.slice(0, 20);
}

interface BouncePayload {
  ok: boolean;
  provider: SocialLoginProvider;
  token?: string;
  username?: string;
  error?: string;
}

function bouncePage(res: http.ServerResponse, status: number, payload: BouncePayload): void {
  const data = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const label = PROVIDER_LABEL[payload.provider];
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>World of ClaudeCraft</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{background:#14100a;color:#fff6df;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}main{text-align:center;padding:24px}</style>
</head><body><main><p id="m">Connecting ${label}...</p></main><script>
(function(){
  var p = ${data};
  try {
    if (p.ok && p.token) {
      localStorage.setItem('woc_session', JSON.stringify({ token: p.token, username: p.username }));
      localStorage.setItem('woc_social_onboard', '1');
    }
  } catch (e) {}
  var msg = { source: 'woc-social-login', ok: p.ok, provider: p.provider, error: p.error || null };
  if (window.opener) {
    try { window.opener.postMessage(msg, location.origin); } catch (e) {}
    setTimeout(function(){ try { window.close(); } catch (e) {} location.replace('/'); }, 200);
  } else {
    location.replace('/');
  }
})();
</script></body></html>`;
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function socialStartHandler(ctx: Ctx): Promise<void> {
  const provider = ctx.params.provider;
  if (!isSocialLoginProvider(provider)) return json(ctx.res, 404, { error: 'not found' });
  return handleSocialLoginStart(ctx.req, ctx.res, provider);
}

async function socialCallbackHandler(ctx: Ctx): Promise<void> {
  const provider = ctx.params.provider;
  if (!isSocialLoginProvider(provider)) return json(ctx.res, 404, { error: 'not found' });
  return handleSocialLoginCallback(ctx.req, ctx.res, provider);
}

export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/api/auth/:provider/start',
    surface: 'api',
    handler: socialStartHandler,
  },
  {
    method: 'GET',
    path: '/api/auth/:provider/callback',
    surface: 'api',
    meta: { envelope: 'html' },
    handler: socialCallbackHandler,
  },
];
