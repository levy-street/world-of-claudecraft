import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import { pool } from '../server/db';
import { REALM } from '../server/realm';
import {
  cleanReportReason, cleanText, createPlayerReport, forceCharacterRename, hashReportMetadata, moderateAccount,
  moderationQueue, moderationReportsForAccount,
  submitPlayerReportAttempt,
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

function connectClient(...results: any[]) {
  const client = clientStub();
  for (const result of results) {
    client.query.mockResolvedValueOnce(result);
  }
  connect.mockResolvedValue(client as any);
  return client;
}

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [] } as any);
  connect.mockReset();
});

describe('moderation report helpers', () => {
  it('accepts only known report reasons and trims bounded text', () => {
    expect(cleanReportReason('spam')).toBe('spam');
    expect(cleanReportReason('botting')).toBe('botting');
    expect(cleanReportReason('report_abuse')).toBeNull();
    expect(cleanReportReason('bad')).toBeNull();
    expect(cleanText('  hello  ', 5)).toBe('hello');
    expect(cleanText('abcdef', 3)).toBe('abc');
    expect(hashReportMetadata('203.0.113.9')).not.toContain('203.0.113.9');
  });

  it('logs self reports before rejecting them', async () => {
    const client = connectClient(
      { rows: [] }, // BEGIN
      { rows: [] }, // advisory lock
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ id: 123 }] },
      { rows: [] }, // COMMIT
    );

    const result = await submitPlayerReportAttempt({
      reporterAccountId: 1,
      reporterCharacterId: 10,
      reporterCharacterName: 'Alice',
      target: { accountId: 1, characterId: 11, characterName: 'Alt' },
      reason: 'spam',
      details: 'same account',
      metadata: { ip: '203.0.113.8', userAgent: 'UnitTest/1.0', targetMethod: 'name' },
    });

    expect(result).toEqual({ ok: false, status: 400, error: 'cannot report yourself', outcome: 'self_report' });
    expect(client.query.mock.calls[6][0]).toMatch(/INSERT INTO report_events/);
    expect(client.query.mock.calls[6][1]).toContain('self_report');
    expect(JSON.stringify(client.query.mock.calls[6][1])).not.toContain('203.0.113.8');
    expect(JSON.stringify(client.query.mock.calls[6][1])).not.toContain('UnitTest/1.0');
  });

  it('rejects duplicate open reports in the recent window', async () => {
    const client = connectClient(
      { rows: [] }, // BEGIN
      { rows: [] }, // advisory lock
      { rows: [{ id: 99 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ id: 124 }] },
      { rows: [] }, // COMMIT
    );
    query.mockResolvedValue({ rows: [{ attempts: 0, distinct_targets: 0, event_ids: [] }] } as any);

    await expect(createPlayerReport({
      reporterAccountId: 1,
      reporterCharacterId: 10,
      reporterCharacterName: 'Alice',
      target: { accountId: 2, characterId: 20, characterName: 'Bob' },
      reason: 'harassment',
      details: 'duplicate',
    })).rejects.toThrow(/already reported/);
    expect(client.query.mock.calls[6][0]).toMatch(/INSERT INTO report_events/);
    expect(client.query.mock.calls[6][1]).toContain('duplicate');
  });

  it('creates an accepted report and immutable submission event with hashed metadata', async () => {
    const client = connectClient(
      { rows: [] }, // BEGIN
      { rows: [] }, // advisory lock
      { rows: [] }, // duplicate
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ id: 77 }] },
      { rows: [{ id: 88 }] },
      { rows: [] }, // COMMIT
    );
    query
      .mockResolvedValueOnce({ rows: [{ attempts: 1, distinct_targets: 1, event_ids: [88] }] } as any)
      .mockResolvedValueOnce({ rows: [{ attempts: 0, event_ids: [] }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const result = await submitPlayerReportAttempt({
      reporterAccountId: 1,
      reporterCharacterId: 10,
      reporterCharacterName: 'Alice',
      target: { accountId: 2, characterId: 20, characterName: 'Bob' },
      reason: 'botting',
      details: '  repeated pathing loop  ',
      metadata: { ip: '203.0.113.7', userAgent: 'UnitTest/2.0', targetMethod: 'pid' },
    });

    expect(result).toEqual({ ok: true, reportId: 77 });
    expect(client.query.mock.calls[7][0]).toMatch(/INSERT INTO player_reports/);
    expect(client.query.mock.calls[8][0]).toMatch(/INSERT INTO report_events/);
    const eventParams = JSON.stringify(client.query.mock.calls[8][1]);
    expect(eventParams).toContain('accepted');
    expect(eventParams).toContain('botting');
    expect(eventParams).not.toContain('203.0.113.7');
    expect(eventParams).not.toContain('UnitTest/2.0');
  });

  it('creates a deduped system report-abuse case when one reporter crosses spam thresholds', async () => {
    connectClient(
      { rows: [] }, // BEGIN
      { rows: [] }, // advisory lock
      { rows: [] }, // duplicate
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ id: 201 }] },
      { rows: [{ id: 301 }] },
      { rows: [] }, // COMMIT
    );
    query
      .mockResolvedValueOnce({ rows: [{ attempts: 6, distinct_targets: 3, event_ids: [301, 300, 299] }] } as any)
      .mockResolvedValueOnce({ rows: [{ attempts: 0, event_ids: [] }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // update trigger event
      .mockResolvedValueOnce({ rows: [] } as any); // system report insert

    const result = await submitPlayerReportAttempt({
      reporterAccountId: 9,
      reporterCharacterId: 90,
      reporterCharacterName: 'Reporter',
      target: { accountId: 20, characterId: 200, characterName: 'Target' },
      reason: 'spam',
      details: 'bad',
      metadata: { ip: '203.0.113.9', userAgent: 'UnitTest/3.0', targetMethod: 'pid' },
    });

    expect(result).toEqual({ ok: true, reportId: 201 });
    const systemInsert = query.mock.calls.find((call) => String(call[0]).includes("'report_abuse'"));
    expect(systemInsert?.[0]).toMatch(/INSERT INTO player_reports/);
    expect(systemInsert?.[1]).toEqual(expect.arrayContaining([9, null, '']));
    expect(JSON.stringify(systemInsert?.[1])).toContain('reporter_spam');
    const systemParams = systemInsert?.[1] as unknown[] | undefined;
    expect(String(systemParams?.[systemParams.length - 1])).toContain(`report_abuse:${REALM}:9:`);
    expect(JSON.stringify(systemInsert?.[1])).not.toContain('203.0.113.9');
  });

  it('does not fail an accepted report when post-commit abuse detection fails', async () => {
    connectClient(
      { rows: [] }, // BEGIN
      { rows: [] }, // advisory lock
      { rows: [] }, // duplicate
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ id: 901 }] },
      { rows: [{ id: 902 }] },
      { rows: [] }, // COMMIT
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    query.mockRejectedValueOnce(new Error('detector down'));

    const result = await submitPlayerReportAttempt({
      reporterAccountId: 21,
      reporterCharacterId: 210,
      reporterCharacterName: 'Reporter',
      target: { accountId: 22, characterId: 220, characterName: 'Target' },
      reason: 'spam',
      details: 'accepted',
      metadata: { ip: '203.0.113.21', userAgent: 'UnitTest/8.0', targetMethod: 'pid' },
    });

    expect(result).toEqual({ ok: true, reportId: 901 });
    expect(errorSpy).toHaveBeenCalledWith('report abuse detection failed:', expect.any(Error));
    errorSpy.mockRestore();
  });

  it('logs invalid targets when the reporter identity is known', async () => {
    const client = connectClient(
      { rows: [] }, // BEGIN
      { rows: [] }, // advisory lock
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ id: 401 }] },
      { rows: [] }, // COMMIT
    );

    const result = await submitPlayerReportAttempt({
      reporterAccountId: 1,
      reporterCharacterId: 10,
      reporterCharacterName: 'Alice',
      target: null,
      reason: 'spam',
      details: 'missing target',
      invalidTargetError: 'that player is no longer online',
      invalidTargetStatus: 404,
      metadata: { ip: '203.0.113.10', userAgent: 'UnitTest/4.0', targetMethod: 'pid' },
    });

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'that player is no longer online',
      outcome: 'invalid_target',
    });
    expect(client.query.mock.calls[6][0]).toMatch(/INSERT INTO report_events/);
    expect(client.query.mock.calls[6][1]).toContain('invalid_target');
  });

  it('runs abuse detection for repeated invalid-target submissions', async () => {
    connectClient(
      { rows: [] }, // BEGIN
      { rows: [] }, // advisory lock
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ id: 801 }] },
      { rows: [] }, // COMMIT
    );
    query
      .mockResolvedValueOnce({ rows: [{ attempts: 1, distinct_targets: 0, event_ids: [801] }] } as any)
      .mockResolvedValueOnce({ rows: [{ attempts: 4, event_ids: [801, 800, 799, 798] }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const result = await submitPlayerReportAttempt({
      reporterAccountId: 7,
      reporterCharacterId: 70,
      reporterCharacterName: 'Reporter',
      target: null,
      reason: 'spam',
      details: 'missing target',
      invalidTargetError: 'that player could not be found',
      invalidTargetStatus: 404,
      metadata: { ip: '203.0.113.12', userAgent: 'UnitTest/7.0', targetMethod: 'name' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome).toBe('invalid_target');
    const systemInsert = query.mock.calls.find((call) => String(call[0]).includes("'report_abuse'"));
    expect(systemInsert?.[1]).toEqual(expect.arrayContaining([7, null, '']));
    expect(JSON.stringify(systemInsert?.[1])).toContain('repeated_rejected_reports');
  });

  it('uses persisted report events for report cooldowns and logs rate-limited attempts', async () => {
    const client = connectClient(
      { rows: [] }, // BEGIN
      { rows: [] }, // advisory lock
      { rows: [] }, // duplicate
      { rows: [{ count: 1 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ id: 501 }] },
      { rows: [] }, // COMMIT
    );
    query
      .mockResolvedValueOnce({ rows: [{ attempts: 1, distinct_targets: 1, event_ids: [501] }] } as any)
      .mockResolvedValueOnce({ rows: [{ attempts: 1, event_ids: [501] }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const result = await submitPlayerReportAttempt({
      reporterAccountId: 1,
      reporterCharacterId: 10,
      reporterCharacterName: 'Alice',
      target: { accountId: 2, characterId: 20, characterName: 'Bob' },
      reason: 'spam',
      details: 'too soon',
      metadata: { ip: '203.0.113.11', userAgent: 'UnitTest/5.0', targetMethod: 'name' },
    });

    expect(result).toEqual({
      ok: false,
      status: 429,
      error: 'you are submitting reports too quickly',
      outcome: 'rate_limited',
    });
    expect(client.query.mock.calls[3][0]).toMatch(/FROM report_events/);
    expect(client.query.mock.calls[7][0]).toMatch(/INSERT INTO report_events/);
    expect(client.query.mock.calls[7][1]).toContain('rate_limited');
    expect(client.query.mock.calls.some((call) => String(call[0]).includes('INSERT INTO player_reports'))).toBe(false);
  });

  it('creates report-abuse cases for linked same-target reporters but not the original target', async () => {
    const sharedIp = hashReportMetadata('198.51.100.1');
    const sharedDetails = hashReportMetadata('same details');
    connectClient(
      { rows: [] }, // BEGIN
      { rows: [] }, // advisory lock
      { rows: [] }, // duplicate
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ count: 0 }] },
      { rows: [{ id: 601 }] },
      { rows: [{ id: 701 }] },
      { rows: [] }, // COMMIT
    );
    query
      .mockResolvedValueOnce({ rows: [{ attempts: 1, distinct_targets: 1, event_ids: [701] }] } as any)
      .mockResolvedValueOnce({ rows: [{ attempts: 0, event_ids: [] }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [
        {
          id: 701, reporter_account_id: 11, reporter_character_id: 110, reporter_character_name: 'One',
          target_account_id: 50, target_character_name: 'Target', ip_hash: sharedIp, details_hash: sharedDetails, outcome: 'accepted',
        },
        {
          id: 700, reporter_account_id: 12, reporter_character_id: 120, reporter_character_name: 'Two',
          target_account_id: 50, target_character_name: 'Target', ip_hash: sharedIp, details_hash: sharedDetails, outcome: 'accepted',
        },
        {
          id: 699, reporter_account_id: 13, reporter_character_id: 130, reporter_character_name: 'Three',
          target_account_id: 50, target_character_name: 'Target', ip_hash: sharedIp, details_hash: sharedDetails, outcome: 'accepted',
        },
        {
          id: 698, reporter_account_id: 14, reporter_character_id: 140, reporter_character_name: 'Other',
          target_account_id: 50, target_character_name: 'Target', ip_hash: hashReportMetadata('198.51.100.14'), details_hash: 'different', outcome: 'accepted',
        },
      ] } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // linked reporter 11 system report
      .mockResolvedValueOnce({ rows: [] } as any) // linked reporter 12 system report
      .mockResolvedValueOnce({ rows: [] } as any) // linked reporter 13 system report
      .mockResolvedValueOnce({ rows: [] } as any); // update trigger event

    const result = await submitPlayerReportAttempt({
      reporterAccountId: 11,
      reporterCharacterId: 110,
      reporterCharacterName: 'One',
      target: { accountId: 50, characterId: 500, characterName: 'Target' },
      reason: 'harassment',
      details: 'same details',
      metadata: { ip: '198.51.100.1', userAgent: 'UnitTest/6.0', targetMethod: 'pid' },
    });

    expect(result).toEqual({ ok: true, reportId: 601 });
    const systemInserts = query.mock.calls.filter((call) => String(call[0]).includes("'report_abuse'"));
    expect(systemInserts).toHaveLength(3);
    expect(systemInserts.map((call) => (call[1] as unknown[])[0])).toEqual([11, 12, 13]);
    expect(systemInserts.map((call) => (call[1] as unknown[])[0])).not.toContain(50);
    expect(JSON.stringify(systemInserts.map((call) => call[1]))).toContain('shared_ip_coordination');
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
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [
        { id: 2, character_name: 'Bob', channel: 'say', message: 'second', created_at: '2026-06-12T23:59:00Z' },
        { id: 1, character_name: 'Bob', channel: 'say', message: 'first', created_at: '2026-06-12T23:58:00Z' },
      ] } as any);

    const reports = await moderationReportsForAccount(2);

    expect(reports).toHaveLength(1);
    expect(query.mock.calls[2][1]).toEqual([20, '2026-06-13T00:00:00Z']);
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
