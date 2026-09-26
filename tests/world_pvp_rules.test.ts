// Pins for the World PvP pure rules (src/sim/pvp/world_pvp_rules.ts): the
// pair verdict over the two flags and the two zone policies (a sanctuary on
// either end, a free-for-all zone under both, the mutual flag elsewhere) with
// its self and party exemptions (a guild is none), the marking rule for a hit that needed no
// flag, the gold stake (the smaller of the cap and the purse fraction), the
// equal split with the killing blow taking the remainder, the grey-level rule,
// and the per-pair diminishing-returns curve it shares with the battleground
// drip, on its hour-long window.
import { describe, expect, it } from 'vitest';
import { HONOR_REPEAT_DR } from '../src/sim/pvp';
import {
  WORLD_PVP_DR_WINDOW_SECONDS,
  WORLD_PVP_GREY_LEVEL_GAP,
  WORLD_PVP_KILL_HONOR,
  WORLD_PVP_MIN_LEVEL,
  WORLD_PVP_STAKE_CAP_COPPER,
  WORLD_PVP_STAKE_FRACTION,
  type WorldPvpZonePolicy,
  worldPvpHitMarksAttacker,
  worldPvpPairExempt,
  worldPvpPairHostile,
  worldPvpPairMultiplier,
  worldPvpSplit,
  worldPvpStake,
  worldPvpVictimIsGrey,
} from '../src/sim/pvp/world_pvp_rules';
import type { Entity } from '../src/sim/types';

const player = (id: number, extra: Partial<Entity> = {}): Entity =>
  ({ id, kind: 'player', guild: '', pvpFlag: true, level: 20, ...extra }) as Entity;

const POLICIES: WorldPvpZonePolicy[] = ['sanctuary', 'contested', 'ffa'];

/** Contested ground on both ends: the shipped mutual-flag rule. */
const contested = (a: Entity, b: Entity, inSameParty = false) =>
  worldPvpPairHostile(a, b, inSameParty, 'contested', 'contested');

describe('worldPvpPairHostile on contested ground', () => {
  it('two flagged strangers are hostile, symmetrically', () => {
    const a = player(1);
    const b = player(2);
    expect(contested(a, b)).toBe(true);
    expect(contested(b, a)).toBe(true);
  });

  it('an unflagged side on EITHER end refuses', () => {
    expect(contested(player(1, { pvpFlag: false }), player(2))).toBe(false);
    expect(contested(player(1), player(2, { pvpFlag: false }))).toBe(false);
    expect(contested(player(1, { pvpFlag: undefined }), player(2))).toBe(false);
  });

  it('never hostile to yourself', () => {
    const a = player(7);
    expect(contested(a, a)).toBe(false);
  });

  it('party or raid mates are never hostile', () => {
    expect(contested(player(1), player(2), true)).toBe(false);
  });

  it('a shared guild is no shield: guildmates, different guilds and no guild are all hostile', () => {
    expect(contested(player(1, { guild: 'Ravens' }), player(2, { guild: 'Ravens' }))).toBe(true);
    expect(contested(player(1, { guild: 'Ravens' }), player(2, { guild: 'Crows' }))).toBe(true);
    // Two guildless players share the empty string and must NOT read as one guild,
    // and neither may an undefined guild on both sides (a bare test entity).
    expect(contested(player(1, { guild: '' }), player(2, { guild: '' }))).toBe(true);
    expect(contested(player(1, { guild: undefined }), player(2, { guild: undefined }))).toBe(true);
  });
});

