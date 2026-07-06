// Unit tests for the in-house structured logger (server/http/logger.ts): the
// reqId is read from AsyncLocalStorage at emit time (across an await, and omitted
// outside any request), every line is redacted JSON with level/time/msg, child
// bindings merge in, an Error field is serialized to { message, stack }, and info
// vs warn/error split across the two transports.

import { describe, expect, it } from 'vitest';
import { runWithReqId } from '../../../server/http/context';
import { createLogger } from '../../../server/http/logger';

/** A logger whose two transports capture their lines into separate arrays. */
function capturing(): { out: string[]; err: string[]; log: ReturnType<typeof createLogger> } {
  const out: string[] = [];
  const err: string[] = [];
  const log = createLogger({ out: (l) => out.push(l), err: (l) => err.push(l) });
  return { out, err, log };
}

describe('logger: reqId from AsyncLocalStorage', () => {
  it('carries the ambient reqId on a line emitted across an await inside runWithReqId', async () => {
    const { out, log } = capturing();
    await runWithReqId('rid-async', async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      log.info('after await');
    });
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]).reqId).toBe('rid-async');
  });

  it('omits the reqId key entirely when emitted outside any run', () => {
    const { out, log } = capturing();
    log.info('no request');
    const rec = JSON.parse(out[0]);
    expect('reqId' in rec).toBe(false);
  });
});

describe('logger: record shape and redaction', () => {
  it('emits one JSON line with level, numeric time, and msg', () => {
    const { out, log } = capturing();
    log.info({ a: 1 }, 'hello');
    const rec = JSON.parse(out[0]);
    expect(rec.level).toBe('info');
    expect(typeof rec.time).toBe('number');
    expect(rec.msg).toBe('hello');
    expect(rec.a).toBe(1);
  });

  it('redacts a secret field so the raw value never reaches the line', () => {
    const { out, log } = capturing();
    log.info({ password: 'super-secret-value' }, 'login');
    expect(out[0]).not.toContain('super-secret-value');
    expect(JSON.parse(out[0]).password).toBe('[redacted]');
  });

  it('serializes an Error field to { message, stack }', () => {
    const { err, log } = capturing();
    log.error({ err: new Error('boom') }, 'failed');
    const rec = JSON.parse(err[0]);
    expect(rec.err.message).toBe('boom');
    expect(typeof rec.err.stack).toBe('string');
  });

  it('merges child bindings into every line', () => {
    const { out, log } = capturing();
    log.child({ svc: 'api', realm: 'one' }).info('tick');
    const rec = JSON.parse(out[0]);
    expect(rec.svc).toBe('api');
    expect(rec.realm).toBe('one');
    expect(rec.msg).toBe('tick');
  });
});

describe('logger: transport split', () => {
  it('routes info to out and warn/error to err', () => {
    const { out, err, log } = capturing();
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(out.map((l) => JSON.parse(l).msg)).toEqual(['i']);
    expect(err.map((l) => JSON.parse(l).level)).toEqual(['warn', 'error']);
  });
});
