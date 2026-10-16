// Wildheart Basin against the owner's heroic health bands (2026-10-12: heroic
// non-final bosses about 25,000, minibosses 15,000 to 20,000). Nothing in the
// Basin changes: the Great Saurian, its miniboss, already sits at the band's
// floor, and the owner left the Beastmaster, the Gorgebloom and Zulgar as they
// are. Read from live spawns so a later retune has to move this pin on purpose.

import { describe, expect, it, vi } from 'vitest';
import { HEROIC_MINIBOSS_BAND, livePools, NORMAL_MINIBOSS_SHARE } from './helpers/dungeon_pools';

vi.setConfig({ testTimeout: 300_000 });

describe('Wildheart Basin heroic pools, unchanged by the bands', () => {
  const heroic = livePools('wildheart_basin', 'heroic');
  const normal = livePools('wildheart_basin', 'normal');

  it('leaves the Great Saurian at its exact pool, two under the miniboss floor', () => {
    // 14,998: two points UNDER the band's 15,000 floor. The owner's call was
    // "Wildheart unchanged", so the pool is pinned as it is, not nudged in.
    expect(heroic.great_saurian.hp).toBe(14998);
    expect(HEROIC_MINIBOSS_BAND.min - heroic.great_saurian.hp).toBe(2);
  });

  it('leaves the three bosses and every normal pool where they were', () => {
    expect(heroic.wildheart_beastmaster.hp).toBe(23005);
    expect(heroic.fanglord_jaguar.hp).toBe(23011);
    expect(heroic.the_gorgebloom.hp).toBe(23003);
    expect(heroic.wildheart_high_priest.hp).toBe(36818);
    expect(normal.great_saurian.hp).toBe(10002);
    expect(normal.wildheart_beastmaster.hp).toBe(15000);
    expect(normal.fanglord_jaguar.hp).toBe(15013);
    expect(normal.the_gorgebloom.hp).toBe(15000);
    expect(normal.wildheart_high_priest.hp).toBe(24808);
  });

  it('keeps the normal Great Saurian at three quarters of the weakest normal boss or less', () => {
    const weakest = Math.min(
      normal.wildheart_beastmaster.hp,
      normal.fanglord_jaguar.hp,
      normal.the_gorgebloom.hp,
      normal.wildheart_high_priest.hp,
    );
    expect(weakest).toBe(15000);
    expect(normal.great_saurian.hp).toBeLessThanOrEqual(weakest * NORMAL_MINIBOSS_SHARE);
  });
});
