// Self-tests for the dynamic-field normalizer. They prove the masking is
// field-name-driven (a numeric NON-dynamic field is untouched), that each dynamic
// category maps to its stable placeholder token, and that an `id` key masks while
// a `score` key does not.
import { describe, expect, it } from 'vitest';
import { type CapturedResponse, NORMALIZER_PLACEHOLDERS, normalizeResponse } from './normalizer';

const P = NORMALIZER_PLACEHOLDERS;

function normObjectBody(body: unknown): Record<string, unknown> {
  const out = normalizeResponse({ status: 200, headers: {}, body }).body;
  return out as Record<string, unknown>;
}

describe('normalizeResponse: field-name-driven body masking', () => {
  it('leaves numeric-looking NON-dynamic fields untouched', () => {
    const masked = normObjectBody({ score: 12345, level: 60, name: 'Aldric' });
    expect(masked).toEqual({ score: 12345, level: 60, name: 'Aldric' });
  });

  it('masks an `id` key but not a `score` key', () => {
    const masked = normObjectBody({ id: 42, score: 42 });
    expect(masked.id).toBe(P.id);
    expect(masked.score).toBe(42);
  });

  it('maps each dynamic category to its stable placeholder token', () => {
    const masked = normObjectBody({
      id: 7,
      accountId: 9,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-02-02T00:00:00Z',
      timestamp: 1700000000,
      birthDate: '2000-01-01',
      token: 'sk-secret',
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      bearer: 'b-1',
      requestId: 'req-abc',
      reqId: 'req-xyz',
      expires: 60,
      expiresIn: 3600,
      expiresAt: '2026-03-03T00:00:00Z',
      nonce: 'n-1',
      csrf: 'c-1',
      csrfToken: 'ct-1',
      state: 'st-1',
    });
    expect(masked.id).toBe(P.id);
    expect(masked.accountId).toBe(P.id);
    expect(masked.createdAt).toBe(P.timestamp);
    expect(masked.updatedAt).toBe(P.timestamp);
    expect(masked.timestamp).toBe(P.timestamp);
    expect(masked.birthDate).toBe(P.date);
    expect(masked.token).toBe(P.token);
    expect(masked.accessToken).toBe(P.token);
    expect(masked.refreshToken).toBe(P.token);
    expect(masked.bearer).toBe(P.token);
    expect(masked.requestId).toBe(P.requestId);
    expect(masked.reqId).toBe(P.requestId);
    // expiresAt resolves to <EXPIRES>, not the generic *At timestamp token.
    expect(masked.expires).toBe(P.expires);
    expect(masked.expiresIn).toBe(P.expires);
    expect(masked.expiresAt).toBe(P.expires);
    expect(masked.nonce).toBe(P.nonce);
    expect(masked.csrf).toBe(P.nonce);
    expect(masked.csrfToken).toBe(P.nonce);
    // The generic key 'state' is deliberately NOT masked (it is too broad and
    // would over-mask non-CSRF bodies); it is preserved verbatim.
    expect(masked.state).toBe('st-1');
  });

  it('masks recursively through nested objects and arrays', () => {
    const masked = normObjectBody({
      data: { id: 1, score: 99, child: { createdAt: 'x', label: 'keep' } },
      list: [{ id: 2, score: 3 }, { token: 't' }],
    });
    const data = masked.data as Record<string, unknown>;
    expect(data.id).toBe(P.id);
    expect(data.score).toBe(99);
    expect((data.child as Record<string, unknown>).createdAt).toBe(P.timestamp);
    expect((data.child as Record<string, unknown>).label).toBe('keep');
    const list = masked.list as Record<string, unknown>[];
    expect(list[0].id).toBe(P.id);
    expect(list[0].score).toBe(3);
    expect(list[1].token).toBe(P.token);
  });
});

describe('normalizeResponse: JSON-string body', () => {
  it('parses, masks by key, and re-serializes with stable key order', () => {
    const body = JSON.stringify({ score: 5, id: 1, createdAt: 'x' });
    const out = normalizeResponse({ status: 200, headers: {}, body }).body;
    expect(typeof out).toBe('string');
    const parsed = JSON.parse(out as string);
    expect(parsed).toEqual({ score: 5, id: P.id, createdAt: P.timestamp });
    // Deterministic (sorted) key order regardless of original ordering.
    expect(out).toBe(JSON.stringify({ createdAt: P.timestamp, id: P.id, score: 5 }));
  });

  it('leaves a non-JSON/text body verbatim and never throws', () => {
    const captured: CapturedResponse = { status: 500, headers: {}, body: 'not json {{{' };
    const out = normalizeResponse(captured);
    expect(out.body).toBe('not json {{{');
  });
});

describe('normalizeResponse: headers', () => {
  it('masks only the named dynamic headers, by header name', () => {
    const out = normalizeResponse({
      status: 200,
      headers: {
        date: 'Mon, 01 Jan 2026 00:00:00 GMT',
        'x-request-id': 'abc-123',
        'set-cookie': 'sid=deadbeef; HttpOnly',
        'content-type': 'application/json',
        etag: 'W/"static"',
      },
      body: '',
    });
    expect(out.headers.date).toBe(P.date);
    expect(out.headers['x-request-id']).toBe(P.requestId);
    expect(out.headers['set-cookie']).toBe(P.token);
    // Non-dynamic headers are preserved verbatim.
    expect(out.headers['content-type']).toBe('application/json');
    expect(out.headers.etag).toBe('W/"static"');
  });
});
