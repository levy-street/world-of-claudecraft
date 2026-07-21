// Route-layer coverage for the OAuth surface (server/oauth.ts).
//
// The 5 OAuth POST JSON endpoints moved off the inline handleOAuth if-ladder onto
// RouteDefs the shared dispatcher serves under API_DISPATCH 'new'. It is a
// PARITY-FIRST migration: each thin Ctx handler calls the EXISTING private core
// (approveAuthorize, tokenEndpoint, revokeEndpoint, deviceAuthorization,
// approveDevice) UNCHANGED. Those cores self-read their body via readForm, resolve
// the browser web session via fullSessionAccount in-handler, and write every
// RFC 6749/7009/8628 status and body directly, so responses are byte-identical to
// the legacy ladder. This slice drives each real RouteDef through the withErrors
// onion (surface 'oauth') and pins:
//  - the registration shape (5 POST routes, surface 'oauth' + meta.envelope
//    'oauth', no requireAccount middleware: consent authenticates via the web
//    session, NOT the API bearer scope gate);
//  - tokenEndpoint routing BOTH grants (authorization_code + device_code), a full
//    PKCE exchange and an approved-device completion each issuing a scope='read'
//    token, and the unsupported-grant 400;
//  - revoke's always-200 RFC 7009 contract;
//  - the web-session gate on BOTH consent POSTs (no bearer / a read token / a
//    locked account all 401; only a full, unlocked session reaches the authorize
//    redirect 200 or the device-approval 200), the load-bearing acceptance check;
//  - deviceAuthorization's RFC 8628 fields and the normalized user-code store;
//  - the oauthBodyValidationRemap: an unexpected handler throw serializes as
//    500 { error: 'server_error', error_description: ... } + X-Request-Id, the one
//    additive divergence from the legacy bare-500 catch;
//  - the frozen RFC 6749 error envelope (keys are a subset of error/
//    error_description, never problem+json, never { success, data, error });
//  - the registry boundary (the HTML GET pages stay off the table and fall
//    through to the legacy ladder as methodNotAllowed).
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is unset;
// importing the registry pulls the whole domain graph, so set a dummy URL in a
// hoisted block that runs before the db factory. The pool never connects: db and
// oauth_db are importActual + spread with the touched functions overridden by
// vi.fn, so no named export is ever missing on the mock and every asserted path
// returns before any real query. auth.newToken and realm.publicOriginFromRequest
// stay REAL (assert token SHAPE, not value).

import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase18_oauth';
});

vi.mock('../../server/db', async (importActual) => {
  const actual = await importActual<typeof import('../../server/db')>();
  return {
    ...actual,
    accountAndScopeForToken: vi.fn(),
    moderationStatusForAccount: vi.fn(),
    revokeReadToken: vi.fn(),
    saveToken: vi.fn(),
  };
});

vi.mock('../../server/oauth_db', async (importActual) => {
  const actual = await importActual<typeof import('../../server/oauth_db')>();
  return {
    ...actual,
    getOAuthClient: vi.fn(),
    upsertOAuthClient: vi.fn(),
    createAuthCode: vi.fn(),
    consumeAuthCode: vi.fn(),
    createDeviceCode: vi.fn(),
    getDeviceByUserCode: vi.fn(),
    approveDeviceCode: vi.fn(),
    getDeviceByDeviceCode: vi.fn(),
    consumeDeviceCode: vi.fn(),
  };
});

import type { AccountModerationStatus } from '../../server/db';
import * as db from '../../server/db';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import { apiRegistry } from '../../server/http/registry';
import type { Method, Middleware } from '../../server/http/types';
import { normalizeUserCode, pkceChallengeFromVerifier, routes } from '../../server/oauth';
import type { DeviceCodeRow } from '../../server/oauth_db';
import * as oauthDb from '../../server/oauth_db';
import { type FakeRes, fakeCtx } from './helpers';

