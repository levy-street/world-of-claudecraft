import { describe, expect, it } from 'vitest';
import {
  CANNON_PUFF_STYLES,
  CANNON_SMOKE_OCCLUSION_MAX,
  type CannonPuff,
  cannonPuffInto,
  cannonTierAlpha,
  newCannonPuff,
  newCannonPuffFrame,
  PUFF,
} from '../src/render/cannon_puff_core';
import {
  TURRET_SHOCKWAVE_CHIP_LIFE,
  TURRET_SHOCKWAVE_CHIP_PUFFS,
  TURRET_SHOCKWAVE_FRONT_LIFE,
  TURRET_SHOCKWAVE_FRONT_PUFFS,
  TURRET_SHOCKWAVE_LOOK,
  TURRET_SHOCKWAVE_ROLL_SECONDS,
  turretShockwaveChipPuffs,
  turretShockwaveCounts,
  turretShockwaveFrontPuffs,
  turretShockwaveRadiusAt,
} from '../src/render/turret_shockwave_core';
import { TURRET_SHOCKWAVE } from '../src/sim/content/turret_defense';
import { FIRE_AND_FLY_TOWER } from '../src/sim/fire_and_fly_field';
import { turretShockwaveFront } from '../src/sim/minigames/turret_shockwave';
import { DT } from '../src/sim/types';
import {
  occlusionTargets,
  smokeOcclusionPeak,
  TURRET_CAMERA_EYE,
} from './helpers/cannon_smoke_occlusion';

const flat = () => 0;
const pool = (n: number): CannonPuff[] => Array.from({ length: n }, newCannonPuff);

function front(low: boolean, cx = 0, cz = 0, ground: (x: number, z: number) => number = flat) {
  const puffs = pool(TURRET_SHOCKWAVE_FRONT_PUFFS);
  const n = turretShockwaveFrontPuffs(puffs, 3, cx, cz, turretShockwaveCounts(low), ground, 0);
  return puffs.slice(0, n);
}

