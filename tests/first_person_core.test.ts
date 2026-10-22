import { describe, expect, it } from 'vitest';
import { SETTING_RANGES } from '../src/game/settings';
import {
  createFirstPersonPose,
  FIRST_PERSON_BODY,
  FIRST_PERSON_ENGAGE_DIST,
  FIRST_PERSON_EYE_FRACTION,
  FIRST_PERSON_FALLBACK_EYE,
  FIRST_PERSON_FORWARD,
  FIRST_PERSON_LOOK_DIST,
  FIRST_PERSON_NO_BODY,
  FIRST_PERSON_OFF,
  FIRST_PERSON_PITCH_BIAS,
  firstPersonActive,
  firstPersonEyeHeight,
  firstPersonHiding,
  firstPersonModeFromSetting,
  firstPersonPoseInto,
} from '../src/render/first_person_core';

describe('first_person_core', () => {
  it('engages at the closest zoom the wheel reaches, and only there', () => {
    expect(FIRST_PERSON_ENGAGE_DIST).toBe(SETTING_RANGES.cameraZoom.min);
    const at = (mode: 0 | 1 | 2, camDist: number, blocked = false) =>
      firstPersonActive({ mode, camDist, blocked });
    expect(at(FIRST_PERSON_BODY, SETTING_RANGES.cameraZoom.min)).toBe(true);
    expect(at(FIRST_PERSON_NO_BODY, SETTING_RANGES.cameraZoom.min)).toBe(true);
    // One wheel notch out is third person again.
    expect(at(FIRST_PERSON_BODY, SETTING_RANGES.cameraZoom.min + 0.5)).toBe(false);
    expect(at(FIRST_PERSON_BODY, SETTING_RANGES.cameraZoom.def)).toBe(false);
  });

  it('off (the default) never engages, and a blocked frame keeps the chase camera', () => {
    expect(SETTING_RANGES.firstPersonMode.def).toBe(FIRST_PERSON_OFF);
    expect(firstPersonActive({ mode: FIRST_PERSON_OFF, camDist: 3, blocked: false })).toBe(false);
    expect(firstPersonActive({ mode: FIRST_PERSON_BODY, camDist: 3, blocked: true })).toBe(false);
  });

  it('clamps the stored setting to a mode', () => {
    expect(firstPersonModeFromSetting(0)).toBe(FIRST_PERSON_OFF);
    expect(firstPersonModeFromSetting(1)).toBe(FIRST_PERSON_BODY);
    expect(firstPersonModeFromSetting(2)).toBe(FIRST_PERSON_NO_BODY);
    expect(firstPersonModeFromSetting(1.4)).toBe(FIRST_PERSON_BODY);
    expect(firstPersonModeFromSetting(7)).toBe(FIRST_PERSON_OFF);
    expect(firstPersonModeFromSetting(-1)).toBe(FIRST_PERSON_OFF);
    expect(firstPersonModeFromSetting(Number.NaN)).toBe(FIRST_PERSON_OFF);
  });

  it('hides the head for the body mode and everything for the no-body mode', () => {
    expect(firstPersonHiding(FIRST_PERSON_BODY, true)).toEqual({ head: true, body: false });
    expect(firstPersonHiding(FIRST_PERSON_NO_BODY, true)).toEqual({ head: true, body: true });
    // Outside first person nothing hides, whatever the mode.
    for (const mode of [FIRST_PERSON_OFF, FIRST_PERSON_BODY, FIRST_PERSON_NO_BODY] as const)
      expect(firstPersonHiding(mode, false)).toEqual({ head: false, body: false });
    // Reused records: no per-frame allocation.
    expect(firstPersonHiding(FIRST_PERSON_BODY, true)).toBe(firstPersonHiding(1, true));
  });

  it('seats the eye on the model, with the saddle lift and the entity scale', () => {
    expect(firstPersonEyeHeight(2, 0, 1)).toBeCloseTo(2 * FIRST_PERSON_EYE_FRACTION);
    expect(firstPersonEyeHeight(2, 1, 1)).toBeCloseTo(2 * FIRST_PERSON_EYE_FRACTION + 1);
    expect(firstPersonEyeHeight(2, 0, 1.5)).toBeCloseTo(3 * FIRST_PERSON_EYE_FRACTION);
    expect(firstPersonEyeHeight(0, 0, 1)).toBe(FIRST_PERSON_FALLBACK_EYE);
  });

  it('places the eye ahead of the head and looks along the camera yaw', () => {
    const pose = createFirstPersonPose();
    // yaw 0 faces +z; the resting pitch minus the bias looks level.
    const out = firstPersonPoseInto(pose, 10, 5, 20, 0, FIRST_PERSON_PITCH_BIAS, 1.8);
    expect(out).toBe(pose);
    expect(out.x).toBeCloseTo(10);
    expect(out.y).toBeCloseTo(6.8);
    expect(out.z).toBeCloseTo(20 + FIRST_PERSON_FORWARD);
    expect(out.lookX).toBeCloseTo(10);
    expect(out.lookY).toBeCloseTo(6.8);
    expect(out.lookZ).toBeCloseTo(out.z + FIRST_PERSON_LOOK_DIST);
    // Turned to +x and pitched down: the look target drops below the eye.
    firstPersonPoseInto(pose, 0, 0, 0, Math.PI / 2, 1, 1.8);
    expect(pose.x).toBeCloseTo(FIRST_PERSON_FORWARD);
    expect(pose.lookX).toBeGreaterThan(pose.x);
    expect(pose.lookY).toBeLessThan(pose.y);
    expect(pose.lookZ).toBeCloseTo(pose.z);
  });
});
