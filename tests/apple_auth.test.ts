import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleAppleLoginNew,
  resetAppleKeyCacheForTests,
  verifyAppleIdentityToken,
} from '../server/apple_auth';
import {
  consumeApplePendingLogin,
  createApplePendingLogin,
  linkAppleAccount,
  peekApplePendingLogin,
  pruneApplePendingLogins,
} from '../server/apple_auth_db';
import { resetRateLimits } from '../server/ratelimit';
import { FakeRes, makeReq } from './server/helpers';

const APPLE_TOKEN =
  'eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3Qta2V5In0.eyJpc3MiOiJodHRwczovL2FwcGxlaWQuYXBwbGUuY29tIiwiYXVkIjoiY29tLndvcmxkb2ZjbGF1ZGVjcmFmdCIsImV4cCI6NDEwMjQ0NDgwMCwic3ViIjoiYXBwbGUtdXNlci0xIiwibm9uY2UiOiJjaGFsbGVuZ2Utbm9uY2UiLCJlbWFpbCI6InJlbGF5QGV4YW1wbGUuY29tIiwiZW1haWxfdmVyaWZpZWQiOiJ0cnVlIn0.UtYD6YmQkGP_izsTY3xUCSwTUfQRGe_9DVdQLPyCSohWIqFGCkkmsYTg0IBLdwa2jUj2OE-20Huh6EKI_G8nfW0qRYausUhpHIiVCWytAKrXMwHecJuOzDBPUJ_c-YJqZtaPrHgdbdB9g_TebtKTBiW9ko9hzvjfCLt15klyUG-9pxEThfmIOWBtShgfi5-KmtCR8MnYJYWSiTUvLyhty0zCcVa2OR_FQAkDTZX5HxvRdMcyYqXZTHmH0MZaviiB7qBdBMcN9Pt0hetQht1xI9AYoa9kcE6UtH0keYi63m9z6JGlEO0CWPhdw3UAa7dNJV8lXhYqfdxFRN8uT-cBVA';
const APPLE_JWK = {
  kty: 'RSA',
  n: 'whvYP45Ly_94vCDUr0qWMoMf2JhTR2CUfMw55pt5HDI6SYEd5g7MaSY-vgibSwAY21PYGlM35Uh0_GU-Ak4gup4Y1Jw8s6mhWAaqiToCYe1Xjcv3TMz43RerOH2lUNqBTLfJDKYmqVRTZn2r3ElyaxHCpgPfP77C-AUn1JhH8QP44mk8D3U77Ov-MUvZ9mBWSsqquuIY0nY1LWFG85zXuVYjAmZZLGTj9C6iPDKsNvxfYmpHvZXswkmdPI6hsvNH5DsMaJygaZRqZJnZycWzUQGr-nzIOiAz7k5BNvRyM6Qfr7alcDELkizbElei8NCHA69HgxlC6TJAEp2w10MW6w',
  e: 'AQAB',
  kid: 'test-key',
  alg: 'RS256',
} as JsonWebKey;

afterEach(() => {
  vi.unstubAllGlobals();
  resetAppleKeyCacheForTests();
  resetRateLimits();
});

describe('Apple identity token verification', () => {
  it('accepts a signed token with the app audience and matching nonce', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ keys: [APPLE_JWK] }))),
    );
    await expect(verifyAppleIdentityToken(APPLE_TOKEN, 'challenge-nonce')).resolves.toEqual({
      subject: 'apple-user-1',
      email: 'relay@example.com',
      emailVerified: true,
    });
  });

  it('rejects replay under a different native challenge', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ keys: [APPLE_JWK] }))),
    );
    await expect(verifyAppleIdentityToken(APPLE_TOKEN, 'other-nonce')).resolves.toBeNull();
  });

  it('refreshes the JWKS once when Apple rotates to an unknown key ID', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ keys: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ keys: [APPLE_JWK] })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(verifyAppleIdentityToken(APPLE_TOKEN, 'challenge-nonce')).resolves.not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('Apple account attachment guards', () => {
  it('fails closed when either side of the Apple link is already claimed', async () => {
    const pool = { query: vi.fn().mockRejectedValue({ code: '23505' }) };
    await expect(linkAppleAccount(pool as never, 7, 'subject', null)).resolves.toBe(false);
  });
});

describe('Apple pending login choices', () => {
  const row = {
    token: 'choice-token',
    apple_subject: 'apple-user-1',
    apple_email: 'player@example.com',
    apple_email_verified: true,
    display_name: 'Player One',
  };

  it('parks an expiring verified identity for the chooser', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    await createApplePendingLogin({ query } as never, {
      token: row.token,
      subject: row.apple_subject,
      email: row.apple_email,
      emailVerified: true,
      displayName: row.display_name,
      ttlMinutes: 15,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO apple_pending_logins'),
      [row.token, row.apple_subject, row.apple_email, true, row.display_name, '15'],
    );
  });

  it('peeks without consuming, then consumes with one atomic delete', async () => {
    const peekQuery = vi.fn().mockResolvedValue({ rows: [row], rowCount: 1 });
    await expect(peekApplePendingLogin({ query: peekQuery } as never, row.token)).resolves.toEqual(
      row,
    );
    expect(String(peekQuery.mock.calls[0][0])).not.toContain('DELETE');

    const consumeQuery = vi.fn().mockResolvedValue({ rows: [row], rowCount: 1 });
    await expect(
      consumeApplePendingLogin({ query: consumeQuery } as never, row.token),
    ).resolves.toEqual(row);
    expect(String(consumeQuery.mock.calls[0][0])).toContain('DELETE FROM apple_pending_logins');
  });

  it('deletes expired pending identities during maintenance', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 2 });
    await pruneApplePendingLogins({ query } as never);
    expect(query).toHaveBeenCalledWith(
      'DELETE FROM apple_pending_logins WHERE expires_at <= now()',
    );
  });

  it('rejects blocked IP account creation before consuming the pending identity', async () => {
    const req = makeReq({ method: 'POST', url: '/api/auth/apple/login/new' });
    (req.socket as { remoteAddress: string }).remoteAddress = '203.0.113.9';
    const res = new FakeRes();
    const isIpBlocked = vi.fn(() => true);

    await handleAppleLoginNew(req, res as never, { linkToken: row.token }, isIpBlocked);

    expect(isIpBlocked).toHaveBeenCalledWith('203.0.113.9');
    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.body)).toEqual({
      error: 'rate limited',
      code: 'auth.too_many_attempts',
    });
  });
});
