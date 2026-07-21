// Error-model tests (server/http/errors.ts). mapError is called DIRECTLY with a fakeCtx
// and returns a SerializedError (no compose/FakeRes drive). Covers the exhaustive toAppError
// table, the code-implied headers, one-pass validation issues, the seven per-surface shapes,
// normalizeSurface (exercised through mapError), the onUnexpected sink, and 500 leak-freedom.

import { describe, expect, it, vi } from 'vitest';
import {
  escapeHtml,
  HttpError,
  mapError,
  rateLimit429Headers,
  toAppError,
} from '../../../server/http/errors';
import { fakeCtx } from '../helpers/fake_ctx';

// The locked param value type cannot name an Issue[], so callers cast at the boundary.
const issuesParam = (issues: Array<{ pointer: string; code: string }>) =>
  ({ issues }) as unknown as Record<string, string | number>;

describe('toAppError exhaustive status table', () => {
  it('maps a SyntaxError (JSON.parse failure) to 400 json.malformed', () => {
    const app = toAppError(new SyntaxError('Unexpected token < in JSON'));
    expect(app.status).toBe(400);
    expect(app.code).toBe('json.malformed');
  });

  it('maps a raw decode-failure to 422 validation.failed, preserving every issue', () => {
    const issues = [
      { pointer: '/page', code: 'min' },
      { pointer: '/name', code: 'required' },
    ];
    const app = toAppError({ ok: false, issues });
    expect(app.status).toBe(422);
    expect(app.code).toBe('validation.failed');
    expect((app.params as unknown as { issues: unknown[] }).issues).toHaveLength(2);
    expect((app.params as unknown as { issues: unknown[] }).issues).toEqual(issues);
  });

  it('maps a pg unique violation (23505) to 409 db.conflict', () => {
    const app = toAppError({ code: '23505', detail: 'Key (name)=(x) already exists.' });
    expect(app.status).toBe(409);
    expect(app.code).toBe('db.conflict');
  });

  it('maps a non-23505 pg error to 500 internal.error (never trusts its message)', () => {
    const app = toAppError({ code: '23503', message: 'FK violation on SELECT ...' });
    expect(app.status).toBe(500);
    expect(app.code).toBe('internal.error');
  });

  it('maps a generic Error, a thrown string, and a thrown plain object to 500', () => {
    expect(toAppError(new Error('boom')).status).toBe(500);
    expect(toAppError(new Error('boom')).code).toBe('internal.error');
    expect(toAppError('oops').status).toBe(500);
    expect(toAppError({ foo: 'bar' }).status).toBe(500);
  });

  it('passes an HttpError through for 401/403/413/429 (status + code preserved)', () => {
    const rows: Array<[number, string]> = [
      [401, 'auth.token_missing'],
      [403, 'auth.forbidden'],
      [413, 'body.too_large'],
      [429, 'rate_limit.exceeded'],
    ];
    for (const [status, code] of rows) {
      const app = toAppError(new HttpError(status, code as never));
      expect(app.status).toBe(status);
      expect(app.code).toBe(code);
    }
  });
});

describe('code-implied headers', () => {
  it('sets WWW-Authenticate Bearer on a 401 auth.token_missing', () => {
    const app = toAppError(new HttpError(401, 'auth.token_missing' as never));
    expect(app.headers?.['WWW-Authenticate']).toBe('Bearer');
  });

  it('sets WWW-Authenticate invalid_token on a 401 auth.token_invalid', () => {
    const app = toAppError(new HttpError(401, 'auth.token_invalid' as never));
    expect(app.headers?.['WWW-Authenticate']).toBe('Bearer error="invalid_token"');
  });

  it('never overwrites an explicitly-set WWW-Authenticate header', () => {
    const app = toAppError(
      new HttpError(401, 'auth.token_missing' as never, undefined, {
        'WWW-Authenticate': 'Bearer realm="woc"',
      }),
    );
    expect(app.headers?.['WWW-Authenticate']).toBe('Bearer realm="woc"');
  });

  it('sources Retry-After on a 429 from params.retryAfterSeconds', () => {
    const app = toAppError(
      new HttpError(429, 'rate_limit.exceeded' as never, { retryAfterSeconds: 30 }),
    );
    expect(app.headers?.['Retry-After']).toBe('30');
  });

  it('does NOT fabricate Retry-After when neither a header nor the param is present', () => {
    const app = toAppError(new HttpError(429, 'rate_limit.exceeded' as never));
    expect(app.headers?.['Retry-After']).toBeUndefined();
  });
});

