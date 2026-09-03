// Pure-leaf pins for Bone Storm (src/sim/nythraxis_bone_storm.ts): the tuning
// the guide quotes, the charge windows, the hash-ranked target order, and the
// reach and radius tests.

import { describe, expect, it } from 'vitest';
import {
  beginNythraxisBoneStorm,
  NYTHRAXIS_BONE_STORM_ARRIVE_DIST,
  NYTHRAXIS_BONE_STORM_CHARGE_SECONDS,
  NYTHRAXIS_BONE_STORM_CHARGES,
  NYTHRAXIS_BONE_STORM_EVERY,
  NYTHRAXIS_BONE_STORM_FIRST_SECONDS,
  NYTHRAXIS_BONE_STORM_GRAVEBREAKER_REARM_SECONDS,
  NYTHRAXIS_BONE_STORM_RADIUS,
  NYTHRAXIS_BONE_STORM_SECONDS,
  NYTHRAXIS_BONE_STORM_SPEED_MULT,
  NYTHRAXIS_BONE_STORM_SPIKE_AT_SECONDS,
  NYTHRAXIS_BONE_STORM_WHIRL_TICK_MAX_HP,
  NYTHRAXIS_BONE_STORM_WHIRL_TICK_SECONDS,
  nythraxisBoneSlamDamageMaxHp,
  nythraxisBoneStormChargeIndex,
  nythraxisBoneStormChargeTarget,
  nythraxisBoneStormDone,
  nythraxisBoneStormReached,
  nythraxisBoneStormSpikeDue,
  pointInNythraxisBoneStorm,
} from '../src/sim/nythraxis_bone_storm';

const RAID = [11, 12, 13, 14, 15, 16].map((id) => ({ id }));

describe('Nythraxis Bone Storm', () => {
  it('pins the player-facing tuning literally on both difficulties', () => {
    expect(NYTHRAXIS_BONE_STORM_FIRST_SECONDS).toBe(8);
    expect(NYTHRAXIS_BONE_STORM_EVERY).toBe(50);
    expect(NYTHRAXIS_BONE_STORM_SECONDS).toBe(12);
    expect([NYTHRAXIS_BONE_STORM_CHARGES, NYTHRAXIS_BONE_STORM_CHARGE_SECONDS]).toEqual([4, 3]);
    // Four windows fill the storm exactly.
    expect(NYTHRAXIS_BONE_STORM_CHARGES * NYTHRAXIS_BONE_STORM_CHARGE_SECONDS).toBe(
      NYTHRAXIS_BONE_STORM_SECONDS,
    );
    expect(NYTHRAXIS_BONE_STORM_SPEED_MULT).toBe(2.2);
    expect(NYTHRAXIS_BONE_STORM_RADIUS).toBe(9);
    expect([
      NYTHRAXIS_BONE_STORM_WHIRL_TICK_SECONDS,
      NYTHRAXIS_BONE_STORM_WHIRL_TICK_MAX_HP,
    ]).toEqual([1, 0.1]);
    expect([
      nythraxisBoneSlamDamageMaxHp('normal'),
      nythraxisBoneSlamDamageMaxHp('heroic'),
    ]).toEqual([0.35, 0.55]);
    expect(NYTHRAXIS_BONE_STORM_ARRIVE_DIST).toBe(3);
    expect(NYTHRAXIS_BONE_STORM_SPIKE_AT_SECONDS).toBe(6);
    expect(NYTHRAXIS_BONE_STORM_GRAVEBREAKER_REARM_SECONDS).toBe(3);
  });

  it('opens one charge window every three seconds and ends after the fourth', () => {
    expect(nythraxisBoneStormChargeIndex(0)).toBe(0);
    expect(nythraxisBoneStormChargeIndex(2.99)).toBe(0);
    expect(nythraxisBoneStormChargeIndex(3)).toBe(1);
    expect(nythraxisBoneStormChargeIndex(8.9)).toBe(2);
    expect(nythraxisBoneStormChargeIndex(9)).toBe(3);
    // The index never runs past the last window, even on the closing tick.
    expect(nythraxisBoneStormChargeIndex(12)).toBe(3);
    expect(nythraxisBoneStormChargeIndex(-1)).toBe(0);
    expect(nythraxisBoneStormDone(11.95)).toBe(false);
    expect(nythraxisBoneStormDone(12)).toBe(true);
    expect(nythraxisBoneStormSpikeDue(5.95)).toBe(false);
    expect(nythraxisBoneStormSpikeDue(6)).toBe(true);
  });

  it('ranks charge targets by hash, deterministically, never repeating while others remain', () => {
    const first = nythraxisBoneStormChargeTarget(77, 0, RAID, []);
    expect(first).not.toBeNull();
    expect(nythraxisBoneStormChargeTarget(77, 0, RAID, [])).toBe(first);
    // The order does not depend on the input order.
    expect(nythraxisBoneStormChargeTarget(77, 0, [...RAID].reverse(), [])).toBe(first);
    // Another cast key or window shuffles the pick somewhere across the raid.
    const picks = new Set<number>();
    for (let castKey = 1; castKey < 40; castKey++) {
      picks.add(nythraxisBoneStormChargeTarget(castKey, 0, RAID, []) as number);
    }
    expect(picks.size).toBeGreaterThan(3);
    // Four windows charge four different raiders.
    const charged: number[] = [];
    for (let window = 0; window < NYTHRAXIS_BONE_STORM_CHARGES; window++) {
      const id = nythraxisBoneStormChargeTarget(77, window, RAID, charged) as number;
      expect(charged).not.toContain(id);
      charged.push(id);
    }
    expect(new Set(charged).size).toBe(4);
    // With everyone already charged, the pick falls back to the whole raid.
    const all = RAID.map((raider) => raider.id);
    expect(all).toContain(nythraxisBoneStormChargeTarget(77, 4, RAID, all));
    // Two eligible raiders, one already charged: the fresh one every time.
    expect(nythraxisBoneStormChargeTarget(5, 1, [{ id: 11 }, { id: 12 }], [11])).toBe(12);
    expect(nythraxisBoneStormChargeTarget(5, 1, [], [])).toBeNull();
  });

  it('reaches inside three yards and whirls inside nine, edges inclusive', () => {
    const boss = { x: 10, z: 10 };
    expect(nythraxisBoneStormReached(boss, { x: 13, z: 10 })).toBe(true);
    expect(nythraxisBoneStormReached(boss, { x: 13.01, z: 10 })).toBe(false);
    expect(pointInNythraxisBoneStorm(boss, { x: 10, z: 19 })).toBe(true);
    expect(pointInNythraxisBoneStorm(boss, { x: 10, z: 19.01 })).toBe(false);
  });

  it('begins a storm with the first window open and nothing spent', () => {
    expect(beginNythraxisBoneStorm(9)).toEqual({
      castKey: 9,
      elapsed: 0,
      chargeIndex: 0,
      chargeTargetId: null,
      slammed: false,
      whirlTickTimer: 1,
      spikeCast: false,
      chargedIds: [],
    });
  });
});
