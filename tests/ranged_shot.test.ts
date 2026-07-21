// Unit tests for the ranged-shot weapon-profile leaf (src/sim/combat/ranged_shot.ts).
// Pure function, so it is driven directly with no Sim.

import { describe, expect, it } from 'vitest';
import { rangedShotProfile } from '../src/sim/combat/ranged_shot';

describe('rangedShotProfile', () => {
  const hunterRanged = { min: 5, max: 9, speed: 2.3, wand: false as const };
  const wandRanged = { min: 3, max: 6, speed: 1.8, wand: true as const };
  const bigBow = { min: 46, max: 74, speed: 2.8 };

  it('a hunter (non-wand) shoots with the equipped weapon, not the class ranged def', () => {
    expect(rangedShotProfile(hunterRanged, bigBow)).toEqual(bigBow);
  });

  it('a wand caster keeps the fixed class ranged profile, ignoring the equipped weapon', () => {
    expect(rangedShotProfile(wandRanged, bigBow)).toEqual({ min: 3, max: 6, speed: 1.8 });
  });

  it('a missing wand flag is treated as a hunter-style weapon shot', () => {
    const noFlag = { min: 5, max: 9, speed: 2.3 };
    expect(rangedShotProfile(noFlag, bigBow)).toEqual(bigBow);
  });

  it('returns a fresh object (does not alias the class ranged def)', () => {
    const out = rangedShotProfile(wandRanged, bigBow);
    expect(out).not.toBe(wandRanged);
  });
});
