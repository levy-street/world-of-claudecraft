import { describe, expect, it } from 'vitest';
import { EditorCamera } from '../src/editor/3d/editor_camera';
import { cameraAxes } from '../src/editor/camera_axes';
import { NORTH_UP_YAW, nudgeDelta } from '../src/editor/placement_transform_core';

// EditorCamera's WASD fly() and drag pan() must strafe in the SAME ground-plane
// direction as the already-tested nudgeDelta() convention (and the game's own
// player_motion.ts right vector, (-cos yaw, sin yaw)): pressing D, or
// drag-panning right, must move toward screen-right, never away from it.

describe('EditorCamera.fly (WASD) agrees with nudgeDelta on "right"', () => {
  it.each([0, 0.7, Math.PI / 2, NORTH_UP_YAW, 4.2])(
    'strafing right (D) moves the same ground direction as ArrowRight at yaw=%p',
    (yaw) => {
      const cam = new EditorCamera();
      cam.yaw = yaw;
      cam.target.set(0, 0, 0);
      const before = cam.target.clone();
      cam.fly(0, 1, 0, 1); // right = +1 (D held), one second
      const dx = cam.target.x - before.x;
      const dz = cam.target.z - before.z;

      const nudge = nudgeDelta('ArrowRight', yaw, 1);
      // Same direction as the nudge convention (magnitudes differ: fly scales
      // by camera distance and dt, nudge is a fixed yard step).
      expect(Math.sign(dx)).toBe(Math.sign(nudge.dx));
      expect(Math.sign(dz)).toBe(Math.sign(nudge.dz));
    },
  );

  it('at the default yaw (behind-the-player), D moves toward +x, matching the screen', () => {
    const cam = new EditorCamera();
    cam.yaw = NORTH_UP_YAW;
    cam.target.set(0, 0, 0);
    cam.fly(0, 1, 0, 1);
    expect(cam.target.x).toBeGreaterThan(0);
    expect(cam.target.z).toBeCloseTo(0, 10);
  });

  it('A (left) is the exact opposite of D (right)', () => {
    for (const yaw of [0, 0.7, Math.PI / 2, NORTH_UP_YAW, 4.2]) {
      const right = new EditorCamera();
      right.yaw = yaw;
      right.target.set(0, 0, 0);
      right.fly(0, 1, 0, 1);

      const left = new EditorCamera();
      left.yaw = yaw;
      left.target.set(0, 0, 0);
      left.fly(0, -1, 0, 1);

      expect(left.target.x).toBeCloseTo(-right.target.x, 10);
      expect(left.target.z).toBeCloseTo(-right.target.z, 10);
    }
  });
});

describe('EditorCamera drag directions (uninverted default)', () => {
  // The editor ships UNINVERTED (panInverted false). In that baseline a drag
  // maps to the camera like this, and "Invert camera" mirrors all of it:
  //   horizontal - the view swings with the cursor (orbit yaw DECREASES on a
  //                rightward drag), and pan moves the camera, not the ground;
  //   vertical   - dragging down tilts the view down (pitch decreases), and
  //                pan grabs the ground.
  it('ships with invert off', () => {
    expect(new EditorCamera().panInverted).toBe(false);
  });

  it('a rightward orbit drag swings the view left (yaw decreases), and invert mirrors it', () => {
    const cam = new EditorCamera();
    cam.yaw = 0;
    cam.orbit(10, 0);
    expect(cam.yaw).toBeLessThan(0);

    const inverted = new EditorCamera();
    inverted.panInverted = true;
    inverted.yaw = 0;
    inverted.orbit(10, 0);
    expect(inverted.yaw).toBeCloseTo(-cam.yaw, 12);
  });

  it('a downward orbit drag tilts down (pitch decreases)', () => {
    const cam = new EditorCamera();
    const before = cam.pitch;
    cam.orbit(0, 10);
    expect(cam.pitch).toBeLessThan(before);
  });

  it('free-fly look swings with the cursor too, opposite the orbit sign', () => {
    const cam = new EditorCamera();
    cam.yaw = 0;
    cam.look(10, 0);
    expect(cam.yaw).toBeGreaterThan(0);
  });
});

describe('EditorCamera.pan (drag) uses the true right vector', () => {
  // Re-derived independently of the source: the camera basis (screen-right
  // cross(forward, up) = (-cos yaw, 0, sin yaw), screen-up from the pitch),
  // the documented 0.00135 pixel gain, and the uninverted gesture mapping
  // (horizontal straight through, vertical negated). A sign regression in
  // pan() still fails here.
  it.each([0, 0.7, Math.PI / 2, NORTH_UP_YAW, 4.2])(
    'matches the true-right-vector pan formula at yaw=%p',
    (yaw) => {
      const cam = new EditorCamera();
      cam.yaw = yaw;
      cam.target.set(0, 0, 0);
      const before = cam.target.clone();
      cam.pan(10, -6);
      const dx = cam.target.x - before.x;
      const dy = cam.target.y - before.y;
      const dz = cam.target.z - before.z;

      const k = cam.dist * 0.00135 * cam.panSpeedMul;
      const rx = -Math.cos(yaw);
      const rz = Math.sin(yaw);
      const sp = Math.sin(cam.pitch);
      const ux = Math.sin(yaw) * sp;
      const uy = Math.cos(cam.pitch);
      const uz = Math.cos(yaw) * sp;
      const px = 10; // horizontal: through as-is
      const py = 6; // vertical: negated (drag up grabs the ground upward)
      expect(dx).toBeCloseTo((-px * rx + py * ux) * k, 10);
      expect(dy).toBeCloseTo(py * uy * k, 10);
      expect(dz).toBeCloseTo((-px * rz + py * uz) * k, 10);
    },
  );

  it('at yaw 0 (facing +z), dragging right moves the pivot +x with the cursor', () => {
    const cam = new EditorCamera();
    cam.yaw = 0;
    cam.target.set(0, 0, 0);
    cam.pan(10, 0);
    expect(cam.target.x).toBeGreaterThan(0);
  });
});

describe('cameraAxes (shared forward/right basis)', () => {
  it('right matches nudgeDelta ArrowRight at representative yaws', () => {
    for (const yaw of [0, 0.7, Math.PI / 2, NORTH_UP_YAW, 4.2]) {
      const { rx, rz } = cameraAxes(yaw);
      const nudge = nudgeDelta('ArrowRight', yaw, 1);
      expect(rx).toBeCloseTo(nudge.dx, 10);
      expect(rz).toBeCloseTo(nudge.dz, 10);
    }
  });
});
