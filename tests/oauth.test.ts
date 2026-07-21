import type * as http from 'node:http';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// db.ts and oauth_db.ts touch Postgres; mock both so we exercise the OAuth
// handler logic (PKCE, one-time codes, device grant) with no DB.
vi.mock('../server/db', () => ({
  pool: {},
  saveToken: vi.fn(async () => {}),
  accountAndScopeForToken: vi.fn(async () => ({ accountId: 5, scope: 'full' })),
  moderationStatusForAccount: vi.fn(async () => ({ locked: false, message: '' })),
  revokeReadToken: vi.fn(async () => true),
}));
vi.mock('../server/oauth_db', () => ({
  getOAuthClient: vi.fn(async () => ({
    client_id: 'companion',
    name: 'Companion',
    redirect_uris: 'https://app.example/cb',
  })),
  upsertOAuthClient: vi.fn(async () => {}),
  createAuthCode: vi.fn(async () => {}),
  consumeAuthCode: vi.fn(),
  createDeviceCode: vi.fn(async () => {}),
  getDeviceByUserCode: vi.fn(),
  approveDeviceCode: vi.fn(),
  getDeviceByDeviceCode: vi.fn(),
  consumeDeviceCode: vi.fn(),
}));

const {
  handleOAuth,
  verifyPkce,
  pkceChallengeFromVerifier,
  newUserCode,
  normalizeUserCode,
  redirectAllowed,
} = await import('../server/oauth');
const db = await import('../server/db');
const oauthDb = await import('../server/oauth_db');

function makeReq(method: string, url: string, body: unknown, headers: Record<string, string> = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  const req = Readable.from([Buffer.from(payload)]) as Readable & {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
  req.method = method;
  req.url = url;
  req.headers = { 'content-type': 'application/json', ...headers };
  return req as unknown as http.IncomingMessage;
}
function makeRes() {
  return {
    statusCode: 0,
    body: '',
    headers: {} as Record<string, unknown>,
    writeHead(s: number, h?: Record<string, unknown>) {
      this.statusCode = s;
      if (h) Object.assign(this.headers, h);
    },
    setHeader(k: string, v: unknown) {
      this.headers[k] = v;
    },
    end(d?: string) {
      this.body = d ?? '';
    },
  };
}
async function call(method: string, url: string, body: unknown, headers?: Record<string, string>) {
  const res = makeRes();
  await handleOAuth(makeReq(method, url, body, headers), res as unknown as http.ServerResponse);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}

async function callRaw(
  method: string,
  url: string,
  body: unknown,
  headers?: Record<string, string>,
) {
  const res = makeRes();
  await handleOAuth(makeReq(method, url, body, headers), res as unknown as http.ServerResponse);
  return { status: res.statusCode, body: res.body, headers: res.headers };
}

const BEARER = { authorization: `Bearer ${'a'.repeat(64)}` };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.accountAndScopeForToken).mockResolvedValue({ accountId: 5, scope: 'full' });
  vi.mocked(db.moderationStatusForAccount).mockResolvedValue({
    locked: false,
    banned: false,
    suspendedUntil: null,
    reason: '',
    message: '',
    chatMutedUntil: null,
    chatStrikes: 0,
  });
  vi.mocked(oauthDb.getOAuthClient).mockResolvedValue({
    client_id: 'companion',
    name: 'Companion',
    redirect_uris: 'https://app.example/cb',
  });
});

describe('PKCE', () => {
  it('matches the RFC 7636 S256 test vector', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(pkceChallengeFromVerifier(verifier)).toBe(challenge);
    expect(verifyPkce(verifier, challenge, 'S256')).toBe(true);
  });
  it('rejects a tampered verifier and unknown methods', () => {
    const verifier = 'a'.repeat(43);
    const challenge = pkceChallengeFromVerifier(verifier);
    expect(verifyPkce('b'.repeat(43), challenge, 'S256')).toBe(false);
    expect(verifyPkce(verifier, challenge, 'weird')).toBe(false);
    expect(verifyPkce('', challenge, 'S256')).toBe(false);
  });
  it('rejects the plain method (no downgrade from S256)', () => {
    // A 'plain' challenge equals the verifier; it must still be rejected.
    const verifier = 'a'.repeat(43);
    expect(verifyPkce(verifier, verifier, 'plain')).toBe(false);
  });
});

describe('user codes & redirect allowlist', () => {
  it('formats user codes as XXXX-XXXX from an unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const code = newUserCode();
      expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ23456789]{4}-[BCDFGHJKLMNPQRSTVWXZ23456789]{4}$/);
      expect(normalizeUserCode(code)).toHaveLength(8);
    }
  });
  it('matches redirect URIs exactly against the allowlist', () => {
    const list = 'https://app.example/cb\nhttps://other.example/done';
    expect(redirectAllowed(list, 'https://app.example/cb')).toBe(true);
    expect(redirectAllowed(list, 'https://app.example/cb/evil')).toBe(false);
    expect(redirectAllowed(list, 'https://evil.example/cb')).toBe(false);
  });
});

