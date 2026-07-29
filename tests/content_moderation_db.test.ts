// Content-moderation audit trail for the map editor (server/content_moderation_db.ts)
// plus its two write sites, PgMapsDb.adminUnpublish (maps_db.ts) and
// PgUserAssetsDb.adminSetStatus (user_assets_db.ts). Before this change, neither
// admin-triggered write recorded who did it or why; these tests pin that a
// content_moderation_actions row lands in the SAME transaction as the status
// UPDATE, mirroring addBlockedIp/removeBlockedIp (ip_block_db.ts) and
// moderateAccount (moderation_db.ts, see tests/moderation_db.test.ts for the
// same clientStub idiom this file reuses).

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanContentModerationReason,
  recordContentModerationAction,
} from '../server/content_moderation_db';
import { PgMapsDb } from '../server/maps_db';
import { PgUserAssetsDb } from '../server/user_assets_db';

type TestQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<QueryResult<Record<string, unknown>>>;

function queryResult<T extends QueryResultRow>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { command: '', rowCount, oid: 0, fields: [], rows };
}

// Same idiom as tests/moderation_db.test.ts: a pinned pooled-client stub whose
// query()/release() calls we can inspect, so BEGIN/…/COMMIT atomicity is
// actually observable rather than assumed.
function clientStub() {
  const cquery = vi.fn<TestQuery>().mockResolvedValue(queryResult([]));
  const release = vi.fn();
  return { query: cquery, release };
}

describe('recordContentModerationAction', () => {
  it('inserts every field in the documented column order', async () => {
    const db = { query: vi.fn<TestQuery>().mockResolvedValue(queryResult([])) };
    await recordContentModerationAction(db as never, {
      resourceKind: 'map',
      resourceId: 7,
      ownerAccountId: 3,
      adminAccountId: 9,
      action: 'unpublish',
      reason: 'reported for offensive content',
    });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toMatch(/INSERT INTO content_moderation_actions/);
    expect(db.query.mock.calls[0][1]).toEqual([
      'map',
      7,
      3,
      9,
      'unpublish',
      'reported for offensive content',
    ]);
  });

  it('accepts a null owner (the resource row was deleted before the audit write)', async () => {
    const db = { query: vi.fn<TestQuery>().mockResolvedValue(queryResult([])) };
    await recordContentModerationAction(db as never, {
      resourceKind: 'user_asset',
      resourceId: 1,
      ownerAccountId: null,
      adminAccountId: 9,
      action: 'block',
      reason: '',
    });
    expect(db.query.mock.calls[0][1]).toEqual(['user_asset', 1, null, 9, 'block', '']);
  });
});

describe('cleanContentModerationReason', () => {
  it('trims whitespace and bounds length, defaulting a non-string to empty', () => {
    expect(cleanContentModerationReason('  reported by three players  ')).toBe(
      'reported by three players',
    );
    expect(cleanContentModerationReason('a'.repeat(600)).length).toBe(500);
    expect(cleanContentModerationReason(undefined)).toBe('');
    expect(cleanContentModerationReason(42)).toBe('');
  });
});

