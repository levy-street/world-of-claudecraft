import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same harness as tests/account_server.test.ts: stub DATABASE_URL + mock the pg
// Pool so db.ts loads and every query is a spy we route by SQL text, driving the
// REAL password-reset handlers through every branch with no live database.
const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  return { query: vi.fn() };
});
vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: dbMock.query, connect: async () => ({ query: dbMock.query, release() {} }) };
  }),
}));

// Spy ONLY on the post-reset "your password changed" security notice; every other
// mail helper account.ts imports stays real (importOriginal), so nothing else changes.
const emailMock = vi.hoisted(() => ({ passwordChanged: vi.fn() }));
vi.mock('../server/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/email')>()),
  emailPasswordChanged: emailMock.passwordChanged,
}));

import { handleAccountPasswordForgot, handleAccountPasswordReset } from '../server/account';

function makeReq(body: unknown, ip = '203.0.113.20'): any {
  const req: any = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.headers = { host: 'localhost:8787' };
  req.socket = { remoteAddress: ip };
  return req;
}
function makeRes(): any {
  return {
    statusCode: 0,
    body: '',
    writeHead(status: number) {
      this.statusCode = status;
      return this;
    },
    end(data: string) {
      this.body = data ?? '';
      return this;
    },
  };
}
const parse = (res: any) => ({
  status: res.statusCode,
  data: res.body ? JSON.parse(res.body) : {},
});

// Test-tunable state the query router reads.
let accountRow: any; // resolved by findAccount (WHERE username) and accountMailTarget (WHERE id)
let resetClaim: any; // row the consume UPDATE returns (null = invalid/expired token)
let writes: { sql: string; params: any[] }[];

function routeQuery(sql: string, params: any[]) {
  writes.push({ sql, params });
  if (sql.includes('UPDATE password_reset_requests'))
    return { rows: resetClaim ? [resetClaim] : [] };
  // findAccount + accountMailTarget both read the accounts table.
  if (sql.includes('FROM accounts WHERE username')) return { rows: accountRow ? [accountRow] : [] };
  if (sql.includes('FROM accounts WHERE id')) return { rows: accountRow ? [accountRow] : [] };
  return { rows: [] }; // BEGIN/COMMIT + INSERT/UPDATE/DELETE writes
}

const hasInsert = () => writes.some((w) => w.sql.includes('INSERT INTO password_reset_requests'));

// No-op live-session hook for tests that don't care about the post-reset
// disconnect (its own behavior is covered by the dedicated tests below).
const noHooks = { disconnectAccount: () => {} };

beforeEach(() => {
  accountRow = {
    id: 1,
    username: 'Aelwyn',
    password_hash: 'x',
    email: 'player@example.com',
    locale: null,
    marketing_opt_in: false,
  };
  resetClaim = { account_id: 1 };
  writes = [];
  emailMock.passwordChanged.mockClear();
  dbMock.query.mockReset();
  dbMock.query.mockImplementation((sql: string, params: any[]) => routeQuery(sql, params));
});

describe('handleAccountPasswordForgot (anti-enumeration)', () => {
  it('mints + would-mail a reset when the account exists and has an email (200 + insert)', async () => {
    const res = makeRes();
    await handleAccountPasswordForgot(makeReq({ username: 'Aelwyn' }, '203.0.113.21'), res);
    expect(parse(res)).toEqual({ status: 200, data: { ok: true } });
    expect(hasInsert()).toBe(true);
  });

  it('is a no-op (still 200, no insert) when the account has no email on file', async () => {
    accountRow.email = null;
    const res = makeRes();
    await handleAccountPasswordForgot(makeReq({ username: 'Aelwyn' }, '203.0.113.22'), res);
    expect(parse(res)).toEqual({ status: 200, data: { ok: true } });
    expect(hasInsert()).toBe(false);
  });

  it('is a no-op (still 200, no insert) when the username is unknown', async () => {
    accountRow = null;
    const res = makeRes();
    await handleAccountPasswordForgot(makeReq({ username: 'Nobody' }, '203.0.113.23'), res);
    expect(parse(res)).toEqual({ status: 200, data: { ok: true } });
    expect(hasInsert()).toBe(false);
  });

  it('returns the identical 200 body for a missing username (no leak)', async () => {
    const res = makeRes();
    await handleAccountPasswordForgot(makeReq({}, '203.0.113.24'), res);
    expect(parse(res)).toEqual({ status: 200, data: { ok: true } });
    expect(hasInsert()).toBe(false);
  });
});

