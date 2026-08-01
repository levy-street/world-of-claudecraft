import { describe, expect, it } from 'vitest';
import {
  applySpinResult,
  buildHomeModel,
  formatClaudium,
  formatResetCountdown,
  mapClaudium,
  mapSpinAction,
} from '../src/companion/home_model';
import type { CharacterSummary } from '../src/net/online';
import type { DailyRewardStatus } from '../src/world_api/daily_rewards';

function daily(
  overrides: {
    eligibility?: Partial<DailyRewardStatus['eligibility']>;
    spin?: Partial<DailyRewardStatus['spin']>;
    score?: number;
    rank?: number | null;
  } = {},
): DailyRewardStatus {
  return {
    day: '2026-08-01',
    resetAt: '2026-08-02T00:00:00.000Z',
    prizePoolUsd: 100,
    prizePoolSol: null,
    eligibility: {
      eligible: true,
      reason: 'eligible',
      walletPubkey: 'Abc',
      wocBalance: 1000,
      wocUsdPrice: 0.01,
      usdValue: 10,
      minUsd: 1,
      ...overrides.eligibility,
    },
    score: overrides.score ?? 12,
    rank: overrides.rank === undefined ? 5 : overrides.rank,
    spin: {
      claimed: false,
      points: null,
      outcomeKey: null,
      claimedAt: null,
      ...overrides.spin,
    },
    tasks: [],
    leaderboard: [],
    leaderboardTotal: 0,
  };
}

const chars: CharacterSummary[] = [
  {
    id: 1,
    name: 'Logol',
    class: 'warlock',
    level: 20,
    skin: 0,
    online: true,
    forceRename: false,
  },
  {
    id: 2,
    name: 'Jibril',
    class: 'priest',
    level: 6,
    skin: 0,
    online: false,
    forceRename: false,
  },
];

describe('mapSpinAction', () => {
  it('ready when eligible and unclaimed', () => {
    expect(mapSpinAction(daily()).kind).toBe('ready');
  });

  it('claimed when spin already taken', () => {
    const action = mapSpinAction(
      daily({ spin: { claimed: true, points: 40, outcomeKey: 'common', claimedAt: 't' } }),
    );
    expect(action).toEqual({ kind: 'claimed', points: 40, outcomeKey: 'common' });
  });

  it('disabled with eligibility reason when not eligible', () => {
    const action = mapSpinAction(
      daily({
        eligibility: {
          eligible: false,
          reason: 'no_wallet',
          walletPubkey: null,
          wocBalance: null,
          wocUsdPrice: null,
          usdValue: null,
          minUsd: 1,
        },
      }),
    );
    expect(action).toEqual({ kind: 'disabled', reason: 'no_wallet' });
  });
});

describe('buildHomeModel', () => {
  it('maps roster, claudium, and spin for a happy path', () => {
    const model = buildHomeModel({
      username: 'awidearray',
      daily: daily(),
      characters: chars,
      claudium: { available: true, balance: 120 },
    });
    expect(model.username).toBe('awidearray');
    expect(model.spin.kind).toBe('ready');
    expect(model.claudium).toBe(120);
    expect(model.roster).toHaveLength(2);
    expect(model.roster[0]?.name).toBe('Logol');
    expect(model.emptyRoster).toBe(false);
    expect(model.playUrl).toBe('/play');
  });

  it('marks empty roster', () => {
    const model = buildHomeModel({
      username: 'x',
      daily: daily(),
      characters: [],
      claudium: { available: true, balance: 0 },
    });
    expect(model.emptyRoster).toBe(true);
  });

  it('treats unavailable claudium as null', () => {
    expect(mapClaudium({ available: false, balance: 99 })).toEqual({
      claudium: null,
      claudiumAvailable: false,
    });
  });
});

describe('applySpinResult', () => {
  it('moves spin to claimed and keeps roster', () => {
    const before = buildHomeModel({
      username: 'u',
      daily: daily(),
      characters: chars,
      claudium: { available: true, balance: 10 },
    });
    const after = applySpinResult(before, {
      ...daily({
        spin: { claimed: true, points: 25, outcomeKey: 'rare', claimedAt: 'now' },
        score: 37,
      }),
      awardedPoints: 25,
      outcomeKey: 'rare',
    });
    expect(after.spin).toEqual({ kind: 'claimed', points: 25, outcomeKey: 'rare' });
    expect(after.score).toBe(37);
    expect(after.roster).toHaveLength(2);
  });
});

describe('formatters', () => {
  it('formats claudium and countdown', () => {
    expect(formatClaudium(null, false)).toBe('-');
    expect(formatClaudium(1200, true)).toMatch(/1/);
    const soon = formatResetCountdown(new Date(Date.now() + 90_000).toISOString(), Date.now());
    expect(soon === '1m' || soon === 'soon' || soon.endsWith('m')).toBe(true);
  });
});
