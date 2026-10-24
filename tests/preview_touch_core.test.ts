import { describe, expect, it } from 'vitest';
import {
  CREATION_HEAD_Y,
  PREVIEW_FRAMING,
  type PreviewCamPose,
  touchShouldersPose,
} from '../src/render/characters/preview_framing';
import {
  applyTouchStep,
  clampTouchView,
  framingDistance,
  isDoubleTap,
  TOUCH_AIM_FLOOR_Y,
  TOUCH_AIM_HEADROOM,
  TOUCH_DOUBLE_TAP_MS,
  TOUCH_MAX_DIST_SHARE,
  TOUCH_MIN_DIST_SHARE,
  TOUCH_PAN_X_LIMIT,
  TOUCH_PITCH_MAX,
  TOUCH_PITCH_MIN,
  TOUCH_TILT_PER_PX,
  type TouchPoint,
  type TouchStep,
  touchHintOffered,
  touchStepBetween,
  touchStepMoves,
  touchViewAt,
  touchViewPose,
} from '../src/render/characters/preview_touch_core';

// The launcher turntable's touch stage (a phone): the camera rides a path between the
// creator's head-and-shoulders framing and the whole body, a pinch moves it along that path,
// two fingers slide it, one finger tilts it, and nothing the fingers do can lose the
// character off the stage.

const sheet = PREVIEW_FRAMING.sheet;
const FAR: PreviewCamPose = { x: 0, y: sheet.y, z: sheet.z, lookY: sheet.lookY };
// a phone's creator stage (wide, short), and a WOC body's head as the stage measures it (its
// eye line and head height: a WOC body stands about three units tall)
const HEAD_Y = 2.64;
const HEAD_H = 0.58;
const NEAR = touchShouldersPose(390 / 300, HEAD_Y, HEAD_H);
const STAGE_PX = 300;
const FOV = 45;

const pts = (...p: [number, number, number][]): Map<number, TouchPoint> =>
  new Map(p.map(([id, x, y]) => [id, { x, y }]));
const step = (s: Partial<TouchStep>): TouchStep => ({
  dragX: 0,
  dragY: 0,
  pinch: 1,
  slideX: 0,
  slideY: 0,
  ...s,
});

describe('touchShouldersPose (the touch stage opening shot)', () => {
  it('frames the head and shoulders: closer than the whole body, the face above centre', () => {
    expect(NEAR.z).toBeLessThan(FAR.z / 2);
    expect(NEAR.x).toBe(0);
    // the aim sits below the head centre, so the face rides in the upper part of the frame
    expect(NEAR.lookY).toBeLessThan(HEAD_Y);
    // the head and its shoulders fit in the frame, about two and a half head heights
    const visibleH = 2 * NEAR.z * Math.tan((FOV * Math.PI) / 360);
    expect(visibleH).toBeGreaterThan(HEAD_H * 2.3);
    expect(visibleH).toBeLessThan(HEAD_H * 2.6);
    // the head's top stays inside the frame
    expect(HEAD_Y + HEAD_H / 2).toBeLessThan(NEAR.lookY + visibleH / 2);
  });

  it('pulls back on a narrow stage so the shoulders still fit the width', () => {
    const wide = touchShouldersPose(1.6, HEAD_Y, HEAD_H);
    const narrow = touchShouldersPose(0.5, HEAD_Y, HEAD_H);
    expect(narrow.z).toBeGreaterThan(wide.z);
  });

  it('falls back to the fixed head height without a measure', () => {
    const p = touchShouldersPose(1.2);
    expect(p.lookY).toBeLessThan(CREATION_HEAD_Y);
    expect(p.z).toBeGreaterThan(0.5);
    expect(Number.isFinite(touchShouldersPose(Number.NaN).z)).toBe(true);
  });
});

describe('touchStepBetween', () => {
  it('reads a one-finger drag', () => {
    expect(touchStepBetween(pts([1, 10, 20]), pts([1, 25, 14]))).toEqual(
      step({ dragX: 15, dragY: -6 }),
    );
  });

  it('reads a two-finger pinch and slide together', () => {
    const s = touchStepBetween(pts([1, 100, 100], [2, 200, 100]), pts([1, 80, 110], [2, 240, 110]));
    expect(s.pinch).toBeCloseTo(160 / 100, 6);
    expect(s.slideX).toBeCloseTo(10, 6);
    expect(s.slideY).toBeCloseTo(10, 6);
    expect(s.dragX).toBe(0);
    expect(s.dragY).toBe(0);
  });

  it('is empty when a finger lands or lifts, so a joining finger never jumps the camera', () => {
    const empty = step({});
    expect(touchStepBetween(pts([1, 0, 0]), pts([1, 0, 0], [2, 50, 50]))).toEqual(empty);
    expect(touchStepBetween(pts([1, 0, 0], [2, 50, 50]), pts([1, 5, 5]))).toEqual(empty);
    expect(touchStepBetween(pts([1, 0, 0]), pts([3, 40, 40]))).toEqual(empty);
    expect(touchStepBetween(pts(), pts())).toEqual(empty);
  });

  it('never divides by two fingers on one spot', () => {
    const s = touchStepBetween(pts([1, 50, 50], [2, 50, 50]), pts([1, 50, 50], [2, 90, 50]));
    expect(s.pinch).toBe(1);
  });
});

