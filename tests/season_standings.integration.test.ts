// REAL-Postgres integration test for the reward-standings composition behind
// GET /api/woc/season: seed real characters with arena ratings + an open season
// with a funded pool, then run the SAME pipeline the route runs (topArenaRatings
// against real PG → projectSeasonRewards) and assert the projected per-player
// rewards. topArenaRatings is otherwise only mock-tested (arena_db.test.ts), so
// this exercises the realm-scoped JSONB rating sort + the played-filter for real.
//
// CI-safe: skips unless PG_TEST_URL points at a disposable Postgres. These
// real-PG integration files share one database (they TRUNCATE global tables), so
// run them individually or with `--no-file-parallelism` when running several.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const PG_TEST_URL = process.env.PG_TEST_URL;
if (PG_TEST_URL) process.env.DATABASE_URL = PG_TEST_URL;
else process.env.DATABASE_URL ??= 'postgres://skip:skip@127.0.0.1:1/skip';

const { pool, ensureSchema, topArenaRatings } = await import('../server/db');
const { REALM } = await import('../server/realm');
const { activeSeasonStatus, openSeason } = await import('../server/flow_ledger_db');
const { projectSeasonRewards, DEFAULT_REWARD_TIER_BPS } = await import('../server/reward_tiers');

describe.skipIf(!PG_TEST_URL)('season reward standings (real Postgres)', () => {
  beforeAll(async () => { await ensureSchema(); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await pool.query('TRUNCATE woc_payouts, woc_flow_ledger, woc_reward_pools, woc_seasons RESTART IDENTITY CASCADE');
    await pool.query('TRUNCATE characters, accounts RESTART IDENTITY CASCADE');
  });

  async function seedPlayer(name: string, rating: number, wins: number): Promise<void> {
    const acct = await pool.query(`INSERT INTO accounts(username, password_hash) VALUES ($1, 'x') RETURNING id`, [`acct_${name}`]);
    await pool.query(
      `INSERT INTO characters(account_id, name, class, realm, level, state)
       VALUES ($1, $2, 'warrior', $3, 20, $4::jsonb)`,
      [acct.rows[0].id, name, REALM, JSON.stringify({ arena1v1Rating: rating, arena1v1Wins: wins, arena1v1Losses: 1 })],
    );
  }

  it('ranks the realm arena ladder and splits the real pool into projected rewards', async () => {
    await seedPlayer('Ada', 1900, 10);
    await seedPlayer('Bo', 1800, 5);
    await seedPlayer('Cy', 1700, 1);
    await openSeason({ seasonId: 1, label: 'S1' });
    // 1000 $WOC pool (sinks − emissions): 900 rake in, 0 out.
    await pool.query(`INSERT INTO woc_flow_ledger(season_id,source,direction,amount_base,tx_sig) VALUES (1,'gamblefi_burn_rake','in','1000000000','seed')`);

    const season = await activeSeasonStatus();
    expect(season?.poolBase).toBe('1000000000');

    const ladder = await topArenaRatings(DEFAULT_REWARD_TIER_BPS.length, '1v1');
    expect(ladder.map((r) => r.name)).toEqual(['Ada', 'Bo', 'Cy']); // realm-scoped, rating DESC

    const standings = projectSeasonRewards(BigInt(season!.poolBase), ladder.map((r) => ({ name: r.name, rating: r.rating })));
    expect(standings).toEqual([
      { rank: 1, name: 'Ada', rating: 1900, rewardBase: 300_000_000n }, // 30%
      { rank: 2, name: 'Bo', rating: 1800, rewardBase: 200_000_000n },  // 20%
      { rank: 3, name: 'Cy', rating: 1700, rewardBase: 120_000_000n },  // 12%
    ]);
  });

  it('excludes characters who have not played any arena matches', async () => {
    await seedPlayer('Played', 1500, 3);
    // wins+losses must be > 0 to appear; seed one with zero record via direct state.
    const acct = await pool.query(`INSERT INTO accounts(username, password_hash) VALUES ('idle', 'x') RETURNING id`);
    await pool.query(
      `INSERT INTO characters(account_id, name, class, realm, level, state) VALUES ($1,'Idle','warrior',$2,20,$3::jsonb)`,
      [acct.rows[0].id, REALM, JSON.stringify({ arena1v1Rating: 3000, arena1v1Wins: 0, arena1v1Losses: 0 })],
    );
    const ladder = await topArenaRatings(10, '1v1');
    expect(ladder.map((r) => r.name)).toEqual(['Played']); // 'Idle' (3000, 0-0) is filtered out
  });

  it('yields no standings when the realm ladder is empty', async () => {
    await openSeason({ seasonId: 1, label: 'S1' });
    await pool.query(`INSERT INTO woc_flow_ledger(season_id,source,direction,amount_base,tx_sig) VALUES (1,'gamblefi_burn_rake','in','500000000','x')`);
    const ladder = await topArenaRatings(10, '1v1');
    expect(projectSeasonRewards(500_000_000n, ladder.map((r) => ({ name: r.name, rating: r.rating })))).toEqual([]);
  });
});
