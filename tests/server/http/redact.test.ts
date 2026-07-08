// Unit tests for the secret/PII redactor (server/http/redact.ts). One decisive
// assertion per named secret class (key-based and value-pattern based), plus the
// structural contracts: nested objects and arrays, plain-string scrubbing,
// idempotency, non-secret preservation (a short apiError code survives), and cycle
// safety.

import { describe, expect, it } from 'vitest';
import { REDACTED, redact } from '../../../server/http/redact';

const HEX64 = 'a'.repeat(64);

describe('redact: named secret classes', () => {
  it('(a) scrubs an Authorization header value by key (any casing)', () => {
    const out = redact({ Authorization: `Bearer ${HEX64}` }) as Record<string, unknown>;
    expect(out.Authorization).toBe(REDACTED);
  });

  it("(a) scrubs a 'Bearer <token>' substring inside a plain string", () => {
    expect(redact(`auth is Bearer ${HEX64} here`)).toBe('auth is [redacted] here');
  });

  it('(b) scrubs a standalone 64-hex bearer token inside a string', () => {
    expect(redact(`token ${HEX64} end`)).toBe('token [redacted] end');
  });

  it('(b) scrubs a 64-hex value under any key', () => {
    const out = redact({ authCode: HEX64 }) as Record<string, unknown>;
    expect(out.authCode).toBe(REDACTED);
  });

  it('(b) scrubs an opaque NON-hex value under a token-named key', () => {
    // The bare `token` needle, not the 64-hex value pattern, must catch these.
    const out = redact({ token: 'opaque-not-hex', sessionToken: 'abc123' }) as Record<
      string,
      unknown
    >;
    expect(out.token).toBe(REDACTED);
    expect(out.sessionToken).toBe(REDACTED);
  });

  it('(c) scrubs a password field and its variants', () => {
    const out = redact({ password: 'hunter2', newPassword: 'hunter3' }) as Record<string, unknown>;
    expect(out.password).toBe(REDACTED);
    expect(out.newPassword).toBe(REDACTED);
  });

  it('(d) scrubs cookie and set-cookie headers', () => {
    const out = redact({ cookie: 'sid=abc', 'set-cookie': ['sid=abc; HttpOnly'] }) as Record<
      string,
      unknown
    >;
    expect(out.cookie).toBe(REDACTED);
    expect(out['set-cookie']).toBe(REDACTED);
  });

  it('(e) scrubs the OAuth PKCE code_verifier and access/refresh tokens by key', () => {
    const out = redact({
      code_verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      access_token: 'opaque-access',
      refresh_token: 'opaque-refresh',
    }) as Record<string, unknown>;
    expect(out.code_verifier).toBe(REDACTED);
    expect(out.access_token).toBe(REDACTED);
    expect(out.refresh_token).toBe(REDACTED);
  });

  it('(f) scrubs a TOTP secret by key and a numeric one-time code under a code key', () => {
    const out = redact({
      secret: 'JBSWY3DPEHPK3PXP',
      pendingSecret: 'X',
      code: '123456',
    }) as Record<string, unknown>;
    expect(out.secret).toBe(REDACTED);
    expect(out.pendingSecret).toBe(REDACTED);
    expect(out.code).toBe(REDACTED);
  });

  it('(g) scrubs wallet private-key-shaped fields by key', () => {
    const out = redact({
      private_key: 'skeleton',
      privateKey: 'skeleton',
      mnemonic: 'word word word',
    }) as Record<string, unknown>;
    expect(out.private_key).toBe(REDACTED);
    expect(out.privateKey).toBe(REDACTED);
    expect(out.mnemonic).toBe(REDACTED);
  });
});

