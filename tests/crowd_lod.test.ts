// Crowd-adaptive character LOD policy. Ordinary scenes must be bit-for-bit
// untouched (scale exactly 1, cadence exactly 2); only a genuine crowd degrades.
import { describe, expect, it } from 'vitest';
import {
  animatesEveryFrame,
  animCadenceFrames,
  characterLodBands,
  characterLodBandsInto,
  crowdLodScaleSq,
  FAR_ANIM_RANGE_SCALE_MAX,
  farAnimCadence,
  farAnimRangeScale,
  midAnimCadence,
  movingHoldoutActive,
  positionAdvancedThisTick,
  showsStaticFarMesh,
} from '../src/render/crowd_lod';
import { assertAllocationStable } from './util/alloc_probe';

describe('character LOD allocation budget', () => {
  it('fills one caller-owned band plan', () => {
    const out = characterLodBands(0, 625, 3600, 1, 0);
    expect(() =>
      assertAllocationStable(
        () => characterLodBandsInto(out, 20, 625, 3600, 1, 0),
        64,
        'character LOD plan',
      ),
    ).not.toThrow();
  });
});

describe('crowdLodScaleSq', () => {
  it('leaves ordinary scenes at full range', () => {
    for (const rigs of [0, 1, 5, 13, 14]) expect(crowdLodScaleSq(rigs)).toBe(1);
  });

  it('floors at the minimum scale once the crowd is dense', () => {
    const floor = 0.6 * 0.6;
    expect(crowdLodScaleSq(48)).toBeCloseTo(floor, 9);
    expect(crowdLodScaleSq(200)).toBeCloseTo(floor, 9);
  });

  it('decreases monotonically between the knees and never leaves (floor, 1]', () => {
    let prev = crowdLodScaleSq(14);
    for (let rigs = 15; rigs <= 48; rigs++) {
      const s = crowdLodScaleSq(rigs);
      expect(s).toBeLessThan(prev);
      expect(s).toBeGreaterThanOrEqual(0.6 * 0.6 - 1e-9);
      expect(s).toBeLessThanOrEqual(1);
      prev = s;
    }
  });

  it('pulls the 25yd shadow band in to 15yd at full crowd', () => {
    // ranges compare squared, so the linear range is sqrt(scaleSq) * base
    const band = 25 * Math.sqrt(crowdLodScaleSq(48));
    expect(band).toBeCloseTo(15, 6);
  });
});

