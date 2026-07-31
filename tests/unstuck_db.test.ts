import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type InsertUnstuckReportInput,
  insertUnstuckReport,
  listUnstuckHotspots,
  listUnstuckReports,
  pruneUnstuckReports,
  UNSTUCK_HOTSPOT_BUCKET_YARDS,
  UNSTUCK_INSERT_QUERY_TIMEOUT_MS,
  UNSTUCK_REPORT_PRUNE_ADVISORY_KEY,
  UNSTUCK_REPORT_PRUNE_BATCH_SIZE,
  UNSTUCK_REPORT_PRUNE_MAX_BATCHES,
  UNSTUCK_REPORT_RETENTION_DAYS,
  UNSTUCK_SCHEMA,
} from '../server/unstuck_db';

const query = vi.fn();
const pruneQuery = vi.fn();
const release = vi.fn();
const connect = vi.fn();
const pool = { query, connect } as unknown as Pool;
const attemptId = '018f7c30-6ea8-7c9f-8123-456789abcdef';
const invokedAt = new Date('2026-07-14T00:00:00.000Z');
const resolvedAt = new Date('2026-07-14T00:00:02.000Z');

function reportInput(overrides: Partial<InsertUnstuckReportInput> = {}): InsertUnstuckReportInput {
  return {
    attemptId,
    realm: 'alpha',
    accountId: 7,
    characterId: 42,
    areaKind: 'dungeon',
    areaId: 'hollow_crypt',
    instanceId: 'hollow_crypt',
    instanceSlot: 3,
    originRawX: 101,
    originRawY: 12,
    originRawZ: -55,
    originLocalX: 21,
    originLocalY: 2,
    originLocalZ: 15,
    destinationRawX: 106,
    destinationRawY: 13,
    destinationRawZ: -50,
    destinationLocalX: 26,
    destinationLocalY: 3,
    destinationLocalZ: 20,
    outcome: 'completed',
    reason: 'nearest_safe_position',
    invokedAt,
    resolvedAt,
    ...overrides,
  };
}

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [], rowCount: 0 });
  pruneQuery.mockReset();
  release.mockReset();
  connect.mockReset();
  connect.mockResolvedValue({ query: pruneQuery, release });
});

