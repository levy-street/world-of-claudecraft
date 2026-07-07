import { describe, expect, it } from 'vitest';
import { GAUNTLET_CIRCLE_NEAR_FRAC, gauntletCircleModel } from '../src/ui/gauntlet_circles_view';
import type { GauntletRunView } from '../src/world_api';

// A minimal live-pull run view; overrides splice per case. Same stub idiom as
// gauntlet_hud_view.test.ts: the core must behave identically for a Sim-shaped
// and a ClientWorld-shaped view, and both produce this same plain object.
const CIRCLE = { id: 3, spawnAt: 100, shrinkS: 2, startSize: 200, targetSize: 75 };
const run = (over: Partial<GauntletRunView> = {}): GauntletRunView => ({
  phase: 'trial',
  trialIndex: 2,
  trialCount: 6,
  endsAt: 175,
  survivors: 12,
  total: 30,
  prizePool: 10000,
  vitality: 100,
  vitalityMax: 100,
  spectating: false,
  finished: false,
  originX: 9000,
  originZ: 0,
  sentinel: null,
  sigils: null,
  pull: { marker: 0, winThreshold: 12, circle: { ...CIRCLE } },
  echo: null,
  span: null,
  court: null,
  podium: null,
  ...over,
});

describe('gauntletCircleModel', () => {
  it('hides outside a run, without the pull substate, or without a circle', () => {
    expect(gauntletCircleModel({ run: null, time: 100 }).visible).toBe(false);
    expect(gauntletCircleModel({ run: run({ pull: null }), time: 100 }).visible).toBe(false);
    const noCircle = run({ pull: { marker: 0, winThreshold: 12, circle: null } });
    expect(gauntletCircleModel({ run: noCircle, time: 100 }).visible).toBe(false);
    const hidden = gauntletCircleModel({ run: null, time: 100 });
    expect(hidden.id).toBe(-1);
    expect(hidden.sizePx).toBe(0);
  });

  it('hides for spectators even if a stale circle rides the view', () => {
    expect(gauntletCircleModel({ run: run({ spectating: true }), time: 101 }).visible).toBe(false);
  });

  it('stays hidden through the spawn gap and appears at spawnAt at full size', () => {
    expect(gauntletCircleModel({ run: run(), time: 99.9 }).visible).toBe(false);
    const fresh = gauntletCircleModel({ run: run(), time: 100 });
    expect(fresh.visible).toBe(true);
    expect(fresh.id).toBe(3);
    expect(fresh.sizePx).toBe(200);
    expect(fresh.targetPx).toBe(75);
    expect(fresh.fraction).toBe(0);
    expect(fresh.near).toBe(false);
  });

  it('shrinks linearly to zero across shrinkS and hides once expired', () => {
    // Halfway through the 2s shrink: 100 units of the 200 remain.
    const mid = gauntletCircleModel({ run: run(), time: 101 });
    expect(mid.sizePx).toBe(100);
    expect(mid.fraction).toBeCloseTo(0.5, 6);
    // The target size (75) is crossed at 62.5 percent of the shrink.
    const atTarget = gauntletCircleModel({ run: run(), time: 101.25 });
    expect(atTarget.sizePx).toBe(75);
    expect(atTarget.near).toBe(true);
    // Expired: the sim re-deals; the client just hides.
    expect(gauntletCircleModel({ run: run(), time: 102 }).visible).toBe(false);
    expect(gauntletCircleModel({ run: run(), time: 110 }).visible).toBe(false);
  });

  it('lights the near band symmetrically around the target size', () => {
    // The band is 75 * GAUNTLET_CIRCLE_NEAR_FRAC = 15 units either side.
    expect(75 * GAUNTLET_CIRCLE_NEAR_FRAC).toBe(15);
    // size(t) = 200 - 100*(t-100), so size 91 (just outside) at t=101.09 and
    // size 89 (just inside) at t=101.11.
    expect(gauntletCircleModel({ run: run(), time: 101.09 }).near).toBe(false);
    expect(gauntletCircleModel({ run: run(), time: 101.11 }).near).toBe(true);
    // Below the target the band holds until 75 - 15 = 60, at t=101.4.
    expect(gauntletCircleModel({ run: run(), time: 101.39 }).near).toBe(true);
    expect(gauntletCircleModel({ run: run(), time: 101.41 }).near).toBe(false);
  });

  it('quantizes the size to whole px so unchanged frames elide', () => {
    const a = gauntletCircleModel({ run: run(), time: 100.501 }).sizePx;
    const b = gauntletCircleModel({ run: run(), time: 100.503 }).sizePx;
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBe(b); // 0.2 units apart, same rounded px
  });

  it('returns the one reused container (allocation-light per-frame core)', () => {
    const a = gauntletCircleModel({ run: run(), time: 101 });
    const b = gauntletCircleModel({ run: null, time: 0 });
    expect(b).toBe(a); // same object, mutated in place
  });
});
