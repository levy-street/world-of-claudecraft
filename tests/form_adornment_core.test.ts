// The pure core of the shapeshift form adornments (Moonwing Form's antlers,
// crescent and wings; Gloamveil's veil). Pins WHAT a rig wears for each form
// flag and body kind, and the pose math the THREE painters apply every frame.
import { describe, expect, it } from 'vitest';
import {
  createMoonwingPose,
  formAdornmentPlan,
  gloamveilEyeGlow,
  MOONWING_UNFURL_SECONDS,
  moonwingPoseInto,
} from '../src/render/characters/form_adornment_core';

describe('formAdornmentPlan', () => {
  it('grows the antlers back only on a composed Moonwing body', () => {
    expect(formAdornmentPlan(true, false, 'composed')).toEqual({
      moonwing: true,
      antlers: true,
      gloamveil: false,
    });
    // The legacy druid.glb rig wears its own antlered hood, and a mech body is
    // a whole replacement: crescent and wings, never a second pair of antlers.
    for (const body of ['classRig', 'replacement'] as const) {
      expect(formAdornmentPlan(true, false, body)).toEqual({
        moonwing: true,
        antlers: false,
        gloamveil: false,
      });
    }
  });

  it('veils a KayKit face in Gloamveil, never a replacement body', () => {
    for (const body of ['composed', 'classRig'] as const) {
      expect(formAdornmentPlan(false, true, body)).toEqual({
        moonwing: false,
        antlers: false,
        gloamveil: true,
      });
    }
    expect(formAdornmentPlan(false, true, 'replacement').gloamveil).toBe(false);
  });

  it('wears nothing outside the two forms', () => {
    for (const body of ['composed', 'classRig', 'replacement'] as const) {
      expect(formAdornmentPlan(false, false, body)).toEqual({
        moonwing: false,
        antlers: false,
        gloamveil: false,
      });
    }
  });
});

describe('moonwingPoseInto', () => {
  it('unfurls the wings from folded to open over the unfurl window', () => {
    const pose = createMoonwingPose();
    expect(moonwingPoseInto(0, false, false, false, pose).unfurl).toBe(0);
    let last = 0;
    for (let step = 1; step < 9; step++) {
      const t = (MOONWING_UNFURL_SECONDS * step) / 9;
      const unfurl = moonwingPoseInto(t, false, false, false, pose).unfurl;
      expect(unfurl).toBeGreaterThan(last);
      expect(unfurl).toBeLessThan(1);
      last = unfurl;
    }
    expect(moonwingPoseInto(MOONWING_UNFURL_SECONDS, false, false, false, pose).unfurl).toBe(1);
    expect(moonwingPoseInto(30, false, false, false, pose).unfurl).toBe(1);
  });

  it('keeps the wingbeat and the crescent drift small and bounded', () => {
    const pose = createMoonwingPose();
    let beatSeen = 0;
    for (let t = 0; t < 20; t += 0.1) {
      moonwingPoseInto(t, false, false, false, pose);
      expect(Math.abs(pose.beat)).toBeLessThanOrEqual(0.07);
      expect(Math.abs(pose.crescentLift)).toBeLessThanOrEqual(0.035);
      expect(Math.abs(pose.crescentSway)).toBeLessThanOrEqual(0.06);
      beatSeen = Math.max(beatSeen, Math.abs(pose.beat));
    }
    // It really does beat: a constant zero would pass the bounds above.
    expect(beatSeen).toBeGreaterThan(0.05);
  });

  it('sweeps back while moving and opens while casting (casting wins)', () => {
    const pose = createMoonwingPose();
    expect(moonwingPoseInto(2, false, false, false, pose).sweep).toBe(0);
    expect(moonwingPoseInto(2, true, false, false, pose).sweep).toBeGreaterThan(0);
    expect(moonwingPoseInto(2, false, true, false, pose).sweep).toBeLessThan(0);
    expect(moonwingPoseInto(2, true, true, false, pose).sweep).toBeLessThan(0);
  });

  it('holds the open rest pose under reduced motion from the first frame', () => {
    const pose = createMoonwingPose();
    for (const t of [0, 0.1, 1.3, 7]) {
      moonwingPoseInto(t, false, false, true, pose);
      expect(pose.unfurl).toBe(1);
      expect(pose.beat).toBe(0);
      expect(pose.crescentLift).toBe(0);
      expect(pose.crescentSway).toBe(0);
    }
    // Movement still reads: the sweep is a state, not an animation.
    expect(moonwingPoseInto(1, true, false, true, pose).sweep).toBeGreaterThan(0);
  });

  it('writes into and returns the caller-owned pose (no per-frame allocation)', () => {
    const pose = createMoonwingPose();
    expect(moonwingPoseInto(1, false, false, false, pose)).toBe(pose);
  });
});

describe('gloamveilEyeGlow', () => {
  it('smoulders within a narrow band and holds steady under reduced motion', () => {
    let low = Infinity;
    let high = -Infinity;
    for (let t = 0; t < 10; t += 0.05) {
      const glow = gloamveilEyeGlow(t, false);
      low = Math.min(low, glow);
      high = Math.max(high, glow);
    }
    expect(low).toBeGreaterThanOrEqual(0.84);
    expect(high).toBeLessThanOrEqual(1);
    expect(high - low).toBeGreaterThan(0.1);
    expect(gloamveilEyeGlow(0.7, true)).toBe(1);
    expect(gloamveilEyeGlow(3.1, true)).toBe(1);
  });
});
