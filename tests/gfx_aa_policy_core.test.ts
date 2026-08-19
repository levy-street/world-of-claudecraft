import { describe, expect, it } from 'vitest';
import { gfxAaPolicy } from '../src/render/gfx_aa_policy_core';

describe('graphics anti-aliasing policy', () => {
  it('keeps the region-scaled medium tier free of full-size post AA', () => {
    expect(gfxAaPolicy('low')).toEqual({
      pixelRatioCap: 1.48,
      msaaSamples: 0,
      postAa: 'none',
    });
    // Fused into the grade pass, never a tail: a full-size pass is what would
    // cost this tier its dynamic-resolution region.
    expect(gfxAaPolicy('medium')).toEqual({
      pixelRatioCap: 1.48,
      msaaSamples: 0,
      postAa: 'fxaa-grade',
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

  it('preserves the constrained-memory and iOS WebKit pixel-ratio ceilings', () => {
    expect(gfxAaPolicy('ultra', { constrainedMemory: true })).toEqual({
      pixelRatioCap: 1.48,
      msaaSamples: 0,
      postAa: 'smaa',
    });
    expect(
      gfxAaPolicy('insane', {
        constrainedMemory: true,
        iosMemoryProfile: true,
      }),
    ).toEqual({
      pixelRatioCap: 1.25,
      msaaSamples: 0,
      postAa: 'none',
    });
  });

  it('keeps the fused medium AA under a memory constraint but not on the WebKit rungs', () => {
    // The fused arm allocates nothing, so a constrained non-WebKit session
    // pays only the pixel-ratio cap and keeps its edge AA.
    expect(gfxAaPolicy('medium', { constrainedMemory: true })).toEqual({
      pixelRatioCap: 1.48,
      msaaSamples: 0,
      postAa: 'fxaa-grade',
    });
    // Both WebKit rungs drop the grade pass outright (gfx.ts gates gradePass on
    // iosMemoryProfile), so there is nothing left to fuse the arm into.
    expect(gfxAaPolicy('medium', { constrainedMemory: true, iosMemoryProfile: true })).toEqual({
      pixelRatioCap: 1.25,
      msaaSamples: 0,
      postAa: 'none',
    });
    expect(
      gfxAaPolicy('medium', {
        constrainedMemory: true,
        iosMemoryProfile: true,
        tightMemory: true,
      }),
    ).toEqual({
      pixelRatioCap: 1,
      msaaSamples: 0,
      postAa: 'none',
    });
  });
});
