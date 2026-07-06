// Unit tests for the onion runner (server/http/compose.ts): onion
// ordering and reverse unwind, the double-next guard, short-circuit on throw and
// async reject, the optional trailing next, the idempotent respondOnce sender,
// and the runOnion outermost one-response wrapper (structural 404 fallback, bare
// 500 with no leakage, no double-send) plus the reqId carrier spanning an await.

import { Buffer } from 'node:buffer';
import type * as http from 'node:http';
import { describe, expect, it } from 'vitest';
import { compose, respondOnce, runOnion } from '../../../server/http/compose';
import { currentReqId } from '../../../server/http/context';
import type { Ctx, Middleware, Next } from '../../../server/http/types';
import { fakeCtx } from '../helpers/fake_ctx';
import type { FakeRes } from '../helpers/fake_http';

/** Read the FakeRes backing a fakeCtx so we can assert on the captured result. */
function resOf(ctx: Ctx): FakeRes {
  return ctx.res as unknown as FakeRes;
}

describe('compose: onion dispatch', () => {
  it('runs middleware in order and unwinds in reverse', async () => {
    const order: string[] = [];
    const a: Middleware = async (_ctx, next) => {
      order.push('a-in');
      await next();
      order.push('a-out');
    };
    const b: Middleware = async (_ctx, next) => {
      order.push('b-in');
      await next();
      order.push('b-out');
    };
    const c: Middleware = async (_ctx, next) => {
      order.push('c-in');
      await next();
      order.push('c-out');
    };
    await compose([a, b, c])(fakeCtx());
    expect(order).toEqual(['a-in', 'b-in', 'c-in', 'c-out', 'b-out', 'a-out']);
  });

  it('respects an await boundary before and after next()', async () => {
    const order: string[] = [];
    const a: Middleware = async (_ctx, next) => {
      order.push('a-in');
      await Promise.resolve().then(() => order.push('a-async'));
      await next();
      order.push('a-out');
    };
    const b: Middleware = async (_ctx, next) => {
      order.push('b-in');
      await next();
      order.push('b-out');
    };
    await compose([a, b])(fakeCtx());
    // a-async lands before b-in, proving the await before next() is honored.
    expect(order).toEqual(['a-in', 'a-async', 'b-in', 'b-out', 'a-out']);
  });

  it('rejects on a double next() and runs the downstream middleware only once', async () => {
    let downstreamRuns = 0;
    const a: Middleware = async (_ctx, next) => {
      await next();
      await next();
    };
    const b: Middleware = async (_ctx, next) => {
      downstreamRuns += 1;
      await next();
    };
    await expect(compose([a, b])(fakeCtx())).rejects.toThrow('next() called multiple times');
    expect(downstreamRuns).toBe(1);
  });

  it('short-circuits and rejects when a middleware throws synchronously', async () => {
    const boom = new Error('boom-sync');
    let cReached = false;
    const a: Middleware = async (_ctx, next) => {
      await next();
    };
    // b throws synchronously from a DEEPER frame (index 1); its async parent a already
    // converts that throw into a rejected promise, so this asserts the short-circuit.
    // The dispatch entry-frame try/catch itself is covered by the dedicated test below.
    const b: Middleware = () => {
      throw boom;
    };
    const c: Middleware = async (_ctx, next) => {
      cReached = true;
      await next();
    };
    await expect(compose([a, b, c])(fakeCtx())).rejects.toBe(boom);
    expect(cReached).toBe(false);
  });

  it('returns a rejected promise, not a synchronous throw, when the FIRST middleware throws synchronously', async () => {
    // The entry frame dispatch(0) is the only place compose's try/catch is load-bearing:
    // without it, a sync throw from stack[0] escapes composed() synchronously instead of
    // rejecting, breaking the "callers see one failure channel (the awaited promise)" contract.
    const boom = new Error('boom-entry');
    const syncThrower: Middleware = () => {
      throw boom;
    };
    let promise: Promise<void> | undefined;
    expect(() => {
      promise = compose([syncThrower])(fakeCtx());
    }).not.toThrow();
    await expect(promise).rejects.toBe(boom);
  });

  it('short-circuits cleanly when a middleware resolves without calling next()', async () => {
    // The common handler-responds-and-stops pattern: a returns without awaiting next(),
    // so the downstream middleware never runs and the composed promise RESOLVES (not rejects).
    let bRan = false;
    const a: Middleware = async () => {
      // intentionally does not call next()
    };
    const b: Middleware = async (_ctx, next) => {
      bRan = true;
      await next();
    };
    await expect(compose([a, b])(fakeCtx())).resolves.toBeUndefined();
    expect(bRan).toBe(false);
  });

  it('short-circuits and rejects when a middleware rejects asynchronously', async () => {
    const boom = new Error('boom-async');
    let cReached = false;
    const a: Middleware = async (_ctx, next) => {
      await next();
    };
    const b: Middleware = async () => {
      await Promise.resolve();
      throw boom;
    };
    const c: Middleware = async (_ctx, next) => {
      cReached = true;
      await next();
    };
    await expect(compose([a, b, c])(fakeCtx())).rejects.toBe(boom);
    expect(cReached).toBe(false);
  });

  it('invokes the optional trailing next, and the deepest next resolves undefined without one', async () => {
    const order: string[] = [];
    const a: Middleware = async (_ctx, next) => {
      order.push('a-in');
      await next();
      order.push('a-out');
    };
    const finalNext: Next = async () => {
      order.push('final');
    };
    await compose([a])(fakeCtx(), finalNext);
    expect(order).toEqual(['a-in', 'final', 'a-out']);

    let deepest: unknown = 'unset';
    const b: Middleware = async (_ctx, next) => {
      deepest = await next();
    };
    await compose([b])(fakeCtx());
    expect(deepest).toBeUndefined();
  });

  it('resolves immediately for an empty stack', async () => {
    await expect(compose([])(fakeCtx())).resolves.toBeUndefined();
  });
});

