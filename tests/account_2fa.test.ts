import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

// Same mock-pg harness as tests/account_server.test.ts: route every pool/client
// query by SQL text, so the REAL 2FA handlers + login verifier run with no DB.
const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  return { query: vi.fn() };
});
vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: dbMock.query, connect: async () => ({ query: dbMock.query, release() {} }) };
  }),
}));

import {
  handleAccount2faSetup,
  handleAccount2faEnable,
  handleAccount2faDisable,
  handleAccountWhoami,
  verifyLoginTwoFactor,
} from '../server/account';
import { hashPassword } from '../server/auth';
import { generateSecret, generateTotp, totpCounter, generateRecoveryCodes, hashRecoveryCode } from '../server/totp';

function makeReq(body: unknown, ip = '203.0.113.9'): any {
  const req: any = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.headers = { host: 'localhost:8787' };
  req.socket = { remoteAddress: ip };
  return req;
}
function makeRes(): any {
  return {
    statusCode: 0, body: '', headers: {} as Record<string, string>,
    writeHead(s: number, h?: Record<string, string>) { this.statusCode = s; if (h) this.headers = h; return this; },
    end(d: string) { this.body = d ?? ''; return this; },
  };
}
const parse = (res: any) => ({ status: res.statusCode, data: res.body ? JSON.parse(res.body) : {} });

const CORRECT_PW = 'correct-horse';
let pwHash = '';
let accountRow: any;       // shape returned by accountById
let totpRow: any;          // shape returned by getTotpState
let twoFactorEnabled: boolean;
let recoveryConsumeOk: boolean;
let totpClaimOk: boolean;
let writes: { sql: string; params: any[] }[];

function routeQuery(sql: string, params: any[]) {
  writes.push({ sql, params });
  if (sql.includes('totp_pending_secret') && sql.startsWith('\n    SELECT')) return { rows: totpRow ? [totpRow] : [] };
  if (sql.includes('SELECT totp_secret, totp_pending_secret')) return { rows: totpRow ? [totpRow] : [] };
  if (sql.includes('SELECT totp_enabled_at FROM accounts')) return { rows: [{ totp_enabled_at: twoFactorEnabled ? 'now' : null }] };
  if (sql.includes('UPDATE account_totp_recovery SET consumed_at')) return { rows: recoveryConsumeOk ? [{ id: 1 }] : [], rowCount: recoveryConsumeOk ? 1 : 0 };
  if (sql.includes('UPDATE accounts SET totp_last_window')) return { rows: totpClaimOk ? [{ id: 1 }] : [], rowCount: totpClaimOk ? 1 : 0 };
  if (sql.includes('SELECT COUNT(*)') && sql.includes('account_totp_recovery')) return { rows: [{ count: 5 }] };
  if (sql.includes('SELECT id, username, password_hash, email')) return { rows: accountRow ? [accountRow] : [] };
  if (sql.includes('FROM accounts WHERE id')) return { rows: accountRow ? [accountRow] : [] };
  if (sql.includes('COUNT(*)')) return { rows: [{ count: 0 }] };
  return { rows: [], rowCount: 0 };
}

beforeEach(async () => {
  pwHash = pwHash || (await hashPassword(CORRECT_PW));
  accountRow = { id: 1, username: 'Aelwyn', password_hash: pwHash, email: 'a@example.com', created_at: '2026-01-15T10:00:00.000Z', deactivated_at: null, locale: null, marketing_opt_in: false };
  totpRow = { totp_secret: null, totp_pending_secret: null, totp_enabled_at: null, totp_last_window: null };
  twoFactorEnabled = false;
  recoveryConsumeOk = true;
  totpClaimOk = true;
  writes = [];
  dbMock.query.mockReset();
  dbMock.query.mockImplementation((sql: string, params: any[]) => routeQuery(sql, params));
});