describe('rateLimit429Headers (draft-11 structured fields)', () => {
  it('builds Retry-After + RateLimit + RateLimit-Policy from the policy and outcome', () => {
    const headers = rateLimit429Headers(
      { name: 'woc_balance', limit: 20, windowSeconds: 60 },
      { remaining: 3, resetSeconds: 17 },
    );
    expect(headers).toEqual({
      'Retry-After': '17',
      RateLimit: '"woc_balance";r=3;t=17',
      'RateLimit-Policy': '"woc_balance";q=20;w=60',
    });
    // The legacy X-RateLimit-* trio is deliberately never emitted.
    expect(Object.keys(headers)).not.toContain('X-RateLimit-Limit');
  });

  it('when passed as HttpError headers, the 429 Retry-After no-ops applyImpliedHeaders (same value)', () => {
    const outcome = { remaining: 0, resetSeconds: 42 };
    const err = new HttpError(
      429,
      'rate_limit.exceeded' as never,
      { retryAfterSeconds: outcome.resetSeconds },
      rateLimit429Headers({ name: 'card_upload', limit: 10, windowSeconds: 60 }, outcome),
    );
    const app = toAppError(err);
    expect(app.headers?.['Retry-After']).toBe('42');
    expect(app.headers?.RateLimit).toBe('"card_upload";r=0;t=42');
    expect(app.headers?.['RateLimit-Policy']).toBe('"card_upload";q=10;w=60');
  });
});

describe('validation.failed carries every issue in one pass', () => {
  it('surfaces all issues (pointer + code preserved) in the problem body', () => {
    const issues = [
      { pointer: '/page', code: 'min' },
      { pointer: '/sort', code: 'enum' },
    ];
    const err = new HttpError(422, 'validation.failed' as never, issuesParam(issues));
    const res = mapError(err, fakeCtx(), { surface: 'problem' });
    const body = JSON.parse(res.body);
    expect(body.code).toBe('validation.failed');
    expect(body.issues).toHaveLength(2);
    expect(body.issues).toEqual(issues);
  });

  it('works from a raw thrown decode-failure shape too', () => {
    const issues = [
      { pointer: '/a', code: 'type' },
      { pointer: '/b', code: 'required' },
    ];
    const res = mapError({ ok: false, issues }, fakeCtx(), { surface: 'problem' });
    const body = JSON.parse(res.body);
    expect(body.status).toBe(422);
    expect(body.issues).toEqual(issues);
  });
});