describe('UNSTUCK_SCHEMA', () => {
  it('is additive, append-only telemetry with nullable identity FKs and explicit realm', () => {
    expect(UNSTUCK_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS unstuck_reports');
    expect(UNSTUCK_SCHEMA).toContain('attempt_id UUID NOT NULL UNIQUE');
    expect(UNSTUCK_SCHEMA).toMatch(/account_id INT REFERENCES accounts\(id\) ON DELETE SET NULL/);
    expect(UNSTUCK_SCHEMA).toMatch(
      /character_id INT REFERENCES characters\(id\) ON DELETE SET NULL/,
    );
    expect(UNSTUCK_SCHEMA).toMatch(/realm TEXT NOT NULL,/);
    expect(UNSTUCK_SCHEMA).not.toMatch(/realm TEXT NOT NULL DEFAULT/);
    expect(UNSTUCK_SCHEMA).toContain('invoked_at TIMESTAMPTZ NOT NULL');
    expect(UNSTUCK_SCHEMA).toContain('resolved_at TIMESTAMPTZ NOT NULL');
    expect(UNSTUCK_SCHEMA).toContain('unstuck_reports_destination_complete');
    expect(UNSTUCK_SCHEMA).toContain('unstuck_reports_outcome');
    expect(UNSTUCK_SCHEMA).toContain('unstuck_reports_outcome_destination');
    expect(UNSTUCK_SCHEMA).toMatch(/outcome = 'completed'[\s\S]*destination_raw_x IS NOT NULL/);
    expect(UNSTUCK_SCHEMA).toMatch(
      /outcome IN \('cancelled', 'failed'\)[\s\S]*destination_raw_x IS NULL/,
    );
    expect(UNSTUCK_SCHEMA).toContain('unstuck_reports_created');
    expect(UNSTUCK_SCHEMA.match(/CREATE INDEX IF NOT EXISTS/g)).toHaveLength(4);
    expect(UNSTUCK_SCHEMA).not.toMatch(/(?:^|;)\s*(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE)\b/i);
  });

  it('stores only IDs, codes, area context, and raw/local coordinates', () => {
    for (const column of [
      'area_kind',
      'area_id',
      'instance_id',
      'instance_slot',
      'origin_raw_x',
      'origin_raw_y',
      'origin_raw_z',
      'origin_local_x',
      'origin_local_y',
      'origin_local_z',
      'destination_raw_x',
      'destination_raw_y',
      'destination_raw_z',
      'destination_local_x',
      'destination_local_y',
      'destination_local_z',
      'outcome',
      'reason',
    ]) {
      expect(UNSTUCK_SCHEMA).toContain(column);
    }
    expect(UNSTUCK_SCHEMA).not.toMatch(
      /character_name|username|ip_address|user_agent|raw_command/i,
    );
  });
});

describe('insertUnstuckReport', () => {
  it('issues one fully parameterized insert with all terminal-attempt fields', async () => {
    await insertUnstuckReport(pool, reportInput());
    expect(query).toHaveBeenCalledTimes(1);
    const [config] = query.mock.calls[0];
    const sql = config.text;
    const params = config.values;
    expect(sql).toContain('INSERT INTO unstuck_reports');
    expect(sql).toContain('attempt_id, realm, account_id, character_id, area_kind, area_id');
    expect(sql).toContain('$24');
    expect(sql).not.toContain('$25');
    expect(sql).toContain('ON CONFLICT (attempt_id) DO NOTHING');
    expect(config.query_timeout).toBe(UNSTUCK_INSERT_QUERY_TIMEOUT_MS);
    expect(params).toEqual([
      attemptId,
      'alpha',
      7,
      42,
      'dungeon',
      'hollow_crypt',
      'hollow_crypt',
      3,
      101,
      12,
      -55,
      21,
      2,
      15,
      106,
      13,
      -50,
      26,
      3,
      20,
      'completed',
      'nearest_safe_position',
      invokedAt,
      resolvedAt,
    ]);
  });

  it('normalizes an absent destination to one complete set of SQL nulls', async () => {
    await insertUnstuckReport(
      pool,
      reportInput({
        destinationRawX: undefined,
        destinationRawY: undefined,
        destinationRawZ: undefined,
        destinationLocalX: undefined,
        destinationLocalY: undefined,
        destinationLocalZ: undefined,
        outcome: 'cancelled',
        reason: 'movement_detected',
      }),
    );
    const params = query.mock.calls[0][0].values;
    expect(params.slice(14, 20)).toEqual([null, null, null, null, null, null]);
  });

  it('rejects non-finite origin and destination coordinates before querying', async () => {
    await expect(
      insertUnstuckReport(pool, reportInput({ originRawX: Number.POSITIVE_INFINITY })),
    ).rejects.toThrow('originRawX must be a finite number');
    await expect(
      insertUnstuckReport(pool, reportInput({ destinationLocalZ: Number.NaN })),
    ).rejects.toThrow('destination coordinate 6 must be a finite number');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a partial destination, free-form codes, and reversed timestamps', async () => {
    await expect(
      insertUnstuckReport(pool, reportInput({ destinationLocalZ: null })),
    ).rejects.toThrow('destination coordinates must be all present or all absent');
    await expect(
      insertUnstuckReport(pool, reportInput({ reason: 'Player moved during cast' })),
    ).rejects.toThrow('reason must be a stable text code');
    await expect(insertUnstuckReport(pool, reportInput({ outcome: 'teleported' }))).rejects.toThrow(
      'outcome must be completed, cancelled, or failed',
    );
    await expect(
      insertUnstuckReport(pool, reportInput({ invokedAt: resolvedAt, resolvedAt: invokedAt })),
    ).rejects.toThrow('resolvedAt must not precede invokedAt');
    expect(query).not.toHaveBeenCalled();
  });

  it('enforces outcome and destination semantics before querying', async () => {
    await expect(
      insertUnstuckReport(
        pool,
        reportInput({
          destinationRawX: null,
          destinationRawY: null,
          destinationRawZ: null,
          destinationLocalX: null,
          destinationLocalY: null,
          destinationLocalZ: null,
        }),
      ),
    ).rejects.toThrow('completed reports require destination coordinates');
    await expect(
      insertUnstuckReport(pool, reportInput({ outcome: 'failed', reason: 'no_safe_position' })),
    ).rejects.toThrow('cancelled and failed reports must not include destination coordinates');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a malformed attempt id before querying', async () => {
    await expect(
      insertUnstuckReport(pool, reportInput({ attemptId: 'not-a-uuid' })),
    ).rejects.toThrow('attemptId must be a UUID');
    expect(query).not.toHaveBeenCalled();
  });
});

describe('pruneUnstuckReports', () => {
  it('holds one advisory lock while draining global batches through a partial final batch', async () => {
    pruneQuery
      .mockResolvedValueOnce({ rows: [{ acquired: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: UNSTUCK_REPORT_PRUNE_BATCH_SIZE })
      .mockResolvedValueOnce({ rows: [], rowCount: 17 })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }], rowCount: 1 });

    await expect(pruneUnstuckReports(pool)).resolves.toBe(UNSTUCK_REPORT_PRUNE_BATCH_SIZE + 17);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(pruneQuery.mock.calls[0]).toEqual([
      'SELECT pg_try_advisory_lock($1::int) AS acquired',
      [UNSTUCK_REPORT_PRUNE_ADVISORY_KEY],
    ]);
    const deleteCalls = pruneQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('DELETE FROM unstuck_reports'),
    );
    expect(deleteCalls).toHaveLength(2);
    const [sql, params] = deleteCalls[0];
    expect(UNSTUCK_REPORT_RETENTION_DAYS).toBe(90);
    expect(sql).toContain('FROM unstuck_reports');
    expect(sql).toContain("created_at < now() - ($1::int * INTERVAL '1 day')");
    expect(sql).toContain('ORDER BY created_at ASC, id ASC');
    expect(sql).not.toContain('WHERE resolved_at <');
    expect(sql).toContain('LIMIT $2');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('DELETE FROM unstuck_reports AS r');
    expect(sql).not.toMatch(/\brealm\b/);
    expect(params).toEqual([UNSTUCK_REPORT_RETENTION_DAYS, UNSTUCK_REPORT_PRUNE_BATCH_SIZE]);
    expect(pruneQuery.mock.calls.at(-1)).toEqual([
      'SELECT pg_advisory_unlock($1::int)',
      [UNSTUCK_REPORT_PRUNE_ADVISORY_KEY],
    ]);
    expect(release).toHaveBeenCalledWith(undefined);
    expect(UNSTUCK_SCHEMA).not.toMatch(/DELETE FROM unstuck_reports/i);
  });

  it('stops at the named operational batch cap even while every batch is full', async () => {
    pruneQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }], rowCount: 1 };
      if (sql.includes('pg_advisory_unlock'))
        return { rows: [{ pg_advisory_unlock: true }], rowCount: 1 };
      return { rows: [], rowCount: UNSTUCK_REPORT_PRUNE_BATCH_SIZE };
    });

    await expect(pruneUnstuckReports(pool)).resolves.toBe(
      UNSTUCK_REPORT_PRUNE_BATCH_SIZE * UNSTUCK_REPORT_PRUNE_MAX_BATCHES,
    );
    expect(
      pruneQuery.mock.calls.filter(([sql]) => String(sql).includes('DELETE FROM unstuck_reports')),
    ).toHaveLength(UNSTUCK_REPORT_PRUNE_MAX_BATCHES);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does no delete work when another process owns the advisory lock', async () => {
    pruneQuery.mockResolvedValueOnce({ rows: [{ acquired: false }], rowCount: 1 });

    await expect(pruneUnstuckReports(pool)).resolves.toBe(0);

    expect(pruneQuery).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(undefined);
  });
});