describe('handleAccount2faSetup', () => {
  it('rejects a wrong password (401), stores nothing', async () => {
    const res = makeRes();
    await handleAccount2faSetup(makeReq({ password: 'nope' }), res, 1);
    expect(parse(res).status).toBe(401);
    expect(writes.some((w) => w.sql.includes('SET totp_pending_secret'))).toBe(false);
  });
  it('mints a pending secret + otpauth URI on correct password', async () => {
    const res = makeRes();
    await handleAccount2faSetup(makeReq({ password: CORRECT_PW }), res, 1);
    const { status, data } = parse(res);
    expect(status).toBe(200);
    expect(data.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(data.otpauthUri).toContain('otpauth://totp/');
    expect(writes.some((w) => w.sql.includes('SET totp_pending_secret'))).toBe(true);
  });
  it('409s when 2FA is already enabled', async () => {
    totpRow.enabledAt = 'now';
    totpRow.totp_enabled_at = 'now';
    const res = makeRes();
    await handleAccount2faSetup(makeReq({ password: CORRECT_PW }), res, 1);
    expect(parse(res).status).toBe(409);
  });
});

describe('handleAccount2faEnable', () => {
  it('400s when setup was never run (no pending secret)', async () => {
    const res = makeRes();
    await handleAccount2faEnable(makeReq({ code: '000000' }), res, 1);
    expect(parse(res).status).toBe(400);
  });
  it('400s on a wrong code', async () => {
    totpRow.totp_pending_secret = generateSecret();
    const res = makeRes();
    await handleAccount2faEnable(makeReq({ code: '000000' }), res, 1, 0);
    expect(parse(res).status).toBe(400);
    expect(writes.some((w) => w.sql.includes('SET totp_secret'))).toBe(false);
  });
  it('enables 2FA + returns one-time recovery codes on a valid code', async () => {
    const secret = generateSecret();
    totpRow.totp_pending_secret = secret;
    const now = 1_700_000_000_000;
    const code = generateTotp(secret, now);
    const res = makeRes();
    await handleAccount2faEnable(makeReq({ code }), res, 1, now);
    const { status, data } = parse(res);
    expect(status).toBe(200);
    expect(Array.isArray(data.recoveryCodes)).toBe(true);
    expect(data.recoveryCodes).toHaveLength(10);
    expect(writes.some((w) => w.sql.includes('SET totp_secret'))).toBe(true);
    expect(writes.some((w) => w.sql.includes('INSERT INTO account_totp_recovery'))).toBe(true);
  });
});

describe('handleAccount2faDisable', () => {
  it('rejects a wrong password (401)', async () => {
    twoFactorEnabled = true;
    totpRow.totp_enabled_at = 'now';
    const res = makeRes();
    await handleAccount2faDisable(makeReq({ password: 'nope' }), res, 1);
    expect(parse(res).status).toBe(401);
  });
  it('400s when 2FA is not enabled', async () => {
    const res = makeRes();
    await handleAccount2faDisable(makeReq({ password: CORRECT_PW }), res, 1);
    expect(parse(res).status).toBe(400);
  });
  it('clears the secret on correct password', async () => {
    totpRow.totp_enabled_at = 'now';
    const res = makeRes();
    await handleAccount2faDisable(makeReq({ password: CORRECT_PW }), res, 1);
    expect(parse(res).status).toBe(200);
    expect(writes.some((w) => w.sql.includes('SET totp_secret = NULL'))).toBe(true);
  });
});

describe('handleAccountWhoami includes 2FA status', () => {
  it('reports twoFactorEnabled', async () => {
    twoFactorEnabled = true;
    const res = makeRes();
    await handleAccountWhoami(res, 1);
    expect(parse(res).data.twoFactorEnabled).toBe(true);
  });
});

describe('verifyLoginTwoFactor', () => {
  const secret = generateSecret();
  const now = 1_700_000_100_000;
  it('accepts a valid TOTP code and advances the replay window', async () => {
    const acct: any = { id: 1, username: 'Aelwyn', password_hash: pwHash, totp_secret: secret, totp_enabled_at: 'now', totp_last_window: null };
    const ok = await verifyLoginTwoFactor(acct, generateTotp(secret, now), '', now);
    expect(ok).toBe(true);
    const upd = writes.find((w) => w.sql.includes('SET totp_last_window'));
    expect(upd!.params[1]).toBe(totpCounter(now));
  });
  it('rejects a code already spent in this window (replay)', async () => {
    const acct: any = { id: 1, totp_secret: secret, totp_enabled_at: 'now', totp_last_window: totpCounter(now) };
    const ok = await verifyLoginTwoFactor(acct, generateTotp(secret, now), '', now);
    expect(ok).toBe(false);
  });
  it('rejects a wrong code', async () => {
    const acct: any = { id: 1, totp_secret: secret, totp_enabled_at: 'now', totp_last_window: null };
    expect(await verifyLoginTwoFactor(acct, '000000', '', now)).toBe(false);
  });
  it('rejects a valid code when the atomic window claim is lost (concurrent login)', async () => {
    totpClaimOk = false; // a concurrent login already claimed this window
    const acct: any = { id: 1, totp_secret: secret, totp_enabled_at: 'now', totp_last_window: null };
    expect(await verifyLoginTwoFactor(acct, generateTotp(secret, now), '', now)).toBe(false);
  });
  it('accepts a recovery code by burning it', async () => {
    recoveryConsumeOk = true;
    const acct: any = { id: 1, totp_secret: secret, totp_enabled_at: 'now', totp_last_window: null };
    const ok = await verifyLoginTwoFactor(acct, '', 'abcd-1234', now);
    expect(ok).toBe(true);
    expect(writes.some((w) => w.sql.includes('UPDATE account_totp_recovery SET consumed_at'))).toBe(true);
  });
  it('rejects an already-used recovery code', async () => {
    recoveryConsumeOk = false;
    const acct: any = { id: 1, totp_secret: secret, totp_enabled_at: 'now', totp_last_window: null };
    expect(await verifyLoginTwoFactor(acct, '', 'abcd-1234', now)).toBe(false);
  });
  it('denies when neither a code nor a recovery code is given', async () => {
    const acct: any = { id: 1, totp_secret: secret, totp_enabled_at: 'now', totp_last_window: null };
    expect(await verifyLoginTwoFactor(acct, '', '', now)).toBe(false);
  });
  // Sanity: recovery hashing is stable so the burn targets the right row.
  it('hashes recovery codes deterministically', () => {
    expect(hashRecoveryCode('ABCD-1234')).toBe(hashRecoveryCode('abcd1234'));
    expect(generateRecoveryCodes(3)).toHaveLength(3);
  });
});
