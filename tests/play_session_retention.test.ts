// Unit coverage for the play-session retention primitives: the guarded rollup
// DDL, the keep-forever/floor clamp, and the two bounded prune batches. The
// primitives take the db seam as an argument, so plain capture fakes stand in
// for pg with no module mocking.

import { describe, expect, it, type Mock, vi } from 'vitest';
import {
  clampPlaySessionRetentionDays,
  PLAY_SESSION_RETENTION_FLOOR_DAYS,
  PLAY_SESSION_RETENTION_SCHEMA,
  pruneAccountIpAssociationsBatch,
  prunePlaySessionsBatch,
} from '../server/play_session_retention_db';

type PruneResult = { rowCount: number | null };
type FakeDb = { query: Mock<(text: string, values?: unknown[]) => Promise<PruneResult>> };

function fakeDb(result: PruneResult = { rowCount: 0 }): FakeDb {
  return {
    query: vi
      .fn<(text: string, values?: unknown[]) => Promise<PruneResult>>()
      .mockResolvedValue(result),
  };
}

// Normalize whitespace so intra-statement fragments pin regardless of the
// template literal's indentation.
function issuedSql(db: FakeDb): string {
  return String(db.query.mock.calls[0][0]).replace(/\s+/g, ' ');
}

describe('PLAY_SESSION_RETENTION_SCHEMA', () => {
  // Strip SQL line comments first so the pins measure statement structure,
  // not prose (the daily_rewards_ban_db suite's idiom).
  const schema = PLAY_SESSION_RETENTION_SCHEMA.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ');

  it('creates both rollup tables guarded and keyed for the fold upserts', () => {
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS play_session_totals');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS account_ip_associations');
    // Both primary keys double as the fold upserts' conflict targets.
    expect(schema).toContain('PRIMARY KEY (account_id, character_id)');
    expect(schema).toContain('PRIMARY KEY (account_id, ip_address)');
  });

  it('cascades exactly both rollup tables from accounts', () => {
    expect(schema.split('REFERENCES accounts(id) ON DELETE CASCADE').length - 1).toBe(2);
  });

  it('keeps the deleted-character bucket free of a characters FK', () => {
    // play_sessions.character_id is ON DELETE SET NULL, so the fold buckets
    // deleted characters under id 0 and the column must keep accepting ids of
    // characters that no longer exist; an FK here would break the bucket on
    // the next character delete.
    const totalsBlock = schema.slice(
      schema.indexOf('play_session_totals'),
      schema.indexOf('account_ip_associations'),
    );
    expect(totalsBlock).not.toContain('REFERENCES characters');
  });

  it('names the ban-evasion and aging indexes, both guarded', () => {
    expect(schema).toContain(
      'CREATE INDEX IF NOT EXISTS account_ip_associations_ip ON account_ip_associations(ip_address, account_id)',
    );
    expect(schema).toContain(
      'CREATE INDEX IF NOT EXISTS account_ip_associations_last_seen ON account_ip_associations(last_seen_at)',
    );
  });

  it('is guarded-only DDL safe to re-apply at every boot', () => {
    expect(schema).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/i);
    expect(schema).not.toMatch(/CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/i);
    expect(schema).not.toMatch(/\b(?:DROP|TRUNCATE|ALTER COLUMN)\b/i);
  });
});

