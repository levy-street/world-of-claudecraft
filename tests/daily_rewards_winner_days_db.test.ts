// PgDailyRewardDb.unannouncedWinnerDays: the announcement-narrow winners read
// (#2791). These pins are what make the narrowing non-revertible: the payouts
// query executed at the call site is the exported DAILY_REWARD_WINNER_PAYOUTS_SQL
// (whose text tests/daily_rewards_table.test.ts pins to carry no tx_signature,
// wallet, or voided_by_* column), the mapper strips a WIDE row down to exactly
// the six announced fields, and the day query's limit reaches SQL clamped. The
// FakeDailyRewardDb suites bypass this layer entirely, so this file is the only
// coverage of the real SQL shape.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    dayRows: [] as Array<Record<string, unknown>>,
    payoutRows: [] as Array<Record<string, unknown>>,
  };
  const poolQuery = vi.fn(async (sql: string, _params: unknown[] = []) => {
    const statement = String(sql);
    if (statement.includes('FROM daily_reward_days')) {
      return { rows: state.dayRows.map((row) => ({ ...row })), rowCount: state.dayRows.length };
    }
    if (statement.includes('FROM daily_reward_payouts')) {
      return {
        rows: state.payoutRows.map((row) => ({ ...row })),
        rowCount: state.payoutRows.length,
      };
    }
    return { rows: [], rowCount: 0 };
  });
  return { state, poolQuery };
});

vi.mock('../server/db', () => ({
  ELIGIBLE_ACCOUNT_SQL: 'a.banned_at IS NULL',
  pool: { query: h.poolQuery, connect: vi.fn() },
}));
vi.mock('../server/realm', () => ({
  REALM: 'test-realm',
  REALM_DIRECTORY: [{ name: 'test-realm', url: '', type: 'Normal' }],
}));

import { DAILY_REWARD_WINNER_PAYOUTS_SQL, PgDailyRewardDb } from '../server/daily_rewards_db';

/** A payout row as the DATABASE could serve it, deliberately WIDE: it still
 *  carries every legacy column so the mapper's allowlist is what narrows, not
 *  a fixture that conveniently omitted the sensitive fields. */
function widePayoutRow(rank: number): Record<string, unknown> {
  return {
    day: '2026-06-30',
    realm: 'test-realm',
    rank,
    account_id: 40 + rank,
    username: `Winner${rank}`,
    wallet_pubkey: 'Wa11etPubKey1111111111111111111111111111111',
    points: 1000 - rank,
    // NUMERIC columns arrive from pg as STRINGS (no setTypeParser override in
    // this repo), so the fixture must be string-typed for the mapper's
    // Number() conversions to be genuinely pinned.
    prize_percent: '0.2',
    prize_usd: '30',
    status: 'paid',
    tx_signature: '5'.repeat(88),
    paid_at: new Date('2026-07-01T00:05:00.000Z'),
    void_reason: 'ops-only',
    voided_by_id: 'op1',
    voided_by_username: 'Operator',
    voided_at: new Date('2026-07-01T01:00:00.000Z'),
    signed_transaction: 'signed',
  };
}

beforeEach(() => {
  h.poolQuery.mockClear();
  h.state.dayRows = [
    {
      day: '2026-06-30',
      realm: 'test-realm',
      prize_pool_usd: '150',
      finalized_at: new Date('2026-07-01T00:00:00.000Z'),
    },
  ];
  h.state.payoutRows = [widePayoutRow(1), widePayoutRow(2)];
});

describe('PgDailyRewardDb.unannouncedWinnerDays (the announcement-narrow read)', () => {
  it('executes the pinned narrow payouts SQL at the call site', async () => {
    await new PgDailyRewardDb().unannouncedWinnerDays(1);
    // Not a bare 'FROM daily_reward_payouts' match: the days query's EXISTS
    // subquery mentions that table too, so exclude the days query itself.
    const payoutCall = h.poolQuery.mock.calls.find(
      ([sql]) =>
        String(sql).includes('FROM daily_reward_payouts') &&
        !String(sql).includes('FROM daily_reward_days'),
    );
    // The RAW text run against the pool IS the exported pinned constant, so
    // the no-tx_signature/no-wallet/no-voided_by text pin covers execution.
    expect(payoutCall?.[0]).toBe(DAILY_REWARD_WINNER_PAYOUTS_SQL);
    expect(payoutCall?.[1]).toEqual(['2026-06-30', 'test-realm']);
  });

  it('maps a WIDE database row down to exactly the six announced fields', async () => {
    const days = await new PgDailyRewardDb().unannouncedWinnerDays(1);

    expect(days).toHaveLength(1);
    // Key equality at the day level too, so a day-level widening is as visible
    // as a payout-level one.
    expect(Object.keys(days[0]).sort()).toEqual([
      'day',
      'finalizedAt',
      'payouts',
      'prizePoolUsd',
      'realm',
    ]);
    expect(days[0]).toMatchObject({
      day: '2026-06-30',
      realm: 'test-realm',
      prizePoolUsd: 150,
      finalizedAt: '2026-07-01T00:00:00.000Z',
    });
    // The decisive absence pin: key EQUALITY, so a revert to the wide
    // internalPayoutRow mapper (whose extra fields are structurally
    // assignable) fails here even though it would type-check.
    expect(days[0].payouts).toHaveLength(2);
    for (const payout of days[0].payouts) {
      expect(Object.keys(payout).sort()).toEqual([
        'points',
        'prizePercent',
        'prizeUsd',
        'rank',
        'status',
        'username',
      ]);
    }
    expect(days[0].payouts[0]).toEqual({
      rank: 1,
      username: 'Winner1',
      points: 999,
      prizePercent: 0.2,
      prizeUsd: 30,
      status: 'paid',
    });
  });

  it('passes the asked day limit to SQL, clamped to [1, 10]', async () => {
    const daysParams = () =>
      h.poolQuery.mock.calls
        .filter(([sql]) => String(sql).includes('FROM daily_reward_days'))
        .map(([, params]) => params);

    const db = new PgDailyRewardDb();
    await db.unannouncedWinnerDays(1); // the winners cache's real ask (#2791)
    await db.unannouncedWinnerDays(99); // over-ask clamps to the SQL ceiling
    await db.unannouncedWinnerDays(0); // under-ask clamps to the floor
    expect(daysParams()).toEqual([
      ['test-realm', 1],
      ['test-realm', 10],
      ['test-realm', 1],
    ]);
  });
});
