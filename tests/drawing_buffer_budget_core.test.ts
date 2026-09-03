import { describe, expect, it } from 'vitest';
import {
  drawingBufferRatio,
  MIN_DRAWING_BUFFER_RATIO,
} from '../src/render/drawing_buffer_budget_core';
import { type GfxAaTier, gfxAaPolicy } from '../src/render/gfx_aa_policy_core';

const TIERS: readonly GfxAaTier[] = ['low', 'medium', 'high', 'ultra', 'insane'];

/** The buffer three allocates for a CSS size at a ratio (WebGLRenderer.setSize floors). */
function drawingBufferSize(cssWidth: number, cssHeight: number, ratio: number) {
  return {
    width: Math.max(1, Math.floor(cssWidth * ratio)),
    height: Math.max(1, Math.floor(cssHeight * ratio)),
  };
}

function ratioFor(
  tier: GfxAaTier,
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  hints?: Parameters<typeof gfxAaPolicy>[1],
) {
  const policy = gfxAaPolicy(tier, hints);
  return drawingBufferRatio({
    cssWidth,
    cssHeight,
    devicePixelRatio,
    pixelRatioCap: policy.pixelRatioCap,
    maxDrawingBufferPixels: policy.maxDrawingBufferPixels,
  });
}

function bufferFor(
  tier: GfxAaTier,
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): { width: number; height: number; pixels: number } {
  const { ratio } = ratioFor(tier, cssWidth, cssHeight, devicePixelRatio);
  const size = drawingBufferSize(cssWidth, cssHeight, ratio);
  return { ...size, pixels: size.width * size.height };
}

