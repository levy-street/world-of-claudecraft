// REAL-Postgres integration test for server/flow_ledger_db.ts (PgFlowLedgerDb).
// Unlike flow_ledger.test.ts (which exercises the invariant over an in-memory
// fake), this runs the ACTUAL SQL — the advisory-lock transaction, the
// SUM/FILTER aggregates, BIGINT-as-decimal-string handling, ON CONFLICT replay
// guards, FK constraints — and proves the concurrent-payout serialization against
// the real `pg_advisory_xact_lock`, not a fake mutex.
//
// CI-safe: skips entirely unless PG_TEST_URL points at a disposable Postgres.
//   PG_TEST_URL=postgres://test:test@127.0.0.1:5544/test npx vitest run tests/flow_ledger_db.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// db.ts throws at import if DATABASE_URL is unset and constructs the Pool from it,
// so wire it (to the test DB when provided, else a dummy that is never connected
// because the suite skips) BEFORE importing any server module.
const PG_TEST_URL = process.env.PG_TEST_URL;
if (PG_TEST_URL) process.env.DATABASE_URL = PG_TEST_URL;
else process.env.DATABASE_URL ??= 'postgres://skip:skip@127.0.0.1:1/skip';

const { pool, ensureSchema } = await import('../server/db');
const { PgFlowLedgerDb, activeSeasonStatus, openSeason, closeSeason } = await import('../server/flow_ledger_db');
const { FlowLedger } = await import('../server/flow_ledger');

const db = new PgFlowLedgerDb();
const ledger = new FlowLedger(db);