describe('applyTouchStep', () => {
  const open = touchViewAt(NEAR);

  it('a spreading pinch moves the camera closer, a closing one farther', () => {
    expect(applyTouchStep(open, step({ pinch: 1.25 }), NEAR, FAR, STAGE_PX, FOV).dist).toBeCloseTo(
      framingDistance(NEAR) / 1.25,
      6,
    );
    expect(applyTouchStep(open, step({ pinch: 0.5 }), NEAR, FAR, STAGE_PX, FOV).dist).toBeCloseTo(
      framingDistance(NEAR) * 2,
      6,
    );
  });

  it('clamps the zoom between a face close-up and a little past the whole body', () => {
    const inMost = applyTouchStep(open, step({ pinch: 50 }), NEAR, FAR, STAGE_PX, FOV);
    expect(inMost.dist).toBeCloseTo(framingDistance(NEAR) * TOUCH_MIN_DIST_SHARE, 6);
    const outMost = applyTouchStep(open, step({ pinch: 0.01 }), NEAR, FAR, STAGE_PX, FOV);
    expect(outMost.dist).toBeCloseTo(framingDistance(FAR) * TOUCH_MAX_DIST_SHARE, 6);
  });

  it('the character follows the fingers: a slide right moves the aim left, down moves it up', () => {
    const v = applyTouchStep(open, step({ slideX: 30, slideY: 20 }), NEAR, FAR, STAGE_PX, FOV);
    const unitsPerPx = (2 * framingDistance(NEAR) * Math.tan((FOV * Math.PI) / 360)) / STAGE_PX;
    expect(v.panX).toBeCloseTo(-30 * unitsPerPx, 6);
    expect(v.panY).toBeCloseTo(20 * unitsPerPx, 6);
  });

  it('a vertical one-finger drag tilts the camera, within its limits', () => {
    const v = applyTouchStep(open, step({ dragY: 40 }), NEAR, FAR, STAGE_PX, FOV);
    expect(v.pitch).toBeCloseTo(40 * TOUCH_TILT_PER_PX, 6);
    expect(applyTouchStep(open, step({ dragY: 1e5 }), NEAR, FAR, STAGE_PX, FOV).pitch).toBe(
      TOUCH_PITCH_MAX,
    );
    expect(applyTouchStep(open, step({ dragY: -1e5 }), NEAR, FAR, STAGE_PX, FOV).pitch).toBe(
      TOUCH_PITCH_MIN,
    );
  });

  it('a slide can never lose the character: the aim stays on the body', () => {
    const far = applyTouchStep(open, step({ slideX: -1e5, slideY: 1e5 }), NEAR, FAR, STAGE_PX, FOV);
    const pose = touchViewPose(far, NEAR, FAR);
    expect(pose.x).toBeCloseTo(TOUCH_PAN_X_LIMIT, 6);
    expect(pose.lookY).toBeCloseTo(Math.max(NEAR.lookY, FAR.lookY) + TOUCH_AIM_HEADROOM, 6);
    const low = applyTouchStep(open, step({ slideX: 1e5, slideY: -1e5 }), NEAR, FAR, STAGE_PX, FOV);
    const lowPose = touchViewPose(low, NEAR, FAR);
    expect(lowPose.x).toBeCloseTo(-TOUCH_PAN_X_LIMIT, 6);
    expect(lowPose.lookY).toBeCloseTo(TOUCH_AIM_FLOOR_Y, 6);
  });

  it('a stage with no height moves nothing on a slide', () => {
    const v = applyTouchStep(open, step({ slideX: 30, slideY: 30 }), NEAR, FAR, 0, FOV);
    expect(v.panX).toBe(0);
    expect(v.panY).toBe(0);
  });
});

