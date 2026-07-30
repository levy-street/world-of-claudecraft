import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  return { query: vi.fn(), connect: vi.fn() };
});

// Mock pg itself (the arena_db.test.ts idiom) rather than partial-mocking
// server/db: loadWorldState, saveWorldState, and runWithStatementTimeout must
// stay REAL and still ride the capture mock, and they close over db.ts's own
// module-scope pool, which only a pg-level Pool mock can replace.
vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: mocks.query, connect: mocks.connect };
  }),
}));

vi.mock('../server/realm', () => ({ REALM: 'test-realm' }));

import {
  distinctOnlineSampleRealms,
  foldOnlinePeak,
  ONLINE_PEAK_WORLD_STATE_PREFIX,
  overviewCounts,
  pruneOnlineSamplesBatch,
  pruneSitePresenceSamplesBatch,
  pruneSitePresenceSessionsBatch,
} from '../server/admin_db';

beforeEach(() => {
  mocks.query.mockReset();
  mocks.connect.mockReset();
  // runWithStatementTimeout checks out a dedicated client: answer the control
  // statements inline and forward the real read to the capture mock, so the
  // assertions see exactly the statement the production path issues.
  mocks.connect.mockImplementation(async () => ({
    query: (text: string, values?: unknown[]) =>
      text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' || text.startsWith('SET LOCAL')
        ? Promise.resolve({ rows: [] })
        : mocks.query(text, values),
    release() {},
  }));
});

