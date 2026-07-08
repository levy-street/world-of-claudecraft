// Tests for the raw (binary) body middleware (server/http/middleware/raw_body.ts).
// withRawBody is driven directly (no compose/onion runtime): call it with a
// fakeCtx and a nextGuard, and assert on ctx.body or the thrown HttpError.

import { describe, expect, it } from 'vitest';
import { withRawBody } from '../../../server/http/middleware/raw_body';
import { fakeCtx, nextGuard } from '../helpers/fake_ctx';
import { makeReq } from '../helpers/fake_http';

describe('withRawBody: success', () => {
  it('reads non-JSON bytes into a Buffer at ctx.body without attempting a JSON parse', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
    const ctx = fakeCtx({ method: 'POST', req: makeReq({ method: 'POST', body: bytes }) });
    let nextRan = false;
    await withRawBody(1000)(
      ctx,
      nextGuard(() => {
        nextRan = true;
      }),
    );
    expect(Buffer.isBuffer(ctx.body)).toBe(true);
    expect(ctx.body as Buffer).toEqual(bytes);
    expect(nextRan).toBe(true);
  });
});

describe('withRawBody: over-cap Content-Length', () => {
  it('rejects before reading, with Connection: close and shouldKeepAlive false', async () => {
    const req = makeReq({
      method: 'POST',
      headers: { 'content-length': '999999' },
      body: Buffer.from([1, 2, 3]),
    });
    const ctx = fakeCtx({ method: 'POST', req });
    await expect(withRawBody(1000)(ctx, nextGuard())).rejects.toMatchObject({
      status: 413,
      code: 'body.too_large',
      params: { maxBytes: 1000 },
      headers: { Connection: 'close' },
    });
    expect((ctx.res as unknown as { shouldKeepAlive: boolean }).shouldKeepAlive).toBe(false);
  });
});

describe('withRawBody: over-cap mid-stream', () => {
  it('rejects with Connection: close when the actual body exceeds the cap with no content-length', async () => {
    const req = makeReq({ method: 'POST', body: Buffer.alloc(5000, 1) });
    const ctx = fakeCtx({ method: 'POST', req });
    await expect(withRawBody(1000)(ctx, nextGuard())).rejects.toMatchObject({
      status: 413,
      code: 'body.too_large',
      params: { maxBytes: 1000 },
      headers: { Connection: 'close' },
    });
    expect((ctx.res as unknown as { shouldKeepAlive: boolean }).shouldKeepAlive).toBe(false);
  });
});

describe('withRawBody: non-numeric Content-Length', () => {
  it('does not early-reject a non-digit Content-Length (mirrors the live strict /^d+$/ check)', async () => {
    // Under a loose Number() parse '1e9' is a finite 1e9 (>cap) and would 413
    // before reading; the strict-digit check (matching cardUploadContentLengthTooLarge)
    // rejects only /^\d+$/ lengths, so a non-numeric length falls through and the
    // small in-cap body reads normally.
    const bytes = Buffer.from([1, 2, 3]);
    const req = makeReq({ method: 'POST', headers: { 'content-length': '1e9' }, body: bytes });
    const ctx = fakeCtx({ method: 'POST', req });
    let nextRan = false;
    await withRawBody(1000)(
      ctx,
      nextGuard(() => {
        nextRan = true;
      }),
    );
    expect(ctx.body as Buffer).toEqual(bytes);
    expect(nextRan).toBe(true);
  });
});
