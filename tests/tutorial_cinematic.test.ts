// The tutorial's cinematic camera. The contract that matters: a scene is one
// continuous path (no cut on entry, no snap between shots, and it LANDS exactly on
// the gameplay pose so handing control back is invisible), and every cue fires
// exactly once.

import { describe, expect, it } from 'vitest';
import {
  CHASE_EYE_HEIGHT,
  chasePose,
  cuesBetween,
  frameSubject,
  type Scene,
  sceneDuration,
  scenePose,
} from '../src/game/tutorial_cinematic';

const OPEN = { eye: { x: 0, y: 10, z: 20 }, target: { x: 0, y: 2, z: 0 } };
const SCENE: Scene = {
  open: OPEN,
  shots: [
    { to: { eye: { x: 10, y: 4, z: 0 }, target: { x: 5, y: 1, z: 0 } }, durationSec: 2, cue: 'a' },
    {
      to: { eye: { x: 12, y: 3, z: 1 }, target: { x: 5, y: 1, z: 0 } },
      durationSec: 1,
      hold: true,
      cue: 'b',
    },
    { to: OPEN, durationSec: 2 },
  ],
};

describe('tutorial cinematic', () => {
  it('opens exactly on the pose it was handed, so entering a scene is not a cut', () => {
    const p = scenePose(0, SCENE);
    expect(p.eye).toEqual(OPEN.eye);
    expect(p.target).toEqual(OPEN.target);
    expect(p.done).toBe(false);
  });

  it('lands exactly on the final shot, so handing control back is not a cut either', () => {
    const end = scenePose(sceneDuration(SCENE), SCENE);
    expect(end.eye).toEqual(OPEN.eye);
    expect(end.target).toEqual(OPEN.target);
    expect(end.done).toBe(true);
    // And it stays done and parked past the end (a dropped frame must not rewind it).
    const past = scenePose(sceneDuration(SCENE) + 5, SCENE);
    expect(past.done).toBe(true);
    expect(past.eye).toEqual(OPEN.eye);
  });

  it('is continuous across a shot boundary', () => {
    // Sampled either side of the 2s cut, the eye must barely move: a shot eases
    // from where the previous one ENDED, so there is no jump.
    const before = scenePose(1.999, SCENE);
    const after = scenePose(2.001, SCENE);
    const jump = Math.hypot(
      after.eye.x - before.eye.x,
      after.eye.y - before.eye.y,
      after.eye.z - before.eye.z,
    );
    expect(jump).toBeLessThan(0.05);
  });

  it('holds still on a hold shot: that is where the reveal lands', () => {
    const a = scenePose(2.1, SCENE);
    const b = scenePose(2.9, SCENE);
    expect(a.eye).toEqual(b.eye);
    // It holds where the PREVIOUS shot left the camera, not on a pose of its own:
    // that is what makes a hold cut-free by construction.
    expect(a.eye).toEqual(SCENE.shots[0].to.eye);
  });

  it('fires each cue exactly once, in order', () => {
    // Poll the way the host does: a sliding (prev, now] window over frames.
    const fired: string[] = [];
    let prev = -1;
    for (let t = 0; t <= sceneDuration(SCENE); t += 0.1) {
      fired.push(...cuesBetween(prev, t, SCENE));
      prev = t;
    }
    expect(fired).toEqual(['a', 'b']);
  });

  it('a skip sweeps up every cue that had not fired yet', () => {
    // Skipping at 0.5s (cue "a" fired at t=0, "b" has not) must still fire "b", or
    // the wolf never spawns and the tutorial dead-ends.
    expect(cuesBetween(0.5, Number.POSITIVE_INFINITY, SCENE)).toEqual(['b']);
    // Skipping before anything fired sweeps up both.
    expect(cuesBetween(-1, Number.POSITIVE_INFINITY, SCENE)).toEqual(['a', 'b']);
  });

  it('frameSubject looks at the subject from the distance and height asked for', () => {
    const subject = { x: 3, y: 1, z: -4 };
    const shot = frameSubject(subject, 0.7, 8, 2);
    expect(shot.target).toEqual(subject);
    expect(Math.hypot(shot.eye.x - subject.x, shot.eye.z - subject.z)).toBeCloseTo(8, 6);
    expect(shot.eye.y - subject.y).toBeCloseTo(2, 6);
  });

  it("chasePose reproduces the renderer's own orbit math", () => {
    // This is the lockstep that makes a scene open without a cut. The expected
    // values are the renderer's camera placement formula, transcribed (see the
    // camera block in renderer.ts).
    const player = { x: 5, y: 3, z: -2 };
    const cam = { yaw: 1.1, pitch: 0.32, dist: 12 };
    const pose = chasePose(player, cam);
    const eyeY = player.y + CHASE_EYE_HEIGHT;
    expect(pose.eye.x).toBeCloseTo(
      player.x - Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist,
      9,
    );
    expect(pose.eye.y).toBeCloseTo(eyeY + Math.sin(cam.pitch) * cam.dist, 9);
    expect(pose.eye.z).toBeCloseTo(
      player.z - Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist,
      9,
    );
    expect(pose.target).toEqual({ x: player.x, y: eyeY, z: player.z });
  });
});
