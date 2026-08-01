import { describe, expect, it } from 'vitest';
import { gfxAaPolicy } from '../src/render/gfx_aa_policy_core';

describe('graphics anti-aliasing policy', () => {
  it('uses post AA instead of multisampling from medium upward', () => {
    expect(gfxAaPolicy('low')).toEqual({
      pixelRatioCap: 1.48,
      msaaSamples: 0,
      postAa: 'none',
    });
    expect(gfxAaPolicy('medium')).toEqual({
      pixelRatioCap: 1.48,
      msaaSamples: 0,
      postAa: 'smaa',
    });
    expect(gfxAaPolicy('high')).toEqual({
      pixelRatioCap: 1.75,
      msaaSamples: 0,
      postAa: 'smaa',
    });
    expect(gfxAaPolicy('ultra')).toEqual({
      pixelRatioCap: 1.75,
      msaaSamples: 0,
      postAa: 'smaa',
    });
    expect(gfxAaPolicy('insane')).toEqual({
      pixelRatioCap: 1.75,
      msaaSamples: 0,
      postAa: 'smaa',
    });
  });

  it('preserves the constrained-memory and native iOS pixel-ratio ceilings', () => {
    expect(gfxAaPolicy('ultra', { constrainedMemory: true })).toEqual({
      pixelRatioCap: 1.48,
      msaaSamples: 0,
      postAa: 'smaa',
    });
    expect(
      gfxAaPolicy('insane', {
        constrainedMemory: true,
        nativeIosMemoryProfile: true,
      }),
    ).toEqual({
      pixelRatioCap: 1.25,
      msaaSamples: 0,
      postAa: 'none',
    });
  });
});