describe('respondOnce: idempotent low-level sender', () => {
  it('sends status, headers, and body when the response is fresh', () => {
    const ctx = fakeCtx();
    const res = resOf(ctx);
    const sent = respondOnce(ctx.res, 200, { 'X-Request-Id': 'rid-7' }, 'hello');
    expect(sent).toBe(true);
    expect(res.statusCode).toBe(200);
    // FakeRes lower-cases header keys (node-faithful).
    expect(res.headers['x-request-id']).toBe('rid-7');
    expect(res.body).toBe('hello');
  });

  it('is a no-op when the response was already fully sent', () => {
    const ctx = fakeCtx();
    const res = resOf(ctx);
    expect(respondOnce(ctx.res, 200, {}, 'first')).toBe(true);
    const second = respondOnce(ctx.res, 500, { 'X-Request-Id': 'late' }, 'second');
    expect(second).toBe(false);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('first');
    expect(res.headers['x-request-id']).toBeUndefined();
  });

  it('is a no-op when only the headers were sent (writeHead without end)', () => {
    const ctx = fakeCtx();
    const res = resOf(ctx);
    res.writeHead(204);
    expect(res.headersSent).toBe(true);
    expect(res.writableEnded).toBe(false);
    const sent = respondOnce(ctx.res, 500, undefined, 'nope');
    expect(sent).toBe(false);
    expect(res.statusCode).toBe(204);
  });

  it('writes a Buffer body', () => {
    const ctx = fakeCtx();
    const res = resOf(ctx);
    const sent = respondOnce(ctx.res, 200, undefined, Buffer.from('buf-body'));
    expect(sent).toBe(true);
    expect(res.body).toBe('buf-body');
  });
});

