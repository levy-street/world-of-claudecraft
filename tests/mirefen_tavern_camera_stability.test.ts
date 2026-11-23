import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clampChaseCameraToInterior,
  hideSelfInCloseCamera,
  interiorCameraInternalsForTest,
  registerCameraInterior,
} from '../src/render/interior_camera';
import { interiorContains } from '../src/render/interior_camera_core';
import { mirefenTavernCameraInterior } from '../src/render/mirefen_tavern_interior_core';
import { TAVERN_FLOOR_Y, tavernToWorld } from '../src/sim/content/mirefen_tavern';

afterEach(() => interiorCameraInternalsForTest.reset());

describe('tavern camera stability', () => {
  it('does not change the drawn direction when the body hides during doorway recovery', () => {
    registerCameraInterior(mirefenTavernCameraInterior());
    const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.2, 950);
    let checked = false;
    for (let frame = 0; frame < 300; frame++) {
      const t = frame / 60;
      const point = tavernToWorld(
        Math.min(14.4, Math.max(0, t - 2) * 7),
        Math.max(12.4, 26 - t * 7),
      );
      const self = new THREE.Vector3(point.x, TAVERN_FLOOR_Y, point.z);
      const look = self.clone().add(new THREE.Vector3(0, 2, 0));
      cam.position.copy(look).add(new THREE.Vector3(Math.cos(0.75) * 18, Math.sin(0.75) * 18, 0));
      clampChaseCameraToInterior(cam, look, self, 1 / 60, false);
      const state = interiorCameraInternalsForTest.state();
      if (!state.firstPerson || state.cap < 0.001) continue;
      checked = true;
      cam.lookAt(look);
      const towardPlayer = new THREE.Vector3(state.startX, state.startY, state.startZ)
        .sub(cam.position)
        .normalize();
      expect(cam.getWorldDirection(new THREE.Vector3()).distanceTo(towardPlayer)).toBeLessThan(
        1e-6,
      );
    }
    expect(checked).toBe(true);
  });

  it.each([30, 60, 144])('settles after walking in and stays still at %i FPS', (fps) => {
    registerCameraInterior(mirefenTavernCameraInterior());
    const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.2, 950);
    const previous = new THREE.Vector3();
    for (let frame = 0; frame < fps * 18; frame++) {
      const z = Math.max(-10, 26 - (frame / fps) * 7);
      const point = tavernToWorld(0, z);
      const self = new THREE.Vector3(point.x, TAVERN_FLOOR_Y, point.z);
      const look = self.clone().add(new THREE.Vector3(0, 2, 0));
      cam.position.copy(look).add(new THREE.Vector3(Math.cos(0.75) * 18, Math.sin(0.75) * 18, 0));
      clampChaseCameraToInterior(cam, look, self, 1 / fps, false);
      if (frame > 0) expect(cam.position.distanceTo(previous) * fps).toBeLessThan(27);
      // Long after entrance recovery, no autonomous re-framing or perpetual drift.
      if (frame > fps * 15) {
        expect(cam.position.distanceTo(previous)).toBeLessThan(1e-6);
        cam.lookAt(look);
        expect(
          cam
            .getWorldDirection(new THREE.Vector3())
            .distanceTo(new THREE.Vector3(-Math.cos(0.75), -Math.sin(0.75), 0)),
        ).toBeLessThan(1e-6);
      }
      previous.copy(cam.position);
    }
  });

  it.each([30, 60, 144])(
    'approaches a wall without a first-person position jump at %i FPS',
    (fps) => {
      registerCameraInterior(mirefenTavernCameraInterior());
      const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.2, 950);
      const self = new THREE.Vector3();
      const look = new THREE.Vector3();
      const previous = new THREE.Vector3();
      const body = new THREE.Group();
      let hidden = false;
      let shownAgain = false;
      for (let frame = -fps; frame <= fps * 6; frame++) {
        const t = Math.max(0, frame) / fps;
        const point = tavernToWorld(0, 9.5 + (t <= 3 ? t : 6 - t));
        self.set(point.x, TAVERN_FLOOR_Y, point.z);
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
    ['under the hall ceiling', 0, -1, 0.75, 18],
    ['against the front corner', 14.4, 12.4, 0.32, 12],
    ['under the nook arch', -3, -14, 0.55, 14],
  ] as const)('keeps the requested viewing angle %s', (_name, x, z, pitch, dist) => {
    const vol = mirefenTavernCameraInterior();
    registerCameraInterior(vol);
    const point = tavernToWorld(x, z);
    const self = new THREE.Vector3(point.x, TAVERN_FLOOR_Y, point.z);
    const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.2, 950);
    const ray = new THREE.Vector3(Math.cos(pitch), Math.sin(pitch), 0);
    const aim = ray.clone().negate();
    for (let frame = 0; frame < 180; frame++) {
      const look = self.clone().add(new THREE.Vector3(0, 2, 0));
      cam.position.copy(look).addScaledVector(ray, dist);
      clampChaseCameraToInterior(cam, look, self, 1 / 60, false);
      cam.lookAt(look);
      expect(cam.getWorldDirection(new THREE.Vector3()).distanceTo(aim)).toBeLessThan(1e-6);
      expect(interiorContains(vol, cam.position.x, cam.position.y, cam.position.z)).toBe(true);
    }
  });
});
