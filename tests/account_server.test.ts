import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirror tests/wallet_server.test.ts: stub DATABASE_URL + mock the pg Pool so
// db.ts loads and every pool.query is a spy we route by SQL text. This drives
// the REAL account handlers through every branch with no live database.
const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  return { query: vi.fn() };
});
vi.mock('pg', () => ({
  // connect() hands back a client backed by the same routed query spy, so
  // transactional helpers (BEGIN/COMMIT around a pooled client) are exercised
  // through the same write log as the pool-level queries.
  Pool: vi.fn(function Pool() {
    return { query: dbMock.query, connect: async () => ({ query: dbMock.query, release() {} }) };
  }),
}));

import {
  type AccountGameHooks,
  handleAccountChangePassword,
  handleAccountDeactivate,
  handleAccountEmailChange,
  handleAccountEmailVerify,
  handleAccountExport,
  handleAccountLogout,
  handleAccountMarketing,
  handleAccountSetEmail,
  handleAccountSetInitialEmail,
  handleAccountWhoami,
  handleEmailUnsubscribe,
} from '../server/account';
import { hashPassword } from '../server/auth';
import { moderationStatusForAccount } from '../server/db';
import { makeEmailToken } from '../server/email';

// ── http fakes ──────────────────────────────────────────────────────────────
// `ip` lets a test drive the per-IP rate limiter from a fresh, untrusted address
// (127.0.0.1 is a trusted proxy and would be parsed through X-Forwarded-For).
function makeReq(body: unknown, ip = '203.0.113.7'): any {
  const req: any = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.headers = { host: 'localhost:8787' };
  req.socket = { remoteAddress: ip };
  return req;
}
function makeRes(): any {
  return {
    statusCode: 0,
    body: '',
    headers: {} as Record<string, string>,
    writeHead(status: number, headers?: Record<string, string>) {
      this.statusCode = status;
      if (headers) this.headers = headers;
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

// ── query router ────────────────────────────────────────────────────────────
// Each test sets `accountRow`, `characters`, and `charCount`; the spy returns
// the right rows by inspecting the SQL, and records the writes it sees.
let accountRow: any;
let characters: any[];
let charCount: number;
let writes: { sql: string; params: any[] }[];
// Pending email-change row the consume UPDATE returns (null = invalid/expired).
let pendingChange: any;
// Rows the atomic set-initial backfill UPDATE reports (1 = filled, 0 = race-loser).
let emailBackfillRows: number;

function routeQuery(sql: string, params: any[]) {
  writes.push({ sql, params });
  // The consume claim must be checked before the generic accounts/id read.
  if (sql.includes('UPDATE email_change_requests'))
    return { rows: pendingChange ? [pendingChange] : [] };
  if (sql.includes('SELECT id FROM accounts WHERE unsubscribe_token'))
    return { rows: accountRow ? [{ id: accountRow.id }] : [] };
  if (sql.includes('unsubscribe_token'))
    return { rows: [{ unsubscribe_token: params[1] ?? 'unsub-token' }] };
  if (sql.includes('FROM accounts WHERE id')) return { rows: accountRow ? [accountRow] : [] };
  if (sql.includes('COUNT(*)')) return { rows: [{ count: charCount }] };
  if (sql.includes('FROM characters WHERE account_id') || sql.includes('FROM characters c')) {
    return { rows: characters };
  }
  // The atomic recovery-email backfill (set-initial): rowCount drives filled vs.
  // race-loser. `emailBackfillRows` lets a test simulate the loser (0 rows).
  if (sql.includes("email IS NULL OR email = ''")) return { rows: [], rowCount: emailBackfillRows };
  return { rows: [] }; // UPDATE / DELETE / INSERT writes
}

const CORRECT_PW = 'correct-horse';
let pwHash = '';

beforeEach(async () => {
  pwHash = pwHash || (await hashPassword(CORRECT_PW));
  accountRow = {
    id: 1,
    username: 'Aelwyn',
    password_hash: pwHash,
    email: null,
    created_at: '2026-01-15T10:00:00.000Z',
    deactivated_at: null,
    locale: null,
    marketing_opt_in: false,
  };
  characters = [{ id: 10 }, { id: 11 }];
  charCount = 2;
  pendingChange = { account_id: 1, new_email: 'new@example.com' };
  emailBackfillRows = 1;
  writes = [];
  dbMock.query.mockReset();
  dbMock.query.mockImplementation((sql: string, params: any[]) => routeQuery(sql, params));
});

const noHooks: AccountGameHooks = { anyCharacterOnline: () => false, disconnectAccount: () => {} };

describe('handleAccountWhoami', () => {
  it('returns the account + account-wide character count', async () => {
    const res = makeRes();
    await handleAccountWhoami(res, 1);
    const { status, data } = parse(res);
    expect(status).toBe(200);
    expect(data).toMatchObject({ username: 'Aelwyn', email: '', characterCount: 2 });
  });
  it('reports emailMissing:true for an account with no recovery email', async () => {
    const res = makeRes();
    await handleAccountWhoami(res, 1);
    expect(parse(res).data.emailMissing).toBe(true);
  });
  it('reports emailMissing:false once a recovery email is set', async () => {
    accountRow.email = 'aelwyn@example.com';
    const res = makeRes();
    await handleAccountWhoami(res, 1);
    const { data } = parse(res);
    expect(data.email).toBe('aelwyn@example.com');
    expect(data.emailMissing).toBe(false);
  });
  it('404s when the row is gone', async () => {
    accountRow = null;
    const res = makeRes();
    await handleAccountWhoami(res, 1);
    expect(parse(res).status).toBe(404);
  });
});

describe('handleAccountSetInitialEmail (mandatory recovery-email backfill)', () => {
  it('sets the recovery email on an account that has none (200)', async () => {
    const res = makeRes();
    await handleAccountSetInitialEmail(makeReq({ email: '  New@Example.com ' }), res, 1);
    const { status, data } = parse(res);
    expect(status).toBe(200);
    // Stored trimmed (as typed), through the atomic empty-only backfill: unverified
    // (verified=false, so email_verified_at is not stamped), guarded in the WHERE.
    expect(data.email).toBe('New@Example.com');
    const write = writes.find((w) => w.sql.includes("email IS NULL OR email = ''"));
    expect(write).toBeTruthy();
    expect(write!.params).toEqual([1, 'New@Example.com', false]);
  });
  it('returns 409 when a concurrent writer set an address first (backfill loses the race)', async () => {
    // The read-side guard passed (acct.email empty) but the atomic UPDATE matched 0
    // rows because another request filled it first: surface it as already-set.
    emailBackfillRows = 0;
    const res = makeRes();
    await handleAccountSetInitialEmail(makeReq({ email: 'new@example.com' }), res, 1);
    expect(parse(res).status).toBe(409);
  });
  it('rejects a malformed address without writing (400)', async () => {
    const res = makeRes();
    await handleAccountSetInitialEmail(makeReq({ email: 'not-an-email' }), res, 1);
    expect(parse(res).status).toBe(400);
    expect(writes.some((w) => w.sql.includes('UPDATE accounts SET email'))).toBe(false);
  });
  it('refuses when an address already exists, steering to the verified change flow (409)', async () => {
    accountRow.email = 'existing@example.com';
    const res = makeRes();
    await handleAccountSetInitialEmail(makeReq({ email: 'new@example.com' }), res, 1);
    const { status, data } = parse(res);
    expect(status).toBe(409);
    expect(data.error).toContain('verified email change');
    expect(writes.some((w) => w.sql.includes('UPDATE accounts SET email'))).toBe(false);
  });
  it('404s when the account row is gone', async () => {
    accountRow = null;
    const res = makeRes();
    await handleAccountSetInitialEmail(makeReq({ email: 'new@example.com' }), res, 1);
    expect(parse(res).status).toBe(404);
  });
});

describe('handleAccountChangePassword', () => {
  it('rejects an incorrect current password (401)', async () => {
    const res = makeRes();
    await handleAccountChangePassword(
      makeReq({ current: 'wrong', next: 'brandnew1' }),
      res,
      1,
      'tokA',
    );
    expect(parse(res).status).toBe(401);
    expect(writes.some((w) => w.sql.includes('UPDATE accounts SET password_hash'))).toBe(false);
  });
  it('rejects a too-short new password (400)', async () => {
    const res = makeRes();
    await handleAccountChangePassword(
      makeReq({ current: CORRECT_PW, next: 'abc' }),
      res,
      1,
      'tokA',
    );
    expect(parse(res).status).toBe(400);
  });
  it('rejects a too-long new password (400)', async () => {
    const res = makeRes();
    await handleAccountChangePassword(
      makeReq({ current: CORRECT_PW, next: 'a'.repeat(129) }),
      res,
      1,
      'tokA',
    );
    const { status, data } = parse(res);
    expect(status).toBe(400);
    expect(data.error).toContain('at most');
  });
  it('changes the password and revokes only OTHER tokens (keeps the caller)', async () => {
    const res = makeRes();
    await handleAccountChangePassword(
      makeReq({ current: CORRECT_PW, next: 'brandnew1' }),
      res,
      1,
      'tokA',
    );
    expect(parse(res).status).toBe(200);
    expect(writes.some((w) => w.sql.includes('UPDATE accounts SET password_hash'))).toBe(true);
    const revoke = writes.find((w) => w.sql.includes('DELETE FROM auth_tokens'));
    expect(revoke).toBeTruthy();
    // The "<> $2" (keep caller) variant, with the caller token as a param.
    expect(revoke!.sql).toContain('token <>');
    expect(revoke!.params).toContain('tokA');
  });
});

describe('handleAccountLogout', () => {
  it('revokes only the caller token', async () => {
    const res = makeRes();
    await handleAccountLogout(res, 'tokA');
    expect(parse(res).status).toBe(200);
    const revoke = writes.find((w) => w.sql.includes('DELETE FROM auth_tokens WHERE token'));
    expect(revoke).toBeTruthy();
    expect(revoke!.params).toEqual(['tokA']);
  });
});

describe('handleAccountSetEmail', () => {
  it('rejects the legacy direct email setter without writing account email', async () => {
    const res = makeRes();
    await handleAccountSetEmail(makeReq({ email: '  Player@example.com  ' }), res, 1);
    const { status, data } = parse(res);
    expect(status).toBe(410);
    expect(data.error).toBe('use verified email change');
    expect(writes.some((w) => w.sql.includes('UPDATE accounts SET email'))).toBe(false);
  });
});

describe('handleAccountDeactivate', () => {
  it('requires the username to match (400)', async () => {
    const res = makeRes();
    await handleAccountDeactivate(
      makeReq({ username: 'Nope', password: CORRECT_PW }),
      res,
      1,
      noHooks,
    );
    expect(parse(res).status).toBe(400);
  });
  it('requires the correct password (401)', async () => {
    const res = makeRes();
    await handleAccountDeactivate(
      makeReq({ username: 'Aelwyn', password: 'wrong' }),
      res,
      1,
      noHooks,
    );
    expect(parse(res).status).toBe(401);
  });
  it('409s when a character is still online and does not lock', async () => {
    const hooks: AccountGameHooks = {
      anyCharacterOnline: (ids) => ids.includes(10),
      disconnectAccount: vi.fn(),
    };
    const res = makeRes();
    await handleAccountDeactivate(
      makeReq({ username: 'Aelwyn', password: CORRECT_PW }),
      res,
      1,
      hooks,
    );
    expect(parse(res).status).toBe(409);
    expect(writes.some((w) => w.sql.includes('SET deactivated_at'))).toBe(false);
    expect(hooks.disconnectAccount).not.toHaveBeenCalled();
  });
  it('locks the account, revokes ALL tokens, and tears down the socket', async () => {
    const disconnectAccount = vi.fn();
    const hooks: AccountGameHooks = { anyCharacterOnline: () => false, disconnectAccount };
    const res = makeRes();
    await handleAccountDeactivate(
      makeReq({ username: 'Aelwyn', password: CORRECT_PW }),
      res,
      1,
      hooks,
    );
    expect(parse(res).status).toBe(200);
    expect(writes.some((w) => w.sql.includes('SET deactivated_at'))).toBe(true);
    const revoke = writes.find((w) => w.sql.includes('DELETE FROM auth_tokens'));
    expect(revoke!.sql).not.toContain('token <>'); // revoke-all variant
    expect(disconnectAccount).toHaveBeenCalledWith(1, expect.any(String));
  });
});

// The deactivate + change-password handlers are bearer-auth but still per-IP
// rate-limited (default 20/min). Beyond the cap they 429 BEFORE touching the DB,
// so a flood can't be used to brute-force the password re-verify or hammer the
// account writes.
describe('account portal rate limiting (429)', () => {
  it('429s change-password past the per-IP cap, without writing', async () => {
    const ip = '198.51.100.21'; // fresh untrusted IP for this test's window
    let last = makeRes();
    for (let i = 0; i < 21; i++) {
      last = makeRes();
      await handleAccountChangePassword(
        makeReq({ current: CORRECT_PW, next: 'brandnew1' }, ip),
        last,
        1,
        'tokA',
      );
    }
    expect(parse(last).status).toBe(429);
    // The 21st call short-circuited before the password UPDATE for that request.
    expect(
      writes.filter((w) => w.sql.includes('UPDATE accounts SET password_hash')).length,
    ).toBeLessThanOrEqual(20);
  });

  it('429s deactivate past the per-IP cap, without locking', async () => {
    const ip = '198.51.100.22';
    let last = makeRes();
    for (let i = 0; i < 21; i++) {
      last = makeRes();
      await handleAccountDeactivate(
        makeReq({ username: 'Aelwyn', password: CORRECT_PW }, ip),
        last,
        1,
        noHooks,
      );
    }
    expect(parse(last).status).toBe(429);
  });
});

// recordAuthFailure marks the account on a failed portal re-verify; a SUCCESSFUL
// verify must call clearAuthFailures so the user's own subsequent login is not
// throttled by their earlier portal typos. We assert success returns 200 (the
// branch that now clears) and that a wrong password is rejected (the branch that
// records) — both from a fresh IP so the 429 cap above doesn't interfere.
describe('account portal auth-failure accounting', () => {
  it('change-password success path is reachable (clears failures)', async () => {
    const res = makeRes();
    await handleAccountChangePassword(
      makeReq({ current: CORRECT_PW, next: 'brandnew1' }, '198.51.100.31'),
      res,
      1,
      'tokA',
    );
    expect(parse(res).status).toBe(200);
  });
  it('deactivate records on wrong password (401)', async () => {
    const res = makeRes();
    await handleAccountDeactivate(
      makeReq({ username: 'Aelwyn', password: 'wrong' }, '198.51.100.32'),
      res,
      1,
      noHooks,
    );
    expect(parse(res).status).toBe(401);
  });
});

describe('handleAccountEmailChange', () => {
  it('rejects a wrong password without creating a request (401)', async () => {
    const res = makeRes();
    await handleAccountEmailChange(
      makeReq({ password: 'wrong', newEmail: 'new@example.com' }, '198.51.100.41'),
      res,
      1,
    );
    expect(parse(res).status).toBe(401);
    expect(writes.some((w) => w.sql.includes('INSERT INTO email_change_requests'))).toBe(false);
  });
  it('rejects a malformed new address (400)', async () => {
    const res = makeRes();
    await handleAccountEmailChange(
      makeReq({ password: CORRECT_PW, newEmail: 'nope' }, '198.51.100.41'),
      res,
      1,
    );
    expect(parse(res).status).toBe(400);
  });
  it('rejects changing to the address already on file (400)', async () => {
    accountRow.email = 'same@example.com';
    const res = makeRes();
    await handleAccountEmailChange(
      makeReq({ password: CORRECT_PW, newEmail: 'SAME@example.com' }, '198.51.100.41'),
      res,
      1,
    );
    expect(parse(res).status).toBe(400);
  });
  it('creates a single-use pending request and stores only a hash', async () => {
    const res = makeRes();
    await handleAccountEmailChange(
      makeReq({ password: CORRECT_PW, newEmail: 'new@example.com' }, '198.51.100.41'),
      res,
      1,
    );
    expect(parse(res).status).toBe(200);
    const ins = writes.find((w) => w.sql.includes('INSERT INTO email_change_requests'));
    expect(ins).toBeTruthy();
    // params: [accountId, newEmail, tokenHash, ttl]. The stored token is a hash.
    expect(ins!.params[1]).toBe('new@example.com');
    expect(ins!.params[2]).toMatch(/^[0-9a-f]{64}$/);
    // The address itself must NOT be applied to the account yet (verify-gated).
    expect(writes.some((w) => w.sql.includes('UPDATE accounts SET email'))).toBe(false);
    // Any prior pending request is invalidated first, so only the newest link works.
    expect(writes.some((w) => w.sql.includes('DELETE FROM email_change_requests'))).toBe(true);
  });
});

describe('handleAccountEmailVerify', () => {
  it('400s an empty or unknown token without applying a change', async () => {
    pendingChange = null; // consume finds nothing
    const res = makeRes();
    await handleAccountEmailVerify(res, makeEmailToken().token);
    expect(parse(res).status).toBe(400);
    expect(writes.some((w) => w.sql.includes('UPDATE accounts SET email'))).toBe(false);
  });
  it('applies the new address on a valid token', async () => {
    const res = makeRes();
    await handleAccountEmailVerify(res, makeEmailToken().token);
    const { status, data } = parse(res);
    expect(status).toBe(200);
    expect(data.email).toBe('new@example.com');
    const apply = writes.find((w) => w.sql.includes('UPDATE accounts SET email'));
    expect(apply!.sql).toContain('email_verified_at');
    expect(apply!.params).toEqual([1, 'new@example.com']);
  });
});

describe('handleAccountExport', () => {
  it('returns a JSON attachment bundling account + characters', async () => {
    const res = makeRes();
    await handleAccountExport(makeReq({}, '198.51.100.42'), res, 1);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    const bundle = JSON.parse(res.body);
    expect(bundle.account).toMatchObject({ id: 1, username: 'Aelwyn' });
    expect(Array.isArray(bundle.characters)).toBe(true);
  });
  it('404s when the account is gone', async () => {
    accountRow = null;
    const res = makeRes();
    await handleAccountExport(makeReq({}, '198.51.100.42'), res, 1);
    expect(res.statusCode).toBe(404);
  });
});

describe('handleAccountMarketing', () => {
  it('opts in and mints an unsubscribe token', async () => {
    const res = makeRes();
    await handleAccountMarketing(makeReq({ optIn: true }, '198.51.100.43'), res, 1);
    expect(parse(res).data).toEqual({ optIn: true });
    expect(
      writes.some(
        (w) => w.sql.includes('UPDATE accounts SET marketing_opt_in') && w.params[1] === true,
      ),
    ).toBe(true);
    expect(writes.some((w) => w.sql.includes('unsubscribe_token'))).toBe(true);
  });
  it('opts out (treats a non-true value as false) without minting a token', async () => {
    const res = makeRes();
    await handleAccountMarketing(makeReq({ optIn: 'yes' }, '198.51.100.43'), res, 1);
    expect(parse(res).data).toEqual({ optIn: false });
    expect(
      writes.some(
        (w) => w.sql.includes('UPDATE accounts SET marketing_opt_in') && w.params[1] === false,
      ),
    ).toBe(true);
    expect(writes.some((w) => w.sql.includes('unsubscribe_token'))).toBe(false);
  });
});

describe('handleEmailUnsubscribe', () => {
  it('clears marketing opt-in for a matching token', async () => {
    accountRow = { id: 5 };
    const res = makeRes();
    await handleEmailUnsubscribe(res, 'some-token');
    expect(parse(res).status).toBe(200);
    expect(
      writes.some(
        (w) => w.sql.includes('UPDATE accounts SET marketing_opt_in') && w.params[1] === false,
      ),
    ).toBe(true);
  });
  it('200s silently for an empty token without writing', async () => {
    const res = makeRes();
    await handleEmailUnsubscribe(res, '');
    expect(parse(res).status).toBe(200);
    expect(writes.some((w) => w.sql.includes('UPDATE accounts SET marketing_opt_in'))).toBe(false);
  });
});

// moderationStatusForAccount: the login + WS-auth gate. A self-deactivation
// locks the account, but an admin-imposed ban/suspension must OUTRANK it so the
// ban reason/label is not lost when an account is both banned and deactivated.
describe('moderationStatusForAccount precedence', () => {
  it('a self-deactivated account is locked (deactivated label)', async () => {
    accountRow = {
      banned_at: null,
      suspended_until: null,
      moderation_reason: null,
      chat_muted_until: null,
      chat_strikes: 0,
      deactivated_at: '2026-02-01T00:00:00.000Z',
    };
    const s = await moderationStatusForAccount(1);
    expect(s.locked).toBe(true);
    expect(s.banned).toBe(false);
    expect(s.deactivated).toBe(true);
    expect(s.message).toContain('deactivated');
  });
  it('a banned + deactivated account reports the ban, not the deactivation', async () => {
    accountRow = {
      banned_at: '2026-01-20T00:00:00.000Z',
      suspended_until: null,
      moderation_reason: 'cheating',
      chat_muted_until: null,
      chat_strikes: 0,
      deactivated_at: '2026-02-01T00:00:00.000Z',
    };
    const s = await moderationStatusForAccount(1);
    expect(s.locked).toBe(true);
    expect(s.banned).toBe(true);
    expect(s.deactivated).toBeFalsy();
    expect(s.reason).toBe('cheating');
    expect(s.message).toContain('banned');
  });
  it('an active suspension outranks a self-deactivation', async () => {
    accountRow = {
      banned_at: null,
      suspended_until: new Date(Date.now() + 3_600_000).toISOString(),
      moderation_reason: 'timeout',
      chat_muted_until: null,
      chat_strikes: 0,
      deactivated_at: '2026-02-01T00:00:00.000Z',
    };
    const s = await moderationStatusForAccount(1);
    expect(s.locked).toBe(true);
    expect(s.suspendedUntil).toBeTruthy();
    expect(s.deactivated).toBeFalsy();
    expect(s.message).toContain('suspended');
  });
});
