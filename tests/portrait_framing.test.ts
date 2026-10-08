import { describe, expect, it } from 'vitest';
import {
  HEAD_PORTRAIT_FRAMING,
  headshotAimForHead,
  type PortraitCameraAim,
  type PortraitHeadBounds,
  portraitFrameParams,
} from '../src/render/characters/portrait_framing';

describe('portraitFrameParams', () => {
  it('defaults to a tight head-and-shoulders crop for headshot framing', () => {
    const p = portraitFrameParams('headshot');
    expect(p.fov).toBe(26);
    expect(p.extentFrac).toBeCloseTo(0.44, 5);
  });

  it('body framing uses a wider, normal lens and shows most of the figure', () => {
    const p = portraitFrameParams('body');
    expect(p.fov).toBe(45);
    expect(p.extentFrac).toBeCloseTo(1.15, 5);
  });

  it('body framing shows strictly more of the model height than headshot (the fix: no more helmet-only crop)', () => {
    const headshot = portraitFrameParams('headshot');
    const body = portraitFrameParams('body');
    expect(body.extentFrac).toBeGreaterThan(headshot.extentFrac);
    // Headshot looks near the top of the figure; body looks at mid-height.
    expect(body.targetYFromFeetFrac).toBeLessThan(headshot.targetYFromFeetFrac);
  });
});

// The head-first headshot a WOC body takes (headshotAimForHead). Fixtures are the
// shipped heads as measured on the posed rigs (tmp/woc_portrait_v2/hair_probe.mjs):
// Type A and Type B, the eye line, the crown with and without hair.
const A_HEAD: PortraitHeadBounds = {
  baseMinY: 2.285,
  baseMaxY: 2.812,
  centerX: 0.005,
  centerZ: 0.1,
  eyeY: 2.581,
  topY: 2.86,
};
const B_HEAD: PortraitHeadBounds = {
  baseMinY: 2.257,
  baseMaxY: 2.796,
  centerX: 0.029,
  centerZ: 0.04,
  eyeY: 2.551,
  topY: 2.844,
};

/** The frame an aim shows at the head's depth: its top and bottom edges (world y). */
function frameOf(aim: PortraitCameraAim): { top: number; bottom: number } {
  return {
    top: aim.target[1] + aim.frameHeight / 2,
    bottom: aim.target[1] - aim.frameHeight / 2,
  };
}

/** Where a world point projects in the aim's square frame: 0..1 from the left and top. */
function projectInFrame(aim: PortraitCameraAim, [x, y, z]: readonly number[]): [number, number] {
  const depth = aim.position[2] - z;
  const halfAtDepth = depth * Math.tan((aim.fov * Math.PI) / 360);
  return [
    0.5 + (x - aim.position[0]) / (2 * halfAtDepth),
    0.5 - (y - aim.position[1]) / (2 * halfAtDepth),
  ];
}

const aimOf = (head: PortraitHeadBounds): PortraitCameraAim => {
  const aim = headshotAimForHead(head);
  if (!aim) throw new Error('expected an aim');
  return aim;
};

