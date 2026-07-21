// Unit tests for the shared-secret header gate middleware
// (server/http/middleware/require_internal_secret.ts): the anti-enumeration gate
// the /internal ops surface mounts. Driven directly (no compose/onion runtime):
// build a requireInternalSecret middleware over a TEST-ONLY (header, env) pair so
// the real ops secrets are never touched, then call it with a fakeCtx + a next
// spy. A few cases exercise the REAL exported pairs.
//
// PARITY-FIRST: a reject writes the legacy { success, data, error } bodies
// byte-for-byte (feature-off 404 when the env secret is unset, 401 on a
// mismatch); a match awaits next() and writes nothing. The env var is read PER
// REQUEST, so toggling it between requests flips the gate.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEPLOY_SECRET_ENV,
  DEPLOY_SECRET_HEADER,
  DISCORD_SECRET_ENV,
  DISCORD_SECRET_HEADER,
  requireInternalSecret,
} from '../../../server/http/middleware/require_internal_secret';
import type { Ctx } from '../../../server/http/types';
import { fakeCtx } from '../helpers/fake_ctx';
import type { FakeRes } from '../helpers/fake_http';

// A test-only gate pair: enforcing it never reads or writes a real ops secret.
const TEST_HEADER = 'x-test-secret';
const TEST_ENV = 'TEST_INTERNAL_SECRET_ENV';
const SECRET = 'super-secret-value';
// A different value of the SAME byte length as SECRET (18 bytes): the
// timingSafeEqual value path, not the length guard.
const WRONG_SAME_LENGTH = 'wrong-secret-value';
// A different value of a DIFFERENT byte length: the length guard short-circuit.
const WRONG_SHORTER = 'nope';

// The legacy fail() bodies, frozen for byte parity with server/internal.ts.
const FEATURE_OFF_JSON = '{"success":false,"data":null,"error":"unknown endpoint"}';
const NOT_AUTHENTICATED_JSON = '{"success":false,"data":null,"error":"not authenticated"}';

// Every env var any test in this file may touch; snapshotted and restored so the
// suite leaves the real ops secrets exactly as it found them.
const TOUCHED_ENV = [TEST_ENV, DEPLOY_SECRET_ENV, DISCORD_SECRET_ENV];

/** Read the FakeRes backing a fakeCtx so we can assert on the captured result. */
function resOf(ctx: Ctx): FakeRes {
  return ctx.res as unknown as FakeRes;
}

