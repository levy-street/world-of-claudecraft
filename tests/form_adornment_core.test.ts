// The pure core of the shapeshift form adornments (Moonwing Form's antlers
// and crescent; the wings were cut). Pins WHAT a rig wears for the form flag and body kind,
// and the pose math the THREE painter applies every frame. Gloamveil wears no
// adornment: its look is tests/gloam_climb_core.test.ts and its neighbours.
import { describe, expect, it } from 'vitest';
import {
  createMoonwingPose,
  formAdornmentPlan,
  moonwingPoseInto,
} from '../src/render/characters/form_adornment_core';

describe('formAdornmentPlan', () => {
  it('grows the antlers back only on a composed Moonwing body', () => {
    expect(formAdornmentPlan(true, 'composed')).toEqual({ moonwing: true, antlers: true });
    // The legacy druid.glb rig wears its own antlered hood, and a mech body is
    // a whole replacement: the crescent alone, never a second pair of antlers.
    for (const body of ['classRig', 'replacement'] as const) {
      expect(formAdornmentPlan(true, body)).toEqual({ moonwing: true, antlers: false });
    }
  });

  it('wears nothing outside Moonwing, and plans no piece for any other form', () => {
    for (const body of ['composed', 'classRig', 'replacement'] as const) {
      // The whole plan, key for key: a piece planned for Gloamveil (the face
      // veil this core used to carry) would show up here as a third key.
      expect(formAdornmentPlan(false, body)).toEqual({ moonwing: false, antlers: false });
    }
  });
});

describe('moonwingPoseInto', () => {
  it('keeps the crescent drift small, bounded and really moving', () => {
    const pose = createMoonwingPose();
    let liftSeen = 0;
    for (let t = 0; t < 20; t += 0.1) {
      moonwingPoseInto(t, false, pose);
      expect(Math.abs(pose.crescentLift)).toBeLessThanOrEqual(0.035);
      expect(Math.abs(pose.crescentSway)).toBeLessThanOrEqual(0.06);
      liftSeen = Math.max(liftSeen, Math.abs(pose.crescentLift));
    }
    expect(liftSeen).toBeGreaterThan(0.03);
  });

  it('holds the crescent still under reduced motion', () => {
    const pose = createMoonwingPose();
    for (const t of [0, 0.1, 1.3, 7]) {
      moonwingPoseInto(t, true, pose);
      expect(pose.crescentLift).toBe(0);
      expect(pose.crescentSway).toBe(0);
    }
  });

  it('carries no wing state: the pose is the crescent alone', () => {
    expect(Object.keys(createMoonwingPose()).sort()).toEqual(['crescentLift', 'crescentSway']);
  });

  it('writes into and returns the caller-owned pose (no per-frame allocation)', () => {
    const pose = createMoonwingPose();
    expect(moonwingPoseInto(1, false, pose)).toBe(pose);
  });
});