describe.skipIf(!PG_TEST_URL)('PgFlowLedgerDb (real Postgres)', () => {
  beforeAll(async () => { await ensureSchema(); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await pool.query('TRUNCATE woc_payouts, woc_flow_ledger, woc_reward_pools, woc_seasons RESTART IDENTITY CASCADE');
  });

  const sink = (seasonId: number, amountBase: bigint, txSig?: string) =>
    ({ seasonId, source: 'gamblefi_burn_rake' as const, amountBase, txSig });
  const emit = (seasonId: number, amountBase: bigint, txSig?: string) =>
    ({ seasonId, source: 'leaderboard_payout' as const, amountBase, txSig, recipient: 'Winner111' });

  it('ensureSeason is idempotent and a fresh season has zero headroom', async () => {
    await ledger.ensureSeason(1, 'S1');
    await ledger.ensureSeason(1, 'ignored-second-label');
    const rows = await pool.query('SELECT label, status FROM woc_seasons WHERE season_id = 1');
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].label).toBe('S1');
    expect(rows.rows[0].status).toBe('active');
    expect(await ledger.headroom(1)).toBe(0n);
  });

  it('credits sinks and emits within budget, refusing the over-budget payout — verified against the actual rows', async () => {
    await ledger.ensureSeason(1);
    await ledger.creditInflow(sink(1, 1000n, 'in-a'));
    expect(await ledger.headroom(1)).toBe(1000n);

    const a = await ledger.emit(emit(1, 600n, 'out-a'));
    expect(a.ok).toBe(true);
    expect(a.headroomBase).toBe(400n);
    const b = await ledger.emit(emit(1, 400n, 'out-b'));
    expect(b).toMatchObject({ ok: true, headroomBase: 0n });
    const c = await ledger.emit(emit(1, 1n, 'out-c'));
    expect(c).toMatchObject({ ok: false, reason: 'budget_exceeded', headroomBase: 0n });

    // Inspect the real ledger + payout rows, not just the return values.
    const ins = await pool.query(`SELECT direction, amount_base::text amt FROM woc_flow_ledger WHERE season_id=1 ORDER BY entry_id`);
    expect(ins.rows).toEqual([
      { direction: 'in', amt: '1000' },
      { direction: 'out', amt: '600' },
      { direction: 'out', amt: '400' },
    ]);
    const payouts = await pool.query(`SELECT amount_base::text amt, recipient FROM woc_payouts WHERE season_id=1 ORDER BY payout_id`);
    expect(payouts.rows).toEqual([{ amt: '600', recipient: 'Winner111' }, { amt: '400', recipient: 'Winner111' }]);
    expect(await ledger.headroom(1)).toBe(0n);
  });

  it('idempotently no-ops a replayed inflow tx (ON CONFLICT) and a replayed payout tx', async () => {
    await ledger.ensureSeason(1);
    expect((await ledger.creditInflow(sink(1, 1000n, 'dup-in'))).ok).toBe(true);
    expect((await ledger.creditInflow(sink(1, 1000n, 'dup-in'))).reason).toBe('duplicate');
    expect(await ledger.headroom(1)).toBe(1000n); // credited once

    expect((await ledger.emit(emit(1, 500n, 'dup-out'))).ok).toBe(true);
    expect((await ledger.emit(emit(1, 500n, 'dup-out'))).reason).toBe('duplicate');
    expect(await ledger.headroom(1)).toBe(500n); // paid once
    const n = await pool.query(`SELECT count(*)::int c FROM woc_payouts WHERE tx_sig='dup-out'`);
    expect(n.rows[0].c).toBe(1);
  });

  it('handles BIGINT amounts beyond Number.MAX_SAFE_INTEGER exactly', async () => {
    await ledger.ensureSeason(1);
    const huge = 9_000_000_000_000_000_000n; // > 2^53
    await ledger.creditInflow(sink(1, huge, 'big-in'));
    expect(await ledger.headroom(1)).toBe(huge);
    const r = await ledger.emit(emit(1, huge - 1n, 'big-out'));
    expect(r.ok).toBe(true);
    expect(await ledger.headroom(1)).toBe(1n);
  });

  it('serializes a real concurrent-payout stampede via pg_advisory_xact_lock — never over-emits', async () => {
    await ledger.ensureSeason(1);
    await ledger.creditInflow(sink(1, 1000n, 'in'));
    // 10 payouts of 200 fired at once against 1000 headroom: the real per-season
    // advisory lock must let through at most 5, and the total emitted must never
    // exceed the sinks. This is the load-bearing buy>sell guarantee under genuine
    // DB concurrency (each call takes its own pooled connection + session lock).
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => ledger.emit(emit(1, 200n, `race-${i}`))));
    const wins = results.filter((r) => r.ok).length;
    expect(wins).toBe(5);
    expect(results.filter((r) => !r.ok).every((r) => r.reason === 'budget_exceeded')).toBe(true);

    const headroom = await ledger.headroom(1);
    expect(headroom).toBe(1000n - BigInt(wins) * 200n);
    expect(headroom >= 0n).toBe(true);
    const paid = await pool.query(`SELECT COALESCE(SUM(amount_base),0)::text s FROM woc_flow_ledger WHERE season_id=1 AND direction='out'`);
    expect(BigInt(paid.rows[0].s)).toBeLessThanOrEqual(1000n); // emissions <= sinks, always
  });

  it('season-status asymmetry: inflows are rejected after close, but emissions (end-of-season settlement) still pay', async () => {
    await ledger.ensureSeason(1);
    await ledger.creditInflow(sink(1, 1000n, 'in'));
    await pool.query(`UPDATE woc_seasons SET status='closed', closed_at=now() WHERE season_id=1`);

    // No new sinks once collection is closed...
    const lateSink = await ledger.creditInflow(sink(1, 500n, 'late'));
    expect(lateSink.reason).toBe('season_closed');
    // ...but the closed season still settles its accrued pool (the #480/#479 case).
    const payout = await ledger.emit(emit(1, 700n, 'settle'));
    expect(payout.ok).toBe(true);
    expect(await ledger.headroom(1)).toBe(300n);
  });

  it('cannot fund an emission from a different season (per-season isolation)', async () => {
    await ledger.ensureSeason(1);
    await ledger.ensureSeason(2);
    await ledger.creditInflow(sink(1, 1000n, 's1-in'));
    const cross = await ledger.emit(emit(2, 500n, 's2-out'));
    expect(cross).toMatchObject({ ok: false, reason: 'budget_exceeded' });
  });

  // ── season status read + open/close (backs GET /api/woc/season) ──
  it('activeSeasonStatus is null when no season is open', async () => {
    expect(await activeSeasonStatus()).toBeNull();
  });

  it('openSeason activates a season (pool 0) and the status reflects real sinks/emissions', async () => {
    await openSeason({ seasonId: 5, label: 'S5', endsAt: '2099-01-01T00:00:00.000Z' });
    expect(await activeSeasonStatus()).toMatchObject({
      seasonId: 5, label: 'S5', status: 'active', endsAt: '2099-01-01T00:00:00.000Z',
      sinkBase: '0', emissionBase: '0', poolBase: '0',
    });
    await ledger.creditInflow(sink(5, 1000n, 'in-5'));
    await ledger.emit(emit(5, 400n, 'out-5'));
    expect(await activeSeasonStatus()).toMatchObject({ sinkBase: '1000', emissionBase: '400', poolBase: '600' });
  });

  it('activeSeasonStatus returns the most recently opened active season', async () => {
    await openSeason({ seasonId: 1, label: 'S1' });
    await openSeason({ seasonId: 2, label: 'S2' });
    expect((await activeSeasonStatus())?.seasonId).toBe(2);
  });

  it('closeSeason removes a season from active', async () => {
    await openSeason({ seasonId: 9, label: 'S9' });
    expect((await activeSeasonStatus())?.seasonId).toBe(9);
    await closeSeason(9);
    expect(await activeSeasonStatus()).toBeNull();
  });

  it('openSeason re-opens a closed season (ON CONFLICT) — updates label/ends_at, clears closed', async () => {
    await openSeason({ seasonId: 3, label: 'old' });
    await closeSeason(3);
    await openSeason({ seasonId: 3, label: 'new', endsAt: '2099-06-01T00:00:00.000Z' });
    expect(await activeSeasonStatus()).toMatchObject({ seasonId: 3, label: 'new', status: 'active', endsAt: '2099-06-01T00:00:00.000Z' });
  });
});
