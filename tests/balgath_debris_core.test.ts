// Ballistics and material for the boss's ground debris (src/render/balgath_debris_core.ts)
// plus the shared surface-to-dust table it reads (ground_puff_color_core.ts).
//
// This layer is easy to get subtly wrong in ways only a long session shows: particles that
// never die leak the pool, a frame-rate-dependent drag makes the effect quietly different
// on a slow machine, and a burst that clumps reads as a handful of pebbles rather than a
// wall of soil. All three are cheap to pin here and expensive to notice in a raid.
import { describe, expect, it } from 'vitest';
import type { Surface } from '../src/render/audio_sink';
import {
  type DebrisParticle,
  debrisAlpha,
  debrisBearing,
  debrisProfileFor,
  debrisSpeedScale,
  stepDebrisParticle,
} from '../src/render/balgath_debris_core';
import { debrisPowerForBlast } from '../src/render/balgath_fx_core';
import { excavatedPuffColor, groundPuffColor } from '../src/render/ground_puff_color_core';

const ALL: Surface[] = ['grass', 'dirt', 'stone', 'wood', 'snow', 'water'];

function particle(over: Partial<DebrisParticle> = {}): DebrisParticle {
  return {
    x: 0,
    y: 2,
    z: 0,
    vx: 1,
    vy: 4,
    vz: 0,
    age: 0,
    life: 1.2,
    size: 0.4,
    color: 0xffffff,
    floor: 0,
    drag: 0.7,
    gravity: 1,
    pullK: 0,
    ...over,
  };
}

describe('surface colours', () => {
  it('gives every surface but water a dust colour', () => {
    for (const s of ALL) {
      const c = groundPuffColor(s);
      if (s === 'water') expect(c).toBeNull();
      else expect(c, s).not.toBeNull();
    }
  });

  it('digs a darker tone than it dusts, off the same base', () => {
    // A footfall lifts the dry top layer and a fist turns over what is under it. If the
    // two ever came from different tables they would stop reading as the same ground.
    for (const s of ALL) {
      const dust = groundPuffColor(s);
      const dug = excavatedPuffColor(s);
      if (dust === null) {
        expect(dug).toBeNull();
        continue;
      }
      expect(dug).not.toBeNull();
      const lum = (c: number) => ((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff);
      expect(lum(dug ?? 0), s).toBeLessThan(lum(dust));
    }
  });
});

describe('debris profiles', () => {
  it('throws water UP and soil OUT', () => {
    // The one distinction the whole system exists for: a splash is a column and a soil
    // burst is a spray. If they ever converge, wading through a fen looks like walking
    // through a dust bowl.
    const water = debrisProfileFor('water');
    const turf = debrisProfileFor('grass');
    expect(water.lift).toBeGreaterThan(water.out);
    expect(turf.out).toBeGreaterThan(turf.lift);
    expect(water.lift).toBeGreaterThan(turf.lift);
  });

  it('lets water hang longer than stone', () => {
    expect(debrisProfileFor('water').drag).toBeGreaterThan(debrisProfileFor('stone').drag);
  });

  it('answers for every surface the classifier can return', () => {
    for (const s of ALL) {
      const p = debrisProfileFor(s);
      expect(p.count, s).toBeGreaterThan(0);
      expect(p.life, s).toBeGreaterThan(0);
      expect(p.colors, s).toHaveLength(2);
    }
  });

  it('scales a burst by the RIM, not the area', () => {
    // Doubling the radius quadruples the area but only doubles the rim the eye reads, so
    // the burst grows by the square root. Linear scaling makes the small slams look empty
    // next to the big ones.
    const small = debrisPowerForBlast(6);
    const big = debrisPowerForBlast(24);
    expect(big).toBeGreaterThan(small);
    expect(big / small).toBeLessThan(3);
  });
});

describe('particle motion', () => {
  it('dies of old age', () => {
    const p = particle({ age: 1.19, life: 1.2 });
    expect(stepDebrisParticle(p, 0.05)).toBe(false);
  });

  it('dies on landing rather than falling through the world forever', () => {
    const p = particle({ y: 0.02, vy: -6, floor: 0 });
    expect(stepDebrisParticle(p, 0.05)).toBe(false);
  });

  it('does not die the instant it is born inside the floor it launched from', () => {
    // Bursts are seeded a touch above the ground with upward velocity; a naive "below the
    // floor" test kills the whole burst on frame one.
    const p = particle({ y: 0, vy: 8, floor: 0 });
    expect(stepDebrisParticle(p, 0.05)).toBe(true);
    expect(p.y).toBeGreaterThan(0);
  });

  it('applies drag per SECOND, so a slow machine sees the same curve', () => {
    // The trap this pins: `v *= drag` once per frame is frame-rate dependent, and the
    // effect ends up visibly heavier at 30fps than at 120. Stepping 0.5s in one go and in
    // ten pieces must land in the same place.
    const one = particle({ vy: 0, vx: 10, drag: 0.5 });
    stepDebrisParticle(one, 0.5);
    const many = particle({ vy: 0, vx: 10, drag: 0.5 });
    for (let i = 0; i < 10; i++) stepDebrisParticle(many, 0.05);
    // VELOCITY is the invariant, and it is exact: drag is `v * retention^dt`, which
    // composes over any subdivision. Position deliberately is NOT asserted: no explicit
    // integrator lands a 0.5s step and ten 0.05s steps on the same coordinate, and
    // pretending otherwise would be pinning the integrator's error rather than its rule.
    expect(many.vx).toBeCloseTo(one.vx, 4);
  });

  it('spreads a burst evenly at every prefix, so a clipped burst is still a circle', () => {
    // The golden angle's whole point here: a budget that cuts a 40-particle burst to 12
    // must still leave a ring, not a wedge. Bucket the first N bearings and check no
    // quadrant is starved.
    for (const n of [8, 16, 40]) {
      const quads = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        const a = ((debrisBearing(i) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        quads[Math.floor((a / (Math.PI * 2)) * 4)]++;
      }
      for (const q of quads) expect(q, `n=${n}`).toBeGreaterThan(0);
    }
  });

  it('gives a burst a fast front and a slow tail', () => {
    expect(debrisSpeedScale(0, 20)).toBeGreaterThan(debrisSpeedScale(19, 20));
    expect(debrisSpeedScale(0, 1)).toBeGreaterThan(0);
  });

  it('holds full brightness before it fades, and never goes negative', () => {
    expect(debrisAlpha(particle({ age: 0.1, life: 1 }))).toBe(1);
    expect(debrisAlpha(particle({ age: 0.99, life: 1 }))).toBeLessThan(0.1);
    expect(debrisAlpha(particle({ age: 1.5, life: 1 }))).toBeGreaterThanOrEqual(0);
  });
});
