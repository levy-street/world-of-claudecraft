import { describe, expect, it } from 'vitest';
import {
  AO_FULL_RES_MAX_PIXELS,
  AO_FULL_RES_TAPS_PER_PIXEL,
  AO_HALF_RES_TAPS_PER_PIXEL,
  AO_REFERENCE_PIXELS,
  resolveAoFullRes,
} from '../src/render/post_pixel_budget_core';

// Node-only (RENDER_PURE_CORES): no Three, no DOM.
describe('AO pixel budget', () => {
  it('counts both arms off the pinned n8ao quality modes', () => {
    // full-res Medium: evaluate (beauty + depth + 9 normal taps + noise + 16
    // samples), two 8-sample denoise passes, then a 3-tap composite.
    expect(AO_FULL_RES_TAPS_PER_PIXEL).toBe(28 + 2 * 19 + 3);
    // half-res Low: a quarter-rate downsample + evaluate + two 4-sample
    // denoise passes, then the FULL-rate depth-aware upsample in the composite.
    expect(AO_HALF_RES_TAPS_PER_PIXEL).toBeCloseTo(0.25 * (13 + 20 + 2 * 11) + 29, 10);
    // The half-res arm is a real saving, but nowhere near a quarter: it buys
    // back a full-resolution bilateral upsample.
    expect(AO_HALF_RES_TAPS_PER_PIXEL).toBeGreaterThan(AO_FULL_RES_TAPS_PER_PIXEL / 4);
    expect(AO_HALF_RES_TAPS_PER_PIXEL).toBeLessThan(AO_FULL_RES_TAPS_PER_PIXEL);
  });

  it('places the cut where the full-res upgrade costs a whole 1080p chain', () => {
    expect(AO_REFERENCE_PIXELS).toBe(1920 * 1080);
    const upgradeAtThreshold =
      AO_FULL_RES_MAX_PIXELS * (AO_FULL_RES_TAPS_PER_PIXEL - AO_HALF_RES_TAPS_PER_PIXEL);
    const referenceChain = AO_FULL_RES_TAPS_PER_PIXEL * AO_REFERENCE_PIXELS;
    // Floored, so the threshold is at or just under the budget, never over.
    expect(upgradeAtThreshold).toBeLessThanOrEqual(referenceChain);
    expect(upgradeAtThreshold).toBeGreaterThan(
      referenceChain - (AO_FULL_RES_TAPS_PER_PIXEL - AO_HALF_RES_TAPS_PER_PIXEL),
    );
    expect(AO_FULL_RES_MAX_PIXELS).toBe(5450605);
  });

  it('keeps full-res AO through 1440p and drops it at 4K', () => {
    const panels: Array<[string, number, number, boolean]> = [
      ['720p', 1280, 720, true],
      ['1080p', 1920, 1080, true],
      ['1440p', 2560, 1440, true],
      ['1440p ultrawide', 3440, 1440, true],
      ['1600p', 2560, 1600, true],
      ['4K', 3840, 2160, false],
      ['5K', 5120, 2880, false],
    ];
    for (const [name, width, height, fullRes] of panels) {
      expect({ name, fullRes: resolveAoFullRes(true, width * height) }).toEqual({ name, fullRes });
    }
  });

  it('never promotes a tier that did not ask for full-res AO', () => {
    expect(resolveAoFullRes(false, 1)).toBe(false);
    expect(resolveAoFullRes(false, 1920 * 1080)).toBe(false);
    expect(resolveAoFullRes(false, 3840 * 2160)).toBe(false);
    // Not even on the degenerate buffer the request arm honours.
    expect(resolveAoFullRes(false, 0)).toBe(false);
  });

  it('honours the request while the buffer has no usable measurement', () => {
    // A canvas that has not been laid out yet must not silently demote the
    // tier: the first real setSize re-resolves it.
    expect(resolveAoFullRes(true, 0)).toBe(true);
    expect(resolveAoFullRes(true, -1)).toBe(true);
    expect(resolveAoFullRes(true, Number.NaN)).toBe(true);
    expect(resolveAoFullRes(true, Number.POSITIVE_INFINITY)).toBe(true);
  });

  it('switches exactly at the threshold, not one pixel either side', () => {
    expect(resolveAoFullRes(true, AO_FULL_RES_MAX_PIXELS - 1)).toBe(true);
    expect(resolveAoFullRes(true, AO_FULL_RES_MAX_PIXELS)).toBe(true);
    expect(resolveAoFullRes(true, AO_FULL_RES_MAX_PIXELS + 1)).toBe(false);
  });
});