describe('listUnstuckReports', () => {
  it('uses a bounded realm/time keyset query and returns camelCase pagination', async () => {
    const firstResolved = new Date('2026-07-14T00:01:00.000Z');
    query.mockResolvedValueOnce({
      rows: [
        {
          id: '9',
          realm: 'alpha',
          account_id: 7,
          character_id: 42,
          character_name: 'Aldric',
          area_kind: 'dungeon',
          area_id: 'hollow_crypt',
          instance_id: 'hollow_crypt',
          instance_slot: 3,
          origin_raw_x: 101,
          origin_raw_y: 12,
          origin_raw_z: -55,
          origin_local_x: 21,
          origin_local_y: 2,
          origin_local_z: 15,
          destination_raw_x: 106,
          destination_raw_y: 13,
          destination_raw_z: -50,
          destination_local_x: 26,
          destination_local_y: 3,
          destination_local_z: 20,
          outcome: 'completed',
          reason: 'nearest_safe_position',
          invoked_at: invokedAt,
          resolved_at: firstResolved,
          created_at: '2026-07-14 00:01:01+00',
        },
        {
          id: '8',
          realm: 'alpha',
          account_id: null,
          character_id: null,
          character_name: null,
          area_kind: 'overworld',
          area_id: 'eastbrook_vale',
          instance_id: null,
          instance_slot: null,
          origin_raw_x: '5',
          origin_raw_y: '1',
          origin_raw_z: '10',
          origin_local_x: '5',
          origin_local_y: '1',
          origin_local_z: '10',
          destination_raw_x: null,
          destination_raw_y: null,
          destination_raw_z: null,
          destination_local_x: null,
          destination_local_y: null,
          destination_local_z: null,
          outcome: 'cancelled',
          reason: 'movement_detected',
          invoked_at: '2026-07-14 00:00:00+00',
          resolved_at: '2026-07-14 00:00:01+00',
          created_at: '2026-07-14 00:00:01+00',
        },
        { id: '7' },
      ],
    });

    const page = await listUnstuckReports(pool, {
      realm: 'alpha',
      days: 999,
      limit: 2,
      beforeId: 50,
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('c.name AS character_name');
    expect(sql).toContain('LEFT JOIN characters c ON c.id = r.character_id');
    expect(sql).toContain('WHERE r.realm = $1');
    expect(sql).toContain("r.created_at >= now() - ($2::int * INTERVAL '1 day')");
    expect(sql).not.toContain('r.resolved_at >= now()');
    expect(sql).toContain('($3::bigint IS NULL OR r.id < $3)');
    expect(sql).toContain('ORDER BY r.id DESC');
    expect(sql).toContain('LIMIT $4');
    expect(params).toEqual(['alpha', 90, 50, 3]);
    expect(page.hasMore).toBe(true);
    expect(page.nextBeforeId).toBe(8);
    expect(page.rows).toHaveLength(2);
    expect(page.rows[0]).toMatchObject({
      id: 9,
      accountId: 7,
      characterId: 42,
      characterName: 'Aldric',
      areaKind: 'dungeon',
      areaId: 'hollow_crypt',
      instanceId: 'hollow_crypt',
      instanceSlot: 3,
      originRawX: 101,
      destinationLocalZ: 20,
      invokedAt: '2026-07-14T00:00:00.000Z',
      resolvedAt: '2026-07-14T00:01:00.000Z',
      createdAt: '2026-07-14 00:01:01+00',
    });
    expect(page.rows[1]).toMatchObject({
      id: 8,
      accountId: null,
      characterName: null,
      destinationRawX: null,
      originRawX: 5,
    });
  });

  it('caps the report limit at 200 and ignores an invalid cursor', async () => {
    await listUnstuckReports(pool, {
      realm: 'alpha',
      days: Number.NaN,
      limit: 999,
      beforeId: Number.NaN,
    });
    expect(query.mock.calls[0][1]).toEqual(['alpha', 30, null, 201]);
  });

  it('returns no next cursor when the fetched page is exhausted', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await listUnstuckReports(pool, { realm: 'alpha', days: 0, limit: 0 })).toEqual({
      rows: [],
      hasMore: false,
      nextBeforeId: null,
    });
    expect(query.mock.calls[0][1]).toEqual(['alpha', 1, null, 2]);
  });
});

