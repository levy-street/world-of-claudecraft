import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clampChaseCameraToInterior,
  hideSelfInCloseCamera,
  interiorCameraInternalsForTest,
  registerCameraInterior,
} from '../src/render/interior_camera';
import { cameraInterior, interiorContains } from '../src/render/interior_camera_core';

// The stable indoor view (the 'preserve-angle' framing, ported from the Mirefen tavern's
// stabilization): once inside, a wall or a ceiling shortens the boom along the requested ray
// and never swings the view to a new yaw or pitch; walking in the lens settles and then stays
// still; a close body hides without the lens jumping to the eyes. Pinned here on a plain
// hall (x 0..20, z 0..30, y 0..11, a 4 by 5.2 yard front door out of the -z wall), the
// proportions of a classic inn's common room.

const HALL = cameraInterior(
  'stability_hall',
  [
    [0, 20, 0, 11, 0, 30],
    [8, 12, 0, 5.2, -1, 1],
  ],
  [{ box: 1, axis: 2, side: -1 }],
  new Map(),
  'preserve-angle',
);

afterEach(() => interiorCameraInternalsForTest.reset());

function lens(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(70, 16 / 9, 0.2, 950);
}

describe('indoor camera stability (preserve-angle)', () => {
  it('does not change the drawn direction when the body hides during doorway recovery', () => {
    registerCameraInterior(HALL);
    const cam = lens();
    let checked = false;
    for (let frame = 0; frame < 360; frame++) {
      const t = frame / 60;
      // in through the door, then along the front wall into its corner
      const self = new THREE.Vector3(
        Math.min(19.6, 10 + Math.max(0, t - 2.3) * 7),
        0,
        Math.min(1.6, -14 + t * 7),
      );
      const look = self.clone().add(new THREE.Vector3(0, 2, 0));
      cam.position.copy(look).add(new THREE.Vector3(Math.cos(0.75) * 18, Math.sin(0.75) * 18, 0));
      clampChaseCameraToInterior(cam, look, self, 1 / 60, false);
      const state = interiorCameraInternalsForTest.state();
      if (!state.firstPerson) continue;
      const towardPlayer = new THREE.Vector3(state.startX, state.startY, state.startZ).sub(
        cam.position,
      );
      // pressed into the corner the boom reaches nothing and the direction is undefined
      if (towardPlayer.length() < 0.05) continue;
      towardPlayer.normalize();
      checked = true;
      cam.lookAt(look);
      expect(cam.getWorldDirection(new THREE.Vector3()).distanceTo(towardPlayer)).toBeLessThan(
        1e-5,
      );
    }
    expect(checked).toBe(true);
  });

  it.each([30, 60, 144])('settles after walking in and stays still at %i FPS', (fps) => {
    registerCameraInterior(HALL);
    const cam = lens();
    const previous = new THREE.Vector3();
    for (let frame = 0; frame < fps * 18; frame++) {
      const z = Math.min(20, -14 + (frame / fps) * 7);
      const self = new THREE.Vector3(10, 0, z);
      const look = self.clone().add(new THREE.Vector3(0, 2, 0));
      cam.position.copy(look).add(new THREE.Vector3(0, Math.sin(0.75) * 18, -Math.cos(0.75) * 18));
      clampChaseCameraToInterior(cam, look, self, 1 / fps, false);
      if (frame > 0) expect(cam.position.distanceTo(previous) * fps).toBeLessThan(27);
      // long after the entrance, no autonomous re-framing and no perpetual drift
      if (frame > fps * 15) {
        expect(cam.position.distanceTo(previous)).toBeLessThan(1e-6);
        cam.lookAt(look);
        expect(
          cam
            .getWorldDirection(new THREE.Vector3())
            .distanceTo(new THREE.Vector3(0, -Math.sin(0.75), Math.cos(0.75))),
        ).toBeLessThan(1e-6);
        expect(interiorContains(HALL, cam.position.x, cam.position.y, cam.position.z)).toBe(true);
      }
      previous.copy(cam.position);
    }
  });

  it.each([30, 60, 144])(
    'approaches a wall without a first-person position jump at %i FPS',
    (fps) => {
      registerCameraInterior(HALL);
      const cam = lens();
      const self = new THREE.Vector3();
      const look = new THREE.Vector3();
      const previous = new THREE.Vector3();
      const body = new THREE.Group();
      let hidden = false;
      let shownAgain = false;
      for (let frame = -fps; frame <= fps * 8; frame++) {
        const t = Math.max(0, frame) / fps;
        // backing toward the east wall (x 20) with the camera behind, then away again
        self.set(15 + (t <= 4 ? t : 8 - t), 0, 15);
        look.copy(self).y += 2;
        cam.position.copy(look).add(new THREE.Vector3(12, 0, 0));
        clampChaseCameraToInterior(cam, look, self, 1 / fps, false);
        if (frame > 0) expect(cam.position.distanceTo(previous)).toBeLessThan(0.15);
        previous.copy(cam.position);
        hidden ||= interiorCameraInternalsForTest.state().firstPerson;
        body.visible = true;
        hideSelfInCloseCamera(body, cam);
        expect(body.visible).toBe(!interiorCameraInternalsForTest.state().firstPerson);
        shownAgain ||= hidden && body.visible;
      }
      expect(hidden).toBe(true);
      expect(shownAgain).toBe(true);
    },
  );

  it.each([
    ['under the hall ceiling', 10, 15, 0.75, 18],
    ['against the front corner', 18.5, 2, 0.32, 12],
    ['in the back of the hall', 4, 27, 0.55, 14],
  ] as const)('keeps the requested viewing angle %s', (_name, x, z, pitch, dist) => {
    registerCameraInterior(HALL);
    const self = new THREE.Vector3(x, 0, z);
    const cam = lens();
    const ray = new THREE.Vector3(Math.cos(pitch), Math.sin(pitch), 0);
    const aim = ray.clone().negate();
    for (let frame = 0; frame < 180; frame++) {
      const look = self.clone().add(new THREE.Vector3(0, 2, 0));
      cam.position.copy(look).addScaledVector(ray, dist);
      clampChaseCameraToInterior(cam, look, self, 1 / 60, false);
      cam.lookAt(look);
      expect(cam.getWorldDirection(new THREE.Vector3()).distanceTo(aim)).toBeLessThan(1e-6);
      expect(interiorContains(HALL, cam.position.x, cam.position.y, cam.position.z)).toBe(true);
    }
  });
});
