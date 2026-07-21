// The error model's 500-NO-LEAK HARD GATE (server/http/errors.ts).
//
// This file writes NO implementation. It is the adversarial security gate that
// proves the unexpected-error (500) path leaks NOTHING internal. It feeds a set
// of hostile throwables (a pg-style error carrying SQL + table + column + detail,
// a real Error with a populated stack, a thrown raw string, and a plain object
// carrying stack/table/detail/query) through mapError on EVERY one of the seven
// per-surface envelopes (using BOTH the EnvelopeKind spellings and the
// ErrorSurface aliases, so normalizeSurface is exercised) and asserts, for each:
//   1. status === 500 with the generic 'internal.error' identity, on every surface
//      except 'redirect' (the locked Discord-callback design bounces 302 to
//      /error?code=internal.error; still the unexpected path, still leak-free).
//   2. NONE of the seeded secret substrings appear anywhere in the serialized
//      body, contentType, or header values.
//   3. opts.onUnexpected received the ORIGINAL throwable, exactly once.
// A benign HttpError 404 is the control: it must NOT 500 and must NOT reach the
// onUnexpected sink, proving the gate is specific to unexpected throwables.
//
// Leak comparison is case-SENSITIVE on purpose: the secrets are seeded with
// their exact casing, and any real internal leak (a SQL string, a table name, a
// stack frame, a driver detail) reproduces that casing verbatim. A blanket
// lowercase compare would risk false positives against generic error-page copy
// or CSS (words like "select"), so we keep the seeded, exact-casing signatures.
//
// errors.ts is authored IN PARALLEL by Agent B; if this file fails ONLY because
// server/http/errors.ts does not yet exist, that is expected (deferred run).

import { describe, expect, it, vi } from 'vitest';
import { HttpError, mapError } from '../../../server/http/errors';
import { fakeCtx } from '../helpers/fake_ctx';

// --- Adversarial throwables, each seeded with distinctive secret substrings. ---

// 1a. A pg-style PLAIN OBJECT with a NON-23505 code so it is an UNEXPECTED 500
// (not a mapped 409 conflict). Its message, detail, table, column, constraint,
// and stack all carry internal SQL/schema text that must never escape.
const pgLikeError = {
  code: '53300',
  message: 'SELECT * FROM accounts WHERE token = $1 -- DROP',
  table: 'accounts',
  column: 'password_hash',
  detail: 'Key (email)=(victim@example.com) already exists.',
  schema: 'public',
  constraint: 'accounts_email_key',
  stack: 'Error: at db.ts:42 SELECT secret',
};

// 1b. The same hostile payload as a REAL Error instance (a populated, real .stack
// plus the pg fields hung off the instance), exercising the Error branch too.
const pgLikeRealError = Object.assign(
  new Error('SELECT * FROM accounts WHERE token = $1 -- DROP'),
  {
    code: '53300',
    table: 'accounts',
    column: 'password_hash',
    detail: 'Key (email)=(victim@example.com) already exists.',
    schema: 'public',
    constraint: 'accounts_email_key',
  },
);

// 2. A generic Error whose message embeds a filesystem path and a token; its
// real V8 .stack also contains absolute file paths.
const genericError = new Error('Unhandled at /Users/secret/path SECRET_TOKEN=abc123');

// 3. A thrown raw string (not an Error at all).
const thrownString = 'raw string failure SECRET_SQL SELECT 1';

// 4. A thrown plain object carrying stack/table/detail/query.
const plainLeakyObject = {
  stack: 'leaky stack frame',
  table: 'sessions',
  detail: 'sensitive detail text',
  query: 'INSERT INTO secrets ...',
};

// Every secret substring that must NEVER appear in any serialized output. Each is
// genuinely present in a fixture above and is specific enough that it cannot
// legitimately occur in a generic 500 envelope.
const SECRETS = [
  'SELECT',
  'DROP',
  'accounts',
  'password_hash',
  'victim@example.com',
  'accounts_email_key',
  'db.ts:42',
  '/Users/secret/path',
  'SECRET_TOKEN',
  'abc123',
  'SECRET_SQL',
  'leaky stack frame',
  'sessions',
  'sensitive detail text',
  'INSERT INTO secrets',
  '53300',
] as const;

// All seven surfaces, spelled with BOTH the EnvelopeKind names and the
// ErrorSurface aliases so opts.surface exercises normalizeSurface end to end.
// ('problem+json' aliases 'problem'; 'legacy405' aliases 'ok_false'.)
const SURFACES = [
  'problem+json',
  'problem',
  'oauth',
  'admin',
  'html',
  'redirect',
  'binary',
  'legacy405',
  'ok_false',
] as const;

