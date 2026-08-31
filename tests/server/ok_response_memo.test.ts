// Unit coverage for server/ok_response_memo.ts: the serialize-once memo over
// the admin ok() envelope. The contract under test is twofold. First, byte
// parity: send() must produce EXACTLY what json(res, 200, { success: true,
// data, error: null }) (server/http_util.ts) produces, body, status, and both
// headers, because admin clients parse that envelope and the memo replaces the
// per-request ok() call on the hot dashboard reads. Second, serialize-once:
// the envelope is stringified at most once per key identity (the cached value
// object, or an explicit parts tuple for a composed response), so a cached
// read's TTL window costs one stringify however many requests it serves.
import type * as http from 'node:http';
import { describe, expect, it } from 'vitest';
import { json } from '../../server/http_util';
import { createOkResponseMemo } from '../../server/ok_response_memo';
import { FakeRes } from './helpers';

function res(): http.ServerResponse {
  return new FakeRes() as unknown as http.ServerResponse;
}

function captured(r: http.ServerResponse) {
  const fake = r as unknown as FakeRes;
  return { status: fake.statusCode, body: fake.body, headers: fake.headers };
}

describe('byte parity with ok()', () => {
  it('serves the exact bytes, status, and headers json() would produce for the ok envelope', () => {
    const memo = createOkResponseMemo();
    const data = Object.freeze({ realm: 'eastbrook', rows: [{ id: 'a', n: 1 }] });

    const viaMemo = res();
    memo.send(viaMemo, data);
    const viaJson = res();
    json(viaJson, 200, { success: true, data, error: null });

    expect(captured(viaMemo)).toEqual(captured(viaJson));
    expect(captured(viaMemo).status).toBe(200);
    expect(captured(viaMemo).body).toBe(JSON.stringify({ success: true, data, error: null }));
  });

  it('a memo HIT still serves byte-identical output (headers included)', () => {
    const memo = createOkResponseMemo();
    const data = Object.freeze({ value: 'x'.repeat(100) });

    const first = res();
    memo.send(first, data);
    const second = res();
    memo.send(second, data);

    expect(captured(second)).toEqual(captured(first));
  });

  it('non-ASCII payloads keep a correct byte (not code-unit) Content-Length', () => {
    const memo = createOkResponseMemo();
    const data = Object.freeze({ name: 'Grimmschädel (café)' });
    const r = res();
    memo.send(r, data);
    const body = captured(r).body;
    expect(captured(r).headers['content-length']).toBe(Buffer.byteLength(body));
    expect(Buffer.byteLength(body)).toBeGreaterThan(body.length);
  });
});

describe('serialize-once keying', () => {
  it('stringifies once per data identity and serves every request', () => {
    const memo = createOkResponseMemo();
    const data = Object.freeze({ big: [1, 2, 3] });
    memo.send(res(), data);
    memo.send(res(), data);
    memo.send(res(), data);
    expect(memo.stats()).toEqual({ serves: 3, stringifies: 1 });
  });

  it('a NEW data object (a cache turnover) re-stringifies exactly once', () => {
    const memo = createOkResponseMemo();
    memo.send(res(), Object.freeze({ n: 1 }));
    memo.send(res(), Object.freeze({ n: 1 }));
    expect(memo.stats()).toEqual({ serves: 2, stringifies: 2 });
  });

  it('keys a composed response on its parts tuple: same parts, one stringify', () => {
    const memo = createOkResponseMemo();
    const registrations = Object.freeze([{ day: 'd', count: 1 }]);
    const sessions = Object.freeze([{ day: 'd', count: 2 }]);
    // A fresh composed object per request, the activity handler shape.
    const compose = () => ({ days: 30, registrations, sessions });
    const a = res();
    memo.send(a, compose(), [registrations, sessions]);
    const b = res();
    memo.send(b, compose(), [registrations, sessions]);
    expect(memo.stats()).toEqual({ serves: 2, stringifies: 1 });
    expect(captured(b).body).toBe(captured(a).body);
    expect(captured(a).body).toBe(JSON.stringify({ success: true, data: compose(), error: null }));
  });

  it('any changed part re-stringifies (a torn multi-read never serves stale bytes)', () => {
    const memo = createOkResponseMemo();
    const oldSessions = Object.freeze([{ day: 'd', count: 2 }]);
    const newSessions = Object.freeze([{ day: 'd', count: 9 }]);
    const registrations = Object.freeze([{ day: 'd', count: 1 }]);
    memo.send(res(), { days: 30, registrations, sessions: oldSessions }, [
      registrations,
      oldSessions,
    ]);
    const torn = res();
    memo.send(torn, { days: 30, registrations, sessions: newSessions }, [
      registrations,
      newSessions,
    ]);
    expect(memo.stats().stringifies).toBe(2);
    expect(JSON.parse(captured(torn).body)).toEqual({
      success: true,
      data: {
        days: 30,
        registrations: [{ day: 'd', count: 1 }],
        sessions: [{ day: 'd', count: 9 }],
      },
      error: null,
    });
  });

  it('an old key still hits after a different key was served (no single-slot eviction)', () => {
    const memo = createOkResponseMemo();
    const a = Object.freeze({ n: 1 });
    const b = Object.freeze({ n: 2 });
    memo.send(res(), a);
    memo.send(res(), b);
    memo.send(res(), a);
    expect(memo.stats()).toEqual({ serves: 3, stringifies: 2 });
  });
});
