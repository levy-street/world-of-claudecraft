import { describe, expect, it } from 'vitest';
import { normalizePointerLookDelta } from '../src/game/pointer_look_delta';

describe('normalizePointerLookDelta', () => {
  it('is identity on Chromium (physical pixels already, any devicePixelRatio)', () => {
    // Chrome parity: the deltas must pass through untouched no matter the ratio.
    expect(
      normalizePointerLookDelta({
        movementX: 12,
        movementY: -7,
        isGecko: false,
        devicePixelRatio: 2,
      }),
    ).toEqual({ dx: 12, dy: -7 });
    expect(
      normalizePointerLookDelta({
        movementX: 12,
        movementY: -7,
        isGecko: false,
        devicePixelRatio: 1,
      }),
    ).toEqual({ dx: 12, dy: -7 });
  });

  it('leaves Gecko unchanged at devicePixelRatio 1 (CSS pixel == physical pixel there)', () => {
    expect(
      normalizePointerLookDelta({
        movementX: 12,
        movementY: -7,
        isGecko: true,
        devicePixelRatio: 1,
      }),
    ).toEqual({ dx: 12, dy: -7 });
  });

  it('scales Gecko CSS-pixel deltas up to Chromium physical pixels on a 2x display', () => {
    // The reported Firefox bug: on a retina/HiDPI display Firefox reports half
    // the delta Chrome does, so multiplying by the ratio restores parity.
    expect(
      normalizePointerLookDelta({ movementX: 5, movementY: 3, isGecko: true, devicePixelRatio: 2 }),
    ).toEqual({ dx: 10, dy: 6 });
  });

  it('scales Gecko by fractional page-zoom ratios too', () => {
    expect(
      normalizePointerLookDelta({
        movementX: 4,
        movementY: 4,
        isGecko: true,
        devicePixelRatio: 1.5,
      }),
    ).toEqual({ dx: 6, dy: 6 });
  });

  it('reaches Chrome parity: same physical motion yields the same normalized delta on both engines', () => {
    const dpr = 2;
    const physical = 20; // what Chrome reports for a given physical mouse motion
    const chrome = normalizePointerLookDelta({
      movementX: physical,
      movementY: 0,
      isGecko: false,
      devicePixelRatio: dpr,
    });
    const firefox = normalizePointerLookDelta({
      movementX: physical / dpr, // Firefox reports CSS pixels for the same motion
      movementY: 0,
      isGecko: true,
      devicePixelRatio: dpr,
    });
    expect(firefox.dx).toBe(chrome.dx);
  });

  it('falls back to identity on a non-finite or non-positive ratio (never freezes or blows up the camera)', () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        normalizePointerLookDelta({
          movementX: 9,
          movementY: 2,
          isGecko: true,
          devicePixelRatio: bad,
        }),
      ).toEqual({ dx: 9, dy: 2 });
    }
  });
});
