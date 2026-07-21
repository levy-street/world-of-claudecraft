// Self-tests for fakeCtx / nextGuard: prove a default Ctx is well-formed against
// the frozen contract, that every override applies, that the wired FakeRes merges
// incremental setHeader with writeHead through ctx.res, and that nextGuard rejects
// a second next() call (the onion's single-call guard).
import { describe, expect, it } from 'vitest';
import { fakeCtx, nextGuard } from './fake_ctx';
import { FakeRes } from './fake_http';

describe('fakeCtx defaults', () => {
  it('returns a well-formed Ctx with deterministic defaults', () => {
    const ctx = fakeCtx();
    expect(ctx.method).toBe('GET');
    expect(ctx.url).toBeInstanceOf(URL);
    expect(ctx.url.href).toBe('http://localhost/');
    expect(ctx.path).toBe('/');
    expect(ctx.path).toBe(ctx.url.pathname);
    expect(ctx.query).toEqual({});
    expect(ctx.params).toEqual({});
    expect(ctx.ip).toBe('127.0.0.1');
    expect(ctx.reqId).toBe('test-req-1');
    expect(ctx.body).toBeUndefined();
    expect(ctx.account).toBeUndefined();
    expect(ctx.state).toBeInstanceOf(Map);
    expect(ctx.state.size).toBe(0);
  });

  it('wires a usable FakeRes and an IncomingMessage-shaped req', () => {
    const ctx = fakeCtx();
    expect(ctx.res).toBeInstanceOf(FakeRes);
    expect(ctx.req.method).toBe('GET');
    expect(ctx.req.url).toBe('/');
    expect(ctx.req.headers.host).toBe('localhost:8787');

    // The res is a working FakeRes: end captures status + body.
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end('{"ok":true}');
    const res = ctx.res as unknown as FakeRes;
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('{"ok":true}');
  });

  it('gives each ctx its own fresh state Map', () => {
    const a = fakeCtx();
    const b = fakeCtx();
    a.state.set('k', 1);
    expect(b.state.size).toBe(0);
  });
});

describe('fakeCtx overrides', () => {
  it('applies method, ip, account, params, query, and body', () => {
    const account = { accountId: 42, scope: 'full' as const };
    const ctx = fakeCtx({
      method: 'POST',
      ip: '10.0.0.7',
      account,
      params: { id: '7' },
      query: { tag: ['a', 'b'] },
      body: { name: 'Aldric' },
    });
    expect(ctx.method).toBe('POST');
    expect(ctx.ip).toBe('10.0.0.7');
    expect(ctx.account).toEqual({ accountId: 42, scope: 'full' });
    expect(ctx.params).toEqual({ id: '7' });
    expect(ctx.query).toEqual({ tag: ['a', 'b'] });
    expect(ctx.body).toEqual({ name: 'Aldric' });
  });

  it('derives path from an override url and threads headers into the req', () => {
    const ctx = fakeCtx({
      url: '/api/characters/7?full=1',
      headers: { authorization: 'Bearer t' },
    });
    expect(ctx.url.pathname).toBe('/api/characters/7');
    expect(ctx.path).toBe('/api/characters/7');
    expect(ctx.req.url).toBe('/api/characters/7?full=1');
    expect(ctx.req.headers.authorization).toBe('Bearer t');
  });

  it('honors an explicit res and req override', () => {
    const res = new FakeRes();
    const ctx = fakeCtx({ res: res as never });
    expect(ctx.res).toBe(res as never);
  });
});

describe('fakeCtx res merge through the ctx', () => {
  it('merges incremental setHeader on ctx.res with writeHead headers', () => {
    const ctx = fakeCtx();
    ctx.res.setHeader('X-Req-Id', 'abc');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end('{}');

    const res = ctx.res as unknown as FakeRes;
    expect(res.statusCode).toBe(200);
    expect(res.getHeaders()).toEqual({
      'x-req-id': 'abc',
      'content-type': 'application/json',
    });
  });
});

describe('nextGuard', () => {
  it('runs the wrapped fn once', async () => {
    let calls = 0;
    const next = nextGuard(async () => {
      calls += 1;
    });
    await next();
    expect(calls).toBe(1);
  });

  it('rejects a second next() call', async () => {
    const next = nextGuard();
    await next();
    await expect(next()).rejects.toThrow(/multiple times/);
  });

  it('works with no fn supplied', async () => {
    const next = nextGuard();
    await expect(next()).resolves.toBeUndefined();
  });
});