describe('Shockwave front on screen', () => {
  it("samples the sim's own front curve, in seconds", () => {
    for (let t = 0; t <= TURRET_SHOCKWAVE_FRONT_LIFE; t += 1 / 90) {
      expect(turretShockwaveRadiusAt(t)).toBe(turretShockwaveFront(t / DT));
    }
    expect(TURRET_SHOCKWAVE_ROLL_SECONDS).toBeCloseTo(TURRET_SHOCKWAVE.rollTicks * DT, 12);
    expect(turretShockwaveRadiusAt(0)).toBeCloseTo(FIRE_AND_FLY_TOWER.radius, 12);
    expect(turretShockwaveRadiusAt(10)).toBeCloseTo(TURRET_SHOCKWAVE.reach, 12);
  });

  it('rides every wall puff on the front at every instant, its leading edge on it, then holds at the reach', () => {
    const f = newCannonPuffFrame();
    const wall = front(false, 7, -3).filter((p) => p.kind === PUFF.shock);
    expect(wall).toHaveLength(turretShockwaveCounts(false).wall);
    const angles = new Set<number>();
    for (const p of wall) {
      angles.add(Math.round(Math.atan2(p.x - 7, p.z + 3) * 10));
      for (let t = 0; t < p.life; t += 1 / 120) {
        expect(cannonPuffInto(p, t, f)).toBe(true);
        const radius = Math.hypot(f.x - 7, f.z + 3);
        // The front the sim throws a monster by on this very instant, at any frame rate.
        expect(radius + TURRET_SHOCKWAVE_LOOK.wallBack).toBeCloseTo(
          turretShockwaveFront(t / DT),
          9,
        );
      }
    }
    // All around the tower, not a fan.
    expect(angles.size).toBeGreaterThan(20);
  });

  it('shows the wall from the slam to the end of its linger, and the sparks only on the roll, just ahead of the front', () => {
    const f = newCannonPuffFrame();
    const puffs = front(false);
    const wall = puffs.filter((p) => p.kind === PUFF.shock);
    const sparks = puffs.filter((p) => p.kind === PUFF.spark);
    expect(sparks).toHaveLength(turretShockwaveCounts(false).sparks);
    const roll = TURRET_SHOCKWAVE_ROLL_SECONDS;
    for (const p of wall) {
      expect(p.delay).toBe(0);
      expect(p.delay + p.life).toBeGreaterThan(roll + 0.3);
      expect(p.delay + p.life).toBeLessThanOrEqual(TURRET_SHOCKWAVE_FRONT_LIFE + 1e-9);
      expect(cannonPuffInto(p, roll * 0.5, f)).toBe(true);
      expect(f.size).toBeGreaterThan(1);
      expect(f.size).toBeLessThan(3);
      expect(f.a).toBeGreaterThan(0);
    }
    let latest = 0;
    for (const p of sparks) {
      expect(p.delay).toBeLessThan(roll);
      latest = Math.max(latest, p.delay + p.life);
      for (let t = p.delay; t < p.delay + p.life; t += 1 / 120) {
        if (!cannonPuffInto(p, t, f)) continue;
        const radius = Math.hypot(f.x, f.z);
        const ahead = radius - turretShockwaveFront(t / DT);
        expect(ahead).toBeGreaterThan(0.1);
        expect(ahead).toBeLessThan(0.5);
        // Skimming the ground.
        expect(f.y).toBeLessThan(0.45);
        expect(f.add).toBe(1);
      }
    }
    // Gone with the roll, give or take a spark's short life.
    expect(latest).toBeLessThan(roll + TURRET_SHOCKWAVE_LOOK.sparkLife * 1.3);
    // Nothing of the front outlives its life, which is what its bursts are held for.
    for (const p of puffs) expect(cannonPuffInto(p, TURRET_SHOCKWAVE_FRONT_LIFE, f)).toBe(false);
  });

  it('follows the ground from where each puff starts to where it stops', () => {
    const slope = (x: number) => 0.1 * x;
    const f = newCannonPuffFrame();
    for (const p of front(false, 0, 0, slope).filter((q) => q.kind === PUFF.shock)) {
      cannonPuffInto(p, TURRET_SHOCKWAVE_ROLL_SECONDS + 0.1, f);
      const over = f.y - slope(f.x);
      expect(over).toBeGreaterThan(0.5);
      expect(over).toBeLessThan(1);
    }
  });

  it('sheds only cosmetic counts on the low preset, its fewer wall puffs each denser', () => {
    const high = turretShockwaveCounts(false);
    const low = turretShockwaveCounts(true);
    expect(low.wall).toBeLessThan(high.wall);
    expect(low.sparks).toBeLessThan(high.sparks);
    expect(low.chips).toBeLessThan(high.chips);
    expect(TURRET_SHOCKWAVE_FRONT_PUFFS).toBe(high.wall + high.sparks);
    expect(TURRET_SHOCKWAVE_CHIP_PUFFS).toBe(high.chips);
    const density = TURRET_SHOCKWAVE_LOOK.wallDensity;
    const peak = CANNON_PUFF_STYLES[PUFF.shock].alpha * density;
    expect(peak).toBeLessThan(1);
    const factor = density * cannonTierAlpha(peak, high.wall, low.wall);
    expect(factor).toBeGreaterThan(density);
    for (const p of front(true).filter((q) => q.kind === PUFF.shock)) {
      expect(p.alpha).toBeCloseTo(factor, 12);
    }
    for (const p of front(false).filter((q) => q.kind === PUFF.shock)) {
      expect(p.alpha).toBe(density);
    }
  });

  it('pops grey stone chips off the plinth, all around, that fall back onto the ground', () => {
    const f = newCannonPuffFrame();
    const puffs = pool(TURRET_SHOCKWAVE_CHIP_PUFFS);
    const n = turretShockwaveChipPuffs(
      puffs,
      9,
      4,
      2,
      5,
      turretShockwaveCounts(false).chips,
      () => 2,
    );
    expect(n).toBe(turretShockwaveCounts(false).chips);
    for (const p of puffs.slice(0, n)) {
      expect(p.kind).toBe(PUFF.stone);
      const r = Math.hypot(p.x - 4, p.z - 5);
      expect(r).toBeGreaterThanOrEqual(FIRE_AND_FLY_TOWER.radius);
      expect(r).toBeLessThan(FIRE_AND_FLY_TOWER.radius + 0.5);
      expect(p.delay + p.life).toBeLessThanOrEqual(TURRET_SHOCKWAVE_CHIP_LIFE);
      let top = 0;
      for (let t = 0; t < p.delay + p.life; t += 1 / 60) {
        if (!cannonPuffInto(p, t, f)) continue;
        top = Math.max(top, f.y);
        expect(f.y).toBeGreaterThanOrEqual(2);
      }
      expect(top).toBeGreaterThan(p.y + 0.4);
      cannonPuffInto(p, p.delay + p.life - 0.01, f);
      expect(f.y).toBeCloseTo(2.1, 6);
    }
    const stone = CANNON_PUFF_STYLES[PUFF.stone].rgb;
    // Grey stone, not brown earth: blue within a tenth of red.
    expect(Math.abs(stone[0] - stone[2])).toBeLessThan(0.1 * stone[0]);
  });

  it('is the same every time for the same ring', () => {
    expect(front(false)).toEqual(front(false));
    const a = pool(20);
    const b = pool(20);
    turretShockwaveChipPuffs(a, 5, 0, 0, 0, 14, flat);
    turretShockwaveChipPuffs(b, 5, 0, 0, 0, 14, flat);
    expect(a).toEqual(b);
  });
});

describe('Shockwave dust fairness', () => {
  // The dust wall is one source: it passes each monster in a fraction of a
  // second and, stacked, never hides more than the cap of what stands behind
  // it, on any preset, whether the monster is at the foot, on the ring or past it.
  const worst = (low: boolean): number => {
    let peak = 0;
    for (const d of [3, 8, 12, 16]) {
      const puffs = front(low);
      peak = Math.max(
        peak,
        smokeOcclusionPeak(
          puffs,
          puffs.length,
          TURRET_CAMERA_EYE,
          occlusionTargets(0, d),
          TURRET_SHOCKWAVE_FRONT_LIFE,
        ),
      );
    }
    return peak;
  };

  it('never lets the dust wall hide more than the cap, on high or on low', () => {
    const high = worst(false);
    const low = worst(true);
    expect(high).toBeLessThanOrEqual(CANNON_SMOKE_OCCLUSION_MAX);
    expect(low).toBeLessThanOrEqual(CANNON_SMOKE_OCCLUSION_MAX);
    // Measured, not vacuous: the wall reads as a wall of dust, not a ring of wisps.
    expect(high).toBeGreaterThan(0.2);
  });
});
