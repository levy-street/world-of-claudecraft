// Unit tests for the withCors middleware (server/http/middleware/cors.ts):
// the 'api' reflected-origin allowlist, the 'public' unconditional wildcard,
// and that the headers are set before next() so a downstream error response
// (mapped by withErrors) still carries them.

import { describe, expect, it } from 'vitest';
import { compose } from '../../../server/http/compose';
import { withCors } from '../../../server/http/middleware/cors';
import { withErrors } from '../../../server/http/middleware/with_errors';
import type { Ctx, Middleware } from '../../../server/http/types';
import { DESKTOP_APP_ORIGINS, NATIVE_APP_ORIGINS } from '../../../server/web_login_guard';
import { fakeCtx } from '../helpers/fake_ctx';
import type { FakeRes } from '../helpers/fake_http';

function resOf(ctx: Ctx): FakeRes {
  return ctx.res as unknown as FakeRes;
}

const throwingMw: Middleware = async () => {
  throw new Error('downstream failure');
};

describe('withCors: api allow class', () => {
  it('reflects an allowed origin with the full CORS header set', async () => {
    const ctx = fakeCtx({ headers: { origin: 'https://claudemoon.example.com' } });
    const res = resOf(ctx);
    await compose([withCors('api', () => true), async (_ctx, next) => next()])(ctx);
    expect(res.headers['access-control-allow-origin']).toBe('https://claudemoon.example.com');
    expect(res.headers.vary).toBe('Origin');
    expect(res.headers['access-control-allow-methods']).toBe('GET, POST, PUT, DELETE, OPTIONS');
    expect(res.headers['access-control-allow-headers']).toBe('Authorization, Content-Type');
    expect(res.headers['access-control-max-age']).toBe('600');
  });

  it('still carries the CORS headers on a downstream error mapped by withErrors', async () => {
    const ctx = fakeCtx({ headers: { origin: 'https://claudemoon.example.com' } });
    const res = resOf(ctx);
    await compose([withErrors(), withCors('api', () => true), throwingMw])(ctx);
    expect(res.statusCode).toBe(500);
    expect(res.headers['access-control-allow-origin']).toBe('https://claudemoon.example.com');
    expect(res.headers.vary).toBe('Origin');
  });

  it('sets no Access-Control-Allow-Origin header for a disallowed origin', async () => {
    const ctx = fakeCtx({ headers: { origin: 'https://evil.example.com' } });
    const res = resOf(ctx);
    await compose([withCors('api', () => false), async (_ctx, next) => next()])(ctx);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets no Access-Control-Allow-Origin header when the request has no Origin at all', async () => {
    const ctx = fakeCtx();
    const res = resOf(ctx);
    await compose([withCors('api', () => true), async (_ctx, next) => next()])(ctx);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('withCors: api default allow predicate (defaultApiAllow)', () => {
  it('reflects a NATIVE_APP_ORIGINS member with the SHIPPING predicate (no injected allow)', async () => {
    const allowed = [...NATIVE_APP_ORIGINS][0];
    const ctx = fakeCtx({ headers: { origin: allowed } });
    const res = resOf(ctx);
    await compose([withCors('api'), async (_ctx, next) => next()])(ctx);
    expect(res.headers['access-control-allow-origin']).toBe(allowed);
  });

  it('reflects a DESKTOP_APP_ORIGINS member with the SHIPPING predicate (v0.19.0 Electron shell parity with maybeCors)', async () => {
    const allowed = [...DESKTOP_APP_ORIGINS][0];
    const ctx = fakeCtx({ headers: { origin: allowed } });
    const res = resOf(ctx);
    await compose([withCors('api'), async (_ctx, next) => next()])(ctx);
    expect(res.headers['access-control-allow-origin']).toBe(allowed);
  });

  it('does not reflect an origin outside the REALM/NATIVE/DESKTOP allowlist with the shipping predicate', async () => {
    const ctx = fakeCtx({ headers: { origin: 'https://not-an-allowed-origin.example.com' } });
    const res = resOf(ctx);
    await compose([withCors('api'), async (_ctx, next) => next()])(ctx);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('withCors: public allow class', () => {
  it('sets the wildcard origin and the GET/OPTIONS method set unconditionally', async () => {
    const ctx = fakeCtx({ headers: { origin: 'https://anywhere.example.com' } });
    const res = resOf(ctx);
    await compose([withCors('public'), async (_ctx, next) => next()])(ctx);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers.vary).toBe('Origin');
    expect(res.headers['access-control-allow-methods']).toBe('GET, OPTIONS');
    expect(res.headers['access-control-allow-headers']).toBe('Authorization, Content-Type');
    expect(res.headers['access-control-max-age']).toBe('600');
  });

  it('sets the wildcard even with no Origin header at all', async () => {
    const ctx = fakeCtx();
    const res = resOf(ctx);
    await compose([withCors('public'), async (_ctx, next) => next()])(ctx);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});