describe('redact: structure and totality', () => {
  it('recurses into nested objects and arrays', () => {
    const out = redact({
      user: { name: 'Fernando', password: 'x' },
      items: [{ access_token: 'a' }, { note: 'keep' }],
    }) as { user: Record<string, unknown>; items: Array<Record<string, unknown>> };
    expect(out.user.name).toBe('Fernando');
    expect(out.user.password).toBe(REDACTED);
    expect(out.items[0].access_token).toBe(REDACTED);
    expect(out.items[1].note).toBe('keep');
  });

  it('scrubs a plain string carrying BOTH a Bearer token and a standalone 64-hex', () => {
    const line = `hdr Bearer ${HEX64} and raw ${HEX64} tail`;
    expect(redact(line)).toBe('hdr [redacted] and raw [redacted] tail');
  });

  it('is idempotent: redact(redact(x)) deep-equals redact(x)', () => {
    const input = {
      password: 'x',
      note: 'ok',
      nested: { secret: 's', keep: 42, when: new Date(0) },
      list: [HEX64, 'auth.invalid'],
    };
    const once = redact(input);
    const twice = redact(once);
    expect(twice).toEqual(once);
  });

  it('preserves non-secret fields verbatim, including a short apiError code', () => {
    const when = new Date(0);
    const out = redact({
      code: 'auth.invalid',
      name: 'Fernando',
      level: 42,
      active: true,
      when,
    }) as Record<string, unknown>;
    expect(out.code).toBe('auth.invalid');
    expect(out.name).toBe('Fernando');
    expect(out.level).toBe(42);
    expect(out.active).toBe(true);
    expect(out.when).toEqual(when);
  });

  it('does not hang or throw on a cyclic input', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    let out: unknown;
    expect(() => {
      out = redact(cyclic);
    }).not.toThrow();
    expect((out as Record<string, unknown>).a).toBe(1);
    expect((out as Record<string, unknown>).self).toBe(REDACTED);
  });

  it('scrubs a dashed device-flow user code under an otp-scoped key', () => {
    const out = redact({ user_code: 'WXYZ-1234', code: 'auth.invalid' }) as Record<string, unknown>;
    expect(out.user_code).toBe(REDACTED);
    expect(out.code).toBe('auth.invalid');
  });

  it('collapses raw byte values wholesale, even under a non-secret key name', () => {
    const out = redact({
      blob: Buffer.from('a raw byte secret'),
      typed: new Uint8Array([1, 2, 3]),
      raw: new ArrayBuffer(8),
      note: 'plain',
    }) as Record<string, unknown>;
    expect(out.blob).toBe(REDACTED);
    expect(out.typed).toBe(REDACTED);
    expect(out.raw).toBe(REDACTED);
    expect(out.note).toBe('plain');
  });
});

describe('redact: email value pattern', () => {
  it('(a) scrubs a plain email address in a string value', () => {
    const out = redact({ email: 'fernando@example.com' }) as Record<string, unknown>;
    expect(out.email).toBe(REDACTED);
  });

  it('(b) scrubs an email embedded mid-sentence, preserving surrounding text', () => {
    expect(redact('reset link sent to fernando@example.com now')).toBe(
      'reset link sent to [redacted] now',
    );
  });

  it('(c) scrubs multiple emails in one value', () => {
    expect(redact('cc alice@example.com and bob@mail.co.uk please')).toBe(
      'cc [redacted] and [redacted] please',
    );
  });

  it('(d) scrubs an email nested inside an object and inside an array value', () => {
    const out = redact({
      contact: { primary: 'user@domain.io' },
      recipients: ['a@b.com', 'plain text'],
    }) as { contact: Record<string, unknown>; recipients: unknown[] };
    expect(out.contact.primary).toBe(REDACTED);
    expect(out.recipients[0]).toBe(REDACTED);
    expect(out.recipients[1]).toBe('plain text');
  });

  it('(e) negative: a bare @handle without a dot-TLD survives', () => {
    expect(redact('ping @fernando in chat')).toBe('ping @fernando in chat');
  });

  it('(f) negative: a version-style name@tag without a dotted TLD survives', () => {
    // 'sha256' has no dot-TLD, so this build tag is not email-shaped and must survive.
    expect(redact('artifact build-7@sha256 ready')).toBe('artifact build-7@sha256 ready');
  });

  it('(f) negative: a bare domain with no local part survives', () => {
    expect(redact('see example.com for the docs')).toBe('see example.com for the docs');
  });

  it('(g) still scrubs a maximum-length RFC-shaped address', () => {
    // 64-char local part + a long dotted domain: inside the bounded quantifiers.
    // 'z' keeps the local part out of HEX64_RE's [a-f0-9]{64} (which would
    // otherwise redact it first and split the address before the email pass).
    const email = `${'z'.repeat(64)}@${'sub.'.repeat(10)}example.com`;
    expect(redact(`contact ${email} now`)).toBe(`contact ${REDACTED} now`);
  });

  it('(h) pathological non-matching values complete in linear time', () => {
    // Regression pin for the bounded-quantifier EMAIL_RE: with the earlier unbounded
    // pattern each of these 80 KB non-matching shapes backtracked quadratically
    // (about 3 seconds each, blowing this test's 2 s cap); the bounded pattern
    // scans each in about 10 ms, so the cap has two orders of magnitude of slack
    // while still failing loudly on a quadratic regression.
    const shapes = [
      `a@${'a.'.repeat(40_000)}`,
      `${'a'.repeat(40_000)}@${'b'.repeat(40_000)}`,
      `x@${'.'.repeat(80_000)}`,
      `x@${'a.-'.repeat(26_000)}`,
    ];
    for (const value of shapes) {
      const out = redact({ blob: value }) as Record<string, unknown>;
      expect(out.blob).toBe(value);
    }
  }, 2_000);
});