describe('per-surface serializer contract', () => {
  it('problem+json: type/title/status/detail/instance/code and Content-Type', () => {
    const ctx = fakeCtx({ path: '/api/widgets/9' });
    const res = mapError(new HttpError(403, 'auth.forbidden' as never), ctx, {
      surface: 'problem',
    });
    expect(res.status).toBe(403);
    expect(res.contentType).toBe('application/problem+json');
    const body = JSON.parse(res.body);
    expect(body.type).toBe('about:blank');
    expect(body.title).toBe('Forbidden');
    expect(body.status).toBe(403);
    expect(typeof body.detail).toBe('string');
    expect(body.instance).toBe('/api/widgets/9');
    expect(body.code).toBe('auth.forbidden');
    expect(res.headers['X-Request-Id']).toBe('test-req-1');
  });

  it('oauth: { error, error_description } and Content-Type', () => {
    const res = mapError(new HttpError(401, 'auth.token_invalid' as never), fakeCtx(), {
      surface: 'oauth',
    });
    expect(res.status).toBe(401);
    expect(res.contentType).toBe('application/json');
    const body = JSON.parse(res.body);
    expect(body.error).toBe('invalid_client');
    expect(typeof body.error_description).toBe('string');
    expect(res.headers['X-Request-Id']).toBe('test-req-1');
  });

  it('admin: { success: false, data: null, error: code } and Content-Type', () => {
    const res = mapError(new HttpError(409, 'db.conflict' as never), fakeCtx(), {
      surface: 'admin',
    });
    expect(res.status).toBe(409);
    expect(res.contentType).toBe('application/json');
    expect(JSON.parse(res.body)).toEqual({ success: false, data: null, error: 'db.conflict' });
    expect(res.headers['X-Request-Id']).toBe('test-req-1');
  });

  it('html: doctype page, title, detail, Cache-Control no-store and Content-Type', () => {
    const res = mapError(new HttpError(403, 'auth.forbidden' as never), fakeCtx(), {
      surface: 'html',
    });
    expect(res.status).toBe(403);
    expect(res.contentType).toBe('text/html; charset=utf-8');
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body.startsWith('<!doctype html>')).toBe(true);
    expect(res.body).toContain('<title>Forbidden</title>');
    expect(res.body).toContain('<h1>Forbidden</h1>');
    expect(res.body).toContain('You do not have permission to access this resource.');
    expect(res.headers['X-Request-Id']).toBe('test-req-1');
  });

  it('redirect: 302 + Location to a generic error URL, empty body', () => {
    const res = mapError(new HttpError(403, 'auth.forbidden' as never), fakeCtx(), {
      surface: 'redirect',
    });
    expect(res.status).toBe(302);
    expect(res.headers.Location).toBe('/error?code=auth.forbidden');
    expect(res.contentType).toBe('text/html; charset=utf-8');
    expect(res.body).toBe('');
    expect(res.headers['X-Request-Id']).toBe('test-req-1');
  });

  it('binary: text/plain code body with merged Connection header', () => {
    const err = new HttpError(403, 'auth.forbidden' as never, undefined, { Connection: 'close' });
    const res = mapError(err, fakeCtx(), { surface: 'binary' });
    expect(res.status).toBe(403);
    expect(res.contentType).toBe('text/plain; charset=utf-8');
    expect(res.body).toBe('auth.forbidden');
    expect(res.headers.Connection).toBe('close');
    expect(res.headers['X-Request-Id']).toBe('test-req-1');
  });

  it('ok_false: { ok: false } at the legacy 405 and Content-Type', () => {
    const res = mapError(new HttpError(405, 'auth.forbidden' as never), fakeCtx(), {
      surface: 'ok_false',
    });
    expect(res.status).toBe(405);
    expect(res.contentType).toBe('application/json');
    expect(JSON.parse(res.body)).toEqual({ ok: false });
    expect(res.headers['X-Request-Id']).toBe('test-req-1');
  });
});

describe('normalizeSurface (exercised through mapError)', () => {
  const err = new HttpError(403, 'auth.forbidden' as never);

  it("maps the EnvelopeKind 'problem+json' to the problem serializer", () => {
    const res = mapError(err, fakeCtx(), { surface: 'problem+json' });
    expect(res.contentType).toBe('application/problem+json');
  });

  it("maps the EnvelopeKind 'legacy405' to the ok_false serializer", () => {
    const res = mapError(new HttpError(405, 'auth.forbidden' as never), fakeCtx(), {
      surface: 'legacy405',
    });
    expect(JSON.parse(res.body)).toEqual({ ok: false });
    expect(res.contentType).toBe('application/json');
  });

  it('defaults an absent surface to problem', () => {
    const res = mapError(err, fakeCtx());
    expect(res.contentType).toBe('application/problem+json');
  });
});