describe('worldPvpPairHostile on the other ground', () => {
  it('a sanctuary under EITHER player switches the world off, flags or not', () => {
    const a = player(1);
    const b = player(2);
    for (const other of POLICIES) {
      expect(worldPvpPairHostile(a, b, false, 'sanctuary', other)).toBe(false);
      expect(worldPvpPairHostile(a, b, false, other, 'sanctuary')).toBe(false);
    }
  });

  it('both in a free-for-all zone are hostile with no flag at all', () => {
    const a = player(1, { pvpFlag: false });
    const b = player(2, { pvpFlag: undefined });
    expect(worldPvpPairHostile(a, b, false, 'ffa', 'ffa')).toBe(true);
    expect(worldPvpPairHostile(b, a, false, 'ffa', 'ffa')).toBe(true);
  });

  it('one side in a free-for-all zone and the other outside it falls back to the flags', () => {
    const flaggedA = player(1);
    const flaggedB = player(2);
    const bareB = player(3, { pvpFlag: false });
    expect(worldPvpPairHostile(flaggedA, flaggedB, false, 'ffa', 'contested')).toBe(true);
    expect(worldPvpPairHostile(flaggedA, bareB, false, 'ffa', 'contested')).toBe(false);
    expect(worldPvpPairHostile(bareB, flaggedA, false, 'contested', 'ffa')).toBe(false);
  });

  it('on free-for-all ground every level is fair game (owner spec: "anyone is")', () => {
    const novice = player(1, { pvpFlag: false, level: WORLD_PVP_MIN_LEVEL - 1 });
    const veteran = player(2, { pvpFlag: false });
    const flaggedVeteran = player(3);
    const secondNovice = player(4, { pvpFlag: false, level: 1 });
    expect(worldPvpPairHostile(novice, veteran, false, 'ffa', 'ffa')).toBe(true);
    expect(worldPvpPairHostile(veteran, novice, false, 'ffa', 'ffa')).toBe(true);
    expect(worldPvpPairHostile(flaggedVeteran, novice, false, 'ffa', 'ffa')).toBe(true);
    expect(worldPvpPairHostile(novice, flaggedVeteran, false, 'ffa', 'ffa')).toBe(true);
    expect(worldPvpPairHostile(novice, secondNovice, false, 'ffa', 'ffa')).toBe(true);
    // Off free-for-all ground the flag still decides, and an under-level
    // character can never carry one, so the level gate holds there.
    expect(worldPvpPairHostile(novice, flaggedVeteran, false, 'contested', 'contested')).toBe(
      false,
    );
    expect(worldPvpPairHostile(novice, veteran, false, 'ffa', 'contested')).toBe(false);
  });

  it('the exemptions hold on free-for-all ground: self and party, never a guild', () => {
    const a = player(1, { guild: 'Ravens' });
    expect(worldPvpPairHostile(a, a, false, 'ffa', 'ffa')).toBe(false);
    expect(worldPvpPairHostile(a, player(2), true, 'ffa', 'ffa')).toBe(false);
    expect(worldPvpPairHostile(a, player(2, { guild: 'Ravens' }), false, 'ffa', 'ffa')).toBe(true);
    expect(worldPvpPairHostile(a, player(2, { guild: 'Crows' }), false, 'ffa', 'ffa')).toBe(true);
  });

  it('is symmetric over every policy pair and flag pair', () => {
    for (const za of POLICIES) {
      for (const zb of POLICIES) {
        for (const fa of [true, false]) {
          for (const fb of [true, false]) {
            const a = player(1, { pvpFlag: fa });
            const b = player(2, { pvpFlag: fb });
            expect(worldPvpPairHostile(a, b, false, za, zb)).toBe(
              worldPvpPairHostile(b, a, false, zb, za),
            );
          }
        }
      }
    }
  });
});

describe('worldPvpPairExempt', () => {
  it('names the two exemptions and nothing else (a shared guild is not one)', () => {
    expect(worldPvpPairExempt(player(1), player(1), false)).toBe(true);
    expect(worldPvpPairExempt(player(1), player(2), true)).toBe(true);
    expect(worldPvpPairExempt(player(1, { guild: 'R' }), player(2, { guild: 'R' }), false)).toBe(
      false,
    );
    expect(worldPvpPairExempt(player(1), player(2), false)).toBe(false);
    expect(worldPvpPairExempt(player(1, { pvpFlag: false }), player(2), false)).toBe(false);
  });
});

