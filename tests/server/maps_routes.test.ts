// Unit coverage for the v0.20.0 map editor route layer (server/maps_routes.ts).
//
// The custom-map family migrated in-merge with the release that introduced it:
// the RouteDefs and the legacy handleApi lanes share the SAME per-lane cores, so
// this file pins the ROUTE-LAYER contract the parity corpus cannot reach db-free:
//  - the route table shape + registry wiring (static /api/maps/public beats the
//    dynamic :id; publish/unpublish register as literal suffixes);
//  - the shared guards (401 db-free, read-only 403 on mutations, read scope
//    accepted on the owner list, moderation 403);
//  - the pre-auth Content-Length 413 guard (map_too_large + Connection: close);
//  - the coded rate_limit.exceeded 429 once the shared legacy bucket is drained
//    (the mapsAssetsRateLimitedBodyToCode deviation, pinned here because the
//    parity harness resets buckets);
//  - requireOwnedMap deny-by-default (404 map_not_found; public maps someone
//    else owns are denied for mutation) and the owner pass-through;
//  - the thin-handler happy paths over a fake MapsService;
//  - the in-handler :id shape parity on the publicRead routes (404 unknown
//    endpoint, byte-identical to the ladder terminal).
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is
// unset; maps_routes.ts imports it, so set a dummy URL and mock pg (the pool
// never connects: the guard db and the service are faked via the test seams).
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_maps_routes';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5433/wocc_maps_routes';
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
import type { MapRecord, MapsService } from '../../server/maps';
import {
  resetMapsGuardDbForTests,
  resetMapsServiceForTests,
  routes,
  setMapsGuardDbForTests,
  setMapsServiceForTests,
} from '../../server/maps_routes';
import {
  MAP_MUTATION_MAX_PER_MINUTE,
  mapMutationRateLimited,
  resetMapMutationRateLimits,
  resetPublicReadRateLimits,
  resetRateLimitClock,
  setRateLimitClock,
} from '../../server/ratelimit';
import { type FakeRes, fakeCtx } from './helpers';

const BEARER = `Bearer ${'a'.repeat(64)}`;
const FIXED_NOW_MS = 1_700_000_000_000;
const CALLER = 7;

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

/** Seed the guard db with a full-scope, non-locked account. */
function authedGuardDb(): void {
  setMapsGuardDbForTests({
    accountAndScopeForToken: scopeOf('full'),
    moderationStatusForAccount: async () => modStatus(),
  });
}

/** A canned owned MapRecord. */
function mapRecord(overrides: Partial<MapRecord> = {}): MapRecord {
  return {
    id: 5,
    accountId: CALLER,
    name: 'My Map',
    slug: 'my-map',
    doc: { meta: { id: 'doc-1', name: 'My Map', parentId: '' } } as unknown as MapRecord['doc'],
    version: 3,
    parentMapId: null,
    forkedFromVersion: null,
    status: 'private',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

/** Install a fake MapsService (only the members a test drives need overriding). */
function fakeService(overrides: Partial<Record<keyof MapsService, unknown>>): void {
  setMapsServiceForTests(overrides as unknown as MapsService);
}

function readRes(res: http.ServerResponse): {
  status: number;
  body: Record<string, unknown>;
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
    headers: fake.headers,
  };
}

function routeFor(method: Method, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

/** Drive a route's real middleware + handler under withErrors (dispatcher shape). */
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
  resetMapsGuardDbForTests();
  resetMapsServiceForTests();
  resetMapMutationRateLimits();
  resetPublicReadRateLimits();
  resetRateLimitClock();
  vi.restoreAllMocks();
});

