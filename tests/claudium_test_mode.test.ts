import bs58 from 'bs58';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEVNET_GENESIS_HASH,
  resetTestEconomyRpcForTests,
  testEconomyEnabled,
  verifyTestEconomyDevnet,
} from '../server/claudium_test_service';
import {
  dailyRewardRuntimeConfig,
  resetDailyRewardPriceCacheForTests,
} from '../server/daily_rewards';

const VALID_TREASURY = bs58.encode(Uint8Array.from({ length: 32 }, (_, index) => index + 1));

afterEach(() => {
  resetDailyRewardPriceCacheForTests();
  resetTestEconomyRpcForTests();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('built-in Devnet economy activation', () => {
  it('requires both the explicit flag and a valid Solana treasury', () => {
    vi.stubEnv('WOC_TEST_ECONOMY', '1');
    vi.stubEnv('WOC_TEST_TREASURY', VALID_TREASURY);
    expect(testEconomyEnabled()).toBe(true);

    vi.stubEnv('WOC_TEST_TREASURY', 'not-a-solana-address');
    expect(testEconomyEnabled()).toBe(false);

    vi.stubEnv('WOC_TEST_TREASURY', VALID_TREASURY);
    vi.stubEnv('WOC_TEST_ECONOMY', '0');
    expect(testEconomyEnabled()).toBe(false);
  });

  it('unlocks the Daily Spin points and leaderboard flow without a payout service', async () => {
    vi.stubEnv('WOC_TEST_ECONOMY', '1');
    vi.stubEnv('WOC_TEST_TREASURY', VALID_TREASURY);
    vi.stubEnv('WOC_TEST_SOL_USD', '175');
    vi.stubEnv('WOC_DAILY_REWARD_SERVICE_URL', '');
    vi.stubEnv('WOC_DAILY_REWARD_SERVICE_SECRET', '');

    const config = await dailyRewardRuntimeConfig('2030-01-01', true);

    expect(config).toMatchObject({
      enabled: true,
      minUsd: 0,
      wocUsdPrice: 0.01,
      solUsdPrice: 175,
    });
  });

  it('accepts Devnet by genesis hash and caches the successful cluster check', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: DEVNET_GENESIS_HASH })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(verifyTestEconomyDevnet()).resolves.toBeUndefined();
    await expect(verifyTestEconomyDevnet()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refuses a non-Devnet Solana cluster before a test payment can be quoted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'mainnet-genesis' })),
      ),
    );

    await expect(verifyTestEconomyDevnet()).rejects.toThrow(/not Solana Devnet/i);
  });
});
