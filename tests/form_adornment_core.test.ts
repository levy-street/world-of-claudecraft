// The pure core of the shapeshift form adornments (Moonwing Form's antlers,
// crescent and wings). Pins WHAT a rig wears for the form flag and body kind,
// and the pose math the THREE painter applies every frame. Gloamveil wears no
// adornment: its look is tests/gloam_climb_core.test.ts and its neighbours.
import { describe, expect, it } from 'vitest';
import {
  createMoonwingPose,
  formAdornmentBody,
  formAdornmentPlan,
  MOONWING_KAYKIT_FIT,
  MOONWING_UNFURL_SECONDS,
  MOONWING_WOC_FIT,
  moonwingFit,
  moonwingPoseInto,
} from '../src/render/characters/form_adornment_core';

describe('formAdornmentPlan', () => {
  it('grows the antlers back only on a bare-headed Moonwing body', () => {
    // A composed look and a WOC body both have a bare head to crown.
    for (const body of ['composed', 'woc'] as const) {
      expect(formAdornmentPlan(true, body)).toEqual({ moonwing: true, antlers: true });
    }
    // The legacy druid.glb rig wears its own antlered hood, and a mech body is
    // a whole replacement: crescent and wings, never a second pair of antlers.
    for (const body of ['classRig', 'replacement'] as const) {
      expect(formAdornmentPlan(true, body)).toEqual({ moonwing: true, antlers: false });
    }
  });

  it('wears nothing outside Moonwing, and plans no piece for any other form', () => {
    for (const body of ['composed', 'woc', 'classRig', 'replacement'] as const) {
      // The whole plan, key for key: a piece planned for Gloamveil (the face
      // veil this core used to carry) would show up here as a third key.
      expect(formAdornmentPlan(false, body)).toEqual({ moonwing: false, antlers: false });
    }
  });
});

describe('formAdornmentBody', () => {
  it('reads a WOC def as a WOC body before anything else', () => {
    // The live druid: a WOC def with no composed look. It used to fall through
    // to `classRig` (KayKit offsets, no antlers), which floated the wings.
    expect(formAdornmentBody(false, true, 'player_druid')).toBe('woc');
    expect(formAdornmentBody(false, true, 'player_druid_female')).toBe('woc');
    expect(formAdornmentBody(true, true, 'player_druid')).toBe('woc');
  });

  it('keeps the KayKit body kinds for every other rig', () => {
    expect(formAdornmentBody(true, false, 'player_druid_modular')).toBe('composed');
    expect(formAdornmentBody(false, false, 'player_mech')).toBe('replacement');
    expect(formAdornmentBody(false, false, 'player_druid')).toBe('classRig');
  });
});

describe('moonwingFit', () => {
  it('keeps the authored KayKit placement on every KayKit body', () => {
    for (const body of ['composed', 'classRig', 'replacement'] as const) {
      expect(moonwingFit(body)).toBe(MOONWING_KAYKIT_FIT);
    }
    expect(MOONWING_KAYKIT_FIT).toEqual({
      head: { y: 0, z: 0, scale: 1 },
      wing: { x: 0.14, y: 0.12, z: -0.62, scale: 1 },
    });
  });

  it('shrinks the pieces onto the WOC body and pulls them in to its bones', () => {
    const fit = moonwingFit('woc');
    expect(fit).toBe(MOONWING_WOC_FIT);
    // The WOC back plate is about 0.09 behind the chest bone and the body is
    // about 1.2 rig units tall: the wing root sits just behind the plate, by
    // the spine, between the chest bone and the neck (0.13 above it).
    expect(fit.wing.z).toBeLessThan(-0.08);
    expect(fit.wing.z).toBeGreaterThan(-0.16);
    expect(fit.wing.x).toBeGreaterThan(0);
    expect(fit.wing.x).toBeLessThan(0.1);
    expect(fit.wing.y).toBeGreaterThan(0);
    expect(fit.wing.y).toBeLessThan(0.13);
    // About half size: the KayKit body is about twice the WOC one in rig units.
    expect(fit.wing.scale).toBeGreaterThan(0.35);
    expect(fit.wing.scale).toBeLessThan(0.65);
    // The WOC skull is an eighth the width of the KayKit head.
    expect(fit.head.scale).toBeGreaterThan(0.12);
    expect(fit.head.scale).toBeLessThan(0.35);
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
