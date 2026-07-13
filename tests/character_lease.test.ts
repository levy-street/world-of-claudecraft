import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// db.ts builds a pg Pool and requires DATABASE_URL at import time; stub both so
// the module loads and every lease query goes through a spy we can assert on.
// Same idiom as save_character_and_market.test.ts.
const dbMock = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    return { query: dbMock.query, connect: dbMock.connect };
  },
}));

import {
  acquireCharacterLease,
  heartbeatCharacterLeases,
  LEASE_TTL_SECONDS,
  PROCESS_LEASE_HOLDER,
  releaseAllCharacterLeases,
  releaseCharacterLease,
} from '../server/db';
import { REALM } from '../server/realm';

// The load-bearing values are pinned as bare literals below, never as the same
// constant re-derived from itself. The TTL is 90 seconds (three missed 30s
// autosave heartbeats); a fresh acquire reports true on rowCount 1 and MUST
// report false (fail closed) on rowCount 0. Every acquire stamps a nonce and the
// fenced release matches on it.
beforeEach(() => {
  dbMock.query.mockReset();
  dbMock.query.mockResolvedValue({ rows: [], rowCount: 1 } as any);
});

const firstSql = () => String(dbMock.query.mock.calls[0][0]);
const firstParams = () => dbMock.query.mock.calls[0][1] as unknown[];

describe('PROCESS_LEASE_HOLDER', () => {
  it('is the realm name plus a per-boot UUID suffix', () => {
    expect(PROCESS_LEASE_HOLDER.startsWith(`${REALM}#`)).toBe(true);
    const suffix = PROCESS_LEASE_HOLDER.slice(REALM.length + 1);
    // A per-boot UUID keeps two processes accidentally on the same realm name
    // from sharing a holder (the exact double-load accident the lease guards).
    expect(suffix).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('LEASE_TTL_SECONDS', () => {
  it('is 90 seconds (three missed 30s autosave heartbeats)', () => {
    expect(LEASE_TTL_SECONDS).toBe(90);
  });
});

describe('acquireCharacterLease', () => {
  it('upserts the lease with the nonce column, the reclaim-or-own predicate, and TTL interval', async () => {
    const ok = await acquireCharacterLease(42, 'nonce-1');
    expect(ok).toBe(true);

    const sql = firstSql();
    expect(sql).toContain(
      'INSERT INTO character_leases (character_id, realm, holder, nonce, acquired_at, heartbeat_at, expires_at)',
    );
    expect(sql).toContain('ON CONFLICT (character_id) DO UPDATE');
    // The fence: every acquire re-stamps the nonce, so a later release keyed to an
    // older nonce is a no-op.
    expect(sql).toContain('nonce = EXCLUDED.nonce');
    // The reclaim arm (expired) OR the same-holder arm (a linkdead resume on this
    // process re-extends its own lease). A live foreign lease matches neither, so
    // the upsert touches nothing and rowCount stays 0.
    expect(sql).toContain(
      'WHERE character_leases.expires_at < now() OR character_leases.holder = EXCLUDED.holder',
    );
    expect(sql).toContain('make_interval(secs => $5)');
    // Params: character id, this process realm, the default holder, the nonce, the 90s TTL.
    expect(firstParams()).toEqual([42, REALM, PROCESS_LEASE_HOLDER, 'nonce-1', 90]);
  });

  it('passes an explicit holder through instead of the process default', async () => {
    await acquireCharacterLease(7, 'nonce-x', 'other-holder');
    expect(firstParams()).toEqual([7, REALM, 'other-holder', 'nonce-x', 90]);
  });

  it('returns false (fail closed) when the upsert changes no row', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    expect(await acquireCharacterLease(42, 'nonce-1')).toBe(false);
  });

  it('returns false when rowCount is absent rather than truthily defaulting', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] } as any);
    expect(await acquireCharacterLease(42, 'nonce-1')).toBe(false);
  });
});

