// The one token-firewall-allowlisted file: the offline daily-rewards readout
// stub (src/sim/daily_rewards_stub.ts). The allowlist shape pin in
// architecture.test.ts refuses control flow and value imports there; this
// pins the VALUE, whole, so a drive-by edit of the exempt file (a field
// added, retyped, or quietly flipped) fails somewhere.
import { describe, expect, it } from 'vitest';
import { dailyRewardsStub } from '../src/sim/daily_rewards_stub';
import { Sim } from '../src/sim/sim';

// Spelled out here as literals rather than derived from the module under test:
// the point is that the readout is a CONSTANT, so the expectation has to be an
// independent copy of it, field for field.
const OFFLINE_READOUT = {
  enabled: true,
  day: '1970-01-01',
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
};

describe('the offline daily-rewards stub', () => {
  it('resolves the whole constant disabled-wallet readout, field for field', async () => {
    // toStrictEqual over the WHOLE object, not a handful of fields: a new
    // field on the allowlisted file is exactly the drive-by edit this suite
    // exists to catch, and a partial pin would wave it through (strict, so a
    // field retyped to an explicit undefined fails too).
    expect(await dailyRewardsStub()).toStrictEqual(OFFLINE_READOUT);
  });

  it('answers a fresh object per call, never a shared mutable constant', async () => {
    // The stub hands its arrays and nested objects to a caller that may keep
    // them; a module-level constant would let one caller's edit rewrite every
    // later offline readout.
    const first = await dailyRewardsStub();
    const second = await dailyRewardsStub();
    expect(first).not.toBe(second);
    expect(first.tasks).not.toBe(second.tasks);
    expect(first.leaderboard).not.toBe(second.leaderboard);
    expect(first.eligibility).not.toBe(second.eligibility);
  });

  it('is what the Sim facade resolves for an offline world', async () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    expect(await sim.dailyRewards()).toStrictEqual(OFFLINE_READOUT);
  });
});
