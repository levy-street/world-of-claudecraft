// The torched mudfin hut fire's timeline and particle sampler
// (src/render/hut_fire_core.ts): about ten seconds of flame that catches fast
// and burns down, smoke rising as it goes out, every particle on the hut.
import { describe, expect, it } from 'vitest';
import {
  HUT_FIRE_BURN_SECONDS,
  HUT_FIRE_RATES,
  HUT_FIRE_SMOKE_SECONDS,
  HUT_FIRE_TOTAL_SECONDS,
  type HutFireBody,
  type HutFireKind,
  type HutFireParticle,
  hutFireFrame,
  sampleHutFireParticle,
} from '../src/render/hut_fire_core';

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const blank = (): HutFireParticle => ({
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  color: 0,
  size: 0,
  life: 0,
  gravity: 0,
  sprite: 'flame',
  spin: 0,
});

const HUT: HutFireBody = { x: -78, y: 2, z: 269, radius: 1.85, height: 3.8 };

describe('hut fire timeline', () => {
  it('burns for about ten seconds and smokes for a while after', () => {
    expect(HUT_FIRE_BURN_SECONDS).toBe(10);
    expect(HUT_FIRE_SMOKE_SECONDS).toBeGreaterThan(3);
    expect(HUT_FIRE_TOTAL_SECONDS).toBe(HUT_FIRE_BURN_SECONDS + HUT_FIRE_SMOKE_SECONDS);
  });

  it('catches within a second or so and burns at full strength mid-fire', () => {
    expect(hutFireFrame(0).flame).toBe(0);
    expect(hutFireFrame(0.4).flame).toBeGreaterThan(0.1);
    expect(hutFireFrame(1.5).flame).toBe(1);
    expect(hutFireFrame(5).flame).toBe(1);
    expect(hutFireFrame(5).ember).toBe(1);
  });

  it('dies down and is out at ten seconds', () => {
    expect(hutFireFrame(8).flame).toBeGreaterThan(0);
    expect(hutFireFrame(8).flame).toBeLessThan(1);
    expect(hutFireFrame(HUT_FIRE_BURN_SECONDS).flame).toBe(0);
    expect(hutFireFrame(HUT_FIRE_BURN_SECONDS + 1).flame).toBe(0);
  });

  it('smokes thinly while burning and thickest as the flames go out', () => {
    const burning = hutFireFrame(4).smoke;
    const goingOut = hutFireFrame(HUT_FIRE_BURN_SECONDS).smoke;
    expect(burning).toBeGreaterThan(0);
    expect(burning).toBeLessThan(0.5);
    expect(goingOut).toBe(1);
    expect(hutFireFrame(HUT_FIRE_BURN_SECONDS + 1.5).smoke).toBe(1);
    expect(hutFireFrame(HUT_FIRE_TOTAL_SECONDS - 1).smoke).toBeGreaterThan(0);
    expect(hutFireFrame(HUT_FIRE_TOTAL_SECONDS - 1).smoke).toBeLessThan(goingOut);
  });

  it('is done after the smoke, and never done before', () => {
    for (let t = 0; t < HUT_FIRE_TOTAL_SECONDS; t += 0.25) expect(hutFireFrame(t).done).toBe(false);
    expect(hutFireFrame(HUT_FIRE_TOTAL_SECONDS)).toEqual({
      flame: 0,
      ember: 0,
      smoke: 0,
      done: true,
    });
    expect(hutFireFrame(Number.NaN).done).toBe(false);
  });

  it('keeps every strength between 0 and 1 the whole way through', () => {
    for (let t = 0; t <= HUT_FIRE_TOTAL_SECONDS + 1; t += 0.05) {
      const f = hutFireFrame(t);
      for (const v of [f.flame, f.ember, f.smoke]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('spends its particles mostly on flame', () => {
    expect(HUT_FIRE_RATES.flame).toBeGreaterThan(HUT_FIRE_RATES.ember);
    expect(HUT_FIRE_RATES.flame).toBeGreaterThan(HUT_FIRE_RATES.smoke);
  });
});

describe('hut fire particles', () => {
  const kinds: HutFireKind[] = ['flame', 'ember', 'smoke'];

  it('is deterministic for the same random stream', () => {
    for (const kind of kinds) {
      const a = blank();
      const b = blank();
      sampleHutFireParticle(kind, HUT, mulberry(7), a);
      sampleHutFireParticle(kind, HUT, mulberry(7), b);
      expect(a).toEqual(b);
    }
  });

  it('puts flames and embers on the hut: on the wall or thatch, never far off it', () => {
    const rand = mulberry(11);
    for (const kind of ['flame', 'ember'] as const) {
      let onRoof = 0;
      for (let i = 0; i < 400; i++) {
        const p = blank();
        sampleHutFireParticle(kind, HUT, rand, p);
        const r = Math.hypot(p.x - HUT.x, p.z - HUT.z);
        const h = (p.y - HUT.y) / HUT.height;
        expect(h).toBeGreaterThan(0);
        expect(h).toBeLessThan(1);
        expect(r).toBeLessThanOrEqual(HUT.radius * 1.2 * 1.1 + 1e-9);
        if (h >= 0.42) onRoof++;
        expect(p.vy).toBeGreaterThan(0);
        expect(p.gravity).toBeLessThan(0);
        expect(p.life).toBeGreaterThan(0);
      }
      // most of the fire is in the thatch
      expect(onRoof / 400).toBeGreaterThan(0.65);
    }
  });

  it('sizes flames to the hut and draws them with the flame sprites', () => {
    const rand = mulberry(3);
    const tall: HutFireBody = { ...HUT, height: HUT.height * 2 };
    for (let i = 0; i < 100; i++) {
      const p = blank();
      sampleHutFireParticle('flame', HUT, rand, p);
      expect(['flame', 'firePuff']).toContain(p.sprite);
      expect(p.size).toBeGreaterThan(0.5);
      const q = blank();
      sampleHutFireParticle('flame', tall, mulberry(100 + i), q);
      const r = blank();
      sampleHutFireParticle('flame', HUT, mulberry(100 + i), r);
      expect(q.size).toBeCloseTo(r.size * 2, 9);
    }
  });

  it('lifts smoke off the top of the roof in a slow grey plume', () => {
    const rand = mulberry(5);
    for (let i = 0; i < 200; i++) {
      const p = blank();
      sampleHutFireParticle('smoke', HUT, rand, p);
      expect(p.sprite).toBe('smoke');
      expect((p.y - HUT.y) / HUT.height).toBeGreaterThanOrEqual(0.72);
      expect(p.vy).toBeGreaterThan(0.5);
      expect(p.life).toBeGreaterThan(2);
      // a grey the additive cloud can show: no channel black, none bright
      for (const shift of [16, 8, 0]) {
        const c = (p.color >> shift) & 0xff;
        expect(c).toBeGreaterThan(0x30);
        expect(c).toBeLessThan(0x70);
      }
    }
  });
});