describe('releaseCharacterLease', () => {
  it('fences the delete on the nonce when one is given', async () => {
    await releaseCharacterLease(42, 'nonce-1');
    expect(firstSql()).toBe(
      'DELETE FROM character_leases WHERE character_id = $1 AND holder = $2 AND nonce = $3',
    );
    expect(firstParams()).toEqual([42, PROCESS_LEASE_HOLDER, 'nonce-1']);
  });

  it('deletes on holder alone when no nonce is given (unfenced arm for nonce-less sessions)', async () => {
    await releaseCharacterLease(42);
    expect(firstSql()).toBe('DELETE FROM character_leases WHERE character_id = $1 AND holder = $2');
    expect(firstParams()).toEqual([42, PROCESS_LEASE_HOLDER]);
  });

  it('passes an explicit holder through with the nonce', async () => {
    await releaseCharacterLease(7, 'nonce-y', 'other-holder');
    expect(firstParams()).toEqual([7, 'other-holder', 'nonce-y']);
  });
});

describe('heartbeatCharacterLeases', () => {
  it('extends every lease held by this process in one statement', async () => {
    await heartbeatCharacterLeases();
    const sql = firstSql();
    expect(sql).toContain('UPDATE character_leases');
    expect(sql).toContain('make_interval(secs => $2)');
    expect(sql).toContain('WHERE holder = $1');
    // A lease already reclaimed by another holder is not matched, so this can
    // never steal one back.
    expect(firstParams()).toEqual([PROCESS_LEASE_HOLDER, 90]);
  });

  it('passes an explicit holder through', async () => {
    await heartbeatCharacterLeases('other-holder');
    expect(firstParams()).toEqual(['other-holder', 90]);
  });
});

describe('releaseAllCharacterLeases', () => {
  it('drops every lease held by this process (shutdown sweep)', async () => {
    await releaseAllCharacterLeases();
    expect(firstSql()).toBe('DELETE FROM character_leases WHERE holder = $1');
    expect(firstParams()).toEqual([PROCESS_LEASE_HOLDER]);
  });
});

describe('shutdown wiring (source pin)', () => {
  it('main.ts drains the bank ledger and deed records, then sweeps leases, then closes the pool', () => {
    // The shutdown closure in server/main.ts is not unit-drivable, so pin its
    // ordering by source. The load-bearing order is: endAllPlaySessions() (close
    // the play-session rows), then bankLedgerIdle() (flush every queued audit row
    // WHILE this process still holds the leases), then releaseAllCharacterLeases(),
    // then pool.end() (both drain and sweep need a live pool). Draining BEFORE the
    // sweep matters: once the leases drop, a replacement process can load the same
    // character and write new bank_ledger rows, and any rows still queued here would
    // flush AFTER them with higher insertion ids, inverting the id order the offline
    // audit replays by (false negative_net / purchased_regression alarms). The
    // deed-records FIFO drains in the same window: a queued character_deeds insert
    // rejected by pool.end() would go missing until that character's next login
    // (the join reconcile is the only heal). Match the awaited CALL forms so a
    // prose mention in a comment never shifts an index.
    const src = readFileSync(new URL('../server/main.ts', import.meta.url), 'utf8');
    const endSessions = src.indexOf('await game.endAllPlaySessions(');
    const sweep = src.indexOf('await releaseAllCharacterLeases(');
    const ledgerDrain = src.indexOf('await bankLedgerIdle()');
    const deedsDrain = src.indexOf('await deedRecordsIdle()');
    const poolEnd = src.indexOf('await pool.end()');
    expect(endSessions).toBeGreaterThan(-1);
    expect(ledgerDrain).toBeGreaterThan(endSessions);
    expect(deedsDrain).toBeGreaterThan(endSessions);
    expect(sweep).toBeGreaterThan(ledgerDrain);
    expect(sweep).toBeGreaterThan(deedsDrain);
    expect(poolEnd).toBeGreaterThan(sweep);
  });
});
