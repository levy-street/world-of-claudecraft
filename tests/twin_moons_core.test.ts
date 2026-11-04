// The two-moon sky (src/render/twin_moons_core.ts): the mage's moon held opposite
// the sun, and the Earth-like natural moon that is up every night, waxes and wanes
// on Earth's month, and eclipses at the antisolar point where the mage's moon hangs.
import { describe, expect, it } from 'vitest';
import { MOON_FACE_SCALE } from '../src/render/celestial_sprites';
import {
  LUNAR_CYCLE_MS,
  moonNightFloors,
  moonTerminator,
  sunDirection,
} from '../src/render/day_night_core';
import {
  circleOverlap,
  DRACONIC_MONTH_DAYS,
  latitudeToRadii,
  MAGE_MOON_RADII,
  MOON_ANGULAR_RADIUS,
  MOON_INCLINATION_DEG,
  MOON_SIZE_SWING,
  mageHaloBoost,
  moonLatitudeDeg,
  moonSizeFactor,
  moonSky,
  NIGHT_SWING,
  naturalMoonPathPhase,
  nightLitFraction,
  PENUMBRA_RADII,
  pathTangent,
  SYNODIC_MONTH_DAYS,
  spriteRotationAlong,
  UMBRA_RADII,
  type Vec3,
} from '../src/render/twin_moons_core';
import { DAY_NIGHT_CYCLE_MS } from '../src/sim/day_night';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const angleDeg = (a: Vec3, b: Vec3) =>
  (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI;
// a world-day count far from the node, so latitude is large and no eclipse happens
const OFF_NODE_DAYS = DRACONIC_MONTH_DAYS / 4;

describe('the natural moon keeps Earth month', () => {
  it('runs 29.5 world days new to new', () => {
    expect(SYNODIC_MONTH_DAYS).toBeCloseTo(29.530589, 6);
    expect(LUNAR_CYCLE_MS).toBeCloseTo(29.530589 * DAY_NIGHT_CYCLE_MS, 0);
  });

  it('tilts up to Earth 5.145 degrees off the sun path on the draconic month', () => {
    expect(moonLatitudeDeg(0)).toBeCloseTo(0, 9);
    expect(moonLatitudeDeg(DRACONIC_MONTH_DAYS / 4)).toBeCloseTo(MOON_INCLINATION_DEG, 9);
    expect(moonLatitudeDeg(DRACONIC_MONTH_DAYS * 0.75)).toBeCloseTo(-MOON_INCLINATION_DEG, 9);
    for (let d = 0; d < 60; d += 0.37) {
      expect(Math.abs(moonLatitudeDeg(d))).toBeLessThanOrEqual(MOON_INCLINATION_DEG + 1e-9);
    }
  });

  it('grows and shrinks by the size swing and no more', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let d = 0; d < 60; d += 0.05) {
      lo = Math.min(lo, moonSizeFactor(d));
      hi = Math.max(hi, moonSizeFactor(d));
    }
    expect(hi).toBeCloseTo(1 + MOON_SIZE_SWING, 3);
    expect(lo).toBeCloseTo(1 - MOON_SIZE_SWING, 3);
  });

  it('maps latitude true to the drawn size near the path and compresses past it', () => {
    expect(latitudeToRadii(0.26)).toBeCloseTo(1, 9);
    expect(latitudeToRadii(-0.52)).toBeCloseTo(-2, 9);
    // true to scale out to 1.6 degrees, past the penumbral limit, so every contact is real
    expect(latitudeToRadii(1.6)).toBeCloseTo(1.6 / 0.26, 9);
    expect(latitudeToRadii(MOON_INCLINATION_DEG)).toBeCloseTo(1.6 / 0.26 + 1, 9);
    // monotone, so a moon drifting off the path never jumps back toward it
    let prev = 0;
    for (let d = 0.01; d <= MOON_INCLINATION_DEG; d += 0.01) {
      expect(latitudeToRadii(d)).toBeGreaterThan(prev);
      prev = latitudeToRadii(d);
    }
  });

  it('restates the drawn moon radius from the sprite size it is painted at', () => {
    expect(MOON_ANGULAR_RADIUS).toBeCloseTo(
      Math.atan(((MOON_FACE_SCALE / 2) * 118) / 128 / 760),
      12,
    );
  });
});

