import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { isProjectedNameplateAnchorVisible } from '../src/render/nameplate_projection';

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

    expect(isProjectedNameplateAnchorVisible(cam, new THREE.Vector3(0, 2, 12), scratch)).toBe(false);
  });
});
