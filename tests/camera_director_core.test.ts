import { describe, expect, it } from 'vitest';
import {
  type CameraDirectorPose,
  type CameraDirectorState,
  cameraDirectiveActive,
  cancelCameraDirective,
  createCameraDirector,
  DIRECTOR_RELEASE_TIME,
  startDeathDrift,
  startVista,
  stepCameraDirector,
  VISTA_DURATION,
  VISTA_PITCH,
} from '../src/render/camera_director_core';

// Directed camera moves (zone vista, death drift): blended offsets over the
// live player pose that always return exactly to it, cancel on input, and
// never snap.

const LIVE: CameraDirectorPose = { yaw: 1.2, pitch: 0.32, dist: 12 };
const DT = 1 / 60;

const run = (s: CameraDirectorState, seconds: number, disturbed = false): CameraDirectorPose => {
  let pose = LIVE;
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) pose = stepCameraDirector(s, LIVE, DT, disturbed);
  return pose;
};

describe('camera director', () => {
  it('passes the live pose through untouched while inactive', () => {
    const s = createCameraDirector();
    expect(stepCameraDirector(s, LIVE, DT, false)).toEqual(LIVE);
    expect(cameraDirectiveActive(s)).toBe(false);
  });

  it('vista sweeps up and out, then lands exactly back on the live pose', () => {
    const s = createCameraDirector();
    startVista(s);
    const mid = run(s, VISTA_DURATION / 2);
    expect(mid.dist).toBeGreaterThan(LIVE.dist + 2); // pulled out
    expect(mid.pitch).toBeGreaterThan(LIVE.pitch + 0.1); // raised toward VISTA_PITCH
    expect(mid.pitch).toBeLessThanOrEqual(VISTA_PITCH + 1e-6);
    expect(mid.yaw).not.toBeCloseTo(LIVE.yaw, 3); // sweeping
    const done = run(s, VISTA_DURATION); // run well past the end
    expect(done).toEqual(LIVE);
    expect(cameraDirectiveActive(s)).toBe(false);
  });

  it('never snaps: per-frame pose deltas stay small through the whole vista', () => {
    const s = createCameraDirector();
    startVista(s);
    let prev = stepCameraDirector(s, LIVE, DT, false);
    for (let i = 0; i < Math.ceil((VISTA_DURATION + 1) / DT); i++) {
      const cur = stepCameraDirector(s, LIVE, DT, false);
      expect(Math.abs(cur.dist - prev.dist)).toBeLessThan(0.35);
      expect(Math.abs(cur.pitch - prev.pitch)).toBeLessThan(0.03);
      expect(Math.abs(cur.yaw - prev.yaw)).toBeLessThan(0.03);
      prev = cur;
    }
  });

  it('cancels on disturbance and blends fully out within the release time', () => {
    const s = createCameraDirector();
    startVista(s);
    run(s, 2); // mid-vista
    const released = run(s, DIRECTOR_RELEASE_TIME + 0.2, true);
    expect(released).toEqual(LIVE);
    expect(cameraDirectiveActive(s)).toBe(false);
  });

  it('a cancel mid-sweep releases CONTINUOUSLY, never snapping to the live pose', () => {
    const s = createCameraDirector();
    startVista(s);
    let prev = LIVE;
    for (let i = 0; i < Math.round(2 / DT); i++) prev = stepCameraDirector(s, LIVE, DT, false);
    // From full weight, every release frame must stay a small step: a
    // regression that zeroed the weight on cancel snaps ~6 yd of dist here.
    for (let i = 0; i < Math.round((DIRECTOR_RELEASE_TIME + 0.3) / DT); i++) {
      const cur = stepCameraDirector(s, LIVE, DT, true);
      expect(Math.abs(cur.dist - prev.dist)).toBeLessThan(0.35);
      expect(Math.abs(cur.pitch - prev.pitch)).toBeLessThan(0.03);
      expect(Math.abs(cur.yaw - prev.yaw)).toBeLessThan(0.03);
      prev = cur;
    }
    expect(prev).toEqual(LIVE);
  });

  it('death drift persists until cancelled, then releases', () => {
    const s = createCameraDirector();
    startDeathDrift(s);
    const late = run(s, 10);
    expect(late.dist).toBeGreaterThan(LIVE.dist + 1);
    expect(cameraDirectiveActive(s)).toBe(true);
    cancelCameraDirective(s);
    const released = run(s, DIRECTOR_RELEASE_TIME + 0.2);
    expect(released).toEqual(LIVE);
    expect(cameraDirectiveActive(s)).toBe(false);
  });

  it('a new directive cannot preempt a running one', () => {
    const s = createCameraDirector();
    startVista(s);
    run(s, 1);
    startDeathDrift(s);
    expect(s.kind).toBe('vista');
  });
});