describe('route table shape + registry wiring', () => {
  it('registers all nine routes with the expected methods', () => {
    const pairs = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(pairs).toEqual(
      [
        'GET /api/maps',
        'POST /api/maps',
        'GET /api/maps/public',
        'GET /api/maps/:id',
        'PUT /api/maps/:id',
        'DELETE /api/maps/:id',
        'POST /api/maps/:id/fork',
        'POST /api/maps/:id/publish',
        'POST /api/maps/:id/unpublish',
      ].sort(),
    );
  });

  it('the static /api/maps/public beats the dynamic :id in the registry', () => {
    const match = apiRegistry.resolve('GET', '/api/maps/public');
    expect(match.kind).toBe('matched');
    if (match.kind === 'matched') expect(match.route.path).toBe('/api/maps/public');
  });

  it('a numeric id resolves to the :id route with the captured param', () => {
    const match = apiRegistry.resolve('GET', '/api/maps/42');
    expect(match.kind).toBe('matched');
    if (match.kind === 'matched') {
      expect(match.route.path).toBe('/api/maps/:id');
      expect(match.params).toEqual({ id: '42' });
    }
  });

  it('the owner-only :id routes declare the account requireOwned marker; the public-or-owner routes declare publicRead', () => {
    for (const [method, path] of [
      ['PUT', '/api/maps/:id'],
      ['DELETE', '/api/maps/:id'],
      ['POST', '/api/maps/:id/publish'],
      ['POST', '/api/maps/:id/unpublish'],
    ] as const) {
      expect(routeFor(method, path).meta?.requireOwned?.ownerScope, `${method} ${path}`).toBe(
        'account',
      );
    }
    expect(routeFor('GET', '/api/maps/:id').meta?.publicRead).toBe(true);
    expect(routeFor('POST', '/api/maps/:id/fork').meta?.publicRead).toBe(true);
  });
});

describe('auth guards', () => {
  it('401s a missing bearer db-free on the owner list', async () => {
    setMapsGuardDbForTests({
      accountAndScopeForToken: vi.fn(async () => {
        throw new Error('db must not be consulted for a missing bearer');
      }),
    });
    const res = await runRoute('GET', '/api/maps');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
  });

  it('accepts a read-scope token on the owner list (read guard)', async () => {
    setMapsGuardDbForTests({
      accountAndScopeForToken: scopeOf('read'),
      moderationStatusForAccount: async () => modStatus(),
    });
    fakeService({ listMine: async () => [] });
    const res = await runRoute('GET', '/api/maps', { headers: { authorization: BEARER } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ maps: [] });
  });

  it('403s a read-scope token on create (active guard)', async () => {
    setMapsGuardDbForTests({
      accountAndScopeForToken: scopeOf('read'),
      moderationStatusForAccount: async () => modStatus(),
    });
    const res = await runRoute('POST', '/api/maps', { headers: { authorization: BEARER } });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'this token is read-only', code: 'auth.forbidden' });
  });

  it('403s a locked account with the moderation body', async () => {
    setMapsGuardDbForTests({
      accountAndScopeForToken: scopeOf('full'),
      moderationStatusForAccount: async () =>
        modStatus({ locked: true, banned: true, message: 'This account has been banned.' }),
    });
    const res = await runRoute('POST', '/api/maps', { headers: { authorization: BEARER } });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('This account has been banned.');
  });

  it('the READ guard still applies the moderation gate (a banned read token cannot list)', async () => {
    setMapsGuardDbForTests({
      accountAndScopeForToken: scopeOf('read'),
      moderationStatusForAccount: async () =>
        modStatus({ locked: true, banned: true, message: 'This account has been banned.' }),
    });
    const listMine = vi.fn();
    fakeService({ listMine });
    const res = await runRoute('GET', '/api/maps', { headers: { authorization: BEARER } });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('This account has been banned.');
    expect(listMine).not.toHaveBeenCalled();
  });
});

describe('the pre-auth Content-Length 413 guard', () => {
  it('413s an oversize declared save before auth, with Connection: close', async () => {
    const accountReads = vi.fn(async () => {
      throw new Error('auth must not run after the 413 short-circuit');
    });
    setMapsGuardDbForTests({ accountAndScopeForToken: accountReads });
    const res = await runRoute('POST', '/api/maps', {
      headers: { 'content-length': '999999999' },
    });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'map_too_large' });
    expect(res.headers.connection).toBe('close');
    expect(accountReads).not.toHaveBeenCalled();
  });
});