describe('listUnstuckHotspots', () => {
  it('groups five-yard local buckets across slots and clamps its bounds', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          area_kind: 'dungeon',
          area_id: 'hollow_crypt',
          bucket_local_x: '20',
          bucket_local_y: '0',
          bucket_local_z: '15',
          report_count: '6',
          completed_count: '3',
          cancelled_count: '2',
          failed_count: '1',
          first_invoked_at: invokedAt,
          last_resolved_at: resolvedAt,
        },
      ],
    });
    const rows = await listUnstuckHotspots(pool, { realm: 'alpha', days: 0, limit: 999 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('floor(origin_local_x / $3::double precision) * $3');
    expect(sql).toContain('floor(origin_local_y / $3::double precision) * $3');
    expect(sql).toContain('floor(origin_local_z / $3::double precision) * $3');
    expect(sql).toContain('GROUP BY');
    expect(sql).not.toContain('instance_id');
    expect(sql).not.toContain('instance_slot');
    expect(sql).toContain("count(*) FILTER (WHERE outcome = 'completed')::int");
    expect(sql).toContain("count(*) FILTER (WHERE outcome = 'cancelled')::int");
    expect(sql).toContain("count(*) FILTER (WHERE outcome = 'failed')::int");
    expect(sql).toContain("created_at >= now() - ($2::int * INTERVAL '1 day')");
    expect(sql).not.toContain('resolved_at >= now()');
    expect(sql).toContain('ORDER BY report_count DESC');
    expect(params).toEqual(['alpha', 1, UNSTUCK_HOTSPOT_BUCKET_YARDS, 50]);
    expect(rows).toEqual([
      {
        areaKind: 'dungeon',
        areaId: 'hollow_crypt',
        instanceId: null,
        bucketLocalX: 20,
        bucketLocalY: 0,
        bucketLocalZ: 15,
        reportCount: 6,
        completedCount: 3,
        cancelledCount: 2,
        failedCount: 1,
        firstInvokedAt: '2026-07-14T00:00:00.000Z',
        lastResolvedAt: '2026-07-14T00:00:02.000Z',
      },
    ]);
  });
});
