// The offline daily-rewards readout (#1307): a constant, everything-off status
// the offline world answers with, since the real one is an account-level
// server query the deterministic sim can neither make nor model. Online play
// overrides it with the server's answer, exactly like the leaderboard stubs
// beside it on the Sim facade.
//
// It lives in its own file so the ONE place in `src/sim` that names the chain
// vocabulary at all is a constant literal with no logic behind it: this module
// is the whole allowlist of the $WOC token firewall
// (tests/architecture.test.ts), and sim.ts is scanned like every other file.

import type { DailyRewardStatus } from '../world_api';

export function dailyRewardsStub(): Promise<DailyRewardStatus> {
  const day = '1970-01-01';
  return Promise.resolve({
    enabled: true,
    day,
    resetAt: '1970-01-02T00:00:00.000Z',
    prizePoolUsd: 0,
    prizePoolSol: null,
    eligibility: {
      eligible: false,
      reason: 'no_wallet',
      banReason: null,
      walletPubkey: null,
      wocBalance: null,
      wocUsdPrice: null,
      usdValue: null,
      minUsd: 20,
    },
    score: 0,
    rank: null,
    spin: { claimed: false, points: null, outcomeKey: null, claimedAt: null },
    tasks: [],
    leaderboard: [],
    leaderboardTotal: 0,
  });
}