describe('headshotAimForHead', () => {
  const f = HEAD_PORTRAIT_FRAMING;

  it('looks straight at the face: centred horizontally, eyes about the upper third', () => {
    const aim = aimOf(A_HEAD);
    expect(aim.position[0]).toBe(A_HEAD.centerX);
    expect(aim.target[0]).toBe(A_HEAD.centerX);
    // level: no tilt, so the frame's verticals stay vertical
    expect(aim.position[1]).toBe(aim.target[1]);
    expect(aim.position[2]).toBeGreaterThan(A_HEAD.centerZ);
    expect(aim.fov).toBe(f.fov);
    expect(aim.eyeFromTop).toBe(f.eyeFromTop);
    expect(f.eyeFromTop).toBeGreaterThan(0.35);
    expect(f.eyeFromTop).toBeLessThan(0.5);
    const [u, v] = projectInFrame(aim, [A_HEAD.centerX, A_HEAD.eyeY ?? 0, A_HEAD.centerZ]);
    expect(u).toBeCloseTo(0.5, 9);
    expect(v).toBeCloseTo(f.eyeFromTop, 9);
  });

  it('is a close headshot: the whole head and neck in frame, the hair clear of the top, no chest', () => {
    for (const head of [A_HEAD, B_HEAD]) {
      const aim = aimOf(head);
      const { top, bottom } = frameOf(aim);
      expect(top - head.topY).toBeGreaterThanOrEqual(f.topMargin * aim.frameHeight - 1e-9);
      const neckToEye = (head.eyeY ?? 0) - head.baseMinY;
      // the neck stub and the collar line under it are in frame...
      expect(bottom).toBeLessThan(head.baseMinY);
      // ...but not a neck-to-eye height of torso: the owner's call (2026-09-30) was
      // more head, less body, so the chest and most of the shoulder armor stay out
      expect(bottom).toBeGreaterThan(head.baseMinY - 0.5 * neckToEye);
      // and the head and neck fill most of the frame height
      expect((head.topY - head.baseMinY) / aim.frameHeight).toBeGreaterThan(0.7);
    }
  });

  it('frames Type A and Type B faces at the same size (their eye rides the neck alike)', () => {
    const a = aimOf(A_HEAD);
    const b = aimOf(B_HEAD);
    expect(Math.abs(a.frameHeight / b.frameHeight - 1)).toBeLessThan(0.01);
    expect(a.eyeFromTop).toBe(b.eyeFromTop);
  });

  it('sizes the frame off the neck-to-eye height, never the crown a hairstyle moves', () => {
    // the bald crown morph shortens the base 9%: the face must not zoom in for it
    const bald = aimOf({ ...A_HEAD, baseMaxY: 2.765, topY: 2.765 });
    const haired = aimOf(A_HEAD);
    expect(bald.frameHeight).toBeCloseTo(haired.frameHeight, 12);
    expect(bald.frameHeight).toBeCloseTo(
      f.frameInNeckToEye * ((A_HEAD.eyeY ?? 0) - A_HEAD.baseMinY),
      12,
    );
    expect(bald.target[1]).toBeCloseTo(haired.target[1], 12);
  });

  it('frames the same face identically at every body scale', () => {
    const base = aimOf(A_HEAD);
    for (const s of [0.8, 0.9, 1.25]) {
      const scaled: PortraitHeadBounds = {
        baseMinY: A_HEAD.baseMinY * s,
        baseMaxY: A_HEAD.baseMaxY * s,
        centerX: A_HEAD.centerX * s,
        centerZ: A_HEAD.centerZ * s,
        eyeY: (A_HEAD.eyeY ?? 0) * s,
        topY: A_HEAD.topY * s,
      };
      const aim = aimOf(scaled);
      expect(aim.frameHeight).toBeCloseTo(base.frameHeight * s, 12);
      expect(aim.eyeFromTop).toBe(base.eyeFromTop);
      // every drawn point lands on the same spot of the frame
      for (const p of [
        [A_HEAD.centerX, A_HEAD.eyeY ?? 0, A_HEAD.centerZ],
        [0.3, A_HEAD.baseMinY, 0.2],
        [-0.2, A_HEAD.topY, 0],
      ]) {
        const [u0, v0] = projectInFrame(base, p);
        const [u1, v1] = projectInFrame(
          aim,
          p.map((c) => c * s),
        );
        expect(u1).toBeCloseTo(u0, 9);
        expect(v1).toBeCloseTo(v0, 9);
      }
    }
  });

  it('lowers the eye line for tall hair first, and only then pulls the camera back', () => {
    const base = aimOf(A_HEAD);
    // a topknot-high top: the eyes drop inside the allowance, the frame keeps its size
    const topknot = aimOf({ ...A_HEAD, topY: 2.906 });
    expect(topknot.eyeFromTop).toBeGreaterThan(base.eyeFromTop);
    expect(topknot.eyeFromTop).toBeLessThan(f.eyeFromTopMax);
    expect(topknot.frameHeight).toBeCloseTo(base.frameHeight, 12);
    // curls taller than the allowance: the eyes stop at the limit and the frame grows
    const curls = aimOf({ ...B_HEAD, topY: 2.953 });
    expect(curls.eyeFromTop).toBe(f.eyeFromTopMax);
    expect(curls.frameHeight).toBeGreaterThan(aimOf(B_HEAD).frameHeight);
    for (const [aim, topY] of [
      [topknot, 2.906],
      [curls, 2.953],
    ] as const) {
      // either way the frame is fitted to the hair: it clears the top edge by exactly
      // the margin, no less (cropped) and no more (a needlessly small face)
      const { top } = frameOf(aim);
      expect(top - topY).toBeCloseTo(f.topMargin * aim.frameHeight, 9);
    }
    // an ordinary hairstyle keeps MORE than the margin: the upper third already fits it
    const { top } = frameOf(base);
    expect(top - A_HEAD.topY).toBeGreaterThan(f.topMargin * base.frameHeight + 0.01);
  });

  it('never frames lower than the crown, and clamps a runaway measure', () => {
    // a top under the crown (a measure that missed the hair) still frames the crown
    const low = aimOf({ ...A_HEAD, topY: 2.0 });
    expect(frameOf(low).top - A_HEAD.baseMaxY).toBeGreaterThanOrEqual(
      f.topMargin * low.frameHeight - 1e-9,
    );
    // a bogus top miles up is clamped: the face keeps a readable size
    const runaway = aimOf({ ...A_HEAD, topY: 100 });
    const neckToEye = (A_HEAD.eyeY ?? 0) - A_HEAD.baseMinY;
    expect(runaway.frameHeight).toBeCloseTo(
      (f.maxTopRise * neckToEye) / (f.eyeFromTopMax - f.topMargin),
      9,
    );
    expect(runaway.frameHeight).toBeLessThan(5 * aimOf(A_HEAD).frameHeight);
    const nan = aimOf({ ...A_HEAD, topY: Number.NaN });
    expect(frameOf(nan).top).toBeGreaterThan(A_HEAD.baseMaxY);
    // an eye measured low in the base puts the runaway cap under the crown: the
    // crown still frames whole
    const lowEye = aimOf({ ...A_HEAD, eyeY: A_HEAD.baseMinY + 0.05, topY: 100 });
    expect(frameOf(lowEye).top - A_HEAD.baseMaxY).toBeGreaterThanOrEqual(
      f.topMargin * lowEye.frameHeight - 1e-9,
    );
  });

  it('falls back to the head base for the eye line when no eyes were measured', () => {
    for (const eyeY of [null, Number.NaN, 1.0, 3.5]) {
      const aim = aimOf({ ...A_HEAD, eyeY });
      const eye = A_HEAD.baseMinY + f.eyeFracFallback * (A_HEAD.baseMaxY - A_HEAD.baseMinY);
      const [, v] = projectInFrame(aim, [A_HEAD.centerX, eye, A_HEAD.centerZ]);
      expect(v, String(eyeY)).toBeCloseTo(aim.eyeFromTop, 9);
    }
    // the fallback sits on the measured eye lines of both shipped heads
    for (const head of [A_HEAD, B_HEAD]) {
      const frac = ((head.eyeY ?? 0) - head.baseMinY) / (head.baseMaxY - head.baseMinY);
      expect(Math.abs(frac - f.eyeFracFallback)).toBeLessThan(0.015);
    }
  });

  it('answers null for a degenerate measure, so the capture keeps its box framing', () => {
    expect(headshotAimForHead({ ...A_HEAD, baseMaxY: A_HEAD.baseMinY })).toBeNull();
    expect(headshotAimForHead({ ...A_HEAD, baseMaxY: A_HEAD.baseMinY - 0.1 })).toBeNull();
    expect(headshotAimForHead({ ...A_HEAD, baseMinY: Number.NaN })).toBeNull();
    expect(headshotAimForHead({ ...A_HEAD, centerX: Number.POSITIVE_INFINITY })).toBeNull();
    expect(headshotAimForHead({ ...A_HEAD, centerZ: Number.NaN })).toBeNull();
  });

  it('takes a tuning override (the tuning loop and the tests share one function)', () => {
    const wide = headshotAimForHead(A_HEAD, { ...f, frameInNeckToEye: 2 * f.frameInNeckToEye });
    expect(wide?.frameHeight).toBeCloseTo(2 * aimOf(A_HEAD).frameHeight, 12);
  });
});
