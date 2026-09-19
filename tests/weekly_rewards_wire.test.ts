import { describe, expect, it } from 'vitest';
import { decodeWeeklyRewardInfo } from '../src/net/weekly_rewards_wire';
import { emptyWeeklyRewards } from '../src/sim/weekly_rewards';
import { bareClient } from './helpers/bare_client';

describe('weekly reward wire', () => {
  it('preserves concealed slots and opening status without accepting unopened item details', () => {
    const state = emptyWeeklyRewards(604800000);
    state.vaults = [
      {
        resetAtMs: 1000,
        choices: [
          { pool: 'raid' },
          { pool: 'dungeon', opening: true },
          { pool: 'raid', itemId: 'orb_of_the_last_spring' },
          { pool: 'raid', itemId: 'orb_of_the_last_spring', opened: true },
        ],
      },
    ];
    const info = decodeWeeklyRewardInfo({
      state,
      nowMs: 2000,
      canClaim: true,
      worldQuestsAvailable: false,
      readyWeeks: 1,
    })!;
    expect(info.state.vaults[0].choices).toEqual([
      { pool: 'raid' },
      { pool: 'dungeon', opening: true },
      { pool: 'raid' },
      { pool: 'raid', itemId: 'orb_of_the_last_spring', opened: true },
    ]);
  });
  it('round-trips the bounded ledger and rejects malformed envelopes', () => {
    const info = {
      state: emptyWeeklyRewards(604800000),
      nowMs: 1000,
      canClaim: true,
      worldQuestsAvailable: false,
      readyWeeks: 0,
    };
    expect(decodeWeeklyRewardInfo(JSON.parse(JSON.stringify(info)))).toEqual(info);
    expect(decodeWeeklyRewardInfo({ ...info, nowMs: NaN })).toBeNull();
    expect(decodeWeeklyRewardInfo({ ...info, canClaim: 'yes' })).toBeNull();
    expect(decodeWeeklyRewardInfo(null)).toBeNull();
  });
  it('preserves a delta-omitted ledger and clears it when the keeper gate closes', () => {
    const client = bareClient(1);
    const info = {
      state: emptyWeeklyRewards(604800000),
      nowMs: 1000,
      canClaim: true,
      worldQuestsAvailable: false,
      readyWeeks: 0,
    };
    const apply = (extra: object) =>
      (client as any).applySnapshot({
        t: 'snap',
        tick: 1,
        ents: [],
        self: {
          id: 1,
          k: 'player',
          tid: 'mage',
          nm: 'Collector',
          lv: 20,
          x: 0,
          y: 0,
          z: 0,
          f: 0,
          hp: 100,
          mhp: 100,
          ...extra,
        },
      });
    apply({ weeklyRewards: info });
    expect(client.weeklyRewardInfo).toEqual(info);
    apply({});
    expect(client.weeklyRewardInfo).toEqual(info);
    apply({ weeklyRewards: null });
    expect(client.weeklyRewardInfo).toBeNull();
  });
});
