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

describe('EditorCamera.pan (drag) uses the true right vector', () => {
  // pan() is "grab the ground and drag it": dragging right must move the
  // target toward the world point that follows the cursor, i.e. the
  // NEGATIVE of the true right vector (the opposite sign relationship from
  // fly(), which moves the camera itself toward +right on D). Pinned here
  // against an independently re-derived formula (not imported from source)
  // using the true right vector cross(forward, up) = (-cos yaw, 0, sin yaw),
  // so this test still fails if the same sign bug is reintroduced.
  it.each([0, 0.7, Math.PI / 2, NORTH_UP_YAW, 4.2])(
    'matches the true-right-vector pan formula at yaw=%p',
    (yaw) => {
      const cam = new EditorCamera();
      cam.yaw = yaw;
      cam.target.set(0, 0, 0);
      const before = cam.target.clone();
      cam.pan(10, -6);
      const dx = cam.target.x - before.x;
      const dz = cam.target.z - before.z;

      const speed = cam.dist * 0.0016;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const rxTrue = -Math.cos(yaw);
      const rzTrue = Math.sin(yaw);
      const expectedDx = (-10 * rxTrue + -6 * fx) * speed;
      const expectedDz = (-10 * rzTrue + -6 * fz) * speed;
      expect(dx).toBeCloseTo(expectedDx, 10);
      expect(dz).toBeCloseTo(expectedDz, 10);
    },
  );

  it('at yaw 0 (facing +z), dragging right pulls the ground toward the cursor (target moves +x)', () => {
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
