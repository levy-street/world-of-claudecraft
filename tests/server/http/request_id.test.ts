// Unit tests for the withRequestId middleware (server/http/middleware/request_id.ts):
// it re-establishes the reqId AsyncLocalStorage binding around next() so
// currentReqId() reads correctly downstream even when composed WITHOUT runOnion.

import { describe, expect, it, vi } from 'vitest';
import { compose, REQUEST_ID_HEADER } from '../../../server/http/compose';
import { currentReqId } from '../../../server/http/context';
import { logger } from '../../../server/http/logger';
import { withRequestId } from '../../../server/http/middleware/request_id';
import { withErrors } from '../../../server/http/middleware/with_errors';
import type { Ctx, Middleware } from '../../../server/http/types';
import { fakeCtx } from '../helpers/fake_ctx';
import type { FakeRes } from '../helpers/fake_http';

/** Read the FakeRes backing a fakeCtx so we can assert on the echoed header. */
function resOf(ctx: Ctx): FakeRes {
  return ctx.res as unknown as FakeRes;
}

describe('withRequestId: binds ctx.reqId as the ambient id', () => {
  it("exposes fakeCtx's preset reqId ('test-req-1') downstream", async () => {
    let seen: string | undefined;
    const inner: Middleware = async (_ctx, next) => {
      seen = currentReqId();
      await next();
    };
    await compose([withRequestId(), inner])(fakeCtx());
    expect(seen).toBe('test-req-1');
  });

  it('propagates the bound id across a microtask/timer await inside next()', async () => {
    const ctx = fakeCtx({ reqId: 'rid-async' });
    let before: string | undefined;
    let after: string | undefined;
    const inner: Middleware = async (_ctx, next) => {
      before = currentReqId();
      await new Promise((resolve) => setTimeout(resolve, 0));
      after = currentReqId();
      await next();
    };
    await compose([withRequestId(), inner])(ctx);
    expect(before).toBe('rid-async');
    expect(after).toBe('rid-async');
  });

  it('is undefined outside the middleware run', async () => {
    expect(currentReqId()).toBeUndefined();
    await compose([withRequestId(), async (_ctx, next) => next()])(fakeCtx());
    expect(currentReqId()).toBeUndefined();
  });

  it('mints a fresh id when ctx.reqId is empty (the degenerate-caller fallback)', async () => {
    const ctx = fakeCtx({ reqId: '' });
    let seen: string | undefined;
    const inner: Middleware = async (_ctx, next) => {
      seen = currentReqId();
      await next();
    };
    await compose([withRequestId(), inner])(ctx);
    expect(seen).toBeTruthy();
    expect(seen).not.toBe('');
  });
});

describe('withRequestId: echoes the X-Request-Id response header', () => {
  it('sets X-Request-Id to ctx.reqId on a 2xx response', async () => {
    const ctx = fakeCtx({ reqId: 'rid-2xx' });
    const handler: Middleware = async () => {
      ctx.res.writeHead(200);
      ctx.res.end('ok');
    };
    await compose([withRequestId(), handler])(ctx);
    expect(resOf(ctx).statusCode).toBe(200);
    expect(resOf(ctx).getHeader(REQUEST_ID_HEADER)).toBe('rid-2xx');
  });

  it('sets the header on the way IN, surviving a downstream throw WITHOUT withErrors', async () => {
    // Isolation pin: withErrors independently emits X-Request-Id on the error
    // path, so the composed 5xx test below would pass even if withRequestId
    // dropped its setHeader. This composes ONLY [withRequestId, throwing] and
    // proves the echo comes from withRequestId itself.
    const ctx = fakeCtx({ reqId: 'rid-isolated' });
    const throwing: Middleware = async () => {
      throw new Error('boom');
    };
    await expect(compose([withRequestId(), throwing])(ctx)).rejects.toThrow('boom');
    expect(resOf(ctx).getHeader(REQUEST_ID_HEADER)).toBe('rid-isolated');
  });

  it('still carries X-Request-Id on a thrown 5xx mapped by withErrors', async () => {
    // withRequestId sets the header on the way IN (before the throw), and it
    // survives the writeHead merge when withErrors serializes the 500.
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const ctx = fakeCtx({ reqId: 'rid-5xx' });
      const throwing: Middleware = async () => {
        throw new Error('boom');
      };
      await compose([withErrors(), withRequestId(), throwing])(ctx);
      expect(resOf(ctx).statusCode).toBe(500);
      expect(resOf(ctx).getHeader(REQUEST_ID_HEADER)).toBe('rid-5xx');
    } finally {
      errSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });
});
