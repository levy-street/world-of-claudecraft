// Tests for the JSON body middleware (server/http/middleware/body.ts). withBody
// is driven directly (no compose/onion runtime): call it with a fakeCtx and a
// nextGuard, and assert on the thrown HttpError or the resulting ctx.body.

import { describe, expect, it } from 'vitest';
import { HttpError, mapError } from '../../../server/http/errors';
import { withBody } from '../../../server/http/middleware/body';
import { DEFAULT_JSON_BODY_MAX_BYTES } from '../../../server/http_util';
import { fakeCtx, nextGuard } from '../helpers/fake_ctx';
import { makeReq } from '../helpers/fake_http';

describe('withBody: over-cap body', () => {
  it('rejects with HttpError 413 body.too_large carrying the cap', async () => {
    const cap = 16;
    const ctx = fakeCtx({
      method: 'POST',
      req: makeReq({ method: 'POST', body: 'x'.repeat(100) }),
    });
    const middleware = withBody(cap);
    await expect(middleware(ctx, nextGuard())).rejects.toMatchObject({
      status: 413,
      code: 'body.too_large',
      params: { maxBytes: cap },
    });
  });

  it('serializes to a problem+json 413 via mapError', async () => {
    const ctx = fakeCtx({
      method: 'POST',
      req: makeReq({ method: 'POST', body: 'x'.repeat(100) }),
    });
    try {
      await withBody(16)(ctx, nextGuard());
      throw new Error('expected withBody to reject');
    } catch (err) {
      const serialized = mapError(err, fakeCtx(), { surface: 'problem' });
      expect(serialized.status).toBe(413);
      expect(JSON.parse(serialized.body).code).toBe('body.too_large');
    }
  });

  it('drains the request stream on overflow so the socket does not hang', async () => {
    const req = makeReq({ method: 'POST', body: 'x'.repeat(100) });
    const ctx = fakeCtx({ method: 'POST', req });
    await expect(withBody(16)(ctx, nextGuard())).rejects.toBeInstanceOf(HttpError);
    // readBody destroys the stream on overflow (server/http_util.ts); the
    // request stream is a node Readable, so `destroyed` reflects that.
    expect((req as unknown as { destroyed: boolean }).destroyed).toBe(true);
  });
});

describe('withBody: malformed JSON', () => {
  it('rejects with HttpError 400 json.malformed', async () => {
    const ctx = fakeCtx({ method: 'POST', req: makeReq({ method: 'POST', body: '{bad' }) });
    await expect(withBody()(ctx, nextGuard())).rejects.toMatchObject({
      status: 400,
      code: 'json.malformed',
    });
  });
});

describe('withBody: valid JSON', () => {
  it('parses the body onto ctx.body and calls next()', async () => {
    const payload = { name: 'alice', level: 5 };
    const ctx = fakeCtx({ method: 'POST', req: makeReq({ method: 'POST', body: payload }) });
    let nextRan = false;
    await withBody()(
      ctx,
      nextGuard(() => {
        nextRan = true;
      }),
    );
    expect(ctx.body).toEqual(payload);
    expect(nextRan).toBe(true);
  });

  it('uses the default 64 KiB cap when no maxBytes is passed', async () => {
    const payload = { ok: true };
    const ctx = fakeCtx({ method: 'POST', req: makeReq({ method: 'POST', body: payload }) });
    await expect(withBody()(ctx, nextGuard())).resolves.toBeUndefined();
    expect(ctx.body).toEqual(payload);
  });

  it('rejects a body just over the default 64 KiB cap with 413 (exercises the real boundary)', async () => {
    const overCap = 'x'.repeat(DEFAULT_JSON_BODY_MAX_BYTES + 1);
    const ctx = fakeCtx({ method: 'POST', req: makeReq({ method: 'POST', body: overCap }) });
    await expect(withBody()(ctx, nextGuard())).rejects.toMatchObject({
      status: 413,
      code: 'body.too_large',
      params: { maxBytes: DEFAULT_JSON_BODY_MAX_BYTES },
    });
  });
});

describe('withBody: no Content-Type enforcement (no 415)', () => {
  it('parses a valid JSON body even when Content-Type is not application/json', async () => {
    // Content-Type enforcement (415) is the global gate's job, log-only by default; withBody must
    // never impose it. A valid JSON body under a text/plain header still parses.
    const payload = { note: 'plain-labeled but valid json' };
    const req = makeReq({
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: payload,
    });
    const ctx = fakeCtx({ method: 'POST', req });
    await expect(withBody()(ctx, nextGuard())).resolves.toBeUndefined();
    expect(ctx.body).toEqual(payload);
  });
});
