import { describe, expect, it } from 'vitest';
import {
  dynamicResolutionAllocationScale,
  dynamicResolutionGovernorRange,
  dynamicResolutionRect,
  MIN_DYNAMIC_RENDER_SCALE,
} from '../src/render/dynamic_resolution_core';

describe('dynamic resolution rectangle', () => {
  it('keeps the live rectangle on whole device pixels within the fixed target', () => {
    const rect = dynamicResolutionRect({
      logicalWidth: 1441,
      logicalHeight: 901,
      pixelRatio: 1.75,
      renderScale: 0.68,
      maxRenderScale: 1,
      minRenderScale: MIN_DYNAMIC_RENDER_SCALE,
    });

    expect(rect.targetWidth).toBe(2521);
    expect(rect.targetHeight).toBe(1576);
    expect(rect.renderWidth).toBe(1714);
    expect(rect.renderHeight).toBe(1072);
    expect(Number.isInteger(rect.renderWidth)).toBe(true);
    expect(Number.isInteger(rect.renderHeight)).toBe(true);
    expect(rect.renderWidth).toBeLessThanOrEqual(rect.targetWidth);
    expect(rect.renderHeight).toBeLessThanOrEqual(rect.targetHeight);
    expect(rect.uvScaleX).toBe(1714 / 2521);
    expect(rect.uvScaleY).toBe(1072 / 1576);
    expect(rect.uvMaxX).toBe(1713.5 / 2521);
    expect(rect.uvMaxY).toBe(1071.5 / 1576);
  });

  it('clamps automatic scaling at the 0.68 floor before integer conversion', () => {
    const rect = dynamicResolutionRect({
      logicalWidth: 1920,
      logicalHeight: 1080,
      pixelRatio: 2,
      renderScale: 0.4,
      maxRenderScale: 1,
      minRenderScale: MIN_DYNAMIC_RENDER_SCALE,
    });

    expect(MIN_DYNAMIC_RENDER_SCALE).toBe(0.68);
    expect(rect.renderScale).toBe(0.68);
    expect(rect.renderWidth).toBe(2611);
    expect(rect.renderHeight).toBe(1468);
  });

  it('preserves a manual ceiling below the governor floor at full region', () => {
    const rect = dynamicResolutionRect({
      logicalWidth: 800,
      logicalHeight: 600,
      pixelRatio: 2,
      renderScale: 0.4,
      maxRenderScale: 0.5,
      minRenderScale: MIN_DYNAMIC_RENDER_SCALE,
    });

    expect(rect.renderScale).toBe(0.5);
    expect(rect.renderWidth).toBe(rect.targetWidth);
    expect(rect.renderHeight).toBe(rect.targetHeight);
    expect([rect.uvScaleX, rect.uvScaleY, rect.uvMaxX, rect.uvMaxY]).toEqual([1, 1, 1, 1]);
  });

  it('clamps a requested scale above the manual ceiling', () => {
    const rect = dynamicResolutionRect({
      logicalWidth: 1600,
      logicalHeight: 900,
      pixelRatio: 1.5,
      renderScale: 1.2,
      maxRenderScale: 0.82,
      minRenderScale: MIN_DYNAMIC_RENDER_SCALE,
    });

    expect(rect.renderScale).toBe(0.82);
    expect(rect.renderWidth).toBe(rect.targetWidth);
    expect(rect.renderHeight).toBe(rect.targetHeight);
  });

  it('sanitizes invalid dimensions and scale inputs to a bounded pixel rectangle', () => {
    const rect = dynamicResolutionRect({
      logicalWidth: Number.NaN,
      logicalHeight: -20,
      pixelRatio: Number.POSITIVE_INFINITY,
      renderScale: Number.NaN,
      maxRenderScale: 4,
      minRenderScale: -1,
    });

    expect(rect.targetWidth).toBe(1);
    expect(rect.targetHeight).toBe(1);
    expect(rect.renderWidth).toBe(1);
    expect(rect.renderHeight).toBe(1);
    expect(rect.renderScale).toBe(1);
    expect([rect.uvScaleX, rect.uvScaleY, rect.uvMaxX, rect.uvMaxY]).toEqual([1, 1, 1, 1]);
  });
});

describe('dynamic resolution renderer policy', () => {
  it('allocates supported chains at the manual ceiling and locks other chains in place', () => {
    expect(dynamicResolutionAllocationScale(true, 0.9, 0.72)).toBe(0.9);
    expect(dynamicResolutionAllocationScale(false, 0.9, 0.72)).toBe(0.72);
    expect(dynamicResolutionGovernorRange(false, 0.72, 0.68, 0.9)).toEqual({
      minRenderScale: 0.72,
      maxRenderScale: 0.72,
    });
  });

  it('opens supported chains only between the floor and manual ceiling', () => {
    expect(dynamicResolutionGovernorRange(true, 0.9, 0.6, 0.9)).toEqual({
      minRenderScale: 0.68,
      maxRenderScale: 0.9,
    });
    expect(dynamicResolutionGovernorRange(true, 0.5, 0.68, 0.5)).toEqual({
      minRenderScale: 0.5,
      maxRenderScale: 0.5,
    });
  });
});