describe('midAnimCadence', () => {
  it('animates mid-band rigs every 2nd frame in ordinary scenes', () => {
    for (const rigs of [0, 1, 13, 14]) expect(midAnimCadence(rigs)).toBe(2);
  });

  it('stretches to every 4th frame in a dense crowd', () => {
    expect(midAnimCadence(48)).toBe(4);
    expect(midAnimCadence(500)).toBe(4);
  });

  it('never skips more than 3 frames and never animates less often than every 4th', () => {
    for (let rigs = 0; rigs <= 300; rigs++) {
      const c = midAnimCadence(rigs);
      expect(c).toBeGreaterThanOrEqual(2);
      expect(c).toBeLessThanOrEqual(4);
      expect(Number.isInteger(c)).toBe(true);
    }
  });

  it('is monotonically non-decreasing in crowd size', () => {
    let prev = midAnimCadence(0);
    for (let rigs = 1; rigs <= 300; rigs++) {
      const c = midAnimCadence(rigs);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });
});

// The gameplay-fairness carve-out. The repo invariant is that a performance knob
// may shed cosmetic richness but must NEVER hide or delay actionable information,
// and a cast windup is a telegraph the player reacts to. Each arm of the
// predicate is pinned separately: an arm silently lost in a refactor would throttle
// a real telegraph to a quarter of its frame rate in exactly the dense scene where
// reading it matters most, and no other test would notice.
describe('animatesEveryFrame', () => {
  const SELF = 1;
  const TARGET = 2;
  const STRANGER = 3;

  it('exempts the local player', () => {
    expect(animatesEveryFrame(SELF, SELF, TARGET, false)).toBe(true);
  });

  it('exempts the current target', () => {
    expect(animatesEveryFrame(TARGET, SELF, TARGET, false)).toBe(true);
  });

  it('exempts anything mid-cast, even an untargeted stranger', () => {
    expect(animatesEveryFrame(STRANGER, SELF, TARGET, true)).toBe(true);
  });

  it("exempts the local player's pet while it is fighting", () => {
    expect(animatesEveryFrame(STRANGER, SELF, TARGET, false, true, SELF, TARGET, null)).toBe(true);
  });

  it('exempts a monster directly fighting the local player', () => {
    expect(animatesEveryFrame(STRANGER, SELF, TARGET, false, true, null, SELF, null)).toBe(true);
  });

  it("exempts a monster fighting the local player's pet", () => {
    const PET = 4;
    expect(animatesEveryFrame(STRANGER, SELF, TARGET, false, true, null, PET, SELF)).toBe(true);
  });

  it('exempts an ally fighting the current target', () => {
    expect(animatesEveryFrame(STRANGER, SELF, TARGET, false, true, null, TARGET, null)).toBe(true);
  });

  it('does not exempt idle pets outside combat', () => {
    expect(animatesEveryFrame(STRANGER, SELF, TARGET, false, false, SELF, TARGET, null)).toBe(
      false,
    );
  });

  it('does not exempt an idle, untargeted stranger', () => {
    // the only case the crowd cadence is allowed to throttle
    expect(animatesEveryFrame(STRANGER, SELF, TARGET, false)).toBe(false);
  });

  it('does not exempt a stranger just because the player has no target', () => {
    expect(animatesEveryFrame(STRANGER, SELF, null, false)).toBe(false);
  });
});

// The animated far band. Its whole point is that a character past the articulated
// range keeps MOVING (at a lower pose rate) instead of switching to the baked
// idle-pose mesh, so the assertions below are written against that: what used to
// be frozen at 65yd must now animate, and every arm that opts back out (dense
// crowd, low tier, a machine at its frame budget) must reproduce the legacy
// straight-to-frozen bands EXACTLY, not merely approximately.
const SHADOW_BASE_SQ = 25 * 25;
const LOD_BASE_SQ = 58 * 58;
const yd = (n: number): number => n * n;
const calmBands = (scale = FAR_ANIM_RANGE_SCALE_MAX, pressure = 0) =>
  characterLodBands(4, SHADOW_BASE_SQ, LOD_BASE_SQ, scale, pressure);

describe('farAnimCadence', () => {
  it('refreshes a calm far-band pose every 4th frame', () => {
    for (const rigs of [0, 1, 13, 14]) expect(farAnimCadence(rigs)).toBe(4);
  });

  it('stretches to every 6th frame in a dense crowd', () => {
    expect(farAnimCadence(48)).toBe(6);
    expect(farAnimCadence(500)).toBe(6);
  });

  it('is monotonically non-decreasing and always slower than the mid band', () => {
    let prev = farAnimCadence(0);
    for (let rigs = 0; rigs <= 300; rigs++) {
      const c = farAnimCadence(rigs);
      expect(c).toBeGreaterThanOrEqual(prev);
      expect(c).toBeGreaterThan(midAnimCadence(rigs));
      expect(c).toBeLessThanOrEqual(6);
      prev = c;
    }
  });
});

describe('farAnimRangeScale', () => {
  it('gives a calm, unpressured scene the full tier scale', () => {
    expect(farAnimRangeScale(FAR_ANIM_RANGE_SCALE_MAX, 4, 0)).toBeCloseTo(1.3, 9);
  });

  it('opts out entirely when the tier scale is 1 (low tier, phone profiles)', () => {
    for (const rigs of [0, 20, 48, 200])
      for (const pressure of [0, 0.5, 2]) expect(farAnimRangeScale(1, rigs, pressure)).toBe(1);
  });

  it('clamps a caller that asks for more than the ceiling', () => {
    expect(farAnimRangeScale(5, 0, 0)).toBe(FAR_ANIM_RANGE_SCALE_MAX);
    expect(farAnimRangeScale(0.2, 0, 0)).toBe(1);
    expect(farAnimRangeScale(Number.NaN, 0, 0)).toBe(1);
  });

  it('collapses to exactly 1 once the crowd is dense', () => {
    expect(farAnimRangeScale(FAR_ANIM_RANGE_SCALE_MAX, 48, 0)).toBe(1);
    expect(farAnimRangeScale(FAR_ANIM_RANGE_SCALE_MAX, 500, 0)).toBe(1);
  });

  it('collapses to exactly 1 once the frame budget is spent, crowd or not', () => {
    expect(farAnimRangeScale(FAR_ANIM_RANGE_SCALE_MAX, 0, 1)).toBe(1);
    expect(farAnimRangeScale(FAR_ANIM_RANGE_SCALE_MAX, 0, 4)).toBe(1);
    // mid-pressure eases rather than snapping, but is strictly below full scale
    const easing = farAnimRangeScale(FAR_ANIM_RANGE_SCALE_MAX, 0, 0.9);
    expect(easing).toBeGreaterThan(1);
    expect(easing).toBeLessThan(FAR_ANIM_RANGE_SCALE_MAX);
  });

  it('takes the worse of the crowd and pressure signals, never their average', () => {
    // half-crowd alone eases to 1.15; adding spent budget must not soften that
    const crowdOnly = farAnimRangeScale(FAR_ANIM_RANGE_SCALE_MAX, 31, 0);
    expect(crowdOnly).toBeCloseTo(1.15, 6);
    expect(farAnimRangeScale(FAR_ANIM_RANGE_SCALE_MAX, 31, 1)).toBe(1);
  });

  it('never leaves [1, ceiling] and never increases with crowd or pressure', () => {
    let prev = farAnimRangeScale(FAR_ANIM_RANGE_SCALE_MAX, 0, 0);
    for (let rigs = 0; rigs <= 120; rigs++) {
      const s = farAnimRangeScale(FAR_ANIM_RANGE_SCALE_MAX, rigs, 0);
      expect(s).toBeLessThanOrEqual(prev + 1e-9);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(FAR_ANIM_RANGE_SCALE_MAX);
      prev = s;
    }
    let prevP = farAnimRangeScale(FAR_ANIM_RANGE_SCALE_MAX, 0, 0);
    for (let i = 0; i <= 30; i++) {
      const s = farAnimRangeScale(FAR_ANIM_RANGE_SCALE_MAX, 0, i / 10);
      expect(s).toBeLessThanOrEqual(prevP + 1e-9);
      expect(s).toBeGreaterThanOrEqual(1);
      prevP = s;
    }
  });
});

describe('characterLodBands', () => {
  it('pushes the frozen-mesh edge from 58yd out to ~75yd in a calm scene', () => {
    const bands = calmBands();
    expect(Math.sqrt(bands.lodRangeSq)).toBeCloseTo(58, 6);
    expect(Math.sqrt(bands.staticRangeSq)).toBeCloseTo(75.4, 6);
    expect(Math.sqrt(bands.shadowRangeSq)).toBeCloseTo(25, 6);
  });

  it('keeps a 65yd character animated where it used to be a frozen statue', () => {
    const bands = calmBands();
    expect(showsStaticFarMesh(yd(65), bands, false)).toBe(false);
    expect(animCadenceFrames(yd(65), bands)).toBe(4);
    // ...and the mesh still takes over past the extended edge
    expect(showsStaticFarMesh(yd(78), bands, false)).toBe(true);
    expect(animCadenceFrames(yd(78), bands)).toBe(6);
  });

  it('reproduces the legacy straight-to-frozen bands exactly on a scale-1 tier', () => {
    for (const rigs of [0, 14, 31, 48, 200]) {
      const bands = characterLodBands(rigs, SHADOW_BASE_SQ, LOD_BASE_SQ, 1);
      expect(bands.staticRangeSq).toBe(bands.lodRangeSq);
      expect(bands.lodRangeSq).toBe(LOD_BASE_SQ * crowdLodScaleSq(rigs));
      expect(bands.shadowRangeSq).toBe(SHADOW_BASE_SQ * crowdLodScaleSq(rigs));
      expect(bands.midCadence).toBe(midAnimCadence(rigs));
    }
  });

  it('reproduces the legacy bands exactly for a dense crowd even on a full tier', () => {
    const dense = characterLodBands(48, SHADOW_BASE_SQ, LOD_BASE_SQ, FAR_ANIM_RANGE_SCALE_MAX);
    expect(dense.staticRangeSq).toBe(dense.lodRangeSq);
    expect(Math.sqrt(dense.lodRangeSq)).toBeCloseTo(58 * 0.6, 6);
    expect(Math.sqrt(dense.shadowRangeSq)).toBeCloseTo(15, 6);
  });

  it('orders its band edges and its cadence ladder monotonically', () => {
    for (const rigs of [0, 10, 20, 31, 48, 120]) {
      const bands = characterLodBands(rigs, SHADOW_BASE_SQ, LOD_BASE_SQ, FAR_ANIM_RANGE_SCALE_MAX);
      expect(bands.shadowRangeSq).toBeLessThanOrEqual(bands.lodRangeSq);
      expect(bands.lodRangeSq).toBeLessThanOrEqual(bands.staticRangeSq);
      expect(bands.staticRangeSq).toBeLessThanOrEqual(bands.actionableStaticRangeSq);
      let prev = 0;
      for (let d = 0; d <= 90; d += 1) {
        const c = animCadenceFrames(yd(d), bands);
        expect(c).toBeGreaterThanOrEqual(prev);
        expect(c).toBeGreaterThanOrEqual(1);
        expect(c).toBeLessThanOrEqual(6);
        prev = c;
      }
    }
  });

  it('animates every frame inside the near band and at the mid cadence above it', () => {
    const bands = calmBands();
    expect(animCadenceFrames(yd(10), bands)).toBe(1);
    expect(animCadenceFrames(yd(25), bands)).toBe(1);
    expect(animCadenceFrames(yd(40), bands)).toBe(midAnimCadence(4));
    expect(animCadenceFrames(yd(58), bands)).toBe(midAnimCadence(4));
  });
});

// The fairness floor. A crowd knob may shed cosmetic richness but must never hide
// information a player acts on, and a frozen idle mesh hides a cast windup far more
// completely than a throttled cadence does. Without this floor, a 40yd caster in a
// raid (crowd scale 0.6 pulls the frozen edge in to 34.8yd) would be a statue.
describe('showsStaticFarMesh', () => {
  const dense = characterLodBands(48, SHADOW_BASE_SQ, LOD_BASE_SQ, FAR_ANIM_RANGE_SCALE_MAX);

  it('freezes an ordinary rig the crowd pulled in, but never an actionable one', () => {
    expect(showsStaticFarMesh(yd(40), dense, false)).toBe(true);
    expect(showsStaticFarMesh(yd(40), dense, true)).toBe(false);
    expect(showsStaticFarMesh(yd(57), dense, true)).toBe(false);
  });

  it('bounds the carve-out at the uncrowded base range, so it cannot unbound cost', () => {
    expect(showsStaticFarMesh(yd(59), dense, true)).toBe(true);
    expect(showsStaticFarMesh(yd(79), calmBands(), true)).toBe(true);
  });

  it('does not shrink the calm-scene edge for an actionable pose', () => {
    const bands = calmBands();
    expect(showsStaticFarMesh(yd(70), bands, true)).toBe(false);
    expect(showsStaticFarMesh(yd(70), bands, false)).toBe(false);
  });

  it('holds the actionable floor even when the frame budget is spent', () => {
    const pressured = characterLodBands(48, SHADOW_BASE_SQ, LOD_BASE_SQ, 1, 4);
    expect(showsStaticFarMesh(yd(50), pressured, true)).toBe(false);
    expect(showsStaticFarMesh(yd(50), pressured, false)).toBe(true);
  });
});

// The sliding-statue bug: the renderer passes a gated movement signal into
// `showsStaticFarMesh`, so a walking mob the crowd pulled into the frozen band
// gets the SAME uncrowded floor a caster's fairness carve-out does. A parked
// mob is untouched: it looks identical whether its mixer runs or not, so
// ordinary crowd-driven freezing still applies to it.
describe('positionAdvancedThisTick', () => {
  it('is false for a position unchanged since last tick', () => {
    expect(positionAdvancedThisTick({ x: 12, z: -4 }, { x: 12, z: -4 })).toBe(false);
  });

  it('is true for any horizontal delta, however small', () => {
    expect(positionAdvancedThisTick({ x: 12.001, z: -4 }, { x: 12, z: -4 })).toBe(true);
    expect(positionAdvancedThisTick({ x: 12, z: -3.5 }, { x: 12, z: -4 })).toBe(true);
  });

  it('ignores a vertical-only change (falling or jumping in place)', () => {
    // showsStaticFarMesh never sees y, but the predicate itself must agree:
    // a body dropping straight down is not the ground-sliding artifact.
    expect(positionAdvancedThisTick({ x: 5, z: 5 }, { x: 5, z: 5 })).toBe(false);
  });

  it('flags a large jump the same as a small step (a teleport still deserves its rig)', () => {
    expect(positionAdvancedThisTick({ x: 500, z: 500 }, { x: 5, z: 5 })).toBe(true);
  });
});

describe('movingHoldoutActive', () => {
  it('holds while position interpolation is active', () => {
    expect(movingHoldoutActive({ x: 40, z: 0 }, { x: 39.9, z: 0 }, 0.5, 1)).toBe(true);
  });

  it('releases a stale online remote position delta after interpolation saturates', () => {
    expect(movingHoldoutActive({ x: 40, z: 0 }, { x: 39.9, z: 0 }, 1.25, 1.25)).toBe(false);
  });

  it('keeps an explicit velocity signal held out even after interpolation saturates', () => {
    expect(movingHoldoutActive({ x: 40, z: 0 }, { x: 39.9, z: 0 }, 1.25, 1.25, true)).toBe(true);
  });
});

describe('the frozen-mesh swap exempts a moving mob the crowd pulled in', () => {
  const dense = characterLodBands(48, SHADOW_BASE_SQ, LOD_BASE_SQ, FAR_ANIM_RANGE_SCALE_MAX);

  it('reproduces the bug report: a walking bandit at 40yd in a packed camp used to freeze', () => {
    const prevPos = { x: 39.9, z: 0 };
    const pos = { x: 40, z: 0 };
    const moving = movingHoldoutActive(pos, prevPos, 0.5, 1);
    // no movement signal: unchanged legacy behaviour
    expect(showsStaticFarMesh(yd(40), dense, false)).toBe(true);
    // the same distance, but the renderer now also passes this tick's active movement signal
    expect(showsStaticFarMesh(yd(40), dense, false, moving)).toBe(false);
  });

  it('still freezes the same mob the instant it stops (no residual unfreeze)', () => {
    const moving = movingHoldoutActive({ x: 40, z: 0 }, { x: 40, z: 0 }, 0.5, 1);
    expect(showsStaticFarMesh(yd(40), dense, false, moving)).toBe(true);
  });

  it('lets a parked stale online remote actor become static far LOD again', () => {
    const moving = movingHoldoutActive({ x: 40, z: 0 }, { x: 39.9, z: 0 }, 1.25, 1.25);
    expect(showsStaticFarMesh(yd(40), dense, false, moving)).toBe(true);
  });
});
