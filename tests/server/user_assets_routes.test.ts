// Unit coverage for the v0.20.0 uploaded-GLB route layer
// (server/user_assets_routes.ts). Sibling of tests/server/maps_routes.test.ts:
// the RouteDefs and the legacy handleApi lanes share the same cores, so this
// file pins the route-layer contract the parity corpus cannot reach db-free:
// the guards, the pre-auth 413, the coded 429 on the shared upload bucket, the
// requireOwnedAsset deny (resolved through the caller's own bounded list), the
// binary byte-read response headers, and the in-handler :file shape parity.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_assets_routes';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5433/wocc_assets_routes';
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  const client = { query, release: vi.fn() };
  return { query, connect: vi.fn(() => Promise.resolve(client)) };
});
vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: dbMock.query, connect: dbMock.connect };
  }),
}));

import type * as http from 'node:http';
import type { AccountModerationStatus } from '../../server/db';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import { apiRegistry } from '../../server/http/registry';
import type { Method, Middleware } from '../../server/http/types';
import {
  ASSET_UPLOAD_MAX_PER_MINUTE,
  assetUploadRateLimited,
  publicReadRateLimited,
  resetAssetUploadRateLimits,
  resetPublicReadRateLimits,
  resetRateLimitClock,
  setRateLimitClock,
} from '../../server/ratelimit';
import type { UserAssetRecord, UserAssetsService } from '../../server/user_assets';
import {
  resetUserAssetsGuardDbForTests,
  resetUserAssetsServiceForTests,
  routes,
  setUserAssetsGuardDbForTests,
  setUserAssetsServiceForTests,
} from '../../server/user_assets_routes';
import { type FakeRes, fakeCtx } from './helpers';

const BEARER = `Bearer ${'a'.repeat(64)}`;
const FIXED_NOW_MS = 1_700_000_000_000;
const CALLER = 7;
const SHA = 'b'.repeat(64);

function modStatus(overrides: Partial<AccountModerationStatus> = {}): AccountModerationStatus {
  return {
    locked: false,
    banned: false,
    suspendedUntil: null,
    reason: '',
    message: '',
    chatMutedUntil: null,
    chatStrikes: 0,
    ...overrides,
  };
}

function scopeOf(scope: 'read' | 'full') {
  return async () => ({ accountId: CALLER, scope });
}

function authedGuardDb(): void {
  setUserAssetsGuardDbForTests({
    accountAndScopeForToken: scopeOf('full'),
    moderationStatusForAccount: async () => modStatus(),
  });
}

