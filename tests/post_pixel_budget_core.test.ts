import { describe, expect, it } from 'vitest';
import {
  AO_ARM_HYSTERESIS,
  AO_FULL_RES_MAX_PIXELS,
  AO_FULL_RES_MS_PER_MEGAPIXEL,
  AO_FULL_RES_RELEASE_PIXELS,
  AO_HALF_RES_MS_PER_MEGAPIXEL,
  AO_REFERENCE_PIXELS,
  resolveAoFullRes,
} from '../src/render/post_pixel_budget_core';

// Node-only (RENDER_PURE_CORES): no Three, no DOM.
describe('AO pixel budget', () => {
  it('prices both arms off the measured 3060 frame, not off a tap count', () => {
    // Windows 11, RTX 3060, ANGLE D3D11, 2005x1440 = 2.8872 Mpx, ultra, vsync
    // off, GPU timer queries per render call: full-res Medium 3.10 ms
    // (evaluate 1.70, two denoise passes 0.63 each, composite 0.14) and the
    // half-res Low arm 0.50 ms on the same frames.
    const measuredMegapixels = (2005 * 1440) / 1_000_000;
    expect(AO_FULL_RES_MS_PER_MEGAPIXEL * measuredMegapixels).toBeCloseTo(3.1, 6);
    expect(AO_HALF_RES_MS_PER_MEGAPIXEL * measuredMegapixels).toBeCloseTo(0.5, 6);
    // The half-res arm is a sixth of the full-res one on that host, not the
    // 0.63 the tap model predicted: it moves evaluate and both denoise passes
    // to a quarter of the pixels and the depth-aware upsample it buys back in
    // the composite prices near nothing.
    expect(AO_HALF_RES_MS_PER_MEGAPIXEL / AO_FULL_RES_MS_PER_MEGAPIXEL).toBeCloseTo(0.5 / 3.1, 6);
    expect(AO_HALF_RES_MS_PER_MEGAPIXEL).toBeLessThan(AO_FULL_RES_MS_PER_MEGAPIXEL / 4);
  });

  it('places the cut where the full-res upgrade costs a whole 1080p pass', () => {
    expect(AO_REFERENCE_PIXELS).toBe(1920 * 1080);
    const upgradeAtThreshold =
      AO_FULL_RES_MAX_PIXELS * (AO_FULL_RES_MS_PER_MEGAPIXEL - AO_HALF_RES_MS_PER_MEGAPIXEL);
    const referencePass = AO_FULL_RES_MS_PER_MEGAPIXEL * AO_REFERENCE_PIXELS;
    // Floored, so the threshold is at or just under the budget, never over.
    expect(upgradeAtThreshold).toBeLessThanOrEqual(referencePass);
    expect(upgradeAtThreshold).toBeGreaterThan(
      referencePass - (AO_FULL_RES_MS_PER_MEGAPIXEL - AO_HALF_RES_MS_PER_MEGAPIXEL),
    );
    // The 1080p class, and nothing above it.
    expect(AO_FULL_RES_MAX_PIXELS).toBe(2472369);
    expect(AO_FULL_RES_MAX_PIXELS).toBeGreaterThanOrEqual(1920 * 1200);
    expect(AO_FULL_RES_MAX_PIXELS).toBeLessThan(2560 * 1440);
  });

  it('keeps full-res AO through the 1080p class and drops it at 1440p', () => {
    const panels: Array<[string, number, number, boolean]> = [
      ['720p', 1280, 720, true],
      ['1080p', 1920, 1080, true],
      ['1200p', 1920, 1200, true],
      ['1440p', 2560, 1440, false],
      ['1440p ultrawide', 3440, 1440, false],
      ['1600p', 2560, 1600, false],
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
    expect(AO_FULL_RES_RELEASE_PIXELS).toBe(2739467);
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

  it('flips once across a render-scale drag on a 1440p panel, and once back', () => {
    // The repro the band exists for: setRenderScale goes through
    // applyResolution, so dragging the slider moves the drawing buffer straight
    // through the cut. Steps are 0.05 and the pixel count goes as the square.
    const pixelsAt = (scale: number) => Math.floor(2560 * scale) * Math.floor(1440 * scale);
    const down = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7];
    let arm = resolveAoFullRes(true, pixelsAt(1));
    expect(arm).toBe(false);
    let flips = 0;
    const downSwitches: number[] = [];
    for (const scale of down) {
      const next = resolveAoFullRes(true, pixelsAt(scale), arm);
      if (next !== arm) {
        flips++;
        downSwitches.push(scale);
      }
      arm = next;
    }
    expect(flips).toBe(1);
    expect(arm).toBe(true);

    flips = 0;
    const upSwitches: number[] = [];
    for (const scale of [...down].reverse()) {
      const next = resolveAoFullRes(true, pixelsAt(scale), arm);
      if (next !== arm) {
        flips++;
        upSwitches.push(scale);
      }
      arm = next;
    }
    expect(flips).toBe(1);
    expect(arm).toBe(false);
    // The band is what makes those two points differ: it drops to full-res on
    // the way down one step before it gives the arm back up on the way up.
    expect(downSwitches).toEqual([0.8]);
    expect(upSwitches).toEqual([0.9]);
  });

  it('never lets the hysteresis band hand a 1440p panel the full-res arm', () => {
    // The band must not be so wide that the panels this exists for sneak back.
    expect(2560 * 1440).toBeGreaterThan(AO_FULL_RES_RELEASE_PIXELS);
    expect(resolveAoFullRes(true, 2560 * 1440, true)).toBe(false);
    expect(resolveAoFullRes(true, 3440 * 1440, true)).toBe(false);
    expect(resolveAoFullRes(true, 3840 * 2160, true)).toBe(false);
    expect(resolveAoFullRes(false, 1920 * 1080, true)).toBe(false);
  });
});
