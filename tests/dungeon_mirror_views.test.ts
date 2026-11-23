import { describe, expect, it } from 'vitest';
import {
  activeRaidLockouts,
  activeRiftBossDeathZones,
  riftMs,
} from '../src/net/dungeon_mirror_views';

describe('online dungeon mirror projections', () => {
  it('keeps absent and expired rift admission timers distinct', () => {
    expect(riftMs(null, 2000)).toBeNull();
    expect(riftMs(1000, 2000)).toBe(0);
    expect(riftMs(3000, 2000)).toBe(1000);
  });
  it('retains only live lockouts at the supplied epoch without changing mirror state', () => {
    const lockouts = { hollow_crypt: 1000, 'sunken_bastion:heroic': 3500 };
    expect(activeRaidLockouts(lockouts, 2000)).toEqual([
      { id: 'sunken_bastion:heroic', msRemaining: 1500 },
    ]);
    expect(lockouts).toEqual({ hollow_crypt: 1000, 'sunken_bastion:heroic': 3500 });
  });

  it('preserves active death zone geometry and their monotonic-clock countdown', () => {
    const zones = [
      { x: 4, z: 8, radius: 3, expiresAtMs: 3000, totalSecs: 5 },
      { x: 1, z: 2, radius: 1, expiresAtMs: 1000, totalSecs: 2 },
    ];
    expect(activeRiftBossDeathZones(zones, 2000)).toEqual([
      { x: 4, z: 8, radius: 3, remaining: 1, total: 5 },
    ]);
    expect(zones).toHaveLength(2);
  });
});