describe('onUnexpected sink', () => {
  it('receives the ORIGINAL error exactly once on an unexpected 500', () => {
    const spy = vi.fn();
    const original = new Error('boom: SELECT * FROM secrets');
    const res = mapError(original, fakeCtx(), { surface: 'problem', onUnexpected: spy });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(original);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body).code).toBe('internal.error');
  });

  it('fires for a thrown string mapped to 500', () => {
    const spy = vi.fn();
    mapError('plain string failure', fakeCtx(), { onUnexpected: spy });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('plain string failure');
  });

  it('is NOT called for a mapped HttpError', () => {
    const spy = vi.fn();
    mapError(new HttpError(403, 'auth.forbidden' as never), fakeCtx(), { onUnexpected: spy });
    expect(spy).not.toHaveBeenCalled();
  });

  it('is NOT called for a mapped SyntaxError (400) or pg conflict (409)', () => {
    const spy = vi.fn();
    mapError(new SyntaxError('bad json'), fakeCtx(), { onUnexpected: spy });
    mapError({ code: '23505' }, fakeCtx(), { onUnexpected: spy });
    expect(spy).not.toHaveBeenCalled();
  });

  it('falls back to the default sink without throwing', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = mapError(new Error('boom'), fakeCtx());
    expect(res.status).toBe(500);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });
});

describe('500 leak-freedom across every surface', () => {
  const surfaces = ['problem', 'oauth', 'admin', 'html', 'redirect', 'binary', 'ok_false'] as const;
  const secrets = ['secrets', 'SELECT', 'characters_name_key', 'Gandalf', 'STACKLINE'];

  it('never leaks the original error message, SQL, table, or stack in body or headers', () => {
    const boom = new Error('SELECT * FROM secrets WHERE token = $1 -- Gandalf');
    boom.stack = 'Error: STACKLINE\n    at db.ts:42:7';
    for (const surface of surfaces) {
      const res = mapError(boom, fakeCtx(), { surface });
      const haystack = res.body + JSON.stringify(res.headers);
      for (const secret of secrets) {
        expect(haystack).not.toContain(secret);
      }
    }
  });

  it('a 409 pg conflict never leaks the driver detail/constraint text', () => {
    const dbErr = new Error('duplicate key value violates unique constraint "characters_name_key"');
    (dbErr as { code?: string }).code = '23505';
    (dbErr as { detail?: string }).detail = 'Key (name)=(Gandalf) already exists.';
    const res = mapError(dbErr, fakeCtx(), { surface: 'problem' });
    const haystack = res.body + JSON.stringify(res.headers);
    expect(haystack).not.toContain('characters_name_key');
    expect(haystack).not.toContain('Gandalf');
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body).code).toBe('db.conflict');
  });
});

describe('problem+json params land in the body without shadowing reserved members', () => {
  it('surfaces maxBytes (413), retryAfterSeconds (429, also a header), and date in the body', () => {
    const res413 = mapError(
      new HttpError(413, 'body.too_large' as never, { maxBytes: 1048576 }),
      fakeCtx(),
      { surface: 'problem' },
    );
    expect(JSON.parse(res413.body).maxBytes).toBe(1048576);

    const res429 = mapError(
      new HttpError(429, 'rate_limit.exceeded' as never, { retryAfterSeconds: 30 }),
      fakeCtx(),
      { surface: 'problem' },
    );
    expect(JSON.parse(res429.body).retryAfterSeconds).toBe(30);
    expect(res429.headers['Retry-After']).toBe('30');

    const resSusp = mapError(
      new HttpError(403, 'moderation.suspended_until' as never, { date: '2026-07-01' }),
      fakeCtx(),
      { surface: 'problem' },
    );
    expect(JSON.parse(resSusp.body).date).toBe('2026-07-01');
  });

  it('a param colliding with a reserved member (code/status) NEVER shadows it', () => {
    const evil = new HttpError(413, 'body.too_large' as never, {
      code: 'HACKED',
      status: 999,
      type: 'evil',
    });
    const body = JSON.parse(mapError(evil, fakeCtx(), { surface: 'problem' }).body);
    expect(body.code).toBe('body.too_large');
    expect(body.status).toBe(413);
    expect(body.type).toBe('about:blank');
  });
});

