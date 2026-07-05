// Logic tests for the Devs ledger functions. The DB driver (pool.query /
// pool.connect→client) is mocked so we exercise the REAL function logic —
// delta computation, idempotency, reserve-then-pay, stamping — and assert the
// exact SQL/params issued. Real end-to-end DB behaviour is covered separately by
// scripts/e2e-devs-character-grant.mjs (live server + Postgres).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('./realm', () => ({ REALM: 'TestRealm' }));

import { pool } from './db';
import { grantContributionXp, reserveClaim, releaseClaim } from './devs_db';
// Note: takePendingXpGrants lives in ./db (alongside the real pool) and is proven
// end-to-end against live Postgres by scripts/e2e-devs-character-grant.mjs.

// A mock pg client whose query() returns scripted results in order; records calls.
function scriptClient(results: unknown[]) {
  let i = 0;
  const query = vi.fn(async (..._args: unknown[]) => (results[i++] ?? { rows: [], rowCount: 0 }));
  return { client: { query, release: vi.fn() }, query };
}
const q = vi.mocked(pool.query);
const connect = vi.mocked(pool.connect);
beforeEach(() => { q.mockReset(); connect.mockReset(); });

describe('grantContributionXp', () => {
  it('grants nothing when the player has no character', async () => {
    q.mockResolvedValueOnce({ rows: [] } as never); // leadCharacter → none
    const delta = await grantContributionXp(1, 1000);
    expect(delta).toBe(0);
    expect(connect).not.toHaveBeenCalled(); // never opens the grant tx
  });

  it('writes the full amount as a grant on first sync, advancing the ledger', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 7, name: 'Hero', class: 'mage', level: 3, lifetime_xp: '0' }] } as never);
    const { client, query } = scriptClient([
      {}, { rows: [{ granted_xp: '0' }] }, {}, {}, {}, // BEGIN, SELECT, INSERT, UPDATE, COMMIT
    ]);
    connect.mockResolvedValueOnce(client as never);

    const delta = await grantContributionXp(1, 1250);
    expect(delta).toBe(1250);
    const insert = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO character_grants'))!;
    expect(insert[1]).toEqual([1, 7, 1250, 'devs:contribution-xp']);
    const update = query.mock.calls.find((c) => String(c[0]).includes('SET granted_xp'))!;
    expect(update[1]).toEqual([1, 1250]);
  });

  it('is idempotent: re-sync at the same total grants nothing', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 7, name: 'Hero', class: 'mage', level: 3, lifetime_xp: '0' }] } as never);
    const { client, query } = scriptClient([{}, { rows: [{ granted_xp: '1250' }] }, {}]); // BEGIN, SELECT, COMMIT
    connect.mockResolvedValueOnce(client as never);

    const delta = await grantContributionXp(1, 1250);
    expect(delta).toBe(0);
    expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT'))).toBe(false);
  });

  it('grants only the growth delta as contributions increase', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 7, name: 'Hero', class: 'mage', level: 3, lifetime_xp: '0' }] } as never);
    const { client, query } = scriptClient([{}, { rows: [{ granted_xp: '1250' }] }, {}, {}, {}]);
    connect.mockResolvedValueOnce(client as never);

    const delta = await grantContributionXp(1, 2000);
    expect(delta).toBe(750);
    const insert = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO character_grants'))!;
    expect((insert[1] as unknown[])[2]).toBe(750);
    const update = query.mock.calls.find((c) => String(c[0]).includes('SET granted_xp'))!;
    expect(update[1]).toEqual([1, 2000]);
  });
});

describe('reserveClaim (reserve-then-pay)', () => {
  it('reserves the unclaimed remainder and advances the claimed total', async () => {
    const { client, query } = scriptClient([{}, { rows: [{ claimed_base_units: '40000000' }] }, {}, {}]);
    connect.mockResolvedValueOnce(client as never);

    const { amount, priorClaimed } = await reserveClaim(9, BigInt(100_000_000));
    expect(amount).toBe(BigInt(60_000_000));
    expect(priorClaimed).toBe(BigInt(40_000_000));
    const update = query.mock.calls.find((c) => String(c[0]).includes('SET claimed_base_units'))!;
    expect(update[1]).toEqual([9, '100000000']); // advanced to the full earned total
  });

  it('reserves zero (no double-pay) when already fully claimed', async () => {
    const { client, query } = scriptClient([{}, { rows: [{ claimed_base_units: '100000000' }] }, {}]);
    connect.mockResolvedValueOnce(client as never);

    const { amount } = await reserveClaim(9, BigInt(100_000_000));
    expect(amount).toBe(BigInt(0));
    // 'SET claimed_base_units' (not 'UPDATE', which also matches SELECT … FOR UPDATE)
    expect(query.mock.calls.some((c) => String(c[0]).includes('SET claimed_base_units'))).toBe(false);
  });

  it('rolls back and rethrows if the transaction fails', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({}) // BEGIN
      .mockRejectedValueOnce(new Error('deadlock')); // SELECT FOR UPDATE
    connect.mockResolvedValueOnce({ query, release: vi.fn() } as never);
    await expect(reserveClaim(9, BigInt(5))).rejects.toThrow('deadlock');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('releaseClaim', () => {
  it('restores the claimed total to the pre-reservation value', async () => {
    q.mockResolvedValueOnce({} as never);
    await releaseClaim(9, BigInt(40_000_000));
    expect(q).toHaveBeenCalledWith(expect.stringContaining('SET claimed_base_units'), [9, '40000000']);
  });
});

