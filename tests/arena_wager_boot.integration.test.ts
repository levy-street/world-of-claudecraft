// Boot smoke test for buildArenaWagerService: the production factory was only
// tsc-checked, never executed. This runs it against a real (disposable) Postgres
// with a generated settler key + the devnet program/mint env, asserting it
// constructs the escrow + coordinator + service without throwing and that boot
// recovery is a clean no-op on an empty store. No network call is made (the web3
// Connection is lazy; recoverableLockedMatches returns []).
//
// CI-safe: skips unless PG_TEST_URL points at a disposable Postgres.
//   PG_TEST_URL=postgres://test:test@127.0.0.1:5545/test npx vitest run tests/arena_wager_boot.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

const PG_TEST_URL = process.env.PG_TEST_URL;
if (PG_TEST_URL) process.env.DATABASE_URL = PG_TEST_URL;
else process.env.DATABASE_URL ??= 'postgres://skip:skip@127.0.0.1:1/skip';
process.env.REALM_NAME ??= 'TestRealm';
// Configure the wager feature (the factory reads these at call time).
process.env.WOC_ESCROW_PROGRAM_ID = 'Fn4LMsV7akGX9KXwYv4uh2v8nM2uqgaAxhKrsYYbZqcJ';
process.env.WOC_MINT = 'E6r4tqSuQ6VuCa9jpPZMqYHAj1x9GJaKaaXWxrfFsgFx';
process.env.WOC_ARENA_SETTLER_SECRET = bs58.encode(Keypair.generate().secretKey);

const { pool, ensureSchema } = await import('../server/db');
const { openSeason, closeSeason } = await import('../server/flow_ledger_db');
const { buildArenaWagerService } = await import('../server/arena_wager_boot');

const noopBout = () => true;
const rating = () => 1500;
const noopSend = () => {};

describe.skipIf(!PG_TEST_URL)('buildArenaWagerService (real Postgres boot)', () => {
  beforeAll(async () => {
    await ensureSchema();
    await pool.query('TRUNCATE woc_wager_matches RESTART IDENTITY CASCADE');
    await pool.query('TRUNCATE woc_payouts, woc_flow_ledger, woc_reward_pools, woc_seasons RESTART IDENTITY CASCADE');
    await openSeason({ seasonId: 1, label: 'Boot Test Season' });
  });
  afterAll(async () => { await pool.end(); });

  it('returns null when the feature is not enabled', async () => {
    delete process.env.WOC_ARENA_WAGER_ENABLED;
    expect(await buildArenaWagerService(noopBout, rating, noopSend)).toBe(null);
  });

  it('throws on a half-configured setup (enabled but missing the settler secret)', async () => {
    process.env.WOC_ARENA_WAGER_ENABLED = '1';
    const saved = process.env.WOC_ARENA_SETTLER_SECRET;
    delete process.env.WOC_ARENA_SETTLER_SECRET;
    await expect(buildArenaWagerService(noopBout, rating, noopSend)).rejects.toThrow(/WOC_ESCROW_PROGRAM_ID, WOC_MINT, and WOC_ARENA_SETTLER_SECRET/);
    process.env.WOC_ARENA_SETTLER_SECRET = saved;
  });

  it('constructs the full service when enabled + a season is open, and boot recovery is a clean no-op', async () => {
    process.env.WOC_ARENA_WAGER_ENABLED = '1';
    const service = await buildArenaWagerService(noopBout, rating, noopSend);
    expect(service).not.toBe(null);
    const recovery = await service!.recoverOnBoot();
    expect(recovery).toEqual({ refunded: 0, reconciled: 0, staleCancelled: 0 });
  });

  it('still constructs (idle) when enabled with no active season', async () => {
    process.env.WOC_ARENA_WAGER_ENABLED = '1';
    await closeSeason(1);
    const service = await buildArenaWagerService(noopBout, rating, noopSend);
    expect(service).not.toBe(null); // built, but its season-active gate will refuse queues
  });
});