describe('authorization-code grant (happy path, one-time, PKCE)', () => {
  it('issues a read token on a valid code + verifier', async () => {
    const verifier = 'v'.repeat(43);
    vi.mocked(oauthDb.consumeAuthCode).mockResolvedValueOnce({
      account_id: 5,
      client_id: 'companion',
      redirect_uri: 'https://app.example/cb',
      code_challenge: pkceChallengeFromVerifier(verifier),
      code_challenge_method: 'S256',
      scope: 'character:read',
    });
    const r = await call('POST', '/oauth/token', {
      grant_type: 'authorization_code',
      code: 'thecode',
      code_verifier: verifier,
      client_id: 'companion',
      redirect_uri: 'https://app.example/cb',
    });
    expect(r.status).toBe(200);
    expect(r.json.token_type).toBe('bearer');
    expect(r.json.scope).toBe('character:read');
    expect(r.json.access_token).toMatch(/^[a-f0-9]{64}$/);
    // The issued token is persisted as scope='read'.
    expect(db.saveToken).toHaveBeenCalledWith(
      expect.any(String),
      5,
      expect.any(Number),
      'read',
      expect.stringContaining('oauth:'),
    );
  });

  it('rejects a reused (already-consumed) code', async () => {
    vi.mocked(oauthDb.consumeAuthCode).mockResolvedValueOnce(null); // already consumed -> null
    const r = await call('POST', '/oauth/token', {
      grant_type: 'authorization_code',
      code: 'thecode',
      code_verifier: 'v'.repeat(43),
      client_id: 'companion',
      redirect_uri: 'https://app.example/cb',
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('invalid_grant');
    expect(db.saveToken).not.toHaveBeenCalled();
  });

  it('rejects a bad PKCE verifier', async () => {
    vi.mocked(oauthDb.consumeAuthCode).mockResolvedValueOnce({
      account_id: 5,
      client_id: 'companion',
      redirect_uri: 'https://app.example/cb',
      code_challenge: pkceChallengeFromVerifier('the-real-verifier'),
      code_challenge_method: 'S256',
      scope: 'character:read',
    });
    const r = await call('POST', '/oauth/token', {
      grant_type: 'authorization_code',
      code: 'thecode',
      code_verifier: 'wrong-verifier',
      client_id: 'companion',
      redirect_uri: 'https://app.example/cb',
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('invalid_grant');
    expect(db.saveToken).not.toHaveBeenCalled();
  });
});

describe('device-code grant', () => {
  const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

  it('reports authorization_pending until approved, then issues a token once', async () => {
    vi.mocked(oauthDb.getDeviceByDeviceCode).mockResolvedValueOnce({
      account_id: null,
      approved: false,
      scope: 'character:read',
      expired: false,
      consumed: false,
    });
    const pending = await call('POST', '/oauth/token', {
      grant_type: DEVICE_GRANT,
      device_code: 'dc',
      client_id: 'companion',
    });
    expect(pending.status).toBe(400);
    expect(pending.json.error).toBe('authorization_pending');

    vi.mocked(oauthDb.getDeviceByDeviceCode).mockResolvedValueOnce({
      account_id: 5,
      approved: true,
      scope: 'character:read',
      expired: false,
      consumed: false,
    });
    vi.mocked(oauthDb.consumeDeviceCode).mockResolvedValueOnce({
      account_id: 5,
      scope: 'character:read',
    });
    const ok = await call('POST', '/oauth/token', {
      grant_type: DEVICE_GRANT,
      device_code: 'dc',
      client_id: 'companion',
    });
    expect(ok.status).toBe(200);
    expect(ok.json.access_token).toMatch(/^[a-f0-9]{64}$/);
    expect(db.saveToken).toHaveBeenCalledWith(
      expect.any(String),
      5,
      expect.any(Number),
      'read',
      expect.any(String),
    );
  });

  it('rejects an expired device code', async () => {
    vi.mocked(oauthDb.getDeviceByDeviceCode).mockResolvedValueOnce({
      account_id: null,
      approved: false,
      scope: 'character:read',
      expired: true,
      consumed: false,
    });
    const r = await call('POST', '/oauth/token', {
      grant_type: DEVICE_GRANT,
      device_code: 'dc',
      client_id: 'companion',
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('expired_token');
  });

  it('starts a device authorization with a user code + poll interval', async () => {
    const r = await call('POST', '/oauth/device_authorization', { client_id: 'companion' });
    expect(r.status).toBe(200);
    expect(r.json.user_code).toMatch(
      /^[BCDFGHJKLMNPQRSTVWXZ23456789]{4}-[BCDFGHJKLMNPQRSTVWXZ23456789]{4}$/,
    );
    expect(r.json.device_code).toMatch(/^[a-f0-9]{64}$/);
    expect(r.json.interval).toBeGreaterThan(0);
    expect(oauthDb.createDeviceCode).toHaveBeenCalled();
  });

  it('stores the user code normalized so approval matches the lookup', async () => {
    // Regression: the displayed user_code is dashed (XXXX-XXXX) but it must be
    // stored normalized, because approveDevice normalizes the submitted code and
    // looks it up with an exact match. If they disagree, approval never works.
    const start = await call('POST', '/oauth/device_authorization', { client_id: 'companion' });
    const displayed = start.json.user_code as string;
    expect(displayed).toContain('-');

    const stored = vi.mocked(oauthDb.createDeviceCode).mock.calls[0][1].userCode as string;
    expect(stored).toBe(normalizeUserCode(displayed));
    expect(stored).not.toContain('-');

    // Approving with the dashed code the user sees must resolve to the stored value.
    vi.mocked(oauthDb.getDeviceByUserCode).mockResolvedValueOnce({
      device_code: 'dc',
      user_code: stored,
      client_id: 'companion',
      scope: 'character:read',
      account_id: null,
      approved: false,
      expired: false,
      consumed: false,
    });
    vi.mocked(oauthDb.approveDeviceCode).mockResolvedValueOnce(true);
    const approve = await call('POST', '/oauth/device', { user_code: displayed }, BEARER);
    expect(approve.status).toBe(200);
    expect(oauthDb.getDeviceByUserCode).toHaveBeenCalledWith(expect.anything(), stored);
    expect(oauthDb.approveDeviceCode).toHaveBeenCalledWith(expect.anything(), stored, 5);
  });
});

describe('authorize approval reuses the web session', () => {
  it('escapes the embedded request JSON so OAuth params cannot break out of the inline script', async () => {
    const payload = '</script><script>globalThis.__owned=1</script>';
    const r = await callRaw(
      'GET',
      `/oauth/authorize?client_id=companion&redirect_uri=${encodeURIComponent('https://app.example/cb')}&response_type=code&code_challenge=${encodeURIComponent(payload)}&code_challenge_method=S256&state=${encodeURIComponent(payload)}`,
      {},
    );
    expect(r.status).toBe(200);
    expect(r.body).not.toContain(payload);
    expect(r.body).toContain('\\u003c/script>');
  });

  it('creates a code and returns a redirect for a full session', async () => {
    const r = await call(
      'POST',
      '/oauth/authorize',
      {
        client_id: 'companion',
        redirect_uri: 'https://app.example/cb',
        code_challenge: 'abc',
        code_challenge_method: 'S256',
        state: 'xyz',
      },
      BEARER,
    );
    expect(r.status).toBe(200);
    expect(r.json.redirect).toContain('https://app.example/cb?');
    expect(r.json.redirect).toContain('state=xyz');
    expect(oauthDb.createAuthCode).toHaveBeenCalled();
  });

  it('refuses to authorize with a read-only token (no escalation)', async () => {
    vi.mocked(db.accountAndScopeForToken).mockResolvedValue({ accountId: 5, scope: 'read' });
    const r = await call(
      'POST',
      '/oauth/authorize',
      {
        client_id: 'companion',
        redirect_uri: 'https://app.example/cb',
        code_challenge: 'abc',
        code_challenge_method: 'S256',
      },
      BEARER,
    );
    expect(r.status).toBe(401);
    expect(oauthDb.createAuthCode).not.toHaveBeenCalled();
  });
});

describe('POST /oauth/revoke (RFC 7009)', () => {
  it('revokes the presented token and returns 200', async () => {
    const r = await call('POST', '/oauth/revoke', { token: 'a'.repeat(64) });
    expect(r.status).toBe(200);
    // It deletes only via the scope='read'-restricted revoke (never a full session).
    expect(db.revokeReadToken).toHaveBeenCalledWith('a'.repeat(64));
  });

  it('accepts a form-encoded body', async () => {
    const r = await call('POST', '/oauth/revoke', `token=${'b'.repeat(64)}`, {
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(r.status).toBe(200);
    expect(db.revokeReadToken).toHaveBeenCalledWith('b'.repeat(64));
  });

  it('still returns 200 for an unknown / already-revoked token', async () => {
    vi.mocked(db.revokeReadToken).mockResolvedValueOnce(false);
    const r = await call('POST', '/oauth/revoke', { token: 'deadbeef' });
    expect(r.status).toBe(200);
  });

  it('returns 200 with no token and does not call the DB', async () => {
    const r = await call('POST', '/oauth/revoke', {});
    expect(r.status).toBe(200);
    expect(db.revokeReadToken).not.toHaveBeenCalled();
  });
});
