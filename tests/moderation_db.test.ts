import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import { pool } from '../server/db';
import {
  cleanReportReason, cleanText, createPlayerReport, forceCharacterRename, moderateAccount,
  moderationQueue, moderationReportsForAccount,
} from '../server/moderation_db';

const query = vi.mocked(pool.query);
const connect = vi.mocked(pool.connect);

// A pooled-client stub whose query()/release() calls we can inspect. Pinning a
// single client for the whole transaction is what makes BEGIN/…/COMMIT atomic,
// so the tests assert every transactional statement runs through this stub.
function clientStub() {
  const cquery = vi.fn().mockResolvedValue({ rows: [] } as any);
  const release = vi.fn();
  return { query: cquery, release };
}

beforeEach(() => {
  query.mockReset();
  connect.mockReset();
});

describe('moderation report helpers', () => {
  it('accepts only known report reasons and trims bounded text', () => {
    expect(cleanReportReason('spam')).toBe('spam');
    expect(cleanReportReason('bad')).toBeNull();
    expect(cleanText('  hello  ', 5)).toBe('hello');
    expect(cleanText('abcdef', 3)).toBe('abc');
  });

  it('rejects self reports before writing', async () => {
    await expect(createPlayerReport({
      reporterAccountId: 1,
      reporterCharacterId: 10,
      reporterCharacterName: 'Alice',
      target: { accountId: 1, characterId: 11, characterName: 'Alt' },
      reason: 'spam',
      details: 'same account',
    })).rejects.toThrow(/yourself/);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects duplicate open reports in the recent window', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 99 }] } as any);

    await expect(createPlayerReport({
      reporterAccountId: 1,
      reporterCharacterId: 10,
      reporterCharacterName: 'Alice',
      target: { accountId: 2, characterId: 20, characterName: 'Bob' },
      reason: 'harassment',
      details: 'duplicate',
    })).rejects.toThrow(/already reported/);
  });

  it('sorts moderation queue by open report count, recency, then online status', async () => {
    query.mockResolvedValueOnce({ rows: [
      {
        account_id: 2, username: 'offline-two', banned_at: null, suspended_until: null,
        open_reports: 2, latest_report_at: '2026-06-01T00:00:00Z', latest_reason: 'spam', character_names: ['B'],
      },
      {
        account_id: 3, username: 'online-two', banned_at: null, suspended_until: null,
        open_reports: 2, latest_report_at: '2026-05-01T00:00:00Z', latest_reason: 'spam', character_names: ['C'],
      },
      {
        account_id: 4, username: 'one', banned_at: null, suspended_until: null,
        open_reports: 1, latest_report_at: '2026-06-10T00:00:00Z', latest_reason: 'other', character_names: ['D'],
      },
    ] } as any);

    const rows = await moderationQueue(new Set([3]));

    expect(rows.map((r) => r.accountId)).toEqual([2, 3, 4]);
    expect(rows[1].online).toBe(true);
  });

  it('loads per-report chat context before each report timestamp', async () => {
    query
      .mockResolvedValueOnce({ rows: [{
        id: 7,
        reason: 'harassment',
        details: 'bad chat',
        status: 'open',
        created_at: '2026-06-13T00:00:00Z',
        reporter_account_id: 1,
        reporter_username: 'alice',
        reporter_character_id: 10,
        reporter_character_name: 'Alice',
        reported_account_id: 2,
        reported_username: 'bob',
        reported_character_id: 20,
        reported_character_name: 'Bob',
      }] } as any)
      .mockResolvedValueOnce({ rows: [
        { id: 2, character_name: 'Bob', channel: 'say', message: 'second', created_at: '2026-06-12T23:59:00Z' },
        { id: 1, character_name: 'Bob', channel: 'say', message: 'first', created_at: '2026-06-12T23:58:00Z' },
      ] } as any);

    const reports = await moderationReportsForAccount(2);

    expect(reports).toHaveLength(1);
    expect(query.mock.calls[1][1]).toEqual([20, '2026-06-13T00:00:00Z']);
    expect(reports[0].chatContext.map((c) => c.message)).toEqual(['first', 'second']);
  });

  it('rejects suspension expiry values that are not in the future', async () => {
    await expect(moderateAccount({
      accountId: 2,
      adminAccountId: 1,
      action: 'suspend',
      reason: 'test',
      expiresAt: '2020-01-01T00:00:00Z',
    })).rejects.toThrow(/future/);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires a moderation reason for suspend and ban actions', async () => {
    await expect(moderateAccount({
      accountId: 2,
      adminAccountId: 1,
      action: 'ban',
      reason: '   ',
    })).rejects.toThrow(/reason/);
    expect(query).not.toHaveBeenCalled();
  });

  it('unbans accounts and writes an audit action in one transaction', async () => {
    const client = clientStub();
    connect.mockResolvedValue(client as any);

    await moderateAccount({
      accountId: 2,
      adminAccountId: 1,
      action: 'unban',
      reason: 'appeal accepted',
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][0]).toBe('BEGIN');
    expect(client.query.mock.calls[1][0]).toMatch(/SET banned_at = NULL, suspended_until = NULL/);
    expect(client.query.mock.calls[1][1]).toEqual([2, 'appeal accepted']);
    expect(client.query.mock.calls[2][0]).toMatch(/account_moderation_actions/);
    expect(client.query.mock.calls[2][1]).toEqual([2, 1, 'unban', 'appeal accepted', null]);
    expect(client.query.mock.calls[4][0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('clears the opposing lock flag so a ban and a suspension never both stand', async () => {
    // Banning must clear any standing suspension; suspending must clear any
    // standing ban. The latter matters because moderationStatusForAccount reads
    // banned_at before suspended_until, so a leftover ban would silently mask a
    // downgrade-to-suspension and keep the account locked out forever.
    const banClient = clientStub();
    connect.mockResolvedValueOnce(banClient as any);
    await moderateAccount({ accountId: 2, adminAccountId: 1, action: 'ban', reason: 'cheating' });
    const banUpdate = banClient.query.mock.calls.find((c) => /UPDATE accounts/.test(c[0]))![0];
    expect(banUpdate).toMatch(/banned_at = now\(\)/);
    expect(banUpdate).toMatch(/suspended_until = NULL/);

    const suspendClient = clientStub();
    connect.mockResolvedValueOnce(suspendClient as any);
    await moderateAccount({
      accountId: 2, adminAccountId: 1, action: 'suspend', reason: 'cooling off',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const suspendUpdate = suspendClient.query.mock.calls.find((c) => /UPDATE accounts/.test(c[0]))![0];
    expect(suspendUpdate).toMatch(/banned_at = NULL/);
    expect(suspendUpdate).toMatch(/suspended_until = \$2/);
  });

  it('marks a character for forced rename and action-resolves its reports', async () => {
    query.mockResolvedValueOnce({ rows: [{ account_id: 2 }] } as any);
    const client = clientStub();
    connect.mockResolvedValue(client as any);

    const result = await forceCharacterRename({ characterId: 20, adminAccountId: 1, reason: 'offensive name' });

    expect(result).toEqual({ accountId: 2 });
    // The whole transaction must run on one pinned client, not arbitrary pooled
    // connections, otherwise BEGIN/…/COMMIT are not actually atomic.
    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][0]).toBe('BEGIN');
    expect(client.query.mock.calls[1][0]).toMatch(/UPDATE characters SET force_rename = TRUE/);
    expect(client.query.mock.calls[2][0]).toMatch(/account_moderation_actions/);
    expect(client.query.mock.calls[3][0]).toMatch(/UPDATE player_reports/);
    expect(client.query.mock.calls[4][0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back on the pinned client and releases it when a statement fails', async () => {
    query.mockResolvedValueOnce({ rows: [{ account_id: 2 }] } as any);
    const client = clientStub();
    client.query
      .mockResolvedValueOnce({ rows: [] } as any) // BEGIN
      .mockRejectedValueOnce(new Error('db down')) // first UPDATE fails
      .mockResolvedValue({ rows: [] } as any); // ROLLBACK
    connect.mockResolvedValue(client as any);

    await expect(
      forceCharacterRename({ characterId: 20, adminAccountId: 1, reason: 'offensive name' }),
    ).rejects.toThrow(/db down/);

    const stmts = client.query.mock.calls.map((c) => c[0]);
    expect(stmts).toContain('ROLLBACK');
    expect(stmts).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