describe('metrics retention prune batches', () => {
  it('prunes online samples with both index arms, ordered and batch-bounded', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 3 });

    await expect(pruneOnlineSamplesBatch('r1', 90, 500)).resolves.toBe(3);

    const [sql, params] = mocks.query.mock.calls[0];
    // The only non-PK index leads on realm: a mutation dropping the realm arm
    // seq-scans the table, one dropping the sampled_at bound deletes every
    // sample for the realm regardless of age, so pin each arm separately.
    expect(sql).toContain('WHERE realm = $1');
    expect(sql).toContain('sampled_at <');
    expect(sql).toContain('id IN');
    expect(sql).toContain('ORDER BY sampled_at');
    expect(sql).toContain('LIMIT $3');
    // The age bound must consume the BOUND days parameter: a hardcoded
    // interval with the params array left intact would red only here (in
    // production Postgres rejects a statement with an unused bind parameter,
    // stalling the nightly prune).
    expect(sql).toContain("($2 || ' days')::interval");
    expect(params).toEqual(['r1', '90', 500]);
  });

  it('prunes site presence samples by sampled_at in id-keyed batches', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 2 });

    await expect(pruneSitePresenceSamplesBatch(30, 200)).resolves.toBe(2);

    const [sql, params] = mocks.query.mock.calls[0];
    // The age bound rides admin_site_presence_samples_sampled; the id subquery
    // keeps the delete bounded to one batch.
    expect(sql).toContain('DELETE FROM admin_site_presence_samples');
    expect(sql).toContain('sampled_at <');
    expect(sql).toContain('id IN');
    expect(sql).toContain('LIMIT $2');
    // The interval must consume the bound days parameter (see the online
    // samples case above for why).
    expect(sql).toContain("($1 || ' days')::interval");
    expect(params).toEqual(['30', 200]);
  });

  it('prunes site presence sessions by last_seen_at keyed on visitor_id', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await expect(pruneSitePresenceSessionsBatch(30, 200)).resolves.toBe(1);

    const [sql, params] = mocks.query.mock.calls[0];
    // site_presence_sessions has no id column: visitor_id is the PRIMARY KEY,
    // so both the subquery and the outer IN must key on it.
    expect(sql).toContain('DELETE FROM site_presence_sessions');
    expect(sql).toContain('last_seen_at <');
    expect(sql).toContain('visitor_id IN');
    expect(sql).toContain('LIMIT $2');
    // The interval must consume the bound days parameter (see the online
    // samples case above for why).
    expect(sql).toContain("($1 || ' days')::interval");
    expect(params).toEqual(['30', 200]);
  });

  it('clamps fractional retention days up to one full day on all three prunes', async () => {
    // 0.5 passes each keep-forever guard, but an unclamped floor would build
    // interval '0 days' and delete every row older than now on an operator typo.
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await pruneOnlineSamplesBatch('r1', 0.5, 100);
    await pruneSitePresenceSamplesBatch(0.5, 100);
    await pruneSitePresenceSessionsBatch(0.5, 100);

    expect(mocks.query.mock.calls[0][1]).toEqual(['r1', '1', 100]);
    expect(mocks.query.mock.calls[1][1]).toEqual(['1', 100]);
    expect(mocks.query.mock.calls[2][1]).toEqual(['1', 100]);
  });

  it('floors a zero batch size to LIMIT 1 on all three prunes, never LIMIT 0', async () => {
    // Defense in depth below the sweep's own normalization: a LIMIT 0 delete
    // would report zero rows forever and the caller could loop on it.
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await pruneOnlineSamplesBatch('r1', 90, 0);
    await pruneSitePresenceSamplesBatch(30, 0);
    await pruneSitePresenceSessionsBatch(30, 0);

    expect(mocks.query.mock.calls[0][1]).toEqual(['r1', '90', 1]);
    expect(mocks.query.mock.calls[1][1]).toEqual(['30', 1]);
    expect(mocks.query.mock.calls[2][1]).toEqual(['30', 1]);
  });

  it('treats a non-positive retention as keep-forever on all three prunes', async () => {
    // 0 (and any negative) means retention is disabled: the guard must return
    // without issuing any statement at all.
    for (const days of [0, -1]) {
      await expect(pruneOnlineSamplesBatch('r1', days, 500)).resolves.toBe(0);
      await expect(pruneSitePresenceSamplesBatch(days, 500)).resolves.toBe(0);
      await expect(pruneSitePresenceSessionsBatch(days, 500)).resolves.toBe(0);
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('lists every realm with samples for the whole-database sweep', async () => {
    // One advisory-locked process sweeps for the whole database, so the realm
    // list must come from the data, not this process's own REALM.
    mocks.query.mockResolvedValueOnce({ rows: [{ realm: 'r1' }, { realm: 'r2' }] });

    await expect(distinctOnlineSampleRealms()).resolves.toEqual(['r1', 'r2']);

    expect(String(mocks.query.mock.calls[0][0])).toContain(
      'SELECT DISTINCT realm FROM admin_online_samples',
    );
  });
});

describe('foldOnlinePeak', () => {
  // Route by SQL content: the live-max read, the world_state load, and the
  // world_state upsert each answer their own way; INSERT params are captured.
  function primeFold(livePeak: number | null, stored: unknown): unknown[][] {
    const writes: unknown[][] = [];
    mocks.query.mockImplementation(async (text: string, values?: unknown[]) => {
      if (text.includes('max(online_players)')) return { rows: [{ peak: livePeak }] };
      if (text.includes('SELECT data FROM world_state')) {
        return { rows: stored === null ? [] : [{ data: stored }] };
      }
      if (text.includes('INSERT INTO world_state')) {
        writes.push(values ?? []);
        return { rows: [] };
      }
      throw new Error(`unexpected statement: ${text}`);
    });
    return writes;
  }

  it('raises the stored peak when the live max is higher', async () => {
    const writes = primeFold(150, { peak: 100 });

    await foldOnlinePeak('r1');

    // The fold must land under the exact key the overviewCounts reader
    // rebuilds, with the higher live value serialized into the row.
    expect(writes).toEqual([['admin_online_peak:r1', '{"peak":150}']]);
    const maxCall = mocks.query.mock.calls.find(([sql]) =>
      String(sql).includes('max(online_players)'),
    );
    // The live-max read must carry the realm arm so it rides the realm-leading
    // index instead of scanning every realm's samples.
    expect(maxCall?.[0]).toContain('WHERE realm = $1');
    expect(maxCall?.[1]).toEqual(['r1']);
  });

  it('writes nothing when the live max does not beat the stored peak', async () => {
    // GREATEST semantics: a lower live max is the daily no-op case and must
    // not churn world_state.
    const writes = primeFold(50, { peak: 100 });

    await foldOnlinePeak('r1');

    expect(writes).toEqual([]);
  });

  it('writes nothing when the live max equals the stored peak', async () => {
    // The boundary arm of the no-churn guard: a stable peak is the steady
    // state for every realm, so an off-by-one comparison (< for <=) would
    // rewrite world_state for every realm every night.
    const writes = primeFold(100, { peak: 100 });

    await foldOnlinePeak('r1');

    expect(writes).toEqual([]);
  });

  it('writes nothing when the realm has no samples', async () => {
    // max() over zero rows yields a NULL peak: nothing to fold.
    const writes = primeFold(null, { peak: 100 });

    await foldOnlinePeak('r1');

    expect(writes).toEqual([]);
  });

  it('treats a missing or malformed stored peak as zero', async () => {
    // A malformed stored row must not wedge the fold: it counts as 0 so any
    // finite live max repairs it.
    const malformed = primeFold(5, { peak: 'x' });
    await foldOnlinePeak('r1');
    expect(malformed).toEqual([['admin_online_peak:r1', '{"peak":5}']]);

    const missing = primeFold(5, null);
    await foldOnlinePeak('r1');
    expect(missing).toEqual([['admin_online_peak:r1', '{"peak":5}']]);
  });

  it('propagates a failed read instead of swallowing it', async () => {
    // The sweep relies on the throw to skip the realm's prune for the run: a
    // swallowed fold failure would let the prune delete an unfolded peak.
    mocks.query.mockRejectedValue(new Error('db down'));

    await expect(foldOnlinePeak('r1')).rejects.toThrow('db down');
  });
});

describe('overviewCounts all-time peak', () => {
  it('reads GREATEST of the retained-window max and the folded world_state peak', async () => {
    mocks.query.mockResolvedValue({ rows: [{}] });

    await overviewCounts();

    // The read runs on the raised allowance via runWithStatementTimeout, so it
    // arrives through the dedicated-client connect fake.
    expect(mocks.connect).toHaveBeenCalled();
    const [sql, params] = mocks.query.mock.calls[0];
    expect(params).toEqual(['test-realm']);
    expect(String(sql)).toContain('GREATEST');
    // Both operands: the live retained-window max keeps an in-window peak
    // honest before the next fold, the world_state arm keeps a pruned-away
    // peak from being lost. The live max must sit INSIDE the GREATEST call:
    // a bare toContain('max(online_players)') is satisfied by the
    // peak_online_today subquery, so a mutation dropping the live arm from
    // GREATEST would survive it.
    expect(String(sql)).toMatch(/GREATEST\(\s*COALESCE\(\(SELECT max\(online_players\)/);
    expect(String(sql)).toContain('FROM world_state');
    // A corrupted or tampered stored peak must degrade to 0 inside the SQL,
    // never abort the whole overview read: pin the regex guard on the cast,
    // INCLUDING the digit-count bound (a digits-only value wider than int4
    // passes a bare digit match and the ::int cast then errors out the read).
    expect(String(sql)).toContain("~ '^[0-9]{1,9}$'");
    // Pin the LITERAL key prefix, never the imported const, so the reader SQL
    // cannot drift silently with the constant.
    expect(String(sql)).toContain("'admin_online_peak:' || $1");
    // Decisive not-a-bare-max form: the alias must be produced by the GREATEST
    // expression, not the old single-COALESCE subquery.
    expect(String(sql)).toMatch(/GREATEST\([\s\S]*?AS peak_online_all_time/);
    // The average-playtime numerator must add the folded rollup: without the
    // play_session_totals term the overview average silently shrinks as old
    // sessions fold away.
    expect(String(sql)).toContain('FROM play_session_totals');
  });

  it('keeps the exported prefix equal to the pinned literal', () => {
    // The reader pin above uses the literal; this ties the fold-side constant
    // to the same text so fold and reader cannot drift apart.
    expect(ONLINE_PEAK_WORLD_STATE_PREFIX).toBe('admin_online_peak:');
    // The constant is template-interpolated into the reader SQL, so its
    // character set must stay inert inside a single-quoted SQL literal.
    expect(ONLINE_PEAK_WORLD_STATE_PREFIX).toMatch(/^[a-z_:]+$/);
  });
});
