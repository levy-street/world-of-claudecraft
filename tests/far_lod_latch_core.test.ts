// The far-LOD latch (src/render/far_lod_latch_core.ts): the rig / frozen far
// mesh handoff no longer flickers when its inputs wobble (budget pressure
// easing the band edge, the online moving holdout dropping between snapshots),
// and the fairness carve-out still returns an actionable pose to the rig at
// once. Plus the plan's far-scale slew (crowd_lod.ts characterLodBandsInto).

import { describe, expect, it } from 'vitest';
import {
  type CharacterLodBands,
  characterLodBands,
  characterLodBandsInto,
  FAR_SCALE_SLEW_PER_FRAME,
  showsStaticFarMesh,
} from '../src/render/crowd_lod';
import {
  createFarLodLatchState,
  FAR_LOD_DWELL_SEC,
  FAR_LOD_MOVING_GRACE_SEC,
  FAR_LOD_RETURN,
  latchStaticFarMesh,
} from '../src/render/far_lod_latch_core';

const yd = (d: number) => d * d;
const BASE = 58;

function bands(staticYd: number, actionableYd = Math.max(staticYd, BASE)): CharacterLodBands {
  return {
    shadowRangeSq: yd(25),
    lodRangeSq: yd(BASE),
    staticRangeSq: yd(staticYd),
    actionableStaticRangeSq: yd(actionableYd),
    midCadence: 2,
    farCadence: 4,
  };
}

/** Drive one view for `frames` at 60 fps; count swaps. */
function drive(
  frames: number,
  input: (i: number) => {
    distYd: number;
    b: CharacterLodBands;
    actionable?: boolean;
    moving?: boolean;
  },
): { swaps: number; last: boolean } {
  const st = createFarLodLatchState();
  let far = false;
  let swaps = 0;
  for (let i = 0; i < frames; i++) {
    const x = input(i);
    const next = latchStaticFarMesh(
      st,
      far,
      yd(x.distYd),
      x.b,
      x.actionable ?? false,
      x.moving ?? false,
      i / 60,
    );
    if (next !== far && i > 0) swaps++;
    far = next;
  }
  return { swaps, last: far };
}

describe('far LOD latch: the flicker', () => {
  it('a creature at 66 yd under budget pressure noise no longer flickers', () => {
    // The live plan: pressure wobbling 0.8 to 1.0 every frame eases the frozen
    // edge between 58 and 75 yd. The old per-frame answer on the raw target
    // flipped on almost every frame.
    let raw = 0;
    let prev = false;
    for (let i = 0; i < 600; i++) {
      const now = showsStaticFarMesh(
        yd(66),
        characterLodBands(4, yd(25), yd(BASE), 1.3, i % 2 === 0 ? 1 : 0.8),
        false,
      );
      if (i > 0 && now !== prev) raw++;
      prev = now;
    }
    expect(raw).toBeGreaterThan(500);
    // Slewed plan plus latch: at most one swap in ten seconds.
    const plan = characterLodBands(4, yd(25), yd(BASE), 1.3, 0);
    const latched = drive(600, (i) => ({
      distYd: 66,
      b: characterLodBandsInto(plan, 4, yd(25), yd(BASE), 1.3, i % 2 === 0 ? 1 : 0.8),
    }));
    expect(latched.swaps).toBeLessThanOrEqual(1);
  });

  it('even a raw edge flipping every frame swaps at most once per dwell', () => {
    const r = drive(600, (i) => ({ distYd: 66, b: bands(i % 2 === 0 ? 58 : 75) }));
    expect(r.swaps).toBeLessThanOrEqual(Math.ceil(10 / FAR_LOD_DWELL_SEC) + 1);
  });

  it('a walker whose moving holdout drops between snapshots stays articulated', () => {
    // Crowded bands: frozen past 40 yd, held out to 58 while moving. The holdout
    // is live one frame in six (a sparse online stream).
    const b = bands(40, 58);
    const r = drive(600, (i) => ({ distYd: 50, b, moving: i % 6 === 0 }));
    expect(r.swaps).toBe(0);
    expect(r.last).toBe(false);
  });

  it('a parked creature still freezes once its moving grace has lapsed', () => {
    const b = bands(40, 58);
    const graceFrames = Math.ceil(FAR_LOD_MOVING_GRACE_SEC * 60) + 2;
    const r = drive(graceFrames + Math.ceil(FAR_LOD_DWELL_SEC * 60) + 4, (i) => ({
      distYd: 50,
      b,
      moving: i === 0,
    }));
    expect(r.last).toBe(true);
  });

  it('comes back to the rig only well inside the edge (distance hysteresis)', () => {
    const st = createFarLodLatchState();
    const b = bands(60);
    let far = latchStaticFarMesh(st, false, yd(70), b, false, false, 0);
    expect(far).toBe(true);
    // Just inside the edge: stays frozen.
    far = latchStaticFarMesh(st, far, yd(59), b, false, false, 10);
    expect(far).toBe(true);
    // Inside FAR_LOD_RETURN of it: the rig returns.
    far = latchStaticFarMesh(st, far, yd(60 * FAR_LOD_RETURN - 0.5), b, false, false, 11);
    expect(far).toBe(false);
  });

  it('never delays an actionable pose back to the rig (fairness carve-out)', () => {
    const st = createFarLodLatchState();
    const b = bands(40, 58);
    let far = latchStaticFarMesh(st, false, yd(50), b, false, false, 0);
    expect(far).toBe(true);
    // A cast windup starts the very next frame, just inside the actionable edge:
    // no dwell and no hysteresis, the rig is back at once.
    far = latchStaticFarMesh(st, far, yd(57.9), b, true, false, 1 / 60);
    expect(far).toBe(false);
  });

  it('keeps the old answer for a steady input', () => {
    for (const d of [30, 57, 59, 74, 76, 90]) {
      const b = bands(75, 75);
      const st = createFarLodLatchState();
      expect(latchStaticFarMesh(st, false, yd(d), b, false, false, 0)).toBe(
        showsStaticFarMesh(yd(d), b, false),
      );
    }
  });
});

describe('far LOD plan: the far-scale slew', () => {
  it('a fresh plan snaps; a carried plan slews the edge at most one step per frame', () => {
    const fresh = characterLodBands(4, yd(25), yd(BASE), 1.3, 0);
    expect(Math.sqrt(fresh.staticRangeSq)).toBeCloseTo(BASE * 1.3, 3);
    const out = characterLodBandsInto(
      {
        shadowRangeSq: 0,
        lodRangeSq: 0,
        staticRangeSq: 0,
        actionableStaticRangeSq: 0,
        midCadence: 1,
        farCadence: 1,
      },
      4,
      yd(25),
      yd(BASE),
      1.3,
      0,
    );
    expect(out.appliedFarScale).toBeCloseTo(1.3, 6);
    // Pressure spikes to the drop threshold: the edge walks in, one step a frame.
    characterLodBandsInto(out, 4, yd(25), yd(BASE), 1.3, 1);
    expect(out.appliedFarScale).toBeCloseTo(1.3 - FAR_SCALE_SLEW_PER_FRAME, 6);
    // Alternating noise leaves it where it was, give or take one step.
    for (let i = 0; i < 200; i++)
      characterLodBandsInto(out, 4, yd(25), yd(BASE), 1.3, i % 2 === 0 ? 0 : 1);
    expect(Math.abs((out.appliedFarScale ?? 0) - (1.3 - FAR_SCALE_SLEW_PER_FRAME))).toBeLessThan(
      FAR_SCALE_SLEW_PER_FRAME * 1.5,
    );
  });
});
