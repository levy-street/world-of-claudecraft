// The Deepglass scene layer's pure cores (src/render/deepglass_scene/), moved
// out of renderer.ts: the bell camera, the flier pose layers and the sound-cue
// decisions.

import { describe, expect, it } from 'vitest';
import {
  bellBoomLimit,
  DG_CAM_FOV_TAU,
  DG_CAM_GLASS_MARGIN,
  DG_CAMERA_FOV,
  nextCameraFovBase,
} from '../src/render/deepglass_scene/deepglass_camera_core';
import {
  bodyCueBits,
  bodyCueFor,
  boostBedDrive,
  deepglassCrowdExcite,
  deepglassCrowdLevel,
  deepglassTeamOf,
} from '../src/render/deepglass_scene/deepglass_cue_core';
import {
  advanceDashFlip,
  type DashFlipState,
  DG_FLIP_SECS,
  DG_PITCH_FULL_SPEED,
  flightPoseVerticalSpeed,
  resetDashFlip,
} from '../src/render/deepglass_scene/deepglass_pose_core';
import { DG_BOOST_SPEED, DG_SWIM_SPEED } from '../src/sim/deepglass/flight';
import { DEEPGLASS_CENTER, DEEPGLASS_RADIUS, DG_BOWL_OUTER_R } from '../src/sim/deepglass/layout';
import type { DgMatch } from '../src/sim/deepglass/match';

const C = DEEPGLASS_CENTER;

