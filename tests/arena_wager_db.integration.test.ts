// REAL-Postgres integration test for server/arena_wager_db.ts: the durable wager
// match store + the match-id allocator. Runs the ACTUAL SQL (the shared sequence,
// the phase transitions, BIGINT-as-decimal-string round-trips, the realm-scoped
// recovery query) against a disposable Postgres, not an in-memory fake.
//
// CI-safe: skips entirely unless PG_TEST_URL points at a disposable Postgres.
//   PG_TEST_URL=postgres://test:test@127.0.0.1:5544/test npx vitest run tests/arena_wager_db.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const PG_TEST_URL = process.env.PG_TEST_URL;
if (PG_TEST_URL) process.env.DATABASE_URL = PG_TEST_URL;
else process.env.DATABASE_URL ??= 'postgres://skip:skip@127.0.0.1:1/skip';
process.env.REALM_NAME ??= 'TestRealm';

const { pool, ensureSchema } = await import('../server/db');
const wager = await import('../server/arena_wager_db');

const sampleMatch = (matchId: bigint) => ({
  matchId, creatorPid: 11, opponentPid: 22,
  creatorWallet: '3HTkBFPWnQJiEs4Q7tvdPiesmodQ2ZFWzp82Lg16dYPp',
  opponentWallet: 'ADBEVxjxgxJ4ogU2uPpGsKcfwHr2wEMw5aQo25BoAS4c',
  stakeBase: 100_000_000n, rakeBps: 500,
});

describe.skipIf(!PG_TEST_URL)('arena_wager_db (real Postgres)', () => {
  beforeAll(async () => { await ensureSchema(); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await pool.query('TRUNCATE woc_wager_matches RESTART IDENTITY CASCADE');
    await pool.query('ALTER SEQUENCE woc_wager_match_id_seq RESTART WITH 1');
  });

  it('allocates strictly increasing, unique match ids', async () => {
    const a = await wager.allocateWagerMatchId();
    const b = await wager.allocateWagerMatchId();
    const c = await wager.allocateWagerMatchId();
    expect(a).toBe(1n);
    expect(b).toBe(2n);
    expect(c).toBe(3n);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('round-trips a match row through insert + getWagerMatch (inspect every field)', async () => {
    const id = await wager.allocateWagerMatchId();
    await wager.insertWagerMatch(sampleMatch(id));
    const row = await wager.getWagerMatch(id);
    expect(row).toEqual({
      matchId: id, creatorPid: 11, opponentPid: 22,
      creatorWallet: '3HTkBFPWnQJiEs4Q7tvdPiesmodQ2ZFWzp82Lg16dYPp',
      opponentWallet: 'ADBEVxjxgxJ4ogU2uPpGsKcfwHr2wEMw5aQo25BoAS4c',
      stakeBase: 100_000_000n, rakeBps: 500,
      phase: 'awaiting_stakes', openSig: null, joinSig: null, settleSig: null,
    });
  });

  it('records each stake signature independently', async () => {
    const id = await wager.allocateWagerMatchId();
    await wager.insertWagerMatch(sampleMatch(id));
    await wager.recordWagerStake(id, 'open', 'OPEN_SIG');
    expect((await wager.getWagerMatch(id))!.openSig).toBe('OPEN_SIG');
    expect((await wager.getWagerMatch(id))!.joinSig).toBe(null);
    await wager.recordWagerStake(id, 'join', 'JOIN_SIG');
    const row = await wager.getWagerMatch(id);
    expect(row!.openSig).toBe('OPEN_SIG');
    expect(row!.joinSig).toBe('JOIN_SIG');
  });

  it('advances the phase and records the settle signature', async () => {
    const id = await wager.allocateWagerMatchId();
    await wager.insertWagerMatch(sampleMatch(id));
    await wager.setWagerPhase(id, 'in_bout');
    expect((await wager.getWagerMatch(id))!.phase).toBe('in_bout');
    await wager.setWagerPhase(id, 'settled', 'SETTLE_SIG');
    const row = await wager.getWagerMatch(id);
    expect(row!.phase).toBe('settled');
    expect(row!.settleSig).toBe('SETTLE_SIG');
  });

  it('recoverableLockedMatches returns only in_bout/settling rows (the crash-orphaned pots)', async () => {
    const ids: Record<string, bigint> = {};
    for (const phase of ['awaiting_stakes', 'in_bout', 'settling', 'settled', 'refunded', 'cancelled'] as const) {
      const id = await wager.allocateWagerMatchId();
      await wager.insertWagerMatch(sampleMatch(id));
      if (phase !== 'awaiting_stakes') await wager.setWagerPhase(id, phase);
      ids[phase] = id;
    }
    const recoverable = await wager.recoverableLockedMatches();
    expect(recoverable.map((m) => m.matchId).sort((x, y) => Number(x - y))).toEqual([ids.in_bout, ids.settling].sort((x, y) => Number(x - y)));
  });

  it('cancelStaleAwaitingMatches flips only awaiting_stakes rows and reports the count', async () => {
    const a = await wager.allocateWagerMatchId();
    const b = await wager.allocateWagerMatchId();
    await wager.insertWagerMatch(sampleMatch(a));
    await wager.insertWagerMatch(sampleMatch(b));
    await wager.setWagerPhase(b, 'in_bout');
    const n = await wager.cancelStaleAwaitingMatches();
    expect(n).toBe(1);
    expect((await wager.getWagerMatch(a))!.phase).toBe('cancelled');
    expect((await wager.getWagerMatch(b))!.phase).toBe('in_bout'); // untouched
  });
});