describe('the mage moon', () => {
  it('is held exactly opposite the sun at every hour', () => {
    for (let p = 0; p < 1; p += 1 / 48) {
      const sky = moonSky(p, 0.3, OFF_NODE_DAYS);
      expect(sky.mageDir).toEqual(sunDirection(p + 0.5));
      expect(len(sky.mageDir)).toBeCloseTo(1, 12);
    }
  });

  it('is up exactly when the sun is down', () => {
    expect(moonSky(0, 0, OFF_NODE_DAYS).mageUp).toBe(1); // midnight
    expect(moonSky(0.5, 0, OFF_NODE_DAYS).mageUp).toBe(0); // noon
  });

  it('never changes shape: its light share is the same at every lunar phase', () => {
    for (const lp of [0, 0.25, 0.5, 0.75]) {
      // natural moon contributes nothing when it is down, leaving the mage's half
      expect(nightLitFraction(moonTerminator(lp).litFrac, 0, 0, 0, 0)).toBeCloseTo(0.5, 12);
    }
  });

  it('burns brighter near the horizon and plain overhead', () => {
    expect(mageHaloBoost(0)).toBeCloseTo(1.6, 9);
    expect(mageHaloBoost(0.26)).toBeLessThan(1.001);
    expect(mageHaloBoost(0.04)).toBeGreaterThan(mageHaloBoost(0.12));
  });
});

