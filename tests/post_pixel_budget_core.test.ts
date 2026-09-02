import { describe, expect, it } from 'vitest';
import {
  AO_ARM_HYSTERESIS,
  AO_FULL_RES_MAX_PIXELS,
  AO_FULL_RES_RELEASE_PIXELS,
  AO_FULL_RES_TAPS_PER_PIXEL,
  AO_HALF_RES_TAPS_PER_PIXEL,
  AO_REFERENCE_PIXELS,
  resolveAoFullRes,
} from '../src/render/post_pixel_budget_core';

// Node-only (RENDER_PURE_CORES): no Three, no DOM.
describe('AO pixel budget', () => {
  it('counts both arms off the shaders StaticOpaqueN8AOPass actually compiles', () => {
    // full-res Medium, AFTER post_n8ao.ts specializes it: evaluate (depth +
    // 8 normal taps, the centre one folded into the depth the caller holds,
    // + noise + 16 samples; the beauty fetch is deleted), two 8-sample denoise
    // passes, then a 3-tap composite. Upstream n8ao 2.0.0 would be 28 + 38 + 3.
    expect(AO_FULL_RES_TAPS_PER_PIXEL).toBe(26 + 2 * 19 + 3);
    // half-res Low: a quarter-rate downsample + evaluate (the beauty fetch is
    // deleted here too, and the normal comes from the downsample target) + two
    // 4-sample denoise passes, then the FULL-rate depth-aware upsample.
    expect(AO_HALF_RES_TAPS_PER_PIXEL).toBeCloseTo(0.25 * (13 + 19 + 2 * 11) + 29, 10);
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
    expect(AO_FULL_RES_MAX_PIXELS).toBe(5670661);
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

  it('holds the arm in force through the hysteresis band', () => {
    // One render-scale slider step wide, so no single step of that slider can
    // flip the arm and step back. Crossing relinks n8ao, which is the cost the
    // band exists to keep off a boundary wobble.
    expect(AO_ARM_HYSTERESIS).toBeCloseTo(1 / 0.95 ** 2, 10);
    expect(AO_FULL_RES_RELEASE_PIXELS).toBeGreaterThan(AO_FULL_RES_MAX_PIXELS);
    const inBand = Math.floor((AO_FULL_RES_MAX_PIXELS + AO_FULL_RES_RELEASE_PIXELS) / 2);

    // Inside the band each arm keeps what it has; a fresh resolve reads the cut.
    expect(resolveAoFullRes(true, inBand, true)).toBe(true);
    expect(resolveAoFullRes(true, inBand, false)).toBe(false);
    expect(resolveAoFullRes(true, inBand)).toBe(false);

    // Past the far edge the full-res arm gives up, and it only comes back at
    // the cut itself, so the two switch points differ.
    expect(resolveAoFullRes(true, AO_FULL_RES_RELEASE_PIXELS, true)).toBe(true);
    expect(resolveAoFullRes(true, AO_FULL_RES_RELEASE_PIXELS + 1, true)).toBe(false);
    expect(resolveAoFullRes(true, AO_FULL_RES_MAX_PIXELS + 1, false)).toBe(false);
    expect(resolveAoFullRes(true, AO_FULL_RES_MAX_PIXELS, false)).toBe(true);
  });

  it('flips once across a render-scale drag on a 4K panel, and once back', () => {
    // The repro the band exists for: setRenderScale goes through
    // applyResolution, so dragging the slider moves the drawing buffer straight
    // through the cut. Steps are 0.05 and the pixel count goes as the square.
    const pixelsAt = (scale: number) => Math.floor(3840 * scale) * Math.floor(2160 * scale);
    const down = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7];
    let arm = resolveAoFullRes(true, pixelsAt(1));
    expect(arm).toBe(false);
    let flips = 0;
    for (const scale of down) {
      const next = resolveAoFullRes(true, pixelsAt(scale), arm);
      if (next !== arm) flips++;
      arm = next;
    }
    expect(flips).toBe(1);
    expect(arm).toBe(true);

    flips = 0;
    for (const scale of [...down].reverse()) {
      const next = resolveAoFullRes(true, pixelsAt(scale), arm);
      if (next !== arm) flips++;
      arm = next;
    }
    expect(flips).toBe(1);
    expect(arm).toBe(false);
  });

  it('never lets the hysteresis band hand a 4K panel the full-res arm', () => {
    // The band must not be so wide that the panel this exists for sneaks back.
    expect(3840 * 2160).toBeGreaterThan(AO_FULL_RES_RELEASE_PIXELS);
    expect(resolveAoFullRes(true, 3840 * 2160, true)).toBe(false);
    expect(resolveAoFullRes(false, 2560 * 1440, true)).toBe(false);
  });
});