/** A no-op next() spy typed for the middleware; its call count is the signal. */
function makeNext() {
  return vi.fn(async () => {});
}

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of TOUCHED_ENV) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of TOUCHED_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('requireInternalSecret: feature-off 404 (env unset or empty)', () => {
  it('writes the legacy 404 body byte-for-byte and does not call next when the env is unset', async () => {
    // TEST_ENV was deleted in beforeEach: the endpoint hides entirely.
    const mw = requireInternalSecret({ header: TEST_HEADER, envVar: TEST_ENV });
    const ctx = fakeCtx({ headers: { [TEST_HEADER]: SECRET } });
    const res = resOf(ctx);
    const next = makeNext();

    await mw(ctx, next);

    expect(res.statusCode).toBe(404);
    expect(res.body).toBe(FEATURE_OFF_JSON);
    expect(JSON.parse(res.body)).toEqual({
      success: false,
      data: null,
      error: 'unknown endpoint',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('treats an empty-string env value as feature-off (same 404)', async () => {
    process.env[TEST_ENV] = '';
    const mw = requireInternalSecret({ header: TEST_HEADER, envVar: TEST_ENV });
    const ctx = fakeCtx({ headers: { [TEST_HEADER]: SECRET } });
    const res = resOf(ctx);
    const next = makeNext();

    await mw(ctx, next);

    expect(res.statusCode).toBe(404);
    expect(res.body).toBe(FEATURE_OFF_JSON);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireInternalSecret: 401 on a missing or mismatched secret', () => {
  it('writes the legacy 401 body and does not call next when the header is absent', async () => {
    process.env[TEST_ENV] = SECRET;
    const mw = requireInternalSecret({ header: TEST_HEADER, envVar: TEST_ENV });
    const ctx = fakeCtx();
    const res = resOf(ctx);
    const next = makeNext();

    await mw(ctx, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toBe(NOT_AUTHENTICATED_JSON);
    expect(JSON.parse(res.body)).toEqual({
      success: false,
      data: null,
      error: 'not authenticated',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for a wrong secret of the SAME length (the timingSafeEqual value path)', async () => {
    process.env[TEST_ENV] = SECRET;
    const mw = requireInternalSecret({ header: TEST_HEADER, envVar: TEST_ENV });
    const ctx = fakeCtx({ headers: { [TEST_HEADER]: WRONG_SAME_LENGTH } });
    const res = resOf(ctx);
    const next = makeNext();

    await mw(ctx, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toBe(NOT_AUTHENTICATED_JSON);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 (no throw) for a wrong secret of a DIFFERENT length (the length guard)', async () => {
    // Without the length guard, timingSafeEqual would throw a RangeError on
    // unequal-length buffers; resolving to a clean 401 proves the guard fires.
    process.env[TEST_ENV] = SECRET;
    const mw = requireInternalSecret({ header: TEST_HEADER, envVar: TEST_ENV });
    const ctx = fakeCtx({ headers: { [TEST_HEADER]: WRONG_SHORTER } });
    const res = resOf(ctx);
    const next = makeNext();

    await expect(mw(ctx, next)).resolves.toBeUndefined();

    expect(res.statusCode).toBe(401);
    expect(res.body).toBe(NOT_AUTHENTICATED_JSON);
    expect(next).not.toHaveBeenCalled();
  });

  it('never echoes the presented or expected secret on the 401 path', async () => {
    process.env[TEST_ENV] = SECRET;
    const mw = requireInternalSecret({ header: TEST_HEADER, envVar: TEST_ENV });
    const ctx = fakeCtx({ headers: { [TEST_HEADER]: WRONG_SAME_LENGTH } });
    const res = resOf(ctx);

    await mw(ctx, makeNext());

    const serializedHeaders = JSON.stringify(res.headers);
    for (const leak of [SECRET, WRONG_SAME_LENGTH]) {
      expect(res.body).not.toContain(leak);
      expect(serializedHeaders).not.toContain(leak);
    }
  });
});

describe('requireInternalSecret: match', () => {
  it('calls next exactly once and writes nothing to the response', async () => {
    process.env[TEST_ENV] = SECRET;
    const mw = requireInternalSecret({ header: TEST_HEADER, envVar: TEST_ENV });
    const ctx = fakeCtx({ headers: { [TEST_HEADER]: SECRET } });
    const res = resOf(ctx);
    const next = makeNext();

    await mw(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    // The response is untouched: no status, no body, no committed headers.
    expect(res.headersSent).toBe(false);
    expect(res.writableEnded).toBe(false);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
  });

  it('matches a mixed-case sent header (node lowercases header names)', async () => {
    process.env[TEST_ENV] = SECRET;
    const mw = requireInternalSecret({ header: TEST_HEADER, envVar: TEST_ENV });
    // The gate header is lowercase; a caller sending mixed case still matches
    // because makeReq lower-cases header names exactly as node does.
    const ctx = fakeCtx({ headers: { 'X-Test-Secret': SECRET } });
    const res = resOf(ctx);
    const next = makeNext();

    await mw(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headersSent).toBe(false);
    expect(res.body).toBe('');
  });
});

describe('requireInternalSecret: per-request env read', () => {
  it('reads process.env on every request, not once at build time', async () => {
    // ONE instance. First request: env unset -> feature-off 404 even though the
    // header carries the (future) secret.
    const mw = requireInternalSecret({ header: TEST_HEADER, envVar: TEST_ENV });

    const firstCtx = fakeCtx({ headers: { [TEST_HEADER]: SECRET } });
    const firstRes = resOf(firstCtx);
    const firstNext = makeNext();
    await mw(firstCtx, firstNext);
    expect(firstRes.statusCode).toBe(404);
    expect(firstNext).not.toHaveBeenCalled();

    // Now set the env and re-drive the SAME instance: the gate is live.
    process.env[TEST_ENV] = SECRET;
    const secondCtx = fakeCtx({ headers: { [TEST_HEADER]: SECRET } });
    const secondRes = resOf(secondCtx);
    const secondNext = makeNext();
    await mw(secondCtx, secondNext);
    expect(secondNext).toHaveBeenCalledTimes(1);
    expect(secondRes.headersSent).toBe(false);
    expect(secondRes.body).toBe('');
  });
});

describe('requireInternalSecret: real exported (header, env) pairs', () => {
  it('deploy pair: feature-off 404 when RESTART_COUNTDOWN_SECRET is unset', async () => {
    const mw = requireInternalSecret({ header: DEPLOY_SECRET_HEADER, envVar: DEPLOY_SECRET_ENV });
    const ctx = fakeCtx({ headers: { [DEPLOY_SECRET_HEADER]: SECRET } });
    const res = resOf(ctx);
    const next = makeNext();

    await mw(ctx, next);

    expect(res.statusCode).toBe(404);
    expect(res.body).toBe(FEATURE_OFF_JSON);
    expect(next).not.toHaveBeenCalled();
  });

  it('deploy pair: match calls next when RESTART_COUNTDOWN_SECRET is set', async () => {
    process.env[DEPLOY_SECRET_ENV] = SECRET;
    const mw = requireInternalSecret({ header: DEPLOY_SECRET_HEADER, envVar: DEPLOY_SECRET_ENV });
    const ctx = fakeCtx({ headers: { [DEPLOY_SECRET_HEADER]: SECRET } });
    const res = resOf(ctx);
    const next = makeNext();

    await mw(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headersSent).toBe(false);
    expect(res.body).toBe('');
  });

  it('discord pair: 401 on a mismatch when DISCORD_BOT_SECRET is set', async () => {
    process.env[DISCORD_SECRET_ENV] = SECRET;
    const mw = requireInternalSecret({ header: DISCORD_SECRET_HEADER, envVar: DISCORD_SECRET_ENV });
    const ctx = fakeCtx({ headers: { [DISCORD_SECRET_HEADER]: WRONG_SAME_LENGTH } });
    const res = resOf(ctx);
    const next = makeNext();

    await mw(ctx, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toBe(NOT_AUTHENTICATED_JSON);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireInternalSecret: exported constants (single source of truth)', () => {
  it('pins the header and env names the route tables consume', () => {
    expect(DEPLOY_SECRET_HEADER).toBe('x-woc-deploy-secret');
    expect(DEPLOY_SECRET_ENV).toBe('RESTART_COUNTDOWN_SECRET');
    expect(DISCORD_SECRET_HEADER).toBe('x-woc-discord-secret');
    expect(DISCORD_SECRET_ENV).toBe('DISCORD_BOT_SECRET');
  });
});