describe('the natural moon is up every night', () => {
  it('stays within the squeezed spread of the mage moon along the path', () => {
    // NIGHT_SWING of Earth half-turn spread: about 63 degrees of path arc at most
    expect(NIGHT_SWING * 180).toBeCloseTo(63, 0);
    for (let lp = 0; lp < 1; lp += 1 / 64) {
      const shift = naturalMoonPathPhase(0, lp) - 0.5;
      expect(Math.abs(shift)).toBeLessThanOrEqual(NIGHT_SWING / 2 + 1e-12);
    }
  });

  it('is above the horizon at midnight on every night of the month, at any latitude', () => {
    for (let lp = 0; lp < 1; lp += 1 / 64) {
      for (const lat of [-MOON_INCLINATION_DEG, 0, MOON_INCLINATION_DEG]) {
        const sky = moonSky(0, lp, 0, lat);
        expect(sky.naturalDir[1], `phase ${lp.toFixed(3)} lat ${lat}`).toBeGreaterThan(0);
        expect(sky.naturalUp).toBeGreaterThan(0.5);
      }
    }
  });

  it('is up all night when full, and a crescent leaves the sky before the night ends', () => {
    // full moon: up from just after dusk to just before dawn
    for (let p = 0.8; p <= 1.2; p += 0.02) {
      expect(moonSky(p % 1, 0.5, OFF_NODE_DAYS, 0).naturalDir[1]).toBeGreaterThan(0);
    }
    // a waxing crescent is up at dusk and gone before dawn (sets early)
    expect(moonSky(0.78, 0.05, OFF_NODE_DAYS, 0).naturalDir[1]).toBeGreaterThan(0);
    expect(moonSky(0.2, 0.05, OFF_NODE_DAYS, 0).naturalDir[1]).toBeLessThan(0);
    // a waning crescent rises late and is up toward dawn
    expect(moonSky(0.8, 0.95, OFF_NODE_DAYS, 0).naturalDir[1]).toBeLessThan(0);
    expect(moonSky(0.2, 0.95, OFF_NODE_DAYS, 0).naturalDir[1]).toBeGreaterThan(0);
  });

  it('turns its lit limb toward the sun: waxing lit along the westward tangent, waning away', () => {
    for (const dayPhase of [0.8, 0, 0.15]) {
      for (const lp of [0.1, 0.3, 0.7, 0.9]) {
        const sky = moonSky(dayPhase, lp, OFF_NODE_DAYS);
        const sun = sunDirection(dayPhase);
        const towardSun: Vec3 = [
          sun[0] - sky.naturalDir[0],
          sun[1] - sky.naturalDir[1],
          sun[2] - sky.naturalDir[2],
        ];
        // the face is painted lit from +x while waxing and from -x while waning
        const litSide = lp < 0.5 ? 1 : -1;
        expect(
          dot(towardSun, sky.naturalTangent) * litSide,
          `day ${dayPhase} lunar ${lp}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the tangent smooth through full moon so the face never flips', () => {
    const before = moonSky(0, 0.499, OFF_NODE_DAYS).naturalTangent;
    const after = moonSky(0, 0.501, OFF_NODE_DAYS).naturalTangent;
    expect(dot(before, after)).toBeGreaterThan(0.999);
    expect(len(pathTangent(0.37))).toBeCloseTo(1, 12);
    expect(dot(pathTangent(0.37), sunDirection(0.37))).toBeCloseTo(0, 12);
  });
});

describe('eclipses and the covering', () => {
  it('a full moon on the path is a total eclipse that covers the mage moon', () => {
    const sky = moonSky(0, 0.5, 0, 0);
    expect(angleDeg(sky.naturalDir, sky.mageDir)).toBeLessThan(1e-6);
    expect(sky.umbra).toBeCloseTo(1, 9);
    expect(sky.mageCover).toBeCloseTo(1, 9);
  });

  it('a full moon far off the path passes clear: no shadow, no covering', () => {
    const sky = moonSky(0, 0.5, OFF_NODE_DAYS);
    expect(sky.umbra).toBe(0);
    expect(sky.penumbra).toBe(0);
    expect(sky.mageCover).toBe(0);
  });

  it('happens at Earth limits: penumbral, then partial, then total as the moon nears the path', () => {
    // contacts in degrees: penumbra edge ~1.51, umbra edge ~0.96, totality ~0.44
    const at = (lat: number) => moonSky(0, 0.5, 0, lat);
    expect(at(1.6).penumbra).toBe(0);
    expect(at(1.4).penumbra).toBeGreaterThan(0);
    expect(at(1.4).umbra).toBe(0);
    expect(at(0.8).umbra).toBeGreaterThan(0);
    expect(at(0.8).umbra).toBeLessThan(1);
    expect(at(0.3).umbra).toBeCloseTo(1, 6);
  });

  it('reports the umbra offset in the face frame, pointing back at the antisolar point', () => {
    const sky = moonSky(0, 0.5, 0, 0.6);
    const [ox, oy] = sky.umbraOffset;
    expect(Math.hypot(ox, oy)).toBeCloseTo(latitudeToRadii(0.6) / sky.size, 2);
    // the moon was pushed north (+face up), so the shadow centre lies below it
    expect(oy).toBeLessThan(0);
    expect(Math.abs(ox)).toBeLessThan(0.05);
  });

  it('uses Earth shadow ratios, with the mage moon small enough to be fully hidden', () => {
    expect(UMBRA_RADII).toBeCloseTo(0.7 / 0.26, 12);
    expect(PENUMBRA_RADII).toBeCloseTo(1.25 / 0.26, 12);
    expect(MAGE_MOON_RADII).toBeLessThan(1 - MOON_SIZE_SWING);
  });

  it('circleOverlap covers the containment, disjoint and partial cases', () => {
    expect(circleOverlap(0, 1, 2)).toBeCloseTo(Math.PI, 12);
    expect(circleOverlap(3, 1, 1)).toBe(0);
    // two unit circles a radius apart overlap by 2pi/3 - sqrt(3)/2
    expect(circleOverlap(1, 1, 1)).toBeCloseTo((2 * Math.PI) / 3 - Math.sqrt(3) / 2, 9);
  });
});

describe('the night light the two moons give', () => {
  it('a new-moon night is the normal night, a full-moon night the brightest', () => {
    expect(nightLitFraction(0, 1, 0, 0, 0)).toBeCloseTo(0.5, 12);
    expect(nightLitFraction(1, 1, 0, 0, 0)).toBeCloseTo(1, 12);
    expect(moonNightFloors(nightLitFraction(0, 1, 0, 0, 0)).key).toBeLessThan(
      moonNightFloors(nightLitFraction(1, 1, 0, 0, 0)).key,
    );
  });

  it('only an eclipse runs darker than the normal night, and never past the floor', () => {
    const eclipse = nightLitFraction(1, 1, 1, 0, 1);
    expect(eclipse).toBeLessThan(0.5);
    expect(eclipse).toBeGreaterThan(0);
    // moonNightFloors keeps its own minimum key light, so the darkest night stays readable
    expect(moonNightFloors(eclipse).key).toBeGreaterThanOrEqual(moonNightFloors(0).key);
    const full = moonSky(0, 0.5, OFF_NODE_DAYS);
    const covered = moonSky(0, 0.5, 0, 0);
    expect(covered.nightLitFrac).toBeLessThan(full.nightLitFrac);
  });

  it('the live sky feeds that fraction, from the moon actually being up', () => {
    const night = moonSky(0, 0.5, OFF_NODE_DAYS);
    expect(night.nightLitFrac).toBeCloseTo(nightLitFraction(1, night.naturalUp, 0, 0, 0), 12);
  });
});

describe('spriteRotationAlong', () => {
  it('reads a direction on the camera axes as a counter-clockwise screen angle', () => {
    const right: Vec3 = [1, 0, 0];
    const up: Vec3 = [0, 1, 0];
    expect(spriteRotationAlong([1, 0, 0], right, up)).toBeCloseTo(0, 12);
    expect(spriteRotationAlong([0, 1, 0], right, up)).toBeCloseTo(Math.PI / 2, 12);
    expect(spriteRotationAlong([-1, 0, 0.3], right, up)).toBeCloseTo(Math.PI, 12);
  });
});