describe('the shared mutation limiter (coded 429, shared bucket)', () => {
  it('throws the coded rate_limit.exceeded once the legacy bucket is drained', async () => {
    // Drain the SHARED legacy bucket directly (same fused fn the legacy arm
    // checks), proving one bucket serves both dispatch paths.
    const req = { headers: {}, socket: { remoteAddress: '10.9.9.9' } } as http.IncomingMessage;
    for (let i = 0; i < MAP_MUTATION_MAX_PER_MINUTE; i++) {
      mapMutationRateLimited(req, CALLER);
    }
    fakeService({
      createMap: async () => ({ ok: true as const, map: mapRecord() }),
    });
    const res = await runRoute('POST', '/api/maps', {
      headers: { authorization: BEARER },
      body: { name: 'x', doc: {} },
    });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('rate_limit.exceeded');
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('requireOwnedMap deny-by-default', () => {
  it('404s a missing map with the legacy body and never reaches the service write', async () => {
    const deleteMap = vi.fn();
    fakeService({ getMapForViewer: async () => null, deleteMap });
    const res = await runRoute('DELETE', '/api/maps/:id', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      url: '/api/maps/5',
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'map_not_found' });
    expect(deleteMap).not.toHaveBeenCalled();
  });

  it('denies mutation of a PUBLIC map someone else owns (visible to the viewer, not owned)', async () => {
    const setPublished = vi.fn();
    fakeService({
      getMapForViewer: async () => mapRecord({ accountId: 999, status: 'public' }),
      setPublished,
    });
    const res = await runRoute('POST', '/api/maps/:id/unpublish', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      url: '/api/maps/5/unpublish',
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'map_not_found' });
    expect(setPublished).not.toHaveBeenCalled();
  });

  it('422s a non-numeric :id at the decoder for an authenticated caller', async () => {
    const getMapForViewer = vi.fn();
    fakeService({ getMapForViewer });
    const res = await runRoute('DELETE', '/api/maps/:id', {
      headers: { authorization: BEARER },
      params: { id: 'abc' },
      url: '/api/maps/abc',
    });
    expect(res.status).toBe(422);
    expect(getMapForViewer).not.toHaveBeenCalled();
  });

  it('passes an owned map through to the handler (delete happy path)', async () => {
    const deleteMap = vi.fn(async () => true);
    fakeService({ getMapForViewer: async () => mapRecord(), deleteMap });
    const res = await runRoute('DELETE', '/api/maps/:id', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      url: '/api/maps/5',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(deleteMap).toHaveBeenCalledWith(CALLER, 5);
  });
});

describe('thin-handler happy paths (shared cores over a fake service)', () => {
  it('POST /api/maps creates and answers the summary shape (no doc)', async () => {
    const createMap = vi.fn(async () => ({ ok: true as const, map: mapRecord() }));
    fakeService({ createMap });
    const res = await runRoute('POST', '/api/maps', {
      headers: { authorization: BEARER },
      body: { name: 'My Map', doc: { some: 'doc' } },
    });
    expect(res.status).toBe(200);
    expect(createMap).toHaveBeenCalledWith(CALLER, 'My Map', { some: 'doc' });
    const map = res.body.map as Record<string, unknown>;
    expect(map.id).toBe(5);
    expect(map.doc).toBeUndefined();
  });

  it('PUT /api/maps/:id saves through the version check and surfaces version_conflict with the current version', async () => {
    fakeService({
      getMapForViewer: async () => mapRecord(),
      saveMap: async () => ({
        ok: false as const,
        error: 'version_conflict' as const,
        currentVersion: 9,
      }),
    });
    const res = await runRoute('PUT', '/api/maps/:id', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      url: '/api/maps/5',
      body: { doc: {}, version: 3 },
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'version_conflict', version: 9 });
  });

  it('POST /api/maps/:id/fork answers the FULL document and delegates access to the service', async () => {
    const forkMap = vi.fn(async () => ({ ok: true as const, map: mapRecord({ id: 6 }) }));
    fakeService({ forkMap });
    const res = await runRoute('POST', '/api/maps/:id/fork', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      url: '/api/maps/5/fork',
      body: { name: 'Copy' },
    });
    expect(res.status).toBe(200);
    expect(forkMap).toHaveBeenCalledWith(CALLER, 5, 'Copy');
    const map = res.body.map as Record<string, unknown>;
    expect(map.id).toBe(6);
    expect(map.doc).toBeDefined();
  });

  it('POST /api/maps/:id/publish flips visibility for the owner', async () => {
    const setPublished = vi.fn(async () => true);
    fakeService({ getMapForViewer: async () => mapRecord(), setPublished });
    const res = await runRoute('POST', '/api/maps/:id/publish', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      url: '/api/maps/5/publish',
    });
    expect(res.status).toBe(200);
    expect(setPublished).toHaveBeenCalledWith(CALLER, 5, true);
  });

  it('GET /api/maps/public answers rows + paging (public, no auth)', async () => {
    fakeService({
      listPublic: async () => ({ rows: [mapRecord({ status: 'public' })], total: 1 }),
    });
    const res = await runRoute('GET', '/api/maps/public', { url: '/api/maps/public?page=2' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.page).toBe(2);
  });
});

describe('the optional-auth public :id read', () => {
  it('serves a public map anonymously (viewer null) with the full document', async () => {
    const getMapForViewer = vi.fn(async () => mapRecord({ accountId: 999, status: 'public' }));
    fakeService({ getMapForViewer });
    const res = await runRoute('GET', '/api/maps/:id', {
      params: { id: '5' },
      url: '/api/maps/5',
    });
    expect(res.status).toBe(200);
    expect(getMapForViewer).toHaveBeenCalledWith(null, 5);
    expect((res.body.map as Record<string, unknown>).doc).toBeDefined();
  });

  it('resolves a presented bearer to the viewer account (owner sees a private map)', async () => {
    const getMapForViewer = vi.fn(async () => mapRecord());
    fakeService({ getMapForViewer });
    setMapsGuardDbForTests({ accountForToken: async () => CALLER });
    const res = await runRoute('GET', '/api/maps/:id', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      url: '/api/maps/5',
    });
    expect(res.status).toBe(200);
    expect(getMapForViewer).toHaveBeenCalledWith(CALLER, 5);
  });

  it('answers the ladder terminal 404 for a non-numeric :id (shape parity with the legacy regex)', async () => {
    const getMapForViewer = vi.fn();
    fakeService({ getMapForViewer });
    const res = await runRoute('GET', '/api/maps/:id', {
      params: { id: 'abc' },
      url: '/api/maps/abc',
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'unknown endpoint' });
    expect(getMapForViewer).not.toHaveBeenCalled();
  });
});

describe('the guard-before-shape-check legs (mapsAssetsIdParamDecode ledger)', () => {
  it('an unauthenticated non-numeric fork 401s at the guard (legacy fell to the terminal 404)', async () => {
    // Legacy: mapForkMatch (\d+) rejects "abc/fork" before the bearer is read, so
    // the ladder answers 404 unknown endpoint. New: activeGuard runs first, so the
    // same request answers the auth 401. Recorded in mapsAssetsIdParamDecode;
    // pinned here because the parity corpus replays numeric ids only.
    const forkMap = vi.fn();
    fakeService({ forkMap });
    const res = await runRoute('POST', '/api/maps/:id/fork', {
      params: { id: 'abc' },
      url: '/api/maps/abc/fork',
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
    expect(forkMap).not.toHaveBeenCalled();
  });

  it('an authenticated non-numeric fork answers the terminal 404 after the guards', async () => {
    const forkMap = vi.fn();
    fakeService({ forkMap });
    const res = await runRoute('POST', '/api/maps/:id/fork', {
      headers: { authorization: BEARER },
      params: { id: 'abc' },
      url: '/api/maps/abc/fork',
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'unknown endpoint' });
    expect(forkMap).not.toHaveBeenCalled();
  });
});