describe('PgMapsDb.adminUnpublish', () => {
  it('unpublishes the map and writes a content_moderation_actions row in one transaction', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce(queryResult([])) // BEGIN
      .mockResolvedValueOnce(queryResult([{ account_id: 5 }], 1)) // UPDATE maps ... RETURNING
      .mockResolvedValueOnce(queryResult([])) // INSERT content_moderation_actions
      .mockResolvedValueOnce(queryResult([])); // COMMIT
    const pool = { connect: vi.fn().mockResolvedValue(client as unknown as PoolClient) };
    const db = new PgMapsDb(pool as never);

    const done = await db.adminUnpublish(42, {
      adminAccountId: 9,
      reason: 'offensive terrain art',
    });

    expect(done).toBe(true);
    expect(client.query.mock.calls[0][0]).toBe('BEGIN');
    expect(client.query.mock.calls[1][0]).toMatch(/UPDATE maps SET status = 'private'/);
    expect(client.query.mock.calls[1][1]).toEqual([42]);
    expect(client.query.mock.calls[2][0]).toMatch(/INSERT INTO content_moderation_actions/);
    expect(client.query.mock.calls[2][1]).toEqual([
      'map',
      42,
      5,
      9,
      'unpublish',
      'offensive terrain art',
    ]);
    expect(client.query.mock.calls[3][0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('writes no audit row and still commits when the map id does not exist', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce(queryResult([])) // BEGIN
      .mockResolvedValueOnce(queryResult([], 0)) // UPDATE matched nothing
      .mockResolvedValueOnce(queryResult([])); // COMMIT
    const pool = { connect: vi.fn().mockResolvedValue(client as unknown as PoolClient) };
    const db = new PgMapsDb(pool as never);

    const done = await db.adminUnpublish(999, { adminAccountId: 9, reason: 'n/a' });

    expect(done).toBe(false);
    expect(client.query).toHaveBeenCalledTimes(3);
    expect(
      client.query.mock.calls.some((c) => /content_moderation_actions/.test(String(c[0]))),
    ).toBe(false);
    expect(client.query.mock.calls[2][0]).toBe('COMMIT');
  });

  it('rolls back and releases the client when the UPDATE throws', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce(queryResult([])) // BEGIN
      .mockRejectedValueOnce(new Error('connection reset')) // UPDATE fails
      .mockResolvedValueOnce(queryResult([])); // ROLLBACK
    const pool = { connect: vi.fn().mockResolvedValue(client as unknown as PoolClient) };
    const db = new PgMapsDb(pool as never);

    await expect(db.adminUnpublish(1, { adminAccountId: 9, reason: 'x' })).rejects.toThrow(
      'connection reset',
    );
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('PgUserAssetsDb.adminSetStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks the asset and writes an audit row with action "block"', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce(queryResult([])) // BEGIN
      .mockResolvedValueOnce(queryResult([{ account_id: 11 }], 1)) // UPDATE ... RETURNING
      .mockResolvedValueOnce(queryResult([])) // INSERT content_moderation_actions
      .mockResolvedValueOnce(queryResult([])); // COMMIT
    const pool = { connect: vi.fn().mockResolvedValue(client as unknown as PoolClient) };
    const db = new PgUserAssetsDb(pool as never);

    const done = await db.adminSetStatus(3, 'blocked', {
      adminAccountId: 9,
      reason: 'malware glb',
    });

    expect(done).toBe(true);
    expect(client.query.mock.calls[1][0]).toMatch(/UPDATE user_assets SET status = \$2/);
    expect(client.query.mock.calls[1][1]).toEqual([3, 'blocked']);
    expect(client.query.mock.calls[2][0]).toMatch(/INSERT INTO content_moderation_actions/);
    expect(client.query.mock.calls[2][1]).toEqual(['user_asset', 3, 11, 9, 'block', 'malware glb']);
    expect(client.query.mock.calls[3][0]).toBe('COMMIT');
  });

  it('unblocks the asset and writes an audit row with action "unblock"', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce(queryResult([])) // BEGIN
      .mockResolvedValueOnce(queryResult([{ account_id: 11 }], 1)) // UPDATE ... RETURNING
      .mockResolvedValueOnce(queryResult([])) // INSERT content_moderation_actions
      .mockResolvedValueOnce(queryResult([])); // COMMIT
    const pool = { connect: vi.fn().mockResolvedValue(client as unknown as PoolClient) };
    const db = new PgUserAssetsDb(pool as never);

    await db.adminSetStatus(3, 'active', { adminAccountId: 9, reason: 'appeal accepted' });

    expect(client.query.mock.calls[2][1]).toEqual([
      'user_asset',
      3,
      11,
      9,
      'unblock',
      'appeal accepted',
    ]);
  });

  it('writes no audit row when the asset id does not exist', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce(queryResult([])) // BEGIN
      .mockResolvedValueOnce(queryResult([], 0)) // UPDATE matched nothing
      .mockResolvedValueOnce(queryResult([])); // COMMIT
    const pool = { connect: vi.fn().mockResolvedValue(client as unknown as PoolClient) };
    const db = new PgUserAssetsDb(pool as never);

    const done = await db.adminSetStatus(999, 'blocked', { adminAccountId: 9, reason: 'n/a' });

    expect(done).toBe(false);
    expect(
      client.query.mock.calls.some((c) => /content_moderation_actions/.test(String(c[0]))),
    ).toBe(false);
  });
});
