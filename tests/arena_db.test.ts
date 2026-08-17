import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  return { query: vi.fn() };
});

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    // topArenaRatings runs inside runWithStatementTimeout (server/db.ts): a
    // dedicated pooled client issues BEGIN, SET LOCAL statement_timeout, the real
    // query, then COMMIT. Model connect() as a client that answers the control
    // statements itself and forwards the real query back through the pool's own
    // query, so the dbMock spy still records exactly the real read (unshifted).
    const poolObj = {
      query: dbMock.query,
      connect: async () => ({
        query: (text: string, values?: unknown[]) =>
          text === 'BEGIN' ||
          text === 'COMMIT' ||
          text === 'ROLLBACK' ||
          text.startsWith('SET LOCAL')
            ? Promise.resolve({ rows: [] })
            : poolObj.query(text, values),
        release() {},
      }),
    };
    return poolObj;
  }),
}));

import { topArenaRatings } from '../server/db';
import { REALM } from '../server/realm';

beforeEach(() => {
  dbMock.query.mockReset();
});

describe('arena leaderboard', () => {
  it('scopes the ladder to the current realm', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });

    await topArenaRatings();

    const [sql, params] = dbMock.query.mock.calls[0];
    // The ladder reads from the shared `characters` table; without a realm
    // predicate it would leak rankings from every other realm's process.
    expect(sql).toContain('WHERE realm = $1');
    expect(params[0]).toBe(REALM);
  });

  it('clamps the limit and binds it after the realm parameter', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });

    await topArenaRatings(999);

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('LIMIT $2');
    expect(params).toEqual([REALM, 100]);
  });

  it('coerces numeric rating/record fields from JSONB strings', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          name: 'Thrall',
          class: 'shaman',
          level: 60,
          rating: '1832',
          wins: '12',
          losses: '3',
          draws: '2',
        },
      ],
    });

    await expect(topArenaRatings(5)).resolves.toEqual([
      { name: 'Thrall', class: 'shaman', level: 60, rating: 1832, wins: 12, losses: 3, draws: 2 },
    ]);
  });

  it('reads the 2v2 draws from the 2v2 field, and counts it there too', () => {
    // The 2v2 arm is a separate expression from the 1v1 one, so a copy-paste of
    // arena1v1Draws into it would ship green against the default-format tests
    // above while silently zeroing every draw on the 2v2 ladder.
    return (async () => {
      dbMock.query.mockResolvedValueOnce({ rows: [] });
      await topArenaRatings(5, '2v2');
      const [sql] = dbMock.query.mock.calls[0];
      expect(sql).toContain("COALESCE((state->>'arena2v2Draws')::int, 0)");
      expect(sql, 'the 1v1 field must not leak into the 2v2 query').not.toContain('arena1v1Draws');
      expect(sql.replace(/\s+/g, ' ')).toContain(
        "COALESCE((state->>'arena2v2Wins')::int, 0) + " +
          "COALESCE((state->>'arena2v2Losses')::int, 0) + " +
          "COALESCE((state->>'arena2v2Draws')::int, 0) > 0",
      );
    })();
  });

  it('selects the draws column and counts it toward ladder eligibility', () => {
    // Pinned to the SQL TEXT, the same way the battleground ladder is: a draw
    // moves rating, so a draw-only player belongs on the ladder. Without the
    // eligibility half, someone whose whole record is draws is invisible.
    return (async () => {
      dbMock.query.mockResolvedValueOnce({ rows: [] });
      await topArenaRatings(5);
      const [sql] = dbMock.query.mock.calls[0];
      expect(sql).toContain("COALESCE((state->>'arena1v1Draws')::int, 0)");
      expect(sql).toContain('AS draws');
      // The eligibility half, pinned to the literal rather than a loose regex:
      // a draw moves rating, so a player whose whole record is draws must not be
      // invisible on the ladder. A regex over "draws" would match the SELECT
      // alias and prove nothing about the WHERE.
      expect(sql.replace(/\s+/g, ' ')).toContain(
        "COALESCE((state->>'arena1v1Wins')::int, (state->>'arenaWins')::int, 0) + " +
          "COALESCE((state->>'arena1v1Losses')::int, (state->>'arenaLosses')::int, 0) + " +
          "COALESCE((state->>'arena1v1Draws')::int, 0) > 0",
      );
    })();
  });

  it('uses legacy-compatible 1v1 state fields by default', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });

    await topArenaRatings();

    const [sql] = dbMock.query.mock.calls[0];
    expect(sql).toContain("state->>'arena1v1Rating'");
    expect(sql).toContain("state->>'arenaRating'");
    expect(sql).toContain("state->>'arena1v1Wins'");
    expect(sql).toContain("state->>'arenaWins'");
    expect(sql).not.toContain("state->>'arena2v2Rating'");
  });

  it('uses independent 2v2 state fields when requested', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });

    await topArenaRatings(20, '2v2');

    const [sql] = dbMock.query.mock.calls[0];
    expect(sql).toContain("state->>'arena2v2Rating'");
    expect(sql).toContain("state->>'arena2v2Wins'");
    expect(sql).toContain("state->>'arena2v2Losses'");
    expect(sql).not.toContain("state->>'arena1v1Rating'");
    expect(sql).not.toContain("state->>'arenaRating'");
  });
});
