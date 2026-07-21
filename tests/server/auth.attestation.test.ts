// Unit coverage for the auth migration (server/auth_routes.ts +
// server/http/middleware/turnstile.ts). Three surfaces are pinned here without a
// live server or Postgres:
//   (a) the native-attestation challenge handler, driven through the exported
//       `routes` array with a fakeCtx (it needs no injected runtime),
//   (b) the shared per-route Turnstile gate, driven directly with an injected
//       verifier and a nextGuard, and
//   (c) the `routes` table shape (method/path/surface + the per-route middleware
//       lengths that encode the legacy cheap-reject-first check order).
// The full old-vs-new byte parity lives in the dual-path harness; this file pins
// the units. It follows the tests/server/leaderboard.test.ts template.

// server/db.ts constructs a pg Pool at module load and throws if DATABASE_URL is
// unset; auth_routes.ts imports it, so set a dummy URL. The pool never connects:
// the challenge handler touches no db, and the turnstile tests drive the
// middleware directly with an injected verifier.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase11_auth_attest';

import type * as http from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { routes } from '../../server/auth_routes';
import { turnstile } from '../../server/http/middleware/turnstile';
import { createNativeAttestationChallenge } from '../../server/native_attestation';
import { type FakeRes, fakeCtx, nextGuard } from './helpers';

// Spy the challenge minter while DELEGATING to the real implementation: the shape
// assertions still observe real challengeId/nonce/expiresInMs values, and the
// pass-through assertions can read the exact `action` the handler threads (the action
// is stored inside the challenge, never echoed in the response, so a spy is the only
// way to catch a regression that drops body.action and always mints the default).
vi.mock('../../server/native_attestation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/native_attestation')>();
  return {
    ...actual,
    createNativeAttestationChallenge: vi.fn(actual.createNativeAttestationChallenge),
  };
});

// ---------------------------------------------------------------------------
// Local helpers (mirroring the leaderboard.test.ts template).
// ---------------------------------------------------------------------------

