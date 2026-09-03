import { describe, expect, it } from 'vitest';
import {
  DRAWING_BUFFER_BUDGET_1080P_CLASS,
  DRAWING_BUFFER_BUDGET_1440P_CLASS,
  DRAWING_BUFFER_BUDGET_1440P_PLUS,
  gfxAaPolicy,
} from '../src/render/gfx_aa_policy_core';

describe('graphics anti-aliasing policy', () => {
  it('keeps the region-scaled medium tier free of full-size post AA', () => {
    expect(gfxAaPolicy('low')).toEqual({
      pixelRatioCap: 1.48,
      maxDrawingBufferPixels: DRAWING_BUFFER_BUDGET_1080P_CLASS,
      msaaSamples: 0,
      postAa: 'none',
    });
    // Fused into the grade pass, never a tail: a full-size pass is what would
    // cost this tier its dynamic-resolution region.
    expect(gfxAaPolicy('medium')).toEqual({
      pixelRatioCap: 1.48,
      maxDrawingBufferPixels: DRAWING_BUFFER_BUDGET_1080P_CLASS,
      msaaSamples: 0,
      postAa: 'fxaa-grade',
    });
    expect(gfxAaPolicy('high')).toEqual({
      pixelRatioCap: 1.75,
      maxDrawingBufferPixels: DRAWING_BUFFER_BUDGET_1440P_CLASS,
      msaaSamples: 0,
      postAa: 'smaa',
    });
    expect(gfxAaPolicy('ultra')).toEqual({
      pixelRatioCap: 1.75,
      maxDrawingBufferPixels: DRAWING_BUFFER_BUDGET_1440P_PLUS,
      msaaSamples: 0,
      postAa: 'smaa',
    });
    expect(gfxAaPolicy('insane')).toEqual({
      pixelRatioCap: 1.75,
      maxDrawingBufferPixels: DRAWING_BUFFER_BUDGET_1440P_PLUS,
      msaaSamples: 0,
      postAa: 'smaa',
    });
  });

  it('preserves the constrained-memory and iOS WebKit pixel-ratio ceilings', () => {
    expect(gfxAaPolicy('ultra', { constrainedMemory: true })).toEqual({
      pixelRatioCap: 1.48,
      maxDrawingBufferPixels: DRAWING_BUFFER_BUDGET_1440P_PLUS,
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
      maxDrawingBufferPixels: DRAWING_BUFFER_BUDGET_1080P_CLASS,
      msaaSamples: 0,
      postAa: 'none',
    });
  });

  it('keeps the fused medium AA under a memory constraint but not on the WebKit rungs', () => {
    // The fused arm allocates nothing, so a constrained non-WebKit session
    // pays only the pixel-ratio cap and keeps its edge AA.
    expect(gfxAaPolicy('medium', { constrainedMemory: true })).toEqual({
      pixelRatioCap: 1.48,
      maxDrawingBufferPixels: DRAWING_BUFFER_BUDGET_1080P_CLASS,
      msaaSamples: 0,
      postAa: 'fxaa-grade',
    });
    // Both WebKit rungs drop the grade pass outright (gfx.ts gates gradePass on
    // iosMemoryProfile), so there is nothing left to fuse the arm into.
    expect(gfxAaPolicy('medium', { constrainedMemory: true, iosMemoryProfile: true })).toEqual({
      pixelRatioCap: 1.25,
      maxDrawingBufferPixels: DRAWING_BUFFER_BUDGET_1080P_CLASS,
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
      maxDrawingBufferPixels: DRAWING_BUFFER_BUDGET_1080P_CLASS,
      msaaSamples: 0,
      postAa: 'none',
    });
  });

  it('derives the pixel budgets from display classes with headroom above the exact panel', () => {
    // The class itself never binds; only the class above it does.
    expect(DRAWING_BUFFER_BUDGET_1080P_CLASS).toBeGreaterThan(1920 * 1200);
    expect(DRAWING_BUFFER_BUDGET_1080P_CLASS).toBeLessThan(2560 * 1080);
    expect(DRAWING_BUFFER_BUDGET_1440P_CLASS).toBeGreaterThan(2560 * 1440);
    expect(DRAWING_BUFFER_BUDGET_1440P_CLASS).toBeLessThan(2560 * 1600);
    expect(DRAWING_BUFFER_BUDGET_1440P_PLUS).toBeGreaterThan(2560 * 1600);
    expect(DRAWING_BUFFER_BUDGET_1440P_PLUS).toBeLessThan(3440 * 1440);
    // Monotone up the ladder, and ultra/insane share one budget as they share a cap.
    expect(gfxAaPolicy('low').maxDrawingBufferPixels).toBe(
      gfxAaPolicy('medium').maxDrawingBufferPixels,
    );
    expect(gfxAaPolicy('medium').maxDrawingBufferPixels).toBeLessThan(
      gfxAaPolicy('high').maxDrawingBufferPixels,
    );
    expect(gfxAaPolicy('high').maxDrawingBufferPixels).toBeLessThan(
      gfxAaPolicy('ultra').maxDrawingBufferPixels,
    );
    expect(gfxAaPolicy('ultra').maxDrawingBufferPixels).toBe(
      gfxAaPolicy('insane').maxDrawingBufferPixels,
    );
  });
});