describe('touchViewPose', () => {
  it('never clamps the opening shot of a stage (the aim limits follow the body, not a height)', () => {
    // a fixed "over the head" height of 2.05 once pulled this body's face shot down to its chest
    for (const [aspect, h, y] of [
      [0.91, 0.58, 2.64],
      [1.6, 0.58, 2.64],
      [0.91, 0.4, 1.9],
    ] as const) {
      const near = touchShouldersPose(aspect, y, h);
      expect(touchViewPose(touchViewAt(near), near, FAR).lookY).toBeCloseTo(near.lookY, 6);
    }
  });

  it('the opening views ARE the two framings', () => {
    const near = touchViewPose(touchViewAt(NEAR), NEAR, FAR);
    expect(near.x).toBeCloseTo(NEAR.x, 6);
    expect(near.y).toBeCloseTo(NEAR.y, 6);
    expect(near.z).toBeCloseTo(NEAR.z, 6);
    expect(near.lookY).toBeCloseTo(NEAR.lookY, 6);
    const far = touchViewPose(touchViewAt(FAR), NEAR, FAR);
    expect(far.y).toBeCloseTo(FAR.y, 6);
    expect(far.z).toBeCloseTo(FAR.z, 6);
    expect(far.lookY).toBeCloseTo(FAR.lookY, 6);
  });

  it('zooming out glides the aim from the shoulders down to the whole body', () => {
    const mid = touchViewPose(
      { ...touchViewAt(NEAR), dist: Math.sqrt(framingDistance(NEAR) * framingDistance(FAR)) },
      NEAR,
      FAR,
    );
    expect(mid.lookY).toBeLessThan(NEAR.lookY);
    expect(mid.lookY).toBeGreaterThan(FAR.lookY);
  });

  it('a tilt raises the camera on its arc around the aim, at the same distance', () => {
    const base = touchViewPose(touchViewAt(NEAR), NEAR, FAR);
    const tilted = touchViewPose({ ...touchViewAt(NEAR), pitch: 0.4 }, NEAR, FAR);
    expect(tilted.y).toBeGreaterThan(base.y);
    expect(tilted.lookY).toBeCloseTo(base.lookY, 6);
    const r = (p: PreviewCamPose) => Math.hypot(p.y - p.lookY, p.z);
    expect(r(tilted)).toBeCloseTo(r(base), 6);
  });

  it('clampTouchView pulls an out-of-range view back inside', () => {
    const v = clampTouchView({ dist: 999, panX: 9, panY: -9, pitch: 9 }, NEAR, FAR);
    expect(v.dist).toBeCloseTo(framingDistance(FAR) * TOUCH_MAX_DIST_SHARE, 6);
    expect(v.pitch).toBe(TOUCH_PITCH_MAX);
    const pose = touchViewPose(v, NEAR, FAR);
    expect(pose.x).toBeCloseTo(TOUCH_PAN_X_LIMIT, 6);
    expect(pose.lookY).toBeCloseTo(TOUCH_AIM_FLOOR_Y, 6);
  });
});

describe('isDoubleTap', () => {
  it('takes two quick taps on one spot, and nothing else', () => {
    const first = { t: 1000, x: 100, y: 100 };
    expect(isDoubleTap(null, first)).toBe(false);
    expect(isDoubleTap(first, { t: 1000 + TOUCH_DOUBLE_TAP_MS - 1, x: 108, y: 96 })).toBe(true);
    expect(isDoubleTap(first, { t: 1000 + TOUCH_DOUBLE_TAP_MS + 1, x: 100, y: 100 })).toBe(false);
    expect(isDoubleTap(first, { t: 1100, x: 200, y: 100 })).toBe(false);
  });
});

describe('touchStepMoves (what retires the gesture hint)', () => {
  const still: TouchStep = { dragX: 0, dragY: 0, pinch: 1, slideX: 0, slideY: 0 };

  it('is false for the empty step a finger landing or lifting sends', () => {
    expect(touchStepMoves(still)).toBe(false);
    // the real empty step, from a change of shape
    const one = new Map<number, TouchPoint>([[1, { x: 10, y: 10 }]]);
    const two = new Map<number, TouchPoint>([
      [1, { x: 10, y: 10 }],
      [2, { x: 60, y: 10 }],
    ]);
    expect(touchStepMoves(touchStepBetween(one, two))).toBe(false);
  });

  it('is true for each way the fingers move the model, alone', () => {
    expect(touchStepMoves({ ...still, dragX: 1 })).toBe(true);
    expect(touchStepMoves({ ...still, dragY: -1 })).toBe(true);
    expect(touchStepMoves({ ...still, pinch: 1.05 })).toBe(true);
    expect(touchStepMoves({ ...still, pinch: 0.95 })).toBe(true);
    expect(touchStepMoves({ ...still, slideX: 2 })).toBe(true);
    expect(touchStepMoves({ ...still, slideY: -2 })).toBe(true);
  });
});

describe('touchHintOffered (the phone creator beside a drawn model)', () => {
  const all = { touch: true, creator: true, visible: true, drawn: true };

  it('is offered on a visible touch creator whose model draws', () => {
    expect(touchHintOffered(all)).toBe(true);
  });

  it('is withheld when any one fact is missing', () => {
    expect(touchHintOffered({ ...all, touch: false })).toBe(false);
    expect(touchHintOffered({ ...all, creator: false })).toBe(false);
    expect(touchHintOffered({ ...all, visible: false })).toBe(false);
    expect(touchHintOffered({ ...all, drawn: false })).toBe(false);
  });
});
