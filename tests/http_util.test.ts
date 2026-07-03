import { EventEmitter } from 'node:events';
import type * as http from 'node:http';
import { describe, expect, it } from 'vitest';
import { isPng, isUniqueViolation, readBinaryBody, readBody } from '../server/http_util';

// Minimal IncomingMessage stand-in: an emitter that records whether the
// request was destroyed so we can assert readBody stops reading the socket.
class FakeReq extends EventEmitter {
  destroyed = false;
  destroy(): void {
    this.destroyed = true;
  }
}

const fakeReq = () => new FakeReq() as unknown as http.IncomingMessage & FakeReq;

describe('readBody', () => {
  it('parses a small JSON body', async () => {
    const req = fakeReq();
    const promise = readBody(req);
    req.emit('data', JSON.stringify({ hello: 'world' }));
    req.emit('end');
    await expect(promise).resolves.toEqual({ hello: 'world' });
  });

  it('resolves to an empty object for an empty body', async () => {
    const req = fakeReq();
    const promise = readBody(req);
    req.emit('end');
    await expect(promise).resolves.toEqual({});
  });

  it('rejects malformed JSON', async () => {
    const req = fakeReq();
    const promise = readBody(req);
    req.emit('data', '{ not json');
    req.emit('end');
    await expect(promise).rejects.toThrow('bad json');
  });

  it('decodes a multi-byte UTF-8 character split across two chunks', async () => {
    // A 4-byte emoji plus CJK/accented text inside a JSON string. TCP/HTTP can
    // split a chunk mid-character; decoding each chunk to a string independently
    // corrupts the boundary character into replacement chars. The body must be
    // buffered and decoded once.
    const obj = { name: 'Ünïcödé \u{1F409} 名前' };
    const buf = Buffer.from(JSON.stringify(obj), 'utf8');
    const dragon = buf.indexOf(0xf0); // first byte of the 4-byte emoji
    expect(dragon).toBeGreaterThan(-1); // pin the mid-character split (guard vs a future ASCII-only payload)
    const first = buf.subarray(0, dragon + 2); // split INSIDE the emoji
    const second = buf.subarray(dragon + 2);
    const req = fakeReq();
    const promise = readBody(req);
    req.emit('data', first);
    req.emit('data', second);
    req.emit('end');
    await expect(promise).resolves.toEqual(obj);
  });

  it('rejects non-object JSON bodies (null, arrays, primitives) as bad json', async () => {
    // A literal `null` body used to resolve, then crash route handlers on
    // property access (500); every route reads properties, so only an object
    // body is valid. Arrays and primitives are rejected the same way.
    for (const body of ['null', '[1,2,3]', '"a string"', '42', 'true']) {
      const req = fakeReq();
      const promise = readBody(req);
      req.emit('data', body);
      req.emit('end');
      await expect(promise, body).rejects.toThrow('bad json');
    }
  });

  it('rejects and destroys the request when the body exceeds 64KB', async () => {
    const req = fakeReq();
    const promise = readBody(req);
    req.emit('data', 'x'.repeat(64 * 1024 + 1));
    await expect(promise).rejects.toThrow('body too large');
    expect(req.destroyed).toBe(true);
  });

  it('stops buffering after the limit is hit', async () => {
    const req = fakeReq();
    const promise = readBody(req);
    req.emit('data', 'x'.repeat(64 * 1024 + 1));
    await expect(promise).rejects.toThrow('body too large');
    // Late chunks arriving after the abort must not be appended or throw.
    expect(() => req.emit('data', 'y'.repeat(1024 * 1024))).not.toThrow();
  });
});

describe('readBinaryBody', () => {
  it('rejects and destroys the request when the body exceeds maxBytes', async () => {
    const req = fakeReq();
    const promise = readBinaryBody(req, 10);
    // Two 6-byte chunks: the cap is breached on the second chunk (12 > 10).
    req.emit('data', Buffer.from('aaaaaa'));
    req.emit('data', Buffer.from('bbbbbb'));
    await expect(promise).rejects.toThrow('body too large');
    expect(req.destroyed).toBe(true);
  });

  it('resolves to the concatenated chunks when under the cap', async () => {
    const req = fakeReq();
    const promise = readBinaryBody(req, 64);
    const a = Buffer.from([0x01, 0x02, 0x03]);
    const b = Buffer.from([0x04, 0x05]);
    req.emit('data', a);
    req.emit('data', b);
    req.emit('end');
    const result = await promise;
    expect(result.equals(Buffer.concat([a, b]))).toBe(true);
  });

  it('propagates a stream error as a rejection', async () => {
    const req = fakeReq();
    const promise = readBinaryBody(req, 64);
    req.emit('error', new Error('stream broke'));
    await expect(promise).rejects.toThrow('stream broke');
  });
});

describe('isPng', () => {
  // The 8-byte PNG signature, matching the constant inside http_util.
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it('rejects exactly the bare 8-byte signature with no payload', () => {
    // Load-bearing boundary: isPng requires length strictly greater than 8.
    expect(isPng(PNG_MAGIC)).toBe(false);
  });

  it('accepts the signature plus at least one payload byte', () => {
    expect(isPng(Buffer.concat([PNG_MAGIC, Buffer.from([0])]))).toBe(true);
  });

  it('rejects bytes that are not a PNG signature', () => {
    expect(isPng(Buffer.from('not a png'))).toBe(false);
  });

  it('rejects an empty buffer', () => {
    expect(isPng(Buffer.alloc(0))).toBe(false);
  });
});

describe('isUniqueViolation', () => {
  it('matches a Postgres unique-constraint error by SQLSTATE code', () => {
    // what node-postgres throws for a UNIQUE index conflict
    const err = Object.assign(
      new Error('duplicate key value violates unique constraint "accounts_username_key"'),
      { code: '23505' },
    );
    expect(isUniqueViolation(err)).toBe(true);
  });

  it('matches by message when no code is present', () => {
    expect(isUniqueViolation(new Error('unique constraint failed'))).toBe(true);
  });

  it('ignores unrelated errors and non-errors', () => {
    expect(isUniqueViolation(Object.assign(new Error('connection reset'), { code: '08006' }))).toBe(
      false,
    );
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('nope')).toBe(false);
  });
});