describe('worldPvpHitMarksAttacker', () => {
  it('marks only an unflagged attacker hitting an unflagged victim', () => {
    const bare = (id: number) => player(id, { pvpFlag: false });
    expect(worldPvpHitMarksAttacker(bare(1), bare(2))).toBe(true);
    // Hitting a flagged player never marks you (self-defence, defending a
    // stranger, and piling onto a flagged brawler all read as this case).
    expect(worldPvpHitMarksAttacker(bare(1), player(2))).toBe(false);
    // An attacker who already carries the flag has nothing to raise.
    expect(worldPvpHitMarksAttacker(player(1), bare(2))).toBe(false);
    expect(worldPvpHitMarksAttacker(player(1), player(2))).toBe(false);
  });
});

describe('worldPvpStake', () => {
  it('takes the purse fraction below the cap and the cap above it', () => {
    expect(WORLD_PVP_STAKE_FRACTION).toBe(0.1);
    expect(WORLD_PVP_STAKE_CAP_COPPER).toBe(50_000);
    expect(worldPvpStake(10_000)).toBe(1_000); // 1g purse -> 10s
    expect(worldPvpStake(500_000)).toBe(50_000); // 50g purse -> the 5g cap, not 5g0s+
    expect(worldPvpStake(499_990)).toBe(49_999);
  });

  it('floors to whole copper and never charges an empty or broken purse', () => {
    expect(worldPvpStake(15)).toBe(1);
    expect(worldPvpStake(9)).toBe(0);
    expect(worldPvpStake(0)).toBe(0);
    expect(worldPvpStake(-5)).toBe(0);
    expect(worldPvpStake(Number.NaN)).toBe(0);
  });
});

describe('worldPvpSplit', () => {
  it('a clean 1v1 pays the whole amount to the one contributor', () => {
    expect(worldPvpSplit(WORLD_PVP_KILL_HONOR, 1)).toEqual({ share: 10, killerBonus: 0 });
    expect(worldPvpSplit(1_000, 1)).toEqual({ share: 1_000, killerBonus: 0 });
  });

  it('splits equally and hands the integer remainder to the killing blow', () => {
    expect(worldPvpSplit(10, 3)).toEqual({ share: 3, killerBonus: 1 });
    expect(worldPvpSplit(1_000, 3)).toEqual({ share: 333, killerBonus: 1 });
    expect(worldPvpSplit(10, 4)).toEqual({ share: 2, killerBonus: 2 });
    // The parts always sum back to the whole.
    for (const n of [1, 2, 3, 5, 7]) {
      const { share, killerBonus } = worldPvpSplit(10, n);
      expect(share * n + killerBonus).toBe(10);
    }
  });

  it('pays nothing for nothing', () => {
    expect(worldPvpSplit(0, 3)).toEqual({ share: 0, killerBonus: 0 });
    expect(worldPvpSplit(10, 0)).toEqual({ share: 0, killerBonus: 0 });
  });
});

describe('worldPvpVictimIsGrey', () => {
  it('is grey only when the victim is MORE than the gap below the contributor', () => {
    expect(WORLD_PVP_GREY_LEVEL_GAP).toBe(5);
    expect(worldPvpVictimIsGrey(20, 15)).toBe(false); // exactly the gap still pays
    expect(worldPvpVictimIsGrey(20, 14)).toBe(true);
    expect(worldPvpVictimIsGrey(10, 20)).toBe(false); // punching up never greys
  });
});

describe('worldPvpPairMultiplier', () => {
  it('rides the shared HONOR_REPEAT_DR curve: 100, 50, 25, then 0 percent', () => {
    expect(HONOR_REPEAT_DR).toEqual([1, 0.5, 0.25, 0]);
    expect([0, 1, 2, 3, 9].map(worldPvpPairMultiplier)).toEqual([1, 0.5, 0.25, 0, 0]);
  });

  it('pins the hour-long window the copy and the docs quote', () => {
    expect(WORLD_PVP_DR_WINDOW_SECONDS).toBe(3_600);
  });
});
