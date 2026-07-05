import { beforeEach, describe, expect, it, vi } from 'vitest';

// Follow the repo's DB-test pattern (see arena_db.test.ts / wallet_server.test.ts):
// stub DATABASE_URL + mock the pg Pool so db.ts loads and every pool.query is a
// spy we control. This drives the REAL slug/referral helpers through every branch
// with no live database; only pg is mocked, never the functions under test.
const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  return { query: vi.fn() };
});
vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() { return { query: dbMock.query }; }),
}));

import { slugAvailable, primarySlugForAccount, referralCountForAccount, recordReferral } from '../server/db';

// per-test control over what the mocked DB returns, routed by SQL substring
let slugLookupRows: any[] = [];   // SELECT character_id FROM player_cards WHERE slug
let primarySlugRows: any[] = [];  // SELECT slug FROM player_cards ... ORDER BY updated_at
let referralCountRows: any[] = []; // SELECT count(*)::int AS n FROM referrals

beforeEach(() => {
  slugLookupRows = []; primarySlugRows = []; referralCountRows = [];
  dbMock.query.mockReset();
  dbMock.query.mockImplementation((sql: string) => {
    // The real queries are multi-line; collapse whitespace so routing is robust.
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.includes('SELECT character_id FROM player_cards WHERE slug')) return Promise.resolve({ rows: slugLookupRows });
    if (s.includes('SELECT slug FROM player_cards WHERE account_id')) return Promise.resolve({ rows: primarySlugRows });
    if (s.includes('count(*)::int AS n FROM referrals')) return Promise.resolve({ rows: referralCountRows });
    if (s.includes('INSERT INTO referrals')) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
});

describe('slugAvailable', () => {
  it('is true when the slug is free (no row)', async () => {
    slugLookupRows = [];
    await expect(slugAvailable('hero', 42)).resolves.toBe(true);
  });

  it('is true when the slug is already owned by the same character (own re-publish)', async () => {
    slugLookupRows = [{ character_id: 42 }];
    await expect(slugAvailable('hero', 42)).resolves.toBe(true);
  });

  it('is false when the slug is owned by a different character', async () => {
    slugLookupRows = [{ character_id: 99 }];
    await expect(slugAvailable('hero', 42)).resolves.toBe(false);
  });
});

describe('primarySlugForAccount', () => {
  it('returns the most recently updated card slug', async () => {
    primarySlugRows = [{ slug: 'x' }];
    await expect(primarySlugForAccount(7)).resolves.toBe('x');
  });

  it('returns null when the account has no published card', async () => {
    primarySlugRows = [];
    await expect(primarySlugForAccount(7)).resolves.toBeNull();
  });
});

describe('referralCountForAccount', () => {
  it('returns the counted total', async () => {
    referralCountRows = [{ n: 5 }];
    await expect(referralCountForAccount(7)).resolves.toBe(5);
  });

  it('returns 0 when the count is absent', async () => {
    referralCountRows = [{}];
    await expect(referralCountForAccount(7)).resolves.toBe(0);
  });

  it('returns 0 when no row comes back', async () => {
    referralCountRows = [];
    await expect(referralCountForAccount(7)).resolves.toBe(0);
  });
});

describe('recordReferral', () => {
  it('inserts the referral idempotently with [referee, referrer, slug]', async () => {
    await recordReferral(11, 22, 'champ');
    const insert = dbMock.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO referrals'));
    expect(insert).toBeDefined();
    // Idempotency guard: only the first referral per referee is kept (PK on referee_account_id).
    expect(String(insert?.[0]).replace(/\s+/g, ' ')).toContain('ON CONFLICT (referee_account_id) DO NOTHING');
    expect(insert?.[1]).toEqual([11, 22, 'champ']);
  });
});