function assetRecord(overrides: Partial<UserAssetRecord> = {}): UserAssetRecord {
  return {
    id: 3,
    accountId: CALLER,
    sha256: SHA,
    byteSize: 1234,
    name: 'well.glb',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakeService(overrides: Partial<Record<keyof UserAssetsService, unknown>>): void {
  setUserAssetsServiceForTests(overrides as unknown as UserAssetsService);
}

function readRes(res: http.ServerResponse): {
  status: number;
  body: Record<string, unknown>;
  raw: string;
  headers: Record<string, unknown>;
} {
  const fake = res as unknown as FakeRes;
  let body: unknown;
  try {
    body = fake.body ? JSON.parse(fake.body) : undefined;
  } catch {
    body = undefined;
  }
  return {
    status: fake.statusCode,
    body: body as Record<string, unknown>,
    raw: fake.body,
    headers: fake.headers,
  };
}

function routeFor(method: Method, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

async function runRoute(
  method: Method,
  path: string,
  opts: {
    headers?: Record<string, string>;
    params?: Record<string, string>;
    url?: string;
    body?: unknown;
  } = {},
) {
  const route = routeFor(method, path);
  const ctx = fakeCtx({
    method,
    url: opts.url ?? path,
    headers: opts.headers ?? {},
    params: opts.params ?? {},
    body: opts.body,
  });
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

beforeEach(() => {
  setRateLimitClock(() => FIXED_NOW_MS);
  authedGuardDb();
});

afterEach(() => {
  resetUserAssetsGuardDbForTests();
  resetUserAssetsServiceForTests();
  resetAssetUploadRateLimits();
  resetPublicReadRateLimits();
  resetRateLimitClock();
  vi.restoreAllMocks();
});

describe('route table shape + registry wiring', () => {
  it('registers all four routes with the expected methods and meta', () => {
    const pairs = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(pairs).toEqual(
      [
        'POST /api/assets',
        'GET /api/assets/mine',
        'GET /api/assets/:file',
        'DELETE /api/assets/:id',
      ].sort(),
    );
    expect(routeFor('POST', '/api/assets').meta?.requestBody).toBe('binary');
    expect(routeFor('GET', '/api/assets/:file').meta?.publicRead).toBe(true);
    expect(routeFor('DELETE', '/api/assets/:id').meta?.requireOwned?.ownerScope).toBe('account');
  });

  it('the static /api/assets/mine beats the dynamic :file in the registry', () => {
    const match = apiRegistry.resolve('GET', '/api/assets/mine');
    expect(match.kind).toBe('matched');
    if (match.kind === 'matched') expect(match.route.path).toBe('/api/assets/mine');
  });

  it('a sha file segment resolves to the :file route with the captured param', () => {
    const match = apiRegistry.resolve('GET', `/api/assets/${SHA}.glb`);
    expect(match.kind).toBe('matched');
    if (match.kind === 'matched') {
      expect(match.route.path).toBe('/api/assets/:file');
      expect(match.params).toEqual({ file: `${SHA}.glb` });
    }
  });
});

describe('auth guards + the pre-auth 413', () => {
  it('401s a missing bearer db-free on upload', async () => {
    setUserAssetsGuardDbForTests({
      accountAndScopeForToken: vi.fn(async () => {
        throw new Error('db must not be consulted for a missing bearer');
      }),
    });
    const res = await runRoute('POST', '/api/assets');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
  });

  it('accepts a read-scope token on the owner list (read guard)', async () => {
    setUserAssetsGuardDbForTests({
      accountAndScopeForToken: scopeOf('read'),
      moderationStatusForAccount: async () => modStatus(),
    });
    fakeService({ listMine: async () => [assetRecord()] });
    const res = await runRoute('GET', '/api/assets/mine', { headers: { authorization: BEARER } });
    expect(res.status).toBe(200);
    const assets = res.body.assets as Array<Record<string, unknown>>;
    expect(assets[0].url).toBe(`/api/assets/${SHA}.glb`);
  });

  it('403s a read-scope token on delete (active guard)', async () => {
    setUserAssetsGuardDbForTests({
      accountAndScopeForToken: scopeOf('read'),
      moderationStatusForAccount: async () => modStatus(),
    });
    const res = await runRoute('DELETE', '/api/assets/:id', {
      headers: { authorization: BEARER },
      params: { id: '3' },
      url: '/api/assets/3',
    });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'this token is read-only', code: 'auth.forbidden' });
  });

  it('413s an oversize declared upload before auth, with Connection: close', async () => {
    const accountReads = vi.fn(async () => {
      throw new Error('auth must not run after the 413 short-circuit');
    });
    setUserAssetsGuardDbForTests({ accountAndScopeForToken: accountReads });
    const res = await runRoute('POST', '/api/assets', {
      headers: { 'content-length': '999999999' },
    });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'asset_too_large' });
    expect(res.headers.connection).toBe('close');
    expect(accountReads).not.toHaveBeenCalled();
  });
});

