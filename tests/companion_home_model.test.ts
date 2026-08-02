import { describe, expect, it } from 'vitest';
import {
  applySpinResult,
  buildHomeModel,
  formatClaudium,
  formatPrizeUsd,
  formatResetCountdown,
  mapClaudium,
  mapDeedsStanding,
  mapHistory,
  mapRoster,
  mapSpinAction,
  mergeRosterCards,
  realmsToFetch,
} from '../src/companion/home_model';
import type { CharacterSummary, RealmDirectory } from '../src/net/online';
import type { DailyRewardHistory, DailyRewardStatus } from '../src/world_api/daily_rewards';

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
    expect(model.deeds.kind).toBe('unavailable');
    expect(model.history).toEqual([]);
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

  it('flags multi-realm when roster spans realms', () => {
    const model = buildHomeModel({
      username: 'u',
      daily: daily(),
      roster: [...mapRoster(chars.slice(0, 1), 'Alpha'), ...mapRoster(chars.slice(1), 'Beta')],
      claudium: { available: true, balance: 1 },
      deeds: {
        leaders: [],
        page: 0,
        pageCount: 1,
        total: 10,
        pageSize: 50,
        self: { rank: 3, topPercent: 12, renown: 440 },
      },
      history: {
        payouts: [
          {
            day: '2026-07-30',
            rank: 2,
            name: 'u',
            points: 50,
            prizePercent: 10,
            prizeUsd: 5,
            status: 'paid',
            txSignature: 'sig1',
            paidAt: '2026-07-31T01:00:00.000Z',
          },
        ],
      },
    });
    expect(model.multiRealm).toBe(true);
    expect(model.deeds).toEqual({
      kind: 'rank',
      rank: 3,
      topPercent: 12,
      renown: 440,
    });
    expect(model.history).toHaveLength(1);
    expect(model.history[0]?.txSignature).toBe('sig1');
  });
});

describe('applySpinResult', () => {
  it('moves spin to claimed and keeps roster, deeds, history', () => {
    const before = buildHomeModel({
      username: 'u',
      daily: daily(),
      roster: mapRoster(chars, 'Home'),
      claudium: { available: true, balance: 10 },
      deeds: {
        leaders: [],
        page: 0,
        pageCount: 1,
        total: 1,
        pageSize: 50,
        self: { rank: 9, topPercent: 40 },
      },
      history: {
        payouts: [
          {
            day: '2026-07-01',
            rank: 1,
            name: 'u',
            points: 10,
            prizePercent: 1,
            prizeUsd: 1,
            status: 'paid',
            txSignature: null,
            paidAt: null,
          },
        ],
      },
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
    expect(after.roster[0]?.realm).toBe('Home');
    expect(after.deeds).toEqual(before.deeds);
    expect(after.history).toEqual(before.history);
  });
});

describe('realmsToFetch + mergeRosterCards', () => {
  it('prefers realms with character counts', () => {
    const dir: RealmDirectory = {
      current: 'A',
      realms: [
        { name: 'A', url: 'https://a.example', type: 'Normal' },
        { name: 'B', url: 'https://b.example', type: 'PvP' },
        { name: 'C', url: 'https://c.example', type: 'Normal' },
      ],
      characters: { A: 2, B: 0, C: 1 },
    };
    const targets = realmsToFetch(dir);
    expect(targets.map((r) => r.name)).toEqual(['A', 'C']);
  });

  it('falls back to all realms when counts are empty', () => {
    const dir: RealmDirectory = {
      current: 'A',
      realms: [
        { name: 'A', url: 'https://a.example', type: 'Normal' },
        { name: 'B', url: 'https://b.example', type: 'Normal' },
      ],
      characters: {},
    };
    expect(realmsToFetch(dir)).toHaveLength(2);
  });

  it('synthesizes a home realm when directory is empty', () => {
    const targets = realmsToFetch({ current: '', realms: [], characters: {} }, '');
    expect(targets).toHaveLength(1);
    expect(targets[0]?.name).toBe('Home');
  });

  it('merges, de-dupes, and sorts online first', () => {
    const offline = chars.find((c) => c.name === 'Jibril');
    const online = chars.find((c) => c.name === 'Logol');
    expect(offline && online).toBeTruthy();
    if (!offline || !online) return;
    const merged = mergeRosterCards([
      ...mapRoster([offline], 'Beta'),
      ...mapRoster([online], 'Alpha'),
      ...mapRoster([online], 'Alpha'),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.name).toBe('Logol');
    expect(merged[0]?.online).toBe(true);
  });
});

describe('mapDeedsStanding + mapHistory', () => {
  it('maps unranked and rank with renown', () => {
    expect(mapDeedsStanding(null).kind).toBe('unavailable');
    expect(
      mapDeedsStanding({ leaders: [], page: 0, pageCount: 1, total: 0, pageSize: 50 }).kind,
    ).toBe('unranked');
    expect(
      mapDeedsStanding({
        leaders: [],
        page: 0,
        pageCount: 1,
        total: 5,
        pageSize: 50,
        self: { rank: 2, topPercent: 20, renown: 99 },
      }),
    ).toEqual({ kind: 'rank', rank: 2, topPercent: 20, renown: 99 });
  });

  it('sorts history by day descending and caps limit', () => {
    const history: DailyRewardHistory = {
      payouts: [
        {
          day: '2026-07-01',
          rank: 5,
          name: 'u',
          points: 1,
          prizePercent: 0,
          prizeUsd: 0,
          status: 'paid',
          txSignature: null,
          paidAt: null,
        },
        {
          day: '2026-07-10',
          rank: 1,
          name: 'u',
          points: 40,
          prizePercent: 5,
          prizeUsd: 2.5,
          status: 'pending',
          txSignature: 'x',
          paidAt: null,
        },
      ],
    };
    const rows = mapHistory(history, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.day).toBe('2026-07-10');
  });
});

describe('formatters', () => {
  it('formats claudium, countdown, and prize', () => {
    expect(formatClaudium(null, false)).toBe('-');
    expect(formatClaudium(1200, true)).toMatch(/1/);
    const soon = formatResetCountdown(new Date(Date.now() + 90_000).toISOString(), Date.now());
    expect(soon === '1m' || soon === 'soon' || soon.endsWith('m')).toBe(true);
    expect(formatPrizeUsd(0)).toBe('-');
    expect(formatPrizeUsd(12.5)).toMatch(/12/);
  });
});
