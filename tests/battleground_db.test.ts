// The Gravemarch all-time leaderboard query (server/db.ts
// topBattlegroundRatings), cloned from tests/arena_db.test.ts: realm scoping,
// LIMIT clamping, and JSONB string coercion of the bg state fields.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  return { query: vi.fn() };
});

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: dbMock.query };
  }),
}));

import { topBattlegroundRatings } from '../server/db';
import { REALM } from '../server/realm';

beforeEach(() => {
  dbMock.query.mockReset();
});

describe('battleground leaderboard', () => {
  it('scopes the ladder to the current realm', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });

    await topBattlegroundRatings();

    const [sql, params] = dbMock.query.mock.calls[0];
    // The ladder reads from the shared `characters` table; without a realm
    // predicate it would leak rankings from every other realm's process.
    expect(sql).toContain('WHERE realm = $1');
    expect(params[0]).toBe(REALM);
  });

  it('clamps the limit and binds it after the realm parameter', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });

    await topBattlegroundRatings(999);

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('LIMIT $2');
    expect(params).toEqual([REALM, 100]);
  });

  it('coerces numeric rating/record fields from JSONB strings', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        { name: 'Mazrim', class: 'paladin', level: 20, rating: '1516', wins: '4', losses: '1' },
      ],
    });

    await expect(topBattlegroundRatings(5)).resolves.toEqual([
      { name: 'Mazrim', class: 'paladin', level: 20, rating: 1516, wins: 4, losses: 1 },
    ]);
  });

  it('reads the bg state fields with the 1500 default and rated-players-only filter', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });

    await topBattlegroundRatings();

    const [sql] = dbMock.query.mock.calls[0];
    expect(sql).toContain("COALESCE((state->>'bgRating')::int, 1500)");
    expect(sql).toContain("state->>'bgWins'");
    expect(sql).toContain("state->>'bgLosses'");
    // rated players only: no 0-0 records on the all-time board
    expect(sql).toMatch(/bgWins'\)::int, 0\) \+ COALESCE\(\(state->>'bgLosses'\)::int, 0\) > 0/);
    // and no arena fields bleed in
    expect(sql).not.toContain('arena');
  });
});