/** Read a handler's response off the fakeCtx's FakeRes. */
function captured(res: http.ServerResponse): { status: number; body: unknown } {
  const fake = res as unknown as FakeRes;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

/** Grab a registered handler by its route path. */
function handlerFor(path: string) {
  const route = routes.find((r) => r.path === path);
  if (!route) throw new Error(`no route registered for ${path}`);
  return route.handler;
}

const CHALLENGE_PATH = '/api/native-attestation/challenge';

// ---------------------------------------------------------------------------
// PART A: the native-attestation challenge handler.
// ---------------------------------------------------------------------------

describe('native-attestation challenge handler (POST /api/native-attestation/challenge)', () => {
  it('returns 200 with a nonempty challengeId, nonempty nonce, and a positive expiresInMs', async () => {
    const ctx = fakeCtx({ method: 'POST', url: CHALLENGE_PATH, body: {} });
    await handlerFor(CHALLENGE_PATH)(ctx);
    const { status, body } = captured(ctx.res);
    expect(status).toBe(200);
    const b = body as { challengeId: string; nonce: string; expiresInMs: number };
    expect(typeof b.challengeId).toBe('string');
    expect(b.challengeId.length).toBeGreaterThan(0);
    expect(typeof b.nonce).toBe('string');
    expect(b.nonce.length).toBeGreaterThan(0);
    expect(typeof b.expiresInMs).toBe('number');
    expect(b.expiresInMs).toBeGreaterThan(0);
  });

  it('issues a DIFFERENT challengeId and nonce on two separate calls (both random)', async () => {
    const first = fakeCtx({ method: 'POST', url: CHALLENGE_PATH, body: {} });
    await handlerFor(CHALLENGE_PATH)(first);
    const second = fakeCtx({ method: 'POST', url: CHALLENGE_PATH, body: {} });
    await handlerFor(CHALLENGE_PATH)(second);
    const a = captured(first.res).body as { challengeId: string; nonce: string };
    const c = captured(second.res).body as { challengeId: string; nonce: string };
    expect(a.challengeId).not.toBe(c.challengeId);
    expect(a.nonce).not.toBe(c.nonce);
  });

  it('accepts a string action and still returns the same 200 shape', async () => {
    const ctx = fakeCtx({ method: 'POST', url: CHALLENGE_PATH, body: { action: 'link' } });
    await handlerFor(CHALLENGE_PATH)(ctx);
    const { status, body } = captured(ctx.res);
    expect(status).toBe(200);
    const b = body as { challengeId: string; nonce: string; expiresInMs: number };
    expect(b.challengeId.length).toBeGreaterThan(0);
    expect(b.nonce.length).toBeGreaterThan(0);
    expect(b.expiresInMs).toBeGreaterThan(0);
  });

  it('tolerates a non-string action (defaults to auth internally) and still returns 200', async () => {
    const ctx = fakeCtx({ method: 'POST', url: CHALLENGE_PATH, body: { action: 5 } });
    await handlerFor(CHALLENGE_PATH)(ctx);
    const { status, body } = captured(ctx.res);
    expect(status).toBe(200);
    const b = body as { challengeId: string; nonce: string; expiresInMs: number };
    expect(b.challengeId.length).toBeGreaterThan(0);
    expect(b.nonce.length).toBeGreaterThan(0);
    expect(b.expiresInMs).toBeGreaterThan(0);
  });

  it('threads a string action through to the challenge minter (pass-through, not ignored)', async () => {
    const mint = vi.mocked(createNativeAttestationChallenge);
    mint.mockClear();
    const ctx = fakeCtx({ method: 'POST', url: CHALLENGE_PATH, body: { action: 'link' } });
    await handlerFor(CHALLENGE_PATH)(ctx);
    expect(mint).toHaveBeenCalledTimes(1);
    // createNativeAttestationChallenge(req, action): the second arg is the threaded action.
    expect(mint.mock.calls[0][1]).toBe('link');
  });

  it('defaults a non-string action to "auth" when threading to the challenge minter', async () => {
    const mint = vi.mocked(createNativeAttestationChallenge);
    mint.mockClear();
    const ctx = fakeCtx({ method: 'POST', url: CHALLENGE_PATH, body: { action: 5 } });
    await handlerFor(CHALLENGE_PATH)(ctx);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(mint.mock.calls[0][1]).toBe('auth');
  });

  it('carries no anti-bot guard: exactly one middleware (withBody), no turnstile gate', () => {
    const route = routes.find((r) => r.path === CHALLENGE_PATH);
    expect(route?.middleware).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// PART B: the shared per-route Turnstile gate.
// ---------------------------------------------------------------------------

describe('turnstile middleware', () => {
  it('calls next() and writes no response when verify resolves true', async () => {
    const mw = turnstile({ verify: async () => true });
    const ctx = fakeCtx({ method: 'POST', body: {} });
    let ran = false;
    await mw(
      ctx,
      nextGuard(() => {
        ran = true;
      }),
    );
    expect(ran).toBe(true);
    expect((ctx.res as unknown as FakeRes).writableEnded).toBe(false);
    const { status, body } = captured(ctx.res);
    expect(status).toBe(200);
    expect(body).toBeUndefined();
  });

  it('answers 403 with the legacy body and does NOT call next() when verify resolves false', async () => {
    const mw = turnstile({ verify: async () => false });
    const ctx = fakeCtx({ method: 'POST', body: {} });
    let ran = false;
    await mw(
      ctx,
      nextGuard(() => {
        ran = true;
      }),
    );
    expect(ran).toBe(false);
    expect(captured(ctx.res)).toEqual({
      status: 403,
      body: { error: 'verification failed, please try again', code: 'auth.verification_failed' },
    });
  });

  it('passes (ctx.req, ctx.body) through to the verifier', async () => {
    let seenReq: http.IncomingMessage | undefined;
    let seenBody: Record<string, unknown> | undefined;
    const mw = turnstile({
      verify: async (req, body) => {
        seenReq = req;
        seenBody = body;
        return true;
      },
    });
    const ctx = fakeCtx({ method: 'POST', body: { turnstileToken: 'abc' } });
    await mw(ctx, nextGuard());
    expect(seenReq).toBe(ctx.req);
    expect(seenBody?.turnstileToken).toBe('abc');
  });
});

// ---------------------------------------------------------------------------
// PART C: the auth `routes` array shape.
// ---------------------------------------------------------------------------

describe('auth routes table shape', () => {
  it('registers exactly the three credential POST routes on the api surface', () => {
    expect(routes).toHaveLength(3);
    const shape = routes.map((r) => ({ method: r.method, path: r.path }));
    expect(shape).toEqual([
      { method: 'POST', path: '/api/register' },
      { method: 'POST', path: '/api/login' },
      { method: 'POST', path: '/api/native-attestation/challenge' },
    ]);
    for (const r of routes) {
      expect(r.surface).toBe('api');
      expect(typeof r.handler).toBe('function');
    }
  });

  it('wires each route the legacy check order: register 5, login 4, challenge 1 middleware', () => {
    const mwLen = (path: string) => routes.find((r) => r.path === path)?.middleware?.length;
    expect(mwLen('/api/register')).toBe(5);
    expect(mwLen('/api/login')).toBe(4);
    expect(mwLen(CHALLENGE_PATH)).toBe(1);
  });
});