describe('clampPlaySessionRetentionDays', () => {
  it('treats zero, negative, and non-finite values as keep-forever', () => {
    expect(clampPlaySessionRetentionDays(0)).toBe(0);
    expect(clampPlaySessionRetentionDays(-1)).toBe(0);
    expect(clampPlaySessionRetentionDays(Number.NaN)).toBe(0);
    expect(clampPlaySessionRetentionDays(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('floors fractional day counts at or above the floor', () => {
    expect(clampPlaySessionRetentionDays(180)).toBe(180);
    expect(clampPlaySessionRetentionDays(46.9)).toBe(46);
    expect(clampPlaySessionRetentionDays(45)).toBe(45);
  });

  it('clamps every positive value below the floor up to 45', () => {
    expect(clampPlaySessionRetentionDays(44)).toBe(45);
    expect(clampPlaySessionRetentionDays(10)).toBe(45);
    // A fractional value below 1 must never floor to a delete-everything
    // '0 days'; the floor swallows it before the interval text is built.
    expect(clampPlaySessionRetentionDays(0.5)).toBe(45);
  });

  it('pins the floor strictly above the 30-day admin activity window', () => {
    expect(PLAY_SESSION_RETENTION_FLOOR_DAYS).toBe(45);
    // The admin dashboard's registrations/sessions charts read a 30-day
    // play_sessions window (ACTIVITY_WINDOW_DAYS in server/admin.ts); the
    // floor sits strictly above it so a fold can never delete a row those
    // windows still count.
    expect(PLAY_SESSION_RETENTION_FLOOR_DAYS).toBeGreaterThan(30);
  });
});

describe('prunePlaySessionsBatch', () => {
  it('returns zero without querying for keep-forever retention values', async () => {
    for (const retentionDays of [0, -3, Number.NaN]) {
      const db = fakeDb();
      await expect(prunePlaySessionsBatch(db, retentionDays, 500)).resolves.toBe(0);
      expect(db.query).not.toHaveBeenCalled();
    }
  });

  it('folds and deletes in one atomic statement and returns the deleted count', async () => {
    const db = fakeDb({ rowCount: 37 });
    await expect(prunePlaySessionsBatch(db, 180, 500)).resolves.toBe(37);
    // Single-statement atomicity is the pin: one query carries both fold
    // INSERTs and the DELETE as data-modifying CTEs, so a crash between fold
    // and delete can neither double-count nor drop a fold.
    expect(db.query).toHaveBeenCalledOnce();
    const sql = issuedSql(db);
    expect(sql).toContain('INSERT INTO play_session_totals');
    expect(sql).toContain('INSERT INTO account_ip_associations');
    expect(sql).toContain('DELETE FROM play_sessions');
    expect(db.query.mock.calls[0][1]).toEqual(['180', 500]);
  });

  it('dooms only old ended sessions that are not a first-session referent', async () => {
    const db = fakeDb();
    await prunePlaySessionsBatch(db, 180, 500);
    const sql = issuedSql(db);
    expect(sql).toContain("started_at < now() - ($1 || ' days')::interval");
    expect(sql).toContain('ended_at IS NOT NULL');
    // player_account_facts.first_session_id is ON DELETE SET NULL: deleting a
    // referent would NULL it and let a later login re-anchor the facts row,
    // clobbering first_session_max_level back to 1. The guard must stay a
    // NOT EXISTS anti-join: a NOT IN hash flips to a per-row subplan once the
    // facts table outgrows the hash budget and then times out every night.
    expect(sql).toContain(
      'NOT EXISTS (SELECT 1 FROM player_account_facts f WHERE f.first_session_id = play_sessions.id)',
    );
    expect(sql).not.toContain('NOT IN');
    expect(sql).toContain('ORDER BY started_at');
    expect(sql).toContain('LIMIT $2');
  });

  it('folds the deleted-character bucket and upserts with summing and GREATEST', async () => {
    const db = fakeDb();
    await prunePlaySessionsBatch(db, 180, 500);
    const sql = issuedSql(db);
    expect(sql).toContain('COALESCE(character_id, 0)');
    expect(sql).toContain('ip_address IS NOT NULL');
    expect(sql).toContain('ON CONFLICT (account_id, character_id) DO UPDATE');
    expect(sql).toContain('ON CONFLICT (account_id, ip_address) DO UPDATE');
    // The conflict arms must ACCUMULATE, never overwrite: an overwrite would
    // silently drop every previously folded batch's playtime from the totals.
    expect(sql).toContain(
      'playtime_seconds = play_session_totals.playtime_seconds + EXCLUDED.playtime_seconds',
    );
    expect(sql).toContain('sessions = play_session_totals.sessions + EXCLUDED.sessions');
    expect(sql).toContain('GREATEST(play_session_totals.last_played, EXCLUDED.last_played)');
    expect(sql).toContain('GREATEST(account_ip_associations.last_seen_at, EXCLUDED.last_seen_at)');
    // last_seen_at folds the session END, the latest moment the account was
    // seen on that IP; folding started_at would shorten the aging bound.
    expect(sql).toContain('SELECT account_id, ip_address, MAX(ended_at)');
    // last_played folds the session START, matching the character-select
    // reader's live last_played = MAX(started_at); folding ended_at here would
    // drift a folded character's last_played later than the live term.
    expect(sql).toContain('MAX(started_at)');
    expect(sql).toContain('DELETE FROM play_sessions WHERE id IN (SELECT id FROM doomed)');
  });

  it('never folds an open session into the playtime sum', async () => {
    const db = fakeDb();
    await prunePlaySessionsBatch(db, 180, 500);
    const sql = issuedSql(db);
    // The playtime fold sums closed durations only; an open session keeps
    // accruing live and is never deleted, so now() must never substitute for
    // a missing ended_at in the sum.
    expect(sql).toContain('SUM(EXTRACT(EPOCH FROM (ended_at - started_at)))');
    expect(sql).not.toContain('COALESCE(ended_at, now())');
    // The default-allowance guarantee itself is pinned at the source layer in
    // tests/server/tunables.test.ts (the prune bodies never gain the wrapper).
  });

  it('threads the clamped retention days through as interval text', async () => {
    const belowFloor = fakeDb();
    await prunePlaySessionsBatch(belowFloor, 10, 500);
    expect(belowFloor.query.mock.calls[0][1]).toEqual(['45', 500]);
    const fractional = fakeDb();
    await prunePlaySessionsBatch(fractional, 200.9, 500);
    expect(fractional.query.mock.calls[0][1]).toEqual(['200', 500]);
  });

  it('floors the batch size to at least one row', async () => {
    // LIMIT 0 would turn the sweep into a silent no-op that never advances.
    const zero = fakeDb();
    await prunePlaySessionsBatch(zero, 180, 0);
    expect(zero.query.mock.calls[0][1]).toEqual(['180', 1]);
    const fractional = fakeDb();
    await prunePlaySessionsBatch(fractional, 180, 2.9);
    expect(fractional.query.mock.calls[0][1]).toEqual(['180', 2]);
  });

  it('reports a null driver rowCount as zero deletions', async () => {
    const db = fakeDb({ rowCount: null });
    await expect(prunePlaySessionsBatch(db, 180, 500)).resolves.toBe(0);
  });
});

describe('pruneAccountIpAssociationsBatch', () => {
  it('returns zero without querying for keep-forever aging values', async () => {
    for (const agingDays of [0, -1, Number.NaN]) {
      const db = fakeDb();
      await expect(pruneAccountIpAssociationsBatch(db, agingDays, 250)).resolves.toBe(0);
      expect(db.query).not.toHaveBeenCalled();
    }
  });

  it('ages out one bounded oldest-first batch and returns the deleted count', async () => {
    const db = fakeDb({ rowCount: 12 });
    await expect(pruneAccountIpAssociationsBatch(db, 730, 250)).resolves.toBe(12);
    const sql = issuedSql(db);
    expect(sql).toContain('DELETE FROM account_ip_associations');
    expect(sql).toContain('(account_id, ip_address) IN');
    expect(sql).toContain("last_seen_at < now() - ($1 || ' days')::interval");
    expect(sql).toContain('ORDER BY last_seen_at');
    expect(sql).toContain('LIMIT $2');
    expect(db.query.mock.calls[0][1]).toEqual(['730', 250]);
  });

  it('applies no retention floor to the aging window', async () => {
    // The 45-day floor protects the admin activity windows over
    // play_sessions and is retention-specific; association aging is the
    // privacy bound and takes any whole positive day count as-is.
    const db = fakeDb();
    await pruneAccountIpAssociationsBatch(db, 10, 250);
    expect(db.query.mock.calls[0][1]).toEqual(['10', 250]);
  });

  it('floors fractional aging days and undersized batches', async () => {
    const fractional = fakeDb();
    await pruneAccountIpAssociationsBatch(fractional, 89.9, 250);
    expect(fractional.query.mock.calls[0][1]).toEqual(['89', 250]);
    const zeroBatch = fakeDb();
    await pruneAccountIpAssociationsBatch(zeroBatch, 730, 0);
    expect(zeroBatch.query.mock.calls[0][1]).toEqual(['730', 1]);
  });

  it('reports a null driver rowCount as zero deletions', async () => {
    const db = fakeDb({ rowCount: null });
    await expect(pruneAccountIpAssociationsBatch(db, 730, 250)).resolves.toBe(0);
  });
});