describe('the shared upload limiter (coded 429, shared bucket)', () => {
  it('throws the coded rate_limit.exceeded once the legacy bucket is drained', async () => {
    const req = { headers: {}, socket: { remoteAddress: '10.8.8.8' } } as http.IncomingMessage;
    for (let i = 0; i < ASSET_UPLOAD_MAX_PER_MINUTE; i++) {
      assetUploadRateLimited(req, CALLER);
    }
    const res = await runRoute('POST', '/api/assets', {
      headers: { authorization: BEARER },
      body: 'not-a-glb',
    });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('rate_limit.exceeded');
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('requireOwnedAsset deny-by-default (bounded owner-list loader)', () => {
  it('404s an asset the caller does not own and never reaches the service delete', async () => {
    const deleteAsset = vi.fn();
    fakeService({ listMine: async () => [assetRecord({ id: 99 })], deleteAsset });
    const res = await runRoute('DELETE', '/api/assets/:id', {
      headers: { authorization: BEARER },
      params: { id: '3' },
      url: '/api/assets/3',
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'asset_not_found' });
    expect(deleteAsset).not.toHaveBeenCalled();
  });

  it('422s a non-numeric :id at the decoder', async () => {
    const listMine = vi.fn();
    fakeService({ listMine });
    const res = await runRoute('DELETE', '/api/assets/:id', {
      headers: { authorization: BEARER },
      params: { id: 'abc' },
      url: '/api/assets/abc',
    });
    expect(res.status).toBe(422);
    expect(listMine).not.toHaveBeenCalled();
  });

  it('deletes an owned asset (happy path, scoped service call)', async () => {
    const deleteAsset = vi.fn(async () => true);
    fakeService({ listMine: async () => [assetRecord()], deleteAsset });
    const res = await runRoute('DELETE', '/api/assets/:id', {
      headers: { authorization: BEARER },
      params: { id: '3' },
      url: '/api/assets/3',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(deleteAsset).toHaveBeenCalledWith(CALLER, 3);
  });
});

describe('the public content-addressed byte read', () => {
  it('serves the bytes with the immutable binary headers', async () => {
    const bytes = Buffer.from('glTF-binary-bytes');
    fakeService({ bytesForSha: async () => bytes });
    const res = await runRoute('GET', '/api/assets/:file', {
      params: { file: `${SHA}.glb` },
      url: `/api/assets/${SHA}.glb`,
    });
    expect(res.status).toBe(200);
    expect(res.raw).toBe(bytes.toString());
    expect(res.headers['content-type']).toBe('model/gltf-binary');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-length']).toBe(bytes.length);
  });

  it('404s a missing or blocked sha with the family body (never distinguishes)', async () => {
    fakeService({ bytesForSha: async () => null });
    const res = await runRoute('GET', '/api/assets/:file', {
      params: { file: `${SHA}.glb` },
      url: `/api/assets/${SHA}.glb`,
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'asset_not_found' });
  });

  it('answers the ladder terminal 404 for a non-sha :file (shape parity with the legacy regex)', async () => {
    const bytesForSha = vi.fn();
    fakeService({ bytesForSha });
    const res = await runRoute('GET', '/api/assets/:file', {
      params: { file: 'not-a-sha.glb' },
      url: '/api/assets/not-a-sha.glb',
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'unknown endpoint' });
    expect(bytesForSha).not.toHaveBeenCalled();
  });

  it('a drained public-read bucket 429s the byte GET as coded problem+json (surface-default envelope)', async () => {
    // The route's success body is binary but its META keeps the surface-default
    // error envelope (the POST /api/card precedent), so the coded 429 the
    // mapsAssetsRateLimitedBodyToCode ledger entry records is problem+json, not a
    // binary-envelope serialization. Drain the SHARED legacy tier-1 bucket
    // directly, proving one bucket serves both dispatch paths.
    const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } } as http.IncomingMessage;
    while (publicReadRateLimited(req).allowed) {
      // drain to the cap; the fixed clock keeps every attempt in one window
    }
    fakeService({ bytesForSha: async () => Buffer.from('x') });
    const res = await runRoute('GET', '/api/assets/:file', {
      params: { file: `${SHA}.glb` },
      url: `/api/assets/${SHA}.glb`,
    });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('rate_limit.exceeded');
    expect(String(res.headers['content-type'])).toContain('application/problem+json');
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('upload happy path (core over a fake service)', () => {
  it('uploads bytes with the ?name label and answers the asset json + existing flag', async () => {
    const upload = vi.fn(async () => ({
      ok: true as const,
      asset: assetRecord(),
      existing: false,
    }));
    fakeService({ upload });
    const res = await runRoute('POST', '/api/assets', {
      headers: { authorization: BEARER },
      url: '/api/assets?name=well.glb',
      body: 'raw-glb-bytes',
    });
    expect(res.status).toBe(200);
    expect(upload).toHaveBeenCalledTimes(1);
    const [accountId, bytes, name] = upload.mock.calls[0] as unknown as [Buffer, Buffer, string];
    expect(accountId).toBe(CALLER);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(name).toBe('well.glb');
    expect(res.body.existing).toBe(false);
    expect((res.body.asset as Record<string, unknown>).sha256).toBe(SHA);
  });
});