// The RFC 8628 device-code grant type token.
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
// A well-formed 64-hex bearer, matching fullSessionAccount's /^Bearer ([a-f0-9]{64})$/.
const HEX_BEARER = { authorization: `Bearer ${'a'.repeat(64)}` };
// The account the web-session lookup resolves the bearer to.
const ACCOUNT_ID = 5;
// The five registered OAuth POST paths.
const OAUTH_PATHS = [
  '/oauth/authorize',
  '/oauth/token',
  '/oauth/revoke',
  '/oauth/device_authorization',
  '/oauth/device',
];
// The frozen RFC 6749 token-error members; an oauth error body may carry no others.
const OAUTH_ERROR_KEYS = new Set(['error', 'error_description']);

/** An AccountModerationStatus with the lock flag set, everything else neutral. */
function moderationStatus(locked: boolean): AccountModerationStatus {
  return {
    locked,
    banned: false,
    suspendedUntil: null,
    reason: '',
    message: '',
    chatMutedUntil: null,
    chatStrikes: 0,
  };
}

/** A pending device row (unapproved, unexpired) for the approveDevice lookup. */
function pendingDeviceRow(): DeviceCodeRow {
  return {
    device_code: 'dc',
    user_code: 'ABCDEFGH',
    client_id: 'companion',
    scope: 'character:read',
    account_id: null,
    approved: false,
    expired: false,
    consumed: false,
  };
}

/** Read status/body/content-type/request-id off the fakeCtx's FakeRes. */
function readRes(res: http.ServerResponse): {
  status: number;
  body: unknown;
  raw: string;
  contentType: string | undefined;
  requestId: string | undefined;
} {
  const fake = res as unknown as FakeRes;
  const raw = fake.body;
  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : undefined;
  } catch {
    body = undefined;
  }
  return {
    status: fake.statusCode,
    body,
    raw,
    contentType: fake.headers['content-type'] as string | undefined,
    requestId: fake.headers['x-request-id'] as string | undefined,
  };
}