describe('handleAccountPasswordReset', () => {
  it('applies a valid token: sets the new hash and revokes every session (200)', async () => {
    const res = makeRes();
    await handleAccountPasswordReset(
      makeReq({ token: 'a'.repeat(64), next: 'brandnew1' }, '203.0.113.25'),
      res,
      noHooks,
    );
    expect(parse(res).status).toBe(200);
    expect(writes.some((w) => w.sql.includes('UPDATE accounts SET password_hash'))).toBe(true);
    // Revoke ALL sessions (no "token <>" keep-caller clause), unlike change-password.
    const revoke = writes.find((w) => w.sql.includes('DELETE FROM auth_tokens'));
    expect(revoke).toBeTruthy();
    expect(revoke!.sql).not.toContain('token <>');
  });

  it('rejects an invalid or expired token with 400 and no password write', async () => {
    resetClaim = null; // claim UPDATE matches zero rows
    const res = makeRes();
    await handleAccountPasswordReset(
      makeReq({ token: 'b'.repeat(64), next: 'brandnew1' }, '203.0.113.26'),
      res,
      noHooks,
    );
    const { status, data } = parse(res);
    expect(status).toBe(400);
    expect(data.error).toBe('invalid or expired link');
    expect(writes.some((w) => w.sql.includes('UPDATE accounts SET password_hash'))).toBe(false);
  });

  it('rejects a missing token (400) before touching the database', async () => {
    const res = makeRes();
    await handleAccountPasswordReset(makeReq({ next: 'brandnew1' }, '203.0.113.27'), res, noHooks);
    expect(parse(res).status).toBe(400);
    expect(writes.some((w) => w.sql.includes('UPDATE password_reset_requests'))).toBe(false);
  });

  it('rejects a too-short new password (400)', async () => {
    const res = makeRes();
    await handleAccountPasswordReset(
      makeReq({ token: 'c'.repeat(64), next: 'abc' }, '203.0.113.28'),
      res,
      noHooks,
    );
    expect(parse(res).status).toBe(400);
  });

  it('rejects a too-long new password (400) before any password write', async () => {
    const res = makeRes();
    await handleAccountPasswordReset(
      makeReq({ token: 'd'.repeat(64), next: 'a'.repeat(1000) }, '203.0.113.29'),
      res,
      noHooks,
    );
    expect(parse(res).status).toBe(400);
    // The length gate runs before hashing/consume, so no account row is touched.
    expect(writes.some((w) => w.sql.includes('UPDATE accounts SET password_hash'))).toBe(false);
    expect(emailMock.passwordChanged).not.toHaveBeenCalled();
  });

  it('fires the "your password changed" security notice after a successful reset', async () => {
    const res = makeRes();
    await handleAccountPasswordReset(
      makeReq({ token: 'a'.repeat(64), next: 'brandnew1' }, '203.0.113.30'),
      res,
      noHooks,
    );
    expect(parse(res).status).toBe(200);
    expect(emailMock.passwordChanged).toHaveBeenCalledTimes(1);
  });

  // Token revocation alone does not close an already-open WS: this reset exists
  // specifically for a compromised account, so an attacker's already-joined
  // session must not survive it. A successful reset must force-disconnect any
  // live session for the account the claimed token resolved to.
  it('force-disconnects any live WS session for the account on a successful reset', async () => {
    resetClaim = { account_id: 42 };
    const disconnectAccount = vi.fn();
    const res = makeRes();
    await handleAccountPasswordReset(
      makeReq({ token: 'a'.repeat(64), next: 'brandnew1' }, '203.0.113.31'),
      res,
      { disconnectAccount },
    );
    expect(parse(res).status).toBe(200);
    expect(disconnectAccount).toHaveBeenCalledWith(42, expect.any(String));
  });

  it('does not disconnect anyone when the token is invalid or expired', async () => {
    resetClaim = null;
    const disconnectAccount = vi.fn();
    const res = makeRes();
    await handleAccountPasswordReset(
      makeReq({ token: 'e'.repeat(64), next: 'brandnew1' }, '203.0.113.32'),
      res,
      { disconnectAccount },
    );
    expect(parse(res).status).toBe(400);
    expect(disconnectAccount).not.toHaveBeenCalled();
  });
});