describe('bellBoomLimit', () => {
  it('holds the boom inside the glass from the centre', () => {
    const r = DEEPGLASS_RADIUS - DG_CAM_GLASS_MARGIN;
    expect(bellBoomLimit(C.x, C.y, C.z, 0, 0)).toBeCloseTo(r, 6);
    expect(bellBoomLimit(C.x, C.y, C.z, 1.3, -0.4)).toBeCloseTo(r, 6);
  });

  it('is shorter when the boom swings toward the near wall', () => {
    // eye 10 yd toward -z of centre; yaw 0 puts the camera at eye - (0,0,1) t,
    // so the boom runs further toward -z and meets the glass sooner
    const near = bellBoomLimit(C.x, C.y, C.z - 10, 0, 0);
    const far = bellBoomLimit(C.x, C.y, C.z + 10, 0, 0);
    expect(near).toBeLessThan(far);
  });

  it('never clamps an eye outside the sphere', () => {
    expect(bellBoomLimit(C.x, C.y + DEEPGLASS_RADIUS * 2, C.z, 0, 0)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe('nextCameraFovBase', () => {
  it('is the land base, unchanged, outside the Deepglass world', () => {
    expect(nextCameraFovBase(76, 60, true, false, 1 / 60)).toBe(60);
    expect(nextCameraFovBase(60, 70, false, false, 1 / 60)).toBe(70);
  });

  it('eases toward the bell figure while flying and snaps when close', () => {
    const dt = 1 / 60;
    const next = nextCameraFovBase(60, 60, true, true, dt);
    expect(next).toBeGreaterThan(60);
    expect(next).toBeLessThan(DG_CAMERA_FOV);
    expect(next).toBeCloseTo(60 + 16 * (1 - Math.exp(-dt / DG_CAM_FOV_TAU)), 9);
    expect(nextCameraFovBase(DG_CAMERA_FOV - 0.01, 60, true, true, dt)).toBe(DG_CAMERA_FOV);
  });
});

describe('flight pose', () => {
  it('points along the line of travel', () => {
    // a pure climb noses straight up (the ceiling), level flight is level
    expect(flightPoseVerticalSpeed(0, 0, 10, 0.05)).toBe(DG_PITCH_FULL_SPEED);
    expect(flightPoseVerticalSpeed(0, 0, -10, 0.05)).toBe(-DG_PITCH_FULL_SPEED);
    expect(flightPoseVerticalSpeed(1, 0, 0, 0.05)).toBe(0);
    // too slow to read a direction: level
    expect(flightPoseVerticalSpeed(0.01, 0, 0.5, 0.05)).toBe(0);
    // no frame time: the raw vertical speed passes through
    expect(flightPoseVerticalSpeed(1, 1, 3, 0)).toBe(3);
  });

  it('flips once per dash edge, along the dash axis, and settles', () => {
    const s: DashFlipState = { dgFlipT: DG_FLIP_SECS, dgFlipKind: 1, dgPrevDashTicks: 0 };
    const out = { pitch: 0, roll: 0 };
    // idle: no offset
    expect(advanceDashFlip(s, 0, 1, 0.1, out)).toEqual({ pitch: 0, roll: 0 });
    // a left dash rolls; holding the flare does not re-trigger
    advanceDashFlip(s, 3, 4, DG_FLIP_SECS / 2, out);
    expect(out.pitch).toBe(0);
    expect(out.roll).toBeCloseTo(Math.PI, 6);
    advanceDashFlip(s, 2, 4, DG_FLIP_SECS, out);
    expect(out.roll).toBeCloseTo(Math.PI * 2, 6);
    advanceDashFlip(s, 1, 4, 0.1, out);
    expect(out).toEqual({ pitch: 0, roll: 0 });
    // a back dash pitches the other way
    advanceDashFlip(s, 0, 2, 0.1, out);
    advanceDashFlip(s, 3, 2, DG_FLIP_SECS / 2, out);
    expect(out.pitch).toBeCloseTo(-Math.PI, 6);
    resetDashFlip(s);
    expect(s).toEqual({ dgFlipT: DG_FLIP_SECS, dgFlipKind: 2, dgPrevDashTicks: 0 });
  });
});

describe('deepglass cue decisions', () => {
  it('reads the bowl loudest in a goal and fades it past the bowl wall', () => {
    expect(deepglassCrowdLevel('goal', C.x, C.z, false)).toBe(1);
    expect(deepglassCrowdLevel('active', C.x, C.z, false)).toBe(0.72);
    expect(deepglassCrowdLevel(null, C.x, C.z, false)).toBe(0.3);
    expect(deepglassCrowdLevel('active', C.x + DG_BOWL_OUTER_R + 20, C.z, false)).toBeCloseTo(
      0.36,
      9,
    );
    expect(deepglassCrowdLevel('active', C.x + DG_BOWL_OUTER_R + 40, C.z, false)).toBe(0);
    // submerged in the bell there is no falloff at all
    expect(deepglassCrowdLevel('active', C.x + 10_000, C.z, true)).toBe(0.72);
    expect(deepglassCrowdExcite('goal')).toBe(1);
    expect(deepglassCrowdExcite('active')).toBe(0.42);
    expect(deepglassCrowdExcite(null)).toBe(0.14);
  });

  it('drives the burner bed off the bell cruise, clamped', () => {
    expect(boostBedDrive(0)).toBe(0);
    expect(boostBedDrive(DG_SWIM_SPEED * 0.5)).toBe(0);
    expect(boostBedDrive(DG_BOOST_SPEED)).toBe(1);
    expect(boostBedDrive(DG_BOOST_SPEED * 3)).toBe(1);
  });

  it('fires one cue per rising edge, dash over brake over ignition', () => {
    const all = bodyCueBits(true, 2, true);
    expect(bodyCueFor(0, all)).toBe('dash');
    expect(bodyCueFor(0, bodyCueBits(true, 0, true))).toBe('brake');
    expect(bodyCueFor(0, bodyCueBits(true, 0, false))).toBe('ignite');
    expect(bodyCueFor(all, bodyCueBits(true, 0, false))).toBeNull();
  });

  it('places a body on its side of the roster', () => {
    const m = { teamA: [1, 2], teamB: [3] } as unknown as DgMatch;
    expect(deepglassTeamOf(m, 2)).toBe('A');
    expect(deepglassTeamOf(m, 3)).toBe('B');
    expect(deepglassTeamOf(m, 9)).toBeNull();
    expect(deepglassTeamOf(null, 1)).toBeNull();
  });
});
