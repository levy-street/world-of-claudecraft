import { describe, expect, it } from 'vitest';
import { buildPlayerCardData } from '../src/ui/hud/player_card/player_card_data';
import type { IWorld } from '../src/world_api';

function world(overrides: Record<string, unknown> = {}): IWorld {
  return {
    cfg: { playerClass: 'warrior' },
    player: {
      name: 'Ari Stone',
      color: 0x123456,
      level: 20,
      stats: { str: 12, agi: 9, sta: 14, int: 5, spi: 6, armor: 80 },
      attackPower: 42,
      critChance: 0.125,
      dodgeChance: 0.075,
      devTier: 3,
      devMergedPrs: 18,
    },
    equipment: { mainhand: null, chest: null, legs: null, feet: null },
    arenaInfo: null,
    prestigeRank: 0,
    activeTitle: null,
    realm: 'Test Realm',
    ...overrides,
  } as unknown as IWorld;
}

function build(gameWorld: IWorld, overrides: Record<string, unknown> = {}) {
  return buildPlayerCardData(gameWorld, {
    characterImage: 'data:image/png;base64,test',
    referral: null,
    standing: null,
    balance: null,
    showDevBadges: true,
    slotName: (slot) => `slot:${slot}`,
    ...overrides,
  });
}

describe('buildPlayerCardData', () => {
  it('projects only share-safe display data and applies the fallback slug', () => {
    const data = build(world());

    expect(data).toMatchObject({
      name: 'Ari Stone',
      classColor: '#123456',
      level: 20,
      realm: 'Test Realm',
      referralHandle: 'ari-stone',
      referralCount: null,
      topPercent: null,
      devTier: 3,
      devMergedPrs: 18,
    });
    expect(data.gear.map((entry) => entry.slot)).toEqual([
      'slot:mainhand',
      'slot:offhand',
      'slot:chest',
      'slot:legs',
      'slot:feet',
    ]);
  });

  it('uses authoritative referral and standing metadata without exposing low standings', () => {
    const top = build(world(), {
      referral: { count: 7, slug: 'ari' },
      standing: { rank: 2, total: 20 },
    });
    const lowerHalf = build(world(), { standing: { rank: 6, total: 10 } });

    expect(top.referralHandle).toBe('ari');
    expect(top.referralCount).toBe(7);
    expect(top.topPercent).toBe(10);
    expect(lowerHalf.topPercent).toBeNull();
  });

  it('omits disabled wallet and developer flair while preserving the selected deed title', () => {
    const data = build(world({ activeTitle: 'prog_veteran' }), {
      balance: null,
      showDevBadges: false,
    });

    expect(data.titleText).toBeTruthy();
    expect(data.balance).toBeNull();
    expect(data.devTier).toBeNull();
    expect(data.devMergedPrs).toBeNull();
  });
});
