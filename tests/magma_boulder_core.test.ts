import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BOULDER_FULL_QUALITY,
  BOULDER_START_SCALE,
  boulderScale,
  CRACK_GAP_END,
  CRACK_GAP_START,
  CRAG_AMP,
  crackGap,
  FIRE_RING_S,
  FLIGHT_LAVA_RADIUS,
  flightLavaLight,
  flightLightScale,
  flightProgress,
  IMPACT_LAVA_RADIUS,
  IMPACT_RING_GAIN,
  impactLavaLight,
  impactLightGain,
  LAVA_LIGHT_COLOR,
  LAVA_POOL_INTENSITY,
  LAVA_REACH_PER_RADIUS,
  type LavaLight,
  magmaBurstPlan,
  PLATE_SEEDS,
  RING_LAVA_GAIN,
  RING_WAVES,
  ringWaveAt,
  splitIntoPlates,
  vertexHash,
} from '../src/render/ability_vfx/magma_boulder_core';

describe('the growing boulder: one flight progress drives size, cracks and light', () => {
  it('flight progress runs 0 at launch to 1 at arrival, clamped; a degenerate launch is arrived', () => {
    expect(flightProgress(14, 14)).toBe(0);
    expect(flightProgress(14, 7)).toBeCloseTo(0.5);
    expect(flightProgress(14, 0)).toBe(1);
    expect(flightProgress(14, 20)).toBe(0);
    expect(flightProgress(0, 3)).toBe(1);
  });

  it('a pebble at the hand swells into a boulder by arrival', () => {
    expect(boulderScale(0)).toBeCloseTo(BOULDER_START_SCALE);
    expect(boulderScale(1)).toBe(1);
    expect(1 / BOULDER_START_SCALE).toBeGreaterThanOrEqual(3);
    let prev = 0;
    for (let p = 0; p <= 1.0001; p += 0.1) {
      expect(boulderScale(p)).toBeGreaterThan(prev);
      prev = boulderScale(p);
    }
    expect(boulderScale(9)).toBe(1);
  });

  it('the cracks open and widen as it grows, and the light grows with it', () => {
    expect(crackGap(0)).toBeCloseTo(CRACK_GAP_START);
    expect(crackGap(1)).toBeCloseTo(CRACK_GAP_END);
    expect(CRACK_GAP_END).toBeGreaterThan(CRACK_GAP_START * 4);
    expect(flightLightScale(1)).toBeGreaterThan(flightLightScale(0) * 2);
  });
});

describe('the crust plate split', () => {
  const sphere = new THREE.IcosahedronGeometry(1, 2).toNonIndexed();
  const positions = sphere.attributes.position.array as Float32Array;
  const plates = splitIntoPlates(positions);

  it('gives one plate per icosahedron seed and keeps every triangle', () => {
    expect(PLATE_SEEDS.length).toBe(12);
    expect(plates.length).toBe(12);
    const total = plates.reduce((n, p) => n + p.positions.length, 0);
    expect(total).toBe(positions.length);
    for (const p of plates) expect(p.positions.length % 9).toBe(0);
  });

  it('every plate faces its own seed (its triangles sit on that side of the rock)', () => {
    for (const p of plates) {
      const d = PLATE_SEEDS[p.seed];
      for (let i = 0; i < p.positions.length; i += 3) {
        const dot = p.positions[i] * d[0] + p.positions[i + 1] * d[1] + p.positions[i + 2] * d[2];
        expect(dot).toBeGreaterThan(0);
      }
    }
  });

  it('is craggy within its amplitude, and a vertex shared by two plates stays shared', () => {
    let min = 9;
    let max = 0;
    for (const p of plates) {
      for (let i = 0; i < p.positions.length; i += 3) {
        const r = Math.hypot(p.positions[i], p.positions[i + 1], p.positions[i + 2]);
        min = Math.min(min, r);
        max = Math.max(max, r);
      }
    }
    expect(min).toBeGreaterThanOrEqual(1 - CRAG_AMP - 1e-5);
    expect(max).toBeLessThanOrEqual(1 + CRAG_AMP + 1e-5);
    expect(max - min).toBeGreaterThan(CRAG_AMP); // really craggy, not a ball
    expect(vertexHash(0.5, 0.25, -0.1)).toBe(vertexHash(0.5, 0.25, -0.1));
    // the same split twice is identical: deterministic geometry
    expect(Array.from(splitIntoPlates(positions)[3].positions)).toEqual(
      Array.from(plates[3].positions),
    );
  });
});

