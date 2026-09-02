// The screen-area bounds on the two world-sized additive VFX surfaces (the
// impact flipbook quad and the weapon-skin point sprites). The contract these
// pins hold is that the bound is INERT at ordinary camera distances and only
// trims the degenerate close-range case, so the change stays cosmetic.

import { describe, expect, it } from 'vitest';
import {
  boundQuadSize,
  DEFAULT_WEAPON_POINT_MAX_PX,
  IMPACT_QUAD_MAX_SCREEN_FRACTION,
  maxPointSizePx,
  maxWorldQuadSize,
  tanHalfVerticalFov,
  WEAPON_POINT_MAX_SCREEN_FRACTION,
} from '../src/render/vfx_screen_bounds_core';

/** The world camera's vertical fov (src/render/renderer.ts builds a 60-degree
 *  perspective camera; the exact value only scales the numbers below). */
const TAN_HALF = tanHalfVerticalFov(60);

describe('maxWorldQuadSize', () => {
  it('is the quad height that covers exactly the allowed fraction', () => {
    // A quad of height h at distance d covers h / (2 d tan(vfov/2)) of the
    // viewport height, so the bound inverted must reproduce the fraction.
    const bound = maxWorldQuadSize(10, TAN_HALF, 0.85);
    expect(bound / (2 * 10 * TAN_HALF)).toBeCloseTo(0.85, 10);
  });

  it('grows with distance, so a far quad is never trimmed by a near bound', () => {
    expect(maxWorldQuadSize(20, TAN_HALF, 0.85)).toBeCloseTo(
      2 * maxWorldQuadSize(10, TAN_HALF, 0.85),
      10,
    );
  });

  it('refuses to bound anything when the camera terms are unusable', () => {
    expect(maxWorldQuadSize(0, TAN_HALF, 0.85)).toBe(Number.POSITIVE_INFINITY);
    expect(maxWorldQuadSize(10, 0, 0.85)).toBe(Number.POSITIVE_INFINITY);
    expect(maxWorldQuadSize(10, TAN_HALF, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('boundQuadSize', () => {
  it('leaves the authored sheet untouched at the default camera boom', () => {
    // src/game/input.ts camDist defaults to 12 yards; the sequencer's boosted
    // impact sheet is about 7 yards across and grows to 1.2x over its life.
    for (const size of [4.4, 7, 8.4]) {
      expect(boundQuadSize(size, 12, TAN_HALF, IMPACT_QUAD_MAX_SCREEN_FRACTION)).toBe(size);
    }
  });

  it('trims only once the player has zoomed most of the way in', () => {
    // camDist floors at 3 yards, where an 8.4-yard sheet is well over a screen.
    const trimmed = boundQuadSize(8.4, 3, TAN_HALF, IMPACT_QUAD_MAX_SCREEN_FRACTION);
    expect(trimmed).toBeLessThan(8.4);
    expect(trimmed / (2 * 3 * TAN_HALF)).toBeCloseTo(IMPACT_QUAD_MAX_SCREEN_FRACTION, 10);
  });

  it('never enlarges a small quad up to the bound', () => {
    expect(boundQuadSize(0.5, 2, TAN_HALF, IMPACT_QUAD_MAX_SCREEN_FRACTION)).toBe(0.5);
  });
});

describe('maxPointSizePx', () => {
  it('scales with the viewport height', () => {
    expect(maxPointSizePx(1080)).toBeCloseTo(1080 * WEAPON_POINT_MAX_SCREEN_FRACTION, 10);
    expect(maxPointSizePx(2160)).toBeCloseTo(2 * maxPointSizePx(1080), 10);
  });

  it('falls back to the 1080p reference when no height is known', () => {
    expect(maxPointSizePx(0)).toBe(DEFAULT_WEAPON_POINT_MAX_PX);
    expect(maxPointSizePx(Number.NaN)).toBe(DEFAULT_WEAPON_POINT_MAX_PX);
    expect(DEFAULT_WEAPON_POINT_MAX_PX).toBeCloseTo(maxPointSizePx(1080), 10);
  });

  it('stays above the sprite sizes a normal weapon distance produces', () => {
    // weapon_vfx.ts: gl_PointSize = aSize * uScale / -mv.z, with uScale derived
    // from the viewport height at a 35-degree vertical fov. A held weapon sits
    // several yards from the camera, and authored mote sizes are well under a
    // yard, so the clamp must not be reachable there.
    const uScale = (1080 * 0.5) / Math.tan((35 * Math.PI) / 360);
    const sizeAt = (aSize: number, depth: number) => (aSize * uScale) / depth;
    expect(sizeAt(0.2, 6)).toBeLessThan(maxPointSizePx(1080));
    // ... and reachable where the weapon is nearly on the near plane.
    expect(sizeAt(0.2, 0.3)).toBeGreaterThan(maxPointSizePx(1080));
  });
});

describe('tanHalfVerticalFov', () => {
  it('converts three camera.fov degrees to the half-angle tangent', () => {
    expect(tanHalfVerticalFov(90)).toBeCloseTo(1, 10);
    expect(tanHalfVerticalFov(60)).toBeCloseTo(Math.tan(Math.PI / 6), 10);
  });
});
