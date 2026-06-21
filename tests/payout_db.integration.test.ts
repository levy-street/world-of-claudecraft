// REAL-Postgres integration test for server/payout_db.ts (the buyback_batches
// ledger + the cross-process keeper lock). payout_keeper.test.ts drives the
// keeper over an in-memory fake store; this proves the ACTUAL SQL: the batch
// lifecycle, the buy_tx_sig replay guard, openBuybackBatches filtering/ordering,
// lastSettleAt, the bigint/typed row mapping, and the genuine session-level
// mutual exclusion of withPayoutKeeperLock.
//
// CI-safe: skips unless PG_TEST_URL points at a disposable Postgres.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const PG_TEST_URL = process.env.PG_TEST_URL;
if (PG_TEST_URL) process.env.DATABASE_URL = PG_TEST_URL;
else process.env.DATABASE_URL ??= 'postgres://skip:skip@127.0.0.1:1/skip';

const { pool, ensureSchema } = await import('../server/db');
const dbm = await import('../server/payout_db');

describe.skipIf(!PG_TEST_URL)('payout_db buyback_batches (real Postgres)', () => {
  beforeAll(async () => { await ensureSchema(); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await pool.query('TRUNCATE buyback_batches'); });

  it('opens a burn batch (season_id/dest null) and reads it back with the right typed shape', async () => {
    expect(await dbm.createBuybackBatch({ batchId: 'b1', mode: 'burn', source: 'marketplace', usdcIn: 250_000_000n, buyTxSig: 'swap1' })).toBe(true);
    const open = await dbm.openBuybackBatches();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      batchId: 'b1', mode: 'burn', source: 'marketplace', usdcIn: 250_000_000n,
      wocBought: 0n, wocSettled: 0n, buyTxSig: 'swap1', settleTxSig: null,
      status: 'swapping', seasonId: null, dest: null,
    });
    expect(typeof open[0].usdcIn).toBe('bigint');
    expect(typeof open[0].createdAt).toBe('string');
  });

  it('records a top_up batch with season_id + dest', async () => {
    await dbm.createBuybackBatch({ batchId: 't1', mode: 'top_up', source: 'marketplace', usdcIn: 100n, buyTxSig: 'swapT', seasonId: 7, dest: 'PoolOwner99' });
    const [row] = await dbm.openBuybackBatches();
    expect(row).toMatchObject({ mode: 'top_up', seasonId: 7, dest: 'PoolOwner99' });
    expect(typeof row.seasonId).toBe('number');
  });

  it('replay-guards a duplicate buy_tx_sig (ON CONFLICT → false), inserting only once', async () => {
    expect(await dbm.createBuybackBatch({ batchId: 'b1', mode: 'burn', source: 'marketplace', usdcIn: 10n, buyTxSig: 'dupSwap' })).toBe(true);
    expect(await dbm.createBuybackBatch({ batchId: 'b2', mode: 'burn', source: 'marketplace', usdcIn: 10n, buyTxSig: 'dupSwap' })).toBe(false);
    const n = await pool.query(`SELECT count(*)::int c FROM buyback_batches`);
    expect(n.rows[0].c).toBe(1);
  });

  it('advances a batch through the full swap→settle lifecycle, setting each column', async () => {
    await dbm.createBuybackBatch({ batchId: 'b1', mode: 'burn', source: 'marketplace', usdcIn: 300n, buyTxSig: 'swap1' });
    await dbm.markBatchSwapped('b1', 700n);
    await dbm.markBatchSettling('b1', 'settle1');
    await dbm.markBatchSettled('b1', 700n);
    const r = await pool.query(`SELECT status, woc_bought::text wb, woc_settled::text ws, settle_tx_sig, settle_broadcast_at IS NOT NULL sb, executed_at IS NOT NULL ex FROM buyback_batches WHERE batch_id='b1'`);
    expect(r.rows[0]).toMatchObject({ status: 'settled', wb: '700', ws: '700', settle_tx_sig: 'settle1', sb: true, ex: true });
  });

  it('markBatchFailed truncates an overlong reason to 500 chars', async () => {
    await dbm.createBuybackBatch({ batchId: 'b1', mode: 'burn', source: 'marketplace', usdcIn: 10n, buyTxSig: 'swap1' });
    await dbm.markBatchFailed('b1', 'x'.repeat(900));
    const r = await pool.query(`SELECT status, length(fail_reason) len FROM buyback_batches WHERE batch_id='b1'`);
    expect(r.rows[0]).toMatchObject({ status: 'failed', len: 500 });
  });

  it('openBuybackBatches returns only non-terminal batches, oldest first; lastSettleAt tracks the latest settle', async () => {
    // Three batches in mixed states; settled/failed are terminal and excluded.
    await dbm.createBuybackBatch({ batchId: 'a', mode: 'burn', source: 'marketplace', usdcIn: 1n, buyTxSig: 'sa' });
    await dbm.createBuybackBatch({ batchId: 'b', mode: 'burn', source: 'marketplace', usdcIn: 1n, buyTxSig: 'sb' });
    await dbm.createBuybackBatch({ batchId: 'c', mode: 'burn', source: 'marketplace', usdcIn: 1n, buyTxSig: 'sc' });
    await dbm.markBatchSwapped('b', 5n);                 // swapped → still open
    await dbm.markBatchSettling('c', 'settleC');         // settling → still open
    await dbm.markBatchSettled('c', 5n);                 // ...then settled → terminal
    await dbm.markBatchFailed('a', 'nope');              // failed → terminal

    const open = await dbm.openBuybackBatches();
    expect(open.map((r) => r.batchId)).toEqual(['b']);   // only the swapped one remains
    const last = await dbm.lastSettleAt();
    expect(typeof last).toBe('number');
    expect(last).toBeGreaterThan(0);
  });

  it('lastSettleAt is null when nothing has settled', async () => {
    await dbm.createBuybackBatch({ batchId: 'a', mode: 'burn', source: 'marketplace', usdcIn: 1n, buyTxSig: 'sa' });
    expect(await dbm.lastSettleAt()).toBeNull();
  });

  it('withPayoutKeeperLock grants exclusive access — a second holder gets null while the first holds it', async () => {
    let acquired!: () => void;
    const acquiredP = new Promise<void>((r) => (acquired = r));
    let release!: () => void;
    const releaseP = new Promise<void>((r) => (release = r));

    const first = dbm.withPayoutKeeperLock(async () => { acquired(); await releaseP; return 'a'; });
    await acquiredP; // the first cycle now holds the advisory lock

    const second = await dbm.withPayoutKeeperLock(async () => 'b'); // tries while held
    expect(second).toBeNull(); // pg_try_advisory_lock refused — no second concurrent cycle

    release();
    expect(await first).toBe('a');

    // Lock is released afterward: a fresh cycle can acquire again.
    expect(await dbm.withPayoutKeeperLock(async () => 'c')).toBe('c');
  });
});
