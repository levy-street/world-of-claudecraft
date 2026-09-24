// The pure plans behind the Buried Hoard boss dressing
// (src/render/hoard_boss_dressing_core.ts): deterministic shapes, crystals that
// grow through the warning and stand through the hazard, arcs that stay inside
// their field, and a Storm Surge look that scales with the stacks.
import { describe, expect, it } from 'vitest';
import {
  HOARD_ICE_SHARD_COUNT,
  HOARD_STORM_ARC_POINTS,
  HOARD_SURGE_BOLT_COUNT,
  hoardHash,
  hoardIceGrowth,
  hoardIceShards,
  hoardStormArc,
  hoardSurgeBolt,
  hoardSurgePlan,
} from '../src/render/hoard_boss_dressing_core';

describe('hoard dressing hash', () => {
  it('is deterministic and stays inside [0, 1)', () => {
    for (let a = 0; a < 40; a++) {
      const value = hoardHash(a, a * 7, a * 13);
      expect(value).toBe(hoardHash(a, a * 7, a * 13));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(hoardHash(1, 2, 3)).not.toBe(hoardHash(3, 2, 1));
  });
});

describe('Treacherous Ice crystals', () => {
  it('crowns the patch rim with a fixed, per-cue set of leaning spires', () => {
    const shards = hoardIceShards(12);
    expect(shards).toHaveLength(HOARD_ICE_SHARD_COUNT);
    expect(hoardIceShards(12)).toEqual(shards);
    expect(hoardIceShards(13)).not.toEqual(shards);
    for (const shard of shards) {
      // On the rim, never in the middle where the player stands to read it.
      expect(shard.radiusFraction).toBeGreaterThanOrEqual(0.78);
      expect(shard.radiusFraction).toBeLessThanOrEqual(0.98);
      expect(shard.height).toBeGreaterThan(0.7);
      expect(shard.lean).toBeGreaterThan(0);
    }
    expect(Math.max(...shards.map((shard) => shard.height))).toBeGreaterThan(2.6);
    // Thick enough to read as ice at gameplay camera distance, never needles.
    expect(Math.min(...shards.map((shard) => shard.girth))).toBeGreaterThanOrEqual(0.6);
  });

  it('heaves up through the warning, stands through the hazard and sinks at the end', () => {
    expect(hoardIceGrowth('warning', 1.6, 1.6)).toBeCloseTo(0);
    const mid = hoardIceGrowth('warning', 0.8, 1.6);
    const late = hoardIceGrowth('warning', 0.1, 1.6);
    expect(mid).toBeGreaterThan(0.2);
    expect(late).toBeGreaterThan(mid);
    expect(late).toBeLessThanOrEqual(0.85);
    expect(hoardIceGrowth('hazard', 3, 5)).toBeCloseTo(1);
    expect(hoardIceGrowth('hazard', 0.3, 5)).toBeLessThan(0.7);
    expect(hoardIceGrowth('hazard', 0, 5)).toBeLessThan(0.2);
  });
});

describe('charged ground arcs', () => {
  it('keeps every arc point inside the field and re-rolls per bucket', () => {
    for (let arc = 0; arc < 12; arc++) {
      const points = hoardStormArc(5, arc, 100);
      expect(points).toHaveLength(HOARD_STORM_ARC_POINTS * 2);
      for (let index = 0; index < points.length; index += 2) {
        expect(Math.hypot(points[index], points[index + 1])).toBeLessThanOrEqual(1.2);
      }
      expect(hoardStormArc(5, arc, 100)).toEqual(points);
      expect(hoardStormArc(5, arc, 101)).not.toEqual(points);
    }
  });
});

describe('Storm Surge look', () => {
  it('shows nothing at zero stacks and grows with every stack up to the cap', () => {
    expect(hoardSurgePlan(0, 8, 1)).toMatchObject({ intensity: 0, bolts: 0, shellOpacity: 0 });
    const one = hoardSurgePlan(1, 8, 1);
    const full = hoardSurgePlan(8, 8, 1);
    expect(one.bolts).toBeGreaterThanOrEqual(2);
    expect(full.bolts).toBe(HOARD_SURGE_BOLT_COUNT);
    expect(full.intensity).toBe(1);
    expect(full.shellScale).toBeGreaterThan(one.shellScale);
    expect(full.ringSpin).toBeGreaterThan(one.ringSpin);
    expect(hoardSurgePlan(20, 8, 1).intensity).toBe(1);
  });

  it('holds still under reduced motion: no flutter, no spin', () => {
    const calmA = hoardSurgePlan(6, 8, 0.13, true);
    const calmB = hoardSurgePlan(6, 8, 0.91, true);
    expect(calmA.ringSpin).toBe(0);
    expect(calmA.shellOpacity).toBe(calmB.shellOpacity);
    expect(calmA.bolts).toBe(hoardSurgePlan(6, 8, 0.13).bolts);
  });

  it('fills a caller-owned scratch instead of allocating per re-roll', () => {
    const scratch: number[] = [];
    expect(hoardSurgeBolt(3, 50, 9, scratch)).toBe(scratch);
    expect(scratch).toEqual(hoardSurgeBolt(3, 50, 9));
    expect(hoardStormArc(5, 2, 100, scratch)).toBe(scratch);
    expect(scratch).toEqual(hoardStormArc(5, 2, 100));
  });

  it('climbs each bolt from the ground to the top of the boss', () => {
    const bolt = hoardSurgeBolt(3, 50, 9);
    expect(bolt).toHaveLength(27);
    expect(bolt[1]).toBe(0);
    expect(bolt[bolt.length - 2]).toBe(1);
    for (let index = 1; index < bolt.length - 3; index += 3) {
      expect(bolt[index + 3]).toBeGreaterThan(bolt[index]);
    }
  });
});