describe('the impact clock', () => {
  it('the light peaks at the burst, falls fast, glows low for the ring, then ends', () => {
    expect(impactLightGain(0)).toBe(1);
    expect(impactLightGain(0.3)).toBeLessThan(0.6);
    expect(impactLightGain(0.9)).toBeGreaterThan(0);
    expect(impactLightGain(0.9)).toBeLessThan(0.25);
    expect(impactLightGain(FIRE_RING_S)).toBe(0);
    expect(impactLightGain(-0.1)).toBe(0);
  });

  it('the ring-of-fire waves are spread across the ring life, in order', () => {
    for (let w = 1; w < RING_WAVES; w++) expect(ringWaveAt(w)).toBeGreaterThan(ringWaveAt(w - 1));
    expect(ringWaveAt(0)).toBeLessThan(0.1);
    expect(ringWaveAt(RING_WAVES - 1)).toBeGreaterThan(0.6);
    expect(ringWaveAt(RING_WAVES - 1)).toBeLessThan(FIRE_RING_S);
  });
});

describe('magmaBurstPlan: what each budget tier and quality draws', () => {
  it('tier 0 is the full boulder, tier 1 the boulder alone, tier 2 the legacy bolt', () => {
    expect(magmaBurstPlan(0)).toEqual({ drips: true, fireRing: true });
    expect(magmaBurstPlan(1)).toEqual({ drips: false, fireRing: false });
    expect(magmaBurstPlan(2)).toBeNull();
  });

  it('low VFX quality sheds the drips, never the boulder', () => {
    expect(magmaBurstPlan(0, BOULDER_FULL_QUALITY)).toEqual({ drips: true, fireRing: true });
    expect(magmaBurstPlan(0, BOULDER_FULL_QUALITY - 0.01)).toEqual({
      drips: false,
      fireRing: true,
    });
    expect(magmaBurstPlan(0, 0)).not.toBeNull();
  });
});

describe("lit like the world's lava", () => {
  const light = (): LavaLight => ({ intensity: 0, range: 0 });

  it("uses the Drakelands lava pools' own colour, level and reach", () => {
    const src = readFileSync('src/render/ember_features.ts', 'utf8');
    const hex = `0x${LAVA_LIGHT_COLOR.toString(16)}`;
    expect(src).toContain(
      `new THREE.PointLight(${hex}, ${LAVA_POOL_INTENSITY}, pool.r * ${LAVA_REACH_PER_RADIUS}, 2)`,
    );
  });

  it('at full size the rock lights as far as a crater pool, brighter than one', () => {
    const full = flightLavaLight(1, light());
    expect(full.range).toBeCloseTo(LAVA_REACH_PER_RADIUS * FLIGHT_LAVA_RADIUS);
    expect(full.range).toBeGreaterThan(20);
    expect(full.intensity).toBeGreaterThan(LAVA_POOL_INTENSITY);
    const pebble = flightLavaLight(0, light());
    expect(pebble.intensity).toBeLessThan(full.intensity / 2);
    expect(pebble.range).toBeLessThan(full.range / 2);
  });

  it("the burst floods a lava pool's reach, and the ring of fire glows at a pool's level", () => {
    const burst = impactLavaLight(0, light());
    expect(burst.range).toBeCloseTo(LAVA_REACH_PER_RADIUS * IMPACT_LAVA_RADIUS);
    expect(burst.range).toBeGreaterThan(flightLavaLight(1, light()).range);
    expect(burst.intensity).toBeGreaterThan(flightLavaLight(1, light()).intensity * 2);
    // just after the burst has fallen away, the ring alone burns as
    // RING_LAVA_GAIN lava pools, fading as it burns out
    const ringPeak = impactLavaLight(0.5, light()).intensity;
    expect(RING_LAVA_GAIN).toBeGreaterThanOrEqual(1);
    expect(ringPeak).toBeCloseTo(LAVA_POOL_INTENSITY * RING_LAVA_GAIN * (1 - 0.5 / FIRE_RING_S), 5);
    expect(IMPACT_RING_GAIN).toBeGreaterThan(0.2);
    expect(impactLavaLight(FIRE_RING_S, light()).intensity).toBe(0);
  });
});
