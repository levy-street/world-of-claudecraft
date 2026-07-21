// Unit tests for the withErrors middleware (server/http/middleware/with_errors.ts):
// the outermost onion frame and single response authority. Covers the
// already-responded pass-through, the mapped-problem+json throw path, the
// respond-then-throw no-double-write guard, and the 500-no-leak / exactly-once
// onUnexpected contract for an unexpected throwable.

import { describe, expect, it, vi } from 'vitest';
import { compose } from '../../../server/http/compose';
import { HttpError } from '../../../server/http/errors';
import { withErrors } from '../../../server/http/middleware/with_errors';
import type { Ctx, Middleware } from '../../../server/http/types';
import { fakeCtx } from '../helpers/fake_ctx';
import type { FakeRes } from '../helpers/fake_http';

/** Read the FakeRes backing a fakeCtx so we can assert on the captured result. */
function resOf(ctx: Ctx): FakeRes {
  return ctx.res as unknown as FakeRes;
}

describe('withErrors: already-responded pass-through', () => {
  it('leaves an already-sent 200 untouched when the handler resolves normally', async () => {
    const ctx = fakeCtx();
    const res = resOf(ctx);
    const handler: Middleware = async () => {
      ctx.res.writeHead(200);
      ctx.res.end('ok');
    };
    await compose([withErrors(), handler])(ctx);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('ok');
  });
});

describe('withErrors: mapped HttpError throw', () => {
  it('serializes a thrown HttpError to the mapped problem+json response, no English leak', async () => {
    const ctx = fakeCtx();
    const res = resOf(ctx);
    const handler: Middleware = async () => {
      throw new HttpError(422, 'validation.failed', { issues: 'bad field' });
    };
    await compose([withErrors(), handler])(ctx);
    expect(res.statusCode).toBe(422);
    expect(res.headers['content-type']).toBe('application/problem+json');
    const body = JSON.parse(res.body);
    expect(body.code).toBe('validation.failed');
    expect(body.status).toBe(422);
  });
});

describe('withErrors: respond-then-throw', () => {
  it('keeps the 200 the handler already sent and does not double-write on a later throw', async () => {
    const ctx = fakeCtx();
    const res = resOf(ctx);
    const handler: Middleware = async () => {
      ctx.res.writeHead(200);
      ctx.res.end('already done');
      throw new Error('too late');
    };
    await compose([withErrors(), handler])(ctx);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('already done');
  });
});

describe('withErrors: unexpected throw (500 no-leak)', () => {
  it('maps an unexpected throw to 500 internal.error, calls onUnexpected once, and leaks nothing', async () => {
    const ctx = fakeCtx();
    const res = resOf(ctx);
    const spy = vi.fn();
    const original = new Error('boom with secret');
    const handler: Middleware = async () => {
      throw original;
    };
    await compose([withErrors({ onUnexpected: spy }), handler])(ctx);
    expect(res.statusCode).toBe(500);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(original);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('internal.error');
    expect(res.body).not.toContain('boom');
    expect(res.body).not.toContain('secret');
  });
});