describe('drawing-buffer pixel budget', () => {
  it('leaves a 1080p panel untouched on every tier at DPR 1 and at 125 percent scaling', () => {
    for (const tier of TIERS) {
      const native = ratioFor(tier, 1920, 1080, 1);
      expect(native, tier).toEqual({ ratio: 1, bound: 'dpr', budgetBound: false });
      expect(bufferFor(tier, 1920, 1080, 1)).toEqual({
        width: 1920,
        height: 1080,
        pixels: 2073600,
      });
      // 125 percent OS scaling: the CSS viewport is 1536x864, the buffer is still the panel.
      const scaled = ratioFor(tier, 1536, 864, 1.25);
      expect(scaled, tier).toEqual({ ratio: 1.25, bound: 'dpr', budgetBound: false });
      expect(bufferFor(tier, 1536, 864, 1.25)).toEqual({
        width: 1920,
        height: 1080,
        pixels: 2073600,
      });
    }
  });

  it('leaves a 2560x1440 panel at DPR 1 untouched on high, ultra and insane', () => {
    for (const tier of ['high', 'ultra', 'insane'] as const) {
      expect(ratioFor(tier, 2560, 1440, 1), tier).toEqual({
        ratio: 1,
        bound: 'dpr',
        budgetBound: false,
      });
    }
  });

  it('renders a 3440x1440 ultrawide at DPR 1 on high at the 1440p-class budget', () => {
    const result = ratioFor('high', 3440, 1440, 1);
    expect(result.bound).toBe('budget');
    expect(result.budgetBound).toBe(true);
    expect(result.ratio).toBeLessThan(1);
    const buffer = bufferFor('high', 3440, 1440, 1);
    expect(buffer.pixels).toBeLessThanOrEqual(gfxAaPolicy('high').maxDrawingBufferPixels);
    // The whole budget is spent, not a step below it (floor rounding aside).
    expect(buffer.pixels).toBeGreaterThan(gfxAaPolicy('high').maxDrawingBufferPixels * 0.995);
    // The aspect ratio is preserved: the budget scales both axes by one ratio.
    expect(buffer.width / buffer.height).toBeCloseTo(3440 / 1440, 2);
  });

  it('renders a 4K panel at DPR 1 on ultra at the 1440p-plus budget', () => {
    const result = ratioFor('ultra', 3840, 2160, 1);
    expect(result.bound).toBe('budget');
    const buffer = bufferFor('ultra', 3840, 2160, 1);
    expect(buffer.pixels).toBeLessThanOrEqual(gfxAaPolicy('ultra').maxDrawingBufferPixels);
    expect(buffer.pixels).toBeGreaterThan(gfxAaPolicy('ultra').maxDrawingBufferPixels * 0.995);
    // A 1440p-class buffer, not a 1080p one: the panel keeps most of its sharpness.
    expect(buffer.height).toBeGreaterThan(1440);
    expect(buffer.height).toBeLessThan(2160);
    // A 4K panel on high lands on the 1440p class exactly as the policy names it.
    const high = bufferFor('high', 3840, 2160, 1);
    expect(high.height).toBeGreaterThanOrEqual(1440);
    expect(high.height).toBeLessThan(1500);
  });

  it('keeps the smaller of the DPR cap and the budget on a Retina medium session', () => {
    // 2880x1800 panel, CSS 1440x900 at DPR 2: the 1.48 cap gives 2131x1332 (2.84 Mpx)
    // which is over the 1080p-class budget, so the budget is the smaller lever here.
    const result = ratioFor('medium', 1440, 900, 2);
    expect(result.ratio).toBeLessThanOrEqual(1.48);
    expect(result.ratio).toBeLessThan(2);
    const buffer = bufferFor('medium', 1440, 900, 2);
    expect(buffer.pixels).toBeLessThanOrEqual(gfxAaPolicy('medium').maxDrawingBufferPixels);
    // And where the cap is the smaller one it still wins: a 13-inch Retina on high
    // (CSS 1280x800 at DPR 2 under the 1.75 cap is 2240x1400, under the 1440p class).
    expect(ratioFor('high', 1280, 800, 2)).toEqual({
      ratio: 1.75,
      bound: 'cap',
      budgetBound: false,
    });
  });

  it('never exceeds the DPR and never drops below the legibility floor', () => {
    // A page zoomed out to DPR 0.25 keeps its DPR (the floor never raises the ratio).
    expect(ratioFor('ultra', 1920, 1080, 0.25)).toEqual({
      ratio: 0.25,
      bound: 'dpr',
      budgetBound: false,
    });
    // A DPR under the floor stays the DPR's own bound even when the budget would
    // cut deeper (a zoomed-out page on an 8K panel wants 0.27): the floor only raises.
    expect(ratioFor('low', 7680, 4320, 0.4)).toEqual({
      ratio: 0.4,
      bound: 'dpr',
      budgetBound: true,
    });
    // An 8K panel at DPR 1 on low would want 0.29; it floors at 0.5 and runs over budget.
    const eightK = ratioFor('low', 7680, 4320, 1);
    expect(eightK.ratio).toBe(MIN_DRAWING_BUFFER_RATIO);
    expect(eightK.bound).toBe('floor');
    expect(eightK.budgetBound).toBe(true);
    for (const tier of TIERS) {
      for (const [w, h, dpr] of [
        [1920, 1080, 1],
        [3840, 2160, 1],
        [3840, 2160, 2],
        [1440, 900, 2],
        [1024, 1366, 2],
        [7680, 4320, 1],
      ] as const) {
        const { ratio } = ratioFor(tier, w, h, dpr);
        expect(ratio, `${tier} ${w}x${h}@${dpr}`).toBeLessThanOrEqual(dpr);
        expect(ratio, `${tier} ${w}x${h}@${dpr}`).toBeGreaterThanOrEqual(
          Math.min(dpr, MIN_DRAWING_BUFFER_RATIO),
        );
      }
    }
  });

  it('keeps the stricter WebKit DPR caps as the binding lever on phone and tablet viewports', () => {
    // An iPad Pro 12.9 in landscape (CSS 1366x1024 at DPR 2) under the iOS cap.
    expect(ratioFor('high', 1366, 1024, 2, { iosMemoryProfile: true })).toEqual({
      ratio: 1.25,
      bound: 'cap',
      budgetBound: false,
    });
    expect(ratioFor('high', 1366, 1024, 3, { iosMemoryProfile: true, tightMemory: true })).toEqual({
      ratio: 1,
      bound: 'cap',
      budgetBound: false,
    });
  });

  it('disables the budget on Infinity or zero and tolerates degenerate inputs', () => {
    const off = drawingBufferRatio({
      cssWidth: 3840,
      cssHeight: 2160,
      devicePixelRatio: 1,
      pixelRatioCap: 1.75,
      maxDrawingBufferPixels: Number.POSITIVE_INFINITY,
    });
    expect(off).toEqual({ ratio: 1, bound: 'dpr', budgetBound: false });
    expect(
      drawingBufferRatio({
        cssWidth: 3840,
        cssHeight: 2160,
        devicePixelRatio: 1,
        pixelRatioCap: 1.75,
        maxDrawingBufferPixels: 0,
      }).ratio,
    ).toBe(1);
    expect(
      drawingBufferRatio({
        cssWidth: 0,
        cssHeight: Number.NaN,
        devicePixelRatio: Number.NaN,
        pixelRatioCap: Number.NaN,
        maxDrawingBufferPixels: 2_400_000,
      }),
    ).toEqual({ ratio: 1, bound: 'dpr', budgetBound: false });
  });
});
