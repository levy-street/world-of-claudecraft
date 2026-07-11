import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  isProjectedNameplateAnchorVisible,
  nameplateScreenTransform,
} from '../src/render/nameplate_projection';

describe('nameplate projection', () => {
  function camera(): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    cam.position.set(0, 2, 10);
    cam.lookAt(0, 2, 0);
    cam.updateMatrixWorld();
    return cam;
  }

  it('keeps anchors in front of the camera visible', () => {
    const cam = camera();
    const scratch = new THREE.Vector3();

    expect(isProjectedNameplateAnchorVisible(cam, new THREE.Vector3(0, 2, 0), scratch)).toBe(true);
  });

  it('hides anchors behind the camera before their projected coordinates can leak on-screen', () => {
    const cam = camera();
    const scratch = new THREE.Vector3();

    expect(isProjectedNameplateAnchorVisible(cam, new THREE.Vector3(0, 2, 12), scratch)).toBe(
      false,
    );
  });

  it('keeps sub-pixel screen transforms so nameplates do not snap while moving', () => {
    expect(nameplateScreenTransform(123.456, 78.123, 1)).toBe(
      'translate3d(123.46px, 78.12px, 0) scale(1.000) translate(-50%, -100%)',
    );
  });

  it('folds the distance scale into the one transform write, between the screen and anchor translates', () => {
    // scale must sit BEFORE translate(-50%, -100%): with transform-origin 0 0
    // (hud.css) that keeps the bottom-center anchor exactly at (sx, sy) while
    // the plate shrinks toward it.
    expect(nameplateScreenTransform(200, 100, 0.7)).toBe(
      'translate3d(200.00px, 100.00px, 0) scale(0.700) translate(-50%, -100%)',
    );
  });
});