type Surface = (typeof SURFACES)[number];

interface Fixture {
  readonly label: string;
  readonly throwable: unknown;
  // The exact value opts.onUnexpected must receive (reference identity for the
  // object/Error fixtures; the same string primitive for the thrown-string one).
  readonly expected: unknown;
}

const FIXTURES: readonly Fixture[] = [
  {
    label: 'pg-style plain object (non-23505 code)',
    throwable: pgLikeError,
    expected: pgLikeError,
  },
  {
    label: 'real Error with pg props + real stack',
    throwable: pgLikeRealError,
    expected: pgLikeRealError,
  },
  { label: 'generic Error with populated stack', throwable: genericError, expected: genericError },
  { label: 'thrown raw string', throwable: thrownString, expected: thrownString },
  {
    label: 'plain object with stack/table/detail/query',
    throwable: plainLeakyObject,
    expected: plainLeakyObject,
  },
];

/**
 * Assert the per-surface unexpected-error shape. Status is 500 on every surface
 * EXCEPT 'redirect', which by the locked design maps an unexpected error to a 302
 * bounce to /error?code=internal.error (the Discord-callback case); the original
 * still flows to onUnexpected and the generic code rides the Location, so it stays
 * leak-free. For JSON envelopes the generic identity is checked (oauth maps the
 * internal code to the RFC token 'server_error'; admin/problem carry
 * 'internal.error'; ok_false carries { ok:false }; binary embeds the code).
 * html/redirect are non-JSON, so only the leak scan (at the call site) applies.
 */
function assertEnvelope(surface: Surface, result: { status: number; body: string }): void {
  // The redirect surface bounces (302) instead of returning a 500 body; every
  // other surface returns a 500. Either way the path is the unexpected-error path
  // (onUnexpected fires) and nothing internal leaks.
  expect(result.status).toBe(surface === 'redirect' ? 302 : 500);
  switch (surface) {
    case 'problem+json':
    case 'problem': {
      const parsed = JSON.parse(result.body) as { code?: unknown };
      expect(parsed.code).toBe('internal.error');
      break;
    }
    case 'oauth': {
      const parsed = JSON.parse(result.body) as { error?: unknown };
      expect(parsed.error).toBe('server_error');
      break;
    }
    case 'admin': {
      const parsed = JSON.parse(result.body) as { error?: unknown };
      expect(parsed.error).toBe('internal.error');
      break;
    }
    case 'legacy405':
    case 'ok_false': {
      const parsed = JSON.parse(result.body) as { ok?: unknown };
      expect(parsed.ok).toBe(false);
      break;
    }
    case 'binary': {
      expect(result.body).toContain('internal.error');
      break;
    }
    case 'html':
    case 'redirect':
      // Non-JSON surfaces: leak-freedom is the only contract (asserted below).
      break;
  }
}

describe('mapError 500-no-leak hard gate', () => {
  for (const fx of FIXTURES) {
    describe(`unexpected throwable: ${fx.label}`, () => {
      for (const surface of SURFACES) {
        it(`maps to a leak-free 500 on surface '${surface}'`, () => {
          const onUnexpected = vi.fn();
          const ctx = fakeCtx({ path: '/api/x' });

          const result = mapError(fx.throwable, ctx, { surface, onUnexpected });

          // 500 + the generic, per-surface envelope (no internal identity).
          assertEnvelope(surface, result);

          // The ORIGINAL throwable reaches the internal sink exactly once: we log
          // internally, we leak externally nothing.
          expect(onUnexpected).toHaveBeenCalledTimes(1);
          expect(onUnexpected.mock.calls[0]?.[0]).toBe(fx.expected);

          // Body, contentType, and EVERY header value must be free of every
          // seeded secret substring.
          const haystack = `${result.body}||${result.contentType}||${JSON.stringify(result.headers)}`;
          for (const secret of SECRETS) {
            expect(haystack).not.toContain(secret);
          }
        });
      }
    });
  }

  // Control: a benign HttpError is an EXPECTED error. It must keep its own status
  // (404, not 500) and must never reach the onUnexpected sink, proving the gate
  // fires only for genuinely unexpected throwables.
  it('control: a benign HttpError 404 does not 500 and does not call onUnexpected', () => {
    const onUnexpected = vi.fn();
    const ctx = fakeCtx({ path: '/api/x' });

    const result = mapError(new HttpError(404, 'auth.forbidden'), ctx, {
      surface: 'problem+json',
      onUnexpected,
    });

    expect(result.status).toBe(404);
    expect(result.status).not.toBe(500);
    expect(onUnexpected).not.toHaveBeenCalled();
  });
});
