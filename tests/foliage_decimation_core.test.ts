import { describe, expect, it } from 'vitest';
import { survivesLeanDecimation } from '../src/render/foliage_decimation_core';
import { ROCK_COLLIDER_MIN_SCALE } from '../src/sim/decoration_dims';
import type { Decoration } from '../src/sim/world';

const deco = (over: Partial<Decoration>): Decoration => ({
  kind: 'rock',
  x: 0,
  z: 0,
  scale: 1,
  variant: 0,
  biome: 'vale',
  ...over,
});

describe('survivesLeanDecimation', () => {
  it('never drops a rock big enough to carry a collider, no matter the hash draw', () => {
    const solidRock = deco({ kind: 'rock', scale: ROCK_COLLIDER_MIN_SCALE });
    // 0.999999 is as unlucky a draw as the caller's hash can produce; every
    // keep-rate below is < 1, so a pre-fix implementation drops this rock.
    expect(survivesLeanDecimation(solidRock, 0.999999, true)).toBe(true);
    expect(survivesLeanDecimation(solidRock, 0.999999, false)).toBe(true);
    expect(survivesLeanDecimation(deco({ kind: 'rock', scale: 1.6 }), 0.999999, false)).toBe(true);
  });

  it('still decimates dressing rocks below the collider floor, at the tuned keep rates', () => {
    const dressing = deco({ kind: 'rock', scale: ROCK_COLLIDER_MIN_SCALE - 0.01 });
    expect(survivesLeanDecimation(dressing, 0.5, true)).toBe(true); // 0.5 < 0.74 keep
    expect(survivesLeanDecimation(dressing, 0.8, true)).toBe(false); // 0.8 >= 0.74 keep
    expect(survivesLeanDecimation(dressing, 0.5, false)).toBe(true); // 0.5 < 0.55 keep
    expect(survivesLeanDecimation(dressing, 0.6, false)).toBe(false); // 0.6 >= 0.55 keep
  });

  it('leaves tree/tree2 decimation exactly as tuned (unaffected by the rock collider exemption)', () => {
    const pine = deco({ kind: 'tree' });
    expect(survivesLeanDecimation(pine, 0.5, true)).toBe(true); // 0.5 < 0.68 keep
    expect(survivesLeanDecimation(pine, 0.7, true)).toBe(false); // 0.7 >= 0.68 keep
    const oak = deco({ kind: 'tree2' });
    expect(survivesLeanDecimation(oak, 0.4, false)).toBe(true); // 0.4 < 0.46 keep
    expect(survivesLeanDecimation(oak, 0.5, false)).toBe(false); // 0.5 >= 0.46 keep
  });
});
