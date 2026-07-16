import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    row: null as Record<string, unknown> | null,
    audit: [] as Array<{ sql: string; params: unknown[] }>,
    attempts: [] as Array<{
      kind: 'payout' | 'resend';
      status: 'prepared' | 'paid' | 'failed';
      operationId: unknown;
      signature: unknown;
      transaction: unknown;
    }>,
  };
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const statement = String(sql);
    if (statement.includes('FOR UPDATE OF p')) {
      return { rows: state.row ? [{ ...state.row }] : [], rowCount: state.row ? 1 : 0 };
    }
    if (statement.includes('SELECT status') && statement.includes('FOR UPDATE')) {
      return state.row
        ? { rows: [{ status: state.row.status }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (
      statement.includes('SELECT status, operation_id, tx_signature, signed_transaction') &&
      statement.includes("kind = 'resend'")
    ) {
      const attempt = [...state.attempts]
        .reverse()
        .find((item) => item.kind === 'resend' && item.operationId === params[3]);
      return attempt
        ? {
            rows: [
              {
                status: attempt.status,
                operation_id: attempt.operationId,
                tx_signature: attempt.signature,
                signed_transaction: attempt.transaction,
              },
            ],
            rowCount: 1,
          }
        : { rows: [], rowCount: 0 };
    }
    if (statement.includes('SELECT 1') && statement.includes('FROM daily_reward_payout_attempts')) {
      const matches = state.attempts.some(
        (item) =>
          item.kind === 'resend' &&
          item.status === 'paid' &&
          item.operationId === params[3] &&
          item.signature === params[4],
      );
      return { rows: matches ? [{ '?column?': 1 }] : [], rowCount: matches ? 1 : 0 };
    }
    if (statement.includes('SELECT 1') && statement.includes("status = 'paid'")) {
      const matches = state.row?.status === 'paid' && state.row.tx_signature === params[3];
      return { rows: matches ? [{ '?column?': 1 }] : [], rowCount: matches ? 1 : 0 };
    }
    if (statement.includes("SET status = 'voided'")) {
      if (!state.row || !['pending', 'failed'].includes(String(state.row.status))) {
        return { rows: [], rowCount: 0 };
      }
      state.row = {
        ...state.row,
        status: 'voided',
        void_reason: params[3],
        voided_by_id: params[4],
        voided_by_username: params[5],
        voided_at: new Date('2026-07-15T01:02:03.000Z'),
      };
      return { rows: [{ ...state.row }], rowCount: 1 };
    }
    if (statement.includes("SET status = 'pending'")) {
      if (state.row?.status !== 'voided') return { rows: [], rowCount: 0 };
      state.row = {
        ...state.row,
        status: 'pending',
        void_reason: null,
        voided_by_id: null,
        voided_by_username: null,
        voided_at: null,
      };
      return { rows: [{ ...state.row }], rowCount: 1 };
    }
    if (statement.includes('INSERT INTO daily_reward_payout_attempts')) {
      const resend = statement.includes("'resend'");
      state.attempts.push({
        kind: resend ? 'resend' : 'payout',
        status: 'prepared',
        operationId: resend ? params[3] : null,
        signature: params[resend ? 4 : 3],
        transaction: params[resend ? 5 : 4],
      });
      return { rows: [], rowCount: 1 };
    }
    if (
      statement.includes('UPDATE daily_reward_payout_attempts') &&
      statement.includes("kind = 'resend'")
    ) {
      const attempt = state.attempts.find(
        (item) =>
          item.kind === 'resend' &&
          item.status === 'prepared' &&
          item.operationId === params[3] &&
          item.signature === params[5],
      );
      if (!attempt) return { rows: [], rowCount: 0 };
      attempt.status = params[4] as 'paid' | 'failed';
      return { rows: [], rowCount: 1 };
    }
    if (statement.includes("SET status = 'processing'")) {
      if (!state.row) return { rows: [], rowCount: 0 };
      state.row = {
        ...state.row,
        status: 'processing',
        tx_signature: params[3],
        signed_transaction: params[4],
      };
      return { rows: [{ ...state.row }], rowCount: 1 };
    }
    if (statement.includes('INSERT INTO daily_reward_payout_moderation_audit')) {
      state.audit.push({ sql: statement, params });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  return {
    state,
    query,
    release,
    connect: vi.fn(async () => ({ query, release })),
    poolQuery: vi.fn(async (_sql: string, _params: unknown[] = []) => ({ rows: [], rowCount: 0 })),
  };
});

vi.mock('../server/db', () => ({
  ELIGIBLE_ACCOUNT_SQL: 'a.banned_at IS NULL',
  pool: { query: h.poolQuery, connect: h.connect },
}));
vi.mock('../server/realm', () => ({ REALM: 'test-realm' }));

import { PgDailyRewardDb } from '../server/daily_rewards_db';

function payout(status: string): Record<string, unknown> {
  return {
    day: '2026-07-14',
    realm: 'test-realm',
    rank: 1,
    account_id: 42,
    username: 'alice',
    wallet_pubkey: 'Wallet111',
    points: 500,
    prize_percent: '0.2',
    prize_usd: '30',
    status,
    tx_signature: null,
    paid_at: null,
    void_reason: null,
    voided_by_id: null,
    voided_by_username: null,
    voided_at: null,
  };
}

describe('daily reward payout moderation persistence', () => {
  beforeEach(() => {
    h.state.row = payout('pending');
    h.state.audit.length = 0;
    h.state.attempts.length = 0;
    h.query.mockClear();
    h.connect.mockClear();
    h.release.mockClear();
    h.poolQuery.mockClear();
  });

  it.each(['pending', 'failed'])(
    'atomically voids a %s payout and appends an audit row',
    async (status) => {
      h.state.row = payout(status);

      const result = await new PgDailyRewardDb().voidPayout(
        '2026-07-14',
        1,
        'Payment requires manual review',
        { id: 'operator-7', username: 'moderator' },
      );

      expect(result.outcome).toBe('updated');
      if (result.outcome === 'updated') {
        expect(result.payout).toMatchObject({
          status: 'voided',
          voidReason: 'Payment requires manual review',
          voidedById: 'operator-7',
          voidedByUsername: 'moderator',
          voidedAt: '2026-07-15T01:02:03.000Z',
        });
      }
      expect(h.state.audit).toHaveLength(1);
      expect(h.state.audit[0].params).toEqual([
        '2026-07-14',
        'test-realm',
        1,
        42,
        'void',
        status,
        'voided',
        'Payment requires manual review',
        'operator-7',
        'moderator',
      ]);
      expect(h.query.mock.calls.map(([sql]) => String(sql))).toEqual(
        expect.arrayContaining(['BEGIN', 'COMMIT']),
      );
      expect(h.release).toHaveBeenCalledOnce();
    },
  );

  it('protects paid payouts from voiding without writing audit history', async () => {
    h.state.row = payout('paid');

    const result = await new PgDailyRewardDb().voidPayout('2026-07-14', 1, 'Too late', {
      id: 'operator-7',
      username: 'moderator',
    });

    expect(result).toEqual({ outcome: 'invalid_status', status: 'paid' });
    expect(h.state.row.status).toBe('paid');
    expect(h.state.audit).toEqual([]);
  });

  it('atomically restores only voided payouts to pending and retains the void reason in audit', async () => {
    h.state.row = {
      ...payout('voided'),
      void_reason: 'Duplicate winner account',
      voided_by_id: 'operator-7',
      voided_by_username: 'moderator',
      voided_at: new Date('2026-07-15T01:02:03.000Z'),
    };

    const result = await new PgDailyRewardDb().restorePayout('2026-07-14', 1, {
      id: 'operator-8',
      username: 'reviewer',
    });

    expect(result.outcome).toBe('updated');
    if (result.outcome === 'updated') {
      expect(result.payout).toMatchObject({
        status: 'pending',
        voidReason: null,
        voidedById: null,
        voidedByUsername: null,
        voidedAt: null,
      });
    }
    expect(h.state.audit).toHaveLength(1);
    expect(h.state.audit[0].params).toEqual([
      '2026-07-14',
      'test-realm',
      1,
      42,
      'restore',
      'voided',
      'pending',
      'Duplicate winner account',
      'operator-8',
      'reviewer',
    ]);
  });

  it('keeps voided payouts out of pending work and prevents mark-payout from overwriting them', async () => {
    const db = new PgDailyRewardDb();
    await db.pendingPayouts(20);
    await db.markPayout('2026-07-14', 1, 'paid', 'signature', null);

    const pendingSql = String(h.poolQuery.mock.calls[0][0]);
    const markSql = String(
      h.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE daily_reward_payouts'))?.[0],
    );
    expect(pendingSql).toContain("p.status IN ('pending', 'failed', 'processing')");
    expect(pendingSql).toContain('p.realm = $1');
    expect(markSql).toContain("status = 'processing' AND tx_signature = $5");
    expect(markSql).not.toContain("status = 'paid' AND $4 = 'paid'");
  });

  it('optionally filters pending work by day before ordering and limiting it', async () => {
    const db = new PgDailyRewardDb();
    await db.pendingPayouts(100, '2026-07-14');

    const sql = String(h.poolQuery.mock.calls[0][0]);
    expect(sql).toContain('p.day = $2');
    expect(sql.indexOf('p.day = $2')).toBeLessThan(sql.indexOf('ORDER BY'));
    expect(h.poolQuery.mock.calls[0][1]).toEqual(['test-realm', '2026-07-14', 100]);
  });

  it('durably claims one signed transaction and makes competing workers reuse it', async () => {
    const db = new PgDailyRewardDb();
    const first = await db.claimPayout('2026-07-14', 1, 'signature-one', 'signed-one');
    const second = await db.claimPayout('2026-07-14', 1, 'signature-two', 'signed-two');

    expect(first).toMatchObject({
      outcome: 'claimed',
      payout: {
        status: 'processing',
        txSignature: 'signature-one',
        signedTransaction: 'signed-one',
      },
    });
    expect(second).toMatchObject({
      outcome: 'existing',
      payout: {
        status: 'processing',
        txSignature: 'signature-one',
        signedTransaction: 'signed-one',
      },
    });
    expect(h.state.attempts).toEqual([
      {
        kind: 'payout',
        status: 'prepared',
        operationId: null,
        signature: 'signature-one',
        transaction: 'signed-one',
      },
    ]);
  });

  it('treats completion of an already-paid authoritative signature as idempotent success', async () => {
    h.state.row = { ...payout('paid'), tx_signature: 'authoritative-signature' };

    await expect(
      new PgDailyRewardDb().markPayout('2026-07-14', 1, 'paid', 'authoritative-signature', null),
    ).resolves.toBe(true);
    expect(h.state.row).toMatchObject({
      status: 'paid',
      tx_signature: 'authoritative-signature',
    });
  });

  it('reuses one resend operation after response loss while allowing a later resend', async () => {
    h.state.row = { ...payout('paid'), tx_signature: 'original-signature' };
    const db = new PgDailyRewardDb();

    const first = await db.claimPayoutResend(
      '2026-07-14',
      1,
      'operation-one',
      'resend-signature',
      'resend-transaction',
    );
    const competing = await db.claimPayoutResend(
      '2026-07-14',
      1,
      'operation-one',
      'discarded-signature',
      'discarded-transaction',
    );
    h.poolQuery.mockImplementationOnce(async () => {
      h.state.attempts[0].status = 'paid';
      return { rows: [], rowCount: 1 };
    });
    const marked = await db.markPayoutResend(
      '2026-07-14',
      1,
      'operation-one',
      'paid',
      'resend-signature',
      null,
    );
    const recovered = await db.claimPayoutResend(
      '2026-07-14',
      1,
      'operation-one',
      'another-discarded-signature',
      'another-discarded-transaction',
    );
    const later = await db.claimPayoutResend(
      '2026-07-14',
      1,
      'operation-two',
      'later-signature',
      'later-transaction',
    );

    expect(first).toMatchObject({ outcome: 'claimed', attempt: { status: 'prepared' } });
    expect(competing).toMatchObject({
      outcome: 'existing',
      attempt: {
        status: 'prepared',
        operationId: 'operation-one',
        txSignature: 'resend-signature',
        signedTransaction: 'resend-transaction',
      },
    });
    expect(marked).toBe(true);
    expect(recovered).toMatchObject({
      outcome: 'existing',
      attempt: {
        status: 'paid',
        operationId: 'operation-one',
        txSignature: 'resend-signature',
        signedTransaction: 'resend-transaction',
      },
    });
    expect(later).toMatchObject({
      outcome: 'claimed',
      attempt: {
        status: 'prepared',
        operationId: 'operation-two',
        txSignature: 'later-signature',
      },
    });
    expect(h.state.row.tx_signature).toBe('original-signature');
  });

  it('returns a terminally failed resend operation without replacing it', async () => {
    h.state.row = { ...payout('paid'), tx_signature: 'original-signature' };
    h.state.attempts.push({
      kind: 'resend',
      status: 'failed',
      operationId: 'operation-one',
      signature: 'failed-signature',
      transaction: 'failed-transaction',
    });

    const result = await new PgDailyRewardDb().claimPayoutResend(
      '2026-07-14',
      1,
      'operation-one',
      'discarded-signature',
      'discarded-transaction',
    );

    expect(result).toMatchObject({
      outcome: 'existing',
      attempt: {
        status: 'failed',
        operationId: 'operation-one',
        txSignature: 'failed-signature',
      },
    });
    expect(h.state.attempts).toHaveLength(1);
  });

  it('scopes payout history to the active realm', async () => {
    await new PgDailyRewardDb().recentPayouts(25);
    const [sql, params] = h.poolQuery.mock.calls[0];
    expect(String(sql)).toContain('WHERE p.realm = $1');
    expect(params).toEqual(['test-realm', 25]);
  });
});