describe('runOnion: outermost one-response wrapper', () => {
  it('sends the 404 no-response fallback with X-Request-Id when nothing responded', async () => {
    const ctx = fakeCtx({ reqId: 'rid-10' });
    const res = resOf(ctx);
    const noop: Middleware = async (_ctx, next) => {
      await next();
    };
    await runOnion(ctx, [noop]);
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('');
    expect(res.headers['x-request-id']).toBe('rid-10');
  });

  it('sends a bare 500 with no leakage when a middleware throws', async () => {
    const ctx = fakeCtx({ reqId: 'rid-11' });
    const res = resOf(ctx);
    const secret = 'SECRET-STACK-DETAIL';
    const boom: Middleware = async () => {
      throw new Error(secret);
    };
    await runOnion(ctx, [boom]);
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('');
    expect(res.body).not.toContain(secret);
    expect(res.headers['x-request-id']).toBe('rid-11');
  });

  it('does not override a response a middleware already sent', async () => {
    const ctx = fakeCtx({ reqId: 'rid-12' });
    const res = resOf(ctx);
    const responder: Middleware = async () => {
      ctx.res.writeHead(200);
      ctx.res.end('ok');
    };
    await expect(runOnion(ctx, [responder])).resolves.toBeUndefined();
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('ok');
  });

  it('ends the socket and does not double-send when a middleware writes headers then throws', async () => {
    const ctx = fakeCtx({ reqId: 'rid-13' });
    const res = resOf(ctx);
    const partial: Middleware = async () => {
      ctx.res.writeHead(200);
      throw new Error('after-partial');
    };
    await expect(runOnion(ctx, [partial])).resolves.toBeUndefined();
    expect(res.statusCode).toBe(200);
    // The net closes a headers-committed-but-unended response so the socket never hangs.
    expect(res.writableEnded).toBe(true);
  });

  it('ends the socket when a middleware commits headers but never ends and then resolves', async () => {
    const ctx = fakeCtx({ reqId: 'rid-15' });
    const res = resOf(ctx);
    const partial: Middleware = async (_ctx, next) => {
      ctx.res.writeHead(200);
      await next();
    };
    await expect(runOnion(ctx, [partial])).resolves.toBeUndefined();
    expect(res.statusCode).toBe(200);
    expect(res.writableEnded).toBe(true);
  });

  it('exposes ctx.reqId via currentReqId synchronously and across an await', async () => {
    const ctx = fakeCtx({ reqId: 'rid-14' });
    let syncId: string | undefined;
    let asyncId: string | undefined;
    const mw: Middleware = async (_ctx, next) => {
      syncId = currentReqId();
      await Promise.resolve();
      asyncId = currentReqId();
      await next();
    };
    await runOnion(ctx, [mw]);
    expect(syncId).toBe('rid-14');
    expect(asyncId).toBe('rid-14');
  });

  it('keeps a completed response when an outer middleware throws after the inner one ended it', async () => {
    const ctx = fakeCtx({ reqId: 'rid-16' });
    const res = resOf(ctx);
    const inner: Middleware = async () => {
      ctx.res.writeHead(200);
      ctx.res.end('ok');
    };
    const outer: Middleware = async (_ctx, next) => {
      await next();
      throw new Error('after-complete');
    };
    // outer (index 0) awaits next() so inner ends the response, then outer throws on the
    // unwind. finalizeResponse's writableEnded early-return must keep the 200 (no 500 clobber).
    await expect(runOnion(ctx, [outer, inner])).resolves.toBeUndefined();
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('ok');
    expect(res.writableEnded).toBe(true);
  });

  it('never throws out of its net when the response object is unusable (a destroyed socket)', async () => {
    // finalizeResponse wraps respondOnce/end in a try/catch so runOnion never throws out of
    // its own safety net. Model a res whose writeHead/end throw while writableEnded is false:
    // there is nothing left to send, so runOnion must still resolve, not reject.
    const throwingRes = {
      headersSent: false,
      writableEnded: false,
      writeHead() {
        throw new Error('socket destroyed');
      },
      end() {
        throw new Error('socket destroyed');
      },
    } as unknown as http.ServerResponse;
    const ctx = fakeCtx({ reqId: 'rid-17', res: throwingRes });
    const noop: Middleware = async (_ctx, next) => {
      await next();
    };
    await expect(runOnion(ctx, [noop])).resolves.toBeUndefined();
  });
});
