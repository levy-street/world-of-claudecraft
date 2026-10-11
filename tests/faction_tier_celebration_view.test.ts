// Pure-core pins for the faction standing tier celebration: tier crossings
// over two standing maps, the silent first observation and the synced gate,
// in-place advance of the baseline, and the per-drain plan (one plate, one
// chime, motion under reduced motion).

import { describe, expect, it } from 'vitest';
import { STANDING_THRESHOLDS } from '../src/sim/factions';
import {
  advanceFactionTierObservation,
  buildFactionTierCelebrationPlan,
  computeFactionTierUps,
} from '../src/ui/hud/reputation/faction_tier_celebration_view';

const zero = { rift_watch: 0, church_order: 0, automatons: 0 };

describe('computeFactionTierUps', () => {
  it('is silent on the first observation and on a plain gain inside a tier', () => {
    expect(computeFactionTierUps(null, { ...zero, rift_watch: 5_000 })).toEqual([]);
    expect(
      computeFactionTierUps({ ...zero, rift_watch: 100 }, { ...zero, rift_watch: 900 }),
    ).toEqual([]);
  });

  it('reports each faction that crossed a tier, once, in faction order, with the tier reached', () => {
    const ups = computeFactionTierUps(
      { ...zero, rift_watch: 980, automatons: 2_990 },
      {
        rift_watch: STANDING_THRESHOLDS.recognized,
        church_order: 0,
        // A jump over two tiers reports only the tier reached.
        automatons: STANDING_THRESHOLDS.vanguard,
      },
    );
    expect(ups).toEqual([
      { factionId: 'rift_watch', fromTier: 'unknown', toTier: 'recognized' },
      { factionId: 'automatons', fromTier: 'recognized', toTier: 'vanguard' },
    ]);
  });

  it('never reports a drop (a sanitized or reset mirror is not a celebration)', () => {
    expect(
      computeFactionTierUps({ ...zero, rift_watch: 7_000 }, { ...zero, rift_watch: 0 }),
    ).toEqual([]);
  });

  it('treats a missing faction key as zero standing', () => {
    expect(computeFactionTierUps({}, { rift_watch: 1_000 })).toEqual([
      { factionId: 'rift_watch', fromTier: 'unknown', toTier: 'recognized' },
    ]);
  });
});

describe('advanceFactionTierObservation', () => {
  it('does nothing before the mirror is synced, then baselines silently', () => {
    const unsynced = advanceFactionTierObservation(false, null, { ...zero, rift_watch: 3_000 });
    expect(unsynced.tierUps).toEqual([]);
    expect(unsynced.prev).toBeNull();
    const first = advanceFactionTierObservation(true, null, { ...zero, rift_watch: 3_000 });
    expect(first.tierUps).toEqual([]);
    expect(first.prev).toEqual({ rift_watch: 3_000, church_order: 0, automatons: 0 });
  });

  it('diffs against the baseline and advances it in place', () => {
    const baseline = { ...zero, church_order: 2_990 };
    const obs = advanceFactionTierObservation(true, baseline, {
      ...zero,
      church_order: STANDING_THRESHOLDS.trusted,
    });
    expect(obs.tierUps).toEqual([
      { factionId: 'church_order', fromTier: 'recognized', toTier: 'trusted' },
    ]);
    expect(obs.prev).toBe(baseline);
    expect(baseline.church_order).toBe(STANDING_THRESHOLDS.trusted);
    // The next drain sees no change.
    expect(
      advanceFactionTierObservation(true, baseline, { ...zero, church_order: 3_000 }).tierUps,
    ).toEqual([]);
  });
});

describe('buildFactionTierCelebrationPlan', () => {
  const up = { factionId: 'rift_watch', fromTier: 'trusted', toTier: 'proven' } as const;
  const later = { factionId: 'automatons', fromTier: 'unknown', toTier: 'recognized' } as const;

  it('logs every crossing and plates the last one, chiming once', () => {
    const plan = buildFactionTierCelebrationPlan([up, later], false, false);
    expect(plan.logs).toEqual([up, later]);
    expect(plan.banner).toEqual(later);
    expect(plan.playSound).toBe(true);
    expect(plan.motion).toBe(true);
  });

  it('stands the chime down when the drain already chimed and the motion under reduced motion', () => {
    const plan = buildFactionTierCelebrationPlan([up], true, true);
    expect(plan.banner).toEqual(up);
    expect(plan.playSound).toBe(false);
    expect(plan.motion).toBe(false);
  });

  it('plans nothing for an empty drain', () => {
    const plan = buildFactionTierCelebrationPlan([], false, false);
    expect(plan).toEqual({ logs: [], banner: null, playSound: false, motion: false });
  });
});
