// Self-tests for the FakeRes / makeReq fakes: prove the header merge, the
// headersSent / writableEnded lifecycle, the captured status + body, the
// single-use guards (second writeHead, write-after-end, second end), and the
// case-insensitive header store. These pin the contract the API pipeline relies on.
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { FakeRes, makeReq } from './fake_http';

describe('FakeRes header store', () => {
  it('treats getHeader / getHeaders / removeHeader case-insensitively', () => {
    const res = new FakeRes();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Req-Id', 'abc');

    expect(res.getHeader('content-type')).toBe('application/json');
    expect(res.getHeader('CONTENT-TYPE')).toBe('application/json');
    expect(res.getHeaders()).toEqual({ 'content-type': 'application/json', 'x-req-id': 'abc' });

    res.removeHeader('Content-TYPE');
    expect(res.getHeader('content-type')).toBeUndefined();
    expect(res.getHeaders()).toEqual({ 'x-req-id': 'abc' });
  });

  it('getHeaders returns a fresh snapshot, not the live store', () => {
    const res = new FakeRes();
    res.setHeader('a', '1');
    const snap = res.getHeaders();
    res.setHeader('b', '2');
    expect(snap).toEqual({ a: '1' });
  });
});

describe('FakeRes writeHead', () => {
  it('merges setHeader headers with writeHead headers (explicit wins on conflict)', () => {
    const res = new FakeRes();
    res.setHeader('X-Kept', 'kept');
    res.setHeader('Content-Type', 'text/plain');
    res.writeHead(201, { 'Content-Type': 'application/json', 'X-New': 'new' });

    expect(res.statusCode).toBe(201);
    expect(res.getHeaders()).toEqual({
      'x-kept': 'kept',
      'content-type': 'application/json',
      'x-new': 'new',
    });
  });

  it('flips headersSent false -> true after writeHead', () => {
    const res = new FakeRes();
    expect(res.headersSent).toBe(false);
    res.writeHead(200);
    expect(res.headersSent).toBe(true);
  });

  it('throws on a second writeHead', () => {
    const res = new FakeRes();
    res.writeHead(200);
    expect(() => res.writeHead(500)).toThrow(/already sent/);
  });

  it('throws on a writeHead after end', () => {
    const res = new FakeRes();
    res.end('done');
    expect(() => res.writeHead(200)).toThrow(/already sent/);
  });
});

describe('FakeRes body + lifecycle', () => {
  it('defaults statusCode to 200 and body to empty', () => {
    const res = new FakeRes();
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
  });

  it('flips headersSent false -> true after end even when writeHead was skipped', () => {
    const res = new FakeRes();
    expect(res.headersSent).toBe(false);
    res.end('hi');
    expect(res.headersSent).toBe(true);
    expect(res.writableEnded).toBe(true);
  });

  it('captures the statusCode and body on end', () => {
    const res = new FakeRes();
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing' }));

    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('{"error":"missing"}');
    expect(res.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(res.body)).toEqual({ error: 'missing' });
  });

  it('accumulates write chunks into the captured body', () => {
    const res = new FakeRes();
    res.write('a');
    res.write('b');
    res.end('c');
    expect(res.body).toBe('abc');
    expect(res.headersSent).toBe(true);
  });

  it('throws on a second end', () => {
    const res = new FakeRes();
    res.end('first');
    expect(() => res.end('second')).toThrow(/more than once/);
  });

  it('throws on a write after end', () => {
    const res = new FakeRes();
    res.end('done');
    expect(() => res.write('late')).toThrow(/after end/);
  });
});

describe('makeReq', () => {
  it('returns a Readable carrying defaults (GET, /, host header, remoteAddress)', async () => {
    const req = makeReq();
    expect(req).toBeInstanceOf(Readable);
    expect(req.method).toBe('GET');
    expect(req.url).toBe('/');
    expect(req.headers.host).toBe('localhost:8787');
    expect(req.socket.remoteAddress).toBe('127.0.0.1');
  });

  it('applies method, url, and merged headers', () => {
    const req = makeReq({ method: 'POST', url: '/api/x', headers: { authorization: 'Bearer t' } });
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/api/x');
    expect(req.headers.host).toBe('localhost:8787');
    expect(req.headers.authorization).toBe('Bearer t');
  });

  it('streams a JSON-encoded object body so a body parser can read it', async () => {
    const req = makeReq({ method: 'POST', body: { name: 'Aldric' } });
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString('utf8')).toBe('{"name":"Aldric"}');
  });

  it('streams a string body verbatim', async () => {
    const req = makeReq({ body: 'raw-text' });
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString('utf8')).toBe('raw-text');
  });

  it('yields an empty stream when no body is given', async () => {
    const req = makeReq();
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString('utf8')).toBe('');
  });
});