describe('code-implied header edge cases', () => {
  it('never overwrites an explicitly-set WWW-Authenticate given in lowercase (case-insensitive)', () => {
    const app = toAppError(
      new HttpError(401, 'auth.token_missing' as never, undefined, {
        'www-authenticate': 'Bearer realm="lower"',
      }),
    );
    expect(app.headers?.['www-authenticate']).toBe('Bearer realm="lower"');
    expect(app.headers?.['WWW-Authenticate']).toBeUndefined();
  });

  it('does NOT add WWW-Authenticate to a 401 whose code is not auth.* (scoped by design)', () => {
    const app = toAppError(new HttpError(401, 'two_factor.code_invalid' as never));
    expect(app.headers?.['WWW-Authenticate']).toBeUndefined();
  });
});

describe('the unexpected flag is the single source of truth for the onUnexpected sink', () => {
  it('is true only for the catch-all 500, not for any mapped throwable', () => {
    expect(toAppError(new Error('x')).unexpected).toBe(true);
    expect(toAppError('str').unexpected).toBe(true);
    expect(toAppError({ any: 'obj' }).unexpected).toBe(true);
    expect(toAppError({ code: '23503', message: 'FK on SELECT' }).unexpected).toBe(true);

    expect(toAppError(new HttpError(500, 'internal.error' as never)).unexpected).toBe(false);
    expect(toAppError(new SyntaxError('bad json')).unexpected).toBe(false);
    expect(toAppError({ ok: false, issues: [] }).unexpected).toBe(false);
    expect(toAppError({ code: '23505' }).unexpected).toBe(false);
  });

  it('a deliberate HttpError(500) does NOT trigger onUnexpected', () => {
    const spy = vi.fn();
    mapError(new HttpError(500, 'internal.error' as never), fakeCtx(), { onUnexpected: spy });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('escapeHtml escapes every HTML-significant character', () => {
  it('replaces &, <, >, double-quote, and single-quote with their entities', () => {
    expect(escapeHtml(`<script>alert("x&y")</script>'`)).toBe(
      '&lt;script&gt;alert(&quot;x&amp;y&quot;)&lt;/script&gt;&#39;',
    );
  });

  it('escapes the ampersand first so a literal entity is not mis-decoded', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves already-safe text untouched', () => {
    expect(escapeHtml('Forbidden')).toBe('Forbidden');
  });
});

describe('serializer detail fallback and implied-header propagation', () => {
  it('falls back to the HTTP status reason for a code with no DETAILS entry', () => {
    // moderation.suspended is a harvested code absent from the DETAILS map, so the problem
    // body detail must be the 403 reason phrase, pinning the detailFor `??` fallback branch.
    const res = mapError(new HttpError(403, 'moderation.suspended' as never), fakeCtx(), {
      surface: 'problem',
    });
    expect(JSON.parse(res.body).detail).toBe('Forbidden');
  });

  it('propagates WWW-Authenticate onto the serialized 401 response headers', () => {
    const res = mapError(new HttpError(401, 'auth.token_missing' as never), fakeCtx(), {
      surface: 'problem',
    });
    expect(res.status).toBe(401);
    expect(res.headers['WWW-Authenticate']).toBe('Bearer');
  });

  it('propagates the invalid_token WWW-Authenticate variant through mapError', () => {
    const res = mapError(new HttpError(401, 'auth.token_invalid' as never), fakeCtx(), {
      surface: 'oauth',
    });
    expect(res.headers['WWW-Authenticate']).toBe('Bearer error="invalid_token"');
  });
});
