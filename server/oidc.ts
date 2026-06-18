// OIDC single sign-on. Adds two routes parallel to /api/login:
//
//   GET  /api/oidc/login    → 302 to the configured provider's authorize URL
//   GET  /api/oidc/callback → exchange code, upsert account, redirect home
//
// The flow is generic — any OpenID Connect 1.0 provider works (Authentik,
// Keycloak, Auth0, Ory Hydra, Zitadel, Cognito, …). We fetch the provider's
// .well-known/openid-configuration once at first request and cache the
// discovered endpoints, so deploys don't need to hard-code authorize/token/
// userinfo URLs.
//
// Configuration (read once at startup; all four must be present, otherwise
// the routes return 501 and the existing /api/login flow keeps working):
//
//   OIDC_ISSUER         e.g. https://auth.example.com/application/o/woc
//   OIDC_CLIENT_ID      issued by the provider when you register WoC
//   OIDC_CLIENT_SECRET  issued alongside the client id
//   OIDC_REDIRECT_URI   e.g. https://your-deploy.example.com/api/oidc/callback
//
// CSRF: a short-lived woc_oidc_state cookie carries the state nonce we sent
// to the provider; the callback rejects any code that arrives without a
// matching state.

import * as http from 'node:http';
import { randomBytes } from 'node:crypto';
import { json } from './http_util';
import { saveToken, touchLogin, upsertOAuthAccount, accountForToken } from './db';
import { newToken } from './auth';

const STATE_COOKIE = 'woc_oidc_state';
const STATE_COOKIE_MAX_AGE = 600;
const PROVIDER = 'oidc';

interface OidcConfig { issuer: string; clientId: string; clientSecret: string; redirectUri: string; }
interface OidcEndpoints { authorize: string; token: string; userinfo: string; }

function readConfig(): OidcConfig | null {
  const issuer = (process.env.OIDC_ISSUER ?? '').trim().replace(/\/+$/, '');
  const clientId = (process.env.OIDC_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.OIDC_CLIENT_SECRET ?? '').trim();
  const redirectUri = (process.env.OIDC_REDIRECT_URI ?? '').trim();
  if (!issuer || !clientId || !clientSecret || !redirectUri) return null;
  return { issuer, clientId, clientSecret, redirectUri };
}

const CONFIG: OidcConfig | null = readConfig();

let endpointsCache: OidcEndpoints | null = null;
let endpointsInflight: Promise<OidcEndpoints> | null = null;

async function discoverEndpoints(cfg: OidcConfig): Promise<OidcEndpoints> {
  if (endpointsCache) return endpointsCache;
  if (endpointsInflight) return endpointsInflight;
  endpointsInflight = (async () => {
    const r = await fetch(`${cfg.issuer}/.well-known/openid-configuration`);
    if (!r.ok) throw new Error(`OIDC discovery failed (${r.status})`);
    const j = (await r.json()) as Record<string, unknown>;
    const authorize = typeof j.authorization_endpoint === 'string' ? j.authorization_endpoint : '';
    const token = typeof j.token_endpoint === 'string' ? j.token_endpoint : '';
    const userinfo = typeof j.userinfo_endpoint === 'string' ? j.userinfo_endpoint : '';
    if (!authorize || !token || !userinfo) {
      throw new Error('OIDC discovery doc missing required endpoints');
    }
    endpointsCache = { authorize, token, userinfo };
    return endpointsCache;
  })();
  try { return await endpointsInflight; }
  finally { endpointsInflight = null; }
}

export function isOidcConfigured(): boolean { return CONFIG !== null; }

function setStateCookie(res: http.ServerResponse, state: string): void {
  const flags = [
    `${STATE_COOKIE}=${state}`,
    'Path=/api/oidc',
    `Max-Age=${STATE_COOKIE_MAX_AGE}`,
    'HttpOnly', 'SameSite=Lax', 'Secure',
  ];
  res.setHeader('Set-Cookie', flags.join('; '));
}

function clearStateCookie(res: http.ServerResponse): void {
  res.setHeader('Set-Cookie',
    `${STATE_COOKIE}=; Path=/api/oidc; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
}

function readCookie(req: http.IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.split('=');
    if (k.trim() === name) return rest.join('=').trim();
  }
  return null;
}

function buildAuthorizeUrl(authorizeEndpoint: string, cfg: OidcConfig, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code', scope: 'openid profile email',
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, state,
  });
  return `${authorizeEndpoint}?${params.toString()}`;
}

interface TokenResponse { access_token?: string; id_token?: string; token_type?: string; }
interface UserInfo { sub?: string; preferred_username?: string; name?: string; email?: string; }

async function exchangeCode(tokenEndpoint: string, cfg: OidcConfig, code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId, client_secret: cfg.clientSecret,
  });
  const r = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`token exchange failed: ${r.status} ${await r.text().catch(() => '')}`);
  return (await r.json()) as TokenResponse;
}

async function fetchUserInfo(userinfoEndpoint: string, accessToken: string): Promise<UserInfo> {
  const r = await fetch(userinfoEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`userinfo failed: ${r.status}`);
  return (await r.json()) as UserInfo;
}

/** Public entry: handles `/api/oidc/login` and `/api/oidc/callback`. */
export async function handleOidcRoute(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (!CONFIG) {
    return json(res, 501, { error: 'OIDC SSO is not configured on this server' });
  }

  if (path === '/api/oidc/login') {
    try {
      const endpoints = await discoverEndpoints(CONFIG);
      const state = randomBytes(24).toString('hex');
      setStateCookie(res, state);
      res.writeHead(302, { Location: buildAuthorizeUrl(endpoints.authorize, CONFIG, state) });
      res.end();
      return;
    } catch (err) {
      return json(res, 502, { error: err instanceof Error ? err.message : 'OIDC discovery failed' });
    }
  }

  if (path === '/api/oidc/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const cookieState = readCookie(req, STATE_COOKIE);
    if (!code || !state || state !== cookieState) {
      clearStateCookie(res);
      return json(res, 400, { error: 'invalid OAuth state — please retry sign-in' });
    }
    try {
      const endpoints = await discoverEndpoints(CONFIG);
      const tok = await exchangeCode(endpoints.token, CONFIG, code);
      if (!tok.access_token) throw new Error('missing access_token');
      const info = await fetchUserInfo(endpoints.userinfo, tok.access_token);
      if (!info.sub) throw new Error('userinfo missing sub claim');
      const account = await upsertOAuthAccount({
        provider: PROVIDER, sub: info.sub,
        displayName: info.preferred_username ?? info.name ?? info.email ?? info.sub,
      });
      await touchLogin(account.id);
      const localToken = newToken();
      await saveToken(localToken, account.id);
      clearStateCookie(res);
      const hash = new URLSearchParams({
        auth_token: localToken,
        auth_user: account.username,
        auth_via: PROVIDER,
      });
      res.writeHead(302, { Location: `/#${hash.toString()}` });
      res.end();
      return;
    } catch (err) {
      clearStateCookie(res);
      console.error('OIDC callback failed:', err);
      return json(res, 502, { error: err instanceof Error ? err.message : 'OAuth callback failed' });
    }
  }

  return json(res, 404, { error: 'not found' });
}

export { accountForToken };