/** Grab a route by method + path (paths repeat across methods, so both are needed). */
function routeFor(method: Method, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

/**
 * Drive a full route chain (its real middleware + handler) under withErrors,
 * exactly as the dispatcher onion does. A JSON content-type is set
 * whenever a body is supplied so readForm parses it as JSON (matching the browser
 * consent fetch); a body-less call leaves the headers as-is (the auth-gated cores
 * return before ever reading the body).
 */
async function runRoute(
  method: Method,
  path: string,
  opts: { url?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const route = routeFor(method, path);
  const headers =
    opts.body !== undefined
      ? { 'content-type': 'application/json', ...opts.headers }
      : opts.headers;
  const ctx = fakeCtx({ method, url: opts.url ?? path, headers, body: opts.body });
  const stack: Middleware[] = [
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    async (c) => {
      await route.handler(c);
    },
  ];
  await compose(stack)(ctx);
  return readRes(ctx.res);
}

/** Assert a body is the frozen RFC 6749 shape: keys are a subset of the two members. */
function assertOauthErrorEnvelope(body: unknown): void {
  expect(body && typeof body === 'object').toBe(true);
  const keys = Object.keys(body as Record<string, unknown>);
  for (const key of keys) {
    expect(OAUTH_ERROR_KEYS.has(key), `unexpected member ${key}`).toBe(true);
  }
  // Never a problem+json (type/title/status/detail/instance/code) or admin
  // ({ success, data }) envelope member: the oauth surface is exclusively RFC 6749.
  for (const forbidden of [
    'type',
    'title',
    'status',
    'detail',
    'instance',
    'code',
    'success',
    'data',
  ]) {
    expect(keys, forbidden).not.toContain(forbidden);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults: a full, unlocked web session and a known client, so a test
  // asserting the happy path need only override the one call it exercises.
  vi.mocked(db.accountAndScopeForToken).mockResolvedValue({ accountId: ACCOUNT_ID, scope: 'full' });
  vi.mocked(db.moderationStatusForAccount).mockResolvedValue(moderationStatus(false));
  vi.mocked(db.revokeReadToken).mockResolvedValue(true);
  vi.mocked(db.saveToken).mockResolvedValue(undefined);
  vi.mocked(oauthDb.getOAuthClient).mockResolvedValue({
    client_id: 'companion',
    name: 'Companion',
    redirect_uris: 'https://app.example/cb',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Route registration shape.
// ---------------------------------------------------------------------------

describe('OAuth route registration', () => {
  it('exports exactly the 5 POST oauth endpoints', () => {
    expect(routes).toHaveLength(5);
    expect(routes.map((r) => r.path).sort()).toEqual([...OAUTH_PATHS].sort());
    for (const r of routes) expect(r.method, r.path).toBe('POST');
  });

  it('every route is surface oauth + envelope oauth and carries no middleware', () => {
    for (const r of routes) {
      expect(r.surface, r.path).toBe('oauth');
      expect(r.meta?.envelope, r.path).toBe('oauth');
      // No requireAccount / withBody: the consent POSTs authenticate via the web
      // session in-handler, not the API bearer scope gate.
      expect(r.middleware, r.path).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. POST /oauth/token routes both grants.
// ---------------------------------------------------------------------------

describe('POST /oauth/token', () => {
  it('authorization_code with an invalid/expired/used code -> 400 invalid_grant', async () => {
    vi.mocked(oauthDb.consumeAuthCode).mockResolvedValue(null);
    const r = await runRoute('POST', '/oauth/token', {
      body: {
        grant_type: 'authorization_code',
        code: 'thecode',
        code_verifier: 'v'.repeat(43),
        client_id: 'companion',
        redirect_uri: 'https://app.example/cb',
      },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      error: 'invalid_grant',
      error_description: 'code invalid, expired, or already used',
    });
    expect(db.saveToken).not.toHaveBeenCalled();
  });

  it('device_code grant with an unknown device_code -> 400 invalid_grant', async () => {
    vi.mocked(oauthDb.getDeviceByDeviceCode).mockResolvedValue(null);
    const r = await runRoute('POST', '/oauth/token', {
      body: { grant_type: DEVICE_GRANT, device_code: 'dc', client_id: 'companion' },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'invalid_grant', error_description: 'unknown device_code' });
    expect(db.saveToken).not.toHaveBeenCalled();
  });

  it('a full authorization_code exchange issues a 64-hex scope=read token', async () => {
    const verifier = 'v'.repeat(43);
    vi.mocked(oauthDb.consumeAuthCode).mockResolvedValue({
      account_id: ACCOUNT_ID,
      client_id: 'companion',
      redirect_uri: 'https://app.example/cb',
      code_challenge: pkceChallengeFromVerifier(verifier),
      code_challenge_method: 'S256',
      scope: 'character:read',
    });
    const r = await runRoute('POST', '/oauth/token', {
      body: {
        grant_type: 'authorization_code',
        code: 'thecode',
        code_verifier: verifier,
        client_id: 'companion',
        redirect_uri: 'https://app.example/cb',
      },
    });
    expect(r.status).toBe(200);
    const body = r.body as {
      access_token: string;
      token_type: string;
      scope: string;
      expires_in: number;
    };
    expect(body.access_token).toMatch(/^[a-f0-9]{64}$/);
    expect(body.token_type).toBe('bearer');
    expect(body.scope).toBe('character:read');
    expect(typeof body.expires_in).toBe('number');
    // The issued token is persisted as an ordinary scope='read' row, labelled by client.
    expect(db.saveToken).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      ACCOUNT_ID,
      expect.any(Number),
      'read',
      'oauth:companion',
    );
  });

  it('an approved device_code grant completes the RFC 8628 flow with a scope=read token', async () => {
    vi.mocked(oauthDb.getDeviceByDeviceCode).mockResolvedValue({
      ...pendingDeviceRow(),
      approved: true,
      account_id: ACCOUNT_ID,
    });
    vi.mocked(oauthDb.consumeDeviceCode).mockResolvedValue({
      account_id: ACCOUNT_ID,
      scope: 'character:read',
    });
    const r = await runRoute('POST', '/oauth/token', {
      body: { grant_type: DEVICE_GRANT, device_code: 'dc', client_id: 'companion' },
    });
    expect(r.status).toBe(200);
    const body = r.body as { access_token: string; token_type: string; scope: string };
    expect(body.access_token).toMatch(/^[a-f0-9]{64}$/);
    expect(body.token_type).toBe('bearer');
    expect(body.scope).toBe('character:read');
    // The device code is single-use: the exchange consumes it before issuing.
    expect(oauthDb.consumeDeviceCode).toHaveBeenCalledWith(expect.anything(), 'dc');
    expect(db.saveToken).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      ACCOUNT_ID,
      expect.any(Number),
      'read',
      'oauth:companion',
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Unsupported grant.
// ---------------------------------------------------------------------------

describe('POST /oauth/token unsupported grant', () => {
  it('an unrecognized grant_type -> 400 unsupported_grant_type with NO description', async () => {
    const r = await runRoute('POST', '/oauth/token', { body: {} });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'unsupported_grant_type' });
  });
});

// ---------------------------------------------------------------------------
// 4. POST /oauth/revoke always answers 200 (RFC 7009).
// ---------------------------------------------------------------------------

describe('POST /oauth/revoke', () => {
  it('revokes the presented token and returns 200 { ok: true }', async () => {
    const token = 'x'.repeat(10);
    const r = await runRoute('POST', '/oauth/revoke', { body: { token } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(db.revokeReadToken).toHaveBeenCalledWith(token);
  });

  it('is a no-op 200 { ok: true } when no token is presented', async () => {
    const r = await runRoute('POST', '/oauth/revoke', { body: {} });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(db.revokeReadToken).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. The consent POSTs authenticate via the FULL web session (no escalation).
// ---------------------------------------------------------------------------

describe('web-session gate on the consent POSTs', () => {
  it('approveAuthorize with no bearer -> 401 access_denied, no db lookups', async () => {
    const r = await runRoute('POST', '/oauth/authorize', {});
    expect(r.status).toBe(401);
    expect(r.body).toEqual({
      error: 'access_denied',
      error_description: 'log in to your World of ClaudeCraft account first',
    });
    expect(db.accountAndScopeForToken).not.toHaveBeenCalled();
    expect(oauthDb.getOAuthClient).not.toHaveBeenCalled();
    expect(oauthDb.createAuthCode).not.toHaveBeenCalled();
  });

  it('approveDevice with no bearer -> 401 access_denied, no db lookups', async () => {
    const r = await runRoute('POST', '/oauth/device', {});
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'access_denied', error_description: 'log in first' });
    expect(db.accountAndScopeForToken).not.toHaveBeenCalled();
    expect(oauthDb.getDeviceByUserCode).not.toHaveBeenCalled();
  });

  it('a read-scope token cannot approve authorize (no escalation) -> 401', async () => {
    vi.mocked(db.accountAndScopeForToken).mockResolvedValue({
      accountId: ACCOUNT_ID,
      scope: 'read',
    });
    const r = await runRoute('POST', '/oauth/authorize', {
      headers: HEX_BEARER,
      body: {
        client_id: 'companion',
        redirect_uri: 'https://app.example/cb',
        code_challenge: 'c',
        code_challenge_method: 'S256',
      },
    });
    expect(r.status).toBe(401);
    expect(oauthDb.createAuthCode).not.toHaveBeenCalled();
  });

  it('a full token on a LOCKED account cannot approve device -> 401', async () => {
    vi.mocked(db.accountAndScopeForToken).mockResolvedValue({
      accountId: ACCOUNT_ID,
      scope: 'full',
    });
    vi.mocked(db.moderationStatusForAccount).mockResolvedValue(moderationStatus(true));
    const r = await runRoute('POST', '/oauth/device', {
      headers: HEX_BEARER,
      body: { user_code: 'ABCD-EFGH' },
    });
    expect(r.status).toBe(401);
    expect(oauthDb.approveDeviceCode).not.toHaveBeenCalled();
  });

  it('a full token on an UNLOCKED account approves the device -> 200 { ok: true }', async () => {
    vi.mocked(db.accountAndScopeForToken).mockResolvedValue({
      accountId: ACCOUNT_ID,
      scope: 'full',
    });
    vi.mocked(db.moderationStatusForAccount).mockResolvedValue(moderationStatus(false));
    vi.mocked(oauthDb.getDeviceByUserCode).mockResolvedValue(pendingDeviceRow());
    vi.mocked(oauthDb.approveDeviceCode).mockResolvedValue(true);
    const r = await runRoute('POST', '/oauth/device', {
      headers: HEX_BEARER,
      body: { user_code: 'ABCD-EFGH' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    // Approval normalizes (dash-strips) the submitted code before the exact-match query.
    expect(oauthDb.approveDeviceCode).toHaveBeenCalledWith(
      expect.anything(),
      'ABCDEFGH',
      ACCOUNT_ID,
    );
  });

  it('a read-scope token cannot approve device (no escalation) -> 401', async () => {
    vi.mocked(db.accountAndScopeForToken).mockResolvedValue({
      accountId: ACCOUNT_ID,
      scope: 'read',
    });
    const r = await runRoute('POST', '/oauth/device', {
      headers: HEX_BEARER,
      body: { user_code: 'ABCD-EFGH' },
    });
    expect(r.status).toBe(401);
    expect(oauthDb.approveDeviceCode).not.toHaveBeenCalled();
  });

  it('a full token on a LOCKED account cannot approve authorize -> 401', async () => {
    vi.mocked(db.moderationStatusForAccount).mockResolvedValue(moderationStatus(true));
    const r = await runRoute('POST', '/oauth/authorize', {
      headers: HEX_BEARER,
      body: {
        client_id: 'companion',
        redirect_uri: 'https://app.example/cb',
        code_challenge: 'c',
        code_challenge_method: 'S256',
      },
    });
    expect(r.status).toBe(401);
    expect(oauthDb.createAuthCode).not.toHaveBeenCalled();
  });

  it('a full token on an UNLOCKED account approves authorize -> 200 { redirect } with code + state', async () => {
    const challenge = pkceChallengeFromVerifier('v'.repeat(43));
    const r = await runRoute('POST', '/oauth/authorize', {
      headers: HEX_BEARER,
      body: {
        client_id: 'companion',
        redirect_uri: 'https://app.example/cb',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'client-state',
      },
    });
    expect(r.status).toBe(200);
    const redirect = new URL((r.body as { redirect: string }).redirect);
    expect(redirect.origin + redirect.pathname).toBe('https://app.example/cb');
    const code = redirect.searchParams.get('code') ?? '';
    expect(code).toMatch(/^[a-f0-9]{64}$/);
    // The client state echoes back on the redirect (CSRF binding).
    expect(redirect.searchParams.get('state')).toBe('client-state');
    // The redirect carries the SAME single-use code the store persisted, bound to
    // the approving account and the client's PKCE challenge.
    expect(oauthDb.createAuthCode).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        code,
        clientId: 'companion',
        accountId: ACCOUNT_ID,
        redirectUri: 'https://app.example/cb',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        scope: 'character:read',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// 6. POST /oauth/device_authorization (RFC 8628 start).
// ---------------------------------------------------------------------------

describe('POST /oauth/device_authorization', () => {
  it('a missing client_id -> 400 invalid_client, getOAuthClient never called', async () => {
    const r = await runRoute('POST', '/oauth/device_authorization', { body: {} });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'invalid_client', error_description: 'unknown client' });
    expect(oauthDb.getOAuthClient).not.toHaveBeenCalled();
  });

  it('a known client -> 200 with a device_code, dashed user_code, and RFC 8628 fields', async () => {
    vi.mocked(oauthDb.getOAuthClient).mockResolvedValue({
      client_id: 'companion',
      name: 'Companion',
      redirect_uris: '',
    });
    const r = await runRoute('POST', '/oauth/device_authorization', {
      body: { client_id: 'companion' },
    });
    expect(r.status).toBe(200);
    const body = r.body as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    };
    expect(body.device_code).toMatch(/^[a-f0-9]{64}$/);
    expect(body.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ2-9]{4}-[BCDFGHJKLMNPQRSTVWXZ2-9]{4}$/);
    expect(body.verification_uri).toContain('/oauth/device');
    expect(body.expires_in).toBe(900);
    expect(body.interval).toBe(5);
    // The stored user code is the normalized (dash-stripped) form so approveDevice's
    // normalized lookup matches; without it approval never resolves.
    const stored = vi.mocked(oauthDb.createDeviceCode).mock.calls[0][1].userCode;
    expect(stored).not.toContain('-');
    expect(stored).toBe(normalizeUserCode(body.user_code));
  });
});

// ---------------------------------------------------------------------------
// 7. The oauthBodyValidationRemap 500 pin.
// ---------------------------------------------------------------------------

describe('oauthBodyValidationRemap (unexpected throw)', () => {
  it('serializes a handler throw as the additive oauth 500 + X-Request-Id', async () => {
    // The default onUnexpected sink logs to console.error; silence the expected line.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(db.revokeReadToken).mockRejectedValue(new Error('db down'));
    const r = await runRoute('POST', '/oauth/revoke', { body: { token: 'a'.repeat(64) } });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({
      error: 'server_error',
      error_description: 'An unexpected error occurred.',
    });
    expect(r.contentType).toBe('application/json');
    expect(r.requestId).toBeDefined();
    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 8. The frozen RFC 6749 error envelope.
// ---------------------------------------------------------------------------

describe('oauth error envelope contract (frozen RFC 6749)', () => {
  it('every error body carries only error / error_description members', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // unsupported_grant_type (400)
    assertOauthErrorEnvelope((await runRoute('POST', '/oauth/token', { body: {} })).body);

    // invalid_grant (400)
    vi.mocked(oauthDb.consumeAuthCode).mockResolvedValue(null);
    assertOauthErrorEnvelope(
      (
        await runRoute('POST', '/oauth/token', {
          body: {
            grant_type: 'authorization_code',
            code: 'x',
            code_verifier: 'v'.repeat(43),
          },
        })
      ).body,
    );

    // access_denied (401)
    assertOauthErrorEnvelope((await runRoute('POST', '/oauth/authorize', {})).body);

    // invalid_client (400)
    assertOauthErrorEnvelope(
      (await runRoute('POST', '/oauth/device_authorization', { body: {} })).body,
    );

    // server_error (500 remap)
    vi.mocked(db.revokeReadToken).mockRejectedValue(new Error('boom'));
    assertOauthErrorEnvelope(
      (await runRoute('POST', '/oauth/revoke', { body: { token: 't'.repeat(10) } })).body,
    );

    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 9. Registry boundary (the HTML GET pages stay off the table).
// ---------------------------------------------------------------------------

describe('registry boundary', () => {
  it('the 5 POST oauth routes are registered in the shared table', () => {
    for (const path of OAUTH_PATHS) {
      expect(apiRegistry.resolve('POST', path).kind, path).toBe('matched');
    }
  });

  it('an unknown /oauth path does not match (delegated to the legacy ladder)', () => {
    expect(apiRegistry.resolve('POST', '/oauth/does-not-exist').kind).not.toBe('matched');
  });

  it('a GET on a POST-only oauth path resolves methodNotAllowed (the HTML page stays legacy)', () => {
    expect(apiRegistry.resolve('GET', '/oauth/authorize').kind).toBe('methodNotAllowed');
  });
});
